/**
 * @file organisms-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing organisms (groups, communities, teams). This is now the thin
 *   shell: the organisms list (compact rows + drag-and-drop ordering + sort + create/import), the
 *   discover section, and the routing between the list, an organism's home page, and a workspace.
 *   The bulk of the feature lives in cohesive sub-modules under ./organisms/* (see @structure).
 * @structure
 *   - OrganismsTab — main exported component (list + routing shell)
 *   - renderOrgRow / renderDiscoverDetail — compact list row + discover detail (inner helpers)
 *   Sub-modules: organisms/helpers.js (fmtDate/relTime/orgInitials/exportOrganismZip),
 *   organisms/panels.js (OrgSearch/IncomingInvitations/BoardPreview), organisms/home.js
 *   (OrganismHome), organisms/workspace.js (Workspace), organisms/workspace-list.js, members.js,
 *   agents.js, document.js, schema-form.js, workspace-comments.js, activity-panel.js,
 *   participants-panel.js, sources-panel.js, widgets.js (StructureOverview). KebabMenu/TagInput
 *   were promoted to ./shared.js.
 * @usage
 *   import OrganismsTab from '/views/profile/organisms-tab.js';
 *   <OrganismsTab session={session} showToast={showToast} onStats={onStats} />
 * @version-history
 *   v2.33.0 -- 2026-10-01 -- The create form starts from a shape (own work, team, company, family, club,
 *     project; GET /v1/organisms/shapes): the shape sets the type, policy and visibility and the create
 *     call makes its workspaces. Type presets add company and family (guided journey P5).
 *   v2.32.0 -- 2026-09-26 -- Every part is a kit component (page group G2a): the page is the SettingsPage (crumb, title, description, the confirm dialog after), the create form a section Card with the Fields, the Selects, the Note and FormActions, the search the Search line with Clear and its hits the List under a Group heading per organism (a hit's workspace a tag), the organisms the List in the mark-name-tags-stats-doors cut (the name opens the thing and takes Enter, the lock and the archived status in the tags cell, the four counts in Stats, Open or Join and the ⋯ menu at the end, drag to reorder with the row a drag is over marked, a discovered organism's Facts and interests in its opened panel), the import field the hidden FileDrop, the archived ones under a folded Section, the joined banner the aside Note. The page writes no class.
 *   v2.31.0 -- 2026-09-26 -- The line under an organism's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v2.30.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v2.29.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.28.0 -- 2026-09-26 -- The archived organisms open under the FoldSection (components/FoldSection.js), a unification: the look most tabs use.
 *   v2.27.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v2.26.0 -- 2026-09-25 -- A discovered organism's details are the Facts (css/components/facts.css), a unification: the look most tabs use. The tiles go; each name stands left of its value.
 *   v2.25.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v2.25.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v2.25.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.24.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v2.24.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.23.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.22.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v2.21.0 -- 2026-09-25 -- A picture of a person or a thing is the Object box's avatar cut (.poster-box--avatar), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v2.20.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v2.19.0 -- 2026-09-25 -- A section is the kit's section (PageSection in an .og page) and the line under its title is the lead (.og-lead), the look most tabs use (a unification).
 *   v2.18.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v2.17.0 -- 2026-09-25 -- Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v2.16.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v2.15.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.14.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v2.13.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v2.12.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v2.11.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.10.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.9.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v2.8.0 -- 2026-09-13 -- Compose list and guide rules from poster.css; retire unused list rules.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v2.7.0 — 2026-09-06 — The counts and the date always render, empty cell and all, because the
 *     row's trailing block is now a fixed grid and a missing cell would slide the rest into the
 *     wrong track. The door gets a cell of its own so Open on one row and Join on the next cannot
 *     drag the columns to their left.
 *   v2.6.0 — 2026-09-06 — The row's marks (type, lock, archived) leave the title row for a fixed
 *     column of their own, so they stand in one line down the list instead of trailing each name at
 *     a different place. The padlock is an outline SVG and the archived pill a plain badge, both
 *     without the emoji they carried.
 *   v2.5.0 — 2026-08-29 — The organism type is free text (40 chars): the create form gains an "Other"
 *     option with a text field, and the list row shows an unknown type as written instead of the
 *     raw locale key (tOr).
 *   v2.4.0 — 2026-07-16 — Mount folds my-orgs + public + list-order prefs into GET /v1/organisms/tab
 *     (getOrganismsTab); individual reads kept as fallback.
 *   v2.3.0 — 2026-06-23 — Thread an `openSpace` deep-link from the organism mindmap through onOpenWs
 *     into the Workspace (keyed remount + initialSpace), so a space node opens its tab; cleared on the
 *     Cmd-K and cross-organism-search jump paths so it never goes stale.
 *   v2.2.0 — 2026-06-22 — Cross-organism content search on the list view: one box searches ALL my
 *     organisms (indexed librarian FTS), results grouped per organism; a hit opens that organism +
 *     workspace with the in-workspace search pre-filled. Also listens for the Cmd-K aimeat-open-organism.
 *   v2.1.0 — 2026-06-22 — Workspace counts come inline via listOrganisms({include:'counts'}) instead
 *     of a per-organism discoverWorkspaces fan-out.
 *   v1.31.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking.
 *   v2.0.0 — 2026-06-19 — Split the ~3825-line module into cohesive sub-modules under ./organisms/*
 *     (no behaviour/visual change). This file keeps only OrganismsTab + the list-row renderers.
 *     KebabMenu/TagInput promoted to ./shared.js; the hidden import file-input now uses the
 *     .pj-hidden-input class instead of an inline style. The pre-2.0 per-version changelog lives in
 *     git history. DocumentView/DocumentEditor now live in ./organisms/document.js (doc-solo.js
 *     imports them from there directly).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t, tOr } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { List, Row as ListRow, Lead, Name, Cell, Stats, Stat, Doors, Group, SearchLine } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Card } from '/components/Card.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { FileDrop } from '/components/FileDrop.js';
import { Row } from '/components/Layout.js';
import * as orgService from '/js/services/organisms.js';
import * as memoryService from '/js/services/memory.js';
import { fmtDate, orgInitials, exportOrganismZip } from '/views/profile/organisms/helpers.js';
import { IncomingInvitations } from '/views/profile/organisms/panels.js';
import { OrganismHome } from '/views/profile/organisms/home.js';
import { Workspace } from '/views/profile/organisms/workspace.js';
import { swallowed } from '/js/swallowed.js';
import { authHeaders } from '/js/services/auth.js';

/** The padlock beside a non-public organism: an outline that takes the row's own colour. */
const LockMark = html`<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.2" y="7"
  width="9.6" height="7" rx="1.4" /><path d="M5.5 7V5.1a2.5 2.5 0 0 1 5 0V7" /></svg>`;

export default function OrganismsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [myOrganisms, setMyOrganisms] = useState(null);
  const [publicOrganisms, setPublicOrganisms] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);   // collapsible "Archived" section (closed by default)
  // organism whose workspaces are open, then the specific workspace within it — both restored from
  // sessionStorage so an F5 returns to where you were. openId set + openWs null = the workspace LIST.
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  const [openId, setOpenId] = useState(() => { try { return sessionStorage.getItem('aimeat.ws.openId') || null; } catch { return null; } });
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  const [openWs, setOpenWs] = useState(() => { try { return sessionStorage.getItem('aimeat.ws.openWs') || null; } catch { return null; } });
  // Transient deep-link target from the organism mindmap: open this space's tab on first render of the
  // workspace. In-memory only (not persisted) — an F5 lands on the workspace overview, not a stale tab.
  const [openSpace, setOpenSpace] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // List ordering: 'custom' (drag-and-drop, persisted) | 'name' | 'newest'. Persisted together with
  // the manual order in the user-memory key `organisms.ui` so it follows the user across devices.
  const [sortMode, setSortMode] = useState('custom');
  const [customOrder, setCustomOrder] = useState([]);
  const [openSettings, setOpenSettings] = useState(false); // open OrganismHome with the Settings panel showing
  const [justJoinedOrg, setJustJoinedOrg] = useState(null); // org id from the invite-accept redirect (?joined=1)
  // Cross-organism content search (all my organisms at once) — indexed librarian FTS, grouped per
  // organism. Replaces the org lists while a query is active; a hit opens that organism + workspace
  // with the in-workspace search pre-filled to the same query.
  const [gQuery, setGQuery] = useState('');
  const [gHits, setGHits] = useState(null);   // null = not searching
  const [gBusy, setGBusy] = useState(false);
  const dragIdRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

  /* ── Create form state ── */
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState('community');
  const [formTypeCustom, setFormTypeCustom] = useState('');
  const [formPolicy, setFormPolicy] = useState('open');
  const [formVisibility, setFormVisibility] = useState('public');
  const [formInterests, setFormInterests] = useState('');
  // A starting shape (GET /v1/organisms/shapes): '' is none, the organism starts empty.
  const [formShape, setFormShape] = useState('');
  const [shapes, setShapes] = useState([]);
  const shapeLang = (typeof document !== 'undefined' && document.documentElement.lang || 'en').slice(0, 2);
  useEffect(() => {
    if (!showCreate || shapes.length) return;
    orgService.getShapes(shapeLang).then(setShapes).catch(err => swallowed('organisms-tab: shapes', err));
  }, [showCreate, shapes.length, shapeLang]);

  const ghii = session?.owner || '';
  const [wsCounts, setWsCounts] = useState({});   // orgId → workspace count (own orgs)

  const loadData = useCallback(async () => {
    // Apply the saved list-order prefs (organisms.ui) whether they came from the composite or a fallback read.
    const applyPrefs = (v) => {
      if (v && typeof v === 'object') {
        if (Array.isArray(v.order)) setCustomOrder(v.order.filter(x => typeof x === 'string'));
        if (['custom', 'name', 'newest'].includes(v.sort)) setSortMode(v.sort);
      }
    };
    try {
      // Mount fold: ONE composite (my organisms + counts + public discovery + list-order prefs). On
      // failure, fall back to the two listOrganisms reads + a separate organisms.ui prefs read.
      const ov = await orgService.getOrganismsTab();
      if (ov) {
        const mineIds = new Set(ov.mine.map(o => o.id));
        setMyOrganisms(ov.mine);
        setPublicOrganisms(ov.public.filter(o => !mineIds.has(o.id)));
        onStats?.({ organisms: ov.mine.length });
        setWsCounts(Object.fromEntries(ov.mine.map(o => [o.id, o.workspace_count ?? 0])));
        applyPrefs(ov.uiPrefs);
        return;
      }
      const [myResp, pubResp] = await Promise.all([
        ghii ? orgService.listOrganisms({ member: ghii, include: 'counts' }) : Promise.resolve({ data: { organisms: [] } }),
        orgService.listOrganisms({ visibility: 'public' }),
      ]);
      const mine = myResp?.data?.organisms || [];
      const mineIds = new Set(mine.map(o => o.id));
      setMyOrganisms(mine);
      setPublicOrganisms((pubResp?.data?.organisms || []).filter(o => !mineIds.has(o.id)));
      onStats?.({ organisms: mine.length });
      setWsCounts(Object.fromEntries(mine.map(o => [o.id, o.workspace_count ?? 0])));
      try { const r = await memoryService.getMemory('organisms.ui', { soft: true }); applyPrefs(r?.data?.value); } catch (err) { swallowed('organisms-tab: applyPrefs', err); }
    } catch (err) {
      swallowed('organisms-tab: applyPrefs', err);
      setMyOrganisms([]);
      setPublicOrganisms([]);
    }
  }, [ghii, onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // ── List-order preferences (user memory key `organisms.ui`: { order: [ids], sort: mode }) ──
  // Read as part of loadData's mount composite (above); this key backs savePrefs.
  const UI_PREFS_KEY = 'organisms.ui';
  const savePrefs = useCallback((order, sort) => {
    memoryService.createMemory(UI_PREFS_KEY, { order, sort }, 'private').catch(err => { swallowed('organisms-tab: applyPrefs', err); });
  }, []);

  // Stable sort keeps server order for ids missing from the saved manual order (appended at the end).
  const sortedMine = useMemo(() => {
    const arr = [...(myOrganisms || [])];
    if (sortMode === 'name') arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    else if (sortMode === 'newest') arr.sort((a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0));
    else if (customOrder.length) {
      const pos = new Map(customOrder.map((id, i) => [id, i]));
      arr.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : Infinity) - (pos.has(b.id) ? pos.get(b.id) : Infinity));
    }
    return arr;
  }, [myOrganisms, sortMode, customOrder]);

  // Drop on a row: move the dragged row to the target's position; switches to manual order and saves.
  const onDropRow = (targetId) => {
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    setDragOverId(null);
    if (!fromId || fromId === targetId) return;
    const ids = sortedMine.map(o => o.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setCustomOrder(ids);
    setSortMode('custom');
    savePrefs(ids, 'custom');
  };

  // Import a whole organism from a ZIP backup → creates a new organism + opens it.
  const orgFileRef = useRef(null);
  const [importingOrg, setImportingOrg] = useState(false);
  const doImportOrg = async (file) => {
    if (!file) return;
    setImportingOrg(true);
    try {
      const res = await fetch('/v1/organisms/import', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/zip' }, body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || 'Import failed');
      showToast(t('organisms.orgImported') || 'Organism imported');
      await loadData();
      if (body.data?.organism_id) setOpenId(body.data.organism_id);
    } catch (e) { showToast((e && e.message) || 'Import failed'); }
    finally { setImportingOrg(false); }
  };

  // Persist the open organism + workspace (F5 restore), and drop a restored id the user can no longer open.
  useEffect(() => {
    try { if (openId) sessionStorage.setItem('aimeat.ws.openId', openId); else sessionStorage.removeItem('aimeat.ws.openId'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
  }, [openId]);
  useEffect(() => {
    try { if (openWs) sessionStorage.setItem('aimeat.ws.openWs', openWs); else sessionStorage.removeItem('aimeat.ws.openWs'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
  }, [openWs]);
  useEffect(() => {
    if (openId && myOrganisms && !myOrganisms.some(o => o.id === openId)) { setOpenId(null); setOpenWs(null); }
  }, [openId, myOrganisms]);

  // Jump from the global command palette (Cmd-K) when this tab is already mounted — open the chosen
  // organism (+ workspace). A cold navigation instead reads sessionStorage on mount (above).
  useEffect(() => {
    const onOpen = (e) => {
      const d = e.detail || {};
      if (!d.orgId) return;
      setOpenId(d.orgId); setOpenWs(d.wsId || null); setOpenSpace(null); setOpenSettings(false);
    };
    window.addEventListener('aimeat-open-organism', onOpen);
    return () => window.removeEventListener('aimeat-open-organism', onOpen);
  }, []);

  // Deep link from another view (e.g. the Secretary's "Open" links open in a new tab):
  // ?org=…&ws=… opens that organism (+ workspace) on a cold navigation. Runs once on mount.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const org = params.get('org');
      if (org) { setOpenId(org); setOpenWs(params.get('ws') || null); setOpenSpace(null); setOpenSettings(false); }
      // ?joined=1 arrives from the invitation-accept redirect: the person just became a member
      // of THIS organism. The welcome banner says whose team they joined and points at the chat
      // connection, because that is their actual next step (UX-remake v3, P8).
      if (org && params.get('joined') === '1') setJustJoinedOrg(org);
    } catch (err) { swallowed('organisms-tab: onOpen', err); }
  }, []);

  // Cross-organism content search (debounced) — librarian FTS across all my own content.
  useEffect(() => {
    const query = gQuery.trim();
    if (query.length < 2) { setGHits(null); setGBusy(false); return undefined; }
    let cancelled = false;
    setGBusy(true);
    const tid = setTimeout(async () => {
      const hits = await memoryService.librarianSearch(query, 60, 'own').catch(err => { swallowed('organisms-tab: onOpen', err); return []; });
      if (!cancelled) { setGHits(hits || []); setGBusy(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [gQuery]);

  // Live update listener
  const liveRef = useRef(loadData);
  liveRef.current = loadData;
  useEffect(() => onLiveUpdate(['organisms'], () => liveRef.current()), []);

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) {
      showToast(t('organisms.nameRequired') || 'Name is required');
      return;
    }
    setCreating(true);
    try {
      const interests = formInterests.split(',').map(s => s.trim()).filter(Boolean);
      const result = await orgService.createOrganism({
        name: formName.trim(),
        description: formDesc.trim(),
        type: formType === '__custom' ? (formTypeCustom.trim() || 'community') : formType,
        join_policy: formPolicy,
        visibility: formVisibility,
        interests,
        ...(formShape ? { shape: formShape, lang: shapeLang } : {}),
      });
      if (result?.data?.organism) {
        showToast(t('organisms.created') || 'Organism created!');
        setShowCreate(false);
        setFormName(''); setFormDesc(''); setFormInterests(''); setFormShape('');
        loadData();
      } else {
        showToast(result?.error?.message || (t('organisms.createError') || 'Failed to create'));
      }
    } catch (err) {
      swallowed('organisms-tab: onOpen', err);
      showToast(t('organisms.createError') || 'Failed to create');
    } finally { setCreating(false); }
  }, [formName, formDesc, formType, formTypeCustom, formPolicy, formVisibility, formInterests, formShape, shapeLang, showToast, loadData]);

  const handleJoin = useCallback(async (id) => {
    try {
      const result = await orgService.joinOrganism(id);
      if (result?.data?.status === 'joined') {
        showToast(t('organisms.joined') || 'Joined!');
      } else if (result?.data?.status === 'pending') {
        showToast(t('organisms.joinPending') || 'Join request sent — waiting for approval');
      } else {
        showToast(result?.error?.message || 'Could not join');
      }
      loadData();
    } catch (err) {
      swallowed('organisms-tab: onOpen', err);
      showToast(t('organisms.joinError') || 'Failed to join');
    }
  }, [showToast, loadData]);

  const handleLeave = useCallback(async (id, name) => {
    confirm(t('organisms.confirmLeave')?.replace('{name}', name) || `Leave "${name}"?`, async () => {
      try {
        await orgService.leaveOrganism(id);
        showToast(t('organisms.left') || 'Left organism');
        setOpenId(null); setOpenWs(null);
        loadData();
      } catch (err) {
        swallowed('organisms-tab: onOpen', err);
        showToast(t('organisms.leaveError') || 'Failed to leave');
      }
    }, { danger: true });
  }, [showToast, loadData, confirm]);

  const handleDelete = useCallback(async (id, name) => {
    confirm(t('organisms.confirmDelete')?.replace('{name}', name) || `Delete "${name}"? This cannot be undone.`, async () => {
      try {
        await orgService.deleteOrganism(id);
        showToast(t('organisms.deleted') || 'Organism deleted');
        setExpanded(null);
        setOpenId(null); setOpenWs(null);
        loadData();
      } catch (err) {
        swallowed('organisms-tab: onOpen', err);
        showToast(t('organisms.deleteError') || 'Failed to delete');
      }
    }, { danger: true });
  }, [showToast, loadData, confirm]);

  // Archive / unarchive a whole organism (creator/admin). Archived organisms become read-only and
  // their content is excluded from AI materials (overview/read/search); the workspaces cascade-archive
  // and unarchive uses smart restore. Reversible — not a delete.
  const handleArchive = useCallback(async (id, name, archived) => {
    const verb = archived ? (t('organisms.archive') || 'Archive') : (t('organisms.unarchive') || 'Unarchive');
    confirm(
      (archived
        ? (t('organisms.confirmArchive') || 'Archive “{name}”? It becomes read-only and is hidden from AI operations until you unarchive it. Its workspaces are archived too.')
        : (t('organisms.confirmUnarchive') || 'Unarchive “{name}”? It and the workspaces archived with it become active again.')
      ).replace('{name}', name),
      async () => {
        try {
          if (archived) await orgService.archiveContent(id, { level: 'organism' });
          else await orgService.unarchiveContent(id, { level: 'organism' });
          showToast(archived ? (t('organisms.organismArchived') || 'Organism archived') : (t('organisms.organismUnarchived') || 'Organism restored'));
          loadData();
        } catch (e) { showToast((e && e.message) || 'Failed'); }
      },
      { title: verb },
    );
  }, [showToast, loadData, confirm]);

  const toggleExpand = useCallback((id) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  // Discover rows expand in place (non-members can't open the home page, so the detail
  // grid + interests they could previously see in the expanded card stay reachable here).
  const renderDiscoverDetail = (org) => {
    const policyLabel = {
      open: t('organisms.policyOpen') || 'Open',
      approval_required: t('organisms.policyApproval') || 'Approval',
      invite_only: t('organisms.policyInvite') || 'Invite Only',
    }[org.joinPolicy] || org.joinPolicy;
    return html`
      <${Facts} rows=${[
        { k: t('organisms.creator') || 'Creator', v: (org.creatorGhii) },
        { k: t('organisms.memberCount') || 'Members', v: `${(org.members || []).length} / ${org.maxMembers || 500}` },
        { k: t('organisms.policyLabel') || 'Join policy', v: policyLabel },
        org.createdAt && { k: t('organisms.createdAt') || 'Created', v: fmtDate(org.createdAt) },
      ]} />
      ${(org.interests || []).length > 0 ? html`
        <${Marks}>
          ${org.interests.map(tag => html`<${Mark} key=${tag}>${(tag)}<//>`)}
        <//>` : null}`;
  };

  // Compact one-line row: avatar · name + description · marks (type + lock + archived, their own
  // fixed column so they line up down the list) · members/agents/date · primary action · "…" menu.
  // Management (settings, leave, delete) lives in the menu / home page.
  const renderOrgRow = (org, isMine) => {
    const isCreator = org.creatorGhii === ghii;
    const isAdmin = org.admins?.includes(ghii);
    const isMember = org.members?.includes(ghii);
    const canEdit = isCreator || isAdmin;
    const typeLabel = tOr(`organisms.types.${org.type}`, org.type);
    const isExpanded = !isMine && expanded === org.id;
    const visLabel = org.visibility === 'private' ? (t('organisms.visPrivate') || 'Private') : (t('organisms.visListed') || 'Listed');
    const openHome = (withSettings) => { setOpenSettings(!!withSettings); setOpenWs(null); setOpenId(org.id); };
    const activate = () => (isMine || isMember) ? openHome(false) : toggleExpand(org.id);

    const menuItems = isMine ? [
      canEdit && { label: t('organisms.settings') || 'Settings', icon: '⚙', onClick: () => openHome(true) },
      { label: t('organisms.exportOrg') || 'Export organism', icon: '⬇', onClick: () => exportOrganismZip(org, showToast) },
      canEdit && (org.archived
        ? { label: t('organisms.unarchive') || 'Unarchive', icon: '♻️', onClick: () => handleArchive(org.id, org.name, false) }
        : { label: t('organisms.archive') || 'Archive', icon: '🗄️', onClick: () => handleArchive(org.id, org.name, true) }),
      !isCreator && { label: t('organisms.leave') || 'Leave', danger: true, onClick: () => handleLeave(org.id, org.name) },
      isCreator && { label: t('organisms.delete') || 'Delete', danger: true, onClick: () => handleDelete(org.id, org.name) },
    ] : [];

    return html`
      <${ListRow} key=${org.id} open=${isExpanded} panel=${isExpanded ? renderDiscoverDetail(org) : null}
        draggable=${isMine} dragOver=${dragOverId === org.id}
        onDragStart=${isMine ? ((e) => { dragIdRef.current = org.id; e.dataTransfer.effectAllowed = 'move'; }) : undefined}
        onDragOver=${isMine ? ((e) => { e.preventDefault(); setDragOverId(org.id); }) : undefined}
        onDragLeave=${isMine ? (() => setDragOverId(d => (d === org.id ? null : d))) : undefined}
        onDrop=${isMine ? (() => onDropRow(org.id)) : undefined}
        onDragEnd=${isMine ? (() => { dragIdRef.current = null; setDragOverId(null); }) : undefined}>
        <${Lead} text=${orgInitials(org.name)} />
        <${Name} onOpen=${activate} clip meta=${org.description || null}>${(org.name)}<//>
        <${Cell} line>
          <${Mark} title=${typeLabel}>${typeLabel}<//>
          ${org.visibility !== 'public' ? html`<span title=${visLabel}>${LockMark}</span>` : null}
          ${org.archived ? html`<${Mark} kind="status" tone="off" title=${t('organisms.archivedHint') || 'Archived — read-only, hidden from AI operations'}>${t('organisms.archived') || 'archived'}<//>` : null}
        <//>
        ${/* Four counts, always four: the tracks are what hold the row still, and a count left
              out would slide the ones after it into the wrong track. An absent count shows nothing
              and still holds its place. */ ''}
        <${Stats}>
          ${isMine && wsCounts[org.id] !== undefined
            ? html`<${Stat} icon=${'📁'} title=${t('organisms.tabWorkspaces') || 'Workspaces'}>${wsCounts[org.id]}<//>`
            : html`<${Stat} />`}
          <${Stat} icon=${'👥'} title=${t('organisms.members') || 'Members'}>${org.member_count ?? (org.members || []).length}<//>
          <${Stat} icon=${'🤖'} title=${t('organisms.attachedAgents') || 'Attached agents'}>${(org.agentGaiis || []).length}<//>
          ${org.createdAt
            ? html`<${Stat} date title=${t('organisms.createdAt') || 'Created'}>${fmtDate(org.createdAt)}<//>`
            : html`<${Stat} date />`}
        <//>
        ${/* The door sits in a cell of its own so that Open on one row and Join on the next, or
              UNIRSE in Spanish, cannot drag the columns to their left. */ ''}
        <${Doors} menu=${isMine ? menuItems : null} menuLabel=${t('organisms.moreActions') || 'More actions'}>
          ${(isMine || isMember)
            ? html`<${Action} small onClick=${() => openHome(false)}>${t('organisms.open') || 'Open'}<//>`
            : html`<${Action} small onClick=${() => handleJoin(org.id)}>${t('organisms.join') || 'Join'}<//>`}
        <//>
      <//>
    `;
  };

  if (openId) {
    const org = [...(myOrganisms || []), ...publicOrganisms].find(o => o.id === openId) || { id: openId };
    // openWs chosen → that workspace; otherwise the organism's HOME page (tabs incl. workspaces).
    if (openWs) {
      return html`<${Workspace} org=${org} wsId=${openWs} session=${session} showToast=${showToast}
        key=${openWs + (openSpace ? ':' + openSpace : '')} initialSpace=${openSpace}
        onBack=${() => { setOpenWs(null); setOpenSpace(null); }}
        onBackToList=${() => { setOpenWs(null); setOpenSpace(null); setOpenId(null); setOpenSettings(false); loadData(); }} />`;
    }
    return html`
      ${justJoinedOrg === openId ? html`
        <${Note} kind="aside" size="small">
          <${Row} wrap justify="between" gap="medium">
            <div>
              <strong>${(tOr('organisms.joinedBanner.title', 'You are now a member of {name}.')).replace('{name}', org.name || '')}</strong>
              <${Note} kind="meta">${tOr('organisms.joinedBanner.body', 'Connect your own AI to this team and you can use everything here straight from the chat you already use.')}<//>
            </div>
            <${Row}>
              <${Loud} control href="/v1/profile?tab=mcp">${tOr('organisms.joinedBanner.connect', 'Connect your AI')}<//>
              <${Action} tone="text" onClick=${() => setJustJoinedOrg(null)}>${tOr('organisms.joinedBanner.dismiss', 'Browse first')}<//>
            <//>
          <//>
        <//>` : null}
      <${OrganismHome} org=${org} ghii=${ghii} showToast=${showToast}
        initialSettings=${openSettings}
        onOpenWs=${(wsId, space) => { setOpenSpace(space || null); setOpenWs(wsId); }}
        onBack=${() => { setOpenId(null); setOpenSettings(false); loadData(); }}
        onChanged=${loadData}
        onLeave=${() => handleLeave(org.id, org.name)} />
      <${ConfirmUI} />`;
  }

  if (!myOrganisms) return html`<${Note} kind="loading">${t('organisms.loading') || 'Loading organisms...'}<//>`;

  // Open a cross-organism search hit: jump to its organism + workspace, pre-filling the in-workspace
  // search with the query so you land on the filtered result list (reuses Kerros 1).
  const openGHit = (hit) => {
    try { if (hit.workspaceId) sessionStorage.setItem(`aimeat.ws.${hit.organismId}.${hit.workspaceId}.search`, gQuery.trim()); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
    setOpenId(hit.organismId);
    setOpenWs(hit.workspaceId || null);
    setOpenSpace(null);
    setOpenSettings(false);
  };
  // Group the librarian hits under each organism (name from my list / discover), for the results view.
  const orgNameOf = (id) => (myOrganisms || []).find(o => o.id === id)?.name
    || publicOrganisms.find(o => o.id === id)?.name || id;
  const gGroups = {};
  for (const hh of (gHits || [])) { if (!hh.organismId) continue; (gGroups[hh.organismId] = gGroups[hh.organismId] || []).push(hh); }

  // The type sets SAFE defaults (UX-remake v3, P12): a team's internal space must not be born
  // open + public because nobody read three unexplained dropdowns. The user can still change both
  // after picking the type.
  const pickFormType = (v) => {
    setFormType(v);
    if (v === 'team' || v === 'cooperative' || v === 'project' || v === 'company' || v === 'family') {
      setFormPolicy('invite_only');
      setFormVisibility('private');
    } else {
      setFormPolicy('open');
      setFormVisibility('public');
    }
  };
  // A shape brings its own type, join policy and visibility; the person can still change them.
  const pickFormShape = (id) => {
    setFormShape(id);
    const s = shapes.find(x => x.id === id);
    if (!s) return;
    setFormType(s.type); setFormPolicy(s.join_policy); setFormVisibility(s.visibility);
  };
  const chosenShape = shapes.find(x => x.id === formShape) || null;
  const ORG_COLS = 'mark-name-tags-stats-doors';

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuInformation'), t('profile.tabs.organisms')]}
      title=${t('organisms.title') || 'Organisms'}
      desc=${t('organisms.desc') || 'Organisms are groups — communities, teams, clubs, or projects. Create one or join existing ones to share knowledge, coordinate work, and build together.'}
      after=${html`<${ConfirmUI} />`}>

    ${/* Create form (opened from the topbar button) */ ''}
    ${!showCreate ? null : html`
      <${Card} tone="section" title=${t('organisms.createTitle') || 'Create New Organism'}>
        <${Fields}>
          <${Select} fit value=${formShape} onChange=${pickFormShape} ariaLabel=${t('organisms.shapeLabel')} options=${[
            ['', t('organisms.shapeNone')],
            ...shapes.map(s => [s.id, s.label]),
          ]} />
          <${Note} kind="meta">
            ${chosenShape
              ? `${chosenShape.hint} ${t('organisms.shapeMakes', { list: chosenShape.workspaces.map(w => w.name).join(', ') })}`
              : t('organisms.shapeNoneHint')}
          <//>
          <${TextField} placeholder=${t('organisms.namePlaceholder') || 'Name'} ariaLabel=${t('organisms.namePlaceholder') || 'Name'} value=${formName} onInput=${setFormName} />
          <${TextArea} placeholder=${t('organisms.descPlaceholder') || 'Description'} ariaLabel=${t('organisms.descPlaceholder') || 'Description'} value=${formDesc} onInput=${setFormDesc} rows=${2} />
          <${TextField} placeholder=${t('organisms.interestsPlaceholder') || 'Interests (comma separated)'} ariaLabel=${t('organisms.interestsPlaceholder') || 'Interests (comma separated)'} value=${formInterests} onInput=${setFormInterests} />
          <${Row} wrap>
            <${Select} fit value=${formType} onChange=${pickFormType} ariaLabel=${t('organisms.fieldType') || 'Type'} options=${[
              ['community', t('organisms.types.community') || 'Community'],
              ['team', t('organisms.types.team') || 'Team'],
              ['club', t('organisms.types.club') || 'Club'],
              ['cooperative', t('organisms.types.cooperative') || 'Cooperative'],
              ['project', t('organisms.types.project') || 'Project'],
              ['company', t('organisms.types.company')],
              ['family', t('organisms.types.family')],
              ['__custom', t('organisms.typeCustom') || 'Other'],
            ]} />
            ${formType === '__custom' ? html`
              <${TextField} maxLength=${40} value=${formTypeCustom} size="medium"
                placeholder=${t('organisms.typeCustomPlaceholder') || 'Type, in your own words'}
                ariaLabel=${t('organisms.typeCustomPlaceholder') || 'Type, in your own words'}
                onInput=${setFormTypeCustom} />` : null}
            <${Select} fit value=${formPolicy} onChange=${setFormPolicy} ariaLabel=${t('organisms.policyLabel') || 'Join policy'} options=${[
              ['open', t('organisms.policyOpen') || 'Open (anyone can join)'],
              ['approval_required', t('organisms.policyApproval') || 'Approval required'],
              ['invite_only', t('organisms.policyInvite') || 'Invite only'],
            ]} />
            <${Select} fit value=${formVisibility} onChange=${setFormVisibility} ariaLabel=${t('organisms.setVisibility') || 'Who sees'} options=${[
              ['public', t('organisms.visPublic') || 'Public'],
              ['listed', t('organisms.visListed') || 'Listed'],
              ['private', t('organisms.visPrivate') || 'Private'],
            ]} />
          <//>
          <${Note} kind="meta">
            ${tOr('organisms.policyHint.' + formPolicy, '')}${' '}
            ${tOr('organisms.visHint.' + formVisibility, '')}
          <//>
          <${FormActions}>
            <${Loud} control onClick=${handleCreate} disabled=${creating}>
              ${creating ? '...' : (t('organisms.create') || 'Create')}
            <//>
            <${Action} small onClick=${() => setShowCreate(false)}>
              ${t('organisms.cancel') || 'Cancel'}
            <//>
          <//>
        <//>
      <//>
    `}

    ${/* Cross-organism content search: one box over ALL my organisms, results grouped per organism */ ''}
    <${SearchLine} value=${gQuery} onInput=${e => setGQuery(e.target.value)}
      placeholder=${t('search.allOrgsPlaceholder') || 'Search across all organisms…'} label=${t('search.allOrgsPlaceholder') || 'Search across all organisms'}>
      ${gHits !== null ? html`<${Action} small onClick=${() => setGQuery('')}>${t('search.clear') || 'Clear'}<//>` : null}
    <//>

    ${gHits !== null ? html`
      ${gBusy && !gHits.length ? html`<${Note} kind="loading">${t('search.searching') || 'Searching…'}<//>` : null}
      ${!gHits.length && !gBusy ? html`<${Note} kind="quiet">${t('search.noMatches') || 'No matches'}<//>` : null}
      ${Object.entries(gGroups).map(([orgId, hits]) => html`
        <${Group} key=${orgId} title=${orgNameOf(orgId)} count=${hits.length}>
          <${List} cols="name">
            ${hits.map(hh => html`
              <${ListRow} key=${hh.key}>
                <${Name} onOpen=${() => openGHit(hh)} after=${hh.workspaceId ? html` <${Mark}>${hh.workspaceId}<//>` : null}
                  desc=${hh.snippet || ''}>${hh.title || hh.key}<//>
              <//>`)}
          <//>
        <//>`)}
    ` : html`
    ${/* Incoming invitations */ ''}
    <${IncomingInvitations} showToast=${showToast} onChanged=${loadData} />

    ${/* My Organisms */ ''}
    <${FileDrop} hidden accept=".zip,application/zip" inputRef=${orgFileRef} onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; doImportOrg(f); }} />
    <${Section} band title=${t('organisms.myOrganisms') || 'My Organisms'} doors=${html`
      ${myOrganisms.length > 1 ? html`
        <${Select} fit title=${t('organisms.sortTitle') || 'Sort'} ariaLabel=${t('organisms.sortTitle') || 'Sort'} value=${sortMode}
          onChange=${(m) => { setSortMode(m); savePrefs(customOrder, m); }} options=${[
            ['custom', t('organisms.sortCustom') || 'My order'],
            ['name', t('organisms.sortName') || 'Name A–Z'],
            ['newest', t('organisms.sortNewest') || 'Newest first'],
          ]} />` : null}
      <${Action} small disabled=${importingOrg} title=${t('organisms.importOrgHint') || 'Restore an organism from a .zip backup'} onClick=${() => orgFileRef.current && orgFileRef.current.click()}>${'⬆ '}${t('organisms.importOrg') || 'Import'}<//>
      <${Loud} control onClick=${() => setShowCreate(true)}>${'+ '}${t('organisms.createNew') || 'Create Organism'}<//>`}>
    ${(() => {
      // Active organisms drive the working list; archived ones move into a collapsed "Archived"
      // section below (read-only/retired — out of the way, but restorable from there).
      const activeMine = sortedMine.filter(o => !o.archived);
      const archivedMine = sortedMine.filter(o => o.archived);
      return html`
        ${activeMine.length === 0 && archivedMine.length === 0
          ? html`<${Note} kind="quiet">${t('organisms.empty') || 'You are not part of any organisms yet.'}<//>`
          : html`
            ${activeMine.length === 0
              ? html`<${Note} kind="quiet">${t('organisms.allArchived') || 'All your organisms are archived.'}<//>`
              : html`
                <${List} cols=${ORG_COLS} keepCols>${activeMine.map(org => renderOrgRow(org, true))}<//>
                ${sortMode === 'custom' && activeMine.length > 1 ? html`
                  <${Note}>${t('organisms.reorderHint') || 'Drag rows to reorder — the order is saved to your profile.'}<//>` : null}`}
            ${archivedMine.length > 0 ? html`
              <${Section} fold num="" title=${'🗄️ ' + (t('organisms.archivedSection') || 'Archived ({n})').replace('{n}', String(archivedMine.length))} open=${archivedOpen} onToggle=${() => setArchivedOpen(o => !o)}>
                <${List} cols=${ORG_COLS} keepCols>${archivedMine.map(org => renderOrgRow(org, true))}<//>
              <//>` : null}
          `}
      `;
    })()}
    <//>

    ${/* Discover */ ''}
    ${publicOrganisms.length > 0 && html`
      <${Section} band title=${t('organisms.discover') || 'Discover'}>
        <${List} cols=${ORG_COLS} keepCols>${publicOrganisms.map(org => renderOrgRow(org, false))}<//>
      <//>
    `}
    `}
    <//>
  `;
}
