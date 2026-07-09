// atomkit — headless, SSR-safe, atom-based visual builder.
// Every atom carries its styling, data-binding, a11y, analytics and security as
// data; render a JSON document to React on the server or the client.
export * from './schema.js';
export * from './style.js';
export * from './security.js';
export * from './registry.js';
export * from './render.js';
export * from './url.js';
export * from './lint.js';
export * from './instrument.js';
// NOT exported: './expr.js'.
//
// The expression evaluator has zero call sites — nothing evaluates `{{ }}` yet — and
// its contract is unsettled: the AQL 1.0 spec wants a root allowlist inside
// `parseExpr`, while the governance gate's G7 records that there deliberately is
// none. Publishing would freeze both as a semver commitment before either question
// is answered. It ships when it has a consumer and a settled surface.
export * from './query.js';
export * from './ai.js';
export { DataBound, getPath } from './data.js';
export { defaultAtoms } from './atoms.js';
