/**
 * @file public/views/public-knowledge-library.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The library of the public knowledge viewer: one catalogue of knowledge AND data, read by
 *   how far the reader reaches (WP11; design canvas "Jaettu data", boards Main, Kirjasto-kirjautunut and
 *   Kirjasto-avaimella). The rows are GET /v1/catalogue/knowledge with `reach`, `kind` and `q`, whose
 *   data rows the node decides with the read's own audience rule, so the list never names a package the
 *   reader cannot open.
 *
 *   IN THE BOARDS' ORDER. The crumb, the title and its sentence for who is reading; the reaches as tiles
 *   with their counts (Public; Shared with you and Yours when signed in; signed out the two others stand
 *   disabled and say when they show); the search with the kind filter (All · n, Knowledge packages · n,
 *   Data · n) and the order; then the rows. A row says what it is, its kind and size, its licence and
 *   freshness for data, who published it and when it changed; a shared row says why the reader sees it:
 *   who shared it, with whom, until when, and when they last read it. "Open" opens a knowledge package's
 *   reading room here, and a data package's existing dataset page (/v1/dataset/{owner}/{name}), which
 *   reads with the reader's own session or party token; the library makes no second page for a dataset.
 *
 *   AN OUTSIDE PARTY (no account) arrives from the recipient page with its token held in memory
 *   (js/services/party-session.js): the page says who they are, then what their shares give, then the
 *   public packages. The key is never on this page.
 *   Made of the component kit and the viewer's existing poster shapes; it writes no class of its own.
 * @structure BrowseView (default export) · fetchLibrary · DataRow · KnowledgeRow · Rows · PartyHead
 * @usage import BrowseView from './public-knowledge-library.js';   html`<${BrowseView} onSelect=${openPackage} />`
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial: the library moved out of views/public-knowledge-viewer.js and made the
 *     catalogue of knowledge and data by reach (WP11).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tn } from '/js/i18n.js';
import { date as fmtDate, num } from '/js/format.js';
import { getSession, getJwt, onAuthChange } from '/js/services/auth.js';
import { partySession, partyHeaders } from '/js/services/party-session.js';
import { INPUT_LIMITS } from '/js/input-limits.js';
import { swallowed } from '/js/swallowed.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row, Name, Who, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { SubHeading } from '/components/SubHeading.js';
import { d as dw, freshWord } from './profile/offers/data-model.js';
import { wordsOf, licenceOf, shortLicence } from './profile/offers/data-words.js';

const c = (key, vars) => t('knowledge.cover.' + key, vars);
const L = (key, vars) => (vars && 'n' in vars ? tn('library.' + key, vars.n, vars) : t('library.' + key, vars));
const enc = encodeURIComponent;
const day = (iso) => (iso ? fmtDate(iso) : '');
const accountOf = (a) => String(a || '').replace(/@[^@]*$/, '');
const PAGE = 20;

/** One line of a Markdown description as plain words: its first paragraph, links and marks removed. */
function firstLine(md) {
  const para = String(md || '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^#/.test(p)) || '';
  return para.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * GET /v1/catalogue/knowledge as this reader: a party reach with the party's token, the rest with the
 * account's session when signed in, else with none.
 */
async function fetchLibrary({ reach, kind, q, page }) {
  const params = new URLSearchParams({ reach, kind, page: String(page), limit: String(PAGE), reaches: '1' });
  if (q) params.set('q', q);
  const jwt = getJwt();
  const headers = reach === 'party' ? partyHeaders() : jwt ? { Authorization: `Bearer ${jwt}` } : {};
  const resp = await fetch(`/v1/catalogue/knowledge?${params}`, { headers });
  if (!resp.ok) { const err = new Error(`HTTP ${resp.status}`); err.status = resp.status; throw err; }
  return (await resp.json())?.data || {};
}

/** What a shared data row says about why the reader sees it, as its tag. */
function whyMark(item) {
  const w = item.why || {};
  if (w.kind === 'organism') return html`<${Mark}>${L('why.organismMark', { name: w.organism_name || w.organism_id })}<//>`;
  if (w.kind === 'members') return html`<${Mark}>${L('why.membersMark')}<//>`;
  if (w.kind === 'share') return html`<${Mark}>${L('why.shareMark')}<//>`;
  if (w.kind === 'own') return html`<${Mark}>${dw('audience.' + (['public', 'members', 'private'].includes(item.sharing?.audience) ? item.sharing.audience : 'private'))}<//>`;
  return null;
}

/** The line under who published it: when it changed, or why a shared row is there. */
function whoLines(item) {
  const w = item.why || {};
  const by = w.by || accountOf(item.author);
  if (item.reach === 'public' || !w.kind || w.kind === 'public') return { who: by, sub: L('updated', { date: day(item.updated) }) };
  if (w.kind === 'own') return { who: by, sub: L('why.reads30', { n: w.reads_30d || 0 }) };
  const parts = [];
  if (w.kind === 'members') parts.push(L('why.members'));
  if (w.kind === 'organism') parts.push(L('why.organism'));
  if (w.kind === 'share') parts.push(w.expires ? L('why.until', { date: day(w.expires) }) : L('why.noEnd'));
  if (w.last_read_at) parts.push(L('why.lastRead', { date: day(w.last_read_at) }));
  return { who: L('why.by', { owner: by }), sub: parts.join(' · ') };
}

function DataRow({ item }) {
  const p = item.datapackage || {};
  const words = wordsOf({ title: p.title || item.name, description: p.description, i18n: p.i18n });
  const licence = p.license ? licenceOf({ aimeat: { license: p.license } }) : null;
  const href = `/v1/dataset/${enc(p.owner || accountOf(item.author))}/${enc(p.name || '')}`;
  const { who, sub } = whoLines(item);
  const marks = [
    html`<${Mark} tone="sun">${L('kind.dataOne')}<//>`,
    whyMark(item),
    html`<${Mark}>${L('tables', { n: p.tables || 0 })} · ${dw('list.rows', { n: num(p.rows || 0) })}<//>`,
    licence ? html`<${Mark}>${shortLicence(licence)}<//>` : null,
    p.freshness?.state ? html`<${Mark}>${freshWord(p.freshness.state)}<//>` : null,
  ].filter(Boolean);
  return html`<${Row} key=${'d' + item.package_id}>
    <${Name} href=${href} desc=${firstLine(words.description) || undefined} marks=${marks}>${words.title || p.name}<//>
    <${Who} sub=${sub}>${who}<//>
    <${Doors}>${item.reach === 'own'
      ? html`<${Action} small row href="/v1/profile?tab=sharedData">${L('own.door')}<//>`
      : html`<${Action} small row href=${href}>${c('open')}<//>`}<//>
  <//>`;
}

function KnowledgeRow({ item, onSelect }) {
  const { who, sub } = whoLines(item);
  const ct = item.content_type ? (t('knowledge.contentTypes.' + item.content_type) || item.content_type) : '';
  const marks = [
    html`<${Mark}>${L('kind.knowledgeOne')}<//>`,
    whyMark(item),
    ct ? html`<${Mark}>${ct}<//>` : null,
    html`<${Mark}>${c('entriesN', { n: item.public_entries ?? item.entries_count ?? 0 })}<//>`,
    item.references_count ? html`<${Mark}>${c('refsVerified', { v: item.verified_references || 0, n: item.references_count })}<//>` : null,
    item.sharing?.allow_clone !== false ? html`<${Mark}>${c('clonable')}<//>` : null,
  ].filter(Boolean);
  return html`<${Row} key=${'k' + item.package_id}>
    <${Name} onOpen=${() => onSelect(item.package_id)} desc=${item.synthesis?.description || undefined} marks=${marks}>${item.name || c('untitled')}<//>
    <${Who} sub=${sub}>${who}<//>
    <${Doors}><${Action} small row onClick=${() => onSelect(item.package_id)}>${c('open')}<//><//>
  <//>`;
}

function Rows({ items, onSelect, empty }) {
  return html`<${List} cols="name-who-doors" empty=${empty} rows=${items}
    render=${(item) => (item.kind === 'data' ? html`<${DataRow} key=${'d' + item.package_id} item=${item} />` : html`<${KnowledgeRow} key=${'k' + item.package_id} item=${item} onSelect=${onSelect} />`)} />`;
}

/** The party's own facts at the top of its library (board Kirjasto-avaimella). */
function PartyHead({ party, shares }) {
  const s = partySession();
  const back = s?.inviteCode ? `/v1/shared-data?invite=${enc(s.inviteCode)}` : null;
  return html`<${Box} name=${party?.display_name || party?.name || ''}
    marks=${[L('party.kind.' + (['person', 'program', 'dataspace'].includes(party?.kind) ? party.kind : 'program'))]}
    doors=${back ? html`<${Action} small href=${back}>${L('party.back')}<//>` : null}>
    <${Note}>${L('party.who', { owner: party?.owner || '' })} ${L('party.shares', { n: shares })}<//>
  <//>`;
}

export default function BrowseView({ onSelect }) {
  const signedIn = !!getSession();
  const party = !signedIn && partySession() && new URLSearchParams(window.location.search).get('reach') === 'party' ? partySession() : null;
  const [reach, setReach] = useState(() => {
    const asked = new URLSearchParams(window.location.search).get('reach');
    return signedIn && ['shared', 'own'].includes(asked) ? asked : party ? 'party' : 'public';
  });
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [answer, setAnswer] = useState(null);     // { packages, total, counts, reaches }
  const [reachCounts, setReachCounts] = useState({});
  const [items, setItems] = useState([]);
  const [publicRows, setPublicRows] = useState(null);   // a party's library shows the public ones under its own
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async ({ r = reach, k = kind, q = search, p = 1 } = {}) => {
    setLoading(true); setError(null);
    try {
      const data = await fetchLibrary({ reach: r, kind: k, q, page: p });
      setAnswer(data);
      // The reaches' counts are kept across loads: a reach other than public does not count the public one.
      setReachCounts((prev) => ({ ...prev, ...(data.reaches || {}) }));
      if (r !== 'public' && r !== 'party' && p === 1) {
        fetchLibrary({ reach: 'public', kind: 'all', q, page: 1 })
          .then((pub) => setReachCounts((prev) => ({ ...prev, public: pub?.counts?.all ?? prev.public })))
          .catch((err) => swallowed('library: the public count', err));
      }
      setItems((prev) => (p > 1 ? [...prev, ...(data.packages || [])] : (data.packages || [])));
      setPage(p);
      if (r === 'party' && p === 1) {
        const pub = await fetchLibrary({ reach: 'public', kind: 'data', q, page: 1 })
          .catch((err) => { swallowed('library: the public rows under a party', err); return { packages: [] }; });
        setPublicRows(pub.packages || []);
      }
    } catch (err) { setError(err.status === 401 ? L('signInAgain') : err.message); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- every input is passed in; the defaults are the current state
  }, []);
  useEffect(() => { load({ r: reach, k: kind, q: search, p: 1 }); }, [reach, kind]); // eslint-disable-line react-hooks/exhaustive-deps -- the search has its own debounced path
  // A sign-in or a sign-out on this page changes what the reader reaches: read again, from the public reach.
  useEffect(() => onAuthChange(() => { setReachCounts({}); setReach('public'); load({ r: 'public', k: kind, q: search, p: 1 }); }), []); // eslint-disable-line react-hooks/exhaustive-deps -- the current kind and search are read at the change
  // The address says the reach, so a reload or a shared link opens the same view.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (reach === 'public') url.searchParams.delete('reach'); else url.searchParams.set('reach', reach);
    history.replaceState(history.state, '', url.toString());
  }, [reach]);
  const onSearch = (v) => { setSearch(v); if (debounceRef.current) clearTimeout(debounceRef.current); debounceRef.current = setTimeout(() => load({ q: v, p: 1, r: reach, k: kind }), 400); };

  const counts = answer?.counts || { all: 0, knowledge: 0, data: 0 };
  const reaches = reachCounts;
  const total = answer?.total || 0;
  const titleKey = party ? 'party' : signedIn ? 'signedIn' : 'public';

  const reachTiles = party ? null : html`
    <${Tabs} tone="tile" kind="view" label=${L('reach.label')} value=${reach} onSelect=${(v) => setReach(v)}
      items=${signedIn ? [
        { value: 'public', label: L('reach.public'), count: reaches.public ?? '…' },
        { value: 'shared', label: L('reach.shared'), count: reaches.shared ?? '…' },
        { value: 'own', label: L('reach.own'), count: reaches.own ?? '…' },
      ] : [
        { value: 'public', label: L('reach.public'), count: reaches.public ?? '…' },
        { value: 'shared', label: L('reach.shared'), disabled: true, title: L('reach.sharedOff') },
        { value: 'party', label: L('reach.party'), disabled: true, title: L('reach.partyOff') },
      ]} />
    <${Note} kind="quiet">${signedIn ? L('reach.sub.' + reach) : L('reach.signedOut')}<//>`;

  const desk = html`
    <div class="kp-desk poster-row--thing">
      <input type="search" class="kp-field" maxLength=${INPUT_LIMITS.line} value=${search} aria-label=${L('search')}
        autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" placeholder=${L('searchPlaceholder')} onInput=${(e) => onSearch(e.target.value)} />
      ${reach === 'party' ? null : html`<${Tabs} tone="filter" label=${L('kind.label')} value=${kind} onSelect=${setKind} items=${[
        { value: 'all', label: L('kind.all'), count: counts.all },
        { value: 'knowledge', label: L('kind.knowledge'), count: counts.knowledge },
        { value: 'data', label: L('kind.data'), count: counts.data },
      ]} />`}
    </div>`;

  const why = reach === 'shared' ? L('why.lead') : reach === 'own' ? L('own.lead') : null;
  const empty = reach === 'shared' ? L('empty.shared') : reach === 'own' ? L('empty.own') : reach === 'party' ? L('empty.party') : c('pubEmpty');

  return html`
    <div class="og-crumb"><span>${window.location.host}</span><span>/</span><span class="og-crumb-here">${t('pkv.title')}</span></div>
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title poster-page-title">${L('title.' + titleKey)}</h1>
        <p class="og-desc">${L('lead.' + titleKey)}</p>
      </div>
      <div class="og-mast-actions"><div class="og-doors">
        ${signedIn ? html`<a class="og-door" href="/v1/profile?tab=sharedData">${L('own.door')}</a>` : null}
        ${signedIn ? html`<a class="og-door" href="/v1/profile?tab=knowledge">${c('pubMine')}</a>` : null}
        <a class="og-door og-door--quiet" href="/v1/help#knowledge">${c('pubWhat')}</a>
      </div></div>
    </div>
    ${reachTiles}
    ${party ? html`<${PartyHead} party=${answer?.party || party.party} shares=${total} />` : null}
    ${desk}
    ${error ? html`<p class="kp-error">${error}</p>` : null}
    ${party ? html`<${SubHeading} rule>${L('party.sharedTitle')}<//>` : null}
    ${why ? html`<${Note}>${why}<//>` : null}
    ${loading && !items.length ? html`<${Note} kind="loading">${c('pubLoading')}<//>` : html`<${Rows} items=${items} onSelect=${onSelect} empty=${empty} />`}
    ${!loading && page * PAGE < total ? html`<p class="kp-more"><button type="button" onClick=${() => load({ p: page + 1, r: reach, k: kind, q: search })}>${t('pkv.loadMore')}</button></p>` : null}
    ${party && publicRows ? html`<${SubHeading} rule>${L('reach.public')}<//><${Rows} items=${publicRows} onSelect=${onSelect} empty=${c('pubEmpty')} />` : null}
    <p class="kp-hint">${c('pubHint')}</p>`;
}
