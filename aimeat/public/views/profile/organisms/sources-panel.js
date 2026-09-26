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
 *   v1.12.0 -- 2026-09-26 -- Every part is a kit component (page group G2a): the description is the section description, the picker the Box with the Tabs (the source kind a view tab row) and the Search line, the results and the sources the List (an external source's tag dim again, as main's grey badge; the remove mark the Icon). The panel's own title and count are not drawn: the Sources page's head says both, and main hid them there. The Add source toggle, which stood in that hidden head, now stands under the description, so the picker opens.
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
import { List, Row as ListRow, Name, Desc, Cell, Doors, SearchLine } from '/components/List.js';
import { Action, Actions, Icon } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { HeadDesc } from '/components/SubHeading.js';
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
      <${ListRow} key=${'r' + i}>
        <${Name} title=${String(label)}>${(String(label))}<//>
        <${Desc}>${(String(meta))}<//>
        <${Doors}><${Action} small row disabled=${busy} onClick=${() => attach(item)}>${t('organisms.attach') || 'Attach'}<//><//>
      <//>`;
  };

  // The panel stands on the workspace's Sources page, whose head already says "Sources" (main hid the
  // panel's own title and count there: organism.css `.og-page .pj-section > .pj-section-head`). The
  // way to add a source stood in that hidden head; it is drawn here so the picker can be opened.
  return html`
    <${HeadDesc}>${t('organisms.sourcesDesc') || 'References this workspace draws on — memory, files, and knowledge packages. Pointers only; the originals stay where they live.'}<//>
    <${Actions}>
      <${Action} small expanded=${picking} onClick=${() => setPicking(p => !p)}>
        ${picking ? (t('organisms.close') || 'Close') : ('+ ' + (t('organisms.addSource') || 'Add source'))}
      <//>
    <//>

    ${picking ? html`
      <${Box}>
        <${Tabs} kind="view" value=${tab} onSelect=${setTab}
          items=${['memory', 'storage', 'knowledge'].map(tk => ({ value: tk, label: `${SRC_ICON[tk]} ${t('organisms.src_' + tk) || tk}` }))} />
        ${tab !== 'storage' ? html`
          <${Tabs} value=${scope} onSelect=${setScope} items=${[
            { value: 'mine', label: t('organisms.mine') || 'Mine' },
            { value: 'discover', label: t('organisms.discover') || 'Discover' },
          ]} />` : null}
        <${SearchLine} value=${q} onInput=${e => setQ(e.target.value)} onEnter=${doSearch} placeholder=${t('organisms.searchSources') || 'Search…'}>
          <${Action} small onClick=${doSearch} disabled=${loading}>${t('organisms.search') || 'Search'}<//>
        <//>
        <${List} cols="name-tags-doors" keepCols scroll loading=${loading ? (t('organisms.loading') || 'Loading…') : false}
          empty=${t('organisms.noResults') || 'No results'}>
          ${results.slice(0, 100).map(resultRow)}
        <//>
      <//>` : null}

    <${List} cols="mark-name-tags-doors" keepCols empty=${t('organisms.noSources') || 'No sources yet'}>
      ${sources.map(s => html`
        <${ListRow} key=${s.id}>
          <${Cell}>${SRC_ICON[s.type] || '•'}<//>
          <${Name} title=${s.key || s.packageId || ''}>${(String(s.label || s.key || s.packageId || ''))}<//>
          <${Cell} line>
            ${s.external ? html`<${Mark} tone="dim">${t('organisms.external') || 'external'}<//>` : null}
            <${Mark}>${t('organisms.src_' + s.type) || s.type}<//>
          <//>
          <${Doors}><${Icon} small label=${t('organisms.remove') || 'Remove'} onClick=${() => removeSource(s.id)}>✕<//><//>
        <//>`)}
    <//>`;
}
