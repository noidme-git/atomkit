import type { CSSProperties } from 'react';
import type { StyleProps } from './schema.js';

// Properties copied straight through (after value cleaning). Shorthands
// (padding/margin X-Y, gradient, background) are expanded separately below.
const DIRECT: (keyof StyleProps)[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign',
  'textTransform', 'fontStyle', 'textDecoration', 'color',
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight', 'gap',
  'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'border', 'borderColor', 'borderWidth', 'borderStyle', 'borderRadius',
  'boxShadow', 'opacity', 'filter', 'transform', 'transition',
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
  'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  'gridTemplateColumns', 'aspectRatio', 'overflow',
];

// A single CSS value never contains rule/declaration/tag characters; rejecting
// them keeps a value from breaking out of the inline style OR a generated <style>
// rule, and blocks the classic CSS script vectors.
function clean(v: unknown): string | number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (/[<>{};]/.test(s)) return undefined;
  if (/expression\(|javascript:|vbscript:|@import/i.test(s)) return undefined;
  return s;
}

/** Resolve a StyleProps into a React inline-style object (base breakpoint only). */
export function resolveStyle(style?: StyleProps): CSSProperties {
  if (!style) return {};
  const out: Record<string, string | number> = {};
  for (const k of DIRECT) {
    const val = clean(style[k] as unknown);
    if (val !== undefined) out[k] = val;
  }
  const set = (key: string, raw: unknown) => {
    const v = clean(raw);
    if (v !== undefined) out[key] = v;
  };
  set('padding', style.padding);
  if (clean(style.paddingX) !== undefined) { out.paddingLeft = clean(style.paddingX)!; out.paddingRight = clean(style.paddingX)!; }
  if (clean(style.paddingY) !== undefined) { out.paddingTop = clean(style.paddingY)!; out.paddingBottom = clean(style.paddingY)!; }
  set('margin', style.margin);
  if (clean(style.marginX) !== undefined) { out.marginLeft = clean(style.marginX)!; out.marginRight = clean(style.marginX)!; }
  if (clean(style.marginY) !== undefined) { out.marginTop = clean(style.marginY)!; out.marginBottom = clean(style.marginY)!; }
  // Background: gradient wins over the background shorthand.
  const grad = clean(style.gradient);
  const bg = clean(style.background);
  if (grad !== undefined) out.background = grad;
  else if (bg !== undefined) out.background = bg;
  return out as CSSProperties;
}

function kebab(k: string): string {
  return k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function declarations(css: CSSProperties): string {
  return Object.entries(css)
    .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' ? v : v}`)
    .join(';');
}

const BREAKPOINTS = { sm: 640, md: 768, lg: 1024 } as const;

/** Generate scoped media-query CSS for a node's responsive overrides. */
export function mediaCss(selector: string, responsive?: StyleProps['responsive']): string {
  if (!responsive) return '';
  let css = '';
  for (const bp of ['sm', 'md', 'lg'] as const) {
    const s = responsive[bp];
    if (!s) continue;
    const decls = declarations(resolveStyle(s));
    if (decls) css += `@media (min-width:${BREAKPOINTS[bp]}px){${selector}{${decls}}}`;
  }
  return css;
}
