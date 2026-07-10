// AI bridge — teach a model to author AQL, then compile + validate its output.
// atomkit stays provider-agnostic: you pass a `complete` function that calls
// whatever LLM you use. The model's freedom is bounded to the grammar + your
// registered atoms, and the result is always a schema-valid, safe document.
import type { Registry } from './registry.js';
import { defaultAtoms } from './atoms.js';
import { parse, type AqlProgram } from './query.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export type Complete = (messages: ChatMessage[]) => Promise<string>;

/** A system prompt that teaches an LLM to emit valid AQL for the given atoms. */
export function systemPrompt(registry: Registry = defaultAtoms): string {
  const atoms = Object.entries(registry)
    .map(([type, def]) => {
      const fields = def.fields?.length ? ` — props: ${def.fields.join(', ')}` : '';
      return `  ${type}${def.container ? ' (container)' : ''}${fields}`;
    })
    .join('\n');

  return `You generate AQL (Atomkit Query Language). AQL compiles to a safe UI document. Output ONLY AQL — no prose, no code fences.

GRAMMAR (line-oriented; one node per line; braces nest):
  page "Title" desc="..." {
    <type> ["text"] key=value ... [{
      ... children ...
    }]
  }
- A node's text is a quoted string immediately after its type.
- key=value sets style, data, accessibility, analytics or props. Bare flags: protected, pii, external, hidden.
- Quote any value with spaces. Unquoted values may contain parentheses, e.g. size=clamp(2rem,5vw,3.4rem).
- // starts a comment to end of line.

STYLE keys:
  color, bg, gradient, bg-color, bg-image, pad, pad-x, pad-y, m, m-x, m-y, gap,
  size (font-size), weight, font, lh (line-height), ls (letter-spacing), align (text-align),
  case (uppercase|lowercase|capitalize), decoration, w, h, max-w, min-w, radius, border, shadow,
  opacity, display, dir (row|column), justify, items (align-items), wrap, z, pos, grid-cols, aspect, overflow
RESPONSIVE: prefix any style key with sm:/md:/lg:, e.g.  md:dir=row  lg:size=3rem
A11Y: aria-label, role, alt, tabindex, lang, aria-hidden
DATA (dynamic content): api="https://…" data-path="a.b.0" bind=text   (binds the fetched value to a prop)
ANALYTICS: track=click_id  event=name  category=cta
SECURITY: protected | pii | roles=a,b | consent=analytics

ATOMS AVAILABLE (use ONLY these types):
${atoms}

RULES:
- Use box (container) with dir/gap/items/align for layout; nest atoms inside.
- Always put alt on image and aria-label on icon-only buttons.
- Make it responsive with md:/lg: overrides.
- Never invent atom types or style keys not listed. Output AQL only.`;
}

function stripFences(text: string): string {
  const m = text.match(/```(?:aql|text|txt)?\s*\n([\s\S]*?)```/i);
  return (m && m[1] ? m[1] : text).trim();
}

export interface GenerateResult {
  source: string;
  program: AqlProgram;
}

/**
 * Build a document from a natural-language prompt via a host-supplied LLM. The
 * model returns AQL; atomkit compiles + validates it deterministically, so the
 * output is always a safe document (or a parse error you can retry on).
 */
export async function generate(opts: {
  prompt: string;
  complete: Complete;
  registry?: Registry;
}): Promise<GenerateResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(opts.registry) },
    { role: 'user', content: opts.prompt },
  ];
  const raw = await opts.complete(messages);
  const source = stripFences(raw);
  const program = parse(source);
  return { source, program };
}
