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
import { classifyNote, materializeDocument } from '/js/services/notebook.js';
import { listOrganisms } from '/js/services/organisms.js';
import { useConfirm } from '/components/Modal.js';
import { Markdown } from '/components/Markdown.js';
import { OpenRouterSettings } from './generator-settings.js';

const NEW = '__new__';

// Stages shown while the (slow) AI classify call runs, so the user sees what is happening. The
// timer advances to (and dwells on) the AI step — that is genuinely where the wait is spent.
const NB_STEPS = ['profile.notebook.step1', 'profile.notebook.step2'];

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

/** First non-empty line of a note (markdown heading marks stripped), for the collapsed one-line view. */
function firstLine(text) {
  const line = (text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  return line.replace(/^#{1,6}\s+/, '').replace(/[*_`>#]/g, '').slice(0, 160);
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
  const [inboxFilter, setInboxFilter] = useState('');
  const [inboxSort, setInboxSort] = useState('new');      // 'new' | 'old'
  const [noteView, setNoteView] = useState({});           // noteKey → 'line' | 'peek' | 'full' (default 'peek')

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);   // null = not searched yet
  const [searching, setSearching] = useState(false);

  // Slice B — placement suggestion for one note at a time.
  const [sortingKey, setSortingKey] = useState(null);   // note key being classified (loading)
  const [sortStep, setSortStep] = useState(0);          // progress stage index during classify
  const [sortError, setSortError] = useState(null);     // { noteKey, message } — persistent inline error
  const [suggest, setSuggest] = useState(null);         // { noteKey, result, edit }
  const [materializing, setMaterializing] = useState(false);
  const stepTimer = useRef(null);
  function stopStepTimer() { if (stepTimer.current) { clearInterval(stepTimer.current); stepTimer.current = null; } }
  useEffect(() => stopStepTimer, []);

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

  // Collapse cycle for an inbox note: one line → peek → full → one line.
  const cycleView = (key) => setNoteView(v => {
    const cur = v[key] || 'peek';
    const next = cur === 'line' ? 'peek' : cur === 'peek' ? 'full' : 'line';
    return { ...v, [key]: next };
  });

  // Filter (text) + sort (date) the inbox for display.
  function visibleInbox() {
    const ft = inboxFilter.trim().toLowerCase();
    const filtered = (inbox || []).filter(n => !ft || noteText(n.value).toLowerCase().includes(ft));
    return filtered.sort((a, b) => {
      const da = +new Date(a.updated_at || a.created_at || 0), db = +new Date(b.updated_at || b.created_at || 0);
      return inboxSort === 'old' ? da - db : db - da;
    });
  }

  // ── Slice B: classify → suggestion → materialize ──

  /** Build the initial editable plan from a classify result. */
  function initEdit(result) {
    const s = result.suggestion || {};
    const cn = result.createNew || {};
    const organismId = s.organismId || (cn.suggest ? NEW : NEW);
    const workspaceId = organismId === NEW ? NEW : (s.workspaceId || NEW);
    return {
      organismId,
      organismName: cn.organismName || '',
      workspaceId,
      workspaceName: cn.workspaceName || '',
      space: workspaceId === NEW ? '' : (s.space || ''),
      title: s.title || '',
      markdown: s.markdown || '',
    };
  }

  async function handleSuggest(note) {
    setSuggest(null);
    setSortError(null);
    setSortingKey(note.key);
    setSortStep(0);
    stopStepTimer();
    // Walk the user through the expected stages while the AI thinks (the call can take ~30s).
    stepTimer.current = setInterval(() => setSortStep(s => Math.min(s + 1, NB_STEPS.length - 1)), 2500);
    try {
      const result = await classifyNote(noteText(note.value));
      if (!result) throw new Error(t('profile.error'));
      setSuggest({ noteKey: note.key, result, edit: initEdit(result) });
    } catch (e) {
      setSortError({ noteKey: note.key, message: e.message || t('profile.error'), code: e.code });
    } finally { stopStepTimer(); setSortingKey(null); }
  }

  function patchEdit(patch) {
    setSuggest(s => s ? { ...s, edit: { ...s.edit, ...patch } } : s);
  }

  function onOrganismChange(organismId) {
    if (organismId === NEW) { patchEdit({ organismId: NEW, workspaceId: NEW, space: '' }); return; }
    const org = suggest.result.context.organisms.find(o => o.id === organismId);
    const firstWs = org?.workspaces?.[0];
    patchEdit({ organismId, workspaceId: firstWs ? firstWs.id : NEW, space: firstWs?.documentSpaces?.[0]?.namespace || '' });
  }

  function onWorkspaceChange(workspaceId) {
    if (workspaceId === NEW) { patchEdit({ workspaceId: NEW, space: '' }); return; }
    const org = suggest.result.context.organisms.find(o => o.id === suggest.edit.organismId);
    const ws = org?.workspaces?.find(w => w.id === workspaceId);
    patchEdit({ workspaceId, space: ws?.documentSpaces?.[0]?.namespace || '' });
  }

  function applyAlternative(alt) {
    const org = suggest.result.context.organisms.find(o => o.id === alt.organismId);
    const ws = org?.workspaces?.find(w => w.id === alt.workspaceId);
    patchEdit({
      organismId: alt.organismId || NEW,
      workspaceId: alt.workspaceId || NEW,
      space: alt.space || ws?.documentSpaces?.[0]?.namespace || '',
    });
  }

  async function handleMaterialize() {
    if (!suggest) return;
    const e = suggest.edit;
    if (!e.title.trim()) { showToast(t('profile.notebook.titleRequired'), true); return; }
    if (e.organismId === NEW && !e.organismName.trim()) { showToast(t('profile.notebook.orgNameRequired'), true); return; }
    setMaterializing(true);
    try {
      await materializeDocument({
        organismId: e.organismId === NEW ? null : e.organismId,
        organismName: e.organismName,
        workspaceId: (e.organismId === NEW || e.workspaceId === NEW) ? null : e.workspaceId,
        workspaceName: e.workspaceName,
        space: (e.organismId === NEW || e.workspaceId === NEW || !e.space) ? null : e.space,
        title: e.title.trim(),
        markdown: e.markdown,
        sourceKey: suggest.noteKey,
      });
      showToast(t('profile.notebook.materialized'));
      setSuggest(null);
      await loadInbox();
      loadOrgNames();   // a just-created organism's name should resolve in subsequent search badges
    } catch (err) {
      showToast(err.message || t('profile.error'), true);
    } finally { setMaterializing(false); }
  }

  const renderSuggestPanel = () => {
    const { result, edit } = suggest;
    const orgs = result.context?.organisms || [];
    const org = orgs.find(o => o.id === edit.organismId);
    const workspaces = org?.workspaces || [];
    const ws = workspaces.find(w => w.id === edit.workspaceId);
    const docSpaces = ws?.documentSpaces || [];
    const conf = result.suggestion ? Math.round((result.suggestion.confidence || 0) * 100) : null;
    return html`
      <div class="pf-nb-suggest">
        ${result.suggestion?.reason && html`<div class="text-meta-sm pf-nb-suggest-reason">${escHtml(result.suggestion.reason)}${conf !== null ? ` · ${conf}%` : ''}</div>`}

        <label class="pf-nb-suggest-label">${t('profile.notebook.fieldOrganism')}</label>
        <select class="input-field" value=${edit.organismId} onChange=${e => onOrganismChange(e.target.value)}>
          ${orgs.map(o => html`<option key=${o.id} value=${o.id}>${escHtml(o.name)}</option>`)}
          <option value=${NEW}>➕ ${t('profile.notebook.newOrganism')}</option>
        </select>
        ${edit.organismId === NEW && html`
          <input type="text" class="input-field" placeholder=${t('profile.notebook.newOrgNamePlaceholder')}
            value=${edit.organismName} onInput=${e => patchEdit({ organismName: e.target.value })} />`}

        ${edit.organismId !== NEW && html`
          <label class="pf-nb-suggest-label">${t('profile.notebook.fieldWorkspace')}</label>
          <select class="input-field" value=${edit.workspaceId} onChange=${e => onWorkspaceChange(e.target.value)}>
            ${workspaces.map(w => html`<option key=${w.id} value=${w.id}>${escHtml(w.name)}</option>`)}
            <option value=${NEW}>➕ ${t('profile.notebook.newWorkspace')}</option>
          </select>`}
        ${(edit.organismId === NEW || edit.workspaceId === NEW) && html`
          <input type="text" class="input-field" placeholder=${t('profile.notebook.newWsNamePlaceholder')}
            value=${edit.workspaceName} onInput=${e => patchEdit({ workspaceName: e.target.value })} />`}

        ${edit.organismId !== NEW && edit.workspaceId !== NEW && docSpaces.length > 0 && html`
          <label class="pf-nb-suggest-label">${t('profile.notebook.fieldSpace')}</label>
          <select class="input-field" value=${edit.space} onChange=${e => patchEdit({ space: e.target.value })}>
            ${docSpaces.map(s => html`<option key=${s.namespace} value=${s.namespace}>${escHtml(s.name)}</option>`)}
          </select>`}

        ${result.alternatives?.length > 0 && html`
          <div class="pf-nb-suggest-alts">
            <span class="text-meta-sm">${t('profile.notebook.alternatives')}</span>
            ${result.alternatives.map((alt, i) => html`
              <button key=${i} class="btn-ghost btn-sm" onClick=${() => applyAlternative(alt)}>
                ${escHtml(alt.organismName || '?')}${alt.workspaceName ? ` ▸ ${escHtml(alt.workspaceName)}` : ''}
              </button>`)}
          </div>`}

        <label class="pf-nb-suggest-label">${t('profile.notebook.fieldTitle')}</label>
        <input type="text" class="input-field" value=${edit.title} onInput=${e => patchEdit({ title: e.target.value })} />
        <label class="pf-nb-suggest-label">${t('profile.notebook.fieldBody')}</label>
        <textarea class="input-field pf-nb-suggest-body" rows="6" value=${edit.markdown}
          onInput=${e => patchEdit({ markdown: e.target.value })}></textarea>

        <div class="pf-nb-suggest-actions">
          <button class="btn-primary" disabled=${materializing} onClick=${handleMaterialize}>
            ${materializing ? '…' : t('profile.notebook.materializeBtn')}
          </button>
          <button class="btn-ghost btn-sm" onClick=${() => setSuggest(null)}>${t('profile.notebook.cancelBtn')}</button>
        </div>
      </div>
    `;
  };

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
        : html`
          <div class="action-bar pf-nb-inbox-bar">
            <div class="search-bar pf-nb-search">
              <input type="text" class="input-field" placeholder=${t('profile.notebook.filterPlaceholder')}
                value=${inboxFilter} onInput=${e => setInboxFilter(e.target.value)} />
              ${inboxFilter && html`<button class="btn-ghost btn-sm" onClick=${() => setInboxFilter('')}>✕</button>`}
            </div>
            <select class="input-field pf-nb-sort" value=${inboxSort} onChange=${e => setInboxSort(e.target.value)}>
              <option value="new">${t('profile.notebook.sortNew')}</option>
              <option value="old">${t('profile.notebook.sortOld')}</option>
            </select>
          </div>
          ${visibleInbox().length === 0
            ? html`<div class="empty">${t('profile.notebook.noMatch')}</div>`
            : html`<div class="pf-nb-inbox">
            ${visibleInbox().map(note => { const view = noteView[note.key] || 'peek'; return html`
              <div class="pf-nb-note" key=${note.key}>
                <div class="pf-nb-note-text pf-nb-note-text--${view}">
                  ${view === 'line'
                    ? html`<span class="pf-nb-note-line">${escHtml(firstLine(noteText(note.value)))}</span>`
                    : html`<${Markdown} text=${noteText(note.value)} />`}
                </div>
                <div class="pf-nb-note-foot">
                  <div class="pf-nb-note-meta">
                    <button class="btn-ghost btn-sm pf-nb-view-btn" title=${t('profile.notebook.toggleView')}
                      onClick=${() => cycleView(note.key)}>${view === 'full' ? '⌃' : '⌄'}</button>
                    <span class="text-meta-sm">${relTime(note.updated_at || note.created_at)}</span>
                  </div>
                  <div class="pf-nb-note-btns">
                    <button class="btn-primary btn-sm" disabled=${sortingKey === note.key}
                      onClick=${() => handleSuggest(note)}>
                      ${sortingKey === note.key ? t('profile.notebook.sorting') : t('profile.notebook.suggestBtn')}
                    </button>
                    <button class="btn-danger btn-sm" onClick=${() => handleDelete(note.key)}>${t('profile.notebook.deleteBtn')}</button>
                  </div>
                </div>
                ${sortingKey === note.key && html`
                  <div class="pf-nb-suggest pf-nb-progress">
                    <${Spinner} text=${t(NB_STEPS[sortStep])} />
                    <ol class="pf-nb-steps">
                      ${NB_STEPS.map((s, i) => html`
                        <li key=${i} class="pf-nb-step ${i < sortStep ? 'done' : i === sortStep ? 'active' : ''}">
                          ${i < sortStep ? '✓' : i === sortStep ? '→' : '·'} ${t(s)}
                        </li>`)}
                    </ol>
                  </div>`}
                ${sortError?.noteKey === note.key && html`
                  <div class="pf-nb-suggest pf-nb-progress">
                    <div class="alert alert-warning"><span class="alert-msg">${t('profile.notebook.sortErrorTitle')}: ${escHtml(sortError.message)}</span></div>
                    ${sortError.code === 'NO_OPENROUTER_KEY' && html`
                      <div class="text-meta-sm">${t('profile.notebook.needKey')}</div>
                      <${OpenRouterSettings} onSettingsChange=${() => {}} />`}
                    <div class="pf-nb-suggest-actions">
                      <button class="btn-primary btn-sm" onClick=${() => handleSuggest(note)}>${t('profile.notebook.tryAgain')}</button>
                      <button class="btn-ghost btn-sm" onClick=${() => setSortError(null)}>${t('profile.notebook.dismiss')}</button>
                    </div>
                  </div>`}
                ${suggest?.noteKey === note.key && renderSuggestPanel()}
              </div>
            `; })}
          </div>`}
        `
    }
  `;
}
