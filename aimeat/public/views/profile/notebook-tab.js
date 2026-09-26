/**
 * @file notebook-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile "Notebook" tab — free-text CAPTURE (saved to the notebook inbox), the LIBRARIAN
 *   read-head (GET /v1/librarian/search, ranked full-text across every organism you have contributed to
 *   plus your personal notes), and the per-owner trust toggles. Each captured note's organize workflow
 *   (suggest → enrich → distribute) lives in the NoteCard child (notebook-card.js); shared helpers in
 *   notebook-helpers.js. See docs/internal/design-organism-notebook-and-librarian.md.
 * @structure
 *   - NotebookTab (default export) — capture box, trust toggles, librarian search, inbox list → NoteCard
 * @usage html`<${NotebookTab} session=${session} showToast=${showToast} onStats=${onStats} />`
 * @version-history
 *   v1.15.0 -- 2026-09-26 -- The three trust settings are the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.14.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 -- 2026-09-26 -- The librarian's hits are the Listing (css/components/listing.css, name-desc-who-doors): the title with its key as the typewriter line under it, the producer and snippet as the words, the tag, Open (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-26 -- A hit's key wears the Key's face (.key-name, css/components/key-name.css) beside its small grey meta size (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.6.0 -- 2026-09-25 -- A section is the kit's section (PageSection in an .og page) and the line under its title is the lead (.og-lead), the look most tabs use (a unification).
 *   v1.5.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.4.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.3.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- V2u: compose the tab strip top rule from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-06-19 — Initial: capture + librarian search (slice A).
 *   v1.1.0 — 2026-06-21 — Enrich stage (Phase 1) + delegate (Phase 2) + distribute & trust toggles (Phase 3).
 *   v1.2.0 — 2026-06-21 — Split per-note organize workflow into NoteCard; tab keeps capture/search/inbox.
 *   v1.3.0 — 2026-07-16 — Mount folds the 3 reads (inbox + organism names + settings) into ONE
 *     GET /v1/notebook (NotebookService; inbox is a server-side prefix scan). Interactive re-fetches keep
 *     the individual loaders; falls back to them if the composite is unavailable. (Phase 4 slice 7.)
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { LoadingLine } from './shared.js';
import { PageSection } from '/components/PageSection.js';
import * as memoryService from '/js/services/memory.js';
import { getNotebookSettings, saveNotebookSettings } from '/js/services/notebook.js';
import { listOrganisms } from '/js/services/organisms.js';
import { apiGet } from '/js/api.js';
import { useConfirm } from '/components/Modal.js';
import NoteCard from './notebook-card.js';
import { INBOX_PREFIX, noteText } from './notebook-helpers.js';
import { swallowed } from '/js/swallowed.js';

export default function NotebookTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [inbox, setInbox] = useState(null);
  const [orgNames, setOrgNames] = useState({});
  const [inboxFilter, setInboxFilter] = useState('');
  const [inboxSort, setInboxSort] = useState('new');      // 'new' | 'old'

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);   // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [searchScope, setSearchScope] = useState('own');   // 'own' | 'public'

  const [settings, setSettings] = useState({ autoDetectIntent: false, autoRunPlan: false, autoDistribute: false });
  const [autoEnrichKey, setAutoEnrichKey] = useState(null); // the just-captured note to auto-enrich (trust mode)

  // Mount: ONE composite (GET /v1/notebook) seeds the inbox + settings + organism names. Interactive
  // re-fetches (post-capture/delete, live-update) keep using the individual loaders; a composite failure
  // falls back to them too.
  async function loadTab() {
    const ov = await apiGet('/v1/notebook').then(r => r?.data).catch(err => { swallowed('notebook-tab: loadTab', err); return null; });
    if (!ov) { loadInbox(); loadOrgNames(); loadSettings(); return; }
    setInbox(ov.inbox || []);
    onStats?.({ notebook: (ov.inbox || []).length });
    const map = {};
    for (const o of (ov.organisms?.organisms || [])) map[o.id] = o.name;
    setOrgNames(map);
    const s = ov.settings || {};
    setSettings({ autoDetectIntent: !!s.autoDetectIntent, autoRunPlan: !!s.autoRunPlan, autoDistribute: !!s.autoDistribute });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Initial load once the session is available; the loaders close over session/onStats/setters and are intentionally keyed to session.
  useEffect(() => { if (session) loadTab(); }, [session]);

  async function loadSettings() {
    try {
      const s = await getNotebookSettings();
      setSettings({ autoDetectIntent: !!s.autoDetectIntent, autoRunPlan: !!s.autoRunPlan, autoDistribute: !!s.autoDistribute });
    } catch (err) { swallowed('notebook-tab: loadSettings', err); }
  }
  async function toggleSetting(key) {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    try { await saveNotebookSettings(next); } catch (err) { swallowed('notebook-tab', err); showToast(t('profile.error'), true); }
  }

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
    } catch (err) { swallowed('notebook-tab', err); setInbox([]); }
  }

  async function loadOrgNames() {
    try {
      const resp = await listOrganisms({ member: session.owner });
      const map = {};
      for (const o of (resp?.data?.organisms || [])) map[o.id] = o.name;
      setOrgNames(map);
    } catch (err) { swallowed('notebook-tab: loadOrgNames', err); }
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
      // Trust mode: flag this note so its card auto-runs the planner once it mounts.
      if (settings.autoDetectIntent) setAutoEnrichKey(key);
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

  async function runSearch(q, scope) {
    if (!q) { setHits(null); return; }
    setSearching(true);
    try {
      setHits(await memoryService.librarianSearch(q, 50, scope));
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
      setHits([]);
    } finally { setSearching(false); }
  }
  function handleSearch() { runSearch(query.trim(), searchScope); }
  function pickScope(scope) {
    setSearchScope(scope);
    if (query.trim()) runSearch(query.trim(), scope);   // re-run so the toggle shows immediately
  }

  function hitDocId(hit) {
    const prefix = `organism.${hit.organismId}.w.${hit.workspaceId}.${hit.space}.`;
    return hit.space && hit.key.startsWith(prefix) ? hit.key.slice(prefix.length).split('.')[0] : null;
  }
  /** Whether a hit has a place to open (so the button is shown). */
  function canOpen(hit) {
    if (hit.kind === 'knowledge') return !!hit.packageId;
    if (hit.organismId && hit.workspaceId) return true;
    return searchScope !== 'public';   // personal memory only has an in-app home in your own scope
  }
  // Open a hit at its real home. Knowledge → the public knowledge viewer; an organism document →
  // the in-app workspace doc (your own) or the public no-auth workspace viewer (public scope); a
  // personal entry → the Memory tab.
  function openHit(hit) {
    if (hit.kind === 'knowledge' && hit.packageId) {
      window.open(`/v1/publicknowledgeviewer?id=${encodeURIComponent(hit.packageId)}`, '_blank', 'noopener');
      return;
    }
    if (hit.organismId && hit.workspaceId) {
      const docId = hitDocId(hit);
      if (searchScope === 'public') {
        let u = `/v1/publicworkspaceviewer?org=${encodeURIComponent(hit.organismId)}&ws=${encodeURIComponent(hit.workspaceId)}`;
        if (hit.space && docId) u += `&type=${encodeURIComponent(hit.space)}&id=${encodeURIComponent(docId)}`;
        window.open(u, '_blank', 'noopener');
        return;
      }
      try {
        sessionStorage.setItem('aimeat.ws.openId', hit.organismId);
        sessionStorage.setItem('aimeat.ws.openWs', hit.workspaceId);
        if (docId) sessionStorage.setItem(`aimeat.ws.${hit.organismId}.${hit.workspaceId}.openDoc`, JSON.stringify({ namespace: hit.space, id: docId }));
      // eslint-disable-next-line aimeat/no-silent-catch -- noop
      } catch { /* noop */ }
      window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }));
      return;
    }
    if (searchScope !== 'public') window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'memory' } }));
  }

  /** Short producer label for a public hit: agent#owner or owner (drop the @node). */
  function producerLabel(gaii) {
    return String(gaii || '').split('@')[0];
  }

  // Filter (text) + sort (date) the inbox for display.
  function visibleInbox() {
    const ft = inboxFilter.trim().toLowerCase();
    const filtered = (inbox || []).filter(n => !ft || noteText(n.value).toLowerCase().includes(ft));
    return filtered.sort((a, b) => {
      const da = +new Date(a.updated_at || a.created_at || 0), db = +new Date(b.updated_at || b.created_at || 0);
      return inboxSort === 'old' ? da - db : db - da;
    });
  }

  const renderHit = (hit) => html`
    <div class="listing-row" key=${hit.key}>
      <div class="listing-name">${escHtml(hit.title || hit.key)}<small title=${hit.key}>${escHtml(hit.key)}</small></div>
      <div class="listing-desc">
        ${searchScope === 'public' && html`<div>${t('profile.notebook.producer')}: ${escHtml(producerLabel(hit.producer))}</div>`}
        ${hit.snippet && escHtml(hit.snippet)}
      </div>
      <div class="listing-who">${hit.kind === 'knowledge'
          ? html`<span class="poster-chip">${t('profile.notebook.kindKnowledge')}${hit.contentType ? ` · ${escHtml(hit.contentType)}` : ''}</span>`
          : hit.organismId
            ? html`<span class="poster-chip">${escHtml(orgNames[hit.organismId] || hit.organismId)}</span>`
            : html`<span class="poster-chip">${t('profile.notebook.personalNote')}</span>`}</div>
      <div class="listing-doors">${canOpen(hit) && html`<button class="poster-action poster-action--small poster-action--row" onClick=${() => openHit(hit)}>${t('profile.notebook.openInMemory')}</button>`}</div>
    </div>
  `;

  return html`
    ${ConfirmUI}
    <div class="og">
    <div class="mb-1">
      <div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuInformation')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.notebook')}</span></div>
      <div class="og-mast"><div class="og-mast-words">
        <div class="og-title poster-page-title">${t('profile.notebook.title')}</div>
        <div class="og-desc">${t('profile.notebook.desc')}</div>
      </div></div>
    </div>

    <div class="pf-nb-capture">
      <textarea class="og-textarea pf-nb-textarea" rows="4"
        placeholder=${t('profile.notebook.capturePlaceholder')}
        value=${draft} onInput=${e => setDraft(e.target.value)}></textarea>
      <div class="pf-nb-capture-actions">
        <button class="poster-slab poster-slab--control" disabled=${!draft.trim() || saving} onClick=${handleCapture}>
          ${saving ? '…' : t('profile.notebook.captureBtn')}
        </button>
        <span class="text-meta-sm">${t('profile.notebook.captureHint')}</span>
      </div>
      <div class="pf-nb-settings">
        <span class="text-meta-sm">${t('profile.notebook.trustTitle')}</span>
        <label class="pf-nb-toggle check-line"><input type="checkbox" checked=${settings.autoDetectIntent} onChange=${() => toggleSetting('autoDetectIntent')} /> ${t('profile.notebook.autoDetect')}</label>
        <label class="pf-nb-toggle check-line"><input type="checkbox" checked=${settings.autoRunPlan} onChange=${() => toggleSetting('autoRunPlan')} /> ${t('profile.notebook.autoRun')}</label>
        <label class="pf-nb-toggle check-line"><input type="checkbox" checked=${settings.autoDistribute} onChange=${() => toggleSetting('autoDistribute')} /> ${t('profile.notebook.autoDistribute')}</label>
      </div>
    </div>

    <${PageSection} title=${t('profile.notebook.librarianTitle')}>
    <div class="og-lead">${t('profile.notebook.librarianDesc')}</div>
    <div class="sub-tabs poster-row--thing pf-nb-scope">
      <button class="poster-tab ${searchScope === 'own' ? 'is-on' : ''}" onClick=${() => pickScope('own')}>${t('profile.notebook.scopeOwn')}</button>
      <button class="poster-tab ${searchScope === 'public' ? 'is-on' : ''}" onClick=${() => pickScope('public')}>${t('profile.notebook.scopePublic')}</button>
    </div>
    <div class="action-bar">
      <div class="search-line pf-nb-search">
        <input type="text" class="og-input" placeholder=${t('profile.notebook.searchPlaceholder')}
          value=${query} onInput=${e => setQuery(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && handleSearch()} />
        <button class="poster-slab" onClick=${handleSearch}>${t('profile.notebook.searchBtn')}</button>
      </div>
    </div>
    ${searching && html`<${LoadingLine} text=${t('profile.notebook.searching')} />`}
    ${!searching && hits !== null && html`
      ${hits.length === 0
        ? html`<div class="poster-quiet">${t('profile.notebook.noHits')}</div>`
        : html`
          <div class="text-meta-sm mb-half">${(t('profile.notebook.hitsCount') || '{n} results').replace('{n}', String(hits.length))}</div>
          <div class="listing listing--name-desc-who-doors">${hits.map(renderHit)}</div>
        `}
    `}
    <//>

    <${PageSection} title=${t('profile.notebook.inboxTitle')}>
    ${inbox === null
      ? html`<${LoadingLine} text=${t('profile.notebook.inboxLoading')} />`
      : inbox.length === 0
        ? html`<div class="poster-quiet">${t('profile.notebook.inboxEmpty')}</div>`
        : html`
          <div class="action-bar pf-nb-inbox-bar">
            <div class="search-line pf-nb-search">
              <input type="text" class="og-input" placeholder=${t('profile.notebook.filterPlaceholder')}
                value=${inboxFilter} onInput=${e => setInboxFilter(e.target.value)} />
              ${inboxFilter && html`<button class="poster-icon poster-icon--small" onClick=${() => setInboxFilter('')}>✕</button>`}
            </div>
            <select class="select-field pf-nb-sort" value=${inboxSort} onChange=${e => setInboxSort(e.target.value)}>
              <option value="new">${t('profile.notebook.sortNew')}</option>
              <option value="old">${t('profile.notebook.sortOld')}</option>
            </select>
          </div>
          ${visibleInbox().length === 0
            ? html`<div class="poster-quiet">${t('profile.notebook.noMatch')}</div>`
            : html`<div class="pf-nb-inbox">
              ${visibleInbox().map(note => html`
                <${NoteCard} key=${note.key} note=${note} showToast=${showToast} orgNames=${orgNames}
                  settings=${settings} autoEnrich=${settings.autoDetectIntent && autoEnrichKey === note.key}
                  onChanged=${loadInbox} onOrgsChanged=${loadOrgNames} onDelete=${handleDelete} />
              `)}
            </div>`}
        `
    }
    <//>
    </div>
  `;
}
