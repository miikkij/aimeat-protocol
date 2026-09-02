/**
 * @file appdev-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › AppDev: what the person's coding agents learned while building apps, and
 *   the right start for the next build. The two prompts (flow, build), the pitfalls the agents
 *   filed with filters, search and paging from the server, the template proposals, the platform's
 *   own registry with counts first and rows on demand, and how it all accrues. Holds the state,
 *   the loads and the handlers; renders the poster face (appdev/page.js, appdev/rows.js). Live:
 *   re-reads the filed pitfalls and the proposals on a memory update.
 * @structure AppDevTab — state, loads, handlers, the ctx bag, render
 * @usage registered in views/profile.js TABS as id 'appdev'.
 * @version-history
 *   v2.0.0 — 2026-09-03 — The poster face (design canvas "AppDev: tieto ja kiihdytys", direction A).
 *     On the production node the page was 117 cards in one column, 13 429 px, two checkboxes as
 *     the only filter, and the 88 kB build prompt fetched on every open. The filed pitfalls now
 *     come twenty at a time from the server, filtered by severity, area, model, visibility and
 *     text; the build prompt is fetched when it is copied and downloaded as a file; the registry
 *     shows its counts before its rows; the page says how it accrues and who reads it.
 *   v1.1.0 — 2026-08-08 — Copy labels from the shared common.* keys.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB UI phase).
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t, getLocale } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { apiGet } from '/js/api.js';
import { listOpenItems, addOpenItem, switchOff } from '/js/services/open-items.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import {
  getFlowPromptText, getBuildPromptText, getCuratedPitfalls, queryLearnedPitfalls,
  updateLearnedPitfall, deleteLearnedPitfall, getTemplateProposals, deleteTemplateProposal,
} from '/js/services/appdev.js';
import { a, goTab } from './appdev/frame.js';
import { renderPage } from './appdev/page.js';

const PAGE = 20;
const FILTERS0 = { severity: '', category: '', model: '', status: 'active', shared: undefined, includeShared: false };

export default function AppDevTab({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [flow, setFlow] = useState('');
  const [build, setBuild] = useState('');           // fetched when copied, not on open (88 kB)
  const [buildLength, setBuildLength] = useState(0);
  const [shown, setShown] = useState(null);         // 'flow' while the flow prompt is open inline
  const [openItems, setOpenItems] = useState({});   // { flow: item, build: item }
  const [learned, setLearned] = useState(null);     // the current page + facets, null while loading
  const [critical, setCritical] = useState(null);   // facets of the critical entries, for the strip
  const [filters, setFiltersState] = useState(FILTERS0);
  const [q, setQState] = useState('');
  const [allAreas, setAllAreas] = useState(false);
  const [proposals, setProposals] = useState(null);
  const [curatedSummary, setCuratedSummary] = useState(null);
  const [curated, setCurated] = useState(null);
  const [curatedFilter, setCuratedFilterState] = useState({ severity: '', area: '' });
  const [overview, setOverview] = useState({ templates: 0, packs: 0, packsProven: 0 });
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(null);

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), true);

  /* ── loads ── */

  // The filters and the search live in refs as well as state so a live update or "show more"
  // re-reads exactly what is on screen without re-creating the load on every keystroke.
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const qRef = useRef(q); qRef.current = q;

  const loadLearned = useCallback(async (offset = 0, append = false) => {
    try {
      const { includeShared, ...F } = filtersRef.current;
      const res = await queryLearnedPitfalls({ ...F, include_shared: includeShared || undefined, q: qRef.current, limit: PAGE, offset });
      setLearned((prev) => (append && prev ? { ...res, pitfalls: [...prev.pitfalls, ...res.pitfalls] } : res));
    } catch (err) { swallowed('appdev-tab: learned', err); setLearned((prev) => prev || { pitfalls: [], total: 0, limit: PAGE, offset: 0, facets: {}, filtered_facets: {}, community: 0 }); }
  }, []);

  const loadCritical = useCallback(async () => {
    try {
      const res = await queryLearnedPitfalls({ severity: 'critical', status: 'active', limit: 1 });
      setCritical(res.filtered_facets || {});
    } catch (err) { swallowed('appdev-tab: critical', err); }
  }, []);

  const loadProposals = useCallback(async () => {
    try { setProposals((await getTemplateProposals()).templates || []); }
    catch (err) { swallowed('appdev-tab: proposals', err); setProposals([]); }
  }, []);

  useEffect(() => {
    loadLearned();
    loadCritical();
    loadProposals();
    // The flow prompt is small and the slab copies it at the click, so it is read once on open.
    getFlowPromptText().then(setFlow).catch((err) => swallowed('appdev-tab: flow', err));
    getCuratedPitfalls({ limit: 1 }).then(setCuratedSummary).catch((err) => swallowed('appdev-tab: curated', err));
    apiGet('/v1/appdev/overview?sections=library_packs,app_templates')
      .then((res) => {
        const d = res?.data || {};
        const packs = d.library_packs?.items || [];
        setOverview({ templates: d.app_templates?.total || 0, packs: d.library_packs?.total || 0, packsProven: packs.filter((p) => (p.proven_models || []).length).length });
      })
      .catch((err) => swallowed('appdev-tab: overview', err));
    listOpenItems()
      .then((list) => setOpenItems({ flow: list.find((i) => i.origin === 'appdev.flow') || null, build: list.find((i) => i.origin === 'appdev.build') || null }))
      .catch((err) => swallowed('appdev-tab: open items', err));
  }, [loadLearned, loadCritical, loadProposals]);

  const liveRef = useRef(null);
  liveRef.current = () => { loadLearned(); loadCritical(); loadProposals(); };
  useEffect(() => onLiveUpdate(['memory'], () => liveRef.current()), []);

  /* ── filters, search, paging ── */

  function setFilters(patch) {
    const next = { ...filtersRef.current, ...patch };
    filtersRef.current = next;
    setFiltersState(next);
    setExpanded(null);
    loadLearned();
  }

  const searchTimer = useRef(null);
  function setQ(value) {
    setQState(value);
    qRef.current = value;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadLearned(), 300);
  }

  async function loadMore() {
    if (!learned) return;
    setBusy('more');
    try { await loadLearned(learned.pitfalls.length, true); }
    finally { setBusy(null); }
  }

  const toggleRow = (key) => setExpanded(expanded === key ? null : key);

  /* ── the filed pitfalls ── */

  async function toggleShare(p) {
    setBusy(p.key);
    try {
      await updateLearnedPitfall(p.category, p.slug, { share: !p.shared });
      showToast?.(!p.shared ? a('sharedToast') : a('privateToast'));
      await loadLearned();
    } catch (e) { fail(e); }
    finally { setBusy(null); }
  }

  async function toggleOutdated(p) {
    setBusy(p.key);
    try {
      await updateLearnedPitfall(p.category, p.slug, { status: p.status === 'outdated' ? 'active' : 'outdated' });
      showToast?.(p.status === 'outdated' ? a('activeToast') : a('outdatedToast'));
      await Promise.all([loadLearned(), loadCritical()]);
    } catch (e) { fail(e); }
    finally { setBusy(null); }
  }

  function removeLearned(p) {
    confirm(a('removeConfirm', { title: p.title }), async () => {
      setBusy(p.key);
      try {
        await deleteLearnedPitfall(p.category, p.slug);
        showToast?.(a('removedToast'));
        if (expanded === p.key + (p.owner || '')) setExpanded(null);
        await Promise.all([loadLearned(), loadCritical()]);
      } catch (e) { fail(e); }
      finally { setBusy(null); }
    }, { danger: true });
  }

  /* ── the proposals ── */

  function removeProposal(p) {
    confirm(a('removeProposalConfirm', { title: p.title }), async () => {
      setBusy('tpl:' + p.id);
      try {
        await deleteTemplateProposal(p.id);
        showToast?.(a('removedToast'));
        if (expanded === 'tpl:' + p.id) setExpanded(null);
        await loadProposals();
      } catch (e) { fail(e); }
      finally { setBusy(null); }
    }, { danger: true });
  }

  /* ── the registry ── */

  async function loadCurated() {
    setBusy('curated');
    try { setCurated(await getCuratedPitfalls({ limit: 100 })); }
    catch (e) { fail(e); }
    finally { setBusy(null); }
  }

  function setCuratedFilter(patch) {
    setCuratedFilterState({ ...curatedFilter, ...patch });
    if (!curated) loadCurated();
  }

  /* ── the prompts ── */

  const buildPromise = useRef(null);
  function prefetchBuild() {
    if (build || buildPromise.current) return buildPromise.current;
    buildPromise.current = getBuildPromptText(getLocale())
      .then((text) => { setBuild(text); setBuildLength(text.length); return text; })
      .catch((err) => { buildPromise.current = null; swallowed('appdev-tab: build prompt', err); return ''; });
    return buildPromise.current;
  }

  async function copyBuild() {
    setBusy('build');
    try {
      // Usually already here from the hover; otherwise the fetch runs inside the click's activation.
      const text = build || await prefetchBuild();
      if (!text) throw new Error(a('buildUnavailable'));
      await navigator.clipboard.writeText(text);
      showToast?.(a('buildCopiedToast'));
    } catch (e) { fail(e, a('buildUnavailable')); }
    finally { setBusy(null); }
  }

  async function toggleOpenItem(id) {
    setBusy('item:' + id);
    try {
      const current = openItems[id];
      if (current) {
        await switchOff(current.id);
        setOpenItems({ ...openItems, [id]: null });
        showToast?.(a('offWorklistToast'));
      } else {
        const title = a(id === 'flow' ? 'flowTitle' : 'buildTitle');
        const item = await addOpenItem({ title, kind: 'app', prompt_ref: id === 'build' ? 'build-app' : null, origin: 'appdev.' + id });
        setOpenItems({ ...openItems, [id]: item });
        showToast?.(a('toWorklistToast', { title }));
      }
    } catch (e) { fail(e); }
    finally { setBusy(null); }
  }

  const ctx = {
    flow, buildLength, shown, openItems, learned, critical, filters, q, allAreas, proposals,
    curatedSummary, curated, curatedFilter, expanded, busy, ConfirmUI, showToast, goTab,
    templates: overview.templates, packs: overview.packs, packsProven: overview.packsProven,
    appsTaught: countApps(learned), noApp: learned ? countNoApp(learned) : 0,
    setFilters, setQ, setAllAreas, loadMore, toggleRow, toggleShare, toggleOutdated, removeLearned,
    removeProposal, loadCurated, setCuratedFilter, prefetchBuild, copyBuild, toggleOpenItem,
    toggleShow: (id) => setShown(shown === id ? null : id),
  };
  return renderPage(ctx);
}

/** How many distinct apps the filed entries point at, and how many point at none: from the scope facets. */
function countApps(learned) { return learned?.facets?.app ? Object.keys(learned.facets.app).filter((k) => k !== '(none)').length : 0; }
function countNoApp(learned) { return learned?.facets?.app?.['(none)'] || 0; }
