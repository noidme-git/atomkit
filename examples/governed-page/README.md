# A governed careers page

The wedge, in one file. Every block declares who may see it; `stripDocument` enforces it at egress.

```bash
npm install @noidmejs/atomkit react react-dom
node preview.mjs            # all four viewers
node preview.mjs recruiter  # just one
```

## What it proves

| | public | recruiter | consented | admin |
|---|---|---|---|---|
| salary band (`roles=recruiter`) | 🚫 | 👁 | 🚫 | 👁 |
| recruiter email (`pii`) | 🔒 mask | 🔒 mask | 🔒 mask | 👁 |
| board hiring plan (`protected`) | 🚫 | 🚫 | 🚫 | 👁 |
| marketing block (`consent=marketing`) | 🚫 | 🚫 | 👁 | 👁 |
| `data-analytics-*` | 🚫 | 🚫 | 👁 | 👁 |

Public page: **1422 bytes**. Admin page: **2513 bytes**. The difference was never sent.

Not `display:none`. Not blurred. Not masked in the DOM and un-masked by devtools. The node is removed from the
document before the renderer ever sees it, so the bytes do not exist in the response.

`preview.mjs` is a test, not a slideshow: it asserts every one of those cells and exits non-zero on a leak.

## To serve it for real

```bash
npx @noidmejs/atomkit-app dev     # http://localhost:3300
npx @noidmejs/atomkit-app build   # static HTML + ejected React
```

`atomkit.config.json` sets the **public** persona, least-privilege by default (`canViewPii: false`,
`canViewProtected: false`, `roles: []`, `analytics: false`). A page cannot leak governed content merely by being
served.

## The honest caveat

`atomkit-app build` also ejects each page to standalone React. **Governed nodes are omitted from the ejected
component**, because static output cannot enforce per-viewer gating and must not pretend to. The compiler says so
in the emitted file:

```
// atomkit-compiler: omitted 2 governed/hidden node(s) — static output cannot enforce
// runtime governance (role/consent/PII gating); render those via the @noidmejs/atomkit runtime.
```

So *governed by construction* and *portable by default* do not both hold for the same page. Eject a public page and
you own the code. Eject a governed page and you own a public subset of it. That tension is real, named, and
unresolved — see `docs/CEO-RULING.md`.
