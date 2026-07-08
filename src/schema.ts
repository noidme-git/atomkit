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
const styleLeaf = z.union([z.string(), z.number(), z.boolean()]);
const styleSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.record(z.union([styleLeaf, z.record(styleLeaf)])),
);

const dataSourceSchema = z.union([
  z.object({ kind: z.literal('static'), value: z.unknown().optional() }),
  z.object({
    kind: z.literal('api'),
    url: z.string(),
    method: z.enum(['GET', 'POST']).optional(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
    path: z.string().optional(),
    ttl: z.number().optional(),
  }),
]);

export const nodeSchema: z.ZodType<BuilderNode> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      type: z.string(),
      props: z.record(z.unknown()).optional(),
      style: styleSchema.optional(),
      data: z.object({ source: dataSourceSchema, bindTo: z.string().optional() }).optional(),
      a11y: z
        .object({
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
        .object({
          tags: z.array(z.string()).optional(),
          analytics: z
            .object({
              id: z.string().optional(),
              event: z.string().optional(),
              category: z.string().optional(),
              props: z.record(z.string()).optional(),
            })
            .optional(),
          security: z
            .object({
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
    })
    .strict(),
) as z.ZodType<BuilderNode>;

export const documentSchema = z.object({
  version: z.number(),
  root: z.array(nodeSchema),
  meta: z.object({ title: z.string().optional(), description: z.string().optional() }).optional(),
});

/** Validate + return a typed document, or throw with issues. */
export function parseDocument(input: unknown): BuilderDocument {
  return documentSchema.parse(input) as BuilderDocument;
}
