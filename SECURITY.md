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
- **Style whitelist + value sanitiser** — unknown properties dropped; values with `<>{};`, `url()`, `image-set()`, `cross-fade()`, `expression()`, `javascript:` rejected; length capped; `position: fixed/sticky` dropped; `z-index` capped. Dimension props that reach an inline style through `node.props` (`width`, `gutter`, `min`, `height`) are held to the same bar via `safeDim()`.
- **URL guards** — `safeHref` (blocks `javascript:` / `data:` / protocol-relative `//host`), `safeImageSrc` (raster `data:` only, no SVG), length caps.
- **Governance** — per-node `protected` / `roles` / `pii` / `consentCategory`; **PII masked by value with subtree cascade** — every non-structural prop is masked or dropped regardless of its name or type (numbers, booleans, locators such as `url`/`src`/`href`, and props of custom atoms all fail closed); `stripDocument(doc, ctx)` removes/masks at egress and also strips `meta.note` and credential-bearing binding headers; analytics attributes require an **explicit** `consent.analytics === true`.
- **Robustness** — parser caps (input size / node count / depth); prototype-pollution guards on `getPath` and the registry lookup; deterministic selector-safe ids.

## Known gaps

Stated plainly, because a guarantee you cannot rely on is worse than none:

- **`Render()` does not validate.** Only the AQL path runs `parseDocument`. Hand-authored JSON reaches `renderNode` unvalidated, and the JSON path has no depth or node-count cap (AQL does) — a deeply nested document can overflow the stack during SSR. Validate untrusted JSON with `parseDocument()` yourself.
- **Client-side data bindings are not allow-listed.** `DataBound` fetches a bound node's `url` with the document's method/headers/body and the browser's default `same-origin` credentials. `connect-src 'self'` does not stop same-origin requests. **Treat a document as trusted input, or render it server-side only.**
- **Node ids are not checked for uniqueness.** Duplicate ids collide as React keys and cross-apply responsive CSS.
- **`document.version` is never inspected**, so a stored document is always reinterpreted under current semantics.
- **No DNS/IP pinning** anywhere in the stack; the SSRF guards are hostname-level. Not pen-tested.

## What the host must provide

- **Authentication** and the authoritative **consent / role** facts passed in `RenderContext`. Nothing is granted by default: `canViewPii`, `canViewProtected` and `consent.analytics` must be exactly `true` to take effect.
- The **Content-Security-Policy** (`connect-src` for data bindings, `img-src`, `frame-src`).
- **Colour contrast, focus indication, target size** — theme concerns not enforced here (`lint()` covers structural a11y only).
- Running **`stripDocument()` on the server** before serialising a document to an untrusted client (the renderer's per-node gating is defence-in-depth on top).

## Known limitations (0.x)

- **Compiled/static output** (`@noidmejs/atomkit-compiler`) cannot enforce *runtime* governance; that package fail-closes by omitting governed nodes.
- **`@noidmejs/atomkit-http`**'s proxy is a hostname-allow-list SSRF tier and is not yet IP-pinned.
- Not yet independently penetration-tested.
