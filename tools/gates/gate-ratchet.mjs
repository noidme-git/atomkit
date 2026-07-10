// THE RATCHET.
//
// `governance-gate.mjs` exits 1 while any invariant is open, which is correct for a
// human but useless for CI: two gates are open by design today, so the build would be
// permanently red and everybody would learn to ignore it. A gate nobody looks at is a
// paragraph.
//
// So CI runs THIS. It compares the live gate against a committed baseline and fails
// on exactly two things:
//
//   1. REGRESSION — a gate that was HELD is now OPEN. Somebody broke governance.
//   2. STALE BASELINE — a gate that was OPEN is now HELD. Somebody fixed governance
//      and did not update the baseline. This "failure" is a celebration, and it forces
//      the fix to be recorded rather than absorbed silently.
//
// The ratchet only turns one way. It is how "6 held, 2 open" cannot quietly become
// "5 held, 3 open" three commits from now.
//
//   node spike/gate-ratchet.mjs           # check
//   node spike/gate-ratchet.mjs --accept  # rewrite the baseline after a real change

import { readFileSync, writeFileSync } from 'node:fs';
import { RESULTS } from './governance-gate.mjs';

const BASELINE = new URL('./gate-baseline.json', import.meta.url);
const accept = process.argv.includes('--accept');

const live = Object.fromEntries(RESULTS.map((r) => [r.id, r.status]));

if (accept) {
  writeFileSync(BASELINE, JSON.stringify({ gates: live }, null, 2) + '\n');
  console.log('\n  baseline rewritten:\n' + JSON.stringify(live, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
  process.exit(0);
}

let base;
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')).gates; }
catch { console.error('  no baseline. run: node spike/gate-ratchet.mjs --accept'); process.exit(1); }

const regressions = [];
const improvements = [];
const added = [];

for (const [id, status] of Object.entries(live)) {
  if (!(id in base)) { added.push(`${id} (${status})`); continue; }
  if (base[id] === 'HELD' && status === 'OPEN') regressions.push(id);
  if (base[id] === 'OPEN' && status === 'HELD') improvements.push(id);
}
const removed = Object.keys(base).filter((id) => !(id in live));

const heldNow = Object.values(live).filter((s) => s === 'HELD').length;
const openNow = Object.values(live).filter((s) => s === 'OPEN').length;
console.log(`\n══ Governance ratchet ══\n\n  ${heldNow} held · ${openNow} open  (baseline: ${Object.values(base).filter((s) => s === 'HELD').length} held)\n`);

let fail = false;

if (regressions.length) {
  fail = true;
  console.log('  ❌ REGRESSION — a governance invariant that used to hold no longer does:\n');
  for (const id of regressions) console.log(`       ${id}  ${RESULTS.find((r) => r.id === id).invariant}`);
  console.log('\n     This is not a test failure. It is a governance failure. Fix the code.\n');
}

if (improvements.length) {
  fail = true;
  console.log('  🎉 A GATE CLOSED — and the baseline still says it is open:\n');
  for (const id of improvements) console.log(`       ${id}  ${RESULTS.find((r) => r.id === id).invariant}`);
  console.log('\n     Record it: node spike/gate-ratchet.mjs --accept, and say so in DECISIONS.md.');
  console.log('     A fix nobody wrote down is a fix that gets undone.\n');
}

if (added.length) { fail = true; console.log(`  ⚠️  new gate(s) not in the baseline: ${added.join(', ')}\n     Run --accept once you have reviewed them.\n`); }
if (removed.length) { fail = true; console.log(`  ⚠️  gate(s) deleted from the suite: ${removed.join(', ')}\n     Deleting a gate is how a guarantee disappears. Justify it in DECISIONS.md.\n`); }

if (!fail) {
  console.log('  ✅ no regression. The still-open gates are the known ones:');
  for (const [id, s] of Object.entries(base)) if (s === 'OPEN') console.log(`       ${id}  ${RESULTS.find((r) => r.id === id)?.invariant ?? ''}`);
  console.log('\n     Nothing interactive ships until they are HELD.\n');
}

process.exit(fail ? 1 : 0);
