# atomkit

**Headless, SSR-safe, atom-based visual builder.** Render a JSON document to React —
on the server or the client — where **every atom carries its own styling,
data-binding, accessibility, analytics and security as plain data**.

```bash
npm i @noidmejs/atomkit
```

## The idea

A page is a tree of nodes. Each node is an *atom* (or a container of atoms) and is
fully described by data — nothing about it is hard-coded in a component:

| Field | What it holds |
|-------|---------------|
| `style` | typography, colour, gradient, background, size, spacing, border, effects — **plus responsive overrides** |
| `data` | where content comes from — a static value, or an **API call + JSON path** |
| `a11y` | `role`, `aria-*`, `alt`, `tabindex`, `lang` |
| `meta` | `tags`, `analytics` tracking, and `security` / consent gating |

The renderer whitelists style properties and sanitises values, routes every URL
through a scheme guard, and enforces each node's security rules — so a
hand-authored or stale document can never inject script or leak protected content.

## Quick start

```tsx
import { Render, defaultAtoms, type BuilderDocument } from '@noidmejs/atomkit';

const doc: BuilderDocument = {
  version: 1,
  root: [
    {
      id: 'h', type: 'heading',
      props: { text: 'Powering the web from Hyderabad', level: 1 },
      style: { color: '#0b1220', fontSize: 'clamp(2rem,5vw,3.4rem)', textAlign: 'center' },
    },
    {
      id: 'cta', type: 'button',
      props: { text: 'Get started', href: '/start' },
      style: { color: '#fff', gradient: 'linear-gradient(103deg,#005DAB,#E31936)', borderRadius: '999px', paddingX: '22px', paddingY: '12px' },
      meta: { analytics: { id: 'cta_top', event: 'cta_click' } },
    },
  ],
};

export default function Page() {
  return <Render document={doc} registry={defaultAtoms} />;
}
```

## Data binding — static or API

```ts
{
  id: 'price', type: 'text',
  data: { source: { kind: 'api', url: '/api/price', path: 'data.amount' }, bindTo: 'text' },
}
```

Static values render on the server; API-bound nodes render their fallback, then
resolve on the client (your CSP `connect-src` governs which URLs may be hit).

## Security, consent & PII — per atom

```ts
{ id: 'internal', type: 'text', props: { text: 'Roadmap' },
  meta: { security: { protected: true, roles: ['admin'] } } }

{ id: 'email', type: 'text', props: { text: 'a@b.com' },
  meta: { security: { pii: true } } }        // masked unless the viewer may see PII
```

```tsx
<Render document={doc} registry={defaultAtoms}
  context={{ canViewProtected: true, roles: ['admin'], canViewPii: false, consent: { analytics: true } }} />
```

## Custom atoms + your design tokens

```ts
import { createBuilder, defaultAtoms } from '@noidmejs/atomkit';

const builder = createBuilder({
  atoms: {
    ...defaultAtoms,
    stat: { render: ({ props, style }) => <div style={style}><b>{String(props.value)}</b> {String(props.label)}</div>, label: 'Stat' },
  },
  tokens: { '--brand': '#005DAB' },
});

<Render document={doc} registry={builder.registry} />
```

## Status

**v0.5** — the document model + SSR-safe renderer, ~19 atoms (layout / content /
media / disclosure), the **AQL** query language, the AI bridge, governance-at-egress
(`stripDocument`), and an a11y `lint()`. Compile to standalone React with
[`@noidmejs/atomkit-compiler`](https://www.npmjs.com/package/@noidmejs/atomkit-compiler)
and connect to backends with
[`@noidmejs/atomkit-http`](https://www.npmjs.com/package/@noidmejs/atomkit-http).
The visual drag-and-drop editor is on the roadmap (not yet shipped).

## Security & governance

See [SECURITY.md](./SECURITY.md). In short: no raw HTML / no `eval`; style + URL
whitelists; per-node `protected` / `roles` / `pii` / `consent`; **PII masked by value
with subtree cascade**; `stripDocument(doc, ctx)` enforces governance at egress on
the server; analytics are consent-gated. The **host** owns authentication, the
authoritative consent/role facts (`RenderContext`), the CSP, and
colour-contrast / focus / target-size. Report vulnerabilities via a GitHub Security
Advisory. Pre-1.0 and not yet independently pen-tested.

MIT © noidmejs
