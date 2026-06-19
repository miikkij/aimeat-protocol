/**
 * @file auth-image.js
 * @description Image component that fetches via authenticated request and displays as blob URL.
 *   Browser <img> tags cannot send JWT Authorization headers, so this component
 *   fetches the image using the session JWT and renders it via an object URL.
 * @usage import AuthImage from '/js/components/auth-image.js';
 *        html`<${AuthImage} src="/v1/memory/files/foo.png" class="file-thumb" alt="foo" />`
 * @version-history
 *   v1.0.0 — 2026-03-17 — Initial implementation
 *   v1.0.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

export default function AuthImage({ src, alt, ...props }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const urlRef = useRef(null);

  useEffect(() => {
    if (!src) return;

    let cancelled = false;
    const headers = /** @type {Record<string,string>} */ ({});

    if (window.AIMEAT?.auth?.hasSession) {
      const session = window.AIMEAT.auth.getSession();
      if (session?.jwt) {
        headers['Authorization'] = 'Bearer ' + session.jwt;
      }
    }

    fetch(src, { headers })
      .then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then(blob => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(null);
      });

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [src]);

  if (!blobUrl) return null;
  return html`<img ...${props} src=${blobUrl} alt=${alt} loading="lazy" />`;
}
