// URL guards — every href/src an atom renders passes through these, so a
// hand-authored document can never inject a javascript:/vbscript: link.
export function safeHref(href: unknown): string {
  if (typeof href !== 'string') return '#';
  const s = href.trim();
  if (!s) return '#';
  if (s.length > 2048) return '#';
  if (/^(#|\?|\.)/.test(s)) return s;
  if (/^\/(?![/\\])/.test(s)) return s; // relative path, not protocol-relative //host
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return '#';
}

/** Image sources: allow relative/absolute paths, https, and data:image only. */
export function safeImageSrc(src: unknown): string | undefined {
  if (typeof src !== 'string') return undefined;
  const s = src.trim();
  if (!s || s.length > 100000) return undefined;
  if (/^\/(?![/\\])/.test(s)) return s;
  if (/^https:\/\//i.test(s)) return s;
  // data: images only for raster formats — NOT svg (data:image/svg+xml can carry script).
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(s)) return s;
  return undefined;
}
