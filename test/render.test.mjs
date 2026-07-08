// Render tests: compile AQL with the richer atoms, render to static HTML, assert.
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Render, defaultAtoms, compilePage } from '../dist/index.js';

const src = `
page "T" {
  section pad-y=40 {
    grid cols=3 gap=20 {
      heading "A" level=3
      heading "B" level=3
      heading "C" level=3
    }
    list {
      text "one"
      text "two"
    }
    accordion {
      accordion-item summary="Question 1" { text "Answer 1" }
    }
    link "Docs" href=/docs
    chip "New"
  }
}
`;

const html = renderToStaticMarkup(Render({ document: compilePage(src), registry: defaultAtoms }));

assert.ok(html.includes('<section'), 'section renders');
assert.ok(html.includes('grid-template-columns:repeat(3,minmax(0,1fr))'), 'grid cols=3 → template');
assert.ok((html.match(/<h3/g) || []).length === 3, 'three h3 headings');
assert.ok(html.includes('<ul'), 'list → ul');
assert.ok((html.match(/<li/g) || []).length === 2, 'two li items');
assert.ok(html.includes('<details'), 'accordion-item → details');
assert.ok(html.includes('<summary'), 'summary renders');
assert.ok(html.includes('Question 1') && html.includes('Answer 1'), 'accordion content');
assert.ok(html.includes('href="/docs"'), 'link href');
assert.ok(html.includes('New'), 'chip text');
// centred max-width container inside the section
assert.ok(html.includes('max-width:1200px'), 'section contains a centred container by default');

console.log('✓ render tests passed (richer atoms produce correct HTML)');
