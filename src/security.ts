import type { BuilderNode, NodeMeta } from './schema.js';

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
