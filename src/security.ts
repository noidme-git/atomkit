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

/** Whether a node's textual content should be masked (declared PII, viewer not permitted). */
export function shouldMaskPii(meta: NodeMeta | undefined, ctx: RenderContext): boolean {
  return !!meta?.security?.pii && !ctx.canViewPii;
}

/**
 * Governance at egress: return a copy of the document with everything the viewer
 * may NOT see removed, and PII values masked — BEFORE it leaves the server. This
 * is the end-to-end guarantee: declare security/PII/consent on a node, strip it
 * server-side, and the client never receives what it isn't entitled to. Run this
 * on the server (in getServerSideProps / a route handler) before serialising the
 * document to the client; the renderer's per-node gating is defence-in-depth.
 */
export function stripDocument(doc: BuilderDocument, ctx: RenderContext): BuilderDocument {
  const strip = (nodes: BuilderNode[]): BuilderNode[] =>
    nodes
      .filter((n) => isNodeVisible(n, ctx))
      .map((n) => {
        let out: BuilderNode = n;
        if (shouldMaskPii(n.meta, ctx)) {
          const props = { ...n.props };
          if ('text' in props) props.text = '•••••';
          delete props.src;
          delete props.href;
          out = { ...n, props };
        }
        if (n.children) out = { ...out, children: strip(n.children) };
        return out;
      });
  return { ...doc, root: strip(doc.root) };
}
