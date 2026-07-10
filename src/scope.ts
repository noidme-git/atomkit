// scope.ts — strip-before-scope. The ONE sanctioned constructor of an expression
// scope.
//
// No call site may hand a raw object to evaluate()/interpolate()/evalExpr(): the
// scope MUST come from buildScope, so governance holds at the scope boundary and
// nowhere else has to remember to.
//
// Why this file exists. ADR-003/005 established that ordering — stripDocument, then
// render — is NECESSARY but NOT SUFFICIENT. An editor holds the UNSTRIPPED authoring
// document by definition (it is the thing being edited). The moment that document
// lands in an expression scope, e.g. `render-document document={{state.doc}}`, an
// expression reads straight around the mask:
//
//     evalExpr("state.doc.root[0].props.text", { state: { doc } })  ->  raw PII
//
// That is governance-gate.mjs G2, reproduced against published @noidmejs/atomkit.
//
// strip-before-scope closes it: every value that enters an expression scope is
// derived only from the STRIPPED document, from AST literals, or from governed
// runtime events. A BuilderDocument is NOT a legal expression-scope leaf. If one is
// ever handed in anyway, it is stripped with the render context on the way in —
// fail-closed to the mask — so an expression can only ever read the masked view.
//
// The document that the canvas actually renders does NOT travel through here. It
// lives in a separate `documents` channel that render-document-class CODE atoms read
// directly and strip at their own egress (see spike/g2-strip-before-scope.mjs).
// buildScope governs the EXPRESSION channel; the two never mix.

import { stripDocument } from './security.js';
import type { RenderContext } from './security.js';
import type { BuilderDocument, BuilderNode } from './schema.js';
import type { Scope } from './expr.js';
import { evalExpr, interpolate, type Scope as ExprScope } from './expr.js';

/** Keys that can reach the prototype chain. Never copied into a scope. Mirrors the
 *  evaluator's own FORBIDDEN_KEYS; JSON.parse can mint a genuine own `__proto__`. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Bound on scope-value recursion, so a deep or cyclic state cannot turn scope
 *  construction into a denial of service. */
const MAX_SCOPE_DEPTH = 64;

/**
 * A value is document-shaped iff it is a plain object carrying the BuilderDocument
 * discriminants: a numeric `version` and an array `root`. State is untyped at
 * runtime, so the check is structural — anything that could be handed to `Render`
 * as a document is treated as one here and stripped.
 */
function isDocumentShaped(v: unknown): v is BuilderDocument {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  // Liberal on purpose: an array `root` is enough. A shape sniff stricter than the
  // thing it guards is a hole, not a check. (Defense in depth: mutation testing shows
  // a `{version:"1", root:[piiNode]}` is in fact caught by `isNodeShaped` on the
  // element. This check exists so a document-level guarantee never depends on that.)
  return Array.isArray(o.root);
}

/**
 * A value is NODE-shaped iff it carries the BuilderNode discriminants.
 *
 * This was missing, and it is the shape that matters most: a composer's inspector
 * holds the SELECTED NODE by definition, not a whole document. `buildScope` masked
 * documents and rebuilt everything else field-by-field, so `state.node.props.text`
 * returned raw PII. Found by the CTO gate; reproduced in one line.
 */
function isNodeShaped(v: unknown): v is BuilderNode {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.type === 'string';
}

/**
 * Strip one node through the SAME audited path the renderer uses. Wrapping it in a
 * throwaway document and calling `stripDocument` means there is exactly one
 * implementation of "what a viewer may see" — a second one would drift.
 * Returns `undefined` when the viewer may not see the node at all.
 */
function stripNode(n: BuilderNode, ctx: RenderContext): BuilderNode | undefined {
  return stripDocument({ version: 1, root: [n] }, ctx).root[0];
}

/**
 * Recursively sanitise one scope value:
 *   - document-shaped  -> stripDocument(ctx)   (backstop: masked view, never raw)
 *   - function         -> dropped (undefined)  (a scope value is never callable)
 *   - array            -> element-wise sanitise
 *   - plain object     -> rebuilt from own, non-prototype keys, recursively
 *   - scalar           -> kept as-is
 * Depth-capped. Objects are rebuilt (not spread) so a hostile own `__proto__`
 * cannot ride along.
 */
function sanitize(v: unknown, ctx: RenderContext, depth: number): unknown {
  if (depth > MAX_SCOPE_DEPTH) return undefined;
  if (v == null) return v;
  if (isDocumentShaped(v)) return stripDocument(v, ctx);
  if (isNodeShaped(v)) return stripNode(v, ctx);
  const t = typeof v;
  if (t === 'function') return undefined;
  if (t !== 'object') return v; // string | number | boolean | bigint | symbol
  if (Array.isArray(v)) return v.map((e) => sanitize(e, ctx, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    const s = sanitize(val, ctx, depth + 1);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

/** The named channels a scope may carry. Everything is optional; extra keys (a loop
 *  variable, say) are permitted and sanitised identically. */
export interface BuildScopeInput {
  /** Page/component state. Literal-only by construction upstream; sanitised here. */
  state?: Record<string, unknown>;
  /** The current loop element, bound by `for item in <expr>`. */
  item?: unknown;
  /** A runtime event payload (e.g. { id } from a canvas select). */
  event?: unknown;
  /** Data-source params. */
  params?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Build an expression scope that is safe to hand to evaluate()/interpolate().
 *
 * strip-before-scope: every BuilderDocument found anywhere in `raw` is stripped with
 * `ctx` before it can be read, so an expression can never reach a value the renderer
 * would have masked. Functions are dropped; prototype keys are dropped; the result
 * is deep-frozen so nothing downstream can widen it.
 *
 * This is the ONLY sanctioned way to construct a Scope. A raw object literal handed
 * to the evaluator is a governance bug by definition.
 */
export function buildScope(raw: BuildScopeInput, ctx: RenderContext = {}): Scope {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    out[k] = sanitize(v, ctx, 0);
  }
  // Brand it. The rule "no call site may hand a raw object to the evaluator" was, until
  // now, a sentence in a comment. A comment is not an enforcement: a renderer that
  // forgets is prevented from nothing. The brand makes an unstripped scope structurally
  // unusable at the one entry point that matters (`evalInScope`).
  //
  // Non-enumerable, so it never appears in JSON, in an expression, or in a diff.
  Object.defineProperty(out, SCOPE_BRAND, { value: true, enumerable: false, writable: false, configurable: false });
  return deepFreeze(out) as Scope;
}

/** Marks a value as having passed through `buildScope`. A symbol, so a hostile
 *  document cannot forge it: a JSON document has no way to name a symbol key. */
const SCOPE_BRAND: unique symbol = Symbol.for('atomkit.scope');

/** Did this scope come from `buildScope`? */
export function isScope(v: unknown): v is Scope {
  return !!v && typeof v === 'object' && (v as Record<symbol, unknown>)[SCOPE_BRAND] === true;
}

/**
 * The ONE sanctioned way to evaluate an AQL expression.
 *
 * Refuses any scope that did not come from `buildScope`, and fails CLOSED — an
 * unbranded scope yields `undefined`, which renders as nothing, exactly as an
 * unresolvable reference does. It never throws into the renderer.
 *
 * `evalExpr` remains a pure evaluator over whatever it is handed; it is not exported
 * from the package. Governance lives at the scope boundary, so no other code has to
 * remember to.
 */
export function evalInScope(src: string, scope: unknown): unknown {
  if (!isScope(scope)) return undefined;
  return evalExpr(src, scope as Scope);
}

/** Interpolate `{{ … }}` in a template, through a branded scope only. */
export function interpolateInScope(template: string, scope: unknown): unknown {
  if (!isScope(scope)) return typeof template === 'string' ? template.replace(/\{\{[^}]*\}\}/g, '') : template;
  return interpolate(template, scope as Scope);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
