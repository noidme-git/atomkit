// The atomkit document model — the JSON contract that IS the product.
//
// A page is a tree of `BuilderNode`s. Every node is an "atom" (or a container of
// atoms) and carries EVERYTHING about itself as plain, serialisable data:
//   • style   — typography, colour, gradient, background, size, spacing, border, effects
//   • data    — where its content comes from (static text, or an API call + path)
//   • a11y    — role, labels, alt, tabindex, lang
//   • meta    — tags, analytics tracking, and security/consent gating
//
// The schema is deliberately permissive on style *values* (any CSS string); the
// renderer whitelists the allowed properties and sanitises values, so a hostile
// or hand-edited document can never inject script or break out of the style attr.
import { z } from 'zod';

// ── Style ────────────────────────────────────────────────────────────────────
/** A responsive value: a base plus optional breakpoint overrides. */
export interface StyleProps {
  // Typography
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string | number;
  lineHeight?: string | number;
  letterSpacing?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: string;
  color?: string;
  // Box model
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  height?: string;
  minHeight?: string;
  maxHeight?: string;
  padding?: string;
  paddingX?: string;
  paddingY?: string;
  margin?: string;
  marginX?: string;
  marginY?: string;
  gap?: string;
  // Background
  background?: string;
  backgroundColor?: string;
  /** A gradient string, e.g. "linear-gradient(120deg,#005DAB,#E31936)". Wins over background. */
  gradient?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  // Border
  border?: string;
  borderColor?: string;
  borderWidth?: string;
  borderStyle?: string;
  borderRadius?: string;
  // Effects
  boxShadow?: string;
  opacity?: number;
  filter?: string;
  transform?: string;
  transition?: string;
  // Layout
  display?: string;
  flexDirection?: 'row' | 'column';
  flexWrap?: string;
  justifyContent?: string;
  alignItems?: string;
  position?: 'static' | 'relative' | 'absolute' | 'sticky' | 'fixed';
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: number;
  gridTemplateColumns?: string;
  aspectRatio?: string;
  overflow?: string;
  /** Per-breakpoint overrides (min-width: sm 640 / md 768 / lg 1024). */
  responsive?: { sm?: StyleProps; md?: StyleProps; lg?: StyleProps };
}

// ── Data binding ───────────────────────────────────────────────────────────
export type DataSource =
  | { kind: 'static'; value?: unknown }
  | {
      kind: 'api';
      url: string;
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
      /** Dot/bracket path into the JSON response, e.g. "data.items.0.title". */
      path?: string;
      /** Client cache TTL in seconds (advisory). */
      ttl?: number;
    };

export interface DataBinding {
  source: DataSource;
  /** Which prop the resolved value maps onto (default depends on the atom, e.g. "text"/"src"). */
  bindTo?: string;
}

// ── Accessibility ────────────────────────────────────────────────────────────
export interface A11yProps {
  role?: string;
  ariaLabel?: string;
  ariaHidden?: boolean;
  ariaDescribedby?: string;
  tabIndex?: number;
  alt?: string;
  lang?: string;
}

// ── Meta: tags, analytics, security ──────────────────────────────────────────
export interface AnalyticsProps {
  /** Emitted as data-analytics-id; your tracker reads it. */
  id?: string;
  event?: string;
  category?: string;
  props?: Record<string, string>;
}

export interface SecurityProps {
  /** Render only when the viewer is permitted (RenderContext.canViewProtected). */
  protected?: boolean;
  /** Allowed roles; the node renders only if the viewer has one. */
  roles?: string[];
  /** Marks content as PII — masked/omitted unless RenderContext.canViewPii. */
  pii?: boolean;
  /** Gated on the viewer's consent for this category (e.g. "analytics", "marketing"). */
  consentCategory?: string;
}

export interface NodeMeta {
  tags?: string[];
  analytics?: AnalyticsProps;
  security?: SecurityProps;
  /** Editor-only note; never rendered. */
  note?: string;
}

// ── Node + Document ──────────────────────────────────────────────────────────
export interface BuilderNode {
  id: string;
  /** Registered atom/component type, e.g. "text", "button", "box". */
  type: string;
  props?: Record<string, unknown>;
  style?: StyleProps;
  data?: DataBinding;
  a11y?: A11yProps;
  meta?: NodeMeta;
  children?: BuilderNode[];
  hidden?: boolean;
}

export interface BuilderDocument {
  version: number;
  root: BuilderNode[];
  meta?: { title?: string; description?: string };
}

// ── Zod (write-time validation) ──────────────────────────────────────────────
// Style is validated structurally as string/number leaves; the render-time
// whitelist (style.ts) is the real guard against unknown properties / bad values.
// Structural only — the render-time whitelist (style.ts) is the real guard
// against unknown properties / injection, so this stays permissive enough to
// accept nested `responsive` overrides and any valid CSS value.
const styleSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());

// Every object in the document is STRICT: an unknown key is a rejection, not a
// shrug. Only the node level used to be strict, so `a11y: { onclick: … }`,
// `meta.security: { bypass: true }` and `data.source: { evil: 1 }` all validated
// cleanly. Nothing read them, so it was never exploitable — but "schema-valid"
// must mean "exactly this shape", or the schema is not a trust boundary.
//
// z.strictObject is zod 4's supported form; `.strict()` is deprecated.
const dataSourceSchema = z.union([
  z.strictObject({ kind: z.literal('static'), value: z.unknown().optional() }),
  z.strictObject({
    kind: z.literal('api'),
    url: z.string(),
    method: z.enum(['GET', 'POST']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    path: z.string().optional(),
    ttl: z.number().optional(),
  }),
]);

export const nodeSchema: z.ZodType<BuilderNode> = z.lazy(() =>
  z.strictObject({
    id: z.string(),
    type: z.string(),
    props: z.record(z.string(), z.unknown()).optional(),
    style: styleSchema.optional(),
    data: z.strictObject({ source: dataSourceSchema, bindTo: z.string().optional() }).optional(),
    a11y: z
      .strictObject({
        role: z.string().optional(),
        ariaLabel: z.string().optional(),
        ariaHidden: z.boolean().optional(),
        ariaDescribedby: z.string().optional(),
        tabIndex: z.number().optional(),
        alt: z.string().optional(),
        lang: z.string().optional(),
      })
      .optional(),
    meta: z
      .strictObject({
        tags: z.array(z.string()).optional(),
        analytics: z
          .strictObject({
            id: z.string().optional(),
            event: z.string().optional(),
            category: z.string().optional(),
            props: z.record(z.string(), z.string()).optional(),
          })
          .optional(),
        security: z
          .strictObject({
            protected: z.boolean().optional(),
            roles: z.array(z.string()).optional(),
            pii: z.boolean().optional(),
            consentCategory: z.string().optional(),
          })
          .optional(),
        note: z.string().optional(),
      })
      .optional(),
    children: z.array(nodeSchema).optional(),
    hidden: z.boolean().optional(),
  }),
) as z.ZodType<BuilderNode>;

export const documentSchema = z.strictObject({
  version: z.number(),
  root: z.array(nodeSchema),
  meta: z.strictObject({ title: z.string().optional(), description: z.string().optional() }).optional(),
});

/**
 * Node ids must be unique across the whole document.
 *
 * Nothing used to check. Two nodes sharing an id share the generated responsive
 * rule `.ak-<id>` — so one node silently restyles the other, last rule winning —
 * and they collide as React keys. A visual editor mints ids constantly, which is
 * exactly where duplicates come from.
 */
function assertUniqueIds(doc: BuilderDocument): void {
  const seen = new Set<string>();
  const walk = (nodes: BuilderNode[]): void => {
    for (const n of nodes) {
      if (seen.has(n.id)) throw new Error(`duplicate node id "${n.id}" — node ids must be unique within a document`);
      seen.add(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(doc.root);
}

/** Validate + return a typed document, or throw with issues. */
export function parseDocument(input: unknown): BuilderDocument {
  const doc = documentSchema.parse(input) as BuilderDocument;
  assertUniqueIds(doc);
  return doc;
}
