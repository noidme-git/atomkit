// Preview as viewer — the wedge, demonstrated.
//
// One AQL page. Four viewers. The SAME two-step the shipped app runs at egress
// (atomkit-app/src/render.ts): stripDocument(doc, ctx) → Render(..., ctx).
//
// This is not a mock of governance. It is governance.
//
//   node preview.mjs            # all personas
//   node preview.mjs recruiter  # just one
//
// The point to watch: for a viewer without permission, the governed content is not
// hidden by CSS, not masked in the DOM, not present-but-blurred. The bytes were
// never sent. `stripDocument` removes the node from the document before the
// renderer ever sees it.

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compilePage, stripDocument, Render, defaultAtoms, lint } from '@noidmejs/atomkit';

const src = readFileSync(new URL('./app/index.aql', import.meta.url), 'utf8');
const doc = compilePage(src);

const PERSONAS = {
  public: { label: 'Anonymous visitor', ctx: {} },
  recruiter: { label: 'Recruiter', ctx: { roles: ['recruiter'] } },
  consented: { label: 'Anonymous, consented to marketing', ctx: { consent: { marketing: true, analytics: true } } },
  admin: { label: 'Admin (all permissions)', ctx: { canViewPii: true, canViewProtected: true, roles: ['recruiter'], consent: { marketing: true, analytics: true } } },
};

// React escapes `'` to `&#x27;`, so a needle containing an apostrophe can never
// match the raw markup. Searching un-decoded HTML makes a test that reports a
// governance failure that did not happen — which is exactly what it did the first
// time this file was run. Decode before asserting.
const decode = (s) =>
  s.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Exactly what atomkit-app does to serve this page. */
const renderAs = (ctx) =>
  decode(renderToStaticMarkup(createElement(Render, { document: stripDocument(doc, ctx), registry: defaultAtoms, context: ctx })));

// The secrets we are protecting. If any appears for a viewer who may not see it,
// the product does not work.
const SECRETS = {
  'the salary band': '120,000',
  'the recruiter email': 'priya.raghunathan@northwind.health',
  'the phone number': '+44 7700 900412',
  'the board hiring plan': 'Budget approved',
  'the marketing block': "We'll email you",
  'analytics attributes': 'data-analytics-id',
};

const only = process.argv[2];
const chosen = only ? { [only]: PERSONAS[only] } : PERSONAS;
if (only && !PERSONAS[only]) {
  console.error(`unknown persona "${only}". try: ${Object.keys(PERSONAS).join(', ')}`);
  process.exit(1);
}

console.log('\n══ One page. Four viewers. Governance enforced at egress. ══');

const table = [];
for (const [key, { label, ctx }] of Object.entries(chosen)) {
  const html = renderAs(ctx);
  const row = { viewer: label, bytes: html.length };
  for (const [name, needle] of Object.entries(SECRETS)) row[name] = html.includes(needle);
  table.push(row);

  console.log(`\n── ${label} (${key}) ──`);
  console.log(`   ${html.length} bytes delivered`);
  for (const [name, needle] of Object.entries(SECRETS)) {
    console.log(`   ${html.includes(needle) ? '👁  sees  ' : '🚫 never receives'}  ${name}`);
  }
  if (html.includes('•••••')) console.log('   🔒 PII rendered as the mask');
}

// ── Assertions: this is a test, not a slideshow ─────────────────────────────
let fail = 0;
const must = (cond, msg) => { if (!cond) { fail++; console.log(`\n  ❌ ${msg}`); } };

const pub = renderAs(PERSONAS.public.ctx);
must(!pub.includes('120,000'), 'anonymous visitor received the salary band');
must(!pub.includes('priya.raghunathan@northwind.health'), 'anonymous visitor received the recruiter email');
must(!pub.includes('+44 7700 900412'), 'anonymous visitor received the phone number');
must(!pub.includes('Budget approved'), 'anonymous visitor received the board hiring plan');
must(!pub.includes("We'll email you"), 'un-consented visitor received the marketing block');
must(!pub.includes('data-analytics-id'), 'un-consented visitor was tracked');
must(pub.includes('Join Northwind Health'), 'anonymous visitor lost the public content');
must(pub.includes('•••••'), 'the PII node did not render its mask');

const rec = renderAs(PERSONAS.recruiter.ctx);
must(rec.includes('120,000'), 'the recruiter could not see the salary band');
must(!rec.includes('priya.raghunathan@northwind.health'), 'the recruiter saw PII without canViewPii');
must(!rec.includes('Budget approved'), 'the recruiter saw board-only content');

const con = renderAs(PERSONAS.consented.ctx);
must(con.includes("We'll email you"), 'the consented visitor did not get the marketing block');
must(con.includes('data-analytics-id'), 'the consented visitor was not tracked despite consenting');
must(!con.includes('120,000'), 'consent granted a role it should not have');

const adm = renderAs(PERSONAS.admin.ctx);
must(adm.includes('priya.raghunathan@northwind.health'), 'the admin could not see PII');
must(adm.includes('Budget approved'), 'the admin could not see protected content');
must(adm.length > pub.length, 'the admin did not receive strictly more than the public');

// The public page is not merely "styled to hide" the secrets — they are absent.
must(!pub.includes('display:none'), 'governance was implemented with CSS, not egress');

const warnings = lint(doc);
console.log(`\n── lint: ${warnings.length ? warnings.map((w) => `${w.rule} on #${w.id}`).join(', ') : 'clean'} ──`);

if (fail) {
  console.log(`\n  ${fail} ASSERTION(S) FAILED — governance does not hold\n`);
} else {
  console.log(`\n  ✅ ${Object.keys(SECRETS).length} secrets · 4 viewers · 0 leaks`);
  console.log(`     The public page is ${pub.length} bytes. The admin page is ${adm.length}.`);
  console.log('     The difference was never sent — not hidden, not masked in the DOM. Absent.\n');
}
process.exit(fail ? 1 : 0);
