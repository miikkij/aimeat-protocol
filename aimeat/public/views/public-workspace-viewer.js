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
 *   v1.2.0 — 2026-07-10 — TARGET-025 share access modes: a 401 SHARE_PASSWORD_REQUIRED renders a
 *     password prompt (unlock → X-Share-Token kept in sessionStorage per org+ws, sent on reads);
 *     SHARE_ACCOUNT_REQUIRED renders a sign-in-required state (the read retries with the shell
 *     session's JWT once signed in). The load fetch now attaches the SPA session JWT when present
 *     so members/signed-in visitors pass the gate without a token.
 *   v1.0.0 — 2026-06-09 — Initial: slice 2 of the workspace public-sharing plan.
 *   v1.1.0 — 2026-06-09 — Continuous whole-space render (all pages stacked → print captures everything)
 *     with scroll-spy TOC; "Copy AI link" button exposing the ?format=md Markdown-bundle API URL.
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.1.2 — 2026-07-07 — Fix: in isolated single-page mode (a per-doc "open ↗" deep-link) the TOC
 *     now switches the rendered page instead of only moving the highlight — the visible page follows
 *     `selected`, TOC clicks scroll back to top, and "Copy AI link" tracks the current page.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

const docKey = (d) => `${d.type}/${d.id}`;
// A DOM-id-safe anchor for each stacked page so the TOC can scroll to it.
const anchorId = (d) => `pwv-doc-${docKey(d).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

function parseParams() {
  const p = new URLSearchParams(window.location.search);
  return { org: p.get('org') || '', ws: p.get('ws') || '', type: p.get('type') || '', id: p.get('id') || '' };
}

// sessionStorage key for the share token of one workspace (password access mode).
const shareTokenKey = (org, ws) => `aimeat.pwv.st.${org}.${ws}`;

export default function PublicWorkspaceViewer() {
  useViewCSS('/css/views/public-workspace-viewer.css');
  const { org, ws, type, id } = parseParams();
  const [docs, setDocs] = useState(undefined); // undefined = loading, [] = none/unavailable, array = loaded
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [gate, setGate] = useState(null);      // null | 'password' | 'account' — 401 gate from the share's access mode
  const [pw, setPw] = useState('');
  const [unlockErr, setUnlockErr] = useState(null);
  const [unlockBusy, setUnlockBusy] = useState(false);

  const load = useCallback(async () => {
    if (!org || !ws) { setDocs([]); return; }
    setError(null);
    try {
      // Attach the SPA session JWT when signed in (members + account-mode visitors pass the gate)
      // and the stored share token when this workspace was unlocked with a password.
      const headers = /** @type {Record<string, string>} */ ({});
      const session = window.AIMEAT?.auth?.getSession?.();
      if (session?.jwt) headers['Authorization'] = 'Bearer ' + session.jwt;
      let st = null;
      try { st = sessionStorage.getItem(shareTokenKey(org, ws)); } catch { /* storage unavailable */ }   // eslint-disable-line aimeat/no-silent-catch -- storage unavailable
      if (st) headers['X-Share-Token'] = st;
      const res = await fetch(`/v1/organisms/${encodeURIComponent(org)}/workspace/public/documents?ws=${encodeURIComponent(ws)}`, { headers });
      if (res.status === 404) { setDocs([]); setGate(null); return; }
      if (res.status === 401) {
        const body = await res.json().catch(err => { swallowed('public-workspace-viewer', err); return null; });
        const code = body?.error?.code;
        setGate(code === 'SHARE_ACCOUNT_REQUIRED' ? 'account' : 'password');
        setDocs([]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list = Array.isArray(body?.data?.documents) ? body.data.documents : [];
      setGate(null);
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

  // Exchange the typed password for a share token (kept per org+ws in sessionStorage), then reload.
  const unlock = useCallback(async (e) => {
    if (e) e.preventDefault();
    if (!pw || unlockBusy) return;
    setUnlockBusy(true); setUnlockErr(null);
    try {
      const res = await fetch(`/v1/organisms/${encodeURIComponent(org)}/workspace/share/unlock`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ws, password: pw }),
      });
      if (res.status === 429) { setUnlockErr(t('pwv.passwordTooMany') || 'Too many attempts — try again in a few minutes.'); return; }
      const body = await res.json().catch(err => { swallowed('public-workspace-viewer: PublicWorkspaceViewer', err); return null; });
      if (!res.ok || !body?.data?.share_token) { setUnlockErr(t('pwv.passwordWrong') || 'Wrong password.'); return; }
      try { sessionStorage.setItem(shareTokenKey(org, ws), body.data.share_token); } catch { /* storage unavailable */ }   // eslint-disable-line aimeat/no-silent-catch -- storage unavailable
      setPw(''); setDocs(undefined); setGate(null);
      await load();
    // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
    } catch {
      setUnlockErr(t('pwv.passwordWrong') || 'Wrong password.');
    } finally {
      setUnlockBusy(false);
    }
  }, [org, ws, pw, unlockBusy, load]);

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
  const current = Array.isArray(docs) ? docs.find(d => docKey(d) === selected) : null;
  // Isolated single-page mode shows ONE page at a time, but the TOC must still be able to switch
  // which one: follow `selected` (seeded from the &type=&id= deep-link, then updated on every TOC
  // click) instead of pinning to the URL, so clicking another shared page actually swaps the page.
  const visibleDocs = Array.isArray(docs) ? (isSingle ? (current ? [current] : []) : docs) : [];
  useEffect(() => {
    if (current?.title) document.title = `${current.title} — AIMEAT`;
  }, [current?.title]);

  // Scroll a page into view and mark it active (TOC click + initial deep-link land).
  const goTo = useCallback((d) => {
    setSelected(docKey(d));
    // Whole-space view: the page is already rendered — scroll it into view.
    const el = document.getElementById(anchorId(d));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    // Isolated single-page view: the picked page renders on the next tick; jump back to the top.
    setTimeout(() => (document.querySelector('.page-content') || window).scrollTo({ top: 0, behavior: 'smooth' }), 0);
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
  const aiLink = isSingle && current
    ? `${window.location.origin}/v1/organisms/${encodeURIComponent(org)}/workspace/public/document?ws=${encodeURIComponent(ws)}&type=${encodeURIComponent(current.type)}&id=${encodeURIComponent(current.id)}&format=md`
    : `${window.location.origin}/v1/organisms/${encodeURIComponent(org)}/workspace/public/documents?ws=${encodeURIComponent(ws)}&format=md`;
  const [copied, setCopied] = useState(false);
  const copyAiLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(aiLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    // eslint-disable-next-line aimeat/no-silent-catch -- clipboard unavailable — ignore
    } catch { /* clipboard unavailable — ignore */ }
  }, [aiLink]);

  if (docs === undefined) {
    return html`<div class="pwv-container"><div class="pwv-state">${t('pwv.loading') || 'Loading…'}</div></div>`;
  }

  if (error) {
    return html`<div class="pwv-container"><div class="pwv-state pwv-error">${error}</div></div>`;
  }

  if (gate === 'password') {
    return html`
      <div class="pwv-container">
        <div class="pwv-empty pwv-gate">
          <div class="pwv-empty-icon">🔑</div>
          <h2>${t('pwv.passwordTitle') || 'This share is password-protected'}</h2>
          <p>${t('pwv.passwordDesc') || 'Enter the password you received to open the shared documents.'}</p>
          <form class="pwv-gate-form" onSubmit=${unlock}>
            <input type="password" class="pwv-gate-input" autocomplete="off" autofocus
              placeholder=${t('pwv.passwordPlaceholder') || 'Password'}
              value=${pw} disabled=${unlockBusy}
              onInput=${e => setPw(e.target.value)} />
            <button type="submit" class="btn-primary btn-sm" disabled=${unlockBusy || !pw}>
              ${unlockBusy ? (t('pwv.passwordOpening') || 'Opening…') : (t('pwv.passwordOpen') || 'Open')}
            </button>
          </form>
          ${unlockErr ? html`<p class="pwv-gate-err">${unlockErr}</p>` : null}
        </div>
      </div>
    `;
  }

  if (gate === 'account') {
    return html`
      <div class="pwv-container">
        <div class="pwv-empty pwv-gate">
          <div class="pwv-empty-icon">👤</div>
          <h2>${t('pwv.accountTitle') || 'Sign in to view this share'}</h2>
          <p>${t('pwv.accountDesc') || 'The owner shares these documents with signed-in users only. Sign in from the top-right corner of this page, then try again.'}</p>
          <button class="btn-primary btn-sm" onClick=${() => { setDocs(undefined); setGate(null); load(); }}>
            ${t('pwv.accountRetry') || 'I signed in — try again'}
          </button>
        </div>
      </div>
    `;
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
