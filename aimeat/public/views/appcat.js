/**
 * @file public/views/appcat.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat: the app catalogue at /v1/appcat, the old /app-catalog.html rebuilt on the
 *   component library, the same page on the same data (Jouni: "täysin samanlainen kuin nykyinen
 *   app-catalogue … teemattavissa, preactia käyttävä ja komponentisoitu"). This file is the shell:
 *   the index at the left, the masthead, the band, the search and order, the Active Extensions bar,
 *   the three lists and the foot, the page's keys and its deep links; it draws the dialog host, the
 *   detail view and the notice once. The site's own top bar, look picker and language switch stand in
 *   for the old page's bar. Nothing is kept in the browser's own storage: the view chosen lives in the
 *   address (?view=), the stars on the node. Writes no class; the parts are components.
 *
 *   Deep links (features.md F287–F291): ?lang= (the site reads it), ?view=library|community|favorites,
 *   ?filter=<state or condition>, ?q=<search>, ?create=1 (the generate-with-AI dialog), ?add=1 (sign
 *   in, then the Add dialog on its Paste tab). Keys (F170–F173): Escape closes the app viewer, else
 *   the detail view; Ctrl/Cmd+N opens Add; Ctrl/Cmd+F brings the focus to the search; while a dialog
 *   is open the page's keys stand aside.
 * @structure AppCat({ navigate }) (default) · readView() · writeView(v)
 * @usage routed at /v1/appcat by spa.html (and portal.ts spaRoutes).
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat, the shell builder).
 */
import { h } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { IndexFrame } from '/components/IndexFrame.js';
import { ToastBox } from '/components/Toast.js';
import { onAuthChange, authLoaded } from '/js/services/auth.js';
import { onLocaleChange } from '/js/i18n.js';
import { x } from '/views/appcat/i18n.js';
import { useCatalog, reloadCatalog, closeDetail, clearNotice, appRef } from '/views/appcat/store.js';
import { DialogHost, openDialog } from '/views/appcat/dialogs/host.js';
import * as detailModule from '/views/appcat/detail.js';
import { CatRail } from '/views/appcat/rail.js';
import { CatMasthead, openAdd } from '/views/appcat/masthead.js';
import { CatBand, CatTools, CortexBar, SEARCH_ID } from '/views/appcat/tools.js';
import { LibraryList, CommunityList, FavouritesList, CatFoot } from '/views/appcat/lists.js';
import { KUNTO_KEYS, STATES, filterRows, sortRows, stateCounts } from '/views/appcat/model.js';

const html = htm.bind(h);
const VIEWS = ['library', 'community', 'favorites'];

/** The view the address names (F71, F262 → ?view=); an unknown one is the library (F70). */
export function readView() {
  const v = new URLSearchParams(location.search).get('view');
  return VIEWS.includes(v) ? v : 'library';
}

/** Keep the chosen view in the address, so a reload or a shared link opens it again. */
export function writeView(v) {
  const url = new URL(location.href);
  if (v === 'library') url.searchParams.delete('view'); else url.searchParams.set('view', v);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

/** Whether a dialog of the page is open (F173): the page's own keys stand aside then. */
const dialogOpen = () => !!document.querySelector('dialog[open]');

export default function AppCat() {
  const cat = useCatalog();
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [view, setView] = useState(readView);
  const [q, setQ] = useState(() => (params.get('q') || '').trim());
  const [tag, setTag] = useState(null);
  const [stateFilter, setStateFilter] = useState(() => {
    const f = params.get('filter');
    return STATES.includes(f) || KUNTO_KEYS.includes(f) ? f : null;
  });
  const [sort, setSort] = useState('newest');
  const [tagsOpen, setTagsOpen] = useState(false);
  const viewer = useRef(null);

  // The listing: on load, on a sign-in or sign-out, and on a language change (F120, F86, F342).
  useEffect(() => {
    reloadCatalog();
    const offAuth = onAuthChange(() => reloadCatalog());
    const offLocale = onLocaleChange(() => { reloadCatalog(); document.title = x('header.title') + ' — AIMEAT'; });
    document.title = x('header.title') + ' — AIMEAT';
    // The app viewer is the detail builder's; the shell asks it whether it is open before Escape
    // closes the detail view (F170). A missing module or export only means there is no viewer yet.
    import('/views/appcat/viewer.js').then((m) => { viewer.current = m; }, () => { viewer.current = null; });
    return () => { offAuth(); offLocale(); };
  }, []);

  // Deep links that open a dialog (F290, F291). ?add=1 waits for the sign-in library (100 ms, up to
  // 50 times), so the Add dialog never opens with no session behind it.
  useEffect(() => {
    if (params.get('create') === '1') openDialog('generate', { mode: 'new' });
    if (params.get('add') === '1') {
      let tries = 50;
      const wait = () => {
        if (authLoaded() || tries <= 0) { openAdd(); return; }
        tries -= 1;
        setTimeout(wait, 100);
      };
      wait();
    }
  }, [params]);

  // The page's keys (F170–F173).
  useEffect(() => {
    const onKey = (e) => {
      if (dialogOpen()) return;
      if (e.key === 'Escape') {
        const v = viewer.current;
        if (v && typeof v.isViewerOpen === 'function' && v.isViewerOpen()) { v.closeViewer?.(); return; }
        closeDetail();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        openDialog('add', { tab: 'paste' }); // as the old page: the key skips the sign-in step (F171)
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        document.getElementById(SEARCH_ID)?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A notice closes after 3.5 s, an error after 6.5 s (F344).
  const shownNotice = cat.notice;
  useEffect(() => {
    if (!shownNotice) return undefined;
    const tm = setTimeout(clearNotice, shownNotice.kind === 'error' ? 6500 : 3500);
    return () => clearTimeout(tm);
  }, [shownNotice]);

  const chooseView = (v) => { const next = VIEWS.includes(v) ? v : 'library'; setView(next); writeView(next); };
  const chooseState = (s) => setStateFilter((cur) => (cur === s ? null : s));

  const favRowsAll = cat.all.filter((sa) => cat.favourites.has(appRef(sa)));
  const filtering = !!(q.trim() || tag);
  const ownRows = sortRows(filterRows(cat.own, { tag, state: stateFilter, q, bound: cat.skillsBound, own: true }), sort);
  // The community and the favourites keep each row's number from the ordered list under a search
  // or a tag (the old page hid rows without numbering them anew).
  const communityOrder = sortRows(cat.community, sort);
  const favOrder = sortRows(favRowsAll, sort);
  const communityRows = filterRows(communityOrder, { tag, q });
  const favRows = filterRows(favOrder, { tag, q });
  // The moments the old page drew a list anew, which left no row open.
  const ownRedraw = [q, tag, stateFilter, sort, cat.favourites, cat.all];
  const serverRedraw = [sort, cat.favourites, cat.all];
  const counts = stateCounts(cat.own, cat.skillsBound);
  const tagRows = view === 'community' ? cat.community : view === 'favorites' ? favRowsAll : cat.own;
  const Detail = detailModule.Detail || detailModule.default;

  const rail = html`<${CatRail} view=${view} onView=${chooseView} loaded=${cat.loaded}
    counts=${{ library: cat.own.length, community: cat.community.length, favorites: favRowsAll.length }}
    states=${view === 'library' ? counts : null} stateFilter=${stateFilter} onState=${chooseState}
    tagRows=${tagRows} tag=${tag} onTag=${setTag} tagsOpen=${tagsOpen} onTagsOpen=${() => setTagsOpen(!tagsOpen)} />`;

  return html`
    <${IndexFrame} dense index=${rail} label=${x('header.title')}>
      <${CatMasthead} own=${cat.own} me=${cat.me} loaded=${cat.loaded} />
      ${view === 'library' && cat.loaded && cat.own.length > 0 ? html`<${CatBand} counts=${counts} n=${cat.own.length} />` : null}
      <${CatTools} q=${q} onQuery=${setQ} sort=${sort} onSort=${setSort} />
      ${view === 'library' ? html`<${CortexBar} />` : null}
      ${view === 'library' ? html`<${LibraryList} rows=${ownRows} total=${cat.own.length} loaded=${cat.loaded} filtering=${filtering} favourites=${cat.favourites} closeOn=${ownRedraw} />` : null}
      ${view === 'community' ? html`<${CommunityList} rows=${communityRows} order=${communityOrder} total=${cat.community.length} loaded=${cat.loaded} filtering=${filtering} favourites=${cat.favourites} closeOn=${serverRedraw} />` : null}
      ${view === 'favorites' ? html`<${FavouritesList} rows=${favRows} order=${favOrder} total=${favRowsAll.length} favourites=${cat.favourites} closeOn=${serverRedraw} />` : null}
      <${CatFoot} loaded=${cat.loaded} n=${cat.own.length} />
    <//>
    <${DialogHost} />
    ${cat.detail && Detail ? html`<${Detail} app=${cat.detail} onClose=${closeDetail} />` : null}
    ${cat.notice ? html`<div onClick=${clearNotice}><${ToastBox} toast=${{ msg: cat.notice.text, type: cat.notice.kind }} role="status" /></div>` : null}`;
}
