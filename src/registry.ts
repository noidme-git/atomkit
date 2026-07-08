import type { CSSProperties, ReactNode } from 'react';
import type { BuilderNode } from './schema';
import type { RenderContext } from './security';

// What every atom component receives. The renderer has already resolved the
// node's style, merged any data binding into `props`, and computed the a11y +
// analytics attribute bags — the atom just spreads them onto its element.
export interface AtomRenderProps {
  node: BuilderNode;
  /** node.props merged with the resolved data-binding value. */
  props: Record<string, unknown>;
  style: CSSProperties;
  /** Present when the node declares responsive overrides (its generated class). */
  className?: string;
  children?: ReactNode;
  ctx: RenderContext;
  a11y: Record<string, unknown>;
  analytics: Record<string, string>;
}

export type AtomComponent = (p: AtomRenderProps) => ReactNode;

export interface AtomDef {
  render: AtomComponent;
  label?: string;
  category?: string;
  /** May contain child nodes (a container). */
  container?: boolean;
  /** Prop/style keys the editor should expose for this atom (for a future palette). */
  fields?: string[];
}

export type Registry = Record<string, AtomDef>;

export interface BuilderConfig {
  /** The atom types this builder knows how to render. */
  atoms: Registry;
  /** Design tokens the host exposes — drive editor pickers + can be injected as CSS vars. */
  tokens?: Record<string, string>;
}

export interface Builder {
  registry: Registry;
  tokens: Record<string, string>;
}

/** Compose a builder from an atom registry + tokens. Merge your own atoms with
 *  `defaultAtoms` to extend the palette. */
export function createBuilder(config: BuilderConfig): Builder {
  return { registry: { ...config.atoms }, tokens: config.tokens ?? {} };
}
