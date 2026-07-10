// IS THE GATE VACUOUS?
//
// A gate can pass for two very different reasons:
//
//   (a) the system cannot do the bad thing;
//   (b) somebody wrote a function that would prevent the bad thing, and the gate
//       calls that function.
//
// (b) is not safety. It is a library. The CTO named this exact failure when rejecting
// the expression evaluator from the 0.8.0 release: "Bar 4 is satisfied only vacuously
// — the evaluator has zero call sites."
//
// `governance-gate.mjs` now tests `buildScope()` and `safeNavigate()`. Both work. But
// nothing in the renderer, the atoms, or the data layer calls either one. So:
//
//   "an expression cannot read PII held in state"  is really
//   "an expression cannot read PII held in state, PROVIDED the caller opts in"
//
// A caller who forgets is not prevented from anything. This file makes that gap
// visible, and it is the second half of every G-gate: the primitive must exist AND
// the system must be unable to bypass it.
//
//   node spike/gate-wiring.mjs

import { readFileSync, existsSync } from 'node:fs';

const CORE = new URL('../../src/', import.meta.url).pathname;
const read = (f) => (existsSync(`${CORE}/${f}`) ? readFileSync(`${CORE}/${f}`, 'utf8') : '');

/** Files that would have to call a primitive for it to be load-bearing. */
const ENFORCEMENT_SITES = ['render.tsx', 'data.tsx', 'atoms.tsx'];

const PRIMITIVES = [
  {
    gate: 'G2',
    name: 'buildScope',
    module: 'scope.ts',
    invariant: 'every expression scope is built from the STRIPPED document',
    why: 'Without a call site, a renderer can construct a raw scope over the authoring document and read masked PII. The composer canvas does exactly that by definition.',
  },
  {
    gate: 'G5',
    name: 'safeNavigate',
    module: 'navigate.ts',
    invariant: 'a navigate target is checked against a host allow-list',
    why: 'Without a call site, an action can call safeHref — which blocks schemes, never destinations — and exfiltrate state in a query string.',
  },
];

let open = 0;
console.log('\n══ Gate wiring — is the primitive load-bearing, or just present? ══\n');

for (const p of PRIMITIVES) {
  const exists = read(p.module).includes(`export function ${p.name}`) || read(p.module).includes(`export const ${p.name}`);
  const callers = ENFORCEMENT_SITES.filter((f) => read(f).includes(p.name));

  const wired = exists && callers.length > 0;
  if (!wired) open++;

  console.log(`  ${wired ? '✅ WIRED ' : '⚠️  UNWIRED'}  ${p.gate}  ${p.invariant}`);
  console.log(`             primitive ${p.name}(): ${exists ? `defined in ${p.module}` : 'MISSING'}`);
  console.log(`             call sites in [${ENFORCEMENT_SITES.join(', ')}]: ${callers.length ? callers.join(', ') : 'NONE'}`);
  if (!wired) console.log(`             → ${p.why}`);
  console.log();
}

if (open) {
  console.log(`  ${open} primitive(s) exist but nothing is forced to use them.`);
  console.log('  governance-gate.mjs may report these gates HELD. That pass is VACUOUS.');
  console.log('  A gate is closed when the system cannot do the bad thing — not when');
  console.log('  a function exists that would have stopped it.\n');
} else {
  console.log('  Every primitive has a call site on the enforcement path.\n');
}

process.exit(open ? 1 : 0);
