import { createElement, type ReactNode } from 'react';
import type { AtomRenderProps, Registry } from './registry.js';
import { safeHref, safeImageSrc } from './url.js';
import { shouldMaskPii } from './security.js';

const asStr = (v: unknown, fallback = ''): string => (v == null ? fallback : String(v));

// Box — a styleable container. props.as picks the (whitelisted) semantic tag.
const BOX_TAGS = new Set([
  'div', 'section', 'header', 'footer', 'main', 'article', 'aside', 'nav', 'ul', 'ol', 'li',
]);
function Box({ props, style, className, children, a11y, analytics }: AtomRenderProps): ReactNode {
  const tag = BOX_TAGS.has(asStr(props.as)) ? asStr(props.as) : 'div';
  return createElement(tag, { className, style, ...a11y, ...analytics }, children);
}

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

function Button({ props, style, className, a11y, analytics }: AtomRenderProps): ReactNode {
  const label = asStr(props.text, 'Button');
  const base = { className, style, ...a11y, ...analytics };
  if (props.href != null) {
    const ext = props.external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
    return createElement('a', { href: safeHref(props.href), ...ext, ...base }, label);
  }
  return createElement('button', { type: 'button', ...base }, label);
}

function Image({ node, props, style, className, analytics }: AtomRenderProps): ReactNode {
  const src = safeImageSrc(props.src);
  if (!src) return null;
  const alt = asStr(node.a11y?.alt ?? props.alt);
  return createElement('img', { src, alt, loading: 'lazy', className, style, ...analytics });
}

function Divider({ style, className }: AtomRenderProps): ReactNode {
  return createElement('hr', { className, style });
}

function Spacer({ props, className }: AtomRenderProps): ReactNode {
  return createElement('div', { className, style: { height: asStr(props.height, '24px') }, 'aria-hidden': true });
}

/** The built-in atom set. Merge with your own via createBuilder({ atoms: { ...defaultAtoms, myAtom } }). */
export const defaultAtoms: Registry = {
  box: { render: Box, label: 'Box', category: 'Layout', container: true, fields: ['as'] },
  text: { render: Text, label: 'Text', category: 'Content', fields: ['text', 'as'] },
  heading: { render: Heading, label: 'Heading', category: 'Content', fields: ['text', 'level'] },
  button: { render: Button, label: 'Button', category: 'Content', fields: ['text', 'href', 'external'] },
  image: { render: Image, label: 'Image', category: 'Media', fields: ['src', 'alt'] },
  divider: { render: Divider, label: 'Divider', category: 'Layout' },
  spacer: { render: Spacer, label: 'Spacer', category: 'Layout', fields: ['height'] },
};
