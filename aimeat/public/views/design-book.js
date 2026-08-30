/**
 * @file design-book.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book as a page a person browses (/v1/design-book): every published part
 *   SHOWN, not listed — each card embeds the part's real render (GET /v1/designbook/:id/preview,
 *   the same page the guarantee bench measures), with the kind said in words, the summary, and how
 *   often builds have adopted it. A card opens into the full-size render plus the one line that
 *   takes the part into use: tell your AI the part's address.
 *
 *   NOTHING HERE IS NEW DATA. The page is a reading of the public catalogue (GET /v1/designbook)
 *   and the per-part preview route; counts and filters are derived in the browser. The previews
 *   are scaled-down live pages: each frame renders at desktop width and a ResizeObserver sets the
 *   scale to the card, because CSS alone cannot turn a container width into a scale() number.
 * @structure KINDS · PreviewFrame · PartDialog · default export DesignBook({ navigate })
 * @usage routed at /v1/design-book by spa.html; listed in routes/portal.ts spaRoutes
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (wish-designbook-graafinen-selailu): the Book had no surface a
 *     person could browse, and a raw JSON address is not one.
 */
import { h } from 'preact';
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The part kinds the node proves, in the order a browser meets them: whole pages first,
 *  arrangements, then the seasoning sheets. Labels and explanations come from the locale. */
const KINDS = ['layout', 'fill', 'genre', 'look', 'motion', 'illustration'];

const KIND_FALLBACK = {
  layout: ['Arrangement', 'A complete screen arrangement, adopted as-is.'],
  fill: ['Starting shape', 'An arrangement with slots your words fill.'],
  genre: ['Whole page', 'A complete page in a strong style, taken home as a copy.'],
  look: ['Look', 'Colours, type and shapes that dress an arrangement you already have.'],
  motion: ['Motion', 'How things enter and move, laid over what you already have.'],
  illustration: ['Imagery', 'Art direction for the pictures an app generates.'],
};

const kindLabel = (k) => tr('designBook.kind.' + k, (KIND_FALLBACK[k] || [k])[0]);
const kindSub = (k) => tr('designBook.kindSub.' + k, (KIND_FALLBACK[k] || ['', ''])[1]);

/** The design width every card preview renders at; the frame scales it down to its own width. */
const PREVIEW_W = 1100;
const PREVIEW_H = 720;

/** A live, scaled-down render of one part. The iframe paints the part at desktop width; the
 *  observer turns the card's real width into the scale CSS cannot compute on its own. */
function PreviewFrame({ id }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') { setScale(0.3); return; }
    const ro = new ResizeObserver(() => setScale(el.clientWidth / PREVIEW_W));
    ro.observe(el);
    setScale(el.clientWidth / PREVIEW_W);
    return () => ro.disconnect();
  }, []);
  return html`
    <div class="dbk-frame" ref=${box} style=${`height:${Math.round(PREVIEW_H * (scale || 0.3))}px`}>
      ${scale > 0 ? html`
        <iframe class="dbk-frame-page" src=${'/v1/designbook/' + encodeURIComponent(id) + '/preview'}
          loading="lazy" sandbox="allow-scripts" tabindex="-1"
          title=${tr('designBook.previewOf', 'Preview of this part')}
          style=${`width:${PREVIEW_W}px;height:${PREVIEW_H}px;transform:scale(${scale})`}></iframe>` : ''}
      <div class="dbk-frame-veil"></div>
    </div>`;
}

/** One part opened whole: the render at full size, the words, and the line that takes it home. */
function PartDialog({ part, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const previewUrl = '/v1/designbook/' + encodeURIComponent(part.id) + '/preview';
  return html`
    <div class="dbk-overlay" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="dbk-dialog" role="dialog" aria-modal="true" aria-label=${part.title}>
        <button type="button" class="dbk-dialog-x" aria-label=${tr('designBook.close', 'Close')}
          onClick=${onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="2.5"/></svg>
        </button>
        <div class="dbk-dialog-meta">
          <span class="dbk-kind">${kindLabel(part.kind)}</span>
          <span class="dbk-id">${part.id}</span>
        </div>
        <h2 class="dbk-dialog-title">${part.title}</h2>
        <p class="dbk-dialog-summary">${part.summary}</p>
        <div class="dbk-dialog-frame">
          <iframe class="dbk-dialog-page" src=${previewUrl} sandbox="allow-scripts"
            title=${tr('designBook.previewOf', 'Preview of this part')}></iframe>
        </div>
        <div class="dbk-dialog-foot">
          <p class="dbk-adopt">
            <span class="dbk-adopt-label">${tr('designBook.adoptLabel', 'To use it:')}</span>
            ${' '}${tr('designBook.adoptText', 'tell the AI that builds your app to take this part from the Design Book by its address:')}
            ${' '}<span class="dbk-id">${part.id}</span>
          </p>
          <a class="dbk-open-full" href=${previewUrl} target="_blank" rel="noopener">
            ${tr('designBook.openFull', 'Open the render full size →')}
          </a>
        </div>
      </div>
    </div>`;
}

export default function DesignBook({ navigate }) {
  const [parts, setParts] = useState(null);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    fetch('/v1/designbook?limit=200')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setParts(Array.isArray(j?.data?.parts) ? j.data.parts : []))
      .catch((err) => { swallowed('design-book: load', err); setParts([]); });
  }, []);

  // An address in the URL (#leiska-back-room) opens that part once the list is in — the road
  // the Discover search takes here. Also on a later hash change, so a link works on a page
  // that is already open.
  useEffect(() => {
    if (!parts?.length) return;
    const openFromHash = () => {
      const target = window.location.hash && parts.find((p) => p.id === window.location.hash.slice(1));
      if (target) setOpen(target);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [parts]);

  const all = useMemo(() => parts || [], [parts]);
  const counts = useMemo(() => {
    const c = { all: all.length };
    for (const k of KINDS) c[k] = all.filter((p) => p.kind === k).length;
    return c;
  }, [all]);

  const ql = q.trim().toLowerCase();
  const shown = all
    .filter((p) => kind === 'all' || p.kind === kind)
    .filter((p) => !ql || `${p.id} ${p.title} ${p.summary} ${(p.tags || []).join(' ')}`.toLowerCase().includes(ql));

  return html`
    <div class="ld dbk">
      <section class="dbk-head">
        <span class="ld-sh-kicker">${tr('designBook.kicker', 'Proven parts, ready to take')}</span>
        <h1 class="dbk-title">${tr('designBook.title', 'The Design Book')}</h1>
        <p class="ld-sh-position">${tr('designBook.position', 'Every part shown as it renders, not as it is stored.')}</p>
        <p class="dbk-lead">${tr('designBook.lead', 'These are the arrangements, looks and pages that earned their place: each one passed its bench before landing here. Browse them by eye; when one fits, its address is all your AI needs to build with it.')}</p>
      </section>

      <div class="dbk-bar">
        <div class="dbk-chips" role="group" aria-label=${tr('designBook.filterLabel', 'Show only')}>
          <button type="button" class=${`dbk-chip ${kind === 'all' ? 'is-on' : ''}`} aria-pressed=${kind === 'all'} onClick=${() => setKind('all')}>
            ${tr('designBook.all', 'All')} · ${counts.all}
          </button>
          ${KINDS.filter((k) => counts[k] > 0).map((k) => html`
            <button type="button" key=${k} class=${`dbk-chip ${kind === k ? 'is-on' : ''}`} aria-pressed=${kind === k} onClick=${() => setKind(k)}>
              ${kindLabel(k)} · ${counts[k]}
            </button>`)}
        </div>
        <input class="dbk-search" type="search" value=${q} onInput=${(e) => setQ(e.target.value)}
          placeholder=${tr('designBook.searchPh', 'Search the Book…')} aria-label=${tr('designBook.searchPh', 'Search the Book')} />
      </div>
      ${kind !== 'all' ? html`<p class="dbk-kind-sub">${kindSub(kind)}</p>` : ''}

      ${parts === null ? html`<p class="dbk-empty">${tr('designBook.loading', 'Opening the Book…')}</p>` : ''}
      ${parts !== null && shown.length === 0 ? html`<p class="dbk-empty">${all.length === 0
        ? tr('designBook.none', 'No part has been published here yet.')
        : tr('designBook.noMatch', 'No part matches.')}</p>` : ''}

      <div class="dbk-grid">
        ${shown.map((p) => html`
          <article class="dbk-card" key=${p.id} id=${p.id}>
            <button type="button" class="dbk-card-open" onClick=${() => setOpen(p)}
              aria-label=${tr('designBook.openPart', 'Open this part') + ': ' + p.title}>
              <${PreviewFrame} id=${p.id} />
            </button>
            <div class="dbk-card-meta">
              <span class="dbk-kind">${kindLabel(p.kind)}</span>
              ${p.usage > 0 ? html`<span class="dbk-usage">${tr('designBook.usage', 'In use in builds:')} ${p.usage}</span>` : ''}
            </div>
            <h2 class="dbk-card-title">${p.title}</h2>
            <p class="dbk-card-summary">${p.summary}</p>
          </article>`)}
      </div>

      <section class="dbk-close">
        <p>
          <span class="dbk-close-label">${tr('designBook.growsLabel', 'How the Book grows:')}</span>
          ${' '}
          ${tr('designBook.growsText', 'When an AI builds something worth keeping here, it proposes the part back; the bench proves it and whoever runs this place publishes it. What you see is what the next build starts from.')}
          ${' '}
          <a href="/v1/portal" onClick=${(e) => { e.preventDefault(); navigate('/v1/portal'); }}>${tr('changelog.back', 'Back to the front page →')}</a>
        </p>
      </section>

      ${open ? html`<${PartDialog} part=${open} onClose=${() => { setOpen(null); if (window.location.hash) history.replaceState(null, '', window.location.pathname); }} />` : ''}
    </div>`;
}
