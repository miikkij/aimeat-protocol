/**
 * @file notebook-tab.js
 * @description Profile "Notebook" tab — slice A: free-text CAPTURE (saved to the notebook inbox) +
 *   the LIBRARIAN read-head (GET /v1/librarian/search, ranked full-text across every organism you
 *   have contributed to plus your personal notes). Classify → disambiguate → materialize-document
 *   is slice B. See docs/internal/design-organism-notebook-and-librarian.md.
 * @structure
 *   - NotebookTab (default export) — capture box, inbox list, librarian search
 * @usage html`<${NotebookTab} session=${session} showToast=${showToast} onStats=${onStats} />`
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: capture + librarian search (slice A).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as memoryService from '/js/services/memory.js';
import { listOrganisms } from '/js/services/organisms.js';
import { useConfirm } from '/components/Modal.js';

const INBOX_PREFIX = 'notebook.inbox.';

function relTime(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t('profile.memory.timeJustNow') || 'just now';
  if (mins < 60) return (t('profile.memory.timeMinsAgo') || '{n}m ago').replace('{n}', String(mins));
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return (t('profile.memory.timeHoursAgo') || '{n}h ago').replace('{n}', String(hrs));
  const days = Math.floor(hrs / 24);
  if (days < 30) return (t('profile.memory.timeDaysAgo') || '{n}d ago').replace('{n}', String(days));
  return new Date(iso).toLocaleDateString();
}

/** Best-effort plain text of a note value for the inbox preview. */
function noteText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    return JSON.stringify(value);
  }
  return String(value ?? '');
}

export default function NotebookTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [inbox, setInbox] = useState(null);
  const [orgNames, setOrgNames] = useState({});

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);   // null = not searched yet
  const [searching, setSearching] = useState(false);

  useEffect(() => { if (session) { loadInbox(); loadOrgNames(); } }, [session]);

  // Re-fetch the inbox on live updates (a capture elsewhere, a sync) — Rule from the frontend guide.
  const liveRef = useRef(() => loadInbox());
  liveRef.current = () => loadInbox();
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function loadInbox() {
    try {
      const all = await memoryService.listMemories();
      const notes = (Array.isArray(all) ? all : [])
        .filter(m => typeof m.key === 'string' && m.key.startsWith(INBOX_PREFIX))
        .sort((a, b) => +new Date(b.updated_at || b.created_at || 0) - +new Date(a.updated_at || a.created_at || 0));
      setInbox(notes);
      onStats?.({ notebook: notes.length });
    } catch { setInbox([]); }
  }

  async function loadOrgNames() {
    try {
      const resp = await listOrganisms({ member: session.owner });
      const map = {};
      for (const o of (resp?.data?.organisms || [])) map[o.id] = o.name;
      setOrgNames(map);
    } catch { /* names are a nicety — ids still render */ }
  }

  async function handleCapture() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const key = INBOX_PREFIX + Date.now();
      const resp = await memoryService.createMemory(key, { text, capturedAt: new Date().toISOString() }, 'private');
      if (resp?.ok === false) { showToast(resp.error?.message || t('profile.notebook.saveFailed'), true); return; }
      showToast(t('profile.notebook.saved'));
      setDraft('');
      await loadInbox();
    } catch (e) {
      showToast(e.message || t('profile.notebook.saveFailed'), true);
    } finally { setSaving(false); }
  }

  function handleDelete(key) {
    confirm(t('profile.notebook.deleteConfirm'), async () => {
      const resp = await memoryService.deleteMemory(key);
      if (resp?.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
      showToast(t('profile.notebook.deleted'));
      loadInbox();
    }, { danger: true });
  }

  async function handleSearch() {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    setSearching(true);
    try {
      const results = await memoryService.librarianSearch(q, 50);
      setHits(results);
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
      setHits([]);
    } finally { setSearching(false); }
  }

  function openInMemory() {
    window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'memory' } }));
  }

  const renderHit = (hit) => html`
    <div class="pf-nb-hit" key=${hit.key}>
      <div class="pf-nb-hit-head">
        <span class="pf-nb-hit-title">${escHtml(hit.title || hit.key)}</span>
        ${hit.organismId
          ? html`<span class="badge badge-info">${escHtml(orgNames[hit.organismId] || hit.organismId)}</span>`
          : html`<span class="badge">${t('profile.notebook.personalNote')}</span>`}
      </div>
      ${hit.snippet && html`<div class="pf-nb-hit-snippet">${escHtml(hit.snippet)}</div>`}
      <div class="pf-nb-hit-foot">
        <span class="text-meta-sm pf-nb-hit-key" title=${hit.key}>${escHtml(hit.key)}</span>
        <button class="btn-ghost btn-sm" onClick=${openInMemory}>${t('profile.notebook.openInMemory')}</button>
      </div>
    </div>
  `;

  return html`
    ${ConfirmUI}
    <div class="section-title">${t('profile.notebook.title')}</div>
    <div class="section-desc">${t('profile.notebook.desc')}</div>

    <div class="pf-nb-capture">
      <textarea class="input-field pf-nb-textarea" rows="4"
        placeholder=${t('profile.notebook.capturePlaceholder')}
        value=${draft} onInput=${e => setDraft(e.target.value)}></textarea>
      <div class="pf-nb-capture-actions">
        <button class="btn-primary" disabled=${!draft.trim() || saving} onClick=${handleCapture}>
          ${saving ? '…' : t('profile.notebook.captureBtn')}
        </button>
        <span class="text-meta-sm">${t('profile.notebook.captureHint')}</span>
      </div>
    </div>

    <div class="section-title pf-nb-section">${t('profile.notebook.librarianTitle')}</div>
    <div class="section-desc">${t('profile.notebook.librarianDesc')}</div>
    <div class="action-bar">
      <div class="search-bar pf-nb-search">
        <input type="text" class="input-field" placeholder=${t('profile.notebook.searchPlaceholder')}
          value=${query} onInput=${e => setQuery(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && handleSearch()} />
        <button class="btn-primary" onClick=${handleSearch}>${t('profile.notebook.searchBtn')}</button>
      </div>
    </div>
    ${searching && html`<${Spinner} text=${t('profile.notebook.searching')} />`}
    ${!searching && hits !== null && html`
      ${hits.length === 0
        ? html`<div class="empty">${t('profile.notebook.noHits')}</div>`
        : html`
          <div class="text-meta-sm mb-half">${(t('profile.notebook.hitsCount') || '{n} results').replace('{n}', String(hits.length))}</div>
          <div class="pf-nb-hits">${hits.map(renderHit)}</div>
        `}
    `}

    <div class="section-title pf-nb-section">${t('profile.notebook.inboxTitle')}</div>
    ${inbox === null
      ? html`<${Spinner} text=${t('profile.notebook.inboxLoading')} />`
      : inbox.length === 0
        ? html`<div class="empty">${t('profile.notebook.inboxEmpty')}</div>`
        : html`<div class="pf-nb-inbox">
            ${inbox.map(note => html`
              <div class="pf-nb-note" key=${note.key}>
                <div class="pf-nb-note-text">${escHtml(noteText(note.value))}</div>
                <div class="pf-nb-note-foot">
                  <span class="text-meta-sm">${relTime(note.updated_at || note.created_at)}</span>
                  <button class="btn-danger btn-sm" onClick=${() => handleDelete(note.key)}>${t('profile.notebook.deleteBtn')}</button>
                </div>
              </div>
            `)}
          </div>`
    }
  `;
}
