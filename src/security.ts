import type { BuilderNode, BuilderDocument, NodeMeta } from './schema.js';

// The runtime permission/consent context passed to the renderer. The HOST app
// owns auth + consent and passes the resolved facts in; atomkit only enforces
// what each node declares in meta.security.
export interface RenderContext {
  /** May the viewer see nodes flagged security.protected? */
  canViewProtected?: boolean;
  /** May the viewer see nodes flagged security.pii (else they're masked)? */
  canViewPii?: boolean;
  /** Roles the viewer holds; a node with security.roles renders only on a match. */
  roles?: string[];
  /** Consent by category, e.g. { analytics: true, marketing: false }. */
  consent?: Record<string, boolean>;
  /** Optional placeholder for a gated node the viewer may not see. */
  renderProtectedPlaceholder?: (node: BuilderNode) => unknown;
}

/** Whether a node should render at all, given its security declarations. */
export function isNodeVisible(node: BuilderNode, ctx: RenderContext): boolean {
  if (node.hidden) return false;
  const sec = node.meta?.security;
  if (!sec) return true;
  if (sec.protected && !ctx.canViewProtected) return false;
  if (sec.roles && sec.roles.length > 0) {
    const have = new Set(ctx.roles ?? []);
    if (!sec.roles.some((r) => have.has(r))) return false;
  }
  if (sec.consentCategory && !ctx.consent?.[sec.consentCategory]) return false;
  return true;
}

/** Whether a node's own content should be masked (declared PII, viewer not permitted). */
export function shouldMaskPii(meta: NodeMeta | undefined, ctx: RenderContext): boolean {
  return !!meta?.security?.pii && !ctx.canViewPii;
}

/** Visual mask for redacted content. */
export const PII_MASK = '•••••';
/** Assistive-tech mask. A screen reader announces PII_MASK as "bullet bullet
 *  bullet…" (or skips it), conveying neither the content nor that it was
 *  redacted — so a11y text gets a word, not glyphs. */
export const PII_MASK_LABEL = 'Redacted';

// Masking is DENY-BY-DEFAULT over values, not an allow-list of prop names: a prop
// is only preserved if it is provably structural. Anything else — any type, any
// name, on a built-in or a custom atom — is masked or dropped. A new atom, a new
// prop, or an LLM-invented prop therefore fails CLOSED.

// Props that carry only layout/semantic structure: never viewer-visible content,
// never a locator. Values here are already value-sanitised by style.ts:clean().
const STRUCTURAL_PROPS = new Set([
  'as', 'level', 'contain', 'width', 'gutter', 'cols', 'min', 'gap', 'height',
  'wrap', 'ordered', 'marker', 'external',
  'viewBox', 'size', 'stroke', 'strokeWidth', 'fill', 'path',
]);

// Props that resolve to a network locator. A masked node must not fetch, embed or
// link the resource: the URL *is* frequently the identifier (a private video id,
// a signed object key, /patients/12345).
const LOCATOR_PROPS = new Set([
  'src', 'srcset', 'href', 'url', 'poster', 'action', 'formaction', 'background', 'data', 'ping', 'cite',
]);

/** Return a masked copy of a node — every non-structural value blanked, every
 *  locator dropped, and any data binding removed so no PII value survives (or is
 *  re-fetched). Masking is by VALUE: numbers, booleans and props of unknown
 *  atoms are masked exactly like strings. */
export function maskNode(node: BuilderNode): BuilderNode {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.props ?? {})) {
    if (STRUCTURAL_PROPS.has(k)) { props[k] = v; continue; }
    if (LOCATOR_PROPS.has(k)) continue;      // drop: the locator itself identifies
    if (v == null) continue;
    if (typeof v === 'object') continue;     // drop structured values wholesale
    props[k] = PII_MASK;                     // scalar of ANY type → masked
  }
  const out: BuilderNode = { ...node, props };
  delete out.data; // a masked node must not carry a static PII value nor fetch one
  if (node.a11y) {
    out.a11y = { ...node.a11y };
    if (out.a11y.ariaLabel) out.a11y.ariaLabel = PII_MASK_LABEL;
    if (out.a11y.alt) out.a11y.alt = PII_MASK_LABEL;
    delete out.a11y.ariaDescribedby;
  }
  if (node.meta?.analytics?.props) {
    out.meta = { ...node.meta, analytics: { ...node.meta.analytics, props: undefined } };
  }
  return out;
}

// Header names that carry a server credential. A document's api binding is sent
// to the client verbatim, so any of these would hand every viewer the token.
const CREDENTIAL_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token)$/i;

/** Remove authoring/server-only fields that must never reach a client, on EVERY
 *  node — masked or not. `meta.note` is documented "never rendered" but was still
 *  serialized into the page; api-binding headers may carry a bearer token. */
function stripEgressOnly(node: BuilderNode): BuilderNode {
  let out = node;
  if (node.meta && node.meta.note !== undefined) {
    const meta = { ...node.meta };
    delete meta.note;
    out = { ...out, meta };
  }
  const src = out.data?.source;
  if (src?.kind === 'api' && src.headers) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(src.headers)) if (!CREDENTIAL_HEADER.test(k)) headers[k] = v;
    const source = { ...src, ...(Object.keys(headers).length ? { headers } : {}) };
    if (!Object.keys(headers).length) delete (source as { headers?: unknown }).headers;
    out = { ...out, data: { ...out.data!, source } };
  }
  return out;
}

/**
 * Governance at egress: return a copy of the document with everything the viewer
 * may NOT see removed, and PII masked BY VALUE — BEFORE it leaves the server.
 * PII masking cascades to descendants, so flagging a container `pii` protects its
 * whole subtree. This is the end-to-end guarantee: declare on a node, strip
 * server-side, and the client never receives what it isn't entitled to. The
 * renderer's per-node gating is defence-in-depth on top of this.
 */
export function stripDocument(doc: BuilderDocument, ctx: RenderContext): BuilderDocument {
  const strip = (nodes: BuilderNode[], maskedAncestor: boolean): BuilderNode[] =>
    nodes
      .filter((n) => isNodeVisible(n, ctx))
      .map((n) => {
        const masked = maskedAncestor || shouldMaskPii(n.meta, ctx);
        let out = stripEgressOnly(masked ? maskNode(n) : n);
        if (n.children) out = { ...out, children: strip(n.children, masked) };
        return out;
      });
  return { ...doc, root: strip(doc.root, false) };
}
