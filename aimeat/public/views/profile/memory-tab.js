/**
 * @file memory-tab.js
 * @description Profile tab for memory entries and file management — CRUD, search,
 *   visibility cycling, tag editing, sharing rules, and file upload with drag-and-drop.
 * @version-history
 *   v2.7.0 — 2026-07-13 — Split into ./memory-tab/ sibling modules (max-file-lines): pure helpers
 *     (helpers.js, file-helpers.js), standalone sub-components (components.js), and the entries /
 *     files / browse render functions (entries-view.js, files-view.js, browse-view.js) which receive
 *     the component's state + handlers via a shared ctx object. Pure extraction — no behavior change.
 *   v2.6.0 — 2026-07-03 — Collection cart: gather memory entries + files (per-row 🛒 toggles, bulk
 *     "add to collection", localStorage-persisted per owner) into a tray that exports three ways —
 *     a copyable/downloadable URL list, a ZIP bundle (POST /v1/memory/bundle), or attaching the items
 *     as pointer Sources on an organism workspace (reusing saveWorkspaceSources).
 *   v2.5.0 — 2026-07-03 — Files discoverability + preview: (1) a name/tag/type search box in the
 *     Files sub-tab (client-side over the loaded list); (2) a universal in-browser preview modal
 *     (image/pdf/video/audio/text) — blob-fetched so PRIVATE files preview too, with an "Open in
 *     new tab" that uses the shareable /v1/pub URL for public files and a transient object URL for
 *     private ones; the image thumbnail is click-to-preview. (3) Thumbnail/preview/download now
 *     fetch via the owner_gaii-aware URL (fileBytesUrl: /v1/pub for public files, auth route for
 *     own files, with a /v1/pub fallback) — the Files list aggregates AGENT-owned files but the
 *     caller-scoped auth route 404s them, so agent-owned (e.g. app-generated) files now load.
 *     Entries: a per-entry "Copy value" button (canonical <CopyButton>) in the expanded detail.
 *   v2.3.0 — 2026-07-03 — 'members' visibility (readable by any logged-in node user)
 *     selectable in all visibility pickers (popover, detail select, bulk bar,
 *     create form, edit modal).
 *   v2.2.0 — 2026-06-13 — Render image memory values inline: a value that IS an image (a /v1/pub URL
 *     string or a { url, mime:image/* } object) shows a thumbnail above its raw JSON, via the shared
 *     ImageDeliverable renderer.
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes
 *   v1.1.0 — 2026-03-18 — Fix: use AuthImage for thumbnails and authenticated download to avoid 401
 *   v1.2.0 — 2026-05-22 — Add Browse Home / Browse Remote panels for federation memory sync
 *   v1.3.0 — 2026-05-22 — Add timestamps, sort controls, fix group picker rotation bug
 *   v1.4.0 — 2026-06-02 — Component unification (#2): edit modal uses the canonical
 *     <Modal> component (Escape/backdrop close + header ✕).
 *   v1.5.0 — 2026-06-02 — Component unification (#1): "Copy URLs" button uses canonical
 *     <CopyButton> (toast preserved via onCopied).
 *   v2.0.0 — 2026-06-10 — Structural rework: (1) keys render as COLLAPSIBLE GROUPS by first
 *     segment (organism.<uuid> groups resolve the uuid to the organism's name; remainders
 *     shortened with '›' + middle-ellipsis, full key in title + expanded detail); (2) the
 *     per-row click-to-cycle visibility pill is GONE — list shows a static VisibilityPill,
 *     editing happens in the edit modal (entries) / an explicit select (files), and the
 *     "Skip → public" fallback was removed; (3) top-level tabs Mine · Public · Remote nodes
 *     replace the inline browse panels; (4) search is type-to-filter (client-side over
 *     key/tags/value); (5) tag cloud capped at top-10-by-use with "show all"; (6) shield
 *     icon only on rows that actually have sharing rules; rules popover shows localized
 *     visibility from the record's REAL owner (backend fix in permissions.ts); (7) edit
 *     modal: tall JSON editor + parse validation (invalid JSON can't save; valid JSON is
 *     stored parsed, not as a string); (8) "no sharing groups" dead end now offers a
 *     "Create a group →" jump to the Access tab; Delete separated to the row's far right;
 *     discover/pull copy buttons neutralized.
 *   v2.1.0 — 2026-06-10 — Visibility one-click-away again, deliberately: clicking the row's
 *     badge opens a small popover with all options INCLUDING the sharing groups (the Access
 *     group-share brought into Memory; "Create a group →" when none exist). Plus bulk edit:
 *     per-row checkboxes + a bulk bar (change visibility incl. group / delete with confirm /
 *     clear). The detail-row select and edit-modal select remain as alternate paths.
 *   v2.2.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v2.3.0 — 2026-06-22 — Scale to thousands of keys: default load is metadata-only (include=meta,
 *     no values) with per-key lazy value fetch on expand + "Load all contents"; server-side content
 *     search (key/value/tags) with per-group scoping; storage-usage bar; value-size column + "largest
 *     first" sort; bulk-delete a whole group; JSON export/import (skip/overwrite/rename).
 *   v2.3.1 — 2026-06-22 — Toolbar layout: data tools (Load all / Export / Import) grouped in their
 *     own bordered .mem-tools-section up top; content-search + filter on one row; sort + "New memory"
 *     moved to a bottom bar (New-memory pushed right).
 *   v2.4.0 — 2026-06-26 — Per-row "Copy URL" button in Files actions (canonical <CopyButton>) so a
 *     single file's URL can be grabbed for embedding without copying all URLs at once. Both the
 *     per-row and the bulk "Copy URLs" buttons now emit the PUBLIC no-auth URL
 *     (/v1/pub/:owner/:key, served when visibility==='public') instead of the authenticated,
 *     owner-scoped /v1/memory/files/:key — so a public file's link actually loads in a browser /
 *     <img>. Requires owner_gaii from the files list (added to GET /v1/memory/files).
 *   v2.5.0 — 2026-07-16 — Mount folds the 6-request fan-out into ONE GET /v1/memory/tab (MemoryTabService;
 *     memory section metadata-only). loadTab seeds all six sections; the agent/archived filter effect
 *     skips its initial run so loadMemories only re-fetches the dynamic memory list on change. Falls back
 *     to the individual loaders if the composite is unavailable. (Phase 4 slice 5 — frontend half.)
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as memoryService from '/js/services/memory.js';
import { apiGet } from '/js/api.js';
import { listAgents } from '/js/services/agents.js';
import { getKeyPermissions, listConsents, grantConsent, revokeConsent } from '/js/services/consent.js';
import { getNodeUrl } from '/js/services/auth.js';
import { listGroups } from '/js/services/sharing-groups.js';
import { listOrganisms, currentGhii } from '/js/services/organisms.js';
import { useConfirm } from '/components/Modal.js';
import { shortTok } from './memory-tab/helpers.js';
import { fetchFileBytes } from './memory-tab/file-helpers.js';
import { CartTray, EditMemoryModal, FilePreviewModal } from './memory-tab/components.js';
import { renderEntries } from './memory-tab/entries-view.js';
import { renderFilesList } from './memory-tab/files-view.js';
import { renderBrowsePanel, loadBrowseHome, initBrowseRemote, initDiscover, closeBrowse } from './memory-tab/browse-view.js';
import { swallowed } from '/js/swallowed.js';

export default function MemoryTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const NODE_URL = getNodeUrl();
  const [memories, setMemories] = useState(null);
  const [files, setFiles] = useState(null);
  const [memSubTab, setMemSubTab] = useState('entries');
  const [showMemForm, setShowMemForm] = useState(false);
  const [showFileForm, setShowFileForm] = useState(false);
  const [expandedMem, setExpandedMem] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [keyRulesPopover, setKeyRulesPopover] = useState(null);
  const [memTagFilter, setMemTagFilter] = useState(new Set());
  const [editingMemTags, setEditingMemTags] = useState(null);
  const [editingFileTags, setEditingFileTags] = useState(null);
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [fedConsents, setFedConsents] = useState({});   // { memoryKey: consentId }
  const [allConsents, setAllConsents] = useState([]);   // every active consent — drives the per-row shield
  const [togglingFed, setTogglingFed] = useState(null);
  const [groups, setGroups] = useState([]);
  // Top-level view: own list / public discovery / remote nodes (home node when federated).
  const [mainTab, setMainTab] = useState('own'); // 'own' | 'discover' | 'remote'
  const [browseMode, setBrowseMode] = useState(null); // 'home' | 'remote' | 'discover' | null
  const [filterText, setFilterText] = useState('');
  const [memArchived, setMemArchived] = useState(false); // false = active working set, true = archived-only view
  const [orgNames, setOrgNames] = useState({});         // organism uuid → display name
  // Collection "cart": gather memory entries + files across sub-tabs, then export (URL list / ZIP /
  // send to a workspace's Sources). Persisted in localStorage per owner so it survives reloads.
  const cartStoreKey = `aimeat.mem.cart.${session?.owner || 'anon'}`;
  const [cart, setCart] = useState(() => {
    // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
    try { const raw = localStorage.getItem(`aimeat.mem.cart.${session?.owner || 'anon'}`); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch { return []; }
  });
  const [cartOrgs, setCartOrgs] = useState([]);         // organisms the user can send a collection into
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('aimeat.mem.groups.collapsed') || '[]')); } catch { return new Set(); }
  });
  const [remoteEntries, setRemoteEntries] = useState(null);
  const [remotePeers, setRemotePeers] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState(null);
  const [pullingKeys, setPullingKeys] = useState(new Set());
  const [sortBy, setSortBy] = useState('updated');
  // Scalable Memory tab (v2.3): the list loads metadata-only by default (no values) so thousands of
  // keys open fast; values are fetched per-key on expand. memQuota drives the storage-usage bar.
  const [memQuota, setMemQuota] = useState(null);
  const [fullLoaded, setFullLoaded] = useState(false);   // true once "Load all contents" pulls values
  const [valueCache, setValueCache] = useState({});       // key → value (lazy-fetched in meta mode)
  const [loadingValueKeys, setLoadingValueKeys] = useState(new Set());
  // Server-side content search (matches key + value + tags) — separate from the instant client filter.
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState(null);  // null = not searching; array = results
  const [searchScopePrefix, setSearchScopePrefix] = useState('');  // optional namespace/group scope
  const [searchLoading, setSearchLoading] = useState(false);
  const [importMode, setImportMode] = useState('skip');   // skip | overwrite | rename
  const [importing, setImporting] = useState(false);
  const [discoverEntries, setDiscoverEntries] = useState(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState(null);
  const [discoverSearch, setDiscoverSearch] = useState('');
  const [copyingKeys, setCopyingKeys] = useState(new Set());
  const [expandedDiscover, setExpandedDiscover] = useState(null);

  useEffect(() => {
    if (session) loadTab();   // ONE composite call seeds all six sections (loadMemories owns later filter changes)
    // The loaders are plain functions re-created every render and closing over component state; this
    // effect intentionally runs them only when the session changes — including them would re-run on
    // every render (infinite loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Resolve organism UUIDs to display names for the grouped key list — nobody
  // recognizes e97781a5… but everyone recognizes "Ultima-V Remake".
  async function loadOrgNames() {
    try {
      const resp = await listOrganisms({ member: session.owner });
      const orgs = resp?.data?.organisms || [];
      const map = {};
      for (const o of orgs) map[o.id] = o.name;
      setOrgNames(map);
      setCartOrgs(orgs.map(o => ({ id: o.id, name: o.name })));
    } catch (err) { swallowed('memory-tab: loadOrgNames', err); }
  }

  // ── Collection cart ───────────────────────────────────────────────────────
  // Persist on every change so the cart survives reloads (and cross-tab within the same owner).
  useEffect(() => {
    try { localStorage.setItem(cartStoreKey, JSON.stringify(cart)); } catch { /* quota/private mode — cart is best-effort */ }   // eslint-disable-line aimeat/no-silent-catch -- quota/private mode — cart is best-effort
  }, [cart, cartStoreKey]);

  const cartIdOf = (it) => `${it.kind}:${it.ownerGaii || ''}:${it.key}`;
  const inCart = (it) => cart.some(c => cartIdOf(c) === cartIdOf(it));
  const toggleCartItem = (it) => setCart(prev => prev.some(c => cartIdOf(c) === cartIdOf(it))
    ? prev.filter(c => cartIdOf(c) !== cartIdOf(it))
    : [...prev, it]);
  const addCartItems = (items) => setCart(prev => {
    const have = new Set(prev.map(cartIdOf));
    const fresh = items.filter(it => !have.has(cartIdOf(it)));
    return fresh.length ? [...prev, ...fresh] : prev;
  });
  const removeCartItem = (id) => setCart(prev => prev.filter(c => cartIdOf(c) !== id));
  const clearCart = () => setCart([]);

  // Cart item builders: memory entries carry the owner GAII (list value, selected agent, or GHII)
  // so the bundle/URL/source export can address each key in the right keyspace.
  const memCartItem = (m) => ({ kind: 'memory', key: m.key, ownerGaii: m.owner_gaii || selectedAgent || currentGhii(), label: m.key });
  const fileCartItem = (f) => ({ kind: 'file', key: f.key || f.name, ownerGaii: f.owner_gaii || currentGhii(), label: f.key || f.name, mime: f.mime_type });

  function toggleGroupCollapsed(id) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { sessionStorage.setItem('aimeat.mem.groups.collapsed', JSON.stringify([...next])); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
      return next;
    });
  }

  const memFilterMounted = useRef(false);
  useEffect(() => {
    // Skip the initial run — loadTab() already seeded the default memory view from the composite. Only
    // an actual agent-selection / archived-toggle change re-fetches the (dynamic) memory list.
    if (!memFilterMounted.current) { memFilterMounted.current = true; return; }
    if (session) { loadMemories(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent, memArchived]);

  async function loadFedConsents() {
    try {
      const consents = await listConsents();
      const map = {};
      for (const c of consents) {
        if (c.scope === 'federation') {
          const pat = c.data_pattern || c.pattern || '';
          // Direct key match (no wildcard) or exact pattern
          if (pat && !pat.includes('*')) {
            map[pat] = c.id || c.consent_id;
          }
        }
      }
      setFedConsents(map);
      setAllConsents(consents.filter(c => !c.status || c.status === 'active'));
    } catch (err) { swallowed('memory-tab: loadFedConsents', err); }
  }

  // Does any active consent pattern cover this key? Drives the per-row shield:
  // shown only when rules exist, so its presence carries information.
  function keyHasRules(key) {
    return allConsents.some(c => {
      const pat = c.data_pattern || c.pattern || '';
      if (!pat) return false;
      if (pat === '*' || pat === key) return true;
      if (pat.endsWith('*')) return key.startsWith(pat.slice(0, -1));
      return false;
    });
  }

  async function handleShareToFederation(key) {
    setTogglingFed(key);
    try {
      await grantConsent({
        data_pattern: key,
        recipient: '*',
        scope: 'federation',
        purpose: 'federation_sharing',
      });
      showToast(t('profile.memory.shareSuccess'));
      await loadFedConsents();
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
    } finally { setTogglingFed(null); }
  }

  async function handleStopSharing(key) {
    const consentId = fedConsents[key];
    if (!consentId) return;
    setTogglingFed(key);
    try {
      await revokeConsent(consentId);
      showToast(t('profile.memory.unshareSuccess'));
      await loadFedConsents();
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
    } finally { setTogglingFed(null); }
  }

  // Live update listener — refresh both memories and files
  const liveRef = useRef(() => { loadMemories(); loadFiles(); loadFedConsents(); });
  liveRef.current = () => { loadMemories(); loadFiles(); loadFedConsents(); };
  useEffect(() => onLiveUpdate(['memory', 'files', 'federation'], () => liveRef.current()), []);

  async function loadAgents() {
    try {
      const list = await listAgents();
      setAgents(Array.isArray(list) ? list : []);
    } catch (err) { swallowed('memory-tab', err); setAgents([]); }
  }

  async function loadGroups() {
    try {
      const resp = await listGroups();
      if (resp?.data?.groups) setGroups(resp.data.groups);
      else if (Array.isArray(resp?.data)) setGroups(resp.data);
    } catch (err) { swallowed('memory-tab: loadGroups', err); }
  }

  // Mount composite: ONE GET /v1/memory/tab seeds all six sections — agents + owner-scope memory
  // (metadata-only) + files + consent + sharing-groups + organism names. loadMemories owns later
  // (dynamic) memory re-fetches on agent/archived change; on failure we fall back to the six loaders.
  async function loadTab() {
    const ov = await apiGet('/v1/memory/tab').then(r => r?.data).catch(err => { swallowed('memory-tab: loadTab', err); return null; });
    if (!ov) { loadAgents(); loadMemories(); loadFiles(); loadFedConsents(); loadGroups(); loadOrgNames(); return; }
    setAgents(Array.isArray(ov.agents) ? ov.agents : []);
    // memory (metadata-only default view — mirrors loadMemories meta path)
    const items = ov.memory?.items || [];
    setMemories(items);
    setMemQuota(ov.memory?.quota || null);
    setValueCache({});
    if (!memArchived) onStats?.({ memory: items.length });
    // files
    const fileList = ov.files?.files || [];
    setFiles(fileList);
    onStats?.({ files: fileList.length });
    // federation consents + the active-consent set (mirrors loadFedConsents)
    const consents = ov.consents?.consents || [];
    const fedMap = {};
    for (const c of consents) {
      if (c.scope === 'federation') { const pat = c.data_pattern || c.pattern || ''; if (pat && !pat.includes('*')) fedMap[pat] = c.id || c.consent_id; }
    }
    setFedConsents(fedMap);
    setAllConsents(consents.filter(c => !c.status || c.status === 'active'));
    // sharing groups
    setGroups(ov.groups?.groups || []);
    // organism names (mirrors loadOrgNames)
    const orgs = ov.organisms?.organisms || [];
    const nameMap = {};
    for (const o of orgs) nameMap[o.id] = o.name;
    setOrgNames(nameMap);
    setCartOrgs(orgs.map(o => ({ id: o.id, name: o.name })));
  }

  // Refresh the list in whatever mode is active: metadata-only by default (fast for thousands of
  // keys), or full values once the user pressed "Load all contents".
  async function loadMemories() {
    try {
      const agentGaii = selectedAgent || undefined;
      const memOpts = memArchived ? { archived: 'only' } : undefined;
      if (fullLoaded) {
        const list = await memoryService.listMemories(agentGaii, memOpts);
        setMemories(Array.isArray(list) ? list : []);
        // Don't report the archived-only count as the headline memory stat (it's a filtered view).
        if (!memArchived) onStats?.({ memory: Array.isArray(list) ? list.length : 0 });
      } else {
        const { items, quota } = await memoryService.listMemoriesMeta(agentGaii, memOpts);
        setMemories(items);
        setMemQuota(quota);
        setValueCache({});
        if (!memArchived) onStats?.({ memory: items.length });
      }
    } catch (err) { swallowed('memory-tab', err); setMemories([]); }
  }

  // "Load all contents" — pull every entry's value so the instant client filter can search values too.
  async function loadFullContents() {
    setFullLoaded(true);
    try {
      const list = await memoryService.listMemories(selectedAgent || undefined);
      setMemories(Array.isArray(list) ? list : []);
    } catch (err) { swallowed('memory-tab: loadFullContents', err); }
  }

  // Lazy value fetch (meta mode): on row expand, fetch the value once and cache it.
  async function ensureValue(key) {
    if (fullLoaded || valueCache[key] !== undefined) return;
    setLoadingValueKeys(prev => new Set(prev).add(key));
    try {
      const resp = await memoryService.getMemory(key, { soft: true, agent: selectedAgent || undefined });
      setValueCache(prev => ({ ...prev, [key]: resp?.data?.value ?? null }));
    } catch (err) { swallowed('memory-tab: ensureValue', err);
      setValueCache(prev => ({ ...prev, [key]: null }));
    } finally {
      setLoadingValueKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  // The effective value for a row: from the full list, the lazy cache, or undefined (still loading).
  const valueOf = (m) => (fullLoaded ? m.value : valueCache[m.key]);

  // Clipboard text for a single entry's value: pretty JSON for objects, the raw string otherwise.
  // Empty string when the value isn't loaded yet (the Copy-value button is hidden in that case).
  const valueCopyText = (m) => {
    const v = valueOf(m);
    if (v === undefined) return '';
    return (typeof v === 'object' && v !== null) ? JSON.stringify(v, null, 2) : String(v ?? '');
  };

  // Server-side content search (key + value + tags), optionally scoped to a namespace/group prefix.
  async function runServerSearch(query, prefix) {
    const q = (query ?? searchInput).trim();
    setSearchScopePrefix(prefix || '');
    if (!q) { setSearchResults(null); return; }
    setSearchLoading(true);
    try {
      const results = await memoryService.searchMemory(q, selectedAgent || undefined, prefix || undefined);
      const list = Array.isArray(results) ? results : [];
      setSearchResults(list);
      // Search results carry their values — cache them so expanding a result shows the value at once.
      setValueCache(prev => { const next = { ...prev }; for (const r of list) next[r.key] = r.value; return next; });
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
      setSearchResults([]);
    } finally { setSearchLoading(false); }
  }

  function clearServerSearch() {
    setSearchInput('');
    setSearchResults(null);
    setSearchScopePrefix('');
  }

  // Export all (or a prefix) of the caller's memory as a downloaded JSON backup.
  async function handleExport(prefix) {
    try {
      const data = await memoryService.exportMemory(selectedAgent || undefined, prefix || undefined);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `aimeat-memory-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast((t('profile.memory.exportDone') || 'Exported {n} entries').replace('{n}', String(data.count ?? (data.entries || []).length)));
    } catch (e) { showToast(e.message || t('profile.error'), true); }
  }

  // Import a JSON backup; the user picks a conflict mode (skip/overwrite/rename) before it runs.
  const importFileRef = useRef(null);
  function triggerImport() { importFileRef.current?.click(); }
  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';   // allow re-picking the same file
    if (!file) return;
    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch { showToast(t('profile.memory.importBadJson') || 'Not a valid JSON backup', true); return; }
    const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.entries) ? parsed.entries : null);
    if (!entries || entries.length === 0) { showToast(t('profile.memory.importEmpty') || 'No entries found in file', true); return; }

    const modeLabel = (m) => t('profile.memory.importMode.' + m) || m;
    confirm(
      (t('profile.memory.importConfirm') || 'Import {n} entries? Existing keys are handled by mode: {mode}.')
        .replace('{n}', String(entries.length)).replace('{mode}', modeLabel(importMode)),
      async () => {
        setImporting(true);
        try {
          const resp = await memoryService.importMemory(entries, importMode, selectedAgent || undefined);
          if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
          const s = resp.data || {};
          showToast((t('profile.memory.importDone') || 'Imported: {c} new, {u} updated, {s} skipped')
            .replace('{c}', String(s.created || 0)).replace('{u}', String(s.updated || 0)).replace('{s}', String(s.skipped || 0))
            + ((s.failed && s.failed.length) ? ` · ${s.failed.length} ${t('profile.error') || 'failed'}` : ''),
            !!(s.failed && s.failed.length));
          loadMemories();
        } catch (e) { showToast(e.message || t('profile.error'), true); }
        finally { setImporting(false); }
      },
    );
  }

  // Delete a whole namespace/group at once (server-side bulk-delete by prefix).
  function deleteGroup(g, count) {
    const prefix = g.kind === 'organism' ? 'organism.' + g.uuid + '.'
      : g.kind === 'plain' ? g.id + '.'
        : null;
    if (!prefix) { showToast(t('profile.memory.deleteGroupUnsupported') || 'This group cannot be bulk-deleted', true); return; }
    confirm(
      (t('profile.memory.deleteGroupConfirm') || 'Delete all {n} entries under "{g}"? This cannot be undone.')
        .replace('{n}', String(count)).replace('{g}', groupLabel(g)),
      async () => {
        try {
          const resp = await memoryService.bulkDeleteMemory({ prefix, agentGaii: selectedAgent || undefined });
          if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
          showToast((t('profile.memory.bulkDeleted') || '{n} deleted').replace('{n}', String(resp.data?.deleted ?? 0)));
          setExpandedMem(null);
          loadMemories();
        } catch (e) { showToast(e.message || t('profile.error'), true); }
      },
      { danger: true },
    );
  }

  async function loadFiles() {
    try {
      const list = await memoryService.listFiles();
      setFiles(Array.isArray(list) ? list : []);
      onStats?.({ files: Array.isArray(list) ? list.length : 0 });
    } catch (err) { swallowed('memory-tab', err); setFiles([]); }
  }

  async function handleCreateMemory(key, value, visibility, tags, groupId) {
    try {
      await memoryService.createMemory(key, value, visibility, tags, groupId);
      showToast(t('profile.memory.saved'));
      setShowMemForm(false);
      await loadMemories();
    } catch (e) {
      showToast(e.message || t('profile.memory.saveFailed'), true);
    }
  }

  async function handleDeleteMemory(key) {
    confirm(t('profile.memory.deleteConfirm') + ': ' + key + '?', async () => {
      const resp = await memoryService.deleteMemory(key);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
      showToast(t('profile.memory.deleted'));
      setExpandedMem(null);
      loadMemories();
    }, { danger: true });
  }

  async function handleSaveEdit(key, value, visibility, version, groupId) {
    // The editor works on text; a value that parses as JSON is stored as the parsed
    // object (not a string of JSON) so readers get back what the writer stored.
    let v = value;
    const s = String(value || '').trim();
    if (/^[[{]/.test(s)) { try { v = JSON.parse(s); } catch { /* modal validates; keep raw as fallback */ } }   // eslint-disable-line aimeat/no-silent-catch -- modal validates; keep raw as fallback
    const body = { value: v, visibility, version };
    if (visibility === 'group' && groupId) body.group_id = groupId;
    const resp = await memoryService.updateMemoryFull(key, body);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.memory.updated'));
    setEditModal(null);
    loadMemories();
  }

  async function handleUploadFiles(fileItems, visibility, tags) {
    if (!fileItems || fileItems.length === 0) return;
    let ok = 0, fail = 0;
    for (const item of fileItems) {
      try {
        const base64 = await readFileAsBase64(item.file);
        await memoryService.uploadFile(item.key, base64, item.file.type || 'application/octet-stream', visibility, tags);
        ok++;
      } catch (err) { swallowed('memory-tab', err); fail++; }
    }
    if (ok > 0) showToast(ok === 1 ? t('profile.files.uploaded') : `${ok} ${t('profile.files.filesUploaded')}`);
    if (fail > 0) showToast(`${fail} ${t('profile.files.uploadFailed')}`, true);
    if (ok > 0) { setShowFileForm(false); loadFiles(); }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(/** @type {string} */ (reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Download works on the owner_gaii-aware URL (with a /v1/pub fallback) so agent-owned files —
  // which the list aggregates but the caller-scoped auth route 404s — download too.
  async function handleDownloadFile(f) {
    const key = typeof f === 'string' ? f : (f.key || f.name);
    const fileObj = typeof f === 'string' ? { key } : f;
    try {
      const blob = await fetchFileBytes(fileObj, NODE_URL);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = key;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
    }
  }

  async function handleDeleteFile(key) {
    confirm(t('profile.files.deleteConfirm'), async () => {
      const resp = await memoryService.deleteFile(key);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
      showToast(t('profile.files.deleted'));
      loadFiles();
    }, { danger: true });
  }

  async function loadKeyPerms(key) {
    try {
      const result = await getKeyPermissions(key);
      setKeyRulesPopover({ key, rules: result.rules, visibility: result.visibility });
    } catch (err) { swallowed('memory-tab', err); setKeyRulesPopover(null); }
  }

  // Quick visibility change from the expanded detail. 'group' needs a group pick,
  // so it routes to the edit modal where the group select lives.
  async function handleQuickVis(m, newVis) {
    if (newVis === (m.visibility || 'private')) return;
    if (newVis === 'group') {
      setEditModal({ key: m.key, value: typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || ''), visibility: 'group', version: m.version, isJson: typeof m.value === 'object' });
      return;
    }
    const resp = await memoryService.updateMemoryVisibility(m.key, newVis, m.version);
    if (resp.ok === false) showToast(resp.error?.message || t('profile.error'), true);
    loadMemories();
  }

  // Badge-click popover: pick a visibility (incl. a sharing group) right in the row.
  // Deliberate two clicks — open, then choose — so a stray click can't publish anything.
  const [visPopoverFor, setVisPopoverFor] = useState(null);
  async function applyVis(m, newVis, groupId) {
    setVisPopoverFor(null);
    if (newVis === (m.visibility || 'private') && !groupId) return;
    const resp = await memoryService.updateMemoryVisibility(m.key, newVis, m.version, groupId);
    if (resp.ok === false) showToast(resp.error?.message || t('profile.error'), true);
    loadMemories();
  }

  // Bulk edit: checkbox-select rows, then change visibility (or delete) for all at once.
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [bulkVis, setBulkVis] = useState('private');
  const toggleSelected = (key) => setSelectedKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  async function applyBulkVis() {
    const targets = (memories || []).filter(m => selectedKeys.has(m.key));
    const groupId = bulkVis.startsWith('group:') ? bulkVis.slice(6) : undefined;
    const vis = groupId ? 'group' : bulkVis;
    let ok = 0, fail = 0;
    for (const m of targets) {
      try {
        const resp = await memoryService.updateMemoryVisibility(m.key, vis, m.version, groupId);
        if (resp.ok === false) fail++; else ok++;
      } catch (err) { swallowed('memory-tab', err); fail++; }
    }
    showToast((t('profile.memory.bulkDone') || '{n} updated').replace('{n}', String(ok)) + (fail ? ` · ${fail} ${t('profile.error') || 'failed'}` : ''), fail > 0);
    setSelectedKeys(new Set());
    loadMemories();
  }

  function bulkDelete() {
    const n = selectedKeys.size;
    confirm((t('profile.memory.bulkDeleteConfirm') || 'Delete {n} memory entries? This cannot be undone.').replace('{n}', String(n)), async () => {
      let ok = 0;
      for (const key of selectedKeys) {
        try { const r = await memoryService.deleteMemory(key); if (r.ok !== false) ok++; } catch (err) { swallowed('memory-tab: bulkDelete', err); }
      }
      showToast((t('profile.memory.bulkDeleted') || '{n} deleted').replace('{n}', String(ok)));
      setSelectedKeys(new Set());
      setExpandedMem(null);
      loadMemories();
    }, { danger: true });
  }

  async function handleUpdateMemoryTags(key, tags, version) {
    const resp = await memoryService.updateMemoryTags(key, tags, version);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    loadMemories();
  }

  async function handleUpdateFileTags(key, tags) {
    const resp = await memoryService.updateFileTags(key, tags);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    loadFiles();
  }

  async function handleUpdateFileVisibility(key, newVis) {
    // Optimistic update
    setFiles(prev => prev?.map(f => (f.key || f.name) === key ? { ...f, visibility: newVis } : f));
    const resp = await memoryService.updateFileVisibility(key, newVis);
    if (resp.ok === false) {
      showToast(resp.error?.message || t('profile.error'), true);
      loadFiles(); // Revert on error
    }
  }

  function groupLabel(g) {
    if (g.kind === 'organism') return 'organism: ' + (orgNames[g.uuid] || shortTok(g.uuid));
    if (g.kind === 'other') return t('profile.memory.groupOther');
    return g.id;
  }

  const [fileTagFilter, setFileTagFilter] = useState(new Set());
  const [fileFilterText, setFileFilterText] = useState('');
  const [previewFile, setPreviewFile] = useState(null);   // file being previewed in the lightbox modal

  async function doPull(key) {
    try {
      await memoryService.pullFromHome(key);
      showToast(t('profile.memory.pullSuccess'));
      loadMemories();
    } catch (e) { showToast(e.message, true); }
  }

  async function doPush(key) {
    try {
      await memoryService.pushToHome(key);
      showToast(t('profile.memory.pushSuccess'));
    } catch (e) { showToast(e.message, true); }
  }

  // Three states of the same list = tabs, not inline panels with their own Cancel buttons.
  const pickMainTab = (id) => {
    setMainTab(id);
    if (id === 'discover') initDiscover(ctx);
    else if (id === 'remote') { if (session.federated) loadBrowseHome(ctx); else initBrowseRemote(ctx); }
    else closeBrowse(ctx);
  };

  // Shared render context — the entries / files / browse render functions and browse handlers live
  // in ./memory-tab/ sibling modules; they read the component's state + handlers through this bag.
  const ctx = {
    // shared
    session, showToast, confirm, NODE_URL, loadMemories,
    // entries
    memories, valueOf, valueCopyText, sortBy, setSortBy, memTagFilter, setMemTagFilter, filterText, setFilterText,
    expandedMem, setExpandedMem, ensureValue, selectedKeys, toggleSelected, setSelectedKeys, visPopoverFor,
    setVisPopoverFor, keyHasRules, loadKeyPerms, fedConsents, inCart, memCartItem, fileCartItem, toggleCartItem,
    addCartItems, applyVis, groups, handleQuickVis, fullLoaded, loadingValueKeys, editingMemTags, setEditingMemTags,
    keyRulesPopover, setKeyRulesPopover, handleUpdateMemoryTags, setEditModal, togglingFed, handleStopSharing,
    handleShareToFederation, doPull, doPush, handleDeleteMemory, memQuota, loadFullContents, handleExport, importing,
    triggerImport, importMode, setImportMode, importFileRef, handleImportFile, searchInput, setSearchInput,
    runServerSearch, searchScopePrefix, setSearchScopePrefix, searchLoading, searchResults, clearServerSearch,
    memArchived, setMemArchived, showMemForm, setShowMemForm, handleCreateMemory, bulkVis, setBulkVis, applyBulkVis,
    bulkDelete, collapsedGroups, toggleGroupCollapsed, groupLabel, orgNames, deleteGroup,
    // files
    files, showFileForm, setShowFileForm, handleUploadFiles, fileFilterText, setFileFilterText, fileTagFilter,
    setFileTagFilter, editingFileTags, setEditingFileTags, handleUpdateFileTags, handleUpdateFileVisibility,
    setPreviewFile, handleDownloadFile, handleDeleteFile,
    // browse
    setBrowseMode, setBrowseLoading, setBrowseError, setRemoteEntries, setSelectedPeer, setRemotePeers,
    setPullingKeys, setDiscoverLoading, setDiscoverError, setDiscoverEntries, setExpandedDiscover, setCopyingKeys,
    setDiscoverSearch, selectedPeer, remoteEntries, browseMode, discoverSearch, discoverLoading, discoverError,
    discoverEntries, expandedDiscover, copyingKeys, remotePeers, browseLoading, browseError, pullingKeys,
  };

  return html`
    <div class="section-title">${t('profile.memory.title')}</div>
    <div class="section-desc">${t('profile.memory.desc')}</div>

    <div class="sub-tabs">
      <button class="sub-tab ${mainTab === 'own' ? 'active' : ''}" onClick=${() => pickMainTab('own')}>${t('profile.memory.tabOwn')}</button>
      <button class="sub-tab ${mainTab === 'discover' ? 'active' : ''}" onClick=${() => pickMainTab('discover')}>${t('profile.memory.tabPublic')}</button>
      <button class="sub-tab ${mainTab === 'remote' ? 'active' : ''}" onClick=${() => pickMainTab('remote')}>${session.federated ? t('profile.memory.browseHome') : t('profile.memory.tabRemote')}</button>
    </div>

    ${session.federated && html`
      <div class="alert alert-info mb-half">
        <span class="alert-msg">${t('profile.memory.federatedSession')}</span>
      </div>
    `}

    ${mainTab !== 'own' ? renderBrowsePanel(ctx) : html`
      ${agents.length > 1 && html`
        <div class="agent-selector mb-half">
          <label class="text-meta pf-mr-half">${t('profile.memory.agent') || 'Agent'}:</label>
          <select class="input-field pf-select-inline"
            value=${selectedAgent} onChange=${e => { setSelectedAgent(e.target.value); setExpandedMem(null); setMemTagFilter(new Set()); setFullLoaded(false); clearServerSearch(); }}>
            <option value="">${t('profile.memory.defaultAgent') || 'Default agent'}</option>
            ${agents.map(a => html`<option key=${a.gaii} value=${a.gaii}>${escHtml(a.name || a.gaii)}${a.display_name ? ` — ${escHtml(a.display_name)}` : ''}</option>`)}
          </select>
        </div>
      `}

      <div class="sub-tabs">
        <button class="sub-tab ${memSubTab === 'entries' ? 'active' : ''}" onClick=${() => setMemSubTab('entries')}>${t('profile.memory.entries')}</button>
        <button class="sub-tab ${memSubTab === 'files' ? 'active' : ''}" onClick=${() => setMemSubTab('files')}>${t('profile.memory.files')}</button>
      </div>
      ${cart.length > 0 && html`<${CartTray} cart=${cart} nodeUrl=${NODE_URL} orgs=${cartOrgs} onRemove=${removeCartItem} onClear=${clearCart} showToast=${showToast} />`}
      ${memSubTab === 'entries' ? renderEntries(ctx) : renderFilesList(ctx)}
    `}

    ${editModal && html`<${EditMemoryModal}
      memKey=${editModal.key}
      initialValue=${editModal.value}
      initialVisibility=${editModal.visibility}
      initialVersion=${editModal.version}
      isJson=${editModal.isJson}
      groups=${groups}
      onSave=${(v, vis, ver, gId) => handleSaveEdit(editModal.key, v, vis, ver, gId)}
      onCancel=${() => setEditModal(null)} />`}
    ${previewFile && html`<${FilePreviewModal}
      file=${previewFile}
      nodeUrl=${NODE_URL}
      onClose=${() => setPreviewFile(null)}
      onDownload=${handleDownloadFile}
      showToast=${showToast} />`}
    <${ConfirmUI} />
  `;
}
