# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — open a GitHub Security Advisory on
this repository (**Security → Report a vulnerability**). Do not file a public
issue for a suspected vulnerability. We aim to acknowledge within 3 business days.

## Supported versions

atomkit is **pre-1.0 (0.x)** — only the latest published minor receives fixes, and
minor versions may include breaking changes. Pin a version and read the
[CHANGELOG](./CHANGELOG.md) before upgrading.

## Security model / trust boundary

atomkit renders a JSON document to React. It defends, by construction:

- **No raw HTML, no `eval`** — content becomes escaped React text or whitelisted atoms; there is no `dangerouslySetInnerHTML` on user content.
- **Style whitelist + value sanitiser** — unknown properties dropped; values with `<>{};`, `url()`, `image-set()`, `cross-fade()`, `expression()`, `javascript:` rejected; length capped; `position: fixed/sticky` dropped; `z-index` capped.
- **URL guards** — `safeHref` (blocks `javascript:` / `data:` / protocol-relative `//host`), `safeImageSrc` (raster `data:` only, no SVG), length caps.
- **Governance** — per-node `protected` / `roles` / `pii` / `consentCategory`; **PII masked by value with subtree cascade**; `stripDocument(doc, ctx)` removes/masks at egress; analytics consent-gated.
- **Robustness** — parser caps (input size / node count / depth); prototype-pollution guards on `getPath` and the registry lookup; deterministic selector-safe ids.

## What the host must provide

- **Authentication** and the authoritative **consent / role** facts passed in `RenderContext`.
- The **Content-Security-Policy** (`connect-src` for data bindings, `img-src`, `frame-src`).
- **Colour contrast, focus indication, target size** — theme concerns not enforced here (`lint()` covers structural a11y only).
- Running **`stripDocument()` on the server** before serialising a document to an untrusted client (the renderer's per-node gating is defence-in-depth on top).

## Known limitations (0.x)

- **Compiled/static output** (`@noidmejs/atomkit-compiler`) cannot enforce *runtime* governance; that package fail-closes by omitting governed nodes.
- **`@noidmejs/atomkit-http`**'s proxy is a hostname-allow-list SSRF tier and is not yet IP-pinned.
- Not yet independently penetration-tested.
