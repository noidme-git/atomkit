// A safe expression evaluator for AQL.
//
// AQL 1.0 needs expressions — `{{state.count > 3}}`, `{{item.name}}`,
// `{{upper(user.title)}}` — to express a conditional, a loop body, or a bound
// value. Expressions are the single largest new attack surface in a language
// whose entire value proposition is fail-closed governance, and whose documents
// are explicitly allowed to be hostile, stale, or LLM-generated.
//
// Therefore, non-negotiably:
//   * No `eval`, no `new Function`, no `with`. Ever. A validated AST is walked.
//   * No access to anything not explicitly placed in scope. No globals, no
//     `this`, no imports, no `process`.
//   * Prototype access is rejected at parse time AND at evaluation time:
//     `__proto__`, `prototype`, `constructor`. Belt and braces, because a
//     computed member (`a[k]`) can name a key the parser never saw.
//   * Only whitelisted functions may be called. There is no way to call a
//     function that arrives from scope — a value is never callable.
//   * Source length, AST size and nesting depth are all capped, so a document
//     cannot become a denial-of-service.
//
// Evaluation NEVER throws on a bad path: an unresolvable reference is `undefined`,
// which renders as nothing. Failing closed beats failing loudly here, because the
// alternative is a stale document taking a page down.

export const MAX_SOURCE = 1000;
export const MAX_NODES = 200;
export const MAX_DEPTH = 32;

/** Keys that can reach the prototype chain. Never resolvable, statically or dynamically. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// ── AST ──────────────────────────────────────────────────────────────────────
export type Expr =
  | { k: 'lit'; v: string | number | boolean | null }
  | { k: 'ref'; name: string }
  | { k: 'member'; obj: Expr; prop: string }
  | { k: 'index'; obj: Expr; idx: Expr }
  | { k: 'unary'; op: '!' | '-'; arg: Expr }
  | { k: 'bin'; op: BinOp; l: Expr; r: Expr }
  | { k: 'cond'; test: Expr; then: Expr; else: Expr }
  | { k: 'call'; fn: string; args: Expr[] };

type BinOp = '||' | '&&' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '+' | '-' | '*' | '/' | '%';

// ── Whitelisted functions ────────────────────────────────────────────────────
// Pure, total, side-effect free. Each coerces defensively: an expression is fed
// values from a document we do not trust.
const asStr = (v: unknown): string => (v == null ? '' : String(v));
const asNum = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// FROZEN, and null-prototyped. An exported mutable object IS the whitelist: anything
// running in the process could widen it (`ak.FUNCTIONS.pwned = …`) and a document
// would then be able to call it. A null prototype also means `FUNCTIONS.constructor`
// is not a function to be found in the first place.
type Fn = (...a: unknown[]) => unknown;
const FNS: Record<string, Fn> = {
  len: (v) => (Array.isArray(v) ? v.length : asStr(v).length),
  upper: (v) => asStr(v).toUpperCase(),
  lower: (v) => asStr(v).toLowerCase(),
  trim: (v) => asStr(v).trim(),
  includes: (h, n) => (Array.isArray(h) ? h.includes(n) : asStr(h).includes(asStr(n))),
  startsWith: (h, n) => asStr(h).startsWith(asStr(n)),
  endsWith: (h, n) => asStr(h).endsWith(asStr(n)),
  not: (v) => !truthy(v),
  min: (a, b) => Math.min(asNum(a), asNum(b)),
  max: (a, b) => Math.max(asNum(a), asNum(b)),
  abs: (v) => Math.abs(asNum(v)),
  round: (v) => Math.round(asNum(v)),
  floor: (v) => Math.floor(asNum(v)),
  ceil: (v) => Math.ceil(asNum(v)),
  join: (a, sep) => asArr(a).map(asStr).join(asStr(sep ?? ',')),
  first: (a) => asArr(a)[0],
  last: (a) => asArr(a)[asArr(a).length - 1],
  fallback: (v, d) => (v == null || v === '' ? d : v),
};

/** The call whitelist: FROZEN, and null-prototyped.
 *
 *  An exported mutable object IS the whitelist. Anything running in the process
 *  could widen it — `ak.FUNCTIONS.pwned = () => …` — and a document would then be
 *  able to call it. Verified: before freezing, `evalExpr("pwned()")` returned the
 *  injected value. The null prototype additionally means `FUNCTIONS.constructor`
 *  is not a function to be found in the first place. */
export const FUNCTIONS: Readonly<Record<string, Fn>> =
  Object.freeze(Object.assign(Object.create(null) as Record<string, Fn>, FNS));

/** JS truthiness, minus the surprises we do not want in a template language. */
function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

// ── Tokeniser ────────────────────────────────────────────────────────────────
interface Tok { t: 'num' | 'str' | 'id' | 'op'; v: string }

const OPS3 = ['===', '!=='];
const OPS2 = ['||', '&&', '==', '!=', '<=', '>='];
const OPS1 = '!<>+-*/%.,()[]?:'.split('');

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      out.push({ t: 'num', v: src.slice(i, j) }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; }
        else { s += src[j]; j++; }
      }
      if (j >= src.length) throw new Error('unterminated string');
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j]!)) j++;
      out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue;
    }
    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) { out.push({ t: 'op', v: three.slice(0, 2) }); i += 3; continue; } // === → ==
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if (OPS1.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`unexpected character ${JSON.stringify(c)}`);
  }
  return out;
}

// ── Parser (precedence climbing) ─────────────────────────────────────────────
const BIN_PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

class Parser {
  private i = 0;
  private nodes = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined { return this.toks[this.i]; }
  private eat(v?: string): Tok {
    const t = this.toks[this.i];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`expected ${v ?? 'token'}`);
    this.i++; return t;
  }
  private count(): void {
    if (++this.nodes > MAX_NODES) throw new Error(`expression too large (> ${MAX_NODES} nodes)`);
  }

  parse(): Expr {
    const e = this.ternary(0);
    if (this.i < this.toks.length) throw new Error('trailing tokens in expression');
    return e;
  }

  private ternary(depth: number): Expr {
    if (depth > MAX_DEPTH) throw new Error(`expression too deep (> ${MAX_DEPTH})`);
    const test = this.binary(0, depth);
    if (this.peek()?.v === '?') {
      this.eat('?');
      const then = this.ternary(depth + 1);
      this.eat(':');
      const els = this.ternary(depth + 1);
      this.count();
      return { k: 'cond', test, then, else: els };
    }
    return test;
  }

  private binary(minPrec: number, depth: number): Expr {
    if (depth > MAX_DEPTH) throw new Error(`expression too deep (> ${MAX_DEPTH})`);
    let left = this.unary(depth);
    for (;;) {
      const op = this.peek();
      if (!op || op.t !== 'op') break;
      const prec = BIN_PRECEDENCE[op.v];
      if (prec === undefined || prec < minPrec) break;
      this.eat();
      const right = this.binary(prec + 1, depth + 1);
      this.count();
      left = { k: 'bin', op: op.v as BinOp, l: left, r: right };
    }
    return left;
  }

  private unary(depth: number): Expr {
    const t = this.peek();
    if (t?.t === 'op' && (t.v === '!' || t.v === '-')) {
      this.eat();
      this.count();
      return { k: 'unary', op: t.v as '!' | '-', arg: this.unary(depth + 1) };
    }
    return this.postfix(depth);
  }

  private postfix(depth: number): Expr {
    let e = this.primary(depth);
    for (;;) {
      const t = this.peek();
      if (t?.v === '.') {
        this.eat('.');
        const id = this.eat();
        if (id.t !== 'id') throw new Error('expected property name');
        // Static guard. The dynamic guard in `evaluate` catches the computed case.
        if (FORBIDDEN_KEYS.has(id.v)) throw new Error(`forbidden property "${id.v}"`);
        this.count();
        e = { k: 'member', obj: e, prop: id.v };
      } else if (t?.v === '[') {
        this.eat('[');
        const idx = this.ternary(depth + 1);
        this.eat(']');
        this.count();
        e = { k: 'index', obj: e, idx };
      } else break;
    }
    return e;
  }

  private primary(depth: number): Expr {
    const t = this.peek();
    if (!t) throw new Error('unexpected end of expression');
    this.count();

    if (t.t === 'num') { this.eat(); return { k: 'lit', v: Number(t.v) }; }
    if (t.t === 'str') { this.eat(); return { k: 'lit', v: t.v }; }
    if (t.v === '(') { this.eat('('); const e = this.ternary(depth + 1); this.eat(')'); return e; }

    if (t.t === 'id') {
      this.eat();
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (this.peek()?.v === '(') {
        // A call is only ever to a whitelisted NAME. A value from scope is never
        // callable, so there is no `scope.evil()` and no `(expr)()`.
        if (!Object.hasOwn(FUNCTIONS, t.v)) throw new Error(`unknown function "${t.v}"`);
        this.eat('(');
        const args: Expr[] = [];
        while (this.peek()?.v !== ')') {
          args.push(this.ternary(depth + 1));
          if (this.peek()?.v === ',') this.eat(',');
          else break;
        }
        this.eat(')');
        return { k: 'call', fn: t.v, args };
      }
      if (FORBIDDEN_KEYS.has(t.v)) throw new Error(`forbidden identifier "${t.v}"`);
      return { k: 'ref', name: t.v };
    }
    throw new Error(`unexpected token ${JSON.stringify(t.v)}`);
  }
}

/** Parse an expression source into a validated AST. Throws on anything unsafe. */
export function parseExpr(src: string): Expr {
  if (typeof src !== 'string') throw new Error('expression must be a string');
  if (src.length > MAX_SOURCE) throw new Error(`expression too long (> ${MAX_SOURCE} chars)`);
  return new Parser(tokenize(src)).parse();
}

// ── Evaluation ───────────────────────────────────────────────────────────────
export type Scope = Record<string, unknown>;

/** Read a property without ever traversing the prototype chain. */
function readProp(obj: unknown, key: string): unknown {
  if (obj == null) return undefined;
  if (FORBIDDEN_KEYS.has(key)) return undefined; // dynamic guard: a[k] where k = "__proto__"
  if (typeof obj === 'string') return key === 'length' ? obj.length : undefined;
  if (Array.isArray(obj)) {
    if (key === 'length') return obj.length;
    const n = Number(key);
    return Number.isInteger(n) && n >= 0 ? obj[n] : undefined;
  }
  if (typeof obj !== 'object') return undefined;
  // Own properties only. An inherited member is not data the document authored.
  return Object.hasOwn(obj as object, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

const eq = (a: unknown, b: unknown): boolean => a === b || (a == null && b == null);

/**
 * Evaluate a validated AST against a scope. Never throws for a missing reference:
 * an unresolvable path is `undefined` and renders as nothing.
 *
 * The scope is the ONLY thing reachable. Values from scope are never callable, so
 * a document cannot invoke anything the host did not whitelist.
 */
export function evaluate(node: Expr, scope: Scope): unknown {
  switch (node.k) {
    case 'lit': return node.v;
    case 'ref': return readProp(scope, node.name);
    case 'member': return readProp(evaluate(node.obj, scope), node.prop);
    case 'index': {
      const key = evaluate(node.idx, scope);
      return readProp(evaluate(node.obj, scope), String(key));
    }
    case 'unary': {
      const v = evaluate(node.arg, scope);
      return node.op === '!' ? !truthy(v) : -asNum(v);
    }
    case 'cond': return truthy(evaluate(node.test, scope)) ? evaluate(node.then, scope) : evaluate(node.else, scope);
    case 'call': {
      const fn = Object.hasOwn(FUNCTIONS, node.fn) ? FUNCTIONS[node.fn] : undefined;
      if (!fn) return undefined; // unreachable: the parser rejected it
      return fn(...node.args.map((a) => evaluate(a, scope)));
    }
    case 'bin': {
      // Short-circuit before evaluating the right side.
      if (node.op === '&&') return truthy(evaluate(node.l, scope)) ? evaluate(node.r, scope) : false;
      if (node.op === '||') { const l = evaluate(node.l, scope); return truthy(l) ? l : evaluate(node.r, scope); }
      const l = evaluate(node.l, scope);
      const r = evaluate(node.r, scope);
      switch (node.op) {
        case '==': return eq(l, r);
        case '!=': return !eq(l, r);
        case '<': return asNum(l) < asNum(r);
        case '>': return asNum(l) > asNum(r);
        case '<=': return asNum(l) <= asNum(r);
        case '>=': return asNum(l) >= asNum(r);
        // `+` concatenates when either side is a string, matching template intuition.
        case '+': return typeof l === 'string' || typeof r === 'string' ? asStr(l) + asStr(r) : asNum(l) + asNum(r);
        case '-': return asNum(l) - asNum(r);
        case '*': return asNum(l) * asNum(r);
        case '/': { const d = asNum(r); return d === 0 ? 0 : asNum(l) / d; }
        case '%': { const d = asNum(r); return d === 0 ? 0 : asNum(l) % d; }
      }
    }
  }
}

/** Parse + evaluate. Returns `undefined` if the expression is invalid — fail closed. */
export function evalExpr(src: string, scope: Scope): unknown {
  let ast: Expr;
  try { ast = parseExpr(src); } catch { return undefined; }
  try { return evaluate(ast, scope); } catch { return undefined; }
}

/**
 * Interpolate `{{ expr }}` occurrences in a template string.
 * A whole-string expression (`"{{user.name}}"`) returns the raw value, so a
 * number stays a number and an array stays an array. Otherwise the result is
 * stringified and concatenated.
 */
export function interpolate(template: string, scope: Scope): unknown {
  if (typeof template !== 'string' || !template.includes('{{')) return template;
  const whole = template.match(/^\s*\{\{([^}]*)\}\}\s*$/);
  if (whole) return evalExpr(whole[1]!, scope);
  return template.replace(/\{\{([^}]*)\}\}/g, (_m, src: string) => asStr(evalExpr(src, scope)));
}
