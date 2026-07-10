// English AQL — the surface register that lowers to canonical AQL.
//
// This is a DESUGARING (ADR-008): a string→string pass that runs BEFORE the
// canonical parser. The schema, governance (stripDocument/maskNode), serialize()
// and the conformance suite are untouched. There is one grammar for the machine
// and two registers for the human.
//
//   compileEnglishPage(src) === compilePage(desugar(src))
//
// Design invariants proven in english.test.mjs:
//   1. Every phrase lowers to EXACTLY ONE canonical form.
//   2. No phrase is ambiguous with another (no two patterns unify over their
//      shared length — a distinguishing literal always exists).
//   3. No phrase is ambiguous with a `key=value` (attrs are matched before
//      phrases; holes reject any token containing `=`).
//   4. A bare word that is not a known phrase/flag is an ERROR that names the
//      word and suggests the nearest phrase. It can NEVER become a silent empty
//      prop (the class of bug that `text "x" wobble` was).
//   5. Canonical AQL is a FIXED POINT: desugar(canonical) === canonical.
//   6. resugar(doc) is a right inverse up to semantics:
//      compilePage(desugar(resugar(doc))) deep-equals doc.

import { compilePage, serialize } from '@noidmejs/atomkit';

// ── Tokeniser (quote- + paren-aware — byte-for-byte the canonical rule) ───────
// Mirrors query.ts tokenize(): quoted strings are whole; parentheses suppress
// whitespace splitting so `clamp(2rem,5vw,3.2rem)` and a key=value with a quoted
// value (`bg="#f7f8fa"`) are each a single token.
function tokenize(s) {
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    const ch = s[i];
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
        const c = s[i];
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

// A token → its canonical text form. Quoting is preserved exactly so a value that
// was quoted for a reason (leading zeros, spaces) stays quoted through the lowering.
const emit = (t) => (t.q ? JSON.stringify(t.v) : t.v);

// ── The phrase table ─────────────────────────────────────────────────────────
// A pattern is a sequence of LITERAL words (strings) and HOLES. A hole is
//   H            — one value token (quoted, or a bare non-keyword non-attr word)
//   L            — a list: value ( "and" value )*   → comma-joined
// Every phrase begins with a literal ANCHOR word, so the matcher dispatches on
// the first word. `canon(caps)` returns the single canonical head fragment.
const H = { hole: 'value' };
const L = { hole: 'list' };

// value token → canonical value text (keeps quotes; a list joins on commas)
const val = (t) => emit(t);
const list = (items) => items.map((t) => t.v).join(',');

const PHRASES = [
  // ── Governance — the differentiator. Covered COMPLETELY. ──
  { eng: ['contains', 'personal', 'data'], canon: () => 'pii', field: 'pii' },
  { eng: ['is', 'personal'], canon: () => 'pii' },
  { eng: ['is', 'confidential'], canon: () => 'protected', field: 'protected' },
  { eng: ['is', 'hidden'], canon: () => 'hidden', field: 'hidden' },
  { eng: ['visible', 'to', L], canon: (c) => `roles=${list(c[0])}`, field: 'roles' },
  { eng: ['only', 'for', L], canon: (c) => `roles=${list(c[0])}` },
  { eng: ['needs', H, 'consent'], canon: (c) => `consent=${val(c[0])}`, field: 'consent' },
  { eng: ['tracked', 'as', H], canon: (c) => `track=${val(c[0])}`, field: 'track' },
  { eng: ['logs', 'event', H], canon: (c) => `event=${val(c[0])}`, field: 'event' },
  { eng: ['in', 'category', H], canon: (c) => `category=${val(c[0])}`, field: 'category' },
  { eng: ['tagged', L], canon: (c) => `tags=${list(c[0])}`, field: 'tags' },

  // ── Content + a11y ──
  { eng: ['level', H], canon: (c) => `level=${val(c[0])}`, field: 'level' },
  { eng: ['links', 'to', H], canon: (c) => `href=${val(c[0])}`, field: 'href' },
  { eng: ['opens', 'in', 'a', 'new', 'tab'], canon: () => 'external', field: 'external' },
  { eng: ['labelled', H], canon: (c) => `aria-label=${val(c[0])}`, field: 'aria-label' },
  { eng: ['labeled', H], canon: (c) => `aria-label=${val(c[0])}` },
  { eng: ['described', 'as', H], canon: (c) => `alt=${val(c[0])}`, field: 'alt' },
  { eng: ['with', 'role', H], canon: (c) => `role=${val(c[0])}`, field: 'role' },
  { eng: ['in', 'language', H], canon: (c) => `lang=${val(c[0])}`, field: 'lang' },

  // ── Style — the handful a writer reaches for. The long tail stays key=value. ──
  { eng: ['bold'], canon: () => 'weight=700', field: 'weight700' },
  { eng: ['italic'], canon: () => 'italic=italic', field: 'italic' },
  { eng: ['centered'], canon: () => 'align=center', field: 'aligncenter' },
  { eng: ['centred'], canon: () => 'align=center' },
  { eng: ['uppercase'], canon: () => 'case=uppercase', field: 'upper' },
  { eng: ['lowercase'], canon: () => 'case=lowercase', field: 'lower' },
  { eng: ['size', H], canon: (c) => `size=${val(c[0])}`, field: 'size' },
  { eng: ['in', 'colour', H], canon: (c) => `color=${val(c[0])}`, field: 'color' },
  { eng: ['in', 'color', H], canon: (c) => `color=${val(c[0])}` },
  { eng: ['width', H], canon: (c) => `w=${val(c[0])}`, field: 'w' },
  { eng: ['height', H], canon: (c) => `h=${val(c[0])}`, field: 'h' },
  { eng: ['max', 'width', H], canon: (c) => `max-w=${val(c[0])}`, field: 'max-w' },
  { eng: ['gap', H], canon: (c) => `gap=${val(c[0])}`, field: 'gap' },
  { eng: ['rounded', H], canon: (c) => `radius=${val(c[0])}`, field: 'radius' },
  { eng: ['padded', H], canon: (c) => `pad=${val(c[0])}`, field: 'pad' },

  // ── Data binding (developer register; still English, still unambiguous) ──
  { eng: ['loads', 'from', H], canon: (c) => `api=${val(c[0])}`, field: 'api' },
  { eng: ['at', 'path', H], canon: (c) => `path=${val(c[0])}`, field: 'path' },
  { eng: ['via', H], canon: (c) => `method=${val(c[0])}`, field: 'method' },
  { eng: ['bound', 'to', H], canon: (c) => `bind=${val(c[0])}`, field: 'bind' },
].sort((a, b) => b.eng.length - a.eng.length);

// Canonical flags that pass straight through (both registers accept them).
const FLAGS = new Set(['pii', 'protected', 'hidden', 'external']);

// Words reserved for future interactivity (gate: state/on/when/each). A hole may
// never absorb one, and a bare occurrence is an error — never a silent prop.
const RESERVED = new Set(['state', 'on', 'when', 'each', 'if', 'else', 'for', 'action', 'do']);

// The CLOSED vocabulary: every literal word any phrase uses. A hole cannot absorb
// a vocabulary word — this is the single rule that stops "reads like English" from
// decaying into "unguessable which English works" (the AppleScript failure).
const KEYWORDS = new Set([
  ...PHRASES.flatMap((p) => p.eng.filter((x) => typeof x === 'string')),
  ...FLAGS, ...RESERVED, 'and',
]);

// Human-facing phrase strings, for error suggestions.
const PHRASE_LABELS = PHRASES.map((p) => p.eng.map((x) => (typeof x === 'string' ? x : x.hole === 'list' ? '<list>' : '<value>')).join(' '));
const OPENERS = new Set(PHRASES.map((p) => p.eng[0]).filter((x) => typeof x === 'string'));

// ── Levenshtein, for "did you mean" ──────────────────────────────────────────
function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
// Nearest phrase label (by its first word) to an unknown word.
function nearest(word) {
  let best = null, bestD = Infinity;
  for (const label of PHRASE_LABELS) {
    const opener = label.split(' ')[0];
    const d = lev(word.toLowerCase(), opener.toLowerCase());
    if (d < bestD) { bestD = d; best = label; }
  }
  // also consider single-token flags
  for (const f of FLAGS) {
    const d = lev(word.toLowerCase(), f);
    if (d < bestD) { bestD = d; best = f; }
  }
  const threshold = Math.max(1, Math.ceil(word.length / 2));
  return bestD <= threshold ? best : null;
}

export class AqlEnglishError extends Error {
  constructor(message, line) {
    super(line ? `AQL (line ${line}): ${message}` : `AQL: ${message}`);
    this.name = 'AqlEnglishError';
    this.line = line;
  }
}

// A hole accepts a token iff it is a quoted string, OR a bare word that is not a
// keyword, not a `key=value`, and not empty. This is what makes holes unable to
// swallow the following phrase or a canonical attribute.
function isHoleValue(t) {
  if (t.q) return true;
  if (!t.v) return false;
  if (t.v.includes('=')) return false;
  if (KEYWORDS.has(t.v)) return false;
  if (t.v === '{' || t.v === '}') return false;
  return true;
}

// Try to match a phrase anchored at toks[i]. Returns { phrase, caps, next } or null.
function matchAt(toks, i) {
  for (const p of PHRASES) {
    if (p.eng[0] !== toks[i]?.v || toks[i]?.q) continue; // anchor is a bare literal
    const caps = [];
    let k = i, ok = true;
    for (const part of p.eng) {
      const t = toks[k];
      if (t === undefined) { ok = false; break; }
      if (typeof part === 'string') {
        if (t.q || t.v !== part) { ok = false; break; }
        k++;
      } else if (part.hole === 'value') {
        if (!isHoleValue(t)) { ok = false; break; }
        caps.push(t); k++;
      } else { // list
        if (!isHoleValue(t)) { ok = false; break; }
        const items = [t]; k++;
        while (toks[k] && !toks[k].q && toks[k].v === 'and') {
          const nxt = toks[k + 1];
          if (!nxt || !isHoleValue(nxt)) { ok = false; break; }
          items.push(nxt); k += 2;
        }
        if (!ok) break;
        caps.push(items);
      }
    }
    if (ok) return { phrase: p, caps, next: k };
  }
  return null;
}

// When a token OPENS a phrase but the full phrase did not match, say precisely what
// was expected — a product-quality error instead of "don't understand 'is'".
function partialDiagnostic(toks, i, line) {
  const candidates = PHRASES.filter((p) => p.eng[0] === toks[i].v);
  let deepest = null, deepestK = -1;
  for (const p of candidates) {
    let k = i, depth = 0;
    for (const part of p.eng) {
      const t = toks[k];
      if (typeof part === 'string') { if (!t || t.q || t.v !== part) break; }
      else if (!t || !isHoleValue(t)) break;
      k++; depth++;
    }
    if (depth > deepestK) { deepestK = depth; deepest = p; }
  }
  const part = deepest.eng[deepestK];
  const got = toks[i + deepestK];
  const gotStr = got ? (got.q ? `"${got.v}"` : `"${got.v}"`) : 'the end of the line';
  if (typeof part === 'string') {
    const alts = [...new Set(candidates.map((p) => p.eng[deepestK]).filter((x) => typeof x === 'string'))];
    return new AqlEnglishError(
      `after "${toks.slice(i, i + deepestK).map((t) => t.v).join(' ')}" I expected ${alts.map((a) => `"${a}"`).join(' or ')}, but got ${gotStr}.`,
      line,
    );
  }
  // expected a value
  const why = got && KEYWORDS.has(got.v)
    ? ` "${got.v}" is itself a keyword — if you meant it literally, quote it: ${toks[i].v} "${got.v}".`
    : '';
  return new AqlEnglishError(
    `"${toks.slice(i, i + deepestK).map((t) => t.v).join(' ')}" needs a value after it, but got ${gotStr}.${why}`,
    line,
  );
}

// ── Desugar one head (atom line) ─────────────────────────────────────────────
function desugarHead(head, line) {
  const toks = tokenize(head);
  const out = [];
  let i = 0;
  if (i < toks.length) { out.push(emit(toks[i])); i++; }              // atom type
  if (i < toks.length && toks[i].q) { out.push(emit(toks[i])); i++; } // optional text slot

  while (i < toks.length) {
    const t = toks[i];

    // A stray quoted string in attribute position: in canonical this silently
    // becomes props[<contents>]="". Refuse it.
    if (t.q) {
      throw new AqlEnglishError(
        `unexpected quoted text "${t.v}". Text belongs right after the atom (e.g. text "…"); ` +
        `everything after it is a phrase or a key=value.`,
        line,
      );
    }
    // Canonical passthrough: a key=value is always accepted (mixed input is fine).
    if (t.v.includes('=')) { out.push(t.v); i++; continue; }

    // A phrase.
    const m = matchAt(toks, i);
    if (m) { out.push(m.phrase.canon(m.caps)); i = m.next; continue; }

    // Opened a known phrase but didn't complete it → precise diagnostic.
    if (OPENERS.has(t.v)) throw partialDiagnostic(toks, i, line);

    // A canonical flag.
    if (FLAGS.has(t.v)) { out.push(t.v); i++; continue; }

    // A reserved word used bare.
    if (RESERVED.has(t.v)) {
      throw new AqlEnglishError(
        `"${t.v}" is a reserved word (interactivity is not enabled). If you meant it literally, quote it.`,
        line,
      );
    }

    // Unknown bare word — the bug we exist to kill. Never a silent prop.
    const guess = nearest(t.v);
    throw new AqlEnglishError(
      `I don't understand "${t.v}".` +
      (guess ? ` Did you mean "${guess}"?` : ` It is not a phrase I know or a key=value.`),
      line,
    );
  }
  return out.join(' ');
}

// A `//` comment outside quotes, at start or after whitespace (canonical's rule).
function stripComment(line) {
  let inq = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inq) { if (c === inq) inq = ''; continue; }
    if (c === '"' || c === "'") { inq = c; continue; }
    if (c === '/' && line[i + 1] === '/' && (i === 0 || /\s/.test(line[i - 1]))) {
      return { head: line.slice(0, i), comment: line.slice(i) };
    }
  }
  return { head: line, comment: '' };
}

/**
 * Desugar English AQL → canonical AQL. Line-oriented (like Gherkin): one node per
 * line; a block opens with a trailing `{` and closes with a lone `}`. Canonical
 * AQL passes through unchanged, so the two registers may be mixed.
 */
export function desugar(src) {
  return src
    .split('\n')
    .map((raw, idx) => {
      const line = idx + 1;
      const indent = raw.slice(0, raw.length - raw.trimStart().length);
      const { head: h, comment } = stripComment(raw);
      const trimmed = h.trim();
      if (!trimmed) return raw;                    // blank / comment-only
      const openBlock = trimmed.endsWith('{');
      let body = openBlock ? trimmed.slice(0, -1).trim() : trimmed;
      if (body === '}' || body === '') return raw; // block close / lone comment
      if (/^(page|widget)\b/.test(body)) return raw; // headers stay canonical
      // Guard: a `{` that is not a trailing block-open means an inline block.
      const inlineBrace = tokenize(body).some((t) => !t.q && (t.v.includes('{') || t.v.includes('}')));
      if (inlineBrace) {
        throw new AqlEnglishError(
          `unexpected "{" or "}". In English AQL each block goes on its own line — put "{" at the end of the line and "}" on a line by itself.`,
          line,
        );
      }
      const lowered = desugarHead(body, line);
      return indent + lowered + (openBlock ? ' {' : '') + (comment ? ' ' + comment.trim() : '');
    })
    .join('\n');
}

/** Compile English AQL straight to a BuilderDocument. */
export function compileEnglishPage(src) {
  return compilePage(desugar(src));
}

// ── Resugar (document → English) ─────────────────────────────────────────────
// The right inverse. Implemented as serialize() (the PROVEN inverse of parse) plus
// a token-level SUGAR pass that rewrites canonical heads to their preferred English
// spelling. Because every rewrite desugars back to the exact canonical token it
// came from, compilePage(desugar(resugar(doc))) deep-equals doc.

// canonical bare-flag → English
const FLAG_SUGAR = {
  pii: 'contains personal data',
  protected: 'is confidential',
  hidden: 'is hidden',
  external: 'opens in a new tab',
};
// canonical key → English builder (value already a token's text)
const KEY_SUGAR = {
  roles: (v) => `visible to ${v.split(',').join(' and ')}`,
  consent: (v) => `needs ${v} consent`,
  track: (v) => `tracked as ${v}`,
  event: (v) => `logs event ${v}`,
  category: (v) => `in category ${v}`,
  tags: (v) => `tagged ${v.split(',').join(' and ')}`,
  level: (v) => `level ${v}`,
  href: (v) => `links to ${v}`,
  'aria-label': (v) => `labelled ${v}`,
  alt: (v) => `described as ${v}`,
  role: (v) => `with role ${v}`,
  lang: (v) => `in language ${v}`,
  size: (v) => `size ${v}`,
  color: (v) => `in colour ${v}`,
  w: (v) => `width ${v}`,
  h: (v) => `height ${v}`,
  'max-w': (v) => `max width ${v}`,
  gap: (v) => `gap ${v}`,
  radius: (v) => `rounded ${v}`,
  pad: (v) => `padded ${v}`,
  api: (v) => `loads from ${v}`,
  path: (v) => `at path ${v}`,
  method: (v) => `via ${v}`,
  bind: (v) => `bound to ${v}`,
};

function sugarHead(head) {
  const toks = tokenize(head);
  const out = [];
  let i = 0;
  if (i < toks.length) { out.push(emit(toks[i])); i++; }
  if (i < toks.length && toks[i].q) { out.push(emit(toks[i])); i++; }
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t.q) { out.push(emit(t)); continue; }
    const eq = t.v.indexOf('=');
    if (eq < 0) {
      out.push(FLAG_SUGAR[t.v] ?? t.v);
      continue;
    }
    const key = t.v.slice(0, eq);
    const rawVal = t.v.slice(eq + 1);
    // special-cased whole-token spellings
    if (key === 'weight' && rawVal === '700') { out.push('bold'); continue; }
    if (key === 'align' && rawVal === 'center') { out.push('centered'); continue; }
    if (key === 'italic' && rawVal === 'italic') { out.push('italic'); continue; }
    if (key === 'case' && rawVal === 'uppercase') { out.push('uppercase'); continue; }
    if (key === 'case' && rawVal === 'lowercase') { out.push('lowercase'); continue; }
    const fn = KEY_SUGAR[key];
    out.push(fn ? fn(rawVal) : t.v);
  }
  return out.join(' ');
}

/** Document → English AQL. compilePage(desugar(resugar(doc))) deep-equals doc. */
export function resugar(doc) {
  return serialize(doc)
    .split('\n')
    .map((raw) => {
      const indent = raw.slice(0, raw.length - raw.trimStart().length);
      const trimmed = raw.trim();
      if (!trimmed || trimmed === '}' || /^(page|widget)\b/.test(trimmed)) return raw;
      const openBlock = trimmed.endsWith('{');
      const body = openBlock ? trimmed.slice(0, -1).trim() : trimmed;
      return indent + sugarHead(body) + (openBlock ? ' {' : '');
    })
    .join('\n');
}

// ── Ambiguity checker (run in the test over the whole table) ─────────────────
// Two patterns are DISTINGUISHABLE iff a literal position within their shared
// length disagrees. If not, some input matches both → ambiguous → the table is
// rejected. Holes unify with anything, which is exactly the danger to detect.
export function ambiguousPairs() {
  const pat = (p) => p.eng.map((x) => (typeof x === 'string' ? x : '\0HOLE'));
  const bad = [];
  for (let a = 0; a < PHRASES.length; a++) {
    for (let b = a + 1; b < PHRASES.length; b++) {
      const pa = pat(PHRASES[a]), pb = pat(PHRASES[b]);
      const m = Math.min(pa.length, pb.length);
      let distinguishable = false;
      for (let k = 0; k < m; k++) {
        if (pa[k] !== '\0HOLE' && pb[k] !== '\0HOLE' && pa[k] !== pb[k]) { distinguishable = true; break; }
      }
      if (!distinguishable) bad.push([PHRASE_LABELS[a], PHRASE_LABELS[b]]);
    }
  }
  return bad;
}

export { PHRASES, PHRASE_LABELS, KEYWORDS, tokenize };
