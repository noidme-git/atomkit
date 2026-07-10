// Regression suite for the v0.6.0 audit fixes.
//
// Every assertion here reproduced a REAL defect before its fix. The previous
// tests passed while all of these were broken, because they asserted on the
// shape of the output (a CSS string was produced, a string prop was masked)
// rather than on the guarantee (the override wins; nothing sensitive escapes).

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Render, defaultAtoms, compilePage, serialize, stripDocument, maskNode,
  isNodeVisible, safeDim, PII_MASK, PII_MASK_LABEL,
} from '../dist/index.js';

const html = (doc, context = {}) => renderToStaticMarkup(createElement(Render, { document: doc, registry: defaultAtoms, context }));
const styleOf = (h) => (h.match(/style="([^"]*)"/) ?? [, ''])[1];

// ── 1. Dimension props bypassed the style sanitiser ──────────────────────────
// width/gutter/min/height are node.props, so they never went through clean().
// An authored value could inject `position:fixed` (clickjacking overlay) or
// `url()` (CSS exfiltration) — the exact vectors SECURITY.md claims are dropped.
{
  const inject = styleOf(html(compilePage('page "x" {\n  container width="100px;position:fixed;top:0" { text "hi" }\n}')));
  assert.ok(!/position\s*:\s*fixed/.test(inject), 'container width cannot inject position:fixed');

  const exfil = styleOf(html(compilePage('page "x" {\n  container gutter="url(https://evil/?leak)" { text "hi" }\n}')));
  assert.ok(!/url\(/.test(exfil), 'container gutter cannot inject url()');

  const grid = styleOf(html(compilePage('page "x" {\n  grid min="1fr);position:fixed" { text "a" }\n}')));
  assert.ok(!/position\s*:\s*fixed/.test(grid), 'grid min is sanitised before reaching minmax()');

  const spacer = styleOf(html(compilePage('page "x" {\n  spacer height="1px;position:fixed"\n}')));
  assert.ok(!/fixed/.test(spacer), 'spacer height is sanitised');

  const section = styleOf(html(compilePage('page "x" {\n  section width="1px;position:fixed" { text "a" }\n}')));
  assert.ok(!/fixed/.test(section), 'section width is sanitised');

  // …and legitimate values still work.
  assert.ok(styleOf(html(compilePage('page "x" {\n  container width=720px { text "hi" }\n}'))).includes('max-width:720px'), 'legit width survives');
  assert.equal(safeDim('clamp(1rem,2vw,3rem)', 'x'), 'clamp(1rem,2vw,3rem)', 'safeDim keeps a real CSS value');
  assert.equal(safeDim('1px;position:fixed', 'FALLBACK'), 'FALLBACK', 'safeDim rejects rather than repairs');
  assert.equal(safeDim('a'.repeat(65), 'FALLBACK'), 'FALLBACK', 'safeDim caps length');
}

// ── 2. PII masking was by prop NAME + string type, not by value ──────────────
// Numbers, unlisted prop names, custom-atom props and the video atom's `url`
// all reached the client through stripDocument — the "end-to-end guarantee".
{
  const doc = (props, type = 'text') => ({ version: 1, root: [{ id: 'n', type, props, meta: { security: { pii: true } } }] });
  const strip = (d) => stripDocument(d, { canViewPii: false }).root[0];

  const nums = strip(doc({ text: 'hi', value: 250000, phone: '555-123-4567', ok: true }));
  assert.equal(nums.props.value, PII_MASK, 'numeric PII is masked (was passed through verbatim)');
  assert.equal(nums.props.phone, PII_MASK, 'a prop outside the old CONTENT_PROPS list is masked');
  assert.equal(nums.props.ok, PII_MASK, 'boolean PII is masked');

  const vid = strip(doc({ url: 'https://secret.internal/PRIVATE-ID', title: 't' }, 'video'));
  assert.equal(vid.props.url, undefined, 'a pii video url is dropped (the URL is the identifier)');

  // Custom atoms are the headline extension point; their props must fail closed.
  const custom = strip(doc({ value: 91500, email: 'a@b.com' }, 'stat'));
  assert.equal(custom.props.value, PII_MASK);
  assert.equal(custom.props.email, PII_MASK, 'unknown custom-atom props are masked, not ignored');

  // Structural props survive so layout is preserved.
  const layout = strip(doc({ text: 'x', width: '720px', level: 2 }));
  assert.equal(layout.props.width, '720px', 'structural props survive masking');
  assert.equal(layout.props.level, 2);

  // Objects/arrays are dropped wholesale rather than half-masked.
  const nested = strip(doc({ text: 'x', rows: [{ ssn: '123' }] }));
  assert.equal(nested.props.rows, undefined, 'structured values are dropped');

  // maskNode drops the binding so a masked node cannot re-fetch the value.
  const bound = maskNode({ id: 'b', type: 'text', props: { text: 'x' }, data: { source: { kind: 'api', url: 'https://a/b' }, bindTo: 'text' } });
  assert.equal(bound.data, undefined, 'a masked node carries no data binding');
}

// ── 3. The renderer handed atoms the UNMASKED node ──────────────────────────
// Any atom reading node.props.* / node.a11y.* read around the mask. Image did.
{
  const doc = { version: 1, root: [{ id: 'i', type: 'image', props: { src: '/x.webp' }, a11y: { alt: 'Jane Doe, patient 4412' }, meta: { security: { pii: true } } }] };
  assert.ok(!html(doc, { canViewPii: false }).includes('Jane'), 'Image cannot read the unmasked alt through node.a11y');
  // A screen reader announces PII_MASK as "bullet bullet bullet" or skips it.
  assert.equal(PII_MASK_LABEL, 'Redacted', 'a11y text is masked with a word, not glyphs');
  assert.notEqual(PII_MASK_LABEL, PII_MASK);
}

// ── 4. Egress-only fields shipped to the client ─────────────────────────────
{
  const noted = stripDocument({ version: 1, root: [{ id: 't', type: 'text', props: { text: 'x' }, meta: { note: 'internal: churn risk, contact Jane' } }] }, {});
  assert.equal(noted.root[0].meta.note, undefined, 'meta.note ("never rendered") is stripped at egress');

  const cred = stripDocument({
    version: 1,
    root: [{ id: 't', type: 'text', props: { text: 'x' }, data: { source: { kind: 'api', url: 'https://a/b', headers: { Authorization: 'Bearer SEKRIT', 'x-trace': 'ok' } } } }],
  }, {});
  const headers = cred.root[0].data.source.headers;
  assert.equal(headers.Authorization, undefined, 'a credential header is not shipped to every viewer');
  assert.equal(headers['x-trace'], 'ok', 'benign headers survive');
}

// ── 5. Responsive overrides never applied ───────────────────────────────────
// Base style is inline; the override is a class rule inside @media. Inline wins
// at every viewport, so `md:size=4rem` was dead. The old test only asserted the
// CSS string existed.
{
  const out = html(compilePage('page "x" {\n  heading "T" size=12px md:size=4rem\n}'));
  assert.match(out, /@media \(min-width:768px\)\{\.ak-0\{font-size:4rem !important\}\}/, 'the md override outranks the inline base');
  assert.ok(out.includes('style="font-size:12px"'), 'the base style is still inline');
}

// ── 6. Analytics attributes failed OPEN ─────────────────────────────────────
// Emitted unless consent was explicitly `false` — the opposite default from
// consentCategory gating, and from data-protection-by-default.
{
  const doc = compilePage('page "x" {\n  text "hi" track=cta\n}');
  assert.ok(!html(doc).includes('data-analytics'), 'no consent object → no tracking attributes');
  assert.ok(!html(doc, { consent: {} }).includes('data-analytics'), 'undefined analytics consent → no tracking');
  assert.ok(!html(doc, { consent: { analytics: false } }).includes('data-analytics'), 'denied → no tracking');
  assert.ok(html(doc, { consent: { analytics: true } }).includes('data-analytics-id="cta"'), 'explicit grant → tracking');
}

// ── 7. serialize() silently dropped governance (round trip failed OPEN) ─────
{
  const src = `page "P" desc="d" {
  text "admin only" roles=admin,hr consent=marketing tags=a,b track=t1 event=click category=cta hidden
  image src=/x.webp alt="team photo" aria-label="Team" tabindex=0 lang=fr
  text "price" api=https://api.example.com/p path=data.price bind=text
  heading "H" size=12px md:size=4rem
  box { text "nested" pii }
}`;
  const doc = compilePage(src);
  assert.deepEqual(compilePage(serialize(doc)), doc, 'parse(serialize(doc)) deep-equals doc');
  assert.equal(serialize(compilePage(serialize(doc))), serialize(doc), 'serialize is idempotent');

  const back = compilePage(serialize(doc)).root[0];
  assert.deepEqual(back.meta.security.roles, ['admin', 'hr'], 'roles survive the round trip');
  assert.equal(back.meta.security.consentCategory, 'marketing', 'consent survives');
  assert.equal(back.hidden, true, 'hidden survives');
  assert.deepEqual(back.meta.tags, ['a', 'b'], 'tags survive');
  assert.equal(back.meta.analytics.event, 'click', 'analytics survive');
  // The governance consequence, stated directly:
  assert.equal(isNodeVisible(back, { roles: [] }), false, 'an admin-only node does NOT become public after a round trip');

  // Unrepresentable fields must fail LOUD rather than vanish.
  assert.throws(() => serialize({ version: 1, root: [{ id: 'a', type: 'text', props: { text: 'x' }, meta: { note: 'internal' } }] }), /meta\.note/, 'serialize refuses to silently drop meta.note');
  assert.throws(() => serialize({ version: 1, root: [{ id: 'a', type: 'text', props: {}, data: { source: { kind: 'static', value: 42 } } }] }), /static data value/, 'serialize refuses to drop a static data value');
}

// ── 8. coerce() destroyed leading/trailing zeros with no escape hatch ────────
{
  const p = compilePage('page "x" {\n  text "t" zip="02115" ver="1.10" flag="true" n=42 b=true\n}').root[0].props;
  assert.equal(p.zip, '02115', 'a quoted numeric-looking value stays a string');
  assert.equal(p.ver, '1.10', 'trailing zeros preserved when quoted');
  assert.equal(p.flag, 'true', 'a quoted "true" stays a string');
  assert.equal(p.n, 42, 'a bare number still coerces');
  assert.equal(p.b, true, 'a bare boolean still coerces');
}

// ── 9. maskNode spread unknown node-level fields straight through ────────────
// It was deny-by-default over `props` and allow-by-default over everything else:
// `{ ...node, props }`. Any node-level field the schema did not know about — a
// hand-authored key, or a future `state` / `on` / `each` — survived masking.
// `Render` and `stripDocument` never validate, so parseDocument's strictness did
// not guard this path. Found by the red-team review of the AQL 1.0 design.
{
  const hostile = {
    id: 'a', type: 'text',
    props: { text: 'ada@corp.com' },
    secret: 'SSN-123-45-6789',            // unknown node-level field
    state: { email: 'ada@corp.com' },     // the shape AQL 1.0 will introduce
    on: { click: 'exfiltrate(props.text)' },
    meta: { security: { pii: true } },
  };

  const masked = maskNode(hostile);
  assert.equal(masked.props.text, PII_MASK, 'props still masked');
  assert.equal(masked.secret, undefined, 'an unknown node-level field must not survive masking');
  assert.equal(masked.state, undefined, 'a future `state` field must fail closed');
  assert.equal(masked.on, undefined, 'a future `on` field must fail closed');

  const out = stripDocument({ version: 1, root: [hostile] }, { canViewPii: false });
  const json = JSON.stringify(out);
  assert.ok(!json.includes('SSN-123-45-6789'), 'unknown node field leaked through stripDocument');
  assert.ok(!json.includes('ada@corp.com'), 'PII leaked through a node-level field');
  assert.ok(!json.includes('exfiltrate'), 'an action field leaked through stripDocument');

  // Known fields still survive, or the mask would be useless.
  const known = maskNode({
    id: 'b', type: 'heading', props: { text: 'x', level: 2 },
    style: { fontSize: '2rem' }, hidden: false,
    children: [{ id: 'c', type: 'text', props: { text: 'kid' } }],
    a11y: { role: 'note', ariaLabel: 'L' },
    meta: { security: { pii: true }, tags: ['t'] },
  });
  assert.equal(known.props.level, 2, 'structural props survive');
  assert.deepEqual(known.style, { fontSize: '2rem' }, 'style survives');
  assert.equal(known.hidden, false, 'hidden survives');
  assert.equal(known.children.length, 1, 'children survive (they are masked by the cascade)');
  assert.equal(known.a11y.ariaLabel, PII_MASK_LABEL, 'a11y label masked');
  assert.equal(known.a11y.role, 'note', 'a11y role survives');
  assert.deepEqual(known.meta.tags, ['t'], 'meta survives');
}

// ── 10. An unquoted `{` in a value silently corrupted the document ──────────
// `{` opens a block, so `box document={{state.doc}}` parsed to props.document = ""
// and `box a=1 document={{x}} b=2` SPLIT into two nodes, inventing an atom named
// `b=2` which then failed closed and rendered nothing. No error either time.
// Found while red-teaming the AQL 1.0 interpolation syntax.
{
  assert.throws(() => compilePage('page "p" {\n  box document={{state.doc}}\n}'),
    /unquoted "\{" in the value of "document"/, 'a bare { in a value must be a parse error');
  assert.throws(() => compilePage('page "p" {\n  box a=1 document={{x}} b=2\n}'),
    /unquoted "\{"/, 'the node-splitting form must also throw');

  // Quoted interpolation is unambiguous and must keep working.
  assert.equal(compilePage('page "p" {\n  text "ok {{state.n}}"\n}').root[0].props.text, 'ok {{state.n}}');
  // Ordinary blocks are untouched.
  assert.equal(compilePage('page "p" {\n  box { text "child" }\n}').root[0].children.length, 1);
  assert.equal(compilePage('page "p" {\n  container width=720px { text "x" }\n}').root[0].props.width, '720px');
}

// ── 11. `icon` was unauthorable in AQL: `path=` was stolen by data binding ───
// `icon path="M4 4h16…"` produced data.source = {kind:'api', url:'', path:'M4 4h16…'}
// and rendered NOTHING, because the Icon atom reads props.path. Found by building the
// composer app — the first time anyone authored an icon in AQL.
{
  const icon = compilePage('page "p" {\n  icon path="M4 4h16v16H4z" viewBox="0 0 24 24"\n}').root[0];
  assert.equal(icon.props.path, 'M4 4h16v16H4z', 'icon path must be a prop');
  assert.equal(icon.data, undefined, 'icon must not acquire a phantom data binding');

  // A real binding still binds, and `path` after `api` is still the JSON path.
  const bound = compilePage('page "p" {\n  text "x" api="https://a/b" path=data.price bind=text\n}').root[0];
  assert.equal(bound.data.source.path, 'data.price');
  assert.equal(bound.props.path, undefined);

  // `data-path` is always unambiguous, and is what serialize() emits.
  const explicit = compilePage('page "p" {\n  text "x" api="https://a/b" data-path=data.price\n}').root[0];
  assert.equal(explicit.data.source.path, 'data.price');
  assert.ok(serialize({ version: 1, root: [bound] }).includes('data-path=data.price'));
  const doc = compilePage('page "P" {\n  text "x" api="https://a/b" path=data.price bind=text\n}');
  assert.deepEqual(compilePage(serialize(doc)), doc, 'a bound node still round-trips through data-path=');

  // `path=` BEFORE `api=` would silently land in props with no binding path. Refuse.
  assert.throws(() => compilePage('page "p" {\n  text "x" path=data.price api="https://a/b"\n}'),
    /both a data binding and a "path" prop/, 'ambiguous ordering must be a loud error');
}

console.log('✓ regression tests passed (dimension-prop sanitising, PII masking by value, mask read-around, egress-only fields, responsive cascade, analytics fail-closed, lossless serialize, coerce escape hatch)');
