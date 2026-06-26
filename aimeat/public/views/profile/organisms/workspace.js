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
import { Mermaid } from '/components/Mermaid.js';
import { Markdown, slugifyHeading } from '/components/Markdown.js';
import * as orgService from '/js/services/organisms.js';
import { getGhii } from '/js/services/auth.js';
import { copyToClipboard } from '/js/utils.js';
import { recordRecent } from '/js/recents.js';
import { OpenRouterSettings } from '/views/profile/generator-settings.js';
import { fmtDate, relTime } from '/views/profile/organisms/helpers.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { DocumentView, DocumentEditor } from '/views/profile/organisms/document.js';
import { SchemaForm } from '/views/profile/organisms/schema-form.js';
import { WorkspaceComments } from '/views/profile/organisms/workspace-comments.js';
import { ActivityPanel } from '/views/profile/organisms/activity-panel.js';
import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';

/* ───────────────── Organism workspace (manifest-driven) ─────────────────
 * Any organism can have a governed workspace. If it has no manifest yet, offer
 * "Set up workspace" (applies the project template). Otherwise render the
 * manifest's object types with the draft → publish → version loop, the publish
 * gate, the approval inbox, and the decision log. */

const PRIMARY_FIELD = { goal: 'title', plan: 'approach', deliverable: 'title', resource: 'label', decision: 'summary' };

// Optional color tags for sections / documents / records. A small fixed palette of theme tokens
// (kept in CSS as .pj-tag-{key} → --pj-tag) so colors always match the active light/dark theme —
// never a free hex that could clash. null/absent = no color (the default, neutral).
const TAG_PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

// A dot that opens an inline swatch palette; picking a color (or ∅) calls onPick(key|null) and closes.
// Self-contained so it can sit in a section head, a document row or a record row alike.
function ColorPicker({ value, onPick, title }) {
  const [open, setOpen] = useState(false);
  return html`
    <span class="pj-cp">
      <button class="pj-cp-dot ${value ? 'pj-colored pj-tag-' + value : 'pj-cp-empty'}" title=${title || (t('organisms.color') || 'Color')}
        onClick=${(e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}></button>
      ${open ? html`
        <span class="pj-cp-pop" onMouseLeave=${() => setOpen(false)}>
          <button class="pj-cp-sw pj-cp-none" title=${t('organisms.noColor') || 'No color'}
            onClick=${(e) => { e.stopPropagation(); e.preventDefault(); onPick(null); setOpen(false); }}>∅</button>
          ${TAG_PALETTE.map(c => html`<button key=${c} class="pj-cp-sw pj-colored pj-tag-${c}"
            onClick=${(e) => { e.stopPropagation(); e.preventDefault(); onPick(c); setOpen(false); }}></button>`)}
        </span>` : null}
    </span>`;
}

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
    }).catch(() => {});
    return () => { cancelled = true; };
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
  const [genDesc, setGenDesc] = useState('');
  const [genBusy, setGenBusy] = useState(false);     // AI "Generate" in flight
  const [applyBusy, setApplyBusy] = useState(false); // "Validate & apply" (pasted JSON) in flight
  const [hasAiKey, setHasAiKey] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [genErrors, setGenErrors] = useState([]);   // validation errors (JSON present, fixable)
  const [genFail, setGenFail] = useState('');        // generation failure (AI call timed out / errored)
  // { type, mode:'view'|'edit', page } for document-mode types. Restored from sessionStorage on F5
  // so the user returns to the document they were on (only the id is kept; renderDocSpace re-resolves
  // it to the live entry once the workspace loads).
  const docKey = 'aimeat.ws.' + orgId + '.' + wsId + '.activeDoc';
  const [activeDoc, setActiveDoc] = useState(() => {
    try {
      const raw = sessionStorage.getItem(docKey);
      if (raw) { const v = JSON.parse(raw); if (v && v.type && v.id) return { type: v.type, mode: v.mode === 'edit' ? 'edit' : 'view', page: { id: v.id } }; }
    } catch (e) { /* noop */ }
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
  const [share, setShare] = useState(null);                   // { public, spaces, docs } — lazy-loaded when Settings opens
  const [shareBusy, setShareBusy] = useState(false);
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
    try { const raw = localStorage.getItem(seenKey); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  });
  const markSeen = useCallback((tabId) => setSeen(prev => {
    const next = { ...(prev || {}), [tabId]: new Date().toISOString() };
    try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch (e) { /* noop */ }
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
    const w = await orgService.getWorkspace(orgId, wsId, showArchived ? { archived: 'only' } : undefined).catch(() => null);
    if (w && w.manifest) {
      const [ap, cfg, secs, act, cols] = await Promise.all([
        orgService.listApprovals(orgId, 'pending').catch(() => []),
        orgService.getConfig(orgId).catch(() => ({})),
        orgService.getAllSections(orgId, wsId).catch(() => ({})),
        orgService.getWorkspaceActivity(orgId, wsId).catch(() => ({ events: [] })),
        orgService.getAllColors(orgId, wsId).catch(() => ({})),
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
        orgService.getWorkspaceGraph(orgId, wsId).catch(() => null),
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
      const r = await orgService.searchOrganism(orgId, q, wsId).catch(() => null);
      if (!cancelled) { setWsHits((r?.data?.results) || []); setWsSearching(false); }
    }, 220);   // debounce — instant feel without a request per keystroke
    return () => { cancelled = true; clearTimeout(tid); };
  }, [wsQuery, orgId, wsId]);
  const wsSearchCounts = wsHits ? wsHits.reduce((m, h) => { m[h.space] = (m[h.space] || 0) + 1; return m; }, {}) : null;
  // One-shot: the command palette (Cmd-K) can pre-fill this workspace's search so you land on the
  // filtered result list for the query you jumped from.
  useEffect(() => {
    const k = `aimeat.ws.${orgId}.${wsId}.search`;
    try { const v = sessionStorage.getItem(k); if (v) { setWsQuery(v); sessionStorage.removeItem(k); } } catch { /* noop */ }
  }, [orgId, wsId]);

  // Deep-link from the librarian "Open" button: aimeat.ws.{org}.{ws}.openDoc = { namespace, id }.
  // Once the manifest is loaded we resolve the namespace → object-type name, open that space tab and
  // its document, then clear the key (one-shot).
  const openDocKey = 'aimeat.ws.' + orgId + '.' + wsId + '.openDoc';
  useEffect(() => {
    if (!ws?.manifest) return;
    let req = null;
    try { req = JSON.parse(sessionStorage.getItem(openDocKey) || 'null'); } catch (e) { req = null; }
    if (!req || !req.namespace || !req.id) return;
    const ot = (ws.manifest.objectTypes || []).find(o => o.namespace === req.namespace);
    if (ot) { setTab('space:' + ot.name); setActiveDoc({ type: ot.name, mode: 'view', page: { id: req.id } }); }
    try { sessionStorage.removeItem(openDocKey); } catch (e) { /* noop */ }
  }, [ws, openDocKey]);

  // Persist the open document (id only) so an F5 returns to it. Skip unsaved new docs (no id yet).
  useEffect(() => {
    try {
      if (activeDoc?.type && activeDoc.page?.id) sessionStorage.setItem(docKey, JSON.stringify({ type: activeDoc.type, id: activeDoc.page.id, mode: activeDoc.mode }));
      else sessionStorage.removeItem(docKey);
    } catch (e) { /* noop */ }
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
    try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch (e) { /* noop */ }
    setSeen(next);
  }, [seen, ws]);
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
  }, [orgId, org, showToast, load]);

  // Validate the JSON first; save only if clean. On errors, surface them (+ a fix prompt for the AI).
  const validateAndApply = useCallback(async (jsonText, fromGenerator) => {
    setGenErrors([]); setGenFail('');
    let generated;
    try { generated = orgService.parseGenerated(jsonText); }
    catch (e) { setGenErrors([(e && e.message) || 'Invalid JSON']); return; }
    const errs = orgService.validateGenerated(generated);
    if (errs.length) { setGenErrors(errs); return; }
    // The Generate flow owns genBusy; a direct paste-apply spins its own button only.
    const setBusyFn = fromGenerator ? setGenBusy : setApplyBusy;
    setBusyFn(true);
    try {
      await orgService.applyGeneratedWorkspace(orgId, wsId, generated);
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      if (fromGenerator) setShowSettings(true);   // open settings so the user can tweak the generated workspace
      await load();
    } catch (e) { setGenErrors([(e && e.message) || (t('organisms.applyError') || 'Could not apply — check the JSON.')]); }
    finally { setBusyFn(false); }
  }, [orgId, showToast, load]);

  const generate = useCallback(async () => {
    if (!genDesc.trim()) return;
    setGenBusy(true); setGenErrors([]); setGenFail('');
    try {
      const raw = await orgService.generateRaw(genDesc.trim(), showRegenerate ? ws?.manifest : null);
      setPasteText(raw);                  // show the generated JSON in the box
      await validateAndApply(raw, true);
    } catch (e) {
      setGenFail(e?.code === 'NO_API_KEY'
        ? (t('organisms.noAiKey') || 'Set up your OpenRouter key above, or copy the prompt to your own AI chat.')
        : ((e && e.message) || (t('organisms.generateError') || 'Generation failed')));
    } finally { setGenBusy(false); }
  }, [genDesc, validateAndApply, showRegenerate, ws]);

  const copyPrompt = useCallback(async () => {
    try {
      await copyToClipboard(await orgService.buildGeneratorPrompt(genDesc.trim(), showRegenerate ? ws?.manifest : null));
      showToast(t('organisms.promptCopied') || 'Prompt copied — paste it into any AI chat, then paste the JSON it returns below.');
    } catch (e) { showToast((e && e.message) || 'Failed to copy'); }
  }, [genDesc, showToast, showRegenerate, ws]);

  const applyPasted = useCallback(() => { if (pasteText.trim()) validateAndApply(pasteText, false); }, [pasteText, validateAndApply]);

  const copyFixPrompt = useCallback(async () => {
    try {
      await copyToClipboard(orgService.buildFixPrompt(pasteText, genErrors));
      showToast(t('organisms.fixPromptCopied') || 'Fix prompt copied — paste it back to your AI, then paste the corrected JSON.');
    } catch (e) { showToast((e && e.message) || 'Failed to copy'); }
  }, [pasteText, genErrors, showToast]);

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
  // Render ONE field value, type-aware + left-aligned + wrapping. Strings that look like markdown (or
  // are multi-line) render through the safe Markdown component; plain strings wrap as text; arrays
  // become a bullet list; objects pretty-print in a wrapped <pre>. (Was a right-aligned KeyValueRow
  // with everything String()'d onto one line — unreadable for real record data.)
  const looksMarkdown = (s) => /\n/.test(s) || /(^|\s)[-*]\s/.test(s) || /[#`>|]|\[[^\]]+\]\(|\*\*/.test(s);
  const renderFieldVal = (v) => {
    if (Array.isArray(v)) {
      return html`<ul class="pj-rec-field-list">${v.map((it, i) => html`<li key=${i}>${
        (it && typeof it === 'object') ? html`<pre class="pj-rec-json">${JSON.stringify(it, null, 2)}</pre>` : String(it)
      }</li>`)}</ul>`;
    }
    if (v && typeof v === 'object') return html`<pre class="pj-rec-json">${JSON.stringify(v, null, 2)}</pre>`;
    if (typeof v === 'string') {
      return looksMarkdown(v)
        ? html`<div class="pj-rec-md"><${Markdown} text=${v} /></div>`
        : html`<span class="pj-rec-field-text">${v}</span>`;
    }
    return html`<span class="pj-rec-field-text">${String(v)}</span>`;
  };
  const recordFields = (ot, rec) => {
    const rows = Object.entries(rec || {}).filter(([k, v]) =>
      !k.startsWith('_') && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    if (!rows.length) return html`<div class="pj-muted pj-rec-empty">${t('organisms.noFields') || 'No fields'}</div>`;
    return rows.map(([k, v]) => html`<div class="pj-rec-field" key=${k}>
      <div class="pj-rec-field-label">${wsT(`${ot.namespace}.${k}`) || k}</div>
      <div class="pj-rec-field-val">${renderFieldVal(v)}</div>
    </div>`);
  };

  const saveDraft = useCallback(async (ot, value) => {
    const id = (String(value.id || '').trim() || `${ot.name}-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, wsId, ot.namespace, id, { ...value, id });
      if (r?.ok === false) { showToast(r?.error?.message || 'Draft rejected'); }
      else { showToast(t('organisms.draftSaved') || 'Draft saved'); setAdding(null); setAddingSchema(null); await load(); }
    } catch (e) { showToast((e && e.message) || 'Failed to save draft'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

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
          await orgService.saveSections(orgId, wsId, ot.name, secs).catch(() => {});
        }
        // Reload, then open the just-saved document (view mode). renderDocSpace re-resolves the id
        // to the fresh merged entry, so the new draft shows with its badge instead of the empty state.
        showToast(t('organisms.pageSaved') || 'Document saved'); await load(); setActiveDoc({ type: ot.name, mode: 'view', page: { id } });
      }
    } catch (e) { showToast((e && e.message) || 'Failed to save document'); }
    finally { setBusy(false); }
  }, [orgId, sectionsByType, showToast, load]);

  // ── Section index ops (persist organism.{id}.meta.sections.{typeName}) ──
  const updateSections = useCallback(async (typeName, sections) => {
    setSectionsByType(s => ({ ...s, [typeName]: sections }));
    await orgService.saveSections(orgId, wsId, typeName, sections).catch(e => showToast((e && e.message) || 'Failed to save sections'));
  }, [orgId, showToast]);
  const addSection = (typeName, parentId) => {
    const id = 'sec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    updateSections(typeName, [...(sectionsByType[typeName] || []), { id, name: '', parentId: parentId || null, documents: [] }]);
    setEditingSec(id);   // open the new section in rename mode; it becomes plain text once named/blurred
  };
  const renameSection = (typeName, secId, name) =>
    updateSections(typeName, (sectionsByType[typeName] || []).map(s => s.id === secId ? { ...s, name } : s));
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
  const commitSecName = (typeName) => { setEditingSec(null); orgService.saveSections(orgId, wsId, typeName, sectionsRef.current[typeName] || []).catch(() => {}); };

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
  }, [orgId, showToast, load]);

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
  }, [showSettings, ws]);
  // Public sharing lives in its own tab — lazy-load the share state the first time it opens.
  useEffect(() => {
    if (tab === 'share' && share === null && ws?.manifest) loadShare();
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
  }, [ws, sName, sSummary, sAutonomy, orgId, showToast, load]);

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
  }, [orgId, confirm, showToast, load]);

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
  }, [ws, orgId, confirm, showToast, load]);

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

  // The AI / paste generator — reused for a fresh workspace AND for "restructure" (where, via
  // showRegenerate, generate/copyPrompt pass the current manifest so the AI EXTENDS it additively).
  const renderGenerator = () => html`
    <div class="pj-section">
      <div class="pj-section-title">${showRegenerate ? (t('organisms.restructureTitle') || 'Restructure / add types with AI') : (t('organisms.generateTitle') || 'Or generate a custom workspace with AI')}</div>
      <div class="section-desc">${showRegenerate
        ? (t('organisms.restructureDesc') || 'Describe what to add or change. Existing types and their data are kept — the AI extends the current structure. (To start completely fresh, delete the workspace below first.)')
        : (t('organisms.generateDesc') || 'Describe what you want to track — the AI designs the object types. Use your OpenRouter key for one-click generation, or copy the prompt into any AI chat (free) and paste the result back.')}</div>

      <textarea class="input-field input-sm" rows="3"
        placeholder=${t('organisms.generatePlaceholder') || 'e.g. A research study tracking hypotheses, experiments and validated findings'}
        value=${genDesc} onInput=${e => setGenDesc(e.target.value)}></textarea>

      <${OpenRouterSettings} onSettingsChange=${s => setHasAiKey(!!(s && s.hasApiKey))} />

      <div class="form-actions">
        ${hasAiKey ? html`
          <button class="btn-primary btn-sm" onClick=${generate} disabled=${genBusy || !genDesc.trim()}>
            ${genBusy ? html`<span class="spinner"></span> ${t('organisms.generating') || 'Generating…'}` : (t('organisms.generate') || 'Generate with AI')}
          </button>
        ` : null}
        <button class="btn-outline btn-sm" onClick=${copyPrompt} disabled=${!genDesc.trim()}>${t('organisms.copyPrompt') || 'Copy prompt'}</button>
      </div>

      <div class="section-desc">${t('organisms.pasteHelp') || 'No key? Copy the prompt above into any AI chat, then paste the JSON it returns here:'}</div>
      <textarea class="input-field input-sm" rows="4"
        placeholder=${t('organisms.pastePlaceholder') || 'Paste the AI JSON response here'}
        value=${pasteText} onInput=${e => setPasteText(e.target.value)}></textarea>

      ${genFail && html`
        <div class="pj-errors">
          <div class="pj-errors-title">${t('organisms.genFailed') || 'Generation failed — try again'}</div>
          <div class="pj-error-line">${(genFail)}</div>
        </div>
      `}

      ${genErrors.length > 0 && html`
        <div class="pj-errors">
          <div class="pj-errors-title">${t('organisms.fixNeeded') || 'This needs fixing before it can be saved:'}</div>
          ${genErrors.map((e, i) => html`<div class="pj-error-line" key=${i}>${(e)}</div>`)}
          <div class="form-actions">
            <button class="btn-outline btn-sm" onClick=${copyFixPrompt}>${t('organisms.copyFixPrompt') || 'Copy fix prompt for the AI'}</button>
          </div>
        </div>
      `}

      <div class="form-actions">
        <button class="btn-primary btn-sm" onClick=${applyPasted} disabled=${applyBusy || !pasteText.trim()}>
          ${applyBusy ? html`<span class="spinner"></span> ` : ''}${t('organisms.applyPasted') || 'Validate & apply'}
        </button>
      </div>
    </div>
  `;

  // Same breadcrumb pattern as the organism home: Organisms / {org} / {workspace} — both ancestors
  // are links, so the list is one click away from inside a workspace too.
  const back = html`
    <div class="pj-org-breadcrumb">
      <button class="pj-org-crumb-link" onClick=${onBackToList || onBack}>${t('organisms.title') || 'Organisms'}</button>
      <span class="pj-org-crumb-sep">/</span>
      <button class="pj-org-crumb-link" onClick=${onBack}>${(org.name || org.id || '')}</button>
      <span class="pj-org-crumb-sep">/</span>
      ${showSettings ? html`
        <button class="pj-org-crumb-link" onClick=${() => guardWsDirty(() => setShowSettings(false))}>${(wsName || ws?.manifest?.name || '…')}</button>
        <span class="pj-org-crumb-sep">/</span>
        <span>${t('organisms.settings') || 'Settings'}</span>
      ` : html`<span>${(wsName || ws?.manifest?.name || '…')}</span>`}
    </div>`;

  if (ws === undefined) return html`<div>${back}<${Spinner} text=${t('organisms.loading') || 'Loading...'} /></div>`;

  if (ws === null) {
    return html`
      <div class="pj-ws">
        ${back}
        <div class="section-title">${(org.name || 'Organism')}</div>
        <div class="section-desc">${t('organisms.noWorkspace') || 'This organism has no workspace yet. Set one up to track goals, plans, deliverables and decisions — versioned on publish.'}</div>
        <button class="btn-primary" onClick=${setup} disabled=${busy || genBusy}>${busy ? '...' : (t('organisms.setupWorkspace') || 'Set up workspace (project template)')}</button>
        ${renderGenerator()}
      </div>
    `;
  }

  // Memory-backed spaces render normally (missing backing counts as memory — the shared service
  // predicate mirrors the server's). Every OTHER declared space still renders, as a notice card — a
  // space the manifest declares must never silently vanish from the view (that's how published
  // documents once became unfindable: writes succeeded, every list surface skipped the space).
  const allTypes = ws.manifest?.objectTypes || [];
  const types = allTypes.filter(orgService.isMemorySpace);
  const isDocSpace = orgService.isDocSpace;
  const draftsFor = (name) => (ws.drafts && ws.drafts[name]) || [];
  const objectsFor = (name) => (ws.objects && ws.objects[name]) || [];
  // One entry per id, draft (working copy) taking precedence over its published version —
  // the index must show the draft badge even when a published `.latest` also exists.
  const mergedDocs = (ot) => {
    const byId = new Map();
    for (const d of objectsFor(ot.name)) byId.set(d.id, { ...d, _draft: false, _published: true });
    for (const d of draftsFor(ot.name)) {
      const pub = byId.get(d.id);   // kept on `_pub` for the view's Draft/Published toggle
      byId.set(d.id, { ...d, _draft: true, _published: !!pub, _pub: pub || null });
    }
    return [...byId.values()];
  };
  const mergedRecords = (ot) => {
    const byId = new Map();
    for (const o of objectsFor(ot.name)) byId.set(o.id, { ...o, _draft: false });
    for (const d of draftsFor(ot.name)) byId.set(d.id, { ...d, _draft: true });
    return [...byId.values()];
  };

  // ── Public sharing (meta.share) — what published document-space pages anyone can read via the
  // no-login viewer. Independent of the access roles. Lazy-loaded the first time the panel opens. ──
  const docTypes = types.filter(isDocSpace);
  const loadShare = async () => {
    setShareBusy(true);
    try { setShare(await orgService.getWorkspaceShare(orgId, wsId)); } finally { setShareBusy(false); }
  };
  const patchShare = async (patch) => {
    setShareBusy(true);
    try { setShare(await orgService.setWorkspaceShare(orgId, wsId, patch)); }
    catch (e) { showToast((e && e.message) || (t('organisms.shareFailed') || 'Failed to update sharing')); }
    finally { setShareBusy(false); }
  };
  // Effective public state of one doc — mirrors the backend: doc override → space flag → workspace flag.
  const isDocPublic = (typeName, id) => {
    if (!share) return false;
    const dk = `${typeName}/${id}`;
    if (Object.prototype.hasOwnProperty.call(share.docs || {}, dk)) return !!share.docs[dk];
    if (Object.prototype.hasOwnProperty.call(share.spaces || {}, typeName)) return !!share.spaces[typeName];
    return !!share.public;
  };
  const anythingPublic = () => !!share && (!!share.public
    || Object.values(share.spaces || {}).some(Boolean) || Object.values(share.docs || {}).some(Boolean));
  const copyShareLink = async (url) => {
    try { await navigator.clipboard.writeText(window.location.origin + url); showToast(t('organisms.linkCopied') || 'Link copied'); }
    catch { showToast(t('organisms.copyFailed') || 'Copy failed'); }
  };

  // Resolve an activity-feed event's instance id to a human title (document title / record primary
  // field), so the feed reads "published · Techstack-matriisi" instead of "published · doc-76qchtb".
  // Falls back to the id when the item isn't in the loaded set (deleted, or not readable).
  const instanceTitle = (typeName, id) => {
    const rec = [...objectsFor(typeName), ...draftsFor(typeName)].find(x => x.id === id);
    if (!rec) return id;
    return rec.title || rec.label || rec.summary || rec.name || rec[PRIMARY_FIELD[typeName]] || id;
  };

  // ── Series niputus: collapse multi-part documents ("Foo — osa 2", "Foo — part 3") under one
  // expandable parent so a 4-part doc reads as ONE line, not four near-identical ones. PURELY a
  // display grouping — it never touches the stored sections or the documents themselves. The base
  // title is whatever precedes a trailing "— osa N / part N / #N"; a document with no such suffix is
  // its own base (so the lead "Foo" groups with "Foo — osa 2/3"). Only bases with ≥2 members collapse.
  const seriesParse = (title) => {
    const m = /^(.*?)[\s—–-]+(?:osa|part|pt\.?|#)\s*(\d+)\s*$/i.exec(String(title || ''));
    return (m && m[1].trim()) ? { base: m[1].trim(), part: parseInt(m[2], 10) } : { base: String(title || '').trim(), part: 0 };
  };
  const groupDocs = (list) => {
    const map = new Map(); const order = [];
    for (const d of list) {
      const { base, part } = seriesParse(d.title || d.label || d.id || '');
      const k = base.toLowerCase();
      if (!map.has(k)) { map.set(k, { base, parts: [] }); order.push(k); }
      map.get(k).parts.push({ ...d, _part: part });
    }
    return order.map(k => {
      const g = map.get(k);
      if (g.parts.length < 2) return { single: g.parts[0] };
      g.parts.sort((a, b) => a._part - b._part);
      return { base: g.base, parts: g.parts };
    });
  };

  // A document-space: left index (section tree + documents, with an Unsorted group) + a main
  // area showing the active document (view/edit). Sections nest via parentId; documents are
  // tied to a section's documents[] (or unsorted). Edits to the tree persist immediately.
  const renderDocSpace = (ot) => {
    const secs = sectionsByType[ot.name] || [];
    const docs = mergedDocs(ot);
    const docById = {}; docs.forEach(d => { docById[d.id] = d; });
    const used = new Set(); secs.forEach(s => (s.documents || []).forEach(id => used.add(id)));
    const unsorted = docs.filter(d => !used.has(d.id));
    const childrenOf = (pid) => secs.filter(s => (s.parentId || null) === (pid || null));
    const isActive = (d) => activeDoc?.type === ot.name && activeDoc.page?.id === d.id;

    const docItem = (d) => html`
      <div class="pj-doc-item ${isActive(d) ? 'active' : ''} ${itemColor(ot.name, d.id) ? 'pj-colored pj-tag-' + itemColor(ot.name, d.id) : ''}" key=${'di' + d.id}
        draggable=${true}
        onDragStart=${(e) => { draggedDoc.current = { type: ot.name, id: d.id }; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch (x) { /* noop */ } } }}
        onDragEnd=${() => { draggedDoc.current = null; }}>
        <span class="pj-grip" title=${t('organisms.dragHint') || 'Drag into a section'}>⠿</span>
        <${ColorPicker} value=${itemColor(ot.name, d.id)} onPick=${(c) => setItemColor(ot.name, d.id, c)} />
        <button class="pj-doc-link" onClick=${() => setActiveDoc({ type: ot.name, mode: 'view', page: d })}>
          ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span> ` : ''}${d.title || d.id}
        </button>
        ${showArchived
          ? html`<button class="pj-icon-btn" title=${t('organisms.unarchive') || 'Unarchive'} disabled=${busy} onClick=${() => setRecordArchived(ot, d.id, false)}>♻️</button>`
          : html`<button class="pj-icon-btn" title=${t('organisms.archive') || 'Archive'} disabled=${busy} onClick=${() => setRecordArchived(ot, d.id, true)}>🗄️</button>`}
        <button class="pj-icon-btn pj-doc-del" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, d.id, d.title || d.id)}>🗑</button>
      </div>`;

    // A section is a drop target — dragging a document onto it (or its header) files it here.
    const dropOn = (secId) => (e) => { e.preventDefault(); e.stopPropagation(); if (draggedDoc.current?.type === ot.name) { moveDocToSection(ot.name, draggedDoc.current.id, secId); draggedDoc.current = null; } };
    const allowDrop = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };

    // Render a document list with multi-part series collapsed (see groupDocs). A series auto-opens
    // when the active document is one of its parts; otherwise it toggles on the header click.
    const renderDocList = (list) => groupDocs(list).map((g) => {
      if (g.single) return docItem(g.single);
      const key = ot.name + ':' + g.base;
      const open = g.parts.some(isActive) || !!expandedSeries[key];
      return html`
        <div class="pj-doc-series ${open ? 'open' : ''}" key=${'ser-' + g.base}>
          <button class="pj-doc-series-head" onClick=${() => setExpandedSeries(s => ({ ...s, [key]: !open }))}>
            <span class="pj-ov-chevron">${open ? '▾' : '▸'}</span>
            <span class="pj-doc-series-name">${g.base}</span>
            <span class="pj-org-tab-count">${g.parts.length}</span>
            ${g.parts.some(p => p._draft) ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
          </button>
          ${open ? html`<div class="pj-doc-series-parts">${g.parts.map(docItem)}</div>` : null}
        </div>`;
    });

    const renderSection = (sec) => html`
      <div class="pj-sec ${sec.color ? 'pj-colored pj-tag-' + sec.color : ''}" key=${sec.id} onDragOver=${allowDrop} onDrop=${dropOn(sec.id)}>
        <div class="pj-sec-head">
          <${ColorPicker} value=${sec.color} onPick=${(c) => setSectionColor(ot.name, sec.id, c)} />
          ${editingSec === sec.id
            ? html`<input class="input-field input-xs pj-sec-name" autofocus placeholder=${t('organisms.sectionName') || 'Section name'}
                value=${sec.name} onInput=${e => setSecName(ot.name, sec.id, e.target.value)}
                onBlur=${() => commitSecName(ot.name)} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`
            : html`<span class="pj-sec-name-text" onDblClick=${() => setEditingSec(sec.id)}>${(sec.name || t('organisms.unnamed') || '(unnamed)')}</span>`}
          <button class="pj-icon-btn" title=${t('organisms.rename') || 'Rename'} onClick=${() => setEditingSec(sec.id)}>✎</button>
          <button class="pj-icon-btn" title=${t('organisms.newDocHere') || 'New document here'} onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' }, sectionId: sec.id })}>+</button>
          <button class="pj-icon-btn" title=${t('organisms.addSubsection') || 'Sub-section'} onClick=${() => addSection(ot.name, sec.id)}>⊕</button>
          <button class="pj-icon-btn" title=${t('organisms.remove') || 'Remove'} onClick=${() => removeSection(ot.name, sec.id, sec.name)}>✕</button>
        </div>
        ${renderDocList((sec.documents || []).map(id => docById[id]).filter(Boolean))}
        ${childrenOf(sec.id).map(renderSection)}
      </div>`;

    return html`
      <div class="pj-section" key=${ot.name}>
        <div class="pj-section-head">
          <span class="pj-section-title">${(wsT('type.' + ot.name) || ot.name)}<span class="pj-doc-tag">${t('organisms.docs') || 'docs'}</span></span>
          <button class="btn-outline btn-sm" onClick=${() => addSection(ot.name, null)}>${'+ '}${t('organisms.section') || 'Section'}</button>
          <button class="btn-outline btn-sm" onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } })}>${'+ '}${t('organisms.newPage') || 'New document'}</button>
        </div>
        ${spaceDesc(ot) ? html`<div class="section-desc">${spaceDesc(ot)}</div>` : null}
        <div class="pj-docspace">
          <div class="pj-doc-index">
            ${childrenOf(null).map(renderSection)}
            ${unsorted.length > 0 ? html`
              <div class="pj-sec" onDragOver=${allowDrop} onDrop=${dropOn(null)}><div class="pj-sec-head"><span class="pj-sec-name pj-muted">${t('organisms.unsorted') || 'Unsorted'}</span></div>${renderDocList(unsorted)}</div>` : null}
            ${docs.length === 0 && secs.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
          </div>
          <div class="pj-doc-main">
            ${(() => {
              if (activeDoc?.type !== ot.name) return html`<${EmptyState} icon="📄" text=${t('organisms.selectDoc') || 'Select a document, or create one.'} />`;
              // Re-resolve the open document against the freshly-loaded list by id, so after a save (or
              // a live-update / F5 restore that only kept the id) the view shows the current draft —
              // with its correct draft badge, published copy, and Draft/Published toggle.
              const livePage = (activeDoc.page && activeDoc.page.id && docById[activeDoc.page.id]) || activeDoc.page;
              if (activeDoc.mode === 'edit') return html`
                <${DocumentEditor} key=${'ed-' + (livePage.id || 'new')} orgId=${orgId} page=${livePage} busy=${busy} onSave=${(p) => savePage(ot, p, activeDoc.sectionId)} onCancel=${() => setActiveDoc(null)} />`;
              return html`
                <${DocumentView} key=${'view-' + livePage.id} page=${livePage} busy=${busy}
                  onEdit=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: livePage })}
                  onPublish=${() => publish(ot, livePage.id)}
                  onPopOut=${() => popOut(ot.name, livePage.id)}
                  onWikiLink=${(content) => {
                    const [titlePart, headingPart] = String(content).split('#');
                    const title = titlePart.trim();
                    const anchor = (headingPart || '').trim();
                    const scrollToAnchor = () => { if (anchor) setTimeout(() => { const el = document.querySelector('.pj-doc-view [id="' + slugifyHeading(anchor) + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); };
                    if (!title) { scrollToAnchor(); return; }   // [[#Heading]] → jump within the current document
                    const target = docs.find(d => (d.title || '').toLowerCase() === title.toLowerCase());
                    if (target) { setActiveDoc({ type: ot.name, mode: 'view', page: target }); scrollToAnchor(); }
                    else showToast((t('organisms.docNotFound') || 'No document titled “{title}”').replace('{title}', title));
                  }} />
                <${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${livePage.id} showToast=${showToast}
                  batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, livePage.id)]} onReload=${reloadComments} />`;
            })()}
          </div>
        </div>
      </div>`;
  };

  // A record-space tab: schema-form add/edit + draft and published record lists (with comments).
  const renderRecordSpace = (ot) => html`
    <div class="pj-section" key=${ot.name}>
      <div class="pj-section-head">
        <span class="pj-section-title">${(wsT('type.' + ot.name) || ot.name)}</span>
        ${ot.append ? null : html`<button class="btn-outline btn-sm" onClick=${() => startAdd(ot)}>${'+ '}${t('organisms.addDraft') || 'Add draft'}</button>`}
      </div>
      ${spaceDesc(ot) ? html`<div class="section-desc">${spaceDesc(ot)}</div>` : null}

      ${adding === ot.name && !addingId && (addingSchema
        ? html`<div class="pj-rec-edit pj-rec-edit-new">${html`<${SchemaForm} key=${'sf-new'} schema=${addingSchema} busy=${busy} initial=${addingInitial}
            idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
            onSave=${(v) => saveDraft(ot, v)} onCancel=${cancelForm} />`}</div>`
        : html`<${Spinner} />`)}

      ${draftsFor(ot.name).map((d, i) => html`
        <div class="pj-rec ${itemColor(ot.name, d.id) ? 'pj-colored pj-tag-' + itemColor(ot.name, d.id) : ''}" key=${'d' + i}>
          <div class="pj-item pj-item-draft">
            <${ColorPicker} value=${itemColor(ot.name, d.id)} onPick=${(c) => setItemColor(ot.name, d.id, c)} />
            <span class="badge badge-warn">${t('organisms.draft') || 'draft'}</span>
            <button class="pj-rec-title" onClick=${() => toggleExpand(ot, d.id)}>${String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id || '')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => startEdit(ot, d)} disabled=${busy}>${t('organisms.edit') || 'Edit'}</button>
            <button class="btn-primary btn-sm" onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>
            <button class="pj-icon-btn" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, d.id, String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id))}>🗑</button>
          </div>
          ${adding === ot.name && addingId === d.id
            ? html`<div class="pj-rec-edit">${addingSchema
                ? html`<${SchemaForm} key=${'sf-' + d.id} schema=${addingSchema} busy=${busy} initial=${addingInitial}
                    idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
                    onSave=${(v) => saveDraft(ot, { ...v, id: addingId })} onCancel=${cancelForm} />`
                : html`<${Spinner} />`}</div>`
            : (expandedRec[ot.name + ':' + d.id] ? html`<div class="pj-rec-fields">${recordFields(ot, d)}</div><${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${d.id} showToast=${showToast} batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, d.id)]} onReload=${reloadComments} />` : null)}
        </div>
      `)}

      ${objectsFor(ot.name).length === 0 && draftsFor(ot.name).length === 0
        ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />`
        : objectsFor(ot.name).map((o, i) => html`
          <div class="pj-rec ${itemColor(ot.name, o.id) ? 'pj-colored pj-tag-' + itemColor(ot.name, o.id) : ''}" key=${'o' + i}>
            <div class="pj-item">
              <${ColorPicker} value=${itemColor(ot.name, o.id)} onPick=${(c) => setItemColor(ot.name, o.id, c)} />
              <button class="pj-rec-title" onClick=${() => toggleExpand(ot, o.id)}>${String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.summary || o.id || '')}</button>
              ${o.status ? html`<span class="badge badge-info">${(o.status)}</span>` : null}
              ${!showArchived && !draftsFor(ot.name).some(dr => dr.id === o.id) ? html`
                <button class="btn-ghost btn-sm" title=${t('organisms.reopenEditHint') || 'Reopen for editing — creates an editable draft from the published version'} disabled=${busy} onClick=${() => reopen(ot, o.id)}>${t('organisms.edit') || 'Edit'}</button>` : null}
              ${showArchived
                ? html`<button class="btn-ghost btn-sm" title=${t('organisms.unarchive') || 'Unarchive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, false)}>${'♻️ '}${t('organisms.unarchive') || 'Unarchive'}</button>`
                : html`<button class="pj-icon-btn" title=${t('organisms.archive') || 'Archive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, true)}>🗄️</button>`}
              <button class="pj-icon-btn" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, o.id, String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.id))}>🗑</button>
            </div>
            ${expandedRec[ot.name + ':' + o.id] ? html`<div class="pj-rec-fields">${recordFields(ot, o)}</div><${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${o.id} showToast=${showToast} batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, o.id)]} onReload=${reloadComments} />` : null}
          </div>
        `)
      }
    </div>`;

  // A declared space whose backing isn't memory — never silently hidden, its tab shows a notice.
  const renderSpaceNotice = (ot) => html`
    <div class="pj-section" key=${ot.name}>
      <div class="pj-section-head">
        <span class="pj-section-title">${(ot.name)}</span>
        <span class="badge badge-warn">${(String(ot.backing))}</span>
      </div>
      <div class="pj-space-notice">${ot.backing === 'tasks'
        ? (t('organisms.spaceTasksBacked') || 'This space points at the task system — its items are tasks, not workspace records. Manage them in the Tasks views.')
        : (t('organisms.spaceBackingUnsupported') || 'This space’s backing is not supported, so its content is not shown here. Edit the workspace (manifest) and set this space’s backing to "memory" to restore it — files and knowledge packages attach via Sources or document images instead.')}</div>
    </div>`;

  // ── Grouped tabs. The flat row got unwieldy as workspaces grew many spaces, so the nav is now
  // organised into groups (in this order): "Workspace related" (the static panels), "Records" and
  // "Document spaces" (memory-backed object types with no contract), then ONE group per contract —
  // each contract is a self-contained unit, so its spaces travel together. A space declaring a
  // `contract` id appears ONLY in that contract's group (never duplicated under Records/Documents).
  // Space labels are capitalized so the row reads uniformly next to the fixed tabs.
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const spaceCount = (name) => new Set([...draftsFor(name), ...objectsFor(name)].map(d => d.id)).size;
  // What a space is for — shown under its title when opened, so a bare "Gap" record reads in context.
  // Manifest i18n "type.<name>.desc" wins; the objectType's own `description` is the fallback.
  const spaceDesc = (ot) => wsT('type.' + ot.name + '.desc') || (typeof ot.description === 'string' ? ot.description : '');
  const spaceTab = (ot) => ({
    id: 'space:' + ot.name, ot, label: cap(wsT('type.' + ot.name) || ot.name),
    count: orgService.isMemorySpace(ot) ? spaceCount(ot.name) : null,
  });

  // Distinct contract ids in first-seen manifest order; the rest split by mode.
  const contractIds = [];
  for (const ot of allTypes) { if (ot.contract && !contractIds.includes(ot.contract)) contractIds.push(ot.contract); }
  const noContract = allTypes.filter(ot => !ot.contract);
  const recordTypes = noContract.filter(ot => !isDocSpace(ot));
  const docSpaceTypes = noContract.filter(ot => isDocSpace(ot));

  const relatedMembers = [
    { id: 'overview', label: t('organisms.tabOverview') || 'Overview', count: null },
    { id: 'activity', label: t('organisms.activity') || 'Activity', count: null },
    { id: 'people', label: t('organisms.tabPeople') || 'People', count: null },
    { id: 'share', label: t('organisms.share') || 'Share', count: null },
    { id: 'sources', label: t('organisms.sources') || 'Sources', count: null },
    { id: 'review', label: t('organisms.tabReview') || 'Review', count: approvals.length || null },
  ];
  const stackedGroup = (id, label, desc, spaces) => ({
    id, kind: 'stacked', label, desc, spaces, members: spaces.map(spaceTab),
    count: spaces.reduce((n, ot) => n + (orgService.isMemorySpace(ot) ? spaceCount(ot.name) : 0), 0) || null,
  });
  const groups = [{ id: 'related', kind: 'related', label: t('organisms.groupRelated') || 'Workspace', members: relatedMembers }];
  if (recordTypes.length) groups.push(stackedGroup('group:records', t('organisms.groupRecords') || 'Records', t('organisms.groupRecordsDesc') || '', recordTypes));
  if (docSpaceTypes.length) groups.push(stackedGroup('group:documents', t('organisms.groupDocs') || 'Document spaces', t('organisms.groupDocsDesc') || '', docSpaceTypes));
  for (const cid of contractIds) {
    groups.push(stackedGroup('group:contract:' + cid, cid,
      (t('organisms.groupContractDesc') || 'Spaces provided by the {id} contract.').replace('{id}', cid),
      allTypes.filter(ot => ot.contract === cid)));
  }

  // Valid ids: overview + the static panels, a focused single space ("space:<name>"), or a stacked group.
  const validTabIds = new Set(['overview', ...relatedMembers.map(m => m.id), ...allTypes.map(ot => 'space:' + ot.name), ...groups.filter(g => g.kind === 'stacked').map(g => g.id)]);
  // Settings REPLACES the tab content: while it is open no tab is active (the previous state — a
  // highlighted tab above settings content — lied about what the user was looking at).
  const activeTab = showSettings ? '' : (validTabIds.has(tab) ? tab : 'overview');
  const activeSpace = activeTab.startsWith('space:') ? allTypes.find(ot => ot.name === activeTab.slice(6)) : null;
  const activeGroup = activeTab.startsWith('group:') ? groups.find(g => g.id === activeTab) : null;
  // Opening a tab clears its unseen badge (the seen mark persists across sessions).
  const pickTab = (id) => guardWsDirty(() => { setShowSettings(false); setTab(id); markSeen(id); });
  // A stacked group opens at its top; clicking one of its spaces opens it scrolled to that section.
  const openGroup = (id) => pickTab(id);
  const scrollToSpace = (gid, name) => guardWsDirty(() => { setShowSettings(false); setTab(gid); setPendingScroll(name); markSeen(gid); });

  // Static one-line descriptions for the related panels that don't already carry their own.
  const REL_DESC = {
    overview: t('organisms.descOverview') || '',
    activity: t('organisms.descActivity') || '',
    sources: t('organisms.descSources') || '',
    review: t('organisms.descReview') || '',
  };

  // Menu items are VERBS (a click copies to the clipboard; the toast confirms). The contract-agent
  // builder is a different category from the two copy actions, so a divider separates it.
  const agentMenuItems = [
    { label: t('organisms.copyChatPrompt') || 'Copy chat prompt', icon: '💬', onClick: () => copyAccessPrompt('human') },
    { label: t('organisms.copyCodingPrompt') || 'Copy coding agent prompt', icon: '⌨', onClick: () => copyAccessPrompt('agent') },
    { divider: true },
    { label: t('organisms.contractPrompt') || 'Create contract agent', icon: '⚙️', onClick: copyContractPrompt },
  ];

  // ── Overview (landing tab): the whole workspace on one vertical scroll — a "what happened
  // here" strip from the activity feed, then every manifest space as its own stacked section.
  // Tabs stay for focused work; this answers "where is everything and what changed".
  const isMobileView = () => window.matchMedia('(max-width: 640px)').matches;
  const shortActor = (a) => String(a || '').split('@')[0];
  // First non-empty markdown line as a gray preview (heading/list markers stripped).
  const firstLine = (md) => {
    const line = String(md || '').split('\n').map(s => s.trim()).find(s => s && !s.startsWith('```'));
    return line ? line.replace(/^#{1,6}\s+/, '').replace(/^[-*>]\s+/, '').slice(0, 120) : '';
  };
  // Strip event → jump straight to the changed item in its space tab.
  const gotoEvent = (e) => {
    const target = allTypes.find(o => o.name === e.type);
    if (!target || !orgService.isMemorySpace(target)) { pickTab('activity'); return; }
    if (isDocSpace(target)) setActiveDoc({ type: target.name, mode: 'view', page: { id: e.instance } });
    else setExpandedRec(s => ({ ...s, [target.name + ':' + e.instance]: true }));
    pickTab('space:' + target.name);
  };
  const openOvRec = (ot, r) => { setExpandedRec(s => ({ ...s, [ot.name + ':' + r.id]: true })); pickTab('space:' + ot.name); };
  // Jump from a search hit to its record/document in the right space, then close the search.
  const gotoHit = (hit) => {
    const target = allTypes.find(o => o.name === hit.space || o.namespace === hit.namespace);
    if (!target) return;
    if (isDocSpace(target)) setActiveDoc({ type: target.name, mode: 'view', page: { id: hit.id } });
    else setExpandedRec(s => ({ ...s, [target.name + ':' + hit.id]: true }));
    pickTab('space:' + target.name);
    setWsQuery(''); setWsHits(null);
  };
  const renderWsSearchResults = () => {
    if (wsSearching && !wsHits) return html`<${Spinner} text=${t('organisms.loading') || 'Loading...'} />`;
    if (!wsHits || !wsHits.length) return html`<${EmptyState} text=${t('search.noMatches') || 'No matches'} />`;
    const bySpace = {};
    for (const h of wsHits) (bySpace[h.space] = bySpace[h.space] || []).push(h);
    return html`<div class="pj-search-results">
      ${Object.entries(bySpace).map(([space, hits]) => html`
        <div class="pj-search-group" key=${space}>
          <div class="pj-search-group-head">${cap(wsT('type.' + space) || space)}<span class="pj-org-tab-count">${hits.length}</span></div>
          ${hits.map(h => html`
            <button class="pj-search-hit" key=${h.id} onClick=${() => gotoHit(h)}>
              <span class="pj-search-hit-title">${h.title}</span>
              <span class="pj-search-hit-snippet">${h.snippet}</span>
            </button>`)}
        </div>`)}
    </div>`;
  };
  // A document opens in its space tab on desktop; on mobile it expands INLINE right here —
  // view and edit both — so no window juggling is ever needed on a phone.
  const openOvDoc = (ot, d) => {
    if (isMobileView()) setOvDoc(v => (v && v.type === ot.name && v.id === d.id) ? null : { type: ot.name, id: d.id, mode: 'view' });
    else { setActiveDoc({ type: ot.name, mode: 'view', page: { id: d.id } }); pickTab('space:' + ot.name); }
  };
  const ovAddNew = (ot, docMode) => {
    if (docMode) setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } });
    else startAdd(ot);
    pickTab('space:' + ot.name);
  };

  const renderOvDocInline = (ot, d) => ovDoc.mode === 'edit'
    ? html`<div class="pj-ov-doc-inline"><${DocumentEditor} key=${'oved-' + d.id} orgId=${orgId} page=${d} busy=${busy}
        onSave=${(p) => { savePage(ot, p); setOvDoc({ type: ot.name, id: d.id, mode: 'view' }); }}
        onCancel=${() => setOvDoc({ type: ot.name, id: d.id, mode: 'view' })} /></div>`
    : html`<div class="pj-ov-doc-inline"><${DocumentView} key=${'ovv-' + d.id} page=${d} busy=${busy}
        onEdit=${() => setOvDoc({ type: ot.name, id: d.id, mode: 'edit' })}
        onPublish=${() => publish(ot, d.id)}
        onWikiLink=${(content) => {
          const title = String(content).split('#')[0].trim();
          const targetDoc = title && mergedDocs(ot).find(x => (x.title || '').toLowerCase() === title.toLowerCase());
          if (targetDoc) setOvDoc({ type: ot.name, id: targetDoc.id, mode: 'view' });
        }} /></div>`;

  const renderOvSection = (ot) => {
    const memory = orgService.isMemorySpace(ot);
    const docMode = memory && isDocSpace(ot);
    const items = memory ? (docMode ? mergedDocs(ot) : mergedRecords(ot)) : [];
    const label = cap(wsT('type.' + ot.name) || ot.name);
    // A space the manifest declares but memory doesn't back → one notice row, never hidden.
    if (!memory) return html`
      <div class="pj-ov-row" key=${ot.name}>
        <button class="pj-ov-name pj-ov-name-link" onClick=${() => pickTab('space:' + ot.name)}>${label}</button>
        <span class="badge badge-warn">${String(ot.backing)}</span>
      </div>`;
    // Empty space → a single compact row (name + none + add), not an empty box.
    if (items.length === 0) return html`
      <div class="pj-ov-row" key=${ot.name}>
        <span class="pj-ov-name">${label}</span>
        <span class="pj-muted">${t('organisms.noneYet') || 'none yet'}</span>
        <button class="btn-ghost btn-sm" onClick=${() => ovAddNew(ot, docMode)}>${'+ '}${docMode ? (t('organisms.newPage') || 'New document') : (t('organisms.addDraft') || 'Add draft')}</button>
      </div>`;
    const open = ovOpen[ot.name] ?? !isMobileView();
    // Multi-part documents collapse into one series row here too (see groupDocs); records pass through.
    const display = docMode ? groupDocs(items) : items.map(d => ({ single: d }));
    const shown = display.slice(0, 5);
    return html`
      <div class="pj-ov-sec" key=${ot.name}>
        <div class="pj-ov-sec-head" onClick=${() => setOvOpen(s => ({ ...s, [ot.name]: !open }))}>
          <span class="pj-ov-chevron">${open ? '▾' : '▸'}</span>
          <span class="pj-ov-name">${label}</span>
          <span class="pj-org-tab-count">${items.length}</span>
          ${docMode ? html`<span class="pj-doc-tag">${t('organisms.docs') || 'docs'}</span>` : null}
          <span class="pj-ov-spacer"></span>
          <button class="btn-ghost btn-sm" onClick=${(ev) => { ev.stopPropagation(); ovAddNew(ot, docMode); }}>${'+ '}${docMode ? (t('organisms.newPage') || 'New document') : (t('organisms.addDraft') || 'Add draft')}</button>
        </div>
        ${open ? html`
          ${spaceDesc(ot) ? html`<div class="section-desc pj-ov-desc">${spaceDesc(ot)}</div>` : null}
          <div class="pj-ov-items">
            ${shown.map((g) => {
              // A collapsed multi-part series (docMode only) → one row; clicking opens the first part
              // in the space tab, where the full series index lives.
              if (g.parts) return html`
                <div class="pj-ov-doc" key=${'ser-' + g.base}>
                  <button class="pj-ov-item" onClick=${() => openOvDoc(ot, g.parts[0])}>
                    ${g.parts.some(p => p._draft) ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
                    <span class="pj-ov-item-title">${g.base}</span>
                    <span class="pj-org-tab-count">${g.parts.length}</span>
                    <span class="pj-ov-preview">${firstLine(g.parts[0].markdown)}</span>
                  </button>
                </div>`;
              const d = g.single;
              return docMode ? html`
                <div class="pj-ov-doc" key=${d.id}>
                  <button class="pj-ov-item" onClick=${() => openOvDoc(ot, d)}>
                    ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
                    <span class="pj-ov-item-title">${d.title || d.id}</span>
                    <span class="pj-ov-preview">${firstLine(d.markdown)}</span>
                  </button>
                  ${ovDoc && ovDoc.type === ot.name && ovDoc.id === d.id ? renderOvDocInline(ot, d) : null}
                </div>` : html`
                <button class="pj-ov-item" key=${d.id} onClick=${() => openOvRec(ot, d)}>
                  ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
                  <span class="pj-ov-item-title">${String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.summary || d.id || '')}</span>
                  ${d.status ? html`<span class="badge badge-info">${String(d.status)}</span>` : null}
                </button>`;
            })}
            ${display.length > 5 ? html`
              <button class="pj-ov-more" onClick=${() => pickTab('space:' + ot.name)}>${(t('organisms.ovShowAll') || 'Show all {n} →').replace('{n}', String(items.length))}</button>` : null}
          </div>` : null}
      </div>`;
  };

  // ── Measurability objectives (the manifest's objectives[] + each KPI's resolved current vs target).
  // The server (overview endpoint) already computed `current` for from:records KPIs; we only render.
  const kpiTargetText = (tg) => {
    if (!tg || typeof tg.op !== 'string') return '';
    if (tg.op === 'between' && Array.isArray(tg.values) && tg.values.length === 2) return `${tg.values[0]}–${tg.values[1]}`;
    const sym = tg.op === '<=' ? '≤' : tg.op === '>=' ? '≥' : tg.op === '==' ? '=' : tg.op;
    return typeof tg.value === 'number' ? `${sym} ${tg.value}` : '';
  };
  const kpiMeets = (cur, tg) => {
    if (cur === null || cur === undefined || !tg || typeof tg.op !== 'string') return null;
    const v = tg.value;
    switch (tg.op) {
      case '<': return typeof v === 'number' ? cur < v : null;
      case '<=': return typeof v === 'number' ? cur <= v : null;
      case '>': return typeof v === 'number' ? cur > v : null;
      case '>=': return typeof v === 'number' ? cur >= v : null;
      case '==': return typeof v === 'number' ? cur === v : null;
      case 'between': return (Array.isArray(tg.values) && tg.values.length === 2) ? (cur >= tg.values[0] && cur <= tg.values[1]) : null;
      default: return null;
    }
  };
  const renderObjectives = () => html`
    <div class="pj-obj">
      <div class="pj-obj-title">${t('organisms.objectivesTitle') || 'Objectives'}</div>
      ${wsObjectives.map((o, oi) => html`
        <div class="pj-obj-card" key=${o.id || oi}>
          <div class="pj-obj-statement">
            ${(o.statement || o.id)}
            ${o.status === 'met' ? html`<span class="badge badge-success pj-obj-status">${t('organisms.objStatusMet') || 'met'}</span>` : null}
            ${o.status === 'abandoned' ? html`<span class="badge pj-obj-status">${t('organisms.objStatusAbandoned') || 'abandoned'}</span>` : null}
          </div>
          ${o.why ? html`<div class="pj-obj-why">${(o.why)}</div>` : null}
          ${(o.kpis && o.kpis.length) ? html`
            <div class="pj-obj-kpis">
              ${o.kpis.map((k, ki) => {
                const ok = kpiMeets(k.current, k.target);
                const tgt = kpiTargetText(k.target);
                const unit = k.unit ? ` ${k.unit}` : '';
                const val = (k.current === null || k.current === undefined) ? '—' : String(k.current);
                return html`
                  <div class="pj-obj-kpi ${ok === true ? 'met' : ok === false ? 'off' : ''}" key=${k.name || ki}>
                    <span class="pj-obj-kpi-name">${k.name}</span>
                    <span class="pj-obj-kpi-val">${val}${unit}${ok === true ? ' ✅' : ok === false ? ' ⚠️' : ''}</span>
                    ${tgt ? html`<span class="pj-obj-kpi-target">${(t('organisms.kpiTarget') || 'target {t}').replace('{t}', tgt)}</span>` : null}
                    ${k.computed === false ? html`<span class="pj-obj-kpi-declared" title=${t('organisms.kpiDeclaredHint') || 'Self-reported — not computed from records'}>${t('organisms.kpiDeclared') || 'self-reported'}</span>` : null}
                  </div>`;
              })}
            </div>` : null}
        </div>`)}
    </div>`;

  const renderOverview = () => {
    const recent = wsEvents.slice(0, 8);
    return html`
      <div class="pj-ov">
        ${recent.length > 0 ? html`
          <div class="pj-ov-strip">
            <div class="pj-ov-strip-title">${t('organisms.ovRecent') || 'What happened here'}</div>
            ${recent.map((e, i) => html`
              <button class="pj-ov-event" key=${i} onClick=${() => gotoEvent(e)}>
                <span class="pj-act-dot ${e.action}"></span>
                <span class="pj-ov-event-who">${shortActor(e.actor)}${e.agent ? html` <span class="pj-act-agent" title=${t('organisms.viaAgent') || 'via this agent'}>🤖 ${e.agent}</span>` : null}</span>
                <span class="pj-ov-event-act">${e.action === 'publish' ? (t('organisms.publishedVerb') || 'published') : (t('organisms.editedVerb') || 'edited')}</span>
                <span class="pj-ov-event-what">${e.mode === 'document' ? '📄' : '🗂'} ${(wsT('type.' + e.type) || e.type)}${' / '}${instanceTitle(e.type, e.instance)}</span>
                <span class="pj-ov-event-time">${relTime(e.at)}</span>
              </button>`)}
          </div>` : null}
        ${allTypes.map(renderOvSection)}
        ${allTypes.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
      </div>`;
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

      ${wsObjectives.length ? renderObjectives() : null}

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

      <div class="pj-org-groups" role="tablist">
        ${groups.map(g => {
          const stacked = g.kind === 'stacked';
          const groupActive = activeTab === g.id;
          // While searching, a stacked (content) group shows only the spaces that have matches.
          const members = (wsSearchCounts && stacked) ? g.members.filter(tb => wsSearchCounts[tb.ot.name]) : g.members;
          if (wsSearchCounts && stacked && !members.length) return null;
          return html`
            <div class="pj-org-group ${groupActive ? 'active' : ''}" key=${g.id}>
              ${stacked
                ? html`<button class="pj-org-group-cap ${groupActive ? 'active' : ''}" title=${g.desc || ''} onClick=${() => openGroup(g.id)}>
                    ${g.label}${g.count !== null && g.count !== undefined ? html`<span class="pj-org-tab-count">${g.count}</span>` : null}
                  </button>`
                : html`<span class="pj-org-group-cap pj-org-group-cap-static">${g.label}</span>`}
              <div class="pj-org-group-tabs">
                ${members.map(tb => {
                  // Related members are independent panels; a stacked member scrolls within its group.
                  const isActive = activeTab === tb.id;
                  const u = isActive ? 0 : unseenOf(tb.id);
                  const matchCount = (wsSearchCounts && stacked) ? wsSearchCounts[tb.ot.name] : null;
                  const onClick = stacked ? () => scrollToSpace(g.id, tb.ot.name) : () => pickTab(tb.id);
                  return html`
                    <button class="pj-org-tab ${isActive ? 'active' : ''}" role="tab" aria-selected=${isActive} key=${tb.id} onClick=${onClick}>
                      ${(tb.label)}${matchCount != null ? html`<span class="pj-org-tab-count pj-org-tab-match">${matchCount}</span>`
                        : (tb.count !== null && tb.count !== undefined ? html`<span class="pj-org-tab-count">${tb.count}</span>` : null)}
                      ${u > 0 ? html`<span class="pj-org-tab-unseen" title=${t('organisms.unseenHint') || 'Changed since your last visit'}>${u}</span>` : null}
                    </button>`;
                })}
              </div>
            </div>`;
        })}
        <button class="pj-org-tab pj-ws-tab-add" title=${t('organisms.addDocSpaceTitle') || 'Add a document space'} onClick=${() => guardWsDirty(() => { setShowSettings(false); setShowSpaces(s => !s); })}>+</button>
      </div>

      ${showSpaces && html`
        <div class="pj-inbox pj-spaces-add">
          <div class="card-h3">${t('organisms.addDocSpaceTitle') || 'Add a document space'}</div>
          <div class="section-desc">${t('organisms.addDocSpaceDesc') || 'A document space is a free-form wiki (sections + markdown pages). Record types need a schema, so they are designed with AI in Settings → Process (restructure).'}</div>
          <div class="pj-space-row">
            <input type="text" class="input-field input-sm" placeholder=${t('organisms.spaceName') || 'New space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addSpaceHandler(); }} />
            <button class="btn-primary btn-sm" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setShowSpaces(false)}>${t('organisms.cancel') || 'Cancel'}</button>
          </div>
        </div>`}

      ${showSettings && html`
        <div class="pj-inbox">
          <div class="pj-meta-line">
            <span>${t('organisms.template') || 'Template'} ${(ws.manifest?.kind || '-')}</span>
            ${ws.manifest?.updatedAt ? html`<span>${t('organisms.lastSaved') || 'Last saved'} ${fmtDate(ws.manifest.updatedAt)}</span>` : null}
          </div>

          <div class="pj-form-card">
            <div class="pj-form-group">${t('organisms.formIdentity') || 'Identity'}</div>
            <label class="pj-field"><span>${t('organisms.wsName') || 'Name'}</span>
              <input type="text" class="input-field input-sm" value=${sName} onInput=${e => setSName(e.target.value)} /></label>
            <label class="pj-field"><span>${t('organisms.wsSummary') || 'Summary'}</span>
              <textarea class="input-field input-sm" rows="2" value=${sSummary} onInput=${e => setSSummary(e.target.value)}></textarea></label>

            <div class="pj-form-group">${t('organisms.formAgentPolicy') || 'Agent policy'}</div>
            <label class="pj-field"><span>${t('organisms.autonomy') || 'AI autonomy (L1 cautious → L5 free)'}</span>
              <select class="input-field input-sm" value=${sAutonomy} onChange=${e => setSAutonomy(e.target.value)}>
                ${['L1', 'L2', 'L3', 'L4', 'L5'].map(l => html`<option value=${l} key=${l}>${l} — ${t(`organisms.autonomyLevels.${l}`) || ''}</option>`)}
              </select></label>
            <div class="pj-form-hint">${t('organisms.autonomyHint') || 'Guidance for agents working here — L1 asks before nearly everything, L5 acts freely. The publish gate (Review tab) still applies regardless.'}</div>

            <div class="form-actions">
              <button class="btn-primary btn-sm" onClick=${saveSettings} disabled=${busy || !wsDirty}>${t('organisms.saveChanges') || 'Save changes'}</button>
              <button class="btn-ghost btn-sm" onClick=${() => { resetSettingsForm(); setShowSettings(false); }}>${t('organisms.cancel') || 'Cancel'}</button>
            </div>
          </div>

          <div class="pj-divider"></div>
          <div class="pj-form-group">${t('organisms.spaces') || 'Spaces'}</div>
          <div class="pj-form-hint">${t('organisms.spacesRemoveHint') || 'These actions apply immediately. Removing a space hides its section — the data stays in memory and comes back if a space with the same name is added again.'}</div>
          ${(ws.manifest?.objectTypes || []).map(ot => html`
            <div class="pj-doc-row" key=${'sp' + ot.name}>
              <span class="pj-space-name">${(ot.name)}<span class="pj-doc-tag">${isDocSpace(ot) ? (t('organisms.docs') || 'docs') : (t('organisms.recordsMode') || 'records')}</span></span>
              <button class="btn-ghost btn-sm" onClick=${() => removeSpaceHandler(ot.name)} disabled=${busy}>${t('organisms.remove') || 'Remove'}</button>
            </div>
          `)}
          <div class="form-actions">
            <input type="text" class="input-field input-sm" placeholder=${t('organisms.docSpaceNamePlaceholder') || 'New document space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} />
            <button class="btn-outline btn-sm" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
          </div>

          <div class="pj-divider"></div>
          <div class="pj-form-group">${t('organisms.formProcess') || 'Process'}</div>
          ${ws.manifest ? html`
            <div class="pj-chart">
              <div class="pj-chart-head">
                <span class="pj-chart-title">${'🔄 '}${t('organisms.editFlow') || 'How editing works here'}</span>
                <button class="btn-ghost btn-sm" onClick=${() => setShowFlow(s => !s)}>${showFlow ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
              </div>
              ${showFlow ? html`<${Mermaid} chart=${orgService.buildEditFlowMermaid(ws.manifest, gateOn)} />` : null}
            </div>` : null}
          <button class="btn-outline btn-sm" onClick=${() => setShowRegenerate(s => !s)}>
            ${showRegenerate ? (t('organisms.cancel') || 'Cancel') : (t('organisms.restructure') || '✨ Restructure / add types with AI')}
          </button>
          ${showRegenerate && renderGenerator()}

          <div class="pj-divider"></div>
          <div class="pj-danger">
            <div class="pj-danger-title">${t('organisms.dangerZone') || 'Danger zone'}</div>
            <div class="section-desc">${t('organisms.deleteWarn') || 'Deleting the workspace removes the manifest and ALL its data — drafts, published records, version history — and its schemas. The organism stays. This cannot be undone.'}</div>
            <label class="pj-field"><span>${(t('organisms.deleteConfirmLabel') || 'Type the workspace name to confirm') + ': ' + (ws.manifest?.name || '')}</span>
              <input type="text" class="input-field input-sm" value=${delConfirm} onInput=${e => setDelConfirm(e.target.value)} placeholder=${ws.manifest?.name || ''} /></label>
            <button class="btn-danger btn-sm" onClick=${delWorkspace}
              disabled=${busy || delConfirm.trim() !== (ws.manifest?.name || '').trim()}>${t('organisms.deleteWorkspace') || 'Delete workspace'}</button>
          </div>
        </div>
      `}

      ${wsHits !== null ? renderWsSearchResults() : html`
        ${REL_DESC[activeTab] ? html`<div class="section-desc pj-tab-desc">${REL_DESC[activeTab]}</div>` : null}

        ${activeTab === 'overview' ? renderOverview() : null}

        ${activeGroup ? html`
          <div class="pj-ov pj-group-view">
            <div class="pj-group-head">
              <div class="section-title">${activeGroup.label}</div>
              ${activeGroup.desc ? html`<div class="section-desc">${activeGroup.desc}</div>` : null}
            </div>
            ${activeGroup.spaces.map(ot => html`
              <div class="pj-group-sec" id=${'ws-sec-' + ot.name} key=${'gs-' + ot.name}>${renderOvSection(ot)}</div>`)}
            ${activeGroup.spaces.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
          </div>` : null}

        ${activeSpace
          ? (!orgService.isMemorySpace(activeSpace)
            ? renderSpaceNotice(activeSpace)
            : (isDocSpace(activeSpace) ? renderDocSpace(activeSpace) : renderRecordSpace(activeSpace)))
          : null}
      `}

      ${activeTab === 'sources' ? html`<${SourcesPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />` : null}

      ${activeTab === 'share' ? html`
        <div class="pj-section">
          <div class="section-desc">${t('organisms.sharePublicDesc') || 'Make published document-space pages readable by anyone with the link — no login required. Drafts are never shared. Anything you make public is also announced on the public activity feed on the front page.'}</div>
          ${share && docTypes.length > 0 ? html`
            <div class="pj-share-feed">
              ${share.public
                ? html`<div class="pj-share-feed-on">
                    <span>${t('organisms.feedPublishedAll') || '📣 This whole workspace is published to the public feed.'}</span>
                    <button class="btn-ghost btn-sm" disabled=${shareBusy} onClick=${() => patchShare({ public: false })}>${t('organisms.feedUnpublish') || 'Unpublish'}</button>
                  </div>`
                : html`<button class="btn-primary btn-sm" disabled=${shareBusy}
                    onClick=${() => { if (window.confirm(t('organisms.feedPublishConfirm') || 'Publish every published document in this workspace to the public activity feed on the front page?')) patchShare({ public: true }); }}>
                    ${t('organisms.feedPublishBtn') || '📣 Publish to public feed'}
                  </button>`}
            </div>` : null}
          ${docTypes.length === 0 ? html`<${EmptyState} icon="🌐" text=${t('organisms.noDocSpaces') || 'This workspace has no document spaces to share.'} />` : html`
            ${!share && shareBusy ? html`<div class="pj-empty">${t('organisms.loading') || 'Loading…'}</div>` : null}
            ${share ? docTypes.map(ot => {
              const docs = objectsFor(ot.name);
              const spaceOn = !!(share.spaces && share.spaces[ot.name]);
              return html`
                <div class="pj-share-space" key=${'sh' + ot.name}>
                  <label class="pj-share-row">
                    <input type="checkbox" checked=${spaceOn} disabled=${shareBusy} onChange=${e => patchShare({ spaces: { [ot.name]: e.target.checked } })} />
                    <span class="pj-space-name">${wsT('type.' + ot.name) || ot.name}</span>
                    <span class="pj-doc-tag">${docs.length} ${t('organisms.docs') || 'docs'}</span>
                  </label>
                  ${docs.length === 0
                    ? html`<div class="pj-empty pj-share-empty">${t('organisms.noPublishedDocs') || 'No published documents yet — publish a page to share it.'}</div>`
                    : html`<div class="pj-share-docs">
                        ${docs.map(d => {
                          const on = isDocPublic(ot.name, d.id);
                          return html`
                            <label class="pj-share-doc" key=${'shd' + d.id}>
                              <input type="checkbox" checked=${on} disabled=${shareBusy} onChange=${e => patchShare({ docs: { [`${ot.name}/${d.id}`]: e.target.checked } })} />
                              <span class="pj-share-doc-title">${d.title || d.id}</span>
                              ${on ? html`<a class="pj-share-link" href=${orgService.publicViewerUrl(orgId, wsId, { type: ot.name, id: d.id })} target="_blank" rel="noopener">${t('organisms.openLink') || 'open ↗'}</a>` : null}
                            </label>`;
                        })}
                      </div>`}
                </div>`;
            }) : null}
            ${anythingPublic() ? html`
              <div class="pj-share-actions">
                <a class="btn-outline btn-sm" href=${orgService.publicViewerUrl(orgId, wsId)} target="_blank" rel="noopener">${'🔗 '}${t('organisms.openPublicViewer') || 'Open public viewer'}</a>
                <button class="btn-ghost btn-sm" onClick=${() => copyShareLink(orgService.publicViewerUrl(orgId, wsId))}>${t('organisms.copyLink') || 'Copy link'}</button>
              </div>` : null}
          `}
        </div>` : null}

      ${activeTab === 'review' ? html`
        <div class="pj-section">
          <label class="pj-gate-label" title=${t('organisms.publishGateHint') || 'When on, an agent’s publish is held for your review instead of going live'}>
            <input type="checkbox" checked=${gateOn} onChange=${toggleGate} disabled=${busy} />
            ${'🔒 '}${t('organisms.publishGate') || 'Require review before publishing'}
          </label>
          ${approvals.length === 0
            ? html`<${EmptyState} icon="📭" text=${t('organisms.reviewEmpty') || 'Nothing waiting for review.'} />`
            : html`
              <div class="card-h3">${t('organisms.needsDecision') || 'Needs your decision'} (${approvals.length})</div>
              ${approvals.map(a => html`
                <div class="pj-approval" key=${a.id}>
                  <div class="pj-approval-text">${(a.prompt || a.action)}</div>
                  <div class="card-actions">
                    <button class="btn-success btn-sm" onClick=${() => resolve(a.id, 'approve')} disabled=${busy}>${t('organisms.approve') || 'Approve'}</button>
                    <button class="btn-danger btn-sm" onClick=${() => resolve(a.id, 'reject')} disabled=${busy}>${t('organisms.reject') || 'Reject'}</button>
                  </div>
                </div>
              `)}`}
        </div>` : null}

      ${activeTab === 'activity' ? html`
        <${ActivityPanel} orgId=${orgId} wsId=${wsId} />
        ${(ws.decisions || []).length > 0 ? html`
          <div class="pj-section">
            <div class="pj-section-title">${t('organisms.decisions') || 'Recent decisions'}</div>
            ${ws.decisions.slice(-8).reverse().map((d, i) => html`
              <div class="pj-item pj-decision" key=${'dec' + i}><span class="pj-item-text">${(String(d.summary || ''))}</span></div>
            `)}
          </div>` : null}` : null}

      ${activeTab === 'people' ? html`<${ParticipantsPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />` : null}
    </div>
  `;
}
