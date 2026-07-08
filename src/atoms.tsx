import { createElement, type CSSProperties, type ReactNode } from 'react';
import type { AtomRenderProps, Registry } from './registry.js';
import { safeHref, safeImageSrc } from './url.js';
import { shouldMaskPii } from './security.js';
import { VideoEmbed } from './media.js';

const asStr = (v: unknown, fallback = ''): string => (v == null ? fallback : String(v));
const isFalse = (v: unknown): boolean => v === false || v === 'false';
const isTrue = (v: unknown): boolean => v === true || v === 'true';

// ── Layout ───────────────────────────────────────────────────────────────────
const BOX_TAGS = new Set(['div', 'section', 'header', 'footer', 'main', 'article', 'aside', 'nav', 'ul', 'ol', 'li']);
function Box({ props, style, className, children, a11y, analytics }: AtomRenderProps): ReactNode {
  const tag = BOX_TAGS.has(asStr(props.as)) ? asStr(props.as) : 'div';
  return createElement(tag, { className, style, ...a11y, ...analytics }, children);
}

// Section — full-bleed <section> with default vertical padding; by default wraps
// its children in a centred max-width container (contain=false to go full-bleed).
function Section({ props, style, className, children, a11y, analytics }: AtomRenderProps): ReactNode {
  const inner = isFalse(props.contain)
    ? children
    : createElement(
        'div',
        { style: { maxWidth: asStr(props.width, '1200px'), marginLeft: 'auto', marginRight: 'auto', paddingLeft: asStr(props.gutter, '20px'), paddingRight: asStr(props.gutter, '20px') } },
        children,
      );
  return createElement('section', { className, style: { paddingTop: '72px', paddingBottom: '72px', ...style }, ...a11y, ...analytics }, inner);
}

function Container({ props, style, className, children, a11y, analytics }: AtomRenderProps): ReactNode {
  return createElement(
    'div',
    { className, style: { maxWidth: asStr(props.width, '1200px'), marginLeft: 'auto', marginRight: 'auto', paddingLeft: asStr(props.gutter, '20px'), paddingRight: asStr(props.gutter, '20px'), ...style }, ...a11y, ...analytics },
    children,
  );
}

// Grid — cols=N for equal columns, or min=240px for a responsive auto-fit grid.
function Grid({ props, style, className, children, a11y, analytics }: AtomRenderProps): ReactNode {
  const cols = Math.round(Number(props.cols)) || 0;
  const min = props.min ? asStr(props.min) : '';
  const template = min ? `repeat(auto-fit,minmax(${min},1fr))` : cols ? `repeat(${cols},minmax(0,1fr))` : undefined;
  const s: CSSProperties = { display: 'grid', gap: '16px', ...(template ? { gridTemplateColumns: template } : {}), ...style };
  return createElement('div', { className, style: s, ...a11y, ...analytics }, children);
}

function Row({ props, style, className, children, a11y, analytics }: AtomRenderProps): ReactNode {
  const s: CSSProperties = { display: 'flex', flexDirection: 'row', gap: '16px', flexWrap: isFalse(props.wrap) ? 'nowrap' : 'wrap', alignItems: 'center', ...style };
  return createElement('div', { className, style: s, ...a11y, ...analytics }, children);
}

function Stack({ style, className, children, a11y, analytics }: AtomRenderProps): ReactNode {
  return createElement('div', { className, style: { display: 'flex', flexDirection: 'column', gap: '12px', ...style }, ...a11y, ...analytics }, children);
}

// ── Content ──────────────────────────────────────────────────────────────────
const TEXT_TAGS = new Set(['p', 'span', 'div', 'small', 'strong', 'em', 'label', 'blockquote']);
function Text({ node, props, style, className, ctx, a11y, analytics }: AtomRenderProps): ReactNode {
  const tag = TEXT_TAGS.has(asStr(props.as)) ? asStr(props.as) : 'p';
  const text = shouldMaskPii(node.meta, ctx) ? '•••••' : asStr(props.text);
  return createElement(tag, { className, style, ...a11y, ...analytics }, text);
}

function Heading({ props, style, className, a11y, analytics }: AtomRenderProps): ReactNode {
  const level = Math.min(6, Math.max(1, Math.round(Number(props.level)) || 2));
  return createElement(`h${level}`, { className, style, ...a11y, ...analytics }, asStr(props.text));
}

function Link({ props, style, className, a11y, analytics }: AtomRenderProps): ReactNode {
  const ext = props.external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  return createElement('a', { href: safeHref(props.href), className, style, ...ext, ...a11y, ...analytics }, asStr(props.text, 'link'));
}

function Button({ props, style, className, a11y, analytics }: AtomRenderProps): ReactNode {
  const label = asStr(props.text, 'Button');
  const base = { className, style, ...a11y, ...analytics };
  if (props.href != null) {
    const ext = props.external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
    return createElement('a', { href: safeHref(props.href), ...ext, ...base }, label);
  }
  return createElement('button', { type: 'button', ...base }, label);
}

function Chip({ props, style, className, a11y }: AtomRenderProps): ReactNode {
  return createElement('span', { className, style: { display: 'inline-block', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 700, ...style }, ...a11y }, asStr(props.text));
}

function List({ props, style, className, children, a11y }: AtomRenderProps): ReactNode {
  const tag = isTrue(props.ordered) ? 'ol' : 'ul';
  const items = Array.isArray(children)
    ? children.map((c, i) => createElement('li', { key: i }, c))
    : children;
  return createElement(tag, { className, style: { display: 'flex', flexDirection: 'column', gap: '8px', listStyle: props.marker ? undefined : 'none', margin: 0, padding: 0, ...style }, ...a11y }, items);
}

// Icon — an inline SVG from validated path data (no raw markup, no dependency).
function Icon({ props, style, className, a11y }: AtomRenderProps): ReactNode {
  const d = asStr(props.path);
  if (!/^[\dMLHVCSQTAZmlhvcsqtaz\s.,-]+$/.test(d)) return null;
  const size = asStr(props.size, '24');
  const labelled = !!a11y['aria-label'];
  return createElement(
    'svg',
    {
      className, style, width: size, height: size, viewBox: asStr(props.viewBox, '0 0 24 24'),
      fill: asStr(props.fill, 'none'), stroke: asStr(props.stroke, 'currentColor'), strokeWidth: asStr(props.strokeWidth, '2'),
      'aria-hidden': labelled ? undefined : true, role: labelled ? 'img' : undefined,
      ...(labelled ? { 'aria-label': a11y['aria-label'] } : {}),
    },
    createElement('path', { d, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  );
}

function Image({ node, props, style, className, analytics }: AtomRenderProps): ReactNode {
  const src = safeImageSrc(props.src);
  if (!src) return null;
  return createElement('img', { src, alt: asStr(node.a11y?.alt ?? props.alt), loading: 'lazy', className, style, ...analytics });
}

function Video({ props, style, className }: AtomRenderProps): ReactNode {
  return createElement(VideoEmbed, { url: asStr(props.url), title: asStr(props.title) || undefined, style, className });
}

// Accordion — native <details>/<summary>: accessible + no JavaScript.
function Accordion({ style, className, children, a11y }: AtomRenderProps): ReactNode {
  return createElement('div', { className, style, ...a11y }, children);
}
function AccordionItem({ props, style, className, children }: AtomRenderProps): ReactNode {
  return createElement(
    'details',
    { className, style },
    createElement('summary', { style: { cursor: 'pointer' } }, asStr(props.summary, asStr(props.text, 'Details'))),
    children,
  );
}

function Divider({ style, className }: AtomRenderProps): ReactNode {
  return createElement('hr', { className, style });
}
function Spacer({ props, className }: AtomRenderProps): ReactNode {
  return createElement('div', { className, style: { height: asStr(props.height, '24px') }, 'aria-hidden': true });
}

/** The built-in atom set. Extend via createBuilder({ atoms: { ...defaultAtoms, myAtom } }). */
export const defaultAtoms: Registry = {
  // layout
  box: { render: Box, label: 'Box', category: 'Layout', container: true, fields: ['as'] },
  section: { render: Section, label: 'Section', category: 'Layout', container: true, fields: ['contain', 'width', 'gutter'] },
  container: { render: Container, label: 'Container', category: 'Layout', container: true, fields: ['width', 'gutter'] },
  grid: { render: Grid, label: 'Grid', category: 'Layout', container: true, fields: ['cols', 'min', 'gap'] },
  row: { render: Row, label: 'Row', category: 'Layout', container: true, fields: ['wrap'] },
  stack: { render: Stack, label: 'Stack', category: 'Layout', container: true },
  // content
  text: { render: Text, label: 'Text', category: 'Content', fields: ['text', 'as'] },
  heading: { render: Heading, label: 'Heading', category: 'Content', fields: ['text', 'level'] },
  link: { render: Link, label: 'Link', category: 'Content', fields: ['text', 'href', 'external'] },
  button: { render: Button, label: 'Button', category: 'Content', fields: ['text', 'href', 'external'] },
  chip: { render: Chip, label: 'Chip', category: 'Content', fields: ['text'] },
  list: { render: List, label: 'List', category: 'Content', container: true, fields: ['ordered', 'marker'] },
  icon: { render: Icon, label: 'Icon', category: 'Content', fields: ['path', 'viewBox', 'size', 'stroke'] },
  // media
  image: { render: Image, label: 'Image', category: 'Media', fields: ['src', 'alt'] },
  video: { render: Video, label: 'Video', category: 'Media', fields: ['url', 'title'] },
  // disclosure
  accordion: { render: Accordion, label: 'Accordion', category: 'Content', container: true },
  'accordion-item': { render: AccordionItem, label: 'Accordion item', category: 'Content', container: true, fields: ['summary'] },
  // primitives
  divider: { render: Divider, label: 'Divider', category: 'Layout' },
  spacer: { render: Spacer, label: 'Spacer', category: 'Layout', fields: ['height'] },
};
