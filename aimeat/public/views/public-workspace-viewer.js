/**
 * @file public-workspace-viewer.js
 * @description Public, no-login viewer for an organism workspace's shared document-space pages.
 *   Reads the no-auth endpoint GET /v1/organisms/:id/workspace/public/documents?ws=… (which serves
 *   only PUBLISHED docs the workspace's meta.share marks public) and renders each page's markdown with
 *   the safe Markdown component. A table-of-contents lists the shared pages; [[Wiki links]] jump
 *   between them. The whole-space view renders EVERY shared page stacked in one continuous document
 *   (the TOC scroll-spies + scrolls), so "Print / Save as PDF" captures all pages in one go — there is
 *   no server-side PDF. A single page can still be deep-linked (and isolated) with &type=…&id=….
 *   "Copy AI link" copies the no-auth Markdown-bundle API URL (?format=md) so an agent can read the
 *   raw content directly; drop &format=md for the JSON form.
 * @structure PublicWorkspaceViewer (default export)
 * @usage route /v1/publicworkspaceviewer?org=<id>&ws=<ws>[&type=<space>&id=<docId>]
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: slice 2 of the workspace public-sharing plan.
 *   v1.1.0 — 2026-06-09 — Continuous whole-space render (all pages stacked → print captures everything)
 *     with scroll-spy TOC; "Copy AI link" button exposing the ?format=md Markdown-bundle API URL.
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);

const docKey = (d) => `${d.type}/${d.id}`;
// A DOM-id-safe anchor for each stacked page so the TOC can scroll to it.
const anchorId = (d) => `pwv-doc-${docKey(d).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

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

  // A doc is "isolated" (single-page mode) only when the link explicitly deep-links one page via
  // &type=&id=. The plain whole-space link renders EVERY page stacked (continuous document) so the
  // browser print captures all of them at once.
  const isSingle = Array.isArray(docs) && !!type && !!id && docs.some(d => docKey(d) === `${type}/${id}`);
  const visibleDocs = Array.isArray(docs) ? (isSingle ? docs.filter(d => docKey(d) === `${type}/${id}`) : docs) : [];
  const current = Array.isArray(docs) ? docs.find(d => docKey(d) === selected) : null;
  useEffect(() => {
    if (current?.title) document.title = `${current.title} — AIMEAT`;
  }, [current?.title]);

  // Scroll a page into view and mark it active (TOC click + initial deep-link land).
  const goTo = useCallback((d) => {
    setSelected(docKey(d));
    const el = document.getElementById(anchorId(d));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // On first load of the whole-space view, if a page was deep-linked, scroll to it.
  const didLand = useRef(false);
  useEffect(() => {
    if (didLand.current || isSingle || !Array.isArray(docs) || docs.length === 0) return;
    if (type && id) {
      const hit = docs.find(d => docKey(d) === `${type}/${id}`);
      if (hit) { didLand.current = true; setTimeout(() => goTo(hit), 0); }
    }
  }, [docs, isSingle, type, id, goTo]);

  // Scroll-spy: highlight the TOC entry for the page currently in view (whole-space mode only).
  useEffect(() => {
    if (isSingle || !Array.isArray(docs) || docs.length === 0) return;
    const obs = new IntersectionObserver((entries) => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setSelected(/** @type {HTMLElement} */ (top.target).dataset.pwvKey);
    }, { rootMargin: '-10% 0px -75% 0px', threshold: 0 });
    docs.forEach(d => { const el = document.getElementById(anchorId(d)); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [docs, isSingle]);

  // [[Wiki links]] jump to another shared page by (case-insensitive) title.
  const onWikiLink = useCallback((title) => {
    if (!Array.isArray(docs)) return;
    const want = String(title).split('#')[0].trim().toLowerCase();
    const hit = docs.find(d => String(d.title).trim().toLowerCase() === want);
    if (hit) goTo(hit);
  }, [docs, goTo]);

  // The no-auth Markdown-bundle API URL — paste it to an AI agent to read the raw content directly.
  // Single-page link when isolated, whole-space bundle otherwise; drop &format=md for the JSON form.
  const aiLink = isSingle
    ? `${window.location.origin}/v1/organisms/${encodeURIComponent(org)}/workspace/public/document?ws=${encodeURIComponent(ws)}&type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&format=md`
    : `${window.location.origin}/v1/organisms/${encodeURIComponent(org)}/workspace/public/documents?ws=${encodeURIComponent(ws)}&format=md`;
  const [copied, setCopied] = useState(false);
  const copyAiLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(aiLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — ignore */ }
  }, [aiLink]);

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
              onClick=${() => goTo(d)}
            >${d.title || d.id}</button>
          `)}
        </nav>
      </aside>

      <main class="pwv-main">
        <div class="pwv-bar">
          <span class="pwv-badge">${t('pwv.publicBadge') || 'Public document'}</span>
          <div class="pwv-bar-actions">
            <button class="btn-outline btn-sm pwv-action" onClick=${copyAiLink}>
              ${copied ? (t('pwv.copied') || 'Copied!') : (t('pwv.copyAiLink') || 'Copy AI link (Markdown)')}
            </button>
            <button class="btn-outline btn-sm pwv-action" onClick=${() => window.print()}>
              ${t('pwv.print') || 'Print / Save as PDF'}
            </button>
          </div>
        </div>
        ${visibleDocs.length > 0
          ? visibleDocs.map(d => html`
              <article class="pwv-doc" id=${anchorId(d)} data-pwv-key=${docKey(d)}>
                <${Markdown} text=${d.markdown || ''} onWikiLink=${onWikiLink} />
              </article>
            `)
          : html`<div class="pwv-state">${t('pwv.selectDocument') || 'Select a document.'}</div>`
        }
      </main>
    </div>
  `;
}
