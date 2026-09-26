/**
 * @file public/views/profile/memory-tab/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Memory page in the poster face (design canvas "AIMEAT Muistin sivu", direction A).
 *   The COVER divides the store into what a person owns in four senses: their own key spaces, the
 *   organisms' content they or their agents wrote, the machine's bookkeeping (notices, meters,
 *   receipts: theirs, but rarely for them to read, so a fold), and files. Then what has happened,
 *   what has gone stale (keys nobody changed in 90 days), and who else can read what (public keys,
 *   key-space shares, the federation). A key space and a record are each a PAGE under the same
 *   crumb; the old flat list with its bulk tools, the public discovery, the remote nodes, the
 *   collection and export/import are pages too, reached from the rail. Pure render functions over
 *   the ctx bag memory-tab.js assembles; every write goes through the handlers that already existed.
 * @structure SYSTEM_SPACES · renderMemoryView (cover or page) · renderCover · renderSpace ·
 *   renderRecord · renderPage
 * @usage import { renderMemoryView } from './memory-tab/cover.js';
 * @version-history
 *   v1.24.0 -- 2026-09-26 -- A stored value as written is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.23.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.22.0 -- 2026-09-26 -- A key is the Key (.key-name, css/components/key-name.css): the listings' .mp-key, a key space's key button, and the key in the search's and the history's event rows (a unification: the look most tabs use).
 *   v1.21.0 -- 2026-09-26 -- The agent drop-down among the masthead's tags is the Select field (.select-field), not a select inside a grey chip (a unification: the look most tabs use).
 *   v1.20.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.19.0 -- 2026-09-25 -- Active and Archived, which choose what the key list shows, are the Tab's fold tone (.poster-tab--fold, the shown one is-on and aria-pressed), a unification: Jouni's decision "Tabs and filters".
 *   v1.18.0 -- 2026-09-25 -- A file's mark (its picture, or the first letters of its kind) is the avatar box (.poster-box--avatar, the small cut); the kind is written in capitals, as it was shown, a unification: the look most tabs use.
 *   v1.17.0 -- 2026-09-25 -- The order of a key space's keys is a row of Tabs (.poster-tab, the chosen one .is-on; the dots between them go), and "show all N" is the action link (.poster-action), a unification: Jouni's decisions "Tabs and filters" and "Action link".
 *   v1.16.0 -- 2026-09-25 -- A record's flat value is the Facts (css/components/facts.css, the wide cut), a unification: the look most tabs use.
 *   v1.15.0 -- 2026-09-25 -- The tables of key spaces, the keys of a space, the files, the stale keys, who else sees and a record's shares are the Listing (css/components/listing.css), a unification: the look most tabs use. A table's head row now sits in the same grid as its rows.
 *   v1.14.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.11.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.10.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.9.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.8.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.7.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.6.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.5.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.4.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.3.0 -- 2026-09-13 -- Compose the record value's top rule from poster.css.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-06 — The public/members chips in a table of spaces move into their own mark
 *     group, pushed to the far end of the name cell so they line up down the table.
 *   v1.0.0 — 2026-08-29 — Initial. Replaces the two tab rows, the tools box, the two search fields
 *     and the 55 000 px flat list as the landing view.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, num as fmtNum } from '/js/format.js';
import { CopyButton } from '/components/CopyButton.js';
import { Markdown } from '/components/Markdown.js';
import { detectImage, ImageView } from '/components/ImageDeliverable.js';
import TagEditor from '/js/components/tag-editor.js';
import AuthImage from '/js/components/auth-image.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { tr, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { formatBytes, formatRelativeTime, shortTok, groupOfKey, displayRemainder, VIS_OPTIONS } from './helpers.js';
import { fileCategory, fileBytesUrl } from './file-helpers.js';
import { MemoryForm, FileUploadForm, CartTray } from './components.js';
import { renderEntries } from './entries-view.js';
import { renderBrowsePanel } from './browse-view.js';
import { Hint } from '/components/Hint.js';

/* Key spaces the node and the agents write for their own use. Theirs to own, rarely theirs to read. */
export const SYSTEM_SPACES = new Set(['notif', 'ai-usage', 'commerce', 'agents', 'generator', 'org', 'gate', 'usage']);

const STALE_DAYS = 90;
const TABLE_ROWS = 12;   // a table shows this many key spaces before asking for the rest
const c = (key, fb) => tr('profile.memory.cover.' + key, fb);
const num = (n) => fmtNum(Number(n || 0));
const day = (iso) => fmtDate(iso);
const agentOf = (gaii) => { const s = String(gaii || ''); return s.includes('#') ? s.split('#')[0] : ''; };
const isStale = (m) => { const at = m.updated_at || m.created_at; return !!at && (Date.now() - new Date(at).getTime()) > STALE_DAYS * 864e5; };
const byUpdated = (a, b) => +new Date(b.updated_at || b.created_at || 0) - +new Date(a.updated_at || a.created_at || 0);

/* ── The store in four parts ───────────────────────────────────────────────────────────────── */
export function classify(memories, orgNames) {
  const spaces = new Map();
  for (const m of memories || []) {
    const g = groupOfKey(m.key);
    let s = spaces.get(g.id);
    if (!s) {
      const bucket = g.kind === 'organism' ? 'org' : (SYSTEM_SPACES.has(g.id) ? 'sys' : 'own');
      const label = g.kind === 'organism' ? (orgNames[g.uuid] || shortTok(g.uuid)) : g.kind === 'other' ? (t('profile.memory.groupOther') || 'other') : g.id;
      s = { id: g.id, g, bucket, label, items: [], bytes: 0, publicN: 0, membersN: 0 };
      spaces.set(g.id, s);
    }
    s.items.push(m);
    s.bytes += Number(m.bytes) || 0;
    if (m.visibility === 'public') s.publicN++;
    if (m.visibility === 'members') s.membersN++;
  }
  const all = [...spaces.values()];
  for (const s of all) { s.items.sort(byUpdated); s.latest = s.items[0] || null; }
  all.sort((a, b) => (a.latest && b.latest ? byUpdated(a.latest, b.latest) : b.items.length - a.items.length));
  return { spaces, own: all.filter(s => s.bucket === 'own'), org: all.filter(s => s.bucket === 'org'), sys: all.filter(s => s.bucket === 'sys') };
}

const visChip = (v) => html`<span class=${`poster-chip ${v === 'public' ? 'poster-chip--sun' : ''}`}>${t('knowledge.visibility.' + (v || 'private')) || v}</span>`;

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
function crumb(ctx, parts) {
  const home = () => ctx.pickView({ kind: 'cover' });
  return html`
    <div class="og-crumb">
      <span>${tr('nav.profile', 'Settings')}</span><span>/</span>
      ${parts.length ? html`<button type="button" class="og-crumb-link" onClick=${home}>${t('profile.memory.title') || 'Memory'}</button>` : html`<span class="og-crumb-here">${t('profile.memory.title') || 'Memory'}</span>`}
      ${parts.map((p, i) => html`<span key=${i}>/</span>${i === parts.length - 1 ? html`<span class="og-crumb-here">${p.label}</span>` : html`<button type="button" class="og-crumb-link" onClick=${p.go}>${p.label}</button>`}`)}
    </div>`;
}

const PAGES = [
  ['all', 'allKeys', 'All as keys'], ['discover', 'discover', 'Public'], ['remote', 'remote', 'Remote nodes'],
  ['archived', 'archived', 'Archived'], ['cart', 'cart', 'Collection'], ['tools', 'tools', 'Export and import'],
];
function pageDoors(ctx, current) {
  return PAGES.map(([id, key, fb]) => html`
    <button type="button" class=${`og-rail-link ${current === id ? 'on' : ''}`} key=${id} onClick=${() => ctx.pickView({ kind: 'page', id })}>
      <i>·</i>${c(key, fb)}<em>${id === 'cart' ? (ctx.cart.length || '→') : '→'}</em>
    </button>`);
}

function renderPage(ctx, { id, crumbs, title, sub = null, doors = null, rail = null, children }) {
  return html`
    <div class="og og-mp og-page">
      ${crumb(ctx, crumbs)}
      <div class="og-mast og-mast--page">
        <div class="og-mast-words"><h1 class=${`og-title poster-page-title ${id === 'record' ? 'mp-title--key' : ''}`}>${title}${sub ? html`<small>${sub}</small>` : null}</h1></div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      <div class="og-grid">
        <div class="og-main poster-row--thing">${children}</div>
        <div class="mp-side">
          ${rail}
          <nav class="og-rail" aria-label=${c('railTitle', 'In your memory')}>
            <span class="og-rail-label">${c('railTitle', 'In your memory')}</span>
            <button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'cover' })}><i>←</i>${c('backToMemory', 'Back to memory')}</button>
            <hr />
            ${pageDoors(ctx, id)}
          </nav>
        </div>
      </div>
    </div>`;
}

/* ── One table of key spaces ───────────────────────────────────────────────────────────────── */
function spaceTable(ctx, list, { head = true, id = '' } = {}) {
  const open = !id || ctx.moreOpen.has(id);
  const shown = open ? list : list.slice(0, TABLE_ROWS);
  return html`
    <div class="listing listing--n-name-meta-latest-doors listing--cols">
      ${head ? html`<div class="listing-row listing-row--head"><div class="poster-label"></div><div class="poster-label">${c('colSpace', 'Key space')}</div><div class="poster-label">${c('colSize', 'Size')}</div><div class="poster-label">${c('colLatest', 'Latest')}</div><div class="poster-label"></div></div>` : null}
      ${shown.map(s => html`
        <div class="listing-row" key=${s.id}>
          <div class="og-tbl-n poster-stat-number poster-stat-number--small">${s.items.length}</div>
          <div class="listing-name">
            <button type="button" class="og-tbl-name" onClick=${() => ctx.pickView({ kind: 'space', id: s.id })}>${s.label}</button>
            ${s.publicN || s.membersN ? html`<span class="og-tbl-marks">
              ${s.publicN ? html`<span class="poster-chip poster-chip--sun">${c('publicN', '{n} public').replace('{n}', String(s.publicN))}</span>` : null}
              ${s.membersN ? html`<span class="poster-chip">${c('membersN', '{n} for members').replace('{n}', String(s.membersN))}</span>` : null}
            </span>` : null}
          </div>
          <div class="mp-fig">${formatBytes(s.bytes)}</div>
          <div class="mp-fig">${s.latest ? html`<button type="button" class="og-tbl-go" onClick=${() => ctx.pickView({ kind: 'record', key: s.latest.key })}>${displayRemainder(s.latest.key, s.g)} · ${formatRelativeTime(s.latest.updated_at || s.latest.created_at)}</button>` : html`<span class="og-tbl-dot">·</span>`}</div>
          <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.pickView({ kind: 'space', id: s.id })}>${c('open', 'Open')}</button></div>
        </div>`)}
    </div>
    ${list.length > TABLE_ROWS && !open ? html`<p class="mp-sort"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.toggleMore(id)}>${c('showAll', 'show all {n}').replace('{n}', String(list.length))}</button></p>` : null}`;
}

function fileRows(ctx, files) {
  const { NODE_URL, setPreviewFile, handleDownloadFile, handleDeleteFile, showToast } = ctx;
  if (!files.length) return html`<p class="og-hint">${t('profile.files.empty') || 'No files yet.'}</p>`;
  return html`<div class="listing listing--mark-name-meta-doors listing--cols">${files.map(f => {
    const key = f.key || f.name;
    const cat = fileCategory(f.mime_type, key);
    const isImage = String(f.mime_type || '').startsWith('image');
    const url = f.owner_gaii ? `${NODE_URL}/v1/pub/${encodeURIComponent(f.owner_gaii)}/${String(key).split('/').map(encodeURIComponent).join('/')}` : `${NODE_URL}/v1/memory/files/${encodeURIComponent(key)}`;
    return html`
      <div class="listing-row" key=${key}>
        <div><span class="mp-file-kind poster-box poster-box--avatar poster-box--small">${isImage ? html`<${AuthImage} src=${fileBytesUrl(f, NODE_URL)} alt=${key} />` : String(cat || 'file').slice(0, 4).toUpperCase()}</span></div>
        <div class="listing-name">${key}</div>
        <div class="mp-fig">${f.size ? formatBytes(f.size) : ''} · ${t('knowledge.visibility.' + (f.visibility || 'private')) || f.visibility}</div>
        <div class="listing-doors">
          <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => setPreviewFile(f)}>${t('profile.files.preview') || 'Preview'}</button>
          <${CopyButton} text=${url} label=${t('common.copyUrl') || 'Copy URL'} className="poster-action poster-action--small poster-action--row poster-action--lower" onCopied=${() => showToast(t('profile.files.urlCopied') || 'URL copied')} />
          <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => handleDownloadFile(f)}>${t('profile.files.download') || 'Download'}</button>
          <button type="button" class="poster-action poster-action--small poster-action--row poster-action--danger poster-action--lower" onClick=${() => handleDeleteFile(key)}>${t('profile.files.delete') || 'Delete'}</button>
        </div>
      </div>`;
  })}</div>`;
}

/* ── The cover ─────────────────────────────────────────────────────────────────────────────── */
function renderCover(ctx) {
  const {
    memories, files, memQuota, orgNames, agents, selectedAgent, setSelectedAgent, fedConsents, shares, groups,
    sysOpen, setSysOpen, showSearch, setShowSearch, staleAll, setStaleAll, searchInput, setSearchInput, runServerSearch,
    searchResults, searchLoading, clearServerSearch, showMemForm, setShowMemForm, handleCreateMemory, showFileForm,
    setShowFileForm, handleUploadFiles, handleDeleteMemory, pickView,
  } = ctx;
  const cls = classify(memories, orgNames);
  const all = memories || [];
  const bytes = all.reduce((n, m) => n + (Number(m.bytes) || 0), 0);
  const today = new Date().toDateString();
  const changedToday = all.filter(m => new Date(m.updated_at || m.created_at || 0).toDateString() === today).length;
  const recent = [...all].sort(byUpdated).slice(0, 5);
  const stale = all.filter(isStale).sort((a, b) => -byUpdated(a, b));
  const publicKeys = all.filter(m => m.visibility === 'public');
  const membersKeys = all.filter(m => m.visibility === 'members');
  const fedKeys = Object.keys(fedConsents || {});
  const last = recent[0] || null;
  const agentName = selectedAgent ? (agents.find(a => a.gaii === selectedAgent)?.name || selectedAgent) : (t('profile.memory.defaultAgent') || 'Default agent');
  const sysCount = cls.sys.reduce((n, s) => n + s.items.length, 0);
  const sysBytes = cls.sys.reduce((n, s) => n + s.bytes, 0);
  const seenRows = [];
  if (publicKeys.length) seenRows.push(html`<div class="listing-row" key="pub"><div class="listing-name">${c('publicKeys', '{n} public keys').replace('{n}', String(publicKeys.length))}<small>${publicKeys.slice(0, 3).map(m => m.key).join(' · ')}${publicKeys.length > 3 ? ' …' : ''}</small></div><div>${visChip('public')}</div><div class="listing-doors"></div></div>`);
  if (membersKeys.length) seenRows.push(html`<div class="listing-row" key="mem"><div class="listing-name">${c('membersKeys', '{n} keys for signed-in users').replace('{n}', String(membersKeys.length))}</div><div>${visChip('members')}</div><div class="listing-doors"></div></div>`);
  for (const sh of shares || []) seenRows.push(html`<div class="listing-row" key=${'sh' + sh.id}><div class="listing-name"><span class="key-name">${sh.key_pattern}</span><small> → ${groups.find(g => g.id === sh.group_id)?.name || sh.group_id}</small></div><div><span class="poster-chip">${c('share', 'key-space share')}</span></div><div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.revokeCoveringShare(sh)}>${t('profile.memory.shRevoke') || 'Stop sharing'}</button></div></div>`);
  if (fedKeys.length) seenRows.push(html`<div class="listing-row" key="fed"><div class="listing-name">${c('fedKeys', '{n} keys in the federation').replace('{n}', String(fedKeys.length))}<small>${fedKeys.slice(0, 3).join(' · ')}</small></div><div><span class="poster-chip">${c('federation', 'federation')}</span></div><div class="listing-doors"></div></div>`);

  let counter = 0; const next = () => String(++counter).padStart(2, '0');
  const rail = [];
  const sec = (id, label, count) => { const n = next(); rail.push([id, n, label, count]); return n; };
  const nOwn = sec('mp-own', c('own', 'Mine'), cls.own.reduce((n, s) => n + s.items.length, 0));
  const nOrg = sec('mp-org', c('orgs', 'Organisms’'), cls.org.reduce((n, s) => n + s.items.length, 0));
  const nSys = sec('mp-sys', c('sys', 'The machine’s bookkeeping'), sysCount);
  const nFiles = sec('mp-files', c('files', 'Files'), (files || []).length);
  const nHist = sec('mp-history', c('happened', 'What has happened'), '→');
  const nStale = sec('mp-stale', c('stale', 'Stale'), stale.length);
  const nSeen = sec('mp-seen', c('seen', 'Who else sees'), seenRows.length);

  const railItems = rail.map(([id, n, label, count]) => html`
    <a class="og-rail-link" key=${id} href=${'#' + id} onClick=${(e) => { e.preventDefault(); if (id === 'mp-sys') setSysOpen(true); setTimeout(() => scrollTo(id), 30); }}><i>${n}</i>${label}<em>${count}</em></a>`);

  const searchRow = (showSearch || searchResults !== null) ? html`
    <div class="search-line">
      <input type="text" class="og-input" autofocus placeholder=${t('profile.memory.searchContents') || 'Search content or key…'} value=${searchInput}
        onInput=${e => setSearchInput(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') runServerSearch(searchInput, ctx.searchScopePrefix); }} />
      <button type="button" class="poster-action poster-action--small" disabled=${searchLoading} onClick=${() => runServerSearch(searchInput, ctx.searchScopePrefix)}>${searchLoading ? '…' : (t('profile.memory.searchBtn') || 'Search')}</button>
      <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => { clearServerSearch(); setShowSearch(false); }}>${t('search.clear') || 'Clear'}</button>
    </div>` : null;

  const resultRows = searchResults !== null ? html`
    <${PageSection} id="mp-results" num="·" first=${true} title=${c('searchResults', '{n} matches').replace('{n}', String(searchResults.length))} count=${null}>
      ${searchResults.length === 0 ? html`<p class="og-hint">${t('profile.memory.searchEmpty') || 'No matches'}</p>` : html`<div class="og-folds">${searchResults.map(m => html`
        <button type="button" class="og-fold og-fold--event" key=${m.key} onClick=${() => pickView({ kind: 'record', key: m.key })}><i>${formatRelativeTime(m.updated_at || m.created_at)}</i><b class="key-name">${m.key}</b><span class="og-fold-r">${visChip(m.visibility)}</span></button>`)}</div>`}
    <//>` : null;

  return html`
    <div class="og og-mp">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('profile.memory.title') || 'Memory'}</h1>
          <div class="poster-chips">
            <span class="poster-chip">${num(all.length)} ${c('figKeys', 'keys')}</span>
            <span class="poster-chip">${formatBytes(bytes)}</span>
            ${changedToday ? html`<span class="poster-chip poster-chip--sun">${c('changedToday', '{n} changed today').replace('{n}', String(changedToday))}</span>` : null}
            ${agents.length > 1 ? html`<select class="select-field mp-agent" value=${selectedAgent} onChange=${e => setSelectedAgent(e.target.value)} aria-label=${t('profile.memory.agent') || 'Agent'}>
                <option value="">${t('profile.memory.defaultAgent') || 'Default agent'}</option>
                ${agents.map(a => html`<option key=${a.gaii} value=${a.gaii}>${a.name || a.gaii}</option>`)}
              </select>` : html`<span class="poster-chip">${agentName}</span>`}
          </div>
          <p class="og-desc">${c('desc', 'What you and your agents have written here: notes, settings, research and the organisms’ content. Yours, and yours to decide about.')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="poster-slab" onClick=${() => setShowSearch(true)}>${c('searchSlab', 'Search memory')}</button>
          <div class="og-doors">
            <button type="button" class="poster-action poster-action--small" onClick=${() => { setShowFileForm(false); setShowMemForm(s => !s); }}>${c('newEntry', '+ New entry')}</button>
            <button type="button" class="poster-action poster-action--small" onClick=${() => { setShowMemForm(false); setShowFileForm(s => !s); }}>${c('upload', 'Upload a file')}</button>
          </div>
        </div>
      </div>

      <div class="og-strip">
        <div><b>${num(all.length)}</b><span>${c('figKeys', 'keys')}</span><small>${memQuota?.max_keys ? c('figOf', 'of {n}').replace('{n}', num(memQuota.max_keys)) + ' · ' : ''}${c('figSpaces', '{n} key spaces').replace('{n}', String(cls.spaces.size))}</small></div>
        <div><b>${formatBytes(memQuota?.used_bytes ?? bytes)}</b><span></span><small>${memQuota?.max_bytes ? c('figOf', 'of {n}').replace('{n}', formatBytes(memQuota.max_bytes)) : ''}</small></div>
        <div><b>${stale.length}</b><span>${c('figStale', 'stale')}</span><small>${c('figStaleSub', 'not changed in 90 days')}</small></div>
        <div><b class=${last ? 'og-strip-coral' : ''}>${last ? formatRelativeTime(last.updated_at || last.created_at) : '·'}</b><span>${c('figLast', 'last change')}</span>${last ? html`<small>${agentOf(last.owner_gaii) || c('you', 'you')} ${c('wrote', 'wrote')} ${last.key}</small>` : null}</div>
      </div>

      ${searchRow}
      ${showMemForm ? html`<div class="og-box og-box--solid poster-aside poster-aside--small poster-aside--irreversible"><span class="poster-label">${c('newEntry', '+ New entry')}</span><${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} /></div>` : null}
      ${showFileForm ? html`<div class="og-box og-box--solid poster-aside poster-aside--small poster-aside--irreversible"><span class="poster-label">${c('upload', 'Upload a file')}</span><${FileUploadForm} onUpload=${handleUploadFiles} onCancel=${() => setShowFileForm(false)} /></div>` : null}

      <div class="og-grid">
        <div class="og-main">
          ${resultRows}
          <${PageSection} id="mp-own" num=${nOwn} first=${searchResults === null} title=${c('own', 'Mine')} count=${cls.own.reduce((n, s) => n + s.items.length, 0)}
            doors=${html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => pickView({ kind: 'page', id: 'all' })}>${c('allKeys', 'All as keys')}</button>`}>
            ${cls.own.length ? spaceTable(ctx, cls.own, { id: 'own' }) : html`<p class="og-hint">${t('profile.memory.empty') || 'Nothing here yet.'}</p>`}
            <${Hint}>${c('spaceHint', 'A key space is the first part of a key: document/pitch-2026 belongs to document. It is the unit that is shared, exported and cleaned.')}<//>
          <//>

          <${PageSection} id="mp-org" num=${nOrg} title=${c('orgs', 'Organisms’')} count=${cls.org.reduce((n, s) => n + s.items.length, 0)}
            doors=${html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }))}>${t('organisms.title') || 'Organisms'} →</button>`}>
            ${cls.org.length ? spaceTable(ctx, cls.org, { id: 'org' }) : html`<p class="og-hint">${t('profile.memory.empty') || 'Nothing here yet.'}</p>`}
            <${Hint}>${c('orgHint', 'An organism’s content lives in your memory when you or your agents wrote it. It is managed on the organism’s page; here it shows so you know what you own and how much it takes.')}<//>
          <//>

          <${FoldSection} id="mp-sys" num=${nSys} title=${c('sys', 'The machine’s bookkeeping')} sub=${`${sysCount} ${c('figKeys', 'keys')} · ${formatBytes(sysBytes)}`} open=${sysOpen} onToggle=${() => setSysOpen(o => !o)}>
            <${Hint}>${c('sysHint', 'What your environment and your agents write for their own use: notices, meters, receipts. Yours as well, but rarely for you to read.')}<//>
            ${cls.sys.length ? spaceTable(ctx, cls.sys, { head: false, id: 'sys' }) : html`<p class="og-hint">${t('profile.memory.empty') || 'Nothing here yet.'}</p>`}
          <//>

          <${PageSection} id="mp-files" num=${nFiles} title=${c('files', 'Files')} count=${(files || []).length}
            doors=${html`<button type="button" class="poster-action poster-action--small" onClick=${() => { setShowMemForm(false); setShowFileForm(s => !s); setTimeout(() => scrollTo('mp-files'), 30); }}>${c('upload', 'Upload a file')}</button>`}>
            ${fileRows(ctx, files || [])}
          <//>

          <${PageSection} id="mp-history" num=${nHist} title=${c('happened', 'What has happened')}
            doors=${html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => pickView({ kind: 'page', id: 'all' })}>${c('allKeys', 'All as keys')} →</button>`}>
            ${recent.length ? html`<div class="og-folds mp-events">${recent.map(m => html`
              <button type="button" class="og-fold og-fold--event" key=${m.key} onClick=${() => pickView({ kind: 'record', key: m.key })}>
                <i>${formatRelativeTime(m.updated_at || m.created_at)}</i>
                <span class="og-fold-who">${agentOf(m.owner_gaii) || c('you', 'you')}</span><span>${c('wrote', 'wrote')}</span><b class="key-name">${m.key}</b>
              </button>`)}</div>` : html`<p class="og-hint">${t('profile.memory.empty') || 'Nothing here yet.'}</p>`}
          <//>

          <${PageSection} id="mp-stale" num=${nStale} title=${c('stale', 'Stale')} count=${stale.length}>
            <${Hint}>${c('staleHint', 'Keys nobody has changed in 90 days. Open one to decide; delete what no longer matters.')}<//>
            ${stale.length ? html`<div class="listing listing--key-doors listing--cols">${(staleAll ? stale : stale.slice(0, 8)).map(m => html`
              <div class="listing-row" key=${m.key}><div class="listing-name"><span class="key-name">${m.key}</span><small> ${formatBytes(m.bytes)} · ${formatRelativeTime(m.updated_at || m.created_at)}</small></div>
                <div class="listing-doors">
                  <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => pickView({ kind: 'record', key: m.key })}>${c('open', 'Open')}</button>
                  <button type="button" class="poster-action poster-action--small poster-action--row poster-action--danger poster-action--lower" onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn') || 'Delete'}</button></div></div>`)}</div>
              ${stale.length > 8 && !staleAll ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => setStaleAll(true)}>${c('showAll', 'show all {n}').replace('{n}', String(stale.length))}</button>` : null}` : html`<p class="og-hint">${c('noStale', 'Nothing has gone stale.')}</p>`}
          <//>

          <${PageSection} id="mp-seen" num=${nSeen} title=${c('seen', 'Who else sees')} count=${seenRows.length}
            doors=${html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'access' } }))}>${t('profile.tabs.access') || 'Access'} →</button>`}>
            ${seenRows.length ? html`<div class="listing listing--name-kind-doors listing--cols">${seenRows}</div>` : html`<p class="og-hint">${c('none', 'Nobody but you and your agents.')}</p>`}
          <//>
        </div>

        <nav class="og-rail" aria-label=${c('railTitle', 'In your memory')}>
          <span class="og-rail-label">${c('railTitle', 'In your memory')}</span>
          ${railItems}
          <hr />
          ${pageDoors(ctx, null)}
        </nav>
      </div>
    </div>`;
}

/* ── A key space as a page ─────────────────────────────────────────────────────────────────── */
function renderSpace(ctx, id) {
  const { memories, orgNames, spaceSort, setSpaceSort, pickView, handleExport, addCartItems, memCartItem, deleteGroup, openSharePanel, sharePanelFor, setSharePanelFor, sharePattern, setSharePattern, shareGroupId, setShareGroupId, submitShare, groups, showMemForm, setShowMemForm, handleCreateMemory, setShowSearch, setSearchScopePrefix, sharedWith } = ctx;
  const cls = classify(memories, orgNames);
  const s = cls.spaces.get(id);
  if (!s) return renderPage(ctx, { id: 'space', crumbs: [{ label: id }], title: id, children: html`<p class="og-hint">${t('profile.memory.empty') || 'Nothing here.'}</p>` });
  const prefix = s.g.kind === 'organism' ? 'organism.' + s.g.uuid + '.' : s.g.kind === 'plain' ? s.id + '.' : '';
  const items = [...s.items];
  if (spaceSort === 'alpha') items.sort((a, b) => a.key.localeCompare(b.key));
  else if (spaceSort === 'size') items.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  const kind = s.bucket === 'org' ? c('kindOrg', 'organism') : s.bucket === 'sys' ? c('kindSys', 'bookkeeping') : c('kindOwn', 'your key space');
  const sub = html`<span>${kind}</span><span>${s.items.length} ${c('figKeys', 'keys')}</span><span>${formatBytes(s.bytes)}</span>${s.publicN ? html`<span class="poster-chip poster-chip--sun">${c('publicN', '{n} public').replace('{n}', String(s.publicN))}</span>` : null}`;
  const doors = html`
    ${prefix ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => { setSearchScopePrefix(prefix); setShowSearch(true); pickView({ kind: 'cover' }); }}>${c('searchHere', 'Search this space')}</button>` : null}
    <button type="button" class="poster-action poster-action--small" onClick=${() => setShowMemForm(v => !v)}>${c('newEntry', '+ New entry')}</button>`;
  const rail = html`
    <nav class="og-rail">
      <span class="og-rail-label">${c('thisSpace', 'This key space')}</span>
      ${prefix ? html`<button type="button" class="og-rail-link" onClick=${() => openSharePanel(s.items[0].key)}><i>·</i>${c('shareGroup', 'Share with a group')}<em>→</em></button>` : null}
      ${prefix ? html`<button type="button" class="og-rail-link" onClick=${() => handleExport(prefix)}><i>·</i>${c('exportSpace', 'Export this space')}<em>→</em></button>` : null}
      <button type="button" class="og-rail-link" onClick=${() => addCartItems(s.items.map(memCartItem))}><i>·</i>${c('toCart', 'To the collection')}<em>+${s.items.length}</em></button>
      ${prefix ? html`<hr /><button type="button" class="og-rail-link" onClick=${() => deleteGroup(s.g, s.items.length)}><i>·</i>${c('deleteSpace', 'Delete the space')}<em>…</em></button>` : null}
    </nav>`;
  return renderPage(ctx, { id: 'space', crumbs: [{ label: s.label }], title: s.label, sub, doors, rail, children: html`
    ${showMemForm ? html`<div class="og-box og-box--solid poster-aside poster-aside--small poster-aside--irreversible"><span class="poster-label">${c('newEntry', '+ New entry')}</span><${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} /></div>` : null}
    ${sharePanelFor ? html`<div class="og-box poster-aside poster-aside--small"><span class="poster-label">${c('shareGroup', 'Share with a group')}</span>
      ${groups.length === 0 ? html`<p class="og-hint">${t('profile.memory.shNoGroups') || 'No sharing groups yet.'}</p>` : html`
        <div class="og-fields"><div class="og-field"><span class="poster-label">${t('profile.access.shPattern') || 'Pattern'}</span><input type="text" class="og-input" value=${sharePattern} onInput=${e => setSharePattern(e.target.value)} /><span class="poster-hint">${t('profile.access.shPatternHelp') || ''}</span></div>
        <div class="og-field"><span class="poster-label">${t('profile.memory.shPickGroup') || 'Group'}</span><select class="select-field" value=${shareGroupId} onChange=${e => setShareGroupId(e.target.value)}>${groups.map(g => html`<option key=${g.id} value=${g.id}>${g.name}</option>`)}</select></div>
        <div class="og-actions"><button type="button" class="poster-slab" onClick=${submitShare}>${t('profile.access.shCreate') || 'Share'}</button><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => setSharePanelFor(null)}>${t('profile.access.shCancel') || 'Cancel'}</button></div></div>`}
    </div>` : null}
    <div class="listing listing--name-size-when-mark-doors listing--cols">
      <div class="listing-row listing-row--head"><div class="poster-label">${c('colKey', 'Key')}</div><div class="poster-label">${c('colSize', 'Size')}</div><div class="poster-label">${c('colChanged', 'Changed')}</div><div class="poster-label">${c('colVisibility', 'Visibility')}</div><div class="poster-label"></div></div>
      ${items.map(m => html`
        <div class="listing-row" key=${m.key}>
          <div class="listing-name"><button type="button" class="og-tbl-name key-name" onClick=${() => pickView({ kind: 'record', key: m.key })}>${displayRemainder(m.key, s.g)}</button>${sharedWith(m.key).length ? html`<span class="poster-chip">${t('profile.memory.shSharedBadge') || 'shared'}</span>` : null}</div>
          <div class="mp-fig">${formatBytes(m.bytes)}</div>
          <div><span class="poster-time">${formatRelativeTime(m.updated_at || m.created_at)}</span></div>
          <div>${visChip(m.visibility)}</div>
          <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => pickView({ kind: 'record', key: m.key })}>${c('open', 'Open')}</button></div>
        </div>`)}
    </div>
    <div class="mp-sort pf-tabs">${[['updated', c('sortUpdated', 'by change')], ['alpha', c('sortAlpha', 'alphabetical')], ['size', c('sortSize', 'largest first')]].map(([k, l]) => html`<button type="button" class=${`poster-tab ${spaceSort === k ? 'is-on' : ''}`} key=${k} onClick=${() => setSpaceSort(k)}>${l}</button>`)}</div>` });
}

/* ── A record as a page ────────────────────────────────────────────────────────────────────── */
const looksLikeMarkdown = (s) => /(^|\n)#{1,6}\s|(^|\n)[-*]\s|\*\*|\[[^\]]+\]\(/.test(s);
function renderValue(ctx, m, raw) {
  const v = ctx.valueOf(m);
  if (v === undefined) return html`<p class="poster-quiet loading-mark">${t('profile.memory.loadingValue') || 'Loading value…'}</p>`;
  const im = detectImage(v, m.key);
  if (raw) return html`<pre class="code-block mp-raw">${typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? '')}</pre>`;
  if (typeof v === 'string') return html`${im ? html`<${ImageView} desc=${im} />` : null}<div class="mp-prose">${looksLikeMarkdown(v) ? html`<${Markdown} text=${v} />` : v}</div>`;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const rows = Object.entries(v);
    const flat = rows.every(([, x]) => x === null || typeof x !== 'object');
    if (flat && rows.length) return html`${im ? html`<${ImageView} desc=${im} />` : null}<div class="facts facts--wide">${rows.map(([k, x]) => html`<div class="facts-k poster-label" key=${'k' + k}>${k}</div><div class="facts-v" key=${'v' + k}>${String(x ?? '')}</div>`)}</div>`;
  }
  return html`${im ? html`<${ImageView} desc=${im} />` : null}<pre class="code-block mp-raw">${JSON.stringify(v, null, 2)}</pre>`;
}

function renderRecord(ctx, key) {
  const { memories, orgNames, showRaw, setShowRaw, valueCopyText, valueOf, setEditModal, handleQuickVis, editingMemTags, setEditingMemTags, handleUpdateMemoryTags, sharesCovering, revokeCoveringShare, openSharePanel, inCart, memCartItem, toggleCartItem, fedConsents, handleShareToFederation, handleStopSharing, togglingFed, session, doPull, doPush, handleDeleteMemory, showToast, NODE_URL, pickView } = ctx;
  const m = (memories || []).find(x => x.key === key) || (ctx.searchResults || []).find(x => x.key === key);
  const g = groupOfKey(key);
  const cls = classify(memories, orgNames);
  const space = cls.spaces.get(g.id);
  const crumbs = [{ label: space ? space.label : g.id, go: () => pickView({ kind: 'space', id: g.id }) }, { label: displayRemainder(key, g) }];
  if (!m) return renderPage(ctx, { id: 'record', crumbs, title: key, children: html`<p class="og-hint">${t('profile.memory.empty') || 'Not found.'}</p>` });
  const v = valueOf(m);
  const owner = m.owner_gaii || ctx.currentGhii();
  const url = `${NODE_URL}/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`;
  const covering = sharesCovering(key);
  const doors = html`
    ${v !== undefined ? html`<${CopyButton} text=${valueCopyText(m)} label=${t('profile.memory.copyValue') || 'Copy value'} className="poster-action poster-action--small poster-action--lower" onCopied=${() => showToast(t('profile.memory.valueCopied') || 'Value copied')} />` : null}
    <${CopyButton} text=${url} label=${t('common.copyUrl') || 'Copy URL'} className="poster-action poster-action--small poster-action--lower" onCopied=${() => showToast(t('profile.files.urlCopied') || 'URL copied')} />
    <button type="button" class="poster-action poster-action--small" onClick=${() => setEditModal({ key, value: typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''), visibility: m.visibility || 'private', version: m.version, isJson: typeof v === 'object' && v !== null })}>${t('profile.memory.editBtn') || 'Edit'}</button>`;
  const rail = html`
    <div class="og-field"><span class="poster-label">${c('visibility', 'Visibility')}</span>
      <div class="pf-tabs">${VIS_OPTIONS.filter(x => x !== 'group').map(x => html`<button type="button" key=${x} class=${`poster-tab ${(m.visibility || 'private') === x ? 'is-on' : ''}`} onClick=${() => handleQuickVis(m, x)}>${t('knowledge.visibility.' + x) || x}</button>`)}</div>
      <span class="poster-hint">${c('visHint', 'Public: anyone with the address reads it. Sharing with a group is done per key space, not per key.')}</span></div>
    <div class="og-field"><span class="poster-label">${c('tags', 'Tags')}</span>
      ${editingMemTags === key ? html`<${TagEditor} tags=${m.tags || []} onSave=${(tags) => { handleUpdateMemoryTags(key, tags, m.version); setEditingMemTags(null); }} />`
        : html`<div class="mp-tags">${(m.tags || []).map(tag => html`<span class="poster-chip" key=${tag}>${tag}</span>`)}<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => setEditingMemTags(key)}>${t('tags.editTags') || 'Edit tags'}</button></div>`}</div>
    ${covering.length ? html`<div class="og-field"><span class="poster-label">${c('share', 'key-space share')}</span><div class="listing listing--key-doors listing--cols">${covering.map(sh => html`<div class="listing-row" key=${sh.id}><div class="listing-name"><span class="key-name">${sh.key_pattern}</span><small> → ${sh.group?.name || sh.group_id}</small></div><div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => revokeCoveringShare(sh)}>${t('profile.memory.shRevoke') || 'Stop sharing'}</button></div></div>`)}</div></div>` : null}
    <nav class="og-rail">
      <span class="og-rail-label">${c('thisRecord', 'This record')}</span>
      <button type="button" class="og-rail-link" onClick=${() => pickView({ kind: 'space', id: g.id })}><i>←</i>${space ? space.label : g.id}</button>
      <hr />
      <button type="button" class="og-rail-link" onClick=${() => toggleCartItem(memCartItem(m))}><i>·</i>${inCart(memCartItem(m)) ? (t('profile.memory.cartRemove') || 'Remove from collection') : c('toCart', 'To the collection')}<em>${inCart(memCartItem(m)) ? '✓' : '+'}</em></button>
      <button type="button" class="og-rail-link" onClick=${() => { openSharePanel(key); pickView({ kind: 'space', id: g.id }); }}><i>·</i>${c('shareGroup', 'Share with a group')}<em>→</em></button>
      ${fedConsents[key]
        ? html`<button type="button" class="og-rail-link" disabled=${togglingFed === key} onClick=${() => handleStopSharing(key)}><i>·</i>${t('profile.memory.stopSharing') || 'Stop federation sharing'}<em>→</em></button>`
        : html`<button type="button" class="og-rail-link" disabled=${togglingFed === key} onClick=${() => handleShareToFederation(key)}><i>·</i>${c('federate', 'Share to the federation')}<em>→</em></button>`}
      ${session?.federated ? html`<button type="button" class="og-rail-link" onClick=${() => doPull(key)}><i>↓</i>${t('profile.memory.pullFromHome')}</button><button type="button" class="og-rail-link" onClick=${() => doPush(key)}><i>↑</i>${t('profile.memory.pushToHome')}</button>` : null}
      <hr />
      <button type="button" class="og-rail-link" onClick=${() => handleDeleteMemory(key)}><i>·</i>${t('profile.memory.deleteBtn') || 'Delete'}<em>…</em></button>
    </nav>`;
  return renderPage(ctx, { id: 'record', crumbs, title: key, doors, rail, children: html`
    <div class="mp-meta">
      ${m.created_at ? html`<span>${c('created', 'created')} ${day(m.created_at)}</span>` : null}
      ${m.updated_at ? html`<span>${c('changed', 'changed')} ${formatRelativeTime(m.updated_at)}${agentOf(m.owner_gaii) ? ' · ' + agentOf(m.owner_gaii) : ''}</span>` : null}
      ${m.version != null ? html`<span>${c('version', 'version {n}').replace('{n}', String(m.version))}</span>` : null}
      ${typeof m.bytes === 'number' ? html`<span>${formatBytes(m.bytes)}</span>` : null}
      ${visChip(m.visibility)}
    </div>
    <div class="mp-value poster-row--thing">
      ${renderValue(ctx, m, showRaw)}
      ${v !== undefined ? html`<div class="og-actions"><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => setShowRaw(r => !r)}>${showRaw ? c('showPretty', 'Show readable') : c('showRaw', 'Show raw')}</button></div>` : null}
    </div>` });
}

/* ── The other pages: the old list, discovery, remote nodes, the collection, export/import ── */
function renderOther(ctx, id) {
  const { cart, cartOrgs, removeCartItem, clearCart, NODE_URL, showToast, memArchived, setMemArchived, fullLoaded, loadFullContents, handleExport, importing, triggerImport, importMode, setImportMode, importFileRef, handleImportFile } = ctx;
  const page = PAGES.find(p => p[0] === id) || PAGES[0];
  const title = c(page[1], page[2]);
  let body = null, doors = null;
  if (id === 'all' || id === 'archived') {
    doors = html`
      <button type="button" class=${`poster-tab poster-tab--fold ${!memArchived ? 'is-on' : ''}`} aria-pressed=${!memArchived ? 'true' : 'false'} onClick=${() => setMemArchived(false)}>${t('profile.memory.viewActive') || 'Active'}</button>
      <button type="button" class=${`poster-tab poster-tab--fold ${memArchived ? 'is-on' : ''}`} aria-pressed=${memArchived ? 'true' : 'false'} onClick=${() => setMemArchived(true)}>${t('profile.memory.viewArchived') || 'Archived'}</button>`;
    body = html`<div class="mem-page">${renderEntries(ctx)}</div>`;
  } else if (id === 'discover' || id === 'remote') {
    body = html`<div class="mem-page">${renderBrowsePanel(ctx)}</div>`;
  } else if (id === 'cart') {
    body = cart.length ? html`<div class="mem-page"><${CartTray} cart=${cart} nodeUrl=${NODE_URL} orgs=${cartOrgs} onRemove=${removeCartItem} onClear=${clearCart} showToast=${showToast} /></div>` : html`<p class="og-hint">${c('cartEmpty', 'The collection is empty. Add records and files to it from their pages, then export them as a list, a ZIP or a workspace source.')}</p>`;
  } else if (id === 'tools') {
    body = html`
      <div class="og-fields">
        <div class="og-box og-box--solid poster-aside poster-aside--small poster-aside--irreversible"><span class="poster-label">${t('profile.memory.exportBtn') || 'Export'}</span><${Hint}>${c('exportHint', 'A JSON backup of every key in this memory (the selected agent’s, if one is chosen). A key space can be exported alone from its own page.')}<//><div class="og-actions"><button type="button" class="poster-slab" onClick=${() => handleExport()}>${t('profile.memory.exportBtn') || 'Export'}</button></div></div>
        <div class="og-box og-box--solid poster-aside poster-aside--small poster-aside--irreversible"><span class="poster-label">${t('profile.memory.importBtn') || 'Import'}</span><${Hint}>${c('importHint', 'A JSON backup made here or by an agent. Choose first what happens when a key already exists.')}<//>
          <div class="og-actions"><div class="pf-tabs">${['skip', 'overwrite', 'rename'].map(mode => html`<button type="button" key=${mode} class=${`poster-tab ${importMode === mode ? 'is-on' : ''}`} onClick=${() => setImportMode(mode)}>${t('profile.memory.importMode.' + mode) || mode}</button>`)}</div>
          <button type="button" class="poster-slab poster-slab--control" disabled=${importing} onClick=${triggerImport}>${importing ? '…' : (t('profile.memory.importBtn') || 'Import')}</button></div>
          <input type="file" accept="application/json,.json" ref=${importFileRef} class="pf-hidden" onChange=${handleImportFile} /></div>
        ${!fullLoaded ? html`<div class="og-box poster-aside poster-aside--small"><span class="poster-label">${t('profile.memory.loadContents') || 'Load all contents'}</span><${Hint}>${c('loadAllHint', 'The list carries keys and sizes only; loading every value lets the filter on the All-as-keys page search inside them. Costs one large read.')}<//><div class="og-actions"><button type="button" class="poster-action poster-action--small" onClick=${loadFullContents}>${t('profile.memory.loadContents') || 'Load all contents'}</button></div></div>` : null}
      </div>`;
  }
  return renderPage(ctx, { id, crumbs: [{ label: title }], title, doors, children: body });
}

export function renderMemoryView(ctx) {
  const { view } = ctx;
  if (view.kind === 'space') return renderSpace(ctx, view.id);
  if (view.kind === 'record') return renderRecord(ctx, view.key);
  if (view.kind === 'page') return renderOther(ctx, view.id);
  return renderCover(ctx);
}
