'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { DataBinding } from './schema';

/** Read a dot/bracket path out of a JSON value: getPath(json, "data.items.0.title"). */
export function getPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const seg of path.split(/[.[\]]+/).filter(Boolean)) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

// Resolves a node's data binding. Static values render immediately (SSR-safe);
// API sources render their static fallback, then fetch on the client and swap in
// the resolved value. The host's CSP connect-src governs which URLs may be hit.
export function DataBound({
  binding,
  render,
}: {
  binding: DataBinding;
  render: (value: unknown) => ReactNode;
}) {
  const initial = binding.source.kind === 'static' ? binding.source.value : undefined;
  const [value, setValue] = useState<unknown>(initial);

  useEffect(() => {
    const src = binding.source;
    if (src.kind !== 'api') return;
    let alive = true;
    fetch(src.url, {
      method: src.method ?? 'GET',
      headers: src.headers,
      body: src.method === 'POST' ? src.body : undefined,
    })
      .then((r) => r.json())
      .then((json) => {
        if (alive) setValue(getPath(json, src.path));
      })
      .catch(() => {
        /* keep the static fallback on error */
      });
    return () => {
      alive = false;
    };
  }, [binding]);

  return <>{render(value)}</>;
}
