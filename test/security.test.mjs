// Security + governance tests — the fixes from the adversarial review.
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Render, defaultAtoms, compilePage, stripDocument, getPath, resolveStyle, lint } from '../dist/index.js';

// 1. Style guards: url() blocked, position:fixed dropped, z-index capped, safe kept.
const s = resolveStyle({ background: 'url(https://evil/?leak)', position: 'fixed', zIndex: 999999, color: '#fff' });
assert.equal(s.background, undefined, 'url() background blocked');
assert.equal(s.position, undefined, 'position:fixed dropped');
assert.equal(s.zIndex, 9999, 'z-index capped');
assert.equal(s.color, '#fff', 'safe value kept');

// 2. getPath prototype-pollution guard.
assert.equal(getPath({ a: 1 }, '__proto__.polluted'), undefined, 'proto path blocked');
assert.equal(getPath({ a: { b: 2 } }, 'a.b'), 2, 'normal path works');

// 3. Selector-safe id — a hostile hand-authored id is NOT used as a CSS selector.
const evil = { version: 1, root: [{ id: 'x}html{display:none', type: 'text', props: { text: 'hi' }, style: { responsive: { md: { color: '#f00' } } } }] };
const evilHtml = renderToStaticMarkup(Render({ document: evil, registry: defaultAtoms }));
assert.ok(!evilHtml.includes('html{display:none'), 'unsafe id not interpolated into a selector');

// 4. PII masking enforced in the renderer for ALL atoms; protected node not rendered.
const doc = compilePage(`page "t" {
  heading "Secret Q4 revenue" level=2 pii
  text "public copy"
  text "internal only" protected
}`);
const locked = renderToStaticMarkup(Render({ document: doc, registry: defaultAtoms, context: { canViewPii: false, canViewProtected: false } }));
assert.ok(!locked.includes('Secret Q4 revenue') && locked.includes('•••••'), 'PII masked in render');
assert.ok(locked.includes('public copy'), 'public content shown');
assert.ok(!locked.includes('internal only'), 'protected node not rendered');
const open = renderToStaticMarkup(Render({ document: doc, registry: defaultAtoms, context: { canViewPii: true, canViewProtected: true } }));
assert.ok(open.includes('Secret Q4 revenue') && open.includes('internal only'), 'shown when permitted');

// 5. stripDocument — governance at EGRESS: masked/removed in the DATA, not just the render.
const stripped = JSON.stringify(stripDocument(doc, { canViewPii: false, canViewProtected: false }));
assert.ok(!stripped.includes('Secret Q4 revenue'), 'stripDocument masks PII in the data');
assert.ok(!stripped.includes('internal only'), 'stripDocument removes protected node from the data');
assert.ok(stripped.includes('public copy'), 'public content retained');

// 6. Consent-gated analytics.
const adoc = compilePage(`page "t" { button "Go" href=/x track=cta_1 }`);
assert.ok(renderToStaticMarkup(Render({ document: adoc, registry: defaultAtoms, context: { consent: { analytics: true } } })).includes('data-analytics-id="cta_1"'), 'analytics emitted with consent');
assert.ok(!renderToStaticMarkup(Render({ document: adoc, registry: defaultAtoms, context: { consent: { analytics: false } } })).includes('data-analytics-id'), 'analytics suppressed when consent denied');

// 7. Parser caps: pathological deep nesting throws instead of blowing the stack.
let threw = false;
try { compilePage('box {\n'.repeat(50) + '}'.repeat(50)); } catch { threw = true; }
assert.ok(threw, 'deep nesting is rejected');

// 8. Mask by VALUE — subtree cascade + bindTo/summary/aria-label, not just text/src/href.
const gdoc = {
  version: 1,
  root: [
    {
      id: 'wrap', type: 'box', meta: { security: { pii: true } },
      children: [
        { id: 'a', type: 'accordion-item', props: { summary: 'John Doe SSN 123' } },
        { id: 'b', type: 'heading', props: { text: 'x', level: 3 }, a11y: { ariaLabel: 'secret label' } },
      ],
    },
  ],
};
const gLocked = renderToStaticMarkup(Render({ document: gdoc, registry: defaultAtoms, context: { canViewPii: false } }));
assert.ok(!gLocked.includes('John Doe') && !gLocked.includes('secret label'), 'PII cascades + masks summary + aria-label (by value)');
const gStrip = JSON.stringify(stripDocument(gdoc, { canViewPii: false }));
assert.ok(!gStrip.includes('John Doe') && !gStrip.includes('secret label'), 'stripDocument masks nested summary + aria-label in the data');

// 9. Registry prototype-pollution: node.type='constructor' must fail-closed, not throw.
const proto = { version: 1, root: [{ id: 'p', type: 'constructor', props: {} }] };
const protoHtml = renderToStaticMarkup(Render({ document: proto, registry: defaultAtoms }));
assert.ok(!protoHtml.includes('function'), 'prototype-member type renders nothing (no throw)');

// 10. image-set()/cross-fade() blocked in style (URL-bearing CSS functions).
assert.equal(resolveStyle({ backgroundImage: 'image-set("https://evil/x" 1x)' }).backgroundImage, undefined, 'image-set() blocked');

// 11. List keeps list semantics (role) when markers are removed.
const listHtml = renderToStaticMarkup(Render({ document: compilePage('page "t" { list { text "a" text "b" } }'), registry: defaultAtoms }));
assert.ok(listHtml.includes('role="list"') && listHtml.includes('role="listitem"'), 'list role restored when markerless');

// 12. a11y lint flags a missing image alt.
assert.ok(lint({ version: 1, root: [{ id: 'i', type: 'image', props: { src: '/x.webp' } }] }).some((w) => w.rule === 'img-alt'), 'lint flags missing alt');

console.log('✓ security + governance tests passed');
