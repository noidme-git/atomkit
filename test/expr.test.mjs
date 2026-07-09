// The safe expression evaluator.
//
// Expressions are the largest new attack surface in AQL: a document — which may be
// hostile, stale, or LLM-generated — gets to supply the source. The guarantee under
// test is not "it computes 2+2". It is that a hostile expression cannot escape the
// interpreter, reach a prototype, call anything unlisted, read anything outside its
// scope, or hang the process.
//
// Every guard has a NEGATIVE CONTROL: an attack that must be rejected. A guard whose
// attack we never fire is a guard we have never tested.

import assert from 'node:assert/strict';
import { parseExpr, evaluate, evalExpr, interpolate, FUNCTIONS, MAX_NODES, MAX_DEPTH, MAX_SOURCE } from '../dist/expr.js';   // not exported from index — see src/index.ts

const ev = (src, scope = {}) => evalExpr(src, scope);
const rejects = (src) => assert.throws(() => parseExpr(src), undefined, `expected parse to reject: ${src}`);

// ── It computes ──────────────────────────────────────────────────────────────
{
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('10 / 4'), 2.5);
  assert.equal(ev('7 % 3'), 1);
  assert.equal(ev('-5 + 1'), -4);
  assert.equal(ev('!true'), false);
  assert.equal(ev('1 < 2 && 2 < 3'), true);
  assert.equal(ev('1 > 2 || 3 > 2'), true);
  assert.equal(ev('2 == 2'), true);
  assert.equal(ev('2 === 2'), true, '=== is accepted and folded to ==');
  assert.equal(ev('2 != 3'), true);
  assert.equal(ev('true ? "y" : "n"'), 'y');
  assert.equal(ev('"a" + "b"'), 'ab');
  assert.equal(ev('"n=" + 5'), 'n=5', 'string + number concatenates');
  assert.equal(ev('1 / 0'), 0, 'division by zero yields 0, never Infinity/NaN');
  assert.equal(ev('7 % 0'), 0);
}

// ── Scope access, own-properties only ────────────────────────────────────────
{
  const scope = { state: { count: 3, user: { name: 'Ada' } }, items: ['a', 'b', 'c'], n: 2 };
  assert.equal(ev('state.count', scope), 3);
  assert.equal(ev('state.count > 2', scope), true);
  assert.equal(ev('state.user.name', scope), 'Ada');
  assert.equal(ev('items[1]', scope), 'b');
  assert.equal(ev('items[n]', scope), 'c', 'computed index');
  assert.equal(ev('items.length', scope), 3);
  assert.equal(ev('"Ada".length', scope), 3);
  // Missing paths fail closed, never throw.
  assert.equal(ev('state.missing', scope), undefined);
  assert.equal(ev('nothing.at.all', scope), undefined);
  assert.equal(ev('items[99]', scope), undefined);
}

// ── Whitelisted functions, and only those ────────────────────────────────────
{
  const scope = { s: '  Hi  ', xs: [3, 1, 2] };
  assert.equal(ev('upper("ab")'), 'AB');
  assert.equal(ev('trim(s)', scope), 'Hi');
  assert.equal(ev('len(xs)', scope), 3);
  assert.equal(ev('join(xs, "-")', scope), '3-1-2');
  assert.equal(ev('includes("abc", "b")'), true);
  assert.equal(ev('fallback("", "dflt")'), 'dflt');
  assert.equal(ev('fallback(null, "dflt")'), 'dflt');
  assert.equal(ev('max(1, 9)'), 9);

  // NEGATIVE CONTROLS — unlisted or smuggled calls must be rejected at PARSE time.
  rejects('alert(1)');
  rejects('eval("1")');
  rejects('require("fs")');
  rejects('fetch("https://evil")');
  // A value from scope is never callable: there is no postfix call on an expression.
  rejects('state.fn()');
  rejects('(1)(2)');
  assert.ok(!Object.hasOwn(FUNCTIONS, 'eval') && !Object.hasOwn(FUNCTIONS, 'Function'));
}

// ── The whitelist itself must not be widenable at runtime ───────────────────
// An exported mutable object IS the whitelist. Anything in the process could have
// done `ak.FUNCTIONS.pwned = () => …` and a document could then call it — verified
// before the fix: evalExpr("pwned()") returned the injected value. Found by the CTO
// review of the 0.8.0 release candidate.
{
  assert.ok(Object.isFrozen(FUNCTIONS), 'the function whitelist must be frozen');
  assert.equal(Object.getPrototypeOf(FUNCTIONS), null, 'the whitelist must have a null prototype');

  // The attack, fired: assignment throws under ESM strict mode; either way it must not land.
  assert.throws(() => { FUNCTIONS.pwned = () => 'INJECTED'; }, TypeError);
  assert.ok(!Object.hasOwn(FUNCTIONS, 'pwned'), 'injection landed in the whitelist');
  assert.equal(evalExpr('pwned()', {}), undefined, 'an injected function became callable from a document');

  // Deleting a real one must not work either.
  assert.throws(() => { delete FUNCTIONS.upper; }, TypeError);
  assert.equal(ev('upper("ab")'), 'AB', 'legitimate calls still work');

  // A null prototype means there is no `constructor` to find on it at all.
  assert.equal(FUNCTIONS.constructor, undefined);
}

// ── Prototype access: rejected statically AND dynamically ────────────────────
{
  // Static: named in the source.
  rejects('__proto__');
  rejects('a.__proto__');
  rejects('a.constructor');
  rejects('a.prototype');
  rejects('a.constructor.constructor("return process")()');

  // Dynamic: a computed member naming a forbidden key. The parser never sees it.
  //
  // Crucially this must be tested against a JSON-PARSED object, not an object
  // literal. `JSON.parse('{"__proto__": {...}}')` creates a genuine OWN property
  // named `__proto__`, so `Object.hasOwn` returns true and the own-property check
  // does NOT save us — the dynamic key guard is the only thing standing. And
  // atomkit documents are exactly that: parsed JSON, possibly hostile.
  //
  // (Mutation testing caught this: with a plain `{}` literal, deleting the dynamic
  // guard changed nothing and the suite stayed green.)
  const hostile = JSON.parse('{"__proto__": {"pwned": true}, "constructor": {"pwned": true}, "ok": 1}');
  assert.equal(Object.hasOwn(hostile, '__proto__'), true, 'precondition: JSON.parse makes __proto__ an own property');

  const scope = { a: hostile, k: '__proto__', k2: 'constructor' };
  assert.equal(ev('a[k]', scope), undefined, 'computed __proto__ must not resolve on a parsed document');
  assert.equal(ev('a[k2]', scope), undefined, 'computed constructor must not resolve on a parsed document');
  assert.equal(ev('a["__proto__"]', scope), undefined);
  assert.equal(ev('a["constructor"]', scope), undefined);
  assert.equal(ev('a.ok', scope), 1, 'ordinary own properties still resolve');
  assert.equal(ev('a[k].pwned', scope), undefined, 'and the attacker payload is unreachable');

  // Inherited members are not readable either — only own properties are data.
  const inherited = Object.create({ secret: 'leaked' });
  assert.equal(ev('o.secret', { o: inherited }), undefined, 'inherited property must not resolve');
  assert.equal(ev('o.toString', { o: {} }), undefined, 'Object.prototype member must not resolve');

  // And nothing was polluted along the way.
  assert.equal({}.polluted, undefined);
  ev('a[k]', { a: {}, k: '__proto__' });
  assert.equal({}.polluted, undefined);
}

// ── No reach outside the scope ───────────────────────────────────────────────
{
  assert.equal(ev('process'), undefined);
  assert.equal(ev('globalThis'), undefined);
  assert.equal(ev('window'), undefined);
  assert.equal(ev('this'), undefined, '`this` is not even lexable as an identifier value');
  // Nothing in scope means nothing resolvable.
  assert.equal(ev('state.token', {}), undefined);
}

// ── Denial-of-service caps, each ISOLATED ────────────────────────────────────
// Each input must be rejectable by exactly ONE cap, or the test cannot tell which
// guard is doing the work. (Mutation testing caught this: an input that trips the
// node cap first leaves the source cap untested, and the suite stayed green when
// the source cap was deleted.)
{
  // Source length only: one string literal → 1 AST node, depth 1.
  const longString = `"${'a'.repeat(MAX_SOURCE)}"`;
  assert.ok(longString.length > MAX_SOURCE);
  rejects(longString);
  assert.equal(parseExpr(`"${'a'.repeat(MAX_SOURCE - 10)}"`).k, 'lit', 'a short string still parses');

  // Node count only: a flat sum, depth stays shallow because `+` is left-assoc.
  rejects(Array.from({ length: MAX_NODES + 10 }, (_v, i) => i).join('+'));

  // Depth only: nested parens. Few nodes, deep nesting.
  const deep = '('.repeat(MAX_DEPTH + 2) + '1' + ')'.repeat(MAX_DEPTH + 2);
  assert.ok(deep.length < MAX_SOURCE, 'depth probe must not trip the source cap');
  rejects(deep);

  // Deep-but-legal still works.
  assert.equal(ev('('.repeat(5) + '1 + 1' + ')'.repeat(5)), 2);
  // Nested ternaries are depth-limited too, not just parens.
  rejects(Array.from({ length: MAX_DEPTH + 2 }, () => '1?').join('') + '1' + ':1'.repeat(MAX_DEPTH + 2));
}

// ── Malformed input fails CLOSED (undefined), never throws to the renderer ───
{
  for (const bad of ['', '1 +', ')', '"unterminated', 'a..b', '1 ? 2', 'foo(', '@@@', '{{']) {
    assert.doesNotThrow(() => evalExpr(bad, {}), `evalExpr threw on: ${bad}`);
    assert.equal(evalExpr(bad, {}), undefined, `expected undefined for: ${bad}`);
  }
}

// ── Interpolation ────────────────────────────────────────────────────────────
{
  const scope = { state: { count: 3, on: true }, user: { name: 'Ada' }, xs: [1, 2] };
  assert.equal(interpolate('Hello {{user.name}}', scope), 'Hello Ada');
  assert.equal(interpolate('{{state.count}} items', scope), '3 items');
  // A whole-string expression preserves the raw type — a number stays a number.
  assert.equal(interpolate('{{state.count}}', scope), 3);
  assert.equal(interpolate('{{state.on}}', scope), true);
  assert.deepEqual(interpolate('{{xs}}', scope), [1, 2]);
  // Non-templates pass through untouched.
  assert.equal(interpolate('plain', scope), 'plain');
  assert.equal(interpolate('', scope), '');
  // An unresolvable path interpolates to empty, not the string "undefined".
  assert.equal(interpolate('x{{nope.nope}}y', scope), 'xy');

  // A hostile expression fails CLOSED. As a whole-string expression it yields the
  // raw value `undefined` (which React renders as nothing); embedded in a larger
  // template it stringifies to empty. Both are "nothing" — neither leaks, and
  // neither is the literal text "undefined".
  assert.equal(interpolate('{{a.constructor}}', { a: {} }), undefined);
  assert.equal(interpolate('x{{a.constructor}}y', { a: {} }), 'xy');
  assert.equal(interpolate('x{{a[k]}}y', { a: {}, k: '__proto__' }), 'xy');
}

// ── Fuzz: no input may throw out of evalExpr, or pollute, or hang ────────────
{
  const alphabet = ['a', 'b', '.', '[', ']', '(', ')', '"', "'", '+', '-', '*', '/', '%', '!', '<', '>', '=', '&', '|', '?', ':', ',', '1', '0', ' ', '_', '$', '\\', '{', '}', 'constructor', '__proto__', 'len', 'eval'];
  // Deterministic LCG — a fuzz corpus that cannot vary between runs is reproducible.
  let seed = 0x2545f491;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let ran = 0;
  for (let i = 0; i < 4000; i++) {
    const n = 1 + Math.floor(rnd() * 12);
    let src = '';
    for (let j = 0; j < n; j++) src += alphabet[Math.floor(rnd() * alphabet.length)];
    assert.doesNotThrow(() => evalExpr(src, { a: { b: 1 }, b: [1, 2] }), `evalExpr threw on fuzz input: ${JSON.stringify(src)}`);
    ran++;
  }
  assert.equal(ran, 4000);
  assert.equal({}.polluted, undefined, 'fuzzing polluted Object.prototype');
  assert.equal([].polluted, undefined, 'fuzzing polluted Array.prototype');
}

// ── The AST is data: it can be inspected, and it never holds a function ──────
{
  const ast = parseExpr('state.count > 3 ? upper(name) : "no"');
  assert.equal(ast.k, 'cond');
  const json = JSON.stringify(ast);
  assert.ok(!json.includes('function'), 'AST must be pure data — it is serialized into documents');
  assert.deepEqual(evaluate(JSON.parse(json), { state: { count: 5 }, name: 'ada' }), 'ADA',
    'a round-tripped AST still evaluates — this is what serialize() will store');
}

console.log('✓ expr tests passed (arithmetic, scope, whitelisted calls, prototype guards static+dynamic, no globals, DoS caps, fail-closed parse, interpolation, 4000-case fuzz, AST is pure data)');
