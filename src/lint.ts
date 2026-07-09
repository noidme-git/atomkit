import type { BuilderDocument, BuilderNode } from './schema.js';

export interface LintWarning {
  id: string;
  type: string;
  rule: string;
  message: string;
}

/**
 * Lightweight WCAG-oriented lint over a document. Returns warnings (never throws)
 * so a host can surface them in the editor / fail CI. Colour-contrast, focus and
 * target-size are app/theme concerns and are NOT checked here.
 */
export function lint(doc: BuilderDocument): LintWarning[] {
  const out: LintWarning[] = [];
  // Render() never calls parseDocument, so a hand-built or editor-built document
  // can reach the renderer with duplicate ids and silently cross-apply its
  // responsive CSS. lint() must surface that without throwing.
  const seenIds = new Set<string>();
  const walk = (n: BuilderNode): void => {
    const p = n.props ?? {};
    const warn = (rule: string, message: string) => out.push({ id: n.id, type: n.type, rule, message });

    if (seenIds.has(n.id)) {
      warn('unique-id', `duplicate node id "${n.id}" — responsive styles (.ak-${n.id}) cross-apply and React keys collide`);
    }
    seenIds.add(n.id);

    if (n.type === 'image') {
      const alt = n.a11y?.alt ?? (p.alt as string | undefined);
      if (alt == null) warn('img-alt', 'image has no alt text — set a11y.alt, or alt="" to mark it decorative');
    }
    if (n.type === 'button' && !p.text && !n.a11y?.ariaLabel) {
      warn('control-name', 'button has no accessible name (text or a11y.ariaLabel)');
    }
    if (n.type === 'link' && !p.text && !n.a11y?.ariaLabel) {
      warn('control-name', 'link has no accessible name (text or a11y.ariaLabel)');
    }
    if (n.type === 'icon' && !n.a11y?.ariaLabel) {
      // Decorative icons are fine (auto aria-hidden); only note it so authors are aware.
      warn('icon-label', 'icon has no a11y.ariaLabel — rendered as decorative (aria-hidden)');
    }
    if (n.type === 'heading') {
      const lvl = Math.round(Number(p.level)) || 2;
      if (lvl < 1 || lvl > 6) warn('heading-level', 'heading level should be 1–6');
    }
    (n.children ?? []).forEach(walk);
  };
  doc.root.forEach(walk);
  return out;
}
