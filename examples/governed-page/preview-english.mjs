// Proof: the ENGLISH page is the SAME page.
//
// Two obligations, both by execution — not "looks similar", deep-equal:
//   A. compilePage(desugar(index.english.aql)) deep-equals compilePage(index.aql)
//   B. the same four viewers, the same six secrets, ZERO leaks — against the
//      English version, run through the exact egress two-step atomkit-app runs.
//
//   node preview-english.mjs

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compilePage, stripDocument, Render, defaultAtoms, lint } from '@noidmejs/atomkit';
import { desugar } from './english.mjs';

const canonicalSrc = readFileSync(new URL('./app/index.aql', import.meta.url), 'utf8');
const englishSrc = readFileSync(new URL('./app/index.english.aql', import.meta.url), 'utf8');

const canonicalDoc = compilePage(canonicalSrc);
const desugared = desugar(englishSrc);
const englishDoc = compilePage(desugared);

console.log('\n══ A. English desugars to the identical document ══\n');
let fail = 0;
try {
  assert.deepEqual(englishDoc, canonicalDoc);
  console.log('  ✅ compilePage(desugar(index.english.aql)) deep-equals compilePage(index.aql)');
} catch (e) {
  fail++;
  console.log('  ❌ documents differ');
  console.log('     ' + e.message.split('\n').slice(0, 6).join('\n     '));
}

// The doc we now govern is the ENGLISH-authored one.
const doc = englishDoc;

const PERSONAS = {
  public: { label: 'Anonymous visitor', ctx: {} },
  recruiter: { label: 'Recruiter', ctx: { roles: ['recruiter'] } },
  consented: { label: 'Anonymous, consented to marketing', ctx: { consent: { marketing: true, analytics: true } } },
  admin: { label: 'Admin (all permissions)', ctx: { canViewPii: true, canViewProtected: true, roles: ['recruiter'], consent: { marketing: true, analytics: true } } },
};

const decode = (s) =>
  s.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const renderAs = (ctx) =>
  decode(renderToStaticMarkup(createElement(Render, { document: stripDocument(doc, ctx), registry: defaultAtoms, context: ctx })));

const SECRETS = {
  'the salary band': '120,000',
  'the recruiter email': 'priya.raghunathan@northwind.health',
  'the phone number': '+44 7700 900412',
  'the board hiring plan': 'Budget approved',
  'the marketing block': "We'll email you",
  'analytics attributes': 'data-analytics-id',
};

console.log('\n══ B. One English page. Four viewers. Governance enforced at egress. ══');
for (const [key, { label, ctx }] of Object.entries(PERSONAS)) {
  const html = renderAs(ctx);
  console.log(`\n── ${label} (${key}) ──`);
  console.log(`   ${html.length} bytes delivered`);
  for (const [name, needle] of Object.entries(SECRETS)) {
    console.log(`   ${html.includes(needle) ? '👁  sees  ' : '🚫 never receives'}  ${name}`);
  }
  if (html.includes('•••••')) console.log('   🔒 PII rendered as the mask');
}

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
must(!pub.includes('display:none'), 'governance was implemented with CSS, not egress');

const warnings = lint(doc);
console.log(`\n── lint: ${warnings.length ? warnings.map((w) => `${w.rule} on #${w.id}`).join(', ') : 'clean'} ──`);

if (fail) {
  console.log(`\n  ${fail} FAILURE(S) — the English page does not match or leaks\n`);
} else {
  console.log(`\n  ✅ English === canonical · ${Object.keys(SECRETS).length} secrets · 4 viewers · 0 leaks`);
  console.log(`     Public page ${pub.length} bytes, admin page ${adm.length}. The difference was never sent.\n`);
}
process.exit(fail ? 1 : 0);
