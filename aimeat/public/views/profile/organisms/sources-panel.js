/**
 * @file sources-panel.js
 * @description Workspace Sources panel — references the workspace draws on (memory entries, storage
 *   files, knowledge packages; own or external/read-only). Pointers ONLY: nothing is copied or moved.
 *   Attach via a picker with Memory / Storage / Knowledge tabs. Extracted from organisms-tab.js with
 *   no behaviour change.
 * @structure SRC_ICON (internal), SourcesPanel
 * @usage import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';
 * @version-history
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
import { EmptyState } from '/components/EmptyState.js';
import { SearchBar } from '/components/SearchBar.js';
import { fmtBytes } from '/js/format.js';

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
    } catch { setResults([]); }
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
      <div class="pj-src-result" key=${'r' + i}>
        <span class="pj-src-result-label" title=${String(label)}>${(String(label))}</span>
        <span class="pj-src-result-meta">${(String(meta))}</span>
        <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => attach(item)}>${t('organisms.attach') || 'Attach'}</button>
      </div>`;
  };

  return html`
    <div class="pj-section pj-sources">
      <div class="pj-section-head">
        <span class="pj-section-title">${t('organisms.sources') || 'Sources'}<span class="pj-doc-tag">${sources.length}</span></span>
        <button class="btn-outline btn-sm" onClick=${() => setPicking(p => !p)}>
          ${picking ? (t('organisms.close') || 'Close') : ('+ ' + (t('organisms.addSource') || 'Add source'))}
        </button>
      </div>
      <div class="section-desc pj-sources-desc">${t('organisms.sourcesDesc') || 'References this workspace draws on — memory, files, and knowledge packages. Pointers only; the originals stay where they live.'}</div>

      ${picking ? html`
        <div class="pj-src-picker">
          <div class="seg" role="tablist">
            ${['memory', 'storage', 'knowledge'].map(tk => html`<button class="seg-btn ${tab === tk ? 'active' : ''}" key=${tk} onClick=${() => setTab(tk)}>${SRC_ICON[tk]} ${t('organisms.src_' + tk) || tk}</button>`)}
          </div>
          <div class="pj-src-controls">
            ${tab !== 'storage' ? html`
              <div class="seg">
                <button class="seg-btn ${scope === 'mine' ? 'active' : ''}" onClick=${() => setScope('mine')}>${t('organisms.mine') || 'Mine'}</button>
                <button class="seg-btn ${scope === 'discover' ? 'active' : ''}" onClick=${() => setScope('discover')}>${t('organisms.discover') || 'Discover'}</button>
              </div>` : null}
            <div class="pj-src-search"><${SearchBar} value=${q} onInput=${e => setQ(e.target.value)} onSubmit=${() => doSearch()} placeholder=${t('organisms.searchSources') || 'Search…'} /></div>
            <button class="btn-ghost btn-sm" onClick=${doSearch} disabled=${loading}>${t('organisms.search') || 'Search'}</button>
          </div>
          <div class="pj-src-results">
            ${loading ? html`<${EmptyState} text=${t('organisms.loading') || 'Loading…'} />`
              : results.length === 0 ? html`<${EmptyState} text=${t('organisms.noResults') || 'No results'} />`
              : results.slice(0, 100).map(resultRow)}
          </div>
        </div>` : null}

      ${sources.length === 0 ? html`<${EmptyState} text=${t('organisms.noSources') || 'No sources yet'} />`
        : html`<div class="pj-src-list">
          ${sources.map(s => html`
            <div class="pj-src-item" key=${s.id}>
              <span class="pj-src-icon">${SRC_ICON[s.type] || '•'}</span>
              <span class="pj-src-label" title=${s.key || s.packageId || ''}>${(String(s.label || s.key || s.packageId || ''))}</span>
              ${s.external ? html`<span class="badge badge-muted pj-mini">${t('organisms.external') || 'external'}</span>` : null}
              <span class="badge badge-info pj-mini">${t('organisms.src_' + s.type) || s.type}</span>
              <button class="pj-icon-btn" title=${t('organisms.remove') || 'Remove'} onClick=${() => removeSource(s.id)}>✕</button>
            </div>`)}
        </div>`}
    </div>`;
}
