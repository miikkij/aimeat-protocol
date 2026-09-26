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
 *   Every part is a component that gets data (SettingsPage, Rail, Section, List, Folds, Mark,
 *   Action, Note, Box, Field, StoredValue); the file writes no class and no style.
 * @structure SYSTEM_SPACES · classify · renderMemoryView (cover or page) · renderCover · renderSpace ·
 *   renderRecord · renderOther · renderPage · crumb · pageDoors · spaceTable · fileRows
 * @usage import { renderMemoryView } from './memory-tab/cover.js';
 * @version-history
 *   v1.25.0 -- 2026-09-26 -- Every part is a component call with data (the page kit, the List, the
 *     Folds, the Mark, the Action, the Note, the Field family, SettingBox, StoredValue); no class is
 *     written here. Put back from main what the previous branch lost: the dim tag (a private key,
 *     the federation, the one agent, a record's tags), and the fold of the machine's bookkeeping
 *     as the Section's fold (page group G3).
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
import TagEditor from '/js/components/tag-editor.js';
import AuthImage from '/js/components/auth-image.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection, openTab } from '/components/Rail.js';
import { Section } from '/components/Section.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Tabs, Tab } from '/components/Tabs.js';
import { List, Row as ListRow, Name, Cell, When, Num, Doors, Lead, More, SearchLine } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Choice } from '/components/Choice.js';
import { FileDrop } from '/components/FileDrop.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { Row, Space, Split } from '/components/Layout.js';
import { StoredValue } from '/components/StoredValue.js';
import { tr } from '/views/profile/organisms/poster-parts.js';
import { formatBytes, formatRelativeTime, shortTok, groupOfKey, displayRemainder, VIS_OPTIONS } from './helpers.js';
import { fileCategory, fileBytesUrl } from './file-helpers.js';
import { MemoryForm, FileUploadForm, CartTray } from './components.js';
import { renderEntries } from './entries-view.js';
import { renderBrowsePanel } from './browse-view.js';

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

/* A key's visibility as a tag: public on the sun, private dim (it reaches nobody), members plain. */
const visMark = (v) => html`<${Mark} tone=${v === 'public' ? 'sun' : v === 'private' ? 'dim' : undefined}>${t('knowledge.visibility.' + (v || 'private')) || v}<//>`;
const nothingYet = () => t('profile.memory.empty') || 'Nothing here yet.';

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
function crumb(ctx, parts) {
  const home = () => ctx.pickView({ kind: 'cover' });
  const memory = t('profile.memory.title') || 'Memory';
  return [
    tr('nav.profile', 'Settings'),
    parts.length ? { label: memory, onClick: home } : memory,
    ...parts.map((p, i) => (i === parts.length - 1 ? { label: p.label, here: true } : { label: p.label, onClick: p.go })),
  ];
}

const PAGES = [
  ['all', 'allKeys', 'All as keys'], ['discover', 'discover', 'Public'], ['remote', 'remote', 'Remote nodes'],
  ['archived', 'archived', 'Archived'], ['cart', 'cart', 'Collection'], ['tools', 'tools', 'Export and import'],
];
function pageDoors(ctx, current) {
  return PAGES.map(([id, key, fb]) => ({
    key: id, mark: '·', label: c(key, fb), count: id === 'cart' ? (ctx.cart.length || '→') : '→',
    on: current === id, onClick: () => ctx.pickView({ kind: 'page', id }),
  }));
}

/* A page under the cover: a key space, a record, one of the other pages. `rail` is the page's own
   rail (data), `aside` what stands over it (a record's settings); the memory's rail comes last. */
function renderPage(ctx, { id, crumbs, title, sub = null, doors = null, rail = null, aside = null, children }) {
  const railTitle = c('railTitle', 'In your memory');
  const memoryRail = {
    title: railTitle,
    groups: [
      { label: railTitle, items: [{ back: true, key: 'back', label: c('backToMemory', 'Back to memory'), onClick: () => ctx.pickView({ kind: 'cover' }) }] },
      { items: pageDoors(ctx, id) },
    ],
  };
  return html`<${SettingsPage} name="mp" page crumb=${crumb(ctx, crumbs)} title=${title} sub=${sub} asKey=${id === 'record'}
    actions=${doors ? html`<${Actions}>${doors}<//>` : null} aside=${aside} rail=${[rail, memoryRail]}>${children}<//>`;
}

/* ── One table of key spaces ───────────────────────────────────────────────────────────────── */
function spaceTable(ctx, list, { head: head0 = true, id = '' } = {}) {
  const open = !id || ctx.moreOpen.has(id);
  const shown = open ? list : list.slice(0, TABLE_ROWS);
  const head = head0 ? ['', c('colSpace', 'Key space'), c('colSize', 'Size'), c('colLatest', 'Latest'), ''] : null;
  return html`
    <${List} cols="n-name-meta-latest-doors" keepCols head=${head}>
      ${shown.map(s => html`
        <${ListRow} key=${s.id}>
          <${Num}><${Figure} small end n=${s.items.length} /><//>
          <${Name} onOpen=${() => ctx.pickView({ kind: 'space', id: s.id })}
            end=${s.publicN || s.membersN ? html`<${Marks}>
              ${s.publicN ? html`<${Mark} tone="sun">${c('publicN', '{n} public').replace('{n}', String(s.publicN))}<//>` : null}
              ${s.membersN ? html`<${Mark}>${c('membersN', '{n} for members').replace('{n}', String(s.membersN))}<//>` : null}
            <//>` : null}>${s.label}<//>
          <${Cell} meta>${formatBytes(s.bytes)}<//>
          ${s.latest
            ? html`<${Cell} meta clip><${Action} tone="text" onClick=${() => ctx.pickView({ kind: 'record', key: s.latest.key })}>${displayRemainder(s.latest.key, s.g)} · ${formatRelativeTime(s.latest.updated_at || s.latest.created_at)}<//><//>`
            : html`<${Cell} faint>·<//>`}
          <${Doors}><${Action} small row onClick=${() => ctx.pickView({ kind: 'space', id: s.id })}>${c('open', 'Open')}<//><//>
        <//>`)}
    <//>
    ${list.length > TABLE_ROWS && !open ? html`<${More} label=${c('showAll', 'show all {n}').replace('{n}', String(list.length))} onMore=${() => ctx.toggleMore(id)} />` : null}`;
}

function fileRows(ctx, files) {
  const { NODE_URL, setPreviewFile, handleDownloadFile, handleDeleteFile, showToast } = ctx;
  return html`<${List} cols="mark-name-meta-doors" keepCols empty=${t('profile.files.empty') || 'No files yet.'}>${files.map(f => {
    const key = f.key || f.name;
    const cat = fileCategory(f.mime_type, key);
    const isImage = String(f.mime_type || '').startsWith('image');
    const kind = String(cat || 'file').slice(0, 4).toUpperCase();
    const url = f.owner_gaii ? `${NODE_URL}/v1/pub/${encodeURIComponent(f.owner_gaii)}/${String(key).split('/').map(encodeURIComponent).join('/')}` : `${NODE_URL}/v1/memory/files/${encodeURIComponent(key)}`;
    return html`
      <${ListRow} key=${key}>
        ${isImage
          ? html`<${Lead} size="large" picture=${html`<${AuthImage} src=${fileBytesUrl(f, NODE_URL)} alt=${key} />`} />`
          : html`<${Lead} size="large" text=${kind} label=${kind} />`}
        <${Name}>${key}<//>
        <${Cell} meta>${f.size ? formatBytes(f.size) : ''} · ${t('knowledge.visibility.' + (f.visibility || 'private')) || f.visibility}<//>
        <${Doors}>
          <${Action} small row soft onClick=${() => setPreviewFile(f)}>${t('profile.files.preview') || 'Preview'}<//>
          <${Action} small row soft copy=${url} onCopied=${() => showToast(t('profile.files.urlCopied') || 'URL copied')}>${t('common.copyUrl') || 'Copy URL'}<//>
          <${Action} small row soft onClick=${() => handleDownloadFile(f)}>${t('profile.files.download') || 'Download'}<//>
          <${Action} small row soft tone="danger" onClick=${() => handleDeleteFile(key)}>${t('profile.files.delete') || 'Delete'}<//>
        <//>
      <//>`;
  })}<//>`;
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
  const publicSome = publicKeys.slice(0, 3).map(m => m.key).join(' · ') + (publicKeys.length > 3 ? ' …' : '');
  if (publicKeys.length) seenRows.push(html`<${ListRow} key="pub"><${Name} meta=${publicSome}>${c('publicKeys', '{n} public keys').replace('{n}', String(publicKeys.length))}<//><${Cell} line>${visMark('public')}<//><${Doors} /><//>`);
  if (membersKeys.length) seenRows.push(html`<${ListRow} key="mem"><${Name}>${c('membersKeys', '{n} keys for signed-in users').replace('{n}', String(membersKeys.length))}<//><${Cell} line>${visMark('members')}<//><${Doors} /><//>`);
  for (const sh of shares || []) {
    const to = ' → ' + (groups.find(g => g.id === sh.group_id)?.name || sh.group_id);
    seenRows.push(html`<${ListRow} key=${'sh' + sh.id}>
      <${Name} asKey meta=${to}>${sh.key_pattern}<//>
      <${Cell} line><${Mark}>${c('share', 'key-space share')}<//><//>
      <${Doors}><${Action} small row soft onClick=${() => ctx.revokeCoveringShare(sh)}>${t('profile.memory.shRevoke') || 'Stop sharing'}<//><//>
    <//>`);
  }
  if (fedKeys.length) seenRows.push(html`<${ListRow} key="fed"><${Name} meta=${fedKeys.slice(0, 3).join(' · ')}>${c('fedKeys', '{n} keys in the federation').replace('{n}', String(fedKeys.length))}<//><${Cell} line><${Mark} tone="dim">${c('federation', 'federation')}<//><//><${Doors} /><//>`);

  let counter = 0; const next = () => String(++counter).padStart(2, '0');
  const sections = [];
  const sec = (id, label, count, open) => { const n = next(); sections.push({ id, num: n, label, count, href: '#' + id, open }); return n; };
  const nOwn = sec('mp-own', c('own', 'Mine'), cls.own.reduce((n, s) => n + s.items.length, 0));
  const nOrg = sec('mp-org', c('orgs', 'Organisms’'), cls.org.reduce((n, s) => n + s.items.length, 0));
  const nSys = sec('mp-sys', c('sys', 'The machine’s bookkeeping'), sysCount, () => setSysOpen(true));
  const nFiles = sec('mp-files', c('files', 'Files'), (files || []).length);
  const nHist = sec('mp-history', c('happened', 'What has happened'), '→');
  const nStale = sec('mp-stale', c('stale', 'Stale'), stale.length);
  const nSeen = sec('mp-seen', c('seen', 'Who else sees'), seenRows.length);

  const search = () => runServerSearch(searchInput, ctx.searchScopePrefix);
  const searchRow = (showSearch || searchResults !== null) ? html`
    <${SearchLine} text autofocus placeholder=${t('profile.memory.searchContents') || 'Search content or key…'} value=${searchInput}
      onInput=${e => setSearchInput(e.target.value)} onEnter=${search}>
      <${Action} small disabled=${searchLoading} onClick=${search}>${searchLoading ? '…' : (t('profile.memory.searchBtn') || 'Search')}<//>
      <${Action} small soft onClick=${() => { clearServerSearch(); setShowSearch(false); }}>${t('search.clear') || 'Clear'}<//>
    <//>` : null;

  const resultRows = searchResults !== null ? html`
    <${Section} id="mp-results" num="·" first=${true} title=${c('searchResults', '{n} matches').replace('{n}', String(searchResults.length))} count=${null}>
      ${searchResults.length === 0 ? html`<${Note} kind="quiet">${t('profile.memory.searchEmpty') || 'No matches'}<//>` : html`<${Folds}>${searchResults.map(m => html`
        <${FoldRow} key=${m.key} num=${formatRelativeTime(m.updated_at || m.created_at)} name=${m.key} isKey right=${visMark(m.visibility)} onClick=${() => pickView({ kind: 'record', key: m.key })} />`)}<//>`}
    <//>` : null;

  const marks = [
    { label: `${num(all.length)} ${c('figKeys', 'keys')}` },
    { label: formatBytes(bytes) },
    changedToday ? { label: c('changedToday', '{n} changed today').replace('{n}', String(changedToday)), tone: 'sun' } : null,
    // Several agents: the drop-down that chooses whose memory is read. One: its name, dim (it chooses nothing).
    agents.length > 1
      ? html`<${Select} key="agent" fit value=${selectedAgent} onChange=${(v) => setSelectedAgent(v)} ariaLabel=${t('profile.memory.agent') || 'Agent'}
          placeholder=${t('profile.memory.defaultAgent') || 'Default agent'} options=${agents.map(a => [a.gaii, a.name || a.gaii])} />`
      : { label: agentName, tone: 'dim' },
  ];
  const actions = html`
    <${Loud} onClick=${() => setShowSearch(true)}>${c('searchSlab', 'Search memory')}<//>
    <${Actions}>
      <${Action} small onClick=${() => { setShowFileForm(false); setShowMemForm(s => !s); }}>${c('newEntry', '+ New entry')}<//>
      <${Action} small onClick=${() => { setShowMemForm(false); setShowFileForm(s => !s); }}>${c('upload', 'Upload a file')}<//>
    <//>`;
  const strip = html`
    <${FigureStrip} items=${[
      { key: 'keys', n: num(all.length), label: c('figKeys', 'keys'), sub: `${memQuota?.max_keys ? c('figOf', 'of {n}').replace('{n}', num(memQuota.max_keys)) + ' · ' : ''}${c('figSpaces', '{n} key spaces').replace('{n}', String(cls.spaces.size))}` },
      { key: 'bytes', n: formatBytes(memQuota?.used_bytes ?? bytes), label: '', sub: memQuota?.max_bytes ? c('figOf', 'of {n}').replace('{n}', formatBytes(memQuota.max_bytes)) : '' },
      { key: 'stale', n: stale.length, label: c('figStale', 'stale'), sub: c('figStaleSub', 'not changed in 90 days') },
      { key: 'last', n: last ? formatRelativeTime(last.updated_at || last.created_at) : '·', tone: last ? 'coral' : undefined, label: c('figLast', 'last change'),
        sub: last ? `${agentOf(last.owner_gaii) || c('you', 'you')} ${c('wrote', 'wrote')} ${last.key}` : undefined },
    ]} />
    ${searchRow}
    ${showMemForm ? html`<${SettingBox} label=${c('newEntry', '+ New entry')} irreversible><${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} /><//>` : null}
    ${showFileForm ? html`<${SettingBox} label=${c('upload', 'Upload a file')} irreversible><${FileUploadForm} onUpload=${handleUploadFiles} onCancel=${() => setShowFileForm(false)} /><//>` : null}`;
  const railTitle = c('railTitle', 'In your memory');
  const shownStale = staleAll ? stale : stale.slice(0, 8);

  return html`
    <${SettingsPage} name="mp" crumb=${crumb(ctx, [])} title=${t('profile.memory.title') || 'Memory'} marks=${marks}
      desc=${c('desc', 'What you and your agents have written here: notes, settings, research and the organisms’ content. Yours, and yours to decide about.')}
      actions=${actions} strip=${strip} railTitle=${railTitle} sections=${sections} pages=${pageDoors(ctx, null)}>
      ${resultRows}
      <${Section} id="mp-own" num=${nOwn} first=${searchResults === null} title=${c('own', 'Mine')} count=${cls.own.reduce((n, s) => n + s.items.length, 0)}
        doors=${html`<${Action} small soft onClick=${() => pickView({ kind: 'page', id: 'all' })}>${c('allKeys', 'All as keys')}<//>`}>
        ${cls.own.length ? spaceTable(ctx, cls.own, { id: 'own' }) : html`<${Note} kind="quiet">${nothingYet()}<//>`}
        <${Note} kind="hint">${c('spaceHint', 'A key space is the first part of a key: document/pitch-2026 belongs to document. It is the unit that is shared, exported and cleaned.')}<//>
      <//>

      <${Section} id="mp-org" num=${nOrg} title=${c('orgs', 'Organisms’')} count=${cls.org.reduce((n, s) => n + s.items.length, 0)}
        doors=${html`<${Action} small soft onClick=${() => openTab('organisms')}>${t('organisms.title') || 'Organisms'} →<//>`}>
        ${cls.org.length ? spaceTable(ctx, cls.org, { id: 'org' }) : html`<${Note} kind="quiet">${nothingYet()}<//>`}
        <${Note} kind="hint">${c('orgHint', 'An organism’s content lives in your memory when you or your agents wrote it. It is managed on the organism’s page; here it shows so you know what you own and how much it takes.')}<//>
      <//>

      <${Section} fold id="mp-sys" num=${nSys} title=${c('sys', 'The machine’s bookkeeping')} sub=${`${sysCount} ${c('figKeys', 'keys')} · ${formatBytes(sysBytes)}`} open=${sysOpen} onToggle=${() => setSysOpen(o => !o)}>
        <${Note} kind="hint">${c('sysHint', 'What your environment and your agents write for their own use: notices, meters, receipts. Yours as well, but rarely for you to read.')}<//>
        ${cls.sys.length ? spaceTable(ctx, cls.sys, { head: false, id: 'sys' }) : html`<${Note} kind="quiet">${nothingYet()}<//>`}
      <//>

      <${Section} id="mp-files" num=${nFiles} title=${c('files', 'Files')} count=${(files || []).length}
        doors=${html`<${Action} small onClick=${() => { setShowMemForm(false); setShowFileForm(s => !s); setTimeout(() => scrollToSection('mp-files'), 30); }}>${c('upload', 'Upload a file')}<//>`}>
        ${fileRows(ctx, files || [])}
      <//>

      <${Section} id="mp-history" num=${nHist} title=${c('happened', 'What has happened')}
        doors=${html`<${Action} small soft onClick=${() => pickView({ kind: 'page', id: 'all' })}>${c('allKeys', 'All as keys')} →<//>`}>
        ${recent.length ? html`<${Folds}>${recent.map(m => html`
          <${FoldRow} key=${m.key} num=${formatRelativeTime(m.updated_at || m.created_at)} who=${agentOf(m.owner_gaii) || c('you', 'you')} verb=${c('wrote', 'wrote')}
            name=${m.key} isKey onClick=${() => pickView({ kind: 'record', key: m.key })} />`)}<//>` : html`<${Note} kind="quiet">${nothingYet()}<//>`}
      <//>

      <${Section} id="mp-stale" num=${nStale} title=${c('stale', 'Stale')} count=${stale.length}>
        <${Note} kind="hint">${c('staleHint', 'Keys nobody has changed in 90 days. Open one to decide; delete what no longer matters.')}<//>
        <${List} cols="key-doors" keepCols empty=${c('noStale', 'Nothing has gone stale.')}>${shownStale.map(m => html`
          <${ListRow} key=${m.key}>
            <${Name} asKey meta=${`${formatBytes(m.bytes)} · ${formatRelativeTime(m.updated_at || m.created_at)}`}>${m.key}<//>
            <${Doors}>
              <${Action} small row soft onClick=${() => pickView({ kind: 'record', key: m.key })}>${c('open', 'Open')}<//>
              <${Action} small row soft tone="danger" onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn') || 'Delete'}<//>
            <//>
          <//>`)}<//>
        ${stale.length > 8 && !staleAll ? html`<${More} label=${c('showAll', 'show all {n}').replace('{n}', String(stale.length))} onMore=${() => setStaleAll(true)} />` : null}
      <//>

      <${Section} id="mp-seen" num=${nSeen} title=${c('seen', 'Who else sees')} count=${seenRows.length}
        doors=${html`<${Action} small soft onClick=${() => openTab('access')}>${t('profile.tabs.access') || 'Access'} →<//>`}>
        <${List} cols="name-kind-doors" keepCols empty=${c('none', 'Nobody but you and your agents.')}>${seenRows}<//>
      <//>
    <//>`;
}

/* ── A key space as a page ─────────────────────────────────────────────────────────────────── */
function renderSpace(ctx, id) {
  const { memories, orgNames, spaceSort, setSpaceSort, pickView, handleExport, addCartItems, memCartItem, deleteGroup, openSharePanel, sharePanelFor, setSharePanelFor, sharePattern, setSharePattern, shareGroupId, setShareGroupId, submitShare, groups, showMemForm, setShowMemForm, handleCreateMemory, setShowSearch, setSearchScopePrefix, sharedWith } = ctx;
  const cls = classify(memories, orgNames);
  const s = cls.spaces.get(id);
  if (!s) return renderPage(ctx, { id: 'space', crumbs: [{ label: id }], title: id, children: html`<${Note} kind="quiet">${t('profile.memory.empty') || 'Nothing here.'}<//>` });
  const prefix = s.g.kind === 'organism' ? 'organism.' + s.g.uuid + '.' : s.g.kind === 'plain' ? s.id + '.' : '';
  const items = [...s.items];
  if (spaceSort === 'alpha') items.sort((a, b) => a.key.localeCompare(b.key));
  else if (spaceSort === 'size') items.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  const kind = s.bucket === 'org' ? c('kindOrg', 'organism') : s.bucket === 'sys' ? c('kindSys', 'bookkeeping') : c('kindOwn', 'your key space');
  const sub = html`<span>${kind}</span><span>${s.items.length} ${c('figKeys', 'keys')}</span><span>${formatBytes(s.bytes)}</span>${s.publicN ? html`<${Mark} tone="sun">${c('publicN', '{n} public').replace('{n}', String(s.publicN))}<//>` : null}`;
  const doors = html`
    ${prefix ? html`<${Action} small soft onClick=${() => { setSearchScopePrefix(prefix); setShowSearch(true); pickView({ kind: 'cover' }); }}>${c('searchHere', 'Search this space')}<//>` : null}
    <${Action} small onClick=${() => setShowMemForm(v => !v)}>${c('newEntry', '+ New entry')}<//>`;
  const rail = {
    groups: [
      { label: c('thisSpace', 'This key space'), items: [
        prefix ? { key: 'share', mark: '·', label: c('shareGroup', 'Share with a group'), count: '→', onClick: () => openSharePanel(s.items[0].key) } : null,
        prefix ? { key: 'export', mark: '·', label: c('exportSpace', 'Export this space'), count: '→', onClick: () => handleExport(prefix) } : null,
        { key: 'cart', mark: '·', label: c('toCart', 'To the collection'), count: `+${s.items.length}`, onClick: () => addCartItems(s.items.map(memCartItem)) },
      ] },
      prefix ? { items: [{ key: 'delete', mark: '·', label: c('deleteSpace', 'Delete the space'), count: '…', onClick: () => deleteGroup(s.g, s.items.length) }] } : null,
    ],
  };
  const sorts = [['updated', c('sortUpdated', 'by change')], ['alpha', c('sortAlpha', 'alphabetical')], ['size', c('sortSize', 'largest first')]];
  return renderPage(ctx, { id: 'space', crumbs: [{ label: s.label }], title: s.label, sub, doors, rail, children: html`
    ${showMemForm ? html`<${SettingBox} label=${c('newEntry', '+ New entry')} irreversible><${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} /><//>` : null}
    ${sharePanelFor ? html`<${SettingBox} label=${c('shareGroup', 'Share with a group')}>
      ${groups.length === 0 ? html`<${Note} kind="hint">${t('profile.memory.shNoGroups') || 'No sharing groups yet.'}<//>` : html`
        <${Fields}>
          <${TextField} label=${t('profile.access.shPattern') || 'Pattern'} hint=${t('profile.access.shPatternHelp') || ''} value=${sharePattern} onInput=${setSharePattern} />
          <${Select} label=${t('profile.memory.shPickGroup') || 'Group'} value=${shareGroupId} onChange=${setShareGroupId} options=${groups.map(g => [g.id, g.name])} />
          <${FormActions}>
            <${Loud} onClick=${submitShare}>${t('profile.access.shCreate') || 'Share'}<//>
            <${Action} small soft onClick=${() => setSharePanelFor(null)}>${t('profile.access.shCancel') || 'Cancel'}<//>
          <//>
        <//>`}
    <//>` : null}
    <${List} cols="name-size-when-mark-doors" keepCols head=${[c('colKey', 'Key'), c('colSize', 'Size'), c('colChanged', 'Changed'), c('colVisibility', 'Visibility'), '']}>
      ${items.map(m => html`
        <${ListRow} key=${m.key}>
          <${Name} asKey onOpen=${() => pickView({ kind: 'record', key: m.key })} tag=${sharedWith(m.key).length ? (t('profile.memory.shSharedBadge') || 'shared') : null}>${displayRemainder(m.key, s.g)}<//>
          <${Cell} meta>${formatBytes(m.bytes)}<//>
          <${When}>${formatRelativeTime(m.updated_at || m.created_at)}<//>
          <${Cell} line>${visMark(m.visibility)}<//>
          <${Doors}><${Action} small row onClick=${() => pickView({ kind: 'record', key: m.key })}>${c('open', 'Open')}<//><//>
        <//>`)}
    <//>
    <${Space} above="medium"><${Tabs} value=${spaceSort} onSelect=${(k) => setSpaceSort(k)} items=${sorts.map(([value, label]) => ({ value, label }))} /><//>` });
}

/* ── A record as a page ────────────────────────────────────────────────────────────────────── */
function renderRecord(ctx, key) {
  const { memories, orgNames, showRaw, setShowRaw, valueCopyText, valueOf, setEditModal, handleQuickVis, editingMemTags, setEditingMemTags, handleUpdateMemoryTags, sharesCovering, revokeCoveringShare, openSharePanel, inCart, memCartItem, toggleCartItem, fedConsents, handleShareToFederation, handleStopSharing, togglingFed, session, doPull, doPush, handleDeleteMemory, showToast, NODE_URL, pickView } = ctx;
  const m = (memories || []).find(x => x.key === key) || (ctx.searchResults || []).find(x => x.key === key);
  const g = groupOfKey(key);
  const cls = classify(memories, orgNames);
  const space = cls.spaces.get(g.id);
  const crumbs = [{ label: space ? space.label : g.id, go: () => pickView({ kind: 'space', id: g.id }) }, { label: displayRemainder(key, g) }];
  if (!m) return renderPage(ctx, { id: 'record', crumbs, title: key, children: html`<${Note} kind="quiet">${t('profile.memory.empty') || 'Not found.'}<//>` });
  const v = valueOf(m);
  const owner = m.owner_gaii || ctx.currentGhii();
  const url = `${NODE_URL}/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`;
  const covering = sharesCovering(key);
  const doors = html`
    ${v !== undefined ? html`<${Action} small soft copy=${valueCopyText(m)} onCopied=${() => showToast(t('profile.memory.valueCopied') || 'Value copied')}>${t('profile.memory.copyValue') || 'Copy value'}<//>` : null}
    <${Action} small soft copy=${url} onCopied=${() => showToast(t('profile.files.urlCopied') || 'URL copied')}>${t('common.copyUrl') || 'Copy URL'}<//>
    <${Action} small onClick=${() => setEditModal({ key, value: typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''), visibility: m.visibility || 'private', version: m.version, isJson: typeof v === 'object' && v !== null })}>${t('profile.memory.editBtn') || 'Edit'}<//>`;
  // The record's own settings stand in the side column, over its rail.
  const aside = html`
    <${Choice} label=${c('visibility', 'Visibility')} hint=${c('visHint', 'Public: anyone with the address reads it. Sharing with a group is done per key space, not per key.')}
      value=${m.visibility || 'private'} onChange=${(x) => handleQuickVis(m, x)}
      options=${VIS_OPTIONS.filter(x => x !== 'group').map(x => [x, t('knowledge.visibility.' + x) || x])} />
    <${Field} label=${c('tags', 'Tags')} group>
      ${editingMemTags === key ? html`<${TagEditor} tags=${m.tags || []} onSave=${(tags) => { handleUpdateMemoryTags(key, tags, m.version); setEditingMemTags(null); }} />`
        : html`<${Row} wrap above="tight">
            ${(m.tags || []).map(tag => html`<${Mark} key=${tag} tone="dim">${tag}<//>`)}
            <${Action} small soft onClick=${() => setEditingMemTags(key)}>${t('tags.editTags') || 'Edit tags'}<//>
          <//>`}
    <//>
    ${covering.length ? html`<${Field} label=${c('share', 'key-space share')} group>
      <${List} cols="key-doors" keepCols>${covering.map(sh => html`
        <${ListRow} key=${sh.id}>
          <${Name} asKey meta=${' → ' + (sh.group?.name || sh.group_id)}>${sh.key_pattern}<//>
          <${Doors}><${Action} small row soft onClick=${() => revokeCoveringShare(sh)}>${t('profile.memory.shRevoke') || 'Stop sharing'}<//><//>
        <//>`)}<//>
    <//>` : null}`;
  const inIt = inCart(memCartItem(m));
  const rail = {
    groups: [
      { label: c('thisRecord', 'This record'), items: [{ back: true, key: 'space', label: space ? space.label : g.id, onClick: () => pickView({ kind: 'space', id: g.id }) }] },
      { items: [
        { key: 'cart', mark: '·', label: inIt ? (t('profile.memory.cartRemove') || 'Remove from collection') : c('toCart', 'To the collection'), count: inIt ? '✓' : '+', onClick: () => toggleCartItem(memCartItem(m)) },
        { key: 'share', mark: '·', label: c('shareGroup', 'Share with a group'), count: '→', onClick: () => { openSharePanel(key); pickView({ kind: 'space', id: g.id }); } },
        fedConsents[key]
          ? { key: 'fed', mark: '·', label: t('profile.memory.stopSharing') || 'Stop federation sharing', count: '→', disabled: togglingFed === key, onClick: () => handleStopSharing(key) }
          : { key: 'fed', mark: '·', label: c('federate', 'Share to the federation'), count: '→', disabled: togglingFed === key, onClick: () => handleShareToFederation(key) },
        session?.federated ? { key: 'pull', mark: '↓', label: t('profile.memory.pullFromHome'), onClick: () => doPull(key) } : null,
        session?.federated ? { key: 'push', mark: '↑', label: t('profile.memory.pushToHome'), onClick: () => doPush(key) } : null,
      ] },
      { items: [{ key: 'delete', mark: '·', label: t('profile.memory.deleteBtn') || 'Delete', count: '…', onClick: () => handleDeleteMemory(key) }] },
    ],
  };
  return renderPage(ctx, { id: 'record', crumbs, title: key, doors, rail, aside, children: html`
    <${Row} gap="large" wrap above="small">
      ${m.created_at ? html`<${Note} kind="meta" inline mono>${c('created', 'created')} ${day(m.created_at)}<//>` : null}
      ${m.updated_at ? html`<${Note} kind="meta" inline mono>${c('changed', 'changed')} ${formatRelativeTime(m.updated_at)}${agentOf(m.owner_gaii) ? ' · ' + agentOf(m.owner_gaii) : ''}<//>` : null}
      ${m.version != null ? html`<${Note} kind="meta" inline mono>${c('version', 'version {n}').replace('{n}', String(m.version))}<//>` : null}
      ${typeof m.bytes === 'number' ? html`<${Note} kind="meta" inline mono>${formatBytes(m.bytes)}<//>` : null}
      ${visMark(m.visibility)}
    <//>
    <${Split} heavy above="large" pad="large">
      <${StoredValue} value=${ctx.valueOf(m)} name=${m.key} raw=${showRaw} loadingLabel=${t('profile.memory.loadingValue') || 'Loading value…'} />
      ${v !== undefined ? html`<${FormActions}><${Action} small soft onClick=${() => setShowRaw(r => !r)}>${showRaw ? c('showPretty', 'Show readable') : c('showRaw', 'Show raw')}<//><//>` : null}
    <//>` });
}

/* ── The other pages: the old list, discovery, remote nodes, the collection, export/import ── */
function renderOther(ctx, id) {
  const { cart, cartOrgs, removeCartItem, clearCart, NODE_URL, showToast, memArchived, setMemArchived, fullLoaded, loadFullContents, handleExport, importing, triggerImport, importMode, setImportMode, importFileRef, handleImportFile } = ctx;
  const page = PAGES.find(p => p[0] === id) || PAGES[0];
  const title = c(page[1], page[2]);
  let body = null, doors = null;
  if (id === 'all' || id === 'archived') {
    // Active and Archived choose what the key list shows: two fold tabs, the shown one pressed.
    doors = html`
      <${Tab} tone="fold" on=${!memArchived} pressed=${!memArchived} onClick=${() => setMemArchived(false)}>${t('profile.memory.viewActive') || 'Active'}<//>
      <${Tab} tone="fold" on=${memArchived} pressed=${memArchived} onClick=${() => setMemArchived(true)}>${t('profile.memory.viewArchived') || 'Archived'}<//>`;
    body = renderEntries(ctx);
  } else if (id === 'discover' || id === 'remote') {
    body = renderBrowsePanel(ctx);
  } else if (id === 'cart') {
    body = cart.length ? html`<${CartTray} cart=${cart} nodeUrl=${NODE_URL} orgs=${cartOrgs} onRemove=${removeCartItem} onClear=${clearCart} showToast=${showToast} />` : html`<${Note} kind="hint">${c('cartEmpty', 'The collection is empty. Add records and files to it from their pages, then export them as a list, a ZIP or a workspace source.')}<//>`;
  } else if (id === 'tools') {
    body = html`
      <${Fields}>
        <${SettingBox} label=${t('profile.memory.exportBtn') || 'Export'} irreversible>
          <${Note} kind="hint">${c('exportHint', 'A JSON backup of every key in this memory (the selected agent’s, if one is chosen). A key space can be exported alone from its own page.')}<//>
          <${FormActions}><${Loud} onClick=${() => handleExport()}>${t('profile.memory.exportBtn') || 'Export'}<//><//>
        <//>
        <${SettingBox} label=${t('profile.memory.importBtn') || 'Import'} irreversible>
          <${Note} kind="hint">${c('importHint', 'A JSON backup made here or by an agent. Choose first what happens when a key already exists.')}<//>
          <${FormActions}>
            <${Choice} value=${importMode} onChange=${setImportMode} options=${['skip', 'overwrite', 'rename'].map(mode => [mode, t('profile.memory.importMode.' + mode) || mode])} />
            <${Loud} control disabled=${importing} onClick=${triggerImport}>${importing ? '…' : (t('profile.memory.importBtn') || 'Import')}<//>
          <//>
          <${FileDrop} hidden accept="application/json,.json" inputRef=${importFileRef} onChange=${handleImportFile} />
        <//>
        ${!fullLoaded ? html`<${SettingBox} label=${t('profile.memory.loadContents') || 'Load all contents'}>
          <${Note} kind="hint">${c('loadAllHint', 'The list carries keys and sizes only; loading every value lets the filter on the All-as-keys page search inside them. Costs one large read.')}<//>
          <${FormActions}><${Action} small onClick=${loadFullContents}>${t('profile.memory.loadContents') || 'Load all contents'}<//><//>
        <//>` : null}
      <//>`;
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
