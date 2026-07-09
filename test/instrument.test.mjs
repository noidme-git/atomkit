// instrumentRegistry — per-node DOM handles for a visual editor.
//
// The guarantee under test is NOT "an attribute appears". It is: the rendered
// markup is unchanged apart from that attribute. A wrapper <div> per atom would
// also produce handles, and would silently destroy every flex and grid layout,
// because the wrapper becomes the flex/grid item instead of the atom.
//
// So the load-bearing assertions are structural: element count unchanged, and a
// flex/grid container's first child is still the atom itself. The negative
// control at the bottom swaps in the wrapper implementation and proves these
// assertions actually fail — a test that cannot fail is worse than no test.

import assert from 'node:assert/strict';
import { createElement, cloneElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Render, defaultAtoms, compilePage, instrumentRegistry, NODE_ID_ATTR } from '../dist/index.js';

const html = (doc, registry, context = {}) => renderToStaticMarkup(createElement(Render, { document: doc, registry, context }));
const stripAttr = (s) => s.replace(new RegExp(` ${NODE_ID_ATTR}="[^"]*"`, 'g'), '');
const elementCount = (s) => (s.match(/<[a-z]/g) || []).length;

/** First child element after the open tag of the container matching `styleFragment`.
 *  Parsed structurally: React emits data-ak-id LAST on <img> (after src/alt/loading),
 *  so an attribute-order-sensitive regex would fail on correct markup. */
function firstChildAfter(markup, styleFragment) {
  const open = markup.indexOf(styleFragment);
  if (open === -1) return null;
  const gt = markup.indexOf('>', open);
  const m = markup.slice(gt + 1).match(/^\s*<([a-z]+)([^>]*)>/);
  return m ? { tag: m[1], attrs: m[2] } : null;
}

const DOC = compilePage(`page "p" {
  section {
    row {
      text "A"
      heading "B" level=3
      chip "New"
    }
    grid cols=3 {
      image src=/a.webp alt="A"
      link "Go" href=https://x.example external
      button "Click"
    }
    list {
      text "one"
      text "two"
    }
    divider
    spacer height=40px
  }
}`);

const instrumented = instrumentRegistry(defaultAtoms);
const plain = html(DOC, defaultAtoms);
const inst = html(DOC, instrumented);

// ── The markup is unchanged apart from the attribute ─────────────────────────
assert.equal(stripAttr(inst), plain, 'instrumented markup differs from plain beyond the id attribute');
assert.equal(elementCount(inst), elementCount(plain), 'instrumentation added or removed elements');

// ── Layout containers keep the atom as their direct child ────────────────────
const flexChild = firstChildAfter(inst, 'display:flex');
assert.equal(flexChild?.tag, 'p', 'flex container gained a wrapper; its first child must be the text atom');
assert.ok(flexChild.attrs.includes(NODE_ID_ATTR), 'flex child is not tagged');

const gridChild = firstChildAfter(inst, 'display:grid');
assert.equal(gridChild?.tag, 'img', 'grid container gained a wrapper; its first child must be the image atom');
assert.ok(gridChild.attrs.includes(NODE_ID_ATTR), 'grid child is not tagged');

// ── Every rendered node is addressable, exactly once ─────────────────────────
const ids = [...inst.matchAll(new RegExp(`${NODE_ID_ATTR}="([^"]+)"`, 'g'))].map((m) => m[1]);
const walk = (nodes, acc = []) => { for (const n of nodes) { acc.push(n.id); if (n.children) walk(n.children, acc); } return acc; };
assert.deepEqual([...ids].sort(), walk(DOC.root).sort(), 'not every node carries exactly one handle');
assert.equal(new Set(ids).size, ids.length, 'duplicate handles');

// ── An atom that renders nothing must not be conjured into existence ─────────
{
  const doc = { version: 1, root: [
    { id: 'bad-img', type: 'image', props: { src: 'javascript:alert(1)' } }, // safeImageSrc → null
    { id: 'bad-icon', type: 'icon', props: { path: '<script>' } },           // invalid path → null
    { id: 'ok', type: 'text', props: { text: 'survivor' } },
  ] };
  const out = html(doc, instrumented);
  assert.ok(!out.includes('bad-img') && !out.includes('bad-icon'), 'a null-rendering atom was given an element');
  assert.ok(out.includes(`${NODE_ID_ATTR}="ok"`), 'sibling of a null atom lost its handle');
}

// ── Governance is untouched: instrumenting must not see through the mask ─────
{
  const doc = compilePage('page "p" {\n  text "ada@corp.com" pii\n  text "board only" protected\n}');
  const out = html(doc, instrumented, {});
  assert.ok(!out.includes('ada@corp.com'), 'PII leaked through the instrumented registry');
  assert.ok(out.includes('•••••'), 'PII mask missing');
  assert.ok(!out.includes('board only'), 'protected node rendered through the instrumented registry');
}

// ── Responsive CSS still scoped to the node, emitted once ────────────────────
{
  const out = html(compilePage('page "p" {\n  heading "T" size=12px md:size=4rem\n}'), instrumented);
  assert.equal((out.match(/@media/g) || []).length, 1);
  assert.ok(out.includes('.ak-0{font-size:4rem !important}'));
}

// ── NEGATIVE CONTROL ─────────────────────────────────────────────────────────
// Re-implement instrumentation the naive way — a wrapper element per atom — and
// assert the checks above actually catch it. Without this, the suite could pass
// against an implementation that breaks every flex and grid layout.
{
  const wrapped = Object.fromEntries(Object.entries(defaultAtoms).map(([type, def]) => [type, {
    ...def,
    render: (p) => {
      const el = def.render(p);
      if (!isValidElement(el)) return el;
      return createElement('div', { [NODE_ID_ATTR]: p.node.id }, el);
    },
  }]));
  const bad = html(DOC, wrapped);

  assert.notEqual(stripAttr(bad), plain, 'NEGATIVE CONTROL FAILED: wrapper markup was not detected as different');
  assert.ok(elementCount(bad) > elementCount(plain), 'NEGATIVE CONTROL FAILED: added elements were not detected');
  assert.notEqual(firstChildAfter(bad, 'display:flex')?.tag, 'p', 'NEGATIVE CONTROL FAILED: flex wrapper not detected');
  assert.notEqual(firstChildAfter(bad, 'display:grid')?.tag, 'img', 'NEGATIVE CONTROL FAILED: grid wrapper not detected');
}

console.log('✓ instrument tests passed (per-node handles, zero added elements, flex/grid children intact, null atoms respected, governance held; negative control proves the checks can fail)');
