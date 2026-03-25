'use client';

import { useEffect } from 'react';

/**
 * Injects PWA and iOS-specific meta/link tags into document.head.
 * Next.js 15+ may not emit apple-mobile-web-app-capable; iOS still needs it for
 * "Add to Home Screen" and splash. Runs only on client after mount.
 */
export default function PwaMeta() {
  useEffect(() => {
    const head = document.head;

    const tags: { type: 'meta' | 'link'; attrs: Record<string, string> }[] = [
      { type: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
      { type: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' } },
      { type: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Quant AI' } },
      { type: 'link', attrs: { rel: 'manifest', href: '/manifest.json' } },
    ];

    tags.forEach(({ type, attrs }) => {
      const key = type === 'meta' ? `meta-${attrs.name}` : `link-${attrs.rel}-${attrs.href}`;
      if (head.querySelector(`[data-pwa-meta="${key}"]`)) return;

      const el = document.createElement(type);
      el.setAttribute('data-pwa-meta', key);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      head.appendChild(el);
    });
  }, []);

  return null;
}
