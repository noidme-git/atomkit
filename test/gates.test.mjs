// The governance primitives: `buildScope` (G2) and `safeNavigate` (G5).
//
// Both were written, both "passed" a gate, and both were broken. The gate probed ONE
// input each and therefore could not fail for the classes that actually break:
//
//   safeNavigate('/<TAB>/evil.com/steal', {allowHosts:['app.example.com']})
//     → returned the string unchanged. The URL parser REMOVES tab/LF/CR, so a real
//       browser resolves it to https://evil.com/steal. The same-origin fast path ran
//       before anything noticed the control character.
//
//   evalExpr('state.node.props.text', buildScope({state:{node: piiNode}}, {canViewPii:false}))
//     → 'SSN 123-45-6789'. `isDocumentShaped` demanded a NUMERIC version and an array
//       root, so a NODE was rebuilt field-by-field and its PII survived. A composer's
//       inspector holds the selected NODE by definition.
//
// A shape sniff stricter than the thing it guards is a hole, not a check. Every case
// below is a class, not an example.

import assert from 'node:assert/strict';
import { safeNavigate } from '../dist/navigate.js';
import { buildScope, evalInScope, interpolateInScope, isScope } from '../dist/scope.js';
import { evalExpr } from '../dist/expr.js';

const PII = 'SSN 123-45-6789';
const TAB = String.fromCharCode(9), LF = String.fromCharCode(10), CR = String.fromCharCode(13), NUL = String.fromCharCode(0);
const policy = { allowHosts: ['app.example.com'] };

// ── G5: a navigate target cannot reach an off-list host ─────────────────────
{
  // Control characters are stripped by the URL parser, so they must never survive
  // a prefix check. Each of these resolves cross-origin in a real browser.
  for (const c of [TAB, LF, CR, NUL]) {
    assert.equal(safeNavigate(`/${c}/evil.com/steal?d=${PII}`, policy), null, `control char ${c.charCodeAt(0)} bypassed the host check`);
    assert.equal(safeNavigate(`https://app.example.com${c}@evil.com/x`, policy), null, 'control char in the authority bypassed');
  }
  // Prove the premise, so this test cannot rot into superstition.
  assert.equal(new URL(`/${TAB}/evil.com/steal`, 'https://app.example.com').href, 'https://evil.com/steal',
    'premise: the URL parser removes TAB and resolves cross-origin');

  // Off-list hosts, in every spelling.
  assert.equal(safeNavigate(`https://attacker.io/?d=${PII}`, policy), null);
  assert.equal(safeNavigate('//evil.com/x', policy), null, 'protocol-relative');
  assert.equal(safeNavigate('https://a@evil.com/x', policy), null, 'userinfo spoof');
  assert.equal(safeNavigate('https://app.example.com.evil.com/x', policy), null, 'suffix spoof');
  assert.equal(safeNavigate('javascript:alert(1)', policy), null);
  assert.equal(safeNavigate('data:text/html,x', policy), null);
  assert.equal(safeNavigate('mailto:a@b.c', policy), null, 'mailto is an off-device channel unless opted in');
  assert.equal(safeNavigate('evil.com/path', policy), null, 'schemeless host is ambiguous → fail closed');
  assert.equal(safeNavigate('x'.repeat(4000), policy), null, 'length cap');
  assert.equal(safeNavigate(null, policy), null);

  // …and the legitimate targets still work, or we have shipped a 404 machine.
  assert.equal(safeNavigate('/careers', policy), '/careers');
  assert.equal(safeNavigate('#top', policy), '#top');
  assert.equal(safeNavigate('?page=2', policy), '?page=2');
  assert.equal(safeNavigate('./x', policy), './x');
  assert.equal(safeNavigate('../x', policy), '../x');
  assert.equal(safeNavigate('https://app.example.com/ok', policy), 'https://app.example.com/ok');
  assert.equal(safeNavigate('mailto:a@b.c', { ...policy, allowMailto: true }), 'mailto:a@b.c');
}

// ── G2: an expression cannot read a governed value held in scope ────────────
{
  const piiNode = { id: 'a', type: 'text', props: { text: PII }, meta: { security: { pii: true } } };
  const secretNode = { id: 'b', type: 'text', props: { text: 'board only' }, meta: { security: { protected: true } } };
  const ctx = { canViewPii: false };
  const leaks = (scope) => JSON.stringify(scope).includes(PII);

  // Every shape a scope can hold. The document is the ONLY one the old code caught.
  assert.ok(!leaks(buildScope({ state: { doc: { version: 1, root: [piiNode] } } }, ctx)), 'document');
  assert.ok(!leaks(buildScope({ state: { node: piiNode } }, ctx)), 'a SELECTED NODE — what an inspector holds');
  assert.ok(!leaks(buildScope({ state: { nodes: [piiNode] } }, ctx)), 'array of nodes');
  // Caught by the NODE check, not the document check — mutation testing showed that
  // restoring the strict `typeof version === 'number'` sniff keeps this green. The
  // liberal `root` check is defense-in-depth. Recorded so nobody mistakes which guard
  // is load-bearing.
  assert.ok(!leaks(buildScope({ state: { doc: { version: '1', root: [piiNode] } } }, ctx)), 'version as a string');
  assert.ok(!leaks(buildScope({ state: { a: { b: { c: { sel: piiNode } } } } }, ctx)), 'deeply nested node');
  assert.ok(!leaks(buildScope({ item: piiNode }, ctx)), 'a loop variable');

  // The expression itself, through the scope the runtime would build.
  assert.notEqual(evalExpr('state.node.props.text', buildScope({ state: { node: piiNode } }, ctx)), PII);
  assert.equal(evalExpr('state.node.props.text', buildScope({ state: { node: piiNode } }, ctx)), '•••••');

  // A protected node is not merely masked — it is absent.
  const scope = buildScope({ state: { node: secretNode } }, ctx);
  assert.equal(evalExpr('state.node.props.text', scope), undefined);

  // A permitted viewer still sees the value, or the mask is just a bug.
  assert.equal(evalExpr('state.node.props.text', buildScope({ state: { node: piiNode } }, { canViewPii: true })), PII);

  // Functions never survive into a scope; a scope value is never callable.
  assert.equal(buildScope({ f: () => 'x' }, ctx).f, undefined);

  // A raw scalar CANNOT be masked — nothing marks it as governed. This is the known
  // limit, and it is why `state` must be literal-only and may never be populated from
  // a governed node. Asserted so the limit is visible, not discovered.
  assert.ok(leaks(buildScope({ state: { email: PII } }, ctx)),
    'precondition: a raw scalar is undetectable — enforce literal-only state upstream');
}

// ── The scope brand: an unstripped scope is structurally unusable ───────────
// "No call site may hand a raw object to the evaluator" was a sentence in a comment.
// A comment is not an enforcement: a renderer that forgets is prevented from nothing.
{
  const piiNode = { id: 'a', type: 'text', props: { text: PII }, meta: { security: { pii: true } } };
  const raw = { state: { doc: { version: 1, root: [piiNode] } } };
  const safe = buildScope(raw, { canViewPii: false });
  const EXPR = 'state.doc.root[0].props.text';

  // Fails CLOSED — `undefined` renders as nothing, exactly like an unresolvable ref.
  assert.equal(evalInScope(EXPR, raw), undefined, 'an unbranded scope must be refused');
  assert.equal(evalInScope(EXPR, safe), '•••••', 'a branded scope yields the mask');
  assert.equal(evalInScope(EXPR, buildScope(raw, { canViewPii: true })), PII, 'a permitted viewer still reads it');
  assert.equal(evalInScope(EXPR, null), undefined);
  assert.equal(evalInScope(EXPR, 'nope'), undefined);

  // The brand is a SYMBOL, so a document — which is JSON — cannot name it.
  const forged = JSON.parse('{"state":{},"Symbol(atomkit.scope)":true,"@@atomkit.scope":true,"__brand":true}');
  assert.ok(!isScope(forged), 'a JSON object forged the brand');
  assert.equal(evalInScope('state', forged), undefined);

  // Non-enumerable, so a spread silently loses it. Losing it must fail closed.
  assert.ok(!isScope({ ...safe }), 'a spread scope kept the brand');
  assert.equal(evalInScope(EXPR, { ...safe }), undefined, 'a spread scope must be refused');
  assert.ok(!JSON.stringify(safe).includes('atomkit.scope'), 'the brand must not appear in JSON');

  // Interpolation fails closed the same way: braces removed, nothing substituted.
  assert.equal(interpolateInScope(`x {{${EXPR}}} y`, raw), 'x  y');
  assert.equal(interpolateInScope(`x {{${EXPR}}} y`, safe), 'x ••••• y');

  // And the raw evaluator still leaks — which is precisely why it is not exported.
  assert.equal(evalExpr(EXPR, raw), PII, 'evalExpr is a pure evaluator; governance lives at the scope boundary');
}

console.log('✓ gate tests passed (G5: control-char, protocol-relative, userinfo, suffix-spoof, scheme blocks + legitimate targets pass; G2: document/node/array/nested/loop-var all masked, protected absent, permitted viewer unaffected, raw-scalar limit asserted)');
