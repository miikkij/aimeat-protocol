/**
 * @file sources-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Workspace Sources panel — references the workspace draws on (memory entries, storage
 *   files, knowledge packages; own or external/read-only). Pointers ONLY: nothing is copied or moved.
 *   Attach via a picker with Memory / Storage / Knowledge tabs. Extracted from organisms-tab.js with
 *   no behaviour change.
 * @structure SRC_ICON (internal), SourcesPanel
 * @usage import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';
 * @version-history
 *   v1.11.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.10.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-26 -- The search's results are the Listing (css/components/listing.css, name-tags-doors, columns kept on a phone), a unification: the look most tabs use.
 *   v1.7.0 -- 2026-09-25 -- The source search is the Search line (.search-line with the underlined field), as the other Settings searches; Enter still searches (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- The attached sources are the Listing (css/components/listing.css), a unification: the look most tabs use. The picker's results stay: they are a chooser.
 *   v1.5.0 -- 2026-09-25 -- Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.4.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import * as memoryService from '/js/services/memory.js';
import * as knowledgeService from '/js/services/knowledge.js';
import { QuietNote } from '/components/QuietNote.js';
import { fmtBytes } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';

const SRC_ICON = { memory: '🧠', storage: '📎', knowledge: '📚' };

/* Sources: references the workspace draws on — memory entries, storage files, and knowledge
 * packages (own, or external/read-only). Pointers ONLY: nothing is copied or moved; the referenced
 * data stays where it lives (organism.{id}.meta.sources holds just the pointers). Attach via a
 * picker with Memory / Storage / Knowledge tabs (Mine, or Discover for memory + knowledge). */
export function SourcesPanel({ orgId, wsId, showToast }) {
  const [sources, setSources] = useState([]);
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState('knowledge');   // memory | storage | knowledge
  const [scope, setScope] = useState('mine');     // mine | discover (storage has no discover)
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setSources(await orgService.getWorkspaceSources(orgId, wsId)); }, [orgId, wsId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['organisms'], () => load()), [load]);

  const persist = async (next) => {
    setSources(next);
    const r = await orgService.saveWorkspaceSources(orgId, wsId, next).catch(() => ({ ok: false }));
    if (r?.ok === false) showToast(t('organisms.sourcesSaveError') || 'Failed to save sources');
  };

  const doSearch = async () => {
    setLoading(true);
    const ql = q.trim().toLowerCase();
    try {
      if (tab === 'memory') {
        if (scope === 'mine') {
          const items = await memoryService.listMemories();
          setResults(items.filter(i => !ql || String(i.key).toLowerCase().includes(ql)).slice(0, 100));
        } else {
          const d = await memoryService.discoverPublicMemories({ q: q.trim(), limit: 50 });
          setResults(d.items || []);
        }
      } else if (tab === 'storage') {
        const files = await orgService.listOwnStorageFiles();
        setResults(files.filter(f => !ql || String(f.key).toLowerCase().includes(ql)));
      } else if (scope === 'mine') {
        const pkgs = await knowledgeService.listMyPackages();
        setResults(pkgs.filter(p => { const n = String(p.value?.name || p.key || ''); return !ql || n.toLowerCase().includes(ql); }));
      } else {
        const r = await knowledgeService.discoverPackages({ limit: 50, sort: 'recent' });
        setResults((r?.data?.packages || []).filter(p => !ql || String(p.name || '').toLowerCase().includes(ql)));
      }
    } catch (err) { swallowed('sources-panel', err); setResults([]); }
    finally { setLoading(false); }
  };
  const searchRef = useRef(doSearch); searchRef.current = doSearch;
  // Auto-search when the picker opens or the tab/scope changes — but NOT on every keystroke
  // (typing only updates q; Enter or the Search button runs it).
  useEffect(() => { if (picking) searchRef.current(); }, [picking, tab, scope]);
  // storage has no cross-owner discovery — force 'mine' there
  useEffect(() => { if (tab === 'storage' && scope !== 'mine') setScope('mine'); }, [tab, scope]);

  const keyOf = (s) => `${s.type}:${s.packageId || (s.ownerGaii || '') + '|' + (s.key || '')}`;
  const attach = async (item) => {
    setBusy(true);
    try {
      const base = { id: 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), addedAt: new Date().toISOString() };
      let src;
      if (tab === 'memory') {
        src = { ...base, type: 'memory', key: item.key, ownerGaii: item.owner_gaii || orgService.currentGhii(), label: item.key, external: scope === 'discover' };
      } else if (tab === 'storage') {
        src = { ...base, type: 'storage', key: item.key, ownerGaii: orgService.currentGhii(), label: item.key, mime: item.mime_type, external: false };
      } else {
        const pid = scope === 'mine' ? ((String(item.key).match(/packages\/([^/]+)\/manifest/) || [])[1] || item.key) : item.package_id;
        const name = scope === 'mine' ? (item.value?.name || pid) : (item.name || pid);
        src = { ...base, type: 'knowledge', packageId: pid, label: name, external: scope === 'discover' };
      }
      if (sources.some(s => keyOf(s) === keyOf(src))) { showToast(t('organisms.sourceExists') || 'Already added'); return; }
      await persist([...sources, src]);
      showToast(t('organisms.sourceAdded') || 'Source added');
    } finally { setBusy(false); }
  };
  const removeSource = (id) => persist(sources.filter(s => s.id !== id));

  const resultRow = (item, i) => {
    let label, meta;
    if (tab === 'memory') { label = item.key; meta = (scope === 'discover' ? (item.owner_gaii + ' · ') : '') + (item.visibility || ''); }
    else if (tab === 'storage') { label = item.key; meta = (item.mime_type || '') + ' · ' + fmtBytes(item.size || 0); }
    else { label = scope === 'mine' ? (item.value?.name || item.key) : (item.name || item.package_id); meta = (scope === 'mine' ? (item.value?.entries?.length || 0) : (item.entries_count || 0)) + ' ' + (t('organisms.entries') || 'entries'); }
    return html`
      <div class="listing-row" key=${'r' + i}>
        <div class="listing-name" title=${String(label)}>${(String(label))}</div>
        <div class="listing-desc">${(String(meta))}</div>
        <div class="listing-doors"><button class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${() => attach(item)}>${t('organisms.attach') || 'Attach'}</button></div>
      </div>`;
  };

  return html`
    <div class="pj-section pj-sources poster-row--thing">
      <div class="pj-section-head">
        <span class="pj-section-title sub-heading">${t('organisms.sources') || 'Sources'}<span class="poster-count poster-count--tally">${sources.length}</span></span>
        <button class="poster-action poster-action--small" onClick=${() => setPicking(p => !p)}>
          ${picking ? (t('organisms.close') || 'Close') : ('+ ' + (t('organisms.addSource') || 'Add source'))}
        </button>
      </div>
      <div class="section-desc pj-sources-desc">${t('organisms.sourcesDesc') || 'References this workspace draws on — memory, files, and knowledge packages. Pointers only; the originals stay where they live.'}</div>

      ${picking ? html`
        <div class="pj-src-picker poster-box">
          <div class="pf-tabs" role="tablist">
            ${['memory', 'storage', 'knowledge'].map(tk => html`<button class="poster-tab ${tab === tk ? 'is-on' : ''}" key=${tk} onClick=${() => setTab(tk)}>${SRC_ICON[tk]} ${t('organisms.src_' + tk) || tk}</button>`)}
          </div>
          <div class="pj-src-controls">
            ${tab !== 'storage' ? html`
              <div class="pf-tabs">
                <button class="poster-tab ${scope === 'mine' ? 'is-on' : ''}" onClick=${() => setScope('mine')}>${t('organisms.mine') || 'Mine'}</button>
                <button class="poster-tab ${scope === 'discover' ? 'is-on' : ''}" onClick=${() => setScope('discover')}>${t('organisms.discover') || 'Discover'}</button>
              </div>` : null}
            <div class="pj-src-search search-line"><input class="og-input" type="search" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') doSearch(); }} placeholder=${t('organisms.searchSources') || 'Search…'} aria-label=${t('organisms.searchSources') || 'Search…'} /></div>
            <button class="poster-action poster-action--small" onClick=${doSearch} disabled=${loading}>${t('organisms.search') || 'Search'}</button>
          </div>
          <div class="pj-src-results">
            ${loading ? html`<${QuietNote}>${t('organisms.loading') || 'Loading…'}<//>`
              : results.length === 0 ? html`<${QuietNote}>${t('organisms.noResults') || 'No results'}<//>`
              : html`<div class="listing listing--name-tags-doors listing--cols">${results.slice(0, 100).map(resultRow)}</div>`}
          </div>
        </div>` : null}

      ${sources.length === 0 ? html`<${QuietNote}>${t('organisms.noSources') || 'No sources yet'}<//>`
        : html`<div class="listing listing--mark-name-tags-doors listing--cols">
          ${sources.map(s => html`
            <div class="listing-row" key=${s.id}>
              <div>${SRC_ICON[s.type] || '•'}</div>
              <div class="listing-name" title=${s.key || s.packageId || ''}>${(String(s.label || s.key || s.packageId || ''))}</div>
              <div><span class="poster-chips">
                ${s.external ? html`<span class="poster-chip">${t('organisms.external') || 'external'}</span>` : null}
                <span class="poster-chip">${t('organisms.src_' + s.type) || s.type}</span>
              </span></div>
              <div class="listing-doors"><button class="poster-icon poster-icon--small" title=${t('organisms.remove') || 'Remove'} onClick=${() => removeSource(s.id)}>✕</button></div>
            </div>`)}
        </div>`}
    </div>`;
}
