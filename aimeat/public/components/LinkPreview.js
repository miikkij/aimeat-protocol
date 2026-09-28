/**
 * @file public/components/LinkPreview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Rich link-preview (unfurl) cards for a pasted URL. `LinkPreview` fetches one URL's
 *   OpenGraph metadata from the node (`/js/services/unfurl.js`) and renders a card (site · title ·
 *   description · thumbnail); the thumbnail is pulled through the node's image proxy into a `blob:`
 *   URL so the SPA's remote-image CSP is satisfied. `MessageLinkPreviews` extracts the URLs from a
 *   message body and renders a card per link, each with a ✕ that hides it (persisted in localStorage,
 *   so a dismissed card stays hidden). `extractUrls` is exported for reuse/testing. Its look is
 *   css/components/link-preview.css (.link-preview-list, .link-preview and its parts).
 * @structure extractUrls(text,max) · useSeenInViewport(ref) · LinkPreview({url,onDismiss}) · MessageLinkPreviews({msg})
 * @usage html`<${MessageLinkPreviews} msg=${msg} />`
 * @version-history
 *   v1.2.1 — 2026-09-28 — No escHtml() on text preact renders: preact escapes text itself, so a
 *     site name, title or description with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.2.0 — 2026-09-27 — Draws its own names: .inbox-linkcards is .link-preview-list,
 *     .inbox-linkcard(-main/-thumb/-text/-site/-title/-desc) is .link-preview(-…), and the ✕
 *     .inbox-linkcard-x is .link-preview-hide; the rules moved with them out of css/views/inbox.css
 *     into css/components/link-preview.css (a move).
 *   v1.1.0 — 2026-08-03 — Lazy unfurl: a message's preview cards mount only once the message scrolls
 *     near the viewport (IntersectionObserver, 200px margin) — opening a long thread no longer fires
 *     an unfurl request for every link in the whole history.
 *   v1.0.0 — 2026-07-21 — Initial link-preview cards (inbox message threads).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as unfurl from '/js/services/unfurl.js';

/** True once `ref`'s element has been near the viewport (within 200px) at least once, then stays true.
 *  Drives lazy unfurling: a message deep in a long thread fetches its preview only when scrolled to,
 *  not on thread load (a 400-message history used to fire ~80 unfurl requests on open). Falls back to
 *  "immediately visible" where IntersectionObserver is unavailable. */
function useSeenInViewport(ref) {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, ref]);
  return seen;
}

/** Pull up to `max` distinct bare http(s) URLs out of a message body, trimming trailing sentence
 *  punctuation (mirrors the Markdown autolink trimming so the card links the same target the text does). */
export function extractUrls(text, max = 3) {
  const urls = [];
  if (typeof text !== 'string') return urls;
  const re = /(?:^|[\s(<[])(https?:\/\/[^\s<>()[\]]+)/gi;
  let m;
  while ((m = re.exec(text)) !== null && urls.length < max) {
    let u = m[1].replace(/[.,;:!?'"]+$/, '');
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

// Dismissed cards persist across reloads: a Set of `${messageId}::${url}` keys in localStorage (capped).
const DISMISS_KEY = 'aimeat.inbox.linkcard.dismissed';
function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
}
function saveDismissed(set) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set].slice(-500))); } catch { /* quota */ }   // eslint-disable-line aimeat/no-silent-catch -- quota
}

/** One preview card. Renders nothing while loading, or if the link has no usable metadata. */
export function LinkPreview({ url, onDismiss }) {
  const [meta, setMeta] = useState(undefined); // undefined = loading, null = nothing to show
  const [imgUrl, setImgUrl] = useState(null);

  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setMeta(undefined); setImgUrl(null);
    (async () => {
      const m = await unfurl.fetchPreview(url);
      if (!alive) return;
      // A card with no title/description/image isn't worth showing (avoid an empty box on a bare domain).
      if (!m || (!m.title && !m.description && !m.image)) { setMeta(null); return; }
      setMeta(m);
      if (m.image) {
        objectUrl = await unfurl.fetchPreviewImageUrl(m.image);
        if (!alive) { if (objectUrl) URL.revokeObjectURL(objectUrl); return; }
        if (objectUrl) setImgUrl(objectUrl);
      }
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);

  if (meta === undefined || meta === null) return null;
  return html`
    <div class="link-preview">
      <a class="link-preview-main" href=${meta.resolvedUrl || url} target="_blank" rel="noopener noreferrer nofollow">
        ${imgUrl ? html`<span class="link-preview-thumb"><img src=${imgUrl} alt="" loading="lazy" /></span>` : null}
        <span class="link-preview-text">
          ${meta.siteName ? html`<span class="link-preview-site">${meta.siteName}</span>` : null}
          ${meta.title ? html`<span class="link-preview-title">${meta.title}</span>` : null}
          ${meta.description ? html`<span class="link-preview-desc">${meta.description}</span>` : null}
        </span>
      </a>
      <button class="link-preview-hide" title=${t('inbox.linkPreview.hide')}
        onClick=${() => onDismiss?.(url)}>✕</button>
    </div>`;
}

/** All preview cards for one message: a card per non-dismissed URL in its body. The cards mount (and
 *  unfurl) only once this message has scrolled near the viewport — see useSeenInViewport. */
export function MessageLinkPreviews({ msg }) {
  const urls = extractUrls(msg?.body || '');
  const [dismissed, setDismissed] = useState(loadDismissed);
  const hostRef = useRef(null);
  const seen = useSeenInViewport(hostRef);
  if (urls.length === 0) return null;
  const visible = urls.filter(u => !dismissed.has(`${msg.id}::${u}`));
  if (visible.length === 0) return null;
  const dismiss = (u) => {
    const next = new Set(dismissed);
    next.add(`${msg.id}::${u}`);
    setDismissed(next);
    saveDismissed(next);
  };
  return html`<div class="link-preview-list" ref=${hostRef}>
    ${seen ? visible.map(u => html`<${LinkPreview} key=${u} url=${u} onDismiss=${dismiss} />`) : null}
  </div>`;
}
