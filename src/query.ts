// AQL — the Atomkit Query Language.
//
// A compact, line-oriented language that compiles to a BuilderDocument. It is
// deterministic (a real parser, not an LLM) AND designed to be the target an LLM
// generates: `systemPrompt()` documents the grammar + atoms for a model, and
// `generate()` runs a host-provided completion, then compiles + validates the
// output — so an AI can "build pages/widgets" but the result is always a safe,
// schema-valid document, never arbitrary code.
//
//   page "Careers" desc="Join us" {
//     box as=section pad-y=80 bg="var(--soft)" {
//       box dir=column gap=16 items=center max-w=720 align=center {
//         text "We're hiring" as=span color="#E31936" size=12px weight=700 case=uppercase
//         heading "Build with us" level=1 size=clamp(2rem,5vw,3.4rem) color="#0b1220"
//         text "Long copy…" color="#525c6b" max-w=52ch
//         button "View roles" href=#careers variant=primary track=cta_top aria-label="View open roles"
//         text "a@b.com" pii              // masked unless the viewer may see PII
//         image src=/media/x.webp alt="Team" radius=16 md:max-w=480px
//       }
//     }
//   }
import type { BuilderNode, BuilderDocument, StyleProps, DataBinding } from './schema.js';
import { parseDocument } from './schema.js';

// ── Attribute → field maps ───────────────────────────────────────────────────
const STYLE_KEYS: Record<string, keyof StyleProps> = {
  color: 'color', bg: 'background', background: 'background', gradient: 'gradient',
  'bg-color': 'backgroundColor', 'bg-image': 'backgroundImage', 'bg-size': 'backgroundSize',
  'bg-pos': 'backgroundPosition', 'bg-repeat': 'backgroundRepeat',
  pad: 'padding', 'pad-x': 'paddingX', 'pad-y': 'paddingY',
  m: 'margin', 'm-x': 'marginX', 'm-y': 'marginY', gap: 'gap',
  size: 'fontSize', weight: 'fontWeight', font: 'fontFamily', lh: 'lineHeight', ls: 'letterSpacing',
  align: 'textAlign', case: 'textTransform', italic: 'fontStyle', decoration: 'textDecoration',
  w: 'width', h: 'height', 'max-w': 'maxWidth', 'min-w': 'minWidth', 'max-h': 'maxHeight', 'min-h': 'minHeight',
  radius: 'borderRadius', border: 'border', 'border-color': 'borderColor', 'border-width': 'borderWidth',
  'border-style': 'borderStyle', shadow: 'boxShadow', opacity: 'opacity', filter: 'filter',
  transform: 'transform', transition: 'transition',
  display: 'display', dir: 'flexDirection', justify: 'justifyContent', items: 'alignItems', wrap: 'flexWrap',
  pos: 'position', top: 'top', right: 'right', bottom: 'bottom', left: 'left', z: 'zIndex',
  'grid-cols': 'gridTemplateColumns', aspect: 'aspectRatio', overflow: 'overflow',
};
const A11Y_KEYS: Record<string, string> = {
  role: 'role', 'aria-label': 'ariaLabel', 'a11y-label': 'ariaLabel', 'aria-hidden': 'ariaHidden',
  'aria-describedby': 'ariaDescribedby', tabindex: 'tabIndex', lang: 'lang', alt: 'alt',
};
const BREAKPOINTS = new Set(['sm', 'md', 'lg']);
const NODE_FLAGS = new Set(['protected', 'pii', 'external', 'hidden']);

// Bare values are coerced to number/boolean; a QUOTED value is always kept as a
// string. Without that escape hatch `zip="02115"` became 2115 and `ver="1.10"`
// became 1.1 — leading/trailing zeros destroyed with no way for an author to
// opt out. Quoting is the escape hatch, and serialize() re-quotes accordingly.
function coerce(v: string, quoted = false): string | number | boolean {
  if (quoted) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// ── Tokeniser (quote- + paren-aware) ─────────────────────────────────────────
interface Tok { q: boolean; v: string }
function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i]!)) i++;
    if (i >= n) break;
    const ch = s[i]!;
    if (ch === '"' || ch === "'") {
      let buf = '';
      i++;
      while (i < n && s[i] !== ch) {
        if (s[i] === '\\' && i + 1 < n) { buf += s[i + 1]; i += 2; } else { buf += s[i]; i++; }
      }
      i++;
      out.push({ q: true, v: buf });
    } else {
      let depth = 0;
      let inq = '';
      let buf = '';
      while (i < n) {
        const c = s[i]!;
        if (inq) { buf += c; if (c === inq) inq = ''; i++; continue; }
        if (c === '"' || c === "'") { inq = c; buf += c; i++; continue; }
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (/\s/.test(c) && depth === 0) break;
        buf += c;
        i++;
      }
      out.push({ q: false, v: buf });
    }
  }
  return out;
}

function unquote(v: string): string {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ── Raw tree (line parser) ───────────────────────────────────────────────────
interface RawNode { head: string; children: RawNode[] }

// Char-level parser: a block opens with { (on the head's line OR inline) and
// closes with }; // starts a comment. Quote-aware throughout, so inline
// `item { text "x" }`, multi-line blocks, trailing comments, and https:// URLs
// all parse correctly.
function parseRaw(src: string): RawNode[] {
  const n = src.length;
  let i = 0;
  const skipWs = (): void => {
    while (i < n) {
      const c = src[i]!;
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      break;
    }
  };
  const readHead = (): string => {
    let buf = '';
    let inq = '';
    while (i < n) {
      const c = src[i]!;
      if (inq) { buf += c; if (c === inq) inq = ''; i++; continue; }
      if (c === '"' || c === "'") { inq = c; buf += c; i++; continue; }
      if (c === '\n' || c === '{' || c === '}') break;
      // `//` starts a trailing comment ONLY at head start or after whitespace — so
      // an unquoted URL value (`href=https://…`) keeps its `//` instead of being
      // truncated and having the rest of the line swallowed as a comment.
      if (c === '/' && src[i + 1] === '/' && (buf === '' || /\s$/.test(buf))) break;
      buf += c;
      i++;
    }
    return buf.trim();
  };
  const MAX_DEPTH = 32;
  const parseStatements = (depth: number): RawNode[] => {
    if (depth > MAX_DEPTH) throw new Error(`AQL nesting too deep (> ${MAX_DEPTH})`);
    const out: RawNode[] = [];
    for (;;) {
      skipWs();
      if (i >= n || src[i] === '}') break;
      const head = readHead();
      const node: RawNode = { head, children: [] };
      skipWs();
      if (i < n && src[i] === '{') {
        i++;
        node.children = parseStatements(depth + 1);
        skipWs();
        if (i < n && src[i] === '}') i++;
      }
      if (head) out.push(node);
    }
    return out;
  };
  return parseStatements(0);
}

// ── Program model ────────────────────────────────────────────────────────────
export interface AqlPage { title: string; description?: string; document: BuilderDocument }
export interface AqlWidget { name: string; node: BuilderNode }
export interface AqlProgram { pages: AqlPage[]; widgets: AqlWidget[] }

function applyAttr(
  node: BuilderNode,
  rawKey: string,
  rawVal: string | undefined,
  isFlag: boolean,
): void {
  // breakpoint prefix, e.g. md:size
  let bp: 'sm' | 'md' | 'lg' | undefined;
  let key = rawKey;
  const colon = rawKey.indexOf(':');
  if (colon > 0 && BREAKPOINTS.has(rawKey.slice(0, colon))) {
    bp = rawKey.slice(0, colon) as 'sm' | 'md' | 'lg';
    key = rawKey.slice(colon + 1);
  }

  if (isFlag && NODE_FLAGS.has(key)) {
    if (key === 'hidden') node.hidden = true;
    else if (key === 'external') (node.props ??= {}).external = true;
    else {
      node.meta ??= {};
      node.meta.security ??= {};
      if (key === 'protected') node.meta.security.protected = true;
      if (key === 'pii') node.meta.security.pii = true;
    }
    return;
  }
  const quoted = rawVal !== undefined && /^["']/.test(rawVal);
  const value = rawVal === undefined ? '' : unquote(rawVal);

  // Style (base or per-breakpoint)
  const styleKey = STYLE_KEYS[key];
  if (styleKey) {
    node.style ??= {};
    let target: StyleProps = node.style;
    if (bp) {
      node.style.responsive ??= {};
      node.style.responsive[bp] ??= {};
      target = node.style.responsive[bp]!;
    }
    (target as Record<string, unknown>)[styleKey] = coerce(value, quoted);
    return;
  }
  // a11y
  const a11yKey = A11Y_KEYS[key];
  if (a11yKey) {
    node.a11y ??= {};
    (node.a11y as Record<string, unknown>)[a11yKey] = coerce(value, quoted);
    return;
  }
  // meta / analytics / security / tags
  if (key === 'track') { node.meta ??= {}; (node.meta.analytics ??= {}).id = value; return; }
  if (key === 'event') { node.meta ??= {}; (node.meta.analytics ??= {}).event = value; return; }
  if (key === 'category') { node.meta ??= {}; (node.meta.analytics ??= {}).category = value; return; }
  if (key === 'tags') { node.meta ??= {}; node.meta.tags = value.split(',').map((s) => s.trim()).filter(Boolean); return; }
  if (key === 'roles') { node.meta ??= {}; (node.meta.security ??= {}).roles = value.split(',').map((s) => s.trim()).filter(Boolean); return; }
  if (key === 'consent') { node.meta ??= {}; (node.meta.security ??= {}).consentCategory = value; return; }
  // data binding
  if (key === 'api') {
    node.data ??= { source: { kind: 'api', url: value } };
    if (node.data.source.kind === 'api') node.data.source.url = value;
    else node.data.source = { kind: 'api', url: value };
    return;
  }
  if (key === 'path' || key === 'data-path') {
    node.data ??= { source: { kind: 'api', url: '' } };
    if (node.data.source.kind === 'api') node.data.source.path = value;
    return;
  }
  if (key === 'method') {
    node.data ??= { source: { kind: 'api', url: '' } };
    if (node.data.source.kind === 'api' && (value === 'GET' || value === 'POST')) node.data.source.method = value;
    return;
  }
  if (key === 'bind') { node.data ??= { source: { kind: 'static' } }; node.data.bindTo = value; return; }
  // everything else → props
  (node.props ??= {})[key] = coerce(value, quoted);
}

interface CompileCtx { count: number }
const MAX_NODES = 2000;

// Deterministic, selector-safe id from the node's tree path (e.g. "0-1-2") —
// stable across recompiles and safe to interpolate into a CSS class (kills the
// old mutable module counter and the "id → .ak-<id> selector" injection risk).
function compileNode(raw: RawNode, path: number[], ctx: CompileCtx): BuilderNode {
  ctx.count += 1;
  if (ctx.count > MAX_NODES) throw new Error(`AQL document too large (> ${MAX_NODES} nodes)`);
  const toks = tokenize(raw.head);
  const type = toks[0]?.v ?? 'box';
  const node: BuilderNode = { id: path.length ? path.join('-') : '0', type };
  let idx = 1;
  if (toks[idx]?.q) {
    (node.props ??= {}).text = toks[idx]!.v;
    idx++;
  }
  for (let t = idx; t < toks.length; t++) {
    const tok = toks[t]!;
    const eq = tok.v.indexOf('=');
    if (eq > 0 && !tok.q) applyAttr(node, tok.v.slice(0, eq), tok.v.slice(eq + 1), false);
    else applyAttr(node, tok.v, undefined, true);
  }
  if (raw.children.length) node.children = raw.children.map((c, i) => compileNode(c, [...path, i], ctx));
  return node;
}

function readHeader(head: string): { keyword: string; title: string; attrs: Tok[] } {
  const toks = tokenize(head);
  return { keyword: toks[0]?.v ?? '', title: toks[1]?.q ? toks[1]!.v : '', attrs: toks.slice(2) };
}

/** Parse AQL source into a program of pages + reusable widgets. */
export function parse(src: string): AqlProgram {
  if (src.length > 100000) throw new Error('AQL source too large (> 100000 chars)');
  const ctx: CompileCtx = { count: 0 };
  const roots = parseRaw(src);
  const pages: AqlPage[] = [];
  const widgets: AqlWidget[] = [];
  const loose: RawNode[] = [];

  for (const r of roots) {
    const kw = tokenize(r.head)[0]?.v;
    if (kw === 'page') {
      const { title, attrs } = readHeader(r.head);
      let description: string | undefined;
      for (const a of attrs) {
        const eq = a.v.indexOf('=');
        if (eq > 0 && a.v.slice(0, eq) === 'desc') description = unquote(a.v.slice(eq + 1));
      }
      const nodes = r.children.map((c, i) => compileNode(c, [i], ctx));
      pages.push({
        title: title || 'Untitled',
        description,
        document: { version: 1, root: nodes, meta: { title: title || undefined, description } },
      });
    } else if (kw === 'widget') {
      const { title } = readHeader(r.head);
      const kids = r.children.map((c, i) => compileNode(c, [i], ctx));
      const node =
        kids.length === 1
          ? kids[0]!
          : { id: 'root', type: 'box', children: kids };
      widgets.push({ name: title || 'widget', node });
    } else {
      loose.push(r);
    }
  }
  if (loose.length) {
    pages.unshift({ title: 'Untitled', document: { version: 1, root: loose.map((c, i) => compileNode(c, [i], ctx)) } });
  }
  // Validate every produced document (throws on a malformed tree).
  for (const p of pages) parseDocument(p.document);
  return { pages, widgets };
}

/** Compile AQL to a single BuilderDocument (the first page, or the loose nodes). */
export function compilePage(src: string): BuilderDocument {
  const prog = parse(src);
  return prog.pages[0]?.document ?? { version: 1, root: [] };
}

// ── Serialise (document → AQL) ───────────────────────────────────────────────
const STYLE_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(STYLE_KEYS).map(([k, v]) => [v, k]),
);
// First spelling wins, so ariaLabel → "aria-label" (not the "a11y-label" alias).
const A11Y_TO_KEY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(A11Y_KEYS)) if (!(v in out)) out[v] = k;
  return out;
})();

// A bare value is re-coerced on parse, so a STRING that looks like a number or a
// boolean must be re-quoted or the round trip changes its type ("02115" → 2115).
function fmtVal(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s === '' || /\s|=|{|}|"|'|\/\//.test(s)) return JSON.stringify(s);
  if (s === 'true' || s === 'false' || /^-?\d+(\.\d+)?$/.test(s)) return JSON.stringify(s);
  return s;
}

/**
 * Emit every field `applyAttr` can parse. serialize() is the inverse of parse():
 * anything dropped here silently downgrades governance on a doc→AQL→doc round
 * trip (a roles/consent/hidden node would come back public), and the visual
 * editor sits on exactly this path.
 */
function serializeNode(node: BuilderNode, indent: string): string {
  const parts: string[] = [node.type];
  if (node.props?.text != null) parts.push(JSON.stringify(String(node.props.text)));
  for (const [k, v] of Object.entries(node.props ?? {})) {
    if (k === 'text') continue;
    if (k === 'external' && v === true) { parts.push('external'); continue; }
    parts.push(`${k}=${fmtVal(v)}`);
  }
  for (const [k, v] of Object.entries(node.style ?? {})) {
    if (k === 'responsive') continue;
    const key = STYLE_TO_KEY[k] ?? k;
    parts.push(`${key}=${fmtVal(v)}`);
  }
  const r = node.style?.responsive;
  if (r) for (const bp of ['sm', 'md', 'lg'] as const) {
    for (const [k, v] of Object.entries(r[bp] ?? {})) parts.push(`${bp}:${STYLE_TO_KEY[k] ?? k}=${fmtVal(v)}`);
  }
  // a11y — every A11yProps field, not just aria-label/role.
  for (const [field, v] of Object.entries(node.a11y ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    const key = A11Y_TO_KEY[field];
    if (key) parts.push(`${key}=${fmtVal(v)}`);
  }
  // data binding — api/path/method/bind.
  const src = node.data?.source;
  if (src?.kind === 'api') {
    if (src.url) parts.push(`api=${fmtVal(src.url)}`);
    if (src.path) parts.push(`path=${fmtVal(src.path)}`);
    if (src.method && src.method !== 'GET') parts.push(`method=${src.method}`);
  }
  if (node.data?.bindTo) parts.push(`bind=${fmtVal(node.data.bindTo)}`);
  // meta — analytics, tags, security.
  const an = node.meta?.analytics;
  if (an?.id) parts.push(`track=${fmtVal(an.id)}`);
  if (an?.event) parts.push(`event=${fmtVal(an.event)}`);
  if (an?.category) parts.push(`category=${fmtVal(an.category)}`);
  if (node.meta?.tags?.length) parts.push(`tags=${fmtVal(node.meta.tags.join(','))}`);
  const sec = node.meta?.security;
  if (sec?.roles?.length) parts.push(`roles=${fmtVal(sec.roles.join(','))}`);
  if (sec?.consentCategory) parts.push(`consent=${fmtVal(sec.consentCategory)}`);
  if (sec?.protected) parts.push('protected');
  if (sec?.pii) parts.push('pii');
  if (node.hidden) parts.push('hidden');
  const head = parts.join(' ');
  if (node.children?.length) {
    const inner = node.children.map((c) => serializeNode(c, indent + '  ')).join('\n');
    return `${indent}${head} {\n${inner}\n${indent}}`;
  }
  return `${indent}${head}`;
}
// Document fields AQL has no syntax for. Silently dropping them is how a
// round trip used to lose data; refuse instead, so a caller (e.g. the editor's
// save path) finds out at write time rather than shipping a degraded document.
function assertRepresentable(node: BuilderNode): void {
  const at = `node "${node.id}" (${node.type})`;
  const src = node.data?.source;
  if (src?.kind === 'static' && src.value !== undefined) throw new Error(`serialize: ${at} has a static data value, which AQL cannot express`);
  if (src?.kind === 'api' && (src.headers || src.body || src.ttl !== undefined)) throw new Error(`serialize: ${at} has api headers/body/ttl, which AQL cannot express`);
  if (node.meta?.analytics?.props) throw new Error(`serialize: ${at} has analytics props, which AQL cannot express`);
  if (node.meta?.note !== undefined) throw new Error(`serialize: ${at} has meta.note, which AQL cannot express`);
  node.children?.forEach(assertRepresentable);
}

/** Document → AQL. The exact inverse of `parse()`: `parse(serialize(doc))` deep-
 *  equals `doc`. Throws on any field AQL cannot express rather than dropping it. */
export function serialize(doc: BuilderDocument): string {
  doc.root.forEach(assertRepresentable);
  const title = doc.meta?.title ?? 'Untitled';
  const desc = doc.meta?.description;
  const header = `page ${JSON.stringify(title)}${desc ? ` desc=${JSON.stringify(desc)}` : ''}`;
  const inner = doc.root.map((n) => serializeNode(n, '  ')).join('\n');
  return `${header} {\n${inner}\n}`;
}
