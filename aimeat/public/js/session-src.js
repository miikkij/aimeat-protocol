/**
 * @file session-src.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A picture from the node's API that loads on a signed-in-only node too.
 *
 *   An <img> sends no Authorization header, and the SPA keeps the session in localStorage, so on a
 *   node that shows its content to its own accounts only the content access gate refuses every
 *   picture an <img> asks the API for: an app's screenshot in appcat and on the store cards answered
 *   a SIGNED-IN person 401 and showed nothing (signed-in browser audit, 2026-10-19). There, and only
 *   there, the picture is fetched with the session (js/closed-node-fetch.js puts it on the request)
 *   and shown from an object URL. On an open node the address is used as it is, as before.
 * @structure needsSession(src) · useSessionSrc(src) · SessionImg
 * @usage
 *   import { useSessionSrc, SessionImg } from '/js/session-src.js';
 *   const pic = useSessionSrc(src);            // { src: string|null, failed: boolean }
 *   html`<${SessionImg} class="ld-app-shot" src=${url} alt=${alt} />`
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { signedInOnly } from '/js/site.js';
import { carriesSession } from '/js/closed-node-fetch.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/**
 * Whether `src` must be fetched with the session: a same-origin address on a signed-in-only node.
 * @param {string|undefined|null} src
 * @returns {boolean}
 */
export function needsSession(src) {
  if (!src || /^(blob|data):/i.test(src) || typeof location === 'undefined') return false;
  return signedInOnly() && carriesSession(src, location.origin);
}

/**
 * The address to put on the <img>: `src` itself, or, where needsSession() says so, an object URL of
 * the bytes fetched with the session (null while it loads). `failed` when that fetch was refused.
 * @param {string|undefined|null} src
 * @returns {{ src: string|null, failed: boolean }}
 */
export function useSessionSrc(src) {
  const fetched = needsSession(src);
  const [state, setState] = useState(/** @type {{ for: string|null, url: string|null, failed: boolean }} */ ({ for: null, url: null, failed: false }));
  useEffect(() => {
    if (!fetched || !src) return undefined;
    let cancelled = false;
    /** @type {string|null} */
    let made = null;
    fetch(src)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setState({ for: src, url: made, failed: false });
      })
      .catch((err) => { swallowed('session-src', err); if (!cancelled) setState({ for: src, url: null, failed: true }); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [src, fetched]);
  if (!fetched) return { src: src || null, failed: false };
  return state.for === src ? { src: state.url, failed: state.failed } : { src: null, failed: false };
}

/**
 * An <img> whose `src` goes through useSessionSrc; nothing is drawn until the picture is there.
 * @param {{ src?: string|null, [key: string]: any }} props
 */
export function SessionImg({ src, ...props }) {
  const pic = useSessionSrc(src);
  return pic.src ? html`<img ...${props} src=${pic.src} />` : null;
}
