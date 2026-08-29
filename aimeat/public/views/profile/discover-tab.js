/**
 * @file discover-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Discover: one field for everything a person and their agents brought here,
 *   and under it the map of what is here. Loads the facet counts for each scope (own, public, shared)
 *   and what changed last among the kinds a person reads; a query fetches ranked entries for the
 *   chosen scope and counts the others; a kind or a place browses page by page. Renders the poster
 *   face (discover/view.js). Reads only, through the session; re-fetches on aimeat-live-update.
 * @structure DiscoverTab() — scope, query, view and the loads → the ctx bag → renderDiscoverView
 * @usage registered in profile.js TABS as id 'discover'
 * @version-history
 *   v1.0.1 — 2026-08-30 — The page says it is counting while the map loads, and loads less: the own
 *     scope's counts and its recent rows on mount, the other scopes' counts only when chosen. On
 *     aimeat.io the four parallel enumerations took eight seconds with nothing on screen.
 *   v1.0.0 — 2026-08-30 — The poster face (design canvas "AIMEAT Löydä-sivu", direction A). The scope
 *     buttons, the thirteen type chips and the newest-first dump of every record are replaced by the
 *     search desk, the map of kinds, what changed last, the places and the bookkeeping fold.
 *   v0.1.1 — 2026-07-10 — Route result clicks to each entry's real home instead of the raw fetch href.
 *   v0.1.0 — 2026-06-23 — Phase 4: human-facing master-directory browse (design doc 2026-06-23).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { getSession } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';
import { HUMAN_TYPES } from './discover/frame.js';
import { renderDiscoverView } from './discover/view.js';

const SCOPES = ['own', 'public', 'shared'];
const PAGE = 50;

export default function DiscoverTab() {
  const [scope, setScope] = useState('own');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');          // the submitted query
  const [view, setView] = useState({ kind: 'cover' });
  const [facets, setFacets] = useState({});        // scope → { total, types, segments, places }
  const [recent, setRecent] = useState({});        // scope → entries of the kinds a person reads
  const [results, setResults] = useState(null);    // { entries, total } for query + scope
  const [otherCounts, setOtherCounts] = useState({});
  const [browse, setBrowse] = useState(null);      // { entries, total, page, loading } for a kind or a place
  const [segment, setSegment] = useState('');
  const [recentType, setRecentType] = useState('');
  const [recentOpen, setRecentOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() => new Set());

  const get = useCallback(async (params) => {
    const session = getSession();
    if (!session) return null;
    const res = await session.fetch(`/v1/discover?${params.toString()}`);
    return res?.data || null;
  }, []);
  const getFacets = useCallback(async (s) => {
    const session = getSession();
    if (!session) return null;
    const res = await session.fetch(`/v1/discover/facets?scope=${s}`);
    return res?.data || null;
  }, []);

  // The map: the own scope's counts and what changed last among the kinds a person reads. The other
  // scopes are counted when chosen; every count is a full enumeration on the server.
  const loadFacets = useCallback((s) => {
    getFacets(s).then(f => { if (f) setFacets(prev => ({ ...prev, [s]: f })); }).catch(err => swallowed('discover-tab: facets', err));
  }, [getFacets]);
  const loadMap = useCallback(async () => {
    loadFacets('own');
    const params = new URLSearchParams({ scope: 'own', per_page: '40', type: HUMAN_TYPES.join(',') });
    get(params).then(d => { if (d) setRecent(prev => ({ ...prev, own: d.entries })); }).catch(err => swallowed('discover-tab: recent', err));
  }, [get, loadFacets]);
  useEffect(() => { loadMap(); }, [loadMap]);
  useEffect(() => {
    if (scope === 'own') return;
    if (!facets[scope]) loadFacets(scope);
    if (recent[scope]) return;
    const params = new URLSearchParams({ scope, per_page: '40', type: HUMAN_TYPES.join(',') });
    get(params).then(d => { if (d) setRecent(prev => ({ ...prev, [scope]: d.entries })); }).catch(err => swallowed('discover-tab: recent', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a scope is counted once; the facets it already has are not a reason to count again
  }, [scope, recent, get, loadFacets]);
  const liveRef = useRef(loadMap); liveRef.current = loadMap;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  // A query: the chosen scope's ranked entries, and a count from each other scope for the rail.
  useEffect(() => {
    if (!query) { setResults(null); setOtherCounts({}); return; }
    let alive = true;
    setResults(null);
    get(new URLSearchParams({ scope, q: query, per_page: '100' }))
      .then(d => { if (alive) setResults(d || { entries: [], total: 0 }); })
      .catch(err => { swallowed('discover-tab: search', err); if (alive) setResults({ entries: [], total: 0 }); });
    for (const s of SCOPES.filter(x => x !== scope)) {
      get(new URLSearchParams({ scope: s, q: query, per_page: '1' }))
        .then(d => { if (alive && d) setOtherCounts(prev => ({ ...prev, [s]: d.total })); })
        .catch(err => swallowed('discover-tab: other scope', err));
    }
    return () => { alive = false; };
  }, [query, scope, get]);

  // A kind or a place: rows page by page.
  const browseParams = (page) => {
    const p = new URLSearchParams({ scope, per_page: String(PAGE), page: String(page) });
    if (view.kind === 'kind') { p.set('type', view.type); if (view.bookkeeping) p.set('segment', 'bookkeeping'); else if (segment) p.set('segment', segment); }
    if (view.kind === 'place') p.set('organism', view.organismId);
    return p;
  };
  const viewKey = `${view.kind}|${view.type || ''}|${view.organismId || ''}|${view.bookkeeping ? 'b' : ''}|${segment}|${scope}`;
  useEffect(() => {
    if (view.kind !== 'kind' && view.kind !== 'place') { setBrowse(null); return; }
    let alive = true;
    setBrowse({ entries: [], total: 0, page: 1, loading: true });
    get(browseParams(1))
      .then(d => { if (alive) setBrowse({ entries: d?.entries || [], total: d?.total || 0, page: 1, loading: false }); })
      .catch(err => { swallowed('discover-tab: browse', err); if (alive) setBrowse({ entries: [], total: 0, page: 1, loading: false }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewKey names every input the browse depends on
  }, [viewKey]);
  const browseMore = async () => {
    if (!browse || browse.loading) return;
    const page = browse.page + 1;
    setBrowse(b => ({ ...b, loading: true }));
    try {
      const d = await get(browseParams(page));
      setBrowse(b => ({ entries: [...b.entries, ...(d?.entries || [])], total: d?.total || b.total, page, loading: false }));
    } catch (err) { swallowed('discover-tab: browse more', err); setBrowse(b => ({ ...b, loading: false })); }
  };

  const pickView = (v) => { setView(v); setSegment(''); setBookOpen(false); };
  const submit = () => { setQuery(q.trim()); setMoreOpen(new Set()); setBookOpen(false); };
  const clear = () => { setQ(''); setQuery(''); };
  const toggleMore = (id) => setMoreOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));

  const ctx = {
    scope, setScope, q, setQ, query, submit, clear, view, pickView, facets, recent, results, otherCounts, browse, browseMore,
    segment, setSegment, recentType, setRecentType, recentOpen, setRecentOpen, bookOpen, setBookOpen, moreOpen, toggleMore, openTab,
  };
  return html`${renderDiscoverView(ctx)}`;
}
