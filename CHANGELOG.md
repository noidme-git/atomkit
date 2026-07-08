# Changelog

All notable changes to `@noidmejs/atomkit`. Pre-1.0: minor versions may break.

## 0.5.1
### Fixed
- **AQL parser**: an unquoted URL value (`href=https://…`) was truncated at `//`
  and the rest of the line swallowed as a comment. `//` now starts a trailing
  comment only at head start or after whitespace, so unquoted `https://` URLs (and
  the attributes after them) parse correctly. Quoted URLs were unaffected.

## 0.5.0
### Security / privacy (from the adversarial audit)
- **PII masking is now by VALUE**: masks the data-binding target prop, content
  props (`summary`/`label`/`value`/`title`/`caption`/`alt`), `a11y` label text and
  analytics prop values, and drops the data binding — not just `text`/`src`/`href`.
- **PII masking cascades to descendants**: flagging a container `pii` protects its
  whole subtree, in both `renderNode` and `stripDocument`.
- Registry lookup uses `Object.hasOwn` — a `node.type` naming an `Object.prototype`
  member (`constructor`, `toString`, …) now fails closed instead of throwing.
- `clean()` also rejects the URL-bearing CSS functions `image-set()` / `cross-fade()`.
### Accessibility
- `List` restores `role="list"` / `role="listitem"` when markers are removed (WCAG 1.3.1).
- New `lint(document)` — WCAG-oriented warnings (missing image `alt`, unnamed controls, heading level).

## 0.4.0
- Security hardening + **governance-at-egress** (`stripDocument`); deterministic
  selector-safe ids; `url()` + style guards; `getPath` prototype-pollution guard;
  parser caps (size / nodes / depth); consent-gated analytics.

## 0.3.0
- Richer atom set (`section`/`container`/`grid`/`row`/`stack`/`link`/`chip`/`list`/`icon`/`accordion`/`video`); char-level AQL parser (inline + multi-line blocks).

## 0.2.0
- **AQL** query language (`parse`/`compilePage`/`serialize`) + AI bridge (`systemPrompt`/`generate`); Node-portable ESM (NodeNext).

## 0.1.0
- Initial release: document model, SSR-safe renderer, starter atoms, `createBuilder`.
