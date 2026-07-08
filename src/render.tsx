import { createElement, Fragment, type ReactNode } from 'react';
import type { BuilderNode, BuilderDocument } from './schema';
import type { Registry, AtomRenderProps } from './registry';
import type { RenderContext } from './security';
import { isNodeVisible } from './security';
import { resolveStyle, mediaCss } from './style';
import { DataBound } from './data';

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
): ReactNode {
  if (!isNodeVisible(node, ctx)) {
    const ph = ctx.renderProtectedPlaceholder?.(node);
    return ph ? createElement(Fragment, { key: node.id }, ph as ReactNode) : null;
  }
  const def = registry[node.type];
  if (!def) return null; // unknown type → skip (fail-closed against stale/hand-edited docs)

  const className = node.style?.responsive ? `ak-${node.id}` : undefined;
  if (className) collect(mediaCss(`.${className}`, node.style?.responsive));

  const style = resolveStyle(node.style);
  const children = node.children?.length
    ? node.children.map((c) => renderNode(c, registry, ctx, collect))
    : undefined;
  const a11y = a11yAttrs(node);
  const analytics = analyticsAttrs(node);

  const renderWith = (data: unknown): ReactNode => {
    const bindTo = node.data?.bindTo ?? 'text';
    const props: Record<string, unknown> =
      data !== undefined ? { ...node.props, [bindTo]: data } : { ...node.props };
    const atomProps: AtomRenderProps = { node, props, style, className, children, ctx, a11y, analytics };
    return def.render(atomProps);
  };

  if (node.data?.source.kind === 'api') {
    return createElement(DataBound, { key: node.id, binding: node.data, render: renderWith });
  }
  const staticData = node.data?.source.kind === 'static' ? node.data.source.value : undefined;
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
