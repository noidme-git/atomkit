// Robustness tests for the AQL compiler. Run after build: `npm test`.
import assert from 'node:assert/strict';
import { compilePage, serialize } from '../dist/query.js';

const src = `
// a comment line — ignored
page "Home" desc="hi there" {
  box as=section pad-y=80 bg="var(--soft)" {
    box dir=column gap=16 items=center {
      heading "Build with us" level=1 size=clamp(2rem,5vw,3.4rem) color=#0b1220 md:size=4rem
      text "person@example.com" pii
      button "Go" href=#careers external track=cta_top aria-label="Go to careers"
      text "price" api="https://api.example.com/p" path="data.amount" bind=text
      image src=/media/a.webp alt="a team photo" radius=16
      box as=section bg="linear-gradient(103deg, #E31936, #ff3b57)" {}
    }
  }
}
`;

const doc = compilePage(src);

assert.equal(doc.root.length, 1, 'one root (section)');
const section = doc.root[0];
assert.equal(section.type, 'box');
assert.equal(section.props.as, 'section', 'as=section → props.as');
assert.equal(section.style.paddingY, 80, 'pad-y=80 → number');
assert.equal(section.style.background, 'var(--soft)', 'bg="var(--soft)" survives quotes+parens');

const col = section.children[0];
assert.equal(col.style.flexDirection, 'column', 'dir=column → flexDirection');
assert.equal(col.style.gap, 16);
assert.equal(col.style.alignItems, 'center', 'items=center → alignItems');

const [h, email, btn, price, img, grad] = col.children;

assert.equal(h.type, 'heading');
assert.equal(h.props.text, 'Build with us', 'quoted primary → props.text');
assert.equal(h.props.level, 1, 'level=1 → number');
assert.equal(h.style.fontSize, 'clamp(2rem,5vw,3.4rem)', 'unquoted paren value kept whole');
assert.equal(h.style.color, '#0b1220', 'hex value kept as string');
assert.equal(h.style.responsive.md.fontSize, '4rem', 'md:size → responsive.md.fontSize');

assert.equal(email.meta.security.pii, true, 'pii flag → meta.security.pii');

assert.equal(btn.props.text, 'Go');
assert.equal(btn.props.href, '#careers');
assert.equal(btn.props.external, true, 'external flag → props.external');
assert.equal(btn.meta.analytics.id, 'cta_top', 'track= → analytics.id');
assert.equal(btn.a11y.ariaLabel, 'Go to careers', 'aria-label= → a11y.ariaLabel');

assert.equal(price.data.source.kind, 'api');
assert.equal(price.data.source.url, 'https://api.example.com/p');
assert.equal(price.data.source.path, 'data.amount', 'path= preserved alongside api=');
assert.equal(price.data.bindTo, 'text', 'bind= → data.bindTo');

assert.equal(img.props.src, '/media/a.webp');
assert.equal(img.a11y.alt, 'a team photo', 'alt= → a11y.alt');
assert.equal(img.style.borderRadius, 16);

assert.equal(grad.style.background, 'linear-gradient(103deg, #E31936, #ff3b57)', 'gradient with spaces+commas in quotes');

// Every node got a unique id.
const ids = new Set();
const walk = (n) => { assert.ok(!ids.has(n.id), `unique id ${n.id}`); ids.add(n.id); (n.children ?? []).forEach(walk); };
doc.root.forEach(walk);

// Round-trip: serialize → re-compile → structure preserved.
const doc2 = compilePage(serialize(doc));
const h2 = doc2.root[0].children[0].children[0];
assert.equal(h2.props.text, 'Build with us', 'round-trip text');
assert.equal(h2.style.responsive.md.fontSize, '4rem', 'round-trip responsive');

// Unquoted URL values keep their `//` — regression: `//` used to be treated as a
// comment mid-token, truncating `href=https://…` and swallowing the rest of the line.
{
  const d = compilePage(`page "L" {
  button "Site" href=https://example.com/path?a=1 external track=go   // trailing comment
  text "after"
}`);
  const [b, after] = d.root;
  assert.equal(b.props.href, 'https://example.com/path?a=1', 'unquoted https:// URL kept whole');
  assert.equal(b.props.external, true, 'attrs after the URL on the same line survive');
  assert.equal(b.meta.analytics.id, 'go', 'track= after the URL is parsed');
  assert.equal(after.props.text, 'after', 'trailing // comment (after space) ignored; next line intact');
}

console.log('✓ AQL compiler tests passed (' + ids.size + ' nodes, round-trip OK)');
