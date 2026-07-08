import { createElement, Fragment, type ReactNode } from 'react';
import type { BuilderNode, BuilderDocument } from './schema.js';
import type { Registry, AtomRenderProps } from './registry.js';
import type { RenderContext } from './security.js';
import { isNodeVisible, shouldMaskPii, maskNode, PII_MASK } from './security.js';
import { resolveStyle, mediaCss } from './style.js';
import { DataBound } from './data.js';

function a11yAttrs(node: BuilderNode): Record<string, unknown> {
  const a = node.a11y;
  if (!a) return {};
  const out: Record<string, unknown> = {};
  if (a.role) out.role = a.role;
  if (a.ariaLabel) out['aria-label'] = a.ariaLabel;
  if (a.ariaHidden) out['aria-hidden'] = true;
  if (a.ariaDescribedby) out['aria-describedby'] = a.ariaDescribedby;
  if (typeof a.tabIndex === 'number') out.tabIndex = a.tabIndex;
  if (a.lang) out.lang = a.lang;
  return out;
}

function analyticsAttrs(node: BuilderNode): Record<string, string> {
  const an = node.meta?.analytics;
  if (!an) return {};
  const out: Record<string, string> = {};
  if (an.id) out['data-analytics-id'] = an.id;
  if (an.event) out['data-analytics-event'] = an.event;
  if (an.category) out['data-analytics-category'] = an.category;
  if (an.props) for (const [k, v] of Object.entries(an.props)) out[`data-analytics-${k}`] = v;
  return out;
}

/** Render one node (and its subtree) to React. `collect` gathers generated
 *  responsive CSS to be emitted once at the document root. */
export function renderNode(
  node: BuilderNode,
  registry: Registry,
  ctx: RenderContext,
  collect: (css: string) => void,
  maskedAncestor = false,
): ReactNode {
  if (!isNodeVisible(node, ctx)) {
    const ph = ctx.renderProtectedPlaceholder?.(node);
    return ph ? createElement(Fragment, { key: node.id }, ph as ReactNode) : null;
  }
  // Own-property lookup only — stop Object.prototype members ('constructor',
  // 'toString', …) used as a node.type from resolving through the prototype chain.
  if (!Object.hasOwn(registry, node.type)) return null; // unknown type → fail-closed
  const def = registry[node.type]!;

  // PII masking — own node OR inherited from a masked ancestor (subtree cascade),
  // enforced HERE for EVERY atom, by value, fail-closed. `eff` is the masked view.
  const masked = maskedAncestor || shouldMaskPii(node.meta, ctx);
  const eff = masked ? maskNode(node) : node;

  // Only use the node id as a CSS selector when it is selector-safe (closes the
  // "id → .ak-<id> selector" injection half of the chained CSS-exfil bug).
  const idSafe = /^[A-Za-z0-9_-]+$/.test(node.id);
  const className = node.style?.responsive && idSafe ? `ak-${node.id}` : undefined;
  if (className) collect(mediaCss(`.${className}`, node.style?.responsive));

  const style = resolveStyle(node.style);
  const children = node.children?.length
    ? node.children.map((c) => renderNode(c, registry, ctx, collect, masked))
    : undefined;
  const a11y = a11yAttrs(eff);
  // Analytics attributes are consent-gated — suppressed when analytics consent is denied.
  const analytics = ctx.consent?.analytics === false ? {} : analyticsAttrs(eff);

  const renderWith = (data: unknown): ReactNode => {
    const bindTo = eff.data?.bindTo ?? 'text';
    const props: Record<string, unknown> = { ...eff.props };
    if (data !== undefined) props[bindTo] = masked ? PII_MASK : data;
    const atomProps: AtomRenderProps = { node, props, style, className, children, ctx, a11y, analytics };
    return def.render(atomProps);
  };

  // A masked node's data binding was dropped by maskNode, so it neither fetches
  // nor surfaces a static PII value.
  if (eff.data?.source.kind === 'api') {
    return createElement(DataBound, { key: node.id, binding: eff.data, render: renderWith });
  }
  const staticData = eff.data?.source.kind === 'static' ? eff.data.source.value : undefined;
  return createElement(Fragment, { key: node.id }, renderWith(staticData));
}

export interface RenderProps {
  document: BuilderDocument;
  registry: Registry;
  context?: RenderContext;
}

/**
 * Render a builder document to React. Server-safe: static content resolves on the
 * server; API-bound nodes render their fallback then hydrate on the client. A
 * single <style> with any responsive rules is emitted at the top.
 */
export function Render({ document: doc, registry, context }: RenderProps): ReactNode {
  const ctx = context ?? {};
  const css: string[] = [];
  const nodes = doc.root.map((n) => renderNode(n, registry, ctx, (c) => { if (c) css.push(c); }));
  const sheet = css.join('');
  return createElement(
    Fragment,
    null,
    sheet ? createElement('style', { key: '__ak_css' }, sheet) : null,
    ...nodes,
  );
}
