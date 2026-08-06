/**
 * @file workspace.js
 * @description The organism workspace view (manifest-driven) — the draft → publish → version loop,
 *   grouped manifest-space tabs, the Overview landing scroll, the publish gate + approval inbox,
 *   document/record spaces, settings (manifest form, spaces, restructure, danger zone), and the AI
 *   generator (used both for a fresh workspace and for restructuring). Extracted from organisms-tab.js
 *   with no behaviour change.
 * @structure PRIMARY_FIELD (const), Workspace
 * @usage import { Workspace } from '/views/profile/organisms/workspace.js';
 * @version-history
 *   v1.x — 2026-07-10 — TARGET-025: Share tab gains the access-mode picker (open / password /
 *     account) + share-password set/change/clear controls (server stores only a hash; the UI sees
 *     has_password). Members' own access is never affected — the choice gates the public link only.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — Add the free-form README panel + the interactive workspace mindmap; rename
 *     the structure overview to "table of contents" (Osa A/C).
 *   v1.2.0 — 2026-06-22 — Batch + debounce: one /comments/batch covers all visible threads (records +
 *     open doc) instead of per-thread fetches; the main load + comments refresh are debounced (1.5s)
 *     so an agent-driven 'organisms'/'memory' event burst is a single reload.
 *   v1.3.0 — 2026-06-22 — Record readability: fields render label-on-top, left-aligned, wrapping, with
 *     markdown for text / lists for arrays / pretty JSON for objects (was a right-aligned one-liner);
 *     editing happens INLINE in the record's own card (one editor at a time) instead of a form at the
 *     top of the space; each record is a separated card with breathing room.
 *   v1.4.0 — 2026-06-23 — Accept an `initialSpace` prop: a deep-link from the organism mindmap opens
 *     the workspace straight on that space's tab (instead of always the overview).
 *   v1.5.0 — 2026-06-23 — Measurability: render the manifest's objectives[] as an Objectives card
 *     (each KPI's current vs target, ✅/⚠️, computed-vs-self-reported) at the top of the workspace,
 *     fed by getWorkspaceOverviewFull + refreshed on live updates. Design:
 *     docs/internal/2026-06-23-organism-measurability-design.md (Phase G).
 *   v1.6.0 — 2026-06-23 — Findability pass (vaihe 1): the "What happened here" feed shows the
 *     document/record title instead of the raw id (instanceTitle); multi-part documents
 *     ("… — osa N") collapse under one expandable series row (niputus) in both the doc-space index
 *     and the Overview space list — pure display grouping, never touches stored sections/data.
 *   v1.7.0 — 2026-06-23 — Findability pass (vaihe 2): optional color tags. A small preset palette
 *     (ColorPicker + TAG_PALETTE → theme tokens) lets sections, documents and records be tagged with
 *     a color (left-rail accent). Section colors persist on the section object; per-item colors in a
 *     parallel meta.colors map (getAllColors/saveColors). Colors are optional and default to none.
 *   v1.8.0 — 2026-07-02 — Apps strip on the Overview: the apps pinned to this workspace (meta.apps
 *     binding) render as launch cards (WorkspaceApps), with a creator/admin pin/unpin picker.
 *   v1.9.0 — 2026-07-13 — Pure extraction to satisfy max-file-lines: the sub-components + render
 *     helpers moved into sibling modules under ./workspace/ (color-picker, helpers, generator,
 *     doc-space, record-space, overview, panels, model), imported back and threaded a ctx bag.
 *     No behaviour change — all hooks/effects/callbacks stay in this component.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { Spinner, KebabMenu } from '/views/profile/shared.js';
import { useConfirm } from '/components/Modal.js';
import { EmptyState } from '/components/EmptyState.js';
import { SearchBar } from '/components/SearchBar.js';
import * as orgService from '/js/services/organisms.js';
import { getGhii } from '/js/services/auth.js';
import { copyToClipboard } from '/js/utils.js';
import { recordRecent } from '/js/recents.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';
import { SkillsPanel } from '/views/profile/organisms/skills-panel.js';
// Extracted sibling modules (relative imports — no importmap entry needed).
import { WorkspaceGenerator } from './workspace/generator.js';
import { renderSpaceNotice } from './workspace/helpers.js';
import { renderDocSpace } from './workspace/doc-space.js';
import { renderRecordSpace } from './workspace/record-space.js';
import { renderOverview, renderObjectives, renderWsSearchResults, renderOvSection } from './workspace/overview.js';
import { renderTabsNav, renderSpacesAdd, renderSettingsPanel, renderShareTab, renderReviewTab, renderActivityTab } from './workspace/panels.js';
import { buildBreadcrumb, buildWorkspaceModel } from './workspace/model.js';
import { swallowed } from '/js/swallowed.js';

/* ───────────────── Organism workspace (manifest-driven) ─────────────────
 * Any organism can have a governed workspace. If it has no manifest yet, offer
 * "Set up workspace" (applies the project template). Otherwise render the
 * manifest's object types with the draft → publish → version loop, the publish
 * gate, the approval inbox, and the decision log. */

export function Workspace({ org, wsId, showToast, onBack, onBackToList, initialSpace }) {
  const orgId = org.id;
  // Registry name for the breadcrumb (the manifest's name can differ from the workspace's name).
  const [wsName, setWsName] = useState('');
  useEffect(() => {
    let cancelled = false;
    orgService.listWorkspaces(orgId).then(list => {
      if (cancelled) return;
      const name = (list.find(w => w.id === wsId)?.name) || '';
      setWsName(name);
      // Feed the home page's "Continue" list with a real display name.
      recordRecent({ type: 'workspace', id: `${orgId}/${wsId}`, label: name || wsId, sub: org.name || '', data: { orgId, wsId } });
    }).catch(err => { swallowed('workspace: name', err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- org.name only feeds recordRecent's display sub; the workspace-name fetch is intentionally keyed to orgId/wsId.
  }, [orgId, wsId]);  // Pop a document out into its own window (served by doc-solo.js) so several can sit side by side,
  // each independent. The window name is unique per document, so re-clicking focuses the open one.
  const popOut = (typeName, docId) => {
    const u = '/v1/profile?doc=' + encodeURIComponent(`${orgId}:${wsId}:${typeName}:${docId}`);
    window.open(u, 'aimeatdoc_' + orgId + '_' + wsId + '_' + docId, 'width=940,height=1040,menubar=no,toolbar=no,location=no,status=no');
  };
  const { confirm, ConfirmUI } = useConfirm();
  const [ws, setWs] = useState(undefined); // undefined=loading, null=no manifest, object=workspace
  const [approvals, setApprovals] = useState([]);
  const [gateOn, setGateOn] = useState(false);
  const [adding, setAdding] = useState(null);          // objectType name being added
  const [addingSchema, setAddingSchema] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sName, setSName] = useState('');
  const [sSummary, setSSummary] = useState('');
  const [sAutonomy, setSAutonomy] = useState('L3');
  // The generator (fresh-workspace + restructure) owns its own draft/paste state inside
  // <WorkspaceGenerator/>; the parent keeps only genBusy so the "Set up workspace" button can
  // disable while a generation is in flight.
  const [genBusy, setGenBusy] = useState(false);     // AI "Generate" in flight
  // { type, mode:'view'|'edit', page } for document-mode types. Restored from sessionStorage on F5
  // so the user returns to the document they were on (only the id is kept; renderDocSpace re-resolves
  // it to the live entry once the workspace loads).
  const docKey = 'aimeat.ws.' + orgId + '.' + wsId + '.activeDoc';
  const [activeDoc, setActiveDoc] = useState(() => {
    try {
      const raw = sessionStorage.getItem(docKey);
      if (raw) { const v = JSON.parse(raw); if (v && v.type && v.id) return { type: v.type, mode: v.mode === 'edit' ? 'edit' : 'view', page: { id: v.id } }; }
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    } catch { /* noop */ }
    return null;
  });
  // Active tab — Overview first (ALWAYS the landing view: the whole workspace on one scroll),
  // then one tab per manifest space + fixed Sources/Share/Review/Activity/People. Deliberately
  // NOT persisted: opening a workspace must show the overview, not whatever tab was last open.
  // Exception: a deep-link from the organism mindmap (initialSpace) opens straight on that space tab.
  const [tab, setTab] = useState(initialSpace ? 'space:' + initialSpace : 'overview');
  const [sectionsByType, setSectionsByType] = useState({});  // { typeName: [{id,name,parentId,documents:[docId],color?}] }
  const [colorsByType, setColorsByType] = useState({});      // { typeName: { instanceId: colorKey } } — optional per-item color tags
  const [editingSec, setEditingSec] = useState(null);        // section id currently being renamed inline
  const draggedDoc = useRef(null);                            // { type, id } of the doc being dragged
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);   // false = active records, true = archived-only view
  const [delConfirm, setDelConfirm] = useState('');   // typed-name confirmation for delete
  const [newSpaceName, setNewSpaceName] = useState('');
  const [addingInitial, setAddingInitial] = useState(null);   // record being edited (null = new draft)
  const [addingId, setAddingId] = useState(null);             // its id, preserved so save overwrites
  const [expandedRec, setExpandedRec] = useState({});         // { "type:id": true } — records expanded to view fields
  const [expandedSeries, setExpandedSeries] = useState({});   // { "type:base": true } — a multi-part doc series expanded in the index
  const [showSpaces, setShowSpaces] = useState(false);        // inline add-space form at the workspace top
  const [showFlow, setShowFlow] = useState(true);             // the manifest-defined edit-flow chart (first item)
  const [share, setShare] = useState(null);                   // { public, spaces, docs, access, has_password } — lazy-loaded when Settings opens
  const [shareBusy, setShareBusy] = useState(false);
  const [sharePw, setSharePw] = useState('');                 // share-password input (never stored beyond the PUT)
  const [wsEvents, setWsEvents] = useState([]);               // activity events — Overview strip + per-tab unseen badges
  const [ovOpen, setOvOpen] = useState({});                   // Overview accordion: { spaceName: bool } (mobile starts collapsed)
  const [ovDoc, setOvDoc] = useState(null);                   // Overview inline document (mobile): { type, id, mode }
  const [pendingScroll, setPendingScroll] = useState(null);   // a space name to scroll to inside the active stacked-group view

  // ── Unseen-change tracking: per-tab "seen" marks in localStorage (they survive sessions).
  // A tab's badge counts items changed since the tab was last opened; opening it (or changes
  // landing while it is open) marks it seen. First-ever visit seeds a baseline at "now", so
  // history never shows as unseen. Neutral gray badges only — red is reserved for errors.
  const seenKey = 'aimeat.ws.' + orgId + '.' + wsId + '.seen';
  const [seen, setSeen] = useState(() => {
    try { const raw = localStorage.getItem(seenKey); return raw ? JSON.parse(raw) : null; } catch { return null; }   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  });
  const markSeen = useCallback((tabId) => setSeen(prev => {
    const next = { ...(prev || {}), [tabId]: new Date().toISOString() };
    try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
    return next;
  }), [seenKey]);
  // Items (not raw events) changed since the tab's seen mark. The user's own non-agent edits
  // are not news to them, so they never count. Event actors come as the BARE owner name from
  // the version history, so compare against both the bare name and the full GHII.
  const unseenOf = useCallback((tabId) => {
    if (!seen) return 0;
    const base = seen[tabId] || seen.__base;
    if (!base) return 0;
    const me = getGhii();
    const meBare = String(me || '').split('@')[0];
    const isOwn = (e) => !e.agent && me && (e.actor === me || e.actor === meBare);
    const match = tabId.startsWith('space:') ? (e) => e.type === tabId.slice(6)
      : (tabId === 'activity' ? () => true : () => false);
    const evs = wsEvents.filter(e => (e.at || '') > base && match(e) && !isOwn(e));
    return new Set(evs.map(e => (e.type || '') + ':' + (e.instance || ''))).size;
  }, [seen, wsEvents]);

  const load = useCallback(async () => {
    // In the archived view, request ONLY archived content (read-only); otherwise the normal active set.
    const w = await orgService.getWorkspace(orgId, wsId, showArchived ? { archived: 'only' } : undefined).catch(err => { swallowed('workspace', err); return null; });
    if (w && w.manifest) {
      const [ap, cfg, secs, act, cols] = await Promise.all([
        orgService.listApprovals(orgId, 'pending').catch(err => { swallowed('workspace', err); return []; }),
        orgService.getConfig(orgId).catch(err => { swallowed('workspace', err); return ({}); }),
        orgService.getAllSections(orgId, wsId).catch(err => { swallowed('workspace', err); return ({}); }),
        orgService.getWorkspaceActivity(orgId, wsId).catch(() => ({ events: [] })),
        orgService.getAllColors(orgId, wsId).catch(err => { swallowed('workspace', err); return ({}); }),
      ]);
      setApprovals(ap); setGateOn(!!(cfg?.gates?.publish?.enabled)); setSectionsByType(secs);
      setWsEvents(act?.events || []); setColorsByType(cols);
    }
    setWs(w && w.manifest ? w : null);
  }, [orgId, wsId, showArchived]);

  useEffect(() => { load(); }, [load]);

  // Workspace structure GRAPH (mindmap data) + the OKF table-of-contents (AI-fill prompt seed) —
  // loaded alongside, refreshed on live updates.
  const [wsGraph, setWsGraph] = useState(null);
  const [wsTocSeed, setWsTocSeed] = useState('');
  const [wsObjectives, setWsObjectives] = useState([]);   // measurability objectives + resolved KPIs
  useEffect(() => {
    let cancelled = false;
    const loadGraph = async () => {
      const [g, ov] = await Promise.all([
        orgService.getWorkspaceGraph(orgId, wsId).catch(err => { swallowed('workspace: loadGraph', err); return null; }),
        orgService.getWorkspaceOverviewFull(orgId, wsId).catch(() => ({ markdown: '', objectives: [] })),
      ]);
      if (cancelled) return;
      setWsGraph(g); setWsTocSeed(ov.markdown || ''); setWsObjectives(ov.objectives || []);
    };
    loadGraph();
    const off = onLiveUpdate(['organisms'], loadGraph);
    return () => { cancelled = true; off(); };
  }, [orgId, wsId]);

  // README edit permission: the org creator/admin (server enforces the full rule incl. ws creator).
  // creatorGhii/admins are BARE owner names; getGhii() is a full GHII — compare the bare owner.
  const wsCanEdit = (() => { const me = String(getGhii() || '').split('@')[0]; return !!me && (org.creatorGhii === me || (org.admins || []).includes(me)); })();
  const saveWsReadme = async (md) => {
    await orgService.saveWorkspaceReadme(orgId, wsId, md);
    setWs(prev => (prev ? { ...prev, readme: md } : prev));
    showToast?.(t('readme.saved') || 'README saved', 'success');
  };
  const onWsMapNav = (target) => { if (target?.type === 'space' && target.space) setTab('space:' + target.space); };

  // ── In-workspace content search (Kerros 1): indexed FTS scoped to this workspace. While a query is
  // active the space tabs are filtered to the ones with matches (+ counts) and a grouped result list
  // replaces the space view; clicking a hit jumps straight to that record/document. ──
  const [wsQuery, setWsQuery] = useState('');
  const [wsHits, setWsHits] = useState(null);   // null = not searching; [] = searched, no matches
  const [wsSearching, setWsSearching] = useState(false);
  useEffect(() => {
    const q = wsQuery.trim();
    if (q.length < 2) { setWsHits(null); setWsSearching(false); return undefined; }
    let cancelled = false;
    setWsSearching(true);
    const tid = setTimeout(async () => {
      const r = await orgService.searchOrganism(orgId, q, wsId).catch(err => { swallowed('workspace: onWsMapNav', err); return null; });
      if (!cancelled) { setWsHits((r?.data?.results) || []); setWsSearching(false); }
    }, 220);   // debounce — instant feel without a request per keystroke
    return () => { cancelled = true; clearTimeout(tid); };
  }, [wsQuery, orgId, wsId]);
  const wsSearchCounts = wsHits ? wsHits.reduce((m, h) => { m[h.space] = (m[h.space] || 0) + 1; return m; }, {}) : null;
  // One-shot: the command palette (Cmd-K) can pre-fill this workspace's search so you land on the
  // filtered result list for the query you jumped from.
  useEffect(() => {
    const k = `aimeat.ws.${orgId}.${wsId}.search`;
    try { const v = sessionStorage.getItem(k); if (v) { setWsQuery(v); sessionStorage.removeItem(k); } } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
  }, [orgId, wsId]);

  // Deep-link from the librarian "Open" button: aimeat.ws.{org}.{ws}.openDoc = { namespace, id }.
  // Once the manifest is loaded we resolve the namespace → object-type name, open that space tab and
  // its document, then clear the key (one-shot).
  const openDocKey = 'aimeat.ws.' + orgId + '.' + wsId + '.openDoc';
  useEffect(() => {
    if (!ws?.manifest) return;
    let req = null;
    try { req = JSON.parse(sessionStorage.getItem(openDocKey) || 'null'); } catch { req = null; }   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
    if (!req || !req.namespace || !req.id) return;
    const ot = (ws.manifest.objectTypes || []).find(o => o.namespace === req.namespace);
    if (ot) { setTab('space:' + ot.name); setActiveDoc({ type: ot.name, mode: 'view', page: { id: req.id } }); }
    try { sessionStorage.removeItem(openDocKey); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
  }, [ws, openDocKey]);

  // Persist the open document (id only) so an F5 returns to it. Skip unsaved new docs (no id yet).
  useEffect(() => {
    try {
      if (activeDoc?.type && activeDoc.page?.id) sessionStorage.setItem(docKey, JSON.stringify({ type: activeDoc.type, id: activeDoc.page.id, mode: activeDoc.mode }));
      else sessionStorage.removeItem(docKey);
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    } catch { /* noop */ }
  }, [activeDoc, docKey]);

  // Subscribe to 'organisms' ONLY — NOT the global 'memory' firehose (every one of dozens of agents'
  // unrelated memory writes was waking this view even when nothing in THIS workspace changed). Organism
  // content writes now also emit 'organisms' (see the memory route), so real workspace changes still
  // refresh; debounced to coalesce a burst into one reload.
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    let timer = null;
    const off = onLiveUpdate(['organisms'], () => { clearTimeout(timer); timer = setTimeout(() => liveRef.current(), 1500); });
    return () => { clearTimeout(timer); off(); };
  }, []);

  // ── Comments: ONE /comments/batch request covers every visible thread (the open document + each
  // expanded record), instead of every <WorkspaceComments> self-fetching AND re-fetching on every
  // 'organisms' event (the per-document comments storm). Debounced like the main load. ──
  const [commentsByKey, setCommentsByKey] = useState({});
  const cKey = orgService.commentBatchKey;
  const reloadComments = useCallback(async () => {
    const instances = [];
    for (const k of Object.keys(expandedRec)) {
      if (!expandedRec[k]) continue;
      const i = k.indexOf(':');
      if (i < 0) continue;
      instances.push({ ws: wsId, space: k.slice(0, i), instance_id: k.slice(i + 1) });
    }
    if (activeDoc?.type && activeDoc.page?.id) instances.push({ ws: wsId, space: activeDoc.type, instance_id: activeDoc.page.id });
    if (!instances.length) { setCommentsByKey({}); return; }
    const res = await orgService.listCommentsBatch(orgId, instances);
    const map = {};
    for (const [key, val] of Object.entries(res)) map[key] = val.comments || [];
    setCommentsByKey(map);
  }, [orgId, wsId, expandedRec, activeDoc]);
  useEffect(() => { reloadComments(); }, [reloadComments]);
  const commentsLiveRef = useRef(reloadComments); commentsLiveRef.current = reloadComments;
  useEffect(() => {
    let timer = null;
    const off = onLiveUpdate(['organisms'], () => { clearTimeout(timer); timer = setTimeout(() => commentsLiveRef.current(), 1500); });
    return () => { clearTimeout(timer); off(); };
  }, []);

  // Clicking a single space inside a stacked group view opens that group, then scrolls to (and
  // expands) the clicked space's section. The anchor wrapper is id="ws-sec-<name>"; a short timeout
  // lets the group content render before we look for it.
  useEffect(() => {
    if (!pendingScroll || !String(tab).startsWith('group:')) return;
    const name = pendingScroll;
    setOvOpen(s => ({ ...s, [name]: true }));
    const id = setTimeout(() => {
      const el = document.getElementById('ws-sec-' + name);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    setPendingScroll(null);
    return () => clearTimeout(id);
  }, [pendingScroll, tab]);

  // First-ever visit: seed the seen baseline once the workspace has loaded — no badges for history.
  useEffect(() => {
    if (seen !== null || ws === undefined) return;
    const next = { __base: new Date().toISOString() };
    try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
    setSeen(next);
  }, [seen, ws, seenKey]);
  // Changes landing on the tab the user is LOOKING at are seen immediately — otherwise a draft
  // saved while you're on its space tab would raise that tab's own badge.
  useEffect(() => {
    if (!seen || showSettings) return;
    const cur = tab || 'overview';
    if (unseenOf(cur) > 0) markSeen(cur);
  }, [wsEvents, tab, showSettings, seen, unseenOf, markSeen]);

  const setup = useCallback(async () => {
    setBusy(true);
    try {
      await orgService.applyProjectTemplate(orgId, wsId, org.name || 'Project', org.description || '');
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      await load();
    } catch (e) { showToast((e && e.message) || (t('organisms.setupError') || 'Failed to set up workspace')); }
    finally { setBusy(false); }
  }, [orgId, wsId, org, showToast, load]);

  const startAdd = useCallback(async (ot) => {
    setAddingInitial(null); setAddingId(null);
    setAdding(ot.name); setAddingSchema(null);
    const s = await orgService.getObjectSchema(orgId, wsId, ot.namespace);
    setAddingSchema(s || { properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['title'] });
  }, [orgId, wsId]);

  // Open the same schema form pre-filled with an existing draft — so a record can be reviewed/edited
  // (not just published blind). Saving overwrites the same draft id.
  const startEdit = useCallback(async (ot, rec) => {
    setAddingInitial(rec); setAddingId(rec.id);
    setAdding(ot.name); setAddingSchema(null);
    const s = await orgService.getObjectSchema(orgId, wsId, ot.namespace);
    setAddingSchema(s || { properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['title'] });
  }, [orgId, wsId]);
  const cancelForm = () => { setAdding(null); setAddingSchema(null); setAddingInitial(null); setAddingId(null); };
  const toggleExpand = (ot, id) => setExpandedRec(s => ({ ...s, [ot.name + ':' + id]: !s[ot.name + ':' + id] }));
  // Read-only field view for a record (skips the underscore-prefixed metadata the read attaches).
  // Manifest-carried workspace translations (generated workspaces): field labels at
  // "{namespace}.{field}", hints at "{namespace}.{field}.hint", space labels at "type.{name}".
  // Resolution: active locale → en → '' (callers fall back to the raw key/name).
  const wsT = useCallback((key) => {
    const m = ws?.manifest?.i18n;
    if (!m || typeof m !== 'object') return '';
    const lang = getLocale();
    return (m[lang] && m[lang][key]) || (m.en && m.en[key]) || '';
  }, [ws]);
  const saveDraft = useCallback(async (ot, value) => {
    const id = (String(value.id || '').trim() || `${ot.name}-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, wsId, ot.namespace, id, { ...value, id });
      if (r?.ok === false) { showToast(r?.error?.message || 'Draft rejected'); }
      else { showToast(t('organisms.draftSaved') || 'Draft saved'); setAdding(null); setAddingSchema(null); await load(); }
    } catch (e) { showToast((e && e.message) || 'Failed to save draft'); }
    finally { setBusy(false); }
  }, [orgId, wsId, showToast, load]);

  // Documents are free-form markdown records ({id,title,markdown}) — same draft/publish path.
  // When created from a section, file the new id into that section's documents[].
  const savePage = useCallback(async (ot, page, sectionId) => {
    const id = (String(page.id || '').trim() || `doc-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, wsId, ot.namespace, id, { id, title: page.title, markdown: page.markdown });
      if (r?.ok === false) { showToast(r?.error?.message || 'Document rejected'); }
      else {
        if (sectionId) {
          const secs = (sectionsByType[ot.name] || []).map(s => s.id === sectionId
            ? { ...s, documents: [...(s.documents || []).filter(d => d !== id), id] } : s);
          await orgService.saveSections(orgId, wsId, ot.name, secs).catch(err => { swallowed('workspace: secs', err); });
        }
        // Reload, then open the just-saved document (view mode). renderDocSpace re-resolves the id
        // to the fresh merged entry, so the new draft shows with its badge instead of the empty state.
        showToast(t('organisms.pageSaved') || 'Document saved'); await load(); setActiveDoc({ type: ot.name, mode: 'view', page: { id } });
      }
    } catch (e) { showToast((e && e.message) || 'Failed to save document'); }
    finally { setBusy(false); }
  }, [orgId, wsId, sectionsByType, showToast, load]);

  // ── Section index ops (persist organism.{id}.meta.sections.{typeName}) ──
  const updateSections = useCallback(async (typeName, sections) => {
    setSectionsByType(s => ({ ...s, [typeName]: sections }));
    await orgService.saveSections(orgId, wsId, typeName, sections).catch(e => showToast((e && e.message) || 'Failed to save sections'));
  }, [orgId, wsId, showToast]);
  const addSection = (typeName, parentId) => {
    const id = 'sec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    updateSections(typeName, [...(sectionsByType[typeName] || []), { id, name: '', parentId: parentId || null, documents: [] }]);
    setEditingSec(id);   // open the new section in rename mode; it becomes plain text once named/blurred
  };
  const removeSection = (typeName, secId, secName) => {
    confirm(
      (t('organisms.confirmRemoveSection') || 'Remove the section “{name}”? Its documents move to Unsorted — they are not deleted.').replace('{name}', secName || '…'),
      () => updateSections(typeName, (sectionsByType[typeName] || []).filter(s => s.id !== secId).map(s => s.parentId === secId ? { ...s, parentId: null } : s)),
      { danger: true, title: t('organisms.removeSection') || 'Remove section' },
    );
  };
  const moveDocToSection = (typeName, docId, targetSecId) => {
    const secs = (sectionsByType[typeName] || []).map(s => ({ ...s, documents: (s.documents || []).filter(d => d !== docId) }));
    if (targetSecId) { const i = secs.findIndex(s => s.id === targetSecId); if (i >= 0) secs[i] = { ...secs[i], documents: [...secs[i].documents, docId] }; }
    updateSections(typeName, secs);
  };
  // Inline rename: update the name locally per keystroke, persist once on blur (no write storm).
  const sectionsRef = useRef(sectionsByType); sectionsRef.current = sectionsByType;
  const setSecName = (typeName, secId, name) =>
    setSectionsByType(s => ({ ...s, [typeName]: (s[typeName] || []).map(x => x.id === secId ? { ...x, name } : x) }));
  const commitSecName = (typeName) => { setEditingSec(null); orgService.saveSections(orgId, wsId, typeName, sectionsRef.current[typeName] || []).catch(err => { swallowed('workspace: commitSecName', err); }); };

  // ── Optional color tags. Section colors live on the section object (persisted via updateSections);
  // per-document/record colors live in a parallel meta.colors map (persisted via saveColors). ──
  const setSectionColor = (typeName, secId, color) =>
    updateSections(typeName, (sectionsByType[typeName] || []).map(s => s.id === secId ? { ...s, color: color || undefined } : s));
  const itemColor = (typeName, id) => (colorsByType[typeName] || {})[id] || null;
  const setItemColor = useCallback((typeName, id, color) => {
    setColorsByType(prev => {
      const m = { ...(prev[typeName] || {}) };
      if (color) m[id] = color; else delete m[id];
      orgService.saveColors(orgId, wsId, typeName, m).catch(e => showToast((e && e.message) || 'Failed to save color'));
      return { ...prev, [typeName]: m };
    });
  }, [orgId, wsId, showToast]);

  const publish = useCallback(async (ot, instanceId) => {
    setBusy(true);
    try {
      const r = await orgService.publishDraft(orgId, wsId, ot.namespace, instanceId);
      if (r?.data?.gated) showToast(t('organisms.publishGated') || 'Sent for review (publish gate is on)');
      else showToast((t('organisms.published') || 'Published') + (r?.data?.version ? ` v${r.data.version}` : ''));
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to publish'); }
    finally { setBusy(false); }
  }, [orgId, wsId, showToast, load]);

  // Reopen a published record for editing: server copies .latest → .draft, then the existing
  // edit → publish flow applies. The published version stays live until the edit is re-published.
  const reopen = useCallback(async (ot, instanceId) => {
    setBusy(true);
    try {
      await orgService.revertToDraft(orgId, wsId, ot.namespace, instanceId);
      showToast(t('organisms.reopened') || 'Reopened for editing');
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to reopen'); }
    finally { setBusy(false); }
  }, [orgId, wsId, showToast, load]);

  // Archive / unarchive ONE record or document instance (read-only + hidden from AI; restorable). The
  // record level archives the whole instance subtree (bare + .draft/.latest/.version.*) by its base key.
  const setRecordArchived = useCallback(async (ot, instanceId, archived) => {
    setBusy(true);
    try {
      const key = `organism.${orgId}.w.${wsId}.${ot.namespace}.${instanceId}`;
      if (archived) await orgService.archiveContent(orgId, { level: 'record', ws: wsId, key });
      else await orgService.unarchiveContent(orgId, { level: 'record', ws: wsId, key });
      showToast(archived ? (t('organisms.recordArchived') || 'Archived') : (t('organisms.recordUnarchived') || 'Restored'));
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed'); }
    finally { setBusy(false); }
  }, [orgId, wsId, showToast, load]);

  const resolve = useCallback(async (aid, decision) => {
    setBusy(true);
    try { await orgService.resolveApproval(orgId, aid, decision); showToast(decision === 'approve' ? (t('organisms.approved') || 'Approved') : (t('organisms.rejected') || 'Rejected')); await load(); }
    catch (e) { showToast((e && e.message) || 'Failed to resolve'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  // Delete a record or document (draft + published + all versions), with a confirm dialog.
  const removeObject = useCallback((namespace, instanceId, label) => {
    confirm(
      (t('organisms.confirmDeleteItem') || 'Delete “{name}”? Its draft, published version and full history are removed. This cannot be undone.').replace('{name}', label || instanceId),
      async () => {
        setBusy(true);
        try { await orgService.deleteWorkspaceObject(orgId, wsId, namespace, instanceId); showToast(t('organisms.deletedItem') || 'Deleted'); await load(); }
        catch (e) { showToast((e && e.message) || 'Failed to delete'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.delete') || 'Delete' },
    );
  }, [orgId, wsId, confirm, showToast, load]);

  const toggleGate = useCallback(async () => {
    setBusy(true);
    try { await orgService.setPublishGate(orgId, !gateOn); setGateOn(!gateOn); showToast(t('organisms.gateToggled') || 'Publish gate updated'); }
    catch (e) { showToast((e && e.message) || 'Failed to update gate'); }
    finally { setBusy(false); }
  }, [orgId, gateOn, showToast]);

  // Populate the settings fields from the manifest when the panel opens (incl. after generation) or
  // fresher data arrives — but only while the user hasn't touched the fields (seededRef compare), so
  // a live-update reload never clobbers typing.
  const seededRef = useRef(null);   // { name, summary, autonomy } last written into the fields
  useEffect(() => {
    if (!showSettings || !ws?.manifest) return;
    const sv = seededRef.current;
    const untouched = !sv || (sName === sv.name && sSummary === sv.summary && sAutonomy === sv.autonomy);
    if (untouched) {
      const next = { name: ws.manifest.name || '', summary: ws.manifest.summary || '', autonomy: ws.manifest.policy?.agentAutonomy || 'L3' };
      setSName(next.name); setSSummary(next.summary); setSAutonomy(next.autonomy);
      seededRef.current = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeds only when the panel opens or ws changes; sName/sSummary/sAutonomy are read via the seededRef untouched-guard and must not re-seed on each keystroke.
  }, [showSettings, ws]);
  // Public sharing lives in its own tab — lazy-load the share state the first time it opens.
  useEffect(() => {
    if (tab === 'share' && share === null && ws?.manifest) loadShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadShare is a stable lazy-loader defined below (adding it would refire every render until share resolves); effect intentionally loads share once when the Share tab first opens.
  }, [tab, ws]);
  // Dirty-check against the manifest: Save enables only on real changes (doubles as the
  // unsaved-changes indicator), Cancel resets the fields, and closing a dirty panel asks first.
  const wsDirty = !!ws?.manifest && (sName !== (ws.manifest.name || '')
    || sSummary !== (ws.manifest.summary || '')
    || sAutonomy !== (ws.manifest.policy?.agentAutonomy || 'L3'));
  const resetSettingsForm = () => {
    const next = { name: ws?.manifest?.name || '', summary: ws?.manifest?.summary || '', autonomy: ws?.manifest?.policy?.agentAutonomy || 'L3' };
    setSName(next.name); setSSummary(next.summary); setSAutonomy(next.autonomy);
    seededRef.current = next;
  };
  const guardWsDirty = (fn) => {
    if (showSettings && wsDirty) confirm(t('organisms.discardChanges') || 'Discard unsaved changes?', () => { resetSettingsForm(); fn(); }, { danger: true });
    else fn();
  };

  const saveSettings = useCallback(async () => {
    setBusy(true);
    try {
      const m = {
        ...ws.manifest,
        name: sName.trim() || ws.manifest.name,
        summary: sSummary.trim(),
        policy: { ...(ws.manifest.policy || {}), agentAutonomy: sAutonomy },
        updatedAt: new Date().toISOString(),
      };
      await orgService.saveManifest(orgId, wsId, m);
      showToast(t('organisms.settingsSaved') || 'Settings saved');
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to save settings'); }
    finally { setBusy(false); }
  }, [ws, sName, sSummary, sAutonomy, orgId, wsId, showToast, load]);

  // Wipe the workspace entirely (all data + schemas). The organism stays → back to "no workspace".
  // The typed-name field already gates the button; this adds a final "are you sure?" dialog.
  const delWorkspace = useCallback(() => {
    confirm(
      t('organisms.confirmDeleteWorkspace') || 'Are you sure you want to delete this workspace? All its documents, records and version history are permanently removed. This cannot be undone.',
      async () => {
        setBusy(true);
        try {
          const r = await orgService.deleteWorkspace(orgId, wsId);
          if (r?.ok === false) { showToast(r?.error?.message || 'Failed to delete'); }
          else {
            showToast(t('organisms.workspaceDeleted') || 'Workspace deleted');
            setShowSettings(false); setDelConfirm(''); setShowRegenerate(false);
            onBack();   // the workspace is gone — return to the organism's workspace list
          }
        } catch (e) { showToast((e && e.message) || 'Failed to delete workspace'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.deleteWorkspace') || 'Delete workspace' },
    );
  }, [orgId, wsId, confirm, showToast, onBack]);

  // Manual add / remove of object spaces (also doable by agents via the memory API).
  const addSpaceHandler = useCallback(async () => {
    if (!newSpaceName.trim() || !ws?.manifest) return;
    setBusy(true);
    try {
      // Manual adds are document spaces ONLY — a record type needs a schema the user can't author
      // by hand; those are designed with AI via Settings → Process (restructure).
      await orgService.addSpace(orgId, wsId, ws.manifest, newSpaceName.trim(), 'document');
      showToast(t('organisms.spaceAdded') || 'Space added');
      setNewSpaceName(''); setShowSpaces(false);
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to add space'); }
    finally { setBusy(false); }
  }, [newSpaceName, ws, wsId, orgId, showToast, load]);

  const removeSpaceHandler = useCallback((typeName) => {
    confirm(
      (t('organisms.confirmRemoveSpace') || 'Remove "{name}" from this workspace? Its data is kept in memory (orphaned) but the section disappears.').replace('{name}', typeName),
      async () => {
        setBusy(true);
        try {
          await orgService.removeSpace(orgId, wsId, ws.manifest, typeName);
          showToast(t('organisms.spaceRemoved') || 'Space removed');
          await load();
        } catch (e) { showToast((e && e.message) || 'Failed to remove space'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.removeSpace') || 'Remove space' },
    );
  }, [ws, orgId, wsId, confirm, showToast, load]);

  // Copy a ready prompt that teaches an AI/agent how to access + use THIS workspace (the MCP gap
  // bridge). 'human' = paste into a chat; 'agent' = imperative, assumes tool access.
  const copyAccessPrompt = useCallback(async (variant) => {
    try {
      const text = await orgService.buildAccessPrompt(orgId, org.name, wsId, ws, variant);
      await copyToClipboard(text);
      showToast(t('organisms.promptCopied') || 'Access prompt copied — paste it to your AI.');
    } catch (e) { showToast((e && e.message) || 'Failed to build prompt'); }
  }, [orgId, org, wsId, ws, showToast]);

  const copyContractPrompt = useCallback(async () => {
    try {
      const text = await orgService.buildContractAgentPrompt(orgId, org.name, wsId, ws);
      await copyToClipboard(text);
      showToast(t('organisms.contractPromptCopied') || 'Contract-agent prompt copied — paste it to your AI / coding agent.');
    } catch (e) { showToast((e && e.message) || 'Failed to build prompt'); }
  }, [orgId, org, wsId, ws, showToast]);

  const back = buildBreadcrumb({ onBack, onBackToList, org, showSettings, guardWsDirty, setShowSettings, wsName, ws });

  if (ws === undefined) return html`<div>${back}<${Spinner} text=${t('organisms.loading') || 'Loading...'} /></div>`;

  if (ws === null) {
    return html`
      <div class="pj-ws">
        ${back}
        <div class="section-title">${(org.name || 'Organism')}</div>
        <div class="section-desc">${t('organisms.noWorkspace') || 'The workspace is created, but it is still empty. Give it a structure: the one-click project template covers goals, plans, deliverables and decisions, or describe below what this workspace is for and an AI designs the structure.'}</div>
        <button class="btn-primary" onClick=${setup} disabled=${busy || genBusy}>${busy ? '...' : (t('organisms.setupWorkspace') || 'Set up workspace (project template)')}</button>
        <${WorkspaceGenerator} orgId=${orgId} wsId=${wsId} showToast=${showToast}
          onApplied=${load} onOpenSettings=${() => setShowSettings(true)} showRegenerate=${false}
          manifest=${null} genBusy=${genBusy} setGenBusy=${setGenBusy} />
      </div>
    `;
  }

  // Lazy-loader for the public-sharing state — kept here (not in the model) because an earlier
  // effect references it. Everything else derived from ws/state lives in buildWorkspaceModel.
  const loadShare = async () => {
    setShareBusy(true);
    try { setShare(await orgService.getWorkspaceShare(orgId, wsId)); } finally { setShareBusy(false); }
  };
  const {
    allTypes, isDocSpace, draftsFor, objectsFor, mergedDocs, mergedRecords, docTypes,
    patchShare, isDocPublic, anythingPublic, copyShareLink, instanceTitle, spaceDesc, groups,
    activeTab, activeSpace, activeGroup, pickTab, openGroup, scrollToSpace, REL_DESC, agentMenuItems,
  } = buildWorkspaceModel({
    ws, share, setShare, setShareBusy, orgId, wsId, showToast, tab, showSettings, approvals, wsT,
    guardWsDirty, setShowSettings, setTab, markSeen, setPendingScroll, copyAccessPrompt, copyContractPrompt,
  });

  // One ctx bag threaded to every extracted render function (doc-space, record-space, overview,
  // panels). Assembled once per render; the parent still owns all hooks/state/callbacks above.
  const rctx = {
    orgId, wsId, org, ws, busy, showArchived, allTypes, wsCanEdit, showToast, load,
    activeDoc, setActiveDoc, expandedSeries, setExpandedSeries, editingSec, setEditingSec,
    expandedRec, setExpandedRec, adding, addingId, addingSchema, addingInitial, draggedDoc,
    sectionsByType, ovOpen, setOvOpen, ovDoc, setOvDoc, wsEvents, wsObjectives,
    share, shareBusy, sharePw, setSharePw, gateOn, showFlow, setShowFlow, showRegenerate, setShowRegenerate,
    delConfirm, setDelConfirm, sName, setSName, sSummary, setSSummary, sAutonomy, setSAutonomy,
    newSpaceName, setNewSpaceName, genBusy, setGenBusy, wsHits, wsSearching, setWsQuery, setWsHits,
    wsSearchCounts, approvals, groups, activeTab, unseenOf, setShowSettings, setShowSpaces,
    mergedDocs, mergedRecords, itemColor, setItemColor, setRecordArchived, removeObject, moveDocToSection,
    setSecName, commitSecName, setSectionColor, addSection, removeSection, spaceDesc, wsT,
    savePage, publish, popOut, reloadComments, cKey, commentsByKey, startAdd, saveDraft, cancelForm,
    draftsFor, objectsFor, toggleExpand, startEdit, reopen, isDocSpace, pickTab, openGroup, scrollToSpace,
    guardWsDirty, saveSettings, wsDirty, resetSettingsForm, removeSpaceHandler, addSpaceHandler, delWorkspace,
    patchShare, isDocPublic, anythingPublic, copyShareLink, docTypes, toggleGate, resolve, instanceTitle,
  };

  return html`
    <div class="pj-ws">
      <${ConfirmUI} />
      ${back}
      <div class="pj-ws-titlerow">
        <span class="section-title pj-ws-title">${(ws.manifest?.name || org.name || 'Workspace')}</span>
        ${showArchived
          ? html`<span class="pj-tab-pill" title=${t('organisms.archivedViewHint') || 'Showing archived (read-only) records — restore one with ♻️'}>${'🗄️ '}${t('organisms.archivedView') || 'Archived view'}</span>`
          : html`<span class="badge badge-success">${(ws.manifest?.status || 'active')}</span>`}
        <span class="pj-ws-head-actions">
          <button class="btn-outline btn-sm ${showArchived ? 'pj-org-btn-active' : ''}" title=${t('organisms.toggleArchivedHint') || 'View/hide archived records'} onClick=${() => setShowArchived(s => !s)}>${showArchived ? `↩ ${t('organisms.viewActive') || 'Active'}` : `🗄️ ${t('organisms.viewArchived') || 'Archived'}`}</button>
          <${KebabMenu} label=${t('organisms.forAgentsHint') || 'Copy a ready prompt that teaches an AI to use this workspace'}
            btnClass="btn-outline btn-sm" trigger=${'🤖 ' + (t('organisms.agentAccess') || 'Agent access') + ' ▾'} items=${agentMenuItems} />
          <button class="btn-outline btn-sm ${showSettings ? 'pj-org-btn-active' : ''}" onClick=${() => guardWsDirty(() => setShowSettings(s => !s))}>${'⚙ '}${t('organisms.settings') || 'Settings'}</button>
        </span>
      </div>
      ${ws.manifest?.summary ? html`<div class="section-desc">${(ws.manifest.summary)}</div>` : null}

      ${wsObjectives.length ? renderObjectives(rctx) : null}

      <${ReadmePanel} markdown=${ws.readme || ''} canEdit=${wsCanEdit} kind="workspace" name=${ws.manifest?.name || 'Workspace'}
        aiPromptSeed=${wsTocSeed} onSave=${saveWsReadme} />

      <${StructureMindmap} scope="workspace" graph=${wsGraph} onNavigate=${onWsMapNav} storageKey=${'ws.' + orgId + '.' + wsId} />

      <${StructureOverview} label=${t('organisms.structureOverviewWs') || 'Workspace structure — table of contents'}
        load=${() => orgService.getWorkspaceOverview(orgId, wsId)} />

      ${approvals.length > 0 && activeTab !== 'review' ? html`
        <div class="pj-ws-banner" role="status">
          <span class="pj-ws-banner-text">
            <b>${(t('organisms.reviewBanner') || '{n} waiting for review').replace('{n}', String(approvals.length))}</b>
            <span class="pj-ws-banner-sub">${t('organisms.reviewBannerSub') || 'Publishes are gated and need a human decision.'}</span>
          </span>
          <button class="btn-outline btn-sm" onClick=${() => setTab('review')}>${t('organisms.reviewQueue') || 'Review queue'}</button>
        </div>` : null}

      <div class="pj-ws-searchbar">
        <${SearchBar} value=${wsQuery} onInput=${e => setWsQuery(e.target.value)}
          placeholder=${t('search.wsPlaceholder') || 'Search this workspace…'} ariaLabel=${t('search.wsPlaceholder') || 'Search this workspace'} />
        ${wsHits !== null ? html`<button class="btn-ghost btn-sm" onClick=${() => { setWsQuery(''); setWsHits(null); }}>${t('search.clear') || 'Clear'}</button>` : null}
      </div>

      ${renderTabsNav(rctx)}

      ${showSpaces ? renderSpacesAdd(rctx) : null}

      ${showSettings ? renderSettingsPanel(rctx) : null}

      ${wsHits !== null ? renderWsSearchResults(rctx) : html`
        ${REL_DESC[activeTab] ? html`<div class="section-desc pj-tab-desc">${REL_DESC[activeTab]}</div>` : null}

        ${activeTab === 'overview' ? renderOverview(rctx) : null}

        ${activeGroup ? html`
          <div class="pj-ov pj-group-view">
            <div class="pj-group-head">
              <div class="section-title">${activeGroup.label}</div>
              ${activeGroup.desc ? html`<div class="section-desc">${activeGroup.desc}</div>` : null}
            </div>
            ${activeGroup.spaces.map(ot => html`
              <div class="pj-group-sec" id=${'ws-sec-' + ot.name} key=${'gs-' + ot.name}>${renderOvSection(rctx, ot)}</div>`)}
            ${activeGroup.spaces.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
          </div>` : null}

        ${activeSpace
          ? (!orgService.isMemorySpace(activeSpace)
            ? renderSpaceNotice(activeSpace)
            : (isDocSpace(activeSpace) ? renderDocSpace(rctx, activeSpace) : renderRecordSpace(rctx, activeSpace)))
          : null}
      `}

      ${activeTab === 'sources' ? html`<${SourcesPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />` : null}

      ${activeTab === 'skills' ? html`<${SkillsPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />` : null}

      ${activeTab === 'share' ? renderShareTab(rctx) : null}

      ${activeTab === 'review' ? renderReviewTab(rctx) : null}

      ${activeTab === 'activity' ? renderActivityTab(rctx) : null}

      ${activeTab === 'people' ? html`<${ParticipantsPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />` : null}
    </div>
  `;
}
