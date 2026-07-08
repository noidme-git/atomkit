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

export const PII_MASK = '•••••';

// Renderable content props an atom may surface as visible text/media. When a
// node is masked we blank these + its data-binding target, drop link/media
// locators, mask a11y label text, drop analytics prop values, and drop the data
// binding entirely — masking by VALUE, not just the fixed text/src/href names.
const CONTENT_PROPS = ['text', 'label', 'value', 'summary', 'title', 'caption', 'alt'];

/** Return a masked copy of a node — every renderable content value blanked and
 *  any data binding removed so no PII value survives (or is re-fetched). */
export function maskNode(node: BuilderNode): BuilderNode {
  const props: Record<string, unknown> = { ...(node.props ?? {}) };
  const targets = new Set<string>(CONTENT_PROPS);
  if (node.data?.bindTo) targets.add(node.data.bindTo);
  for (const k of targets) if (typeof props[k] === 'string') props[k] = PII_MASK;
  delete props.src;
  delete props.href;
  const out: BuilderNode = { ...node, props };
  delete out.data; // a masked node must not carry a static PII value nor fetch one
  if (node.a11y) {
    out.a11y = { ...node.a11y };
    if (out.a11y.ariaLabel) out.a11y.ariaLabel = PII_MASK;
    if (out.a11y.alt) out.a11y.alt = PII_MASK;
    delete out.a11y.ariaDescribedby;
  }
  if (node.meta?.analytics?.props) {
    out.meta = { ...node.meta, analytics: { ...node.meta.analytics, props: undefined } };
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
        let out = masked ? maskNode(n) : n;
        if (n.children) out = { ...out, children: strip(n.children, masked) };
        return out;
      });
  return { ...doc, root: strip(doc.root, false) };
}
