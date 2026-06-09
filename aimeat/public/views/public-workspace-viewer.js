/**
 * @file public-workspace-viewer.js
 * @description Public, no-login viewer for an organism workspace's shared document-space pages.
 *   Reads the no-auth endpoint GET /v1/organisms/:id/workspace/public/documents?ws=… (which serves
 *   only PUBLISHED docs the workspace's meta.share marks public) and renders each page's markdown with
 *   the safe Markdown component. A table-of-contents lists the shared pages; [[Wiki links]] jump
 *   between them. "Print / Save as PDF" uses the browser's native print (a print stylesheet hides the
 *   chrome) — there is no server-side PDF. Deep-link a single page with &type=…&id=….
 * @structure PublicWorkspaceViewer (default export)
 * @usage route /v1/publicworkspaceviewer?org=<id>&ws=<ws>[&type=<space>&id=<docId>]
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: slice 2 of the workspace public-sharing plan.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);

const docKey = (d) => `${d.type}/${d.id}`;

function parseParams() {
  const p = new URLSearchParams(window.location.search);
  return { org: p.get('org') || '', ws: p.get('ws') || '', type: p.get('type') || '', id: p.get('id') || '' };
}

export default function PublicWorkspaceViewer() {
  useViewCSS('/css/views/public-workspace-viewer.css');
  const { org, ws, type, id } = parseParams();
  const [docs, setDocs] = useState(undefined); // undefined = loading, [] = none/unavailable, array = loaded
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!org || !ws) { setDocs([]); return; }
    setError(null);
    try {
      const res = await fetch(`/v1/organisms/${encodeURIComponent(org)}/workspace/public/documents?ws=${encodeURIComponent(ws)}`);
      if (res.status === 404) { setDocs([]); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list = Array.isArray(body?.data?.documents) ? body.data.documents : [];
      setDocs(list);
      const want = type && id ? `${type}/${id}` : null;
      setSelected(
        (want && list.some(d => docKey(d) === want)) ? want
          : (list[0] ? docKey(list[0]) : null),
      );
    } catch (e) {
      setError((e && e.message) || 'Failed to load');
      setDocs([]);
    }
  }, [org, ws, type, id]);

  useEffect(() => { load(); }, [load]);

  // Mark the body while this view is mounted so the print stylesheet can hide the SPA shell chrome
  // (the global nav lives outside this component) without a `:has()` dependency.
  useEffect(() => {
    document.body.classList.add('pwv-active');
    return () => document.body.classList.remove('pwv-active');
  }, []);

  const current = Array.isArray(docs) ? docs.find(d => docKey(d) === selected) : null;
  useEffect(() => {
    if (current?.title) document.title = `${current.title} — AIMEAT`;
  }, [current?.title]);

  // [[Wiki links]] jump to another shared page by (case-insensitive) title.
  const onWikiLink = useCallback((title) => {
    if (!Array.isArray(docs)) return;
    const want = String(title).split('#')[0].trim().toLowerCase();
    const hit = docs.find(d => String(d.title).trim().toLowerCase() === want);
    if (hit) setSelected(docKey(hit));
  }, [docs]);

  if (docs === undefined) {
    return html`<div class="pwv-container"><div class="pwv-state">${t('pwv.loading') || 'Loading…'}</div></div>`;
  }

  if (error) {
    return html`<div class="pwv-container"><div class="pwv-state pwv-error">${error}</div></div>`;
  }

  if (!org || !ws || docs.length === 0) {
    return html`
      <div class="pwv-container">
        <div class="pwv-empty">
          <div class="pwv-empty-icon">🔒</div>
          <h2>${t('pwv.unavailableTitle') || 'Nothing to show here'}</h2>
          <p>${t('pwv.unavailableDesc') || 'This workspace has no publicly shared documents, or the link is incomplete.'}</p>
        </div>
      </div>
    `;
  }

  return html`
    <div class="pwv-container">
      <aside class="pwv-toc">
        <div class="pwv-toc-head">${t('pwv.sharedDocuments') || 'Shared documents'}</div>
        <nav class="pwv-toc-list">
          ${docs.map(d => html`
            <button
              class="pwv-toc-item ${docKey(d) === selected ? 'pwv-active' : ''}"
              onClick=${() => setSelected(docKey(d))}
            >${d.title || d.id}</button>
          `)}
        </nav>
      </aside>

      <main class="pwv-main">
        <div class="pwv-bar">
          <span class="pwv-badge">${t('pwv.publicBadge') || 'Public document'}</span>
          <button class="btn-outline btn-sm pwv-print" onClick=${() => window.print()}>
            ${t('pwv.print') || 'Print / Save as PDF'}
          </button>
        </div>
        ${current
          ? html`<article class="pwv-doc"><${Markdown} text=${current.markdown || ''} onWikiLink=${onWikiLink} /></article>`
          : html`<div class="pwv-state">${t('pwv.selectDocument') || 'Select a document.'}</div>`
        }
      </main>
    </div>
  `;
}
