import { cloneElement, isValidElement } from 'react';
import type { Registry } from './registry.js';

/** Attribute carrying the node id on each rendered atom's root element. */
export const NODE_ID_ATTR = 'data-ak-id';

export interface InstrumentOptions {
  /** Attribute name to inject (default `data-ak-id`). */
  attr?: string;
}

/**
 * Return a registry whose atoms tag their root element with the node's id, so an
 * editor can hit-test, select, and measure a rendered document.
 *
 * `Render` emits no per-node DOM handle of its own: it sets `class="ak-<id>"`
 * ONLY for nodes that declare responsive overrides. So `getElementById` and class
 * lookup are both dead ends for a visual editor, which must address every node.
 *
 * The obvious fix — wrapping each atom in a `<div>` — silently destroys every
 * flex and grid layout, because the wrapper becomes the flex/grid item instead of
 * the atom. So this injects the attribute onto the element the atom *already*
 * returns, via `cloneElement`. No element is added, removed, or reordered: the
 * markup is byte-identical apart from the attribute.
 *
 * An atom may legitimately render nothing (`Image` with an unsafe `src` and
 * `Icon` with invalid path data both return `null`). Those stay `null`; a handle
 * is never conjured for a node that does not exist in the DOM.
 *
 * Governance is unaffected: this wraps rendering, not `stripDocument`. A masked
 * node still renders its mask, and a `protected` node is still absent.
 *
 * ```ts
 * const editable = instrumentRegistry(defaultAtoms);
 * <Render document={doc} registry={editable} context={ctx} />
 * // → canvas.addEventListener('click', e => e.target.closest('[data-ak-id]'))
 * ```
 */
export function instrumentRegistry(registry: Registry, opts: InstrumentOptions = {}): Registry {
  const attr = opts.attr ?? NODE_ID_ATTR;
  const out: Registry = {};
  for (const [type, def] of Object.entries(registry)) {
    out[type] = {
      ...def,
      render: (p) => {
        const el = def.render(p);
        if (!isValidElement(el)) return el; // null / string / fragment-less — leave it alone
        return cloneElement(el as React.ReactElement<Record<string, unknown>>, { [attr]: p.node.id });
      },
    };
  }
  return out;
}
