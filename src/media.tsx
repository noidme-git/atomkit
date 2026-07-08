'use client';

import { createElement, useState, type CSSProperties, type ReactNode } from 'react';

// Privacy-friendly video: only YouTube / Vimeo, click-to-load (no third-party
// request or cookie until the viewer presses play). The host's CSP frame-src
// must allow www.youtube-nocookie.com / player.vimeo.com for the iframe to load.
function parseEmbed(url: string): { src: string; provider: string } | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      if (/^[\w-]{11}$/.test(id)) return { src: `https://www.youtube-nocookie.com/embed/${id}`, provider: 'YouTube' };
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') ?? '';
      if (/^[\w-]{11}$/.test(id)) return { src: `https://www.youtube-nocookie.com/embed/${id}`, provider: 'YouTube' };
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0] ?? '';
      if (/^\d+$/.test(id)) return { src: `https://player.vimeo.com/video/${id}`, provider: 'Vimeo' };
    }
  } catch {
    /* malformed URL → no embed */
  }
  return null;
}

export function VideoEmbed({
  url,
  title,
  style,
  className,
}: {
  url: string;
  title?: string;
  style?: CSSProperties;
  className?: string;
}): ReactNode {
  const embed = parseEmbed(url);
  const [loaded, setLoaded] = useState(false);
  if (!embed) return null;
  const box: CSSProperties = { position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', ...style };
  if (!loaded) {
    return createElement(
      'button',
      {
        type: 'button',
        className,
        onClick: () => setLoaded(true),
        'aria-label': `Load ${embed.provider} video${title ? `: ${title}` : ''}`,
        style: { ...box, cursor: 'pointer', border: 0, background: '#0b1220', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 },
      },
      `▶  Load ${embed.provider} video`,
    );
  }
  return createElement(
    'div',
    { className, style: box },
    createElement('iframe', {
      src: embed.src,
      title: title || 'Embedded video',
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 },
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowFullScreen: true,
      loading: 'lazy',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );
}
