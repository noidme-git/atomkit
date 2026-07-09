// parseDocument / documentSchema — the validation boundary.
//
// This suite exists because there was none. `npm test` was fully green while
// parseDocument, documentSchema and nodeSchema were never once exercised, so the
// strict unknown-key rejection that governance leans on was unverified — and
// under a zod major bump it could have silently changed with the tests still
// passing.
//
// Strictness is uniform as of 0.7.0: EVERY object in the document rejects
// unknown keys. Previously only the node level did, so `a11y: { onclick: ... }`,
// `meta.security: { bypass: true }` and `data.source: { evil: 1 }` all validated
// cleanly. Nothing read those keys, so it was never exploitable — but a schema
// that shrugs at input it does not understand is not a trust boundary.

import assert from 'node:assert/strict';
import { parseDocument } from '../dist/index.js';

const doc = (root) => ({ version: 1, root });
const rejects = (d, what) => assert.throws(() => parseDocument(d), what);
const accepts = (d) => parseDocument(d);

// ── A well-formed document validates, and comes back typed ───────────────────
{
  const ok = accepts(doc([
    {
      id: 'a', type: 'text',
      props: { text: 'hello', level: 2, flag: true },
      style: { fontSize: '12px', responsive: { md: { fontSize: '4rem' } } },
      a11y: { role: 'note', ariaLabel: 'L', ariaHidden: true, ariaDescribedby: 'd', tabIndex: 0, alt: 'A', lang: 'fr' },
      meta: {
        tags: ['x'],
        analytics: { id: 'cta', event: 'click', category: 'nav', props: { plan: 'pro' } },
        security: { protected: true, roles: ['admin'], pii: true, consentCategory: 'marketing' },
        note: 'editor only',
      },
      data: { source: { kind: 'api', url: 'https://api.example.com/x', method: 'GET', path: 'a.b', ttl: 30 }, bindTo: 'text' },
      children: [{ id: 'b', type: 'text', props: { text: 'child' } }],
      hidden: false,
    },
  ]));
  assert.equal(ok.root[0].children[0].id, 'b', 'nested children survive validation');
  accepts(doc([{ id: 's', type: 'text', data: { source: { kind: 'static', value: { any: 'json' } } } }]));
}

// ── Unknown keys are rejected at EVERY level (this is the trust boundary) ────
{
  const unknownKey = /unrecognized_keys|Unrecognized key/i;
  rejects(doc([{ id: 'a', type: 'text', onclick: 'alert(1)' }]), unknownKey);
  rejects(doc([{ id: 'a', type: 'text', a11y: { role: 'note', onclick: 'alert(1)' } }]), unknownKey);
  rejects(doc([{ id: 'a', type: 'text', meta: { evil: 'x' } }]), unknownKey);
  rejects(doc([{ id: 'a', type: 'text', meta: { analytics: { id: 'x', evil: 'y' } } }]), unknownKey);
  rejects(doc([{ id: 'a', type: 'text', meta: { security: { pii: true, bypass: true } } }]), unknownKey);
  rejects(doc([{ id: 'a', type: 'text', data: { source: { kind: 'api', url: 'https://x/y' }, evil: 1 } }]), unknownKey);
  rejects(doc([{ id: 'a', type: 'text', children: [{ id: 'b', type: 'text', onclick: 'alert(1)' }] }]), unknownKey);
  rejects({ version: 1, root: [], meta: { title: 't', evil: 1 } }, unknownKey);
  rejects({ version: 1, root: [], evil: 1 }, unknownKey);
  // data.source is a discriminated-ish union; an unknown key must not slip through either arm.
  rejects(doc([{ id: 'a', type: 'text', data: { source: { kind: 'static', value: 1, evil: 2 } } }]), /.*/);
}

// ── Structural violations are rejected ───────────────────────────────────────
{
  rejects(doc([{ type: 'text' }]), /invalid_type|Invalid input/i);            // missing id
  rejects(doc([{ id: 42, type: 'text' }]), /invalid_type|Invalid input/i);    // wrong-typed id
  rejects(doc([{ id: 'a' }]), /invalid_type|Invalid input/i);                 // missing type
  rejects({ version: 1, root: { id: 'a', type: 'text' } }, /invalid_type|Invalid input/i); // root not an array
  rejects({ version: '1', root: [] }, /invalid_type|Invalid input/i);         // version not a number
  rejects(doc([{ id: 'a', type: 'text', hidden: 'yes' }]), /invalid_type|Invalid input/i);
  rejects(doc([{ id: 'a', type: 'text', a11y: { tabIndex: '0' } }]), /invalid_type|Invalid input/i);
  rejects(doc([{ id: 'a', type: 'text', meta: { tags: 'x' } }]), /invalid_type|Invalid input/i);
  rejects(doc([{ id: 'a', type: 'text', data: { source: { kind: 'api', url: 'https://x/y', method: 'DELETE' } } }]), /.*/);
}

// ── Depth: strictness holds arbitrarily deep, not just at the root ───────────
{
  let node = { id: 'deep', type: 'text', onclick: 'alert(1)' };
  for (let i = 0; i < 6; i++) node = { id: `n${i}`, type: 'box', children: [node] };
  rejects(doc([node]), /unrecognized_keys|Unrecognized key/i);
}

// ── props stays permissive on purpose (atoms own their prop contract) ────────
{
  accepts(doc([{ id: 'a', type: 'custom-atom', props: { anything: 1, nested: { deep: true }, arr: [1, 2] } }]));
}

console.log('✓ schema tests passed (parseDocument: strict unknown-key rejection at every level, structural validation, depth, permissive props)');
