/**
 * @file libraries-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: the builder's shelf of libraries. Every library pack the node serves,
 *   from GET /v1/library-packs in the reader's language, on three shelves (the base, ready-made UI,
 *   third-party at a fixed version), each row saying what the library gives, the name the code
 *   calls it by, how many published apps load it (the dependency map) and, opened in place, the
 *   include lines, the text an AI gets, the API, the model words explained, the proof ledger, who
 *   uses it, where it is seen working, version and licence, and the changelog. This file is the
 *   state and the handlers; the render is libraries/page.js and libraries/rows.js.
 * @structure LibrariesTab() — state (packs, details, filters, queries, expanded) + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'libraries'.
 * @version-history
 *   v2.2.1 -- 2026-11-27 -- `folds` also holds the three shelves, unset until the person presses one.
 *   v2.2.0 -- 2026-11-27 -- The dependency map it already reads is also narrowed to the reader's own
 *     apps (`appsUsing.mine`: pack id → filenames), so the page can say which deprecated library an
 *     app of theirs still loads; and the fold state of the faces and the AI rows (usability pass of
 *     the Settings pages).
 *   v2.1.0 — 2026-10-03 — Reads GET /v1/themes/fonts for the Faces section (the font manager).
 *   v2.0.0 — 2026-09-03 — Poster face (design canvas "AIMEAT Kirjastot-sivu", direction A): rows
 *     on three shelves instead of a card wall, the styling bundle shown, deprecated packs name their
 *     successor, "who uses it" from the dependency map, the AI rule and per-library AI text copied
 *     from the page, the tier words said in plain words, opened in place.
 *   v1.2.0 — 2026-07-18 — reuse ext-card / badge / ext-detail-section styling to match Extensions.
 *   v1.1.0 — 2026-07-18 — clickable cards → full detail view (ai_doc, changelog, includes, proofs).
 *   v1.0.0 — 2026-07-18 — initial: unified library catalogue + maturity.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t, getLocale } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { getNodeUrl, getSession } from '/js/services/auth.js';
import { copyToClipboard } from '/js/utils.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { renderPage } from './libraries/page.js';
import { x, aiTextFor } from './libraries/frame.js';

const emptyFilter = () => ({ status: '', model: '', use: '', proven: false, who: '' });

export default function LibrariesTab({ showToast }) {
  const [packs, setPacks] = useState(null);
  const [appsUsing, setAppsUsing] = useState(null);
  const [fonts, setFonts] = useState(null);
  const [details, setDetails] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [docShown, setDocShown] = useState(null);
  const [filters, setFilters] = useState({ base: emptyFilter(), ui: emptyFilter(), third: emptyFilter() });
  const [queries, setQueries] = useState({ base: '', ui: '', third: '' });
  const [shown, setShownState] = useState({ base: 20, ui: 20, third: 20 });
  // The page's rows that open in place: the three shelves (unset: open when the shelf holds a library
  // in use, libraries/page.js), the faces, and the rule and facts for an AI.
  const [folds, setFolds] = useState({ faces: false, ai: false });

  // The list is fetched in the reader's language, so a language switch fetches it again.
  const locale = getLocale();
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/v1/library-packs?lang=${encodeURIComponent(locale)}`);
      const d = await r.json();
      setPacks(d.data?.packs || []);
    } catch (e) { swallowed('libraries: list', e); setPacks([]); }
    // How many published apps load any library: the whole map, counted once. Owner-only door;
    // when it is not reachable the strip says how many libraries are in use instead.
    try {
      const m = await apiGet('/v1/dependencies');
      const apps = m?.data?.apps || [];
      const using = apps.filter((a) => (a.requires?.packs || []).length || (a.requires?.cortex || []).length).length;
      // The same map, narrowed to the reader's own apps ("owner/filename" refs): pack id → the
      // filenames that load it. A cortex-kind pack's id is its cortex name. It is what lets the page
      // say that one of the reader's apps still loads a deprecated library.
      const owner = getSession()?.owner || '';
      const mine = {};
      for (const a of apps) {
        const [who, ...rest] = String(a.app || '').split('/');
        if (!owner || who !== owner) continue;
        for (const r of [...(a.requires?.packs || []), ...(a.requires?.cortex || [])]) (mine[r.name] ||= []).push(rest.join('/'));
      }
      setAppsUsing({ using, total: apps.length, mine });
    } catch (e) { swallowed('libraries: map', e); }
    // Every face this server serves, with its licence (the font manager): a public read.
    try {
      const f = await apiGet('/v1/themes/fonts');
      setFonts(f?.data || null);
    } catch (e) { swallowed('libraries: faces', e); }
  }, [locale]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(null, load), [load]);

  const loadDetail = async (p) => {
    try {
      const r = await fetch(`/v1/library-packs/${encodeURIComponent(p.id)}`);
      const d = await r.json();
      const pack = d.data?.pack;
      setDetails((m) => ({ ...m, [p.id]: pack || { error: d.error?.message || t('profile.error') } }));
      return pack || null;
    } catch (e) {
      swallowed('libraries: detail', e);
      setDetails((m) => ({ ...m, [p.id]: { error: e?.message || t('profile.error') } }));
      return null;
    }
  };
  const toggle = (p) => {
    if (expanded === p.id) { setExpanded(null); setDocShown(null); return; }
    setExpanded(p.id);
    setDocShown(null);
    if (!details[p.id]) loadDetail(p);
  };
  const toggleDoc = (p) => setDocShown((s) => (s === p.id ? null : p.id));

  /** The row's own door: the library's text for an AI, fetched first when the row was never opened. */
  const copyForAi = async (p) => {
    const d = details[p.id] && !details[p.id].error ? details[p.id] : await loadDetail(p);
    const ok = await copyToClipboard(aiTextFor(p, d));
    showToast?.(ok === false ? x('copyFailed') : x('copiedToast', { id: p.id }), ok === false);
  };

  const ctx = {
    nodeUrl: getNodeUrl(), showToast,
    packs, appsUsing, fonts, details, expanded, docShown, filters, queries, shown, folds,
    setFold: (k, open) => setFolds((f) => ({ ...f, [k]: open })),
    setFilter: (key, patch) => { setFilters((f) => ({ ...f, [key]: { ...f[key], ...patch } })); setShownState((s) => ({ ...s, [key]: 20 })); },
    setQuery: (key, q) => { setQueries((m) => ({ ...m, [key]: q })); setShownState((s) => ({ ...s, [key]: 20 })); },
    setShown: (key, n) => setShownState((s) => ({ ...s, [key]: n })),
    toggle, toggleDoc, copyForAi,
  };
  return renderPage(ctx);
}
