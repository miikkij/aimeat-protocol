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
 *   Every shape comes from the shared component set (/components/poster-parts.js).
 * @structure SYSTEM_SPACES · classify · renderMemoryView (cover or page) · renderCover · renderSpace ·
 *   renderRecord (./record.js) · renderOther
 * @usage import { renderMemoryView } from './memory-tab/cover.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, Section, Fold, Table, ListRow,
 *     NumeralBand, Rail, Chip, Action, Field, Surface, Text); the page frame and the record page moved
 *     to ./frame.js and ./record.js. No own classes, so css/views/memory.css could go.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
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
import AuthImage from '/js/components/auth-image.js';
import { Page, Rail, Section, Fold, Table, ListRow, NumeralBand, Chip, Action, CopyAction, Field, Surface, Text, Stack, Menu } from '/components/poster-parts.js';
import { formatBytes, formatRelativeTime, displayRemainder } from './helpers.js';
import { fileCategory, fileBytesUrl } from './file-helpers.js';
import { MemoryForm, FileUploadForm, CartTray } from './components.js';
import { renderEntries } from './entries-view.js';
import { renderBrowsePanel } from './browse-view.js';
import { c, num, agentOf, isStale, byUpdated, classify, visChip, renderPage, PAGES, pageDoors, crumbList, formBox } from './frame.js';
import { renderRecord } from './record.js';

export { SYSTEM_SPACES, classify } from './frame.js';

const TABLE_ROWS = 12;   // a table shows this many key spaces before asking for the rest

/* ── One table of key spaces ───────────────────────────────────────────────────────────────── */
function spaceTable(ctx, list, { id = '' } = {}) {
  const open = !id || ctx.moreOpen.has(id);
  const shown = open ? list : list.slice(0, TABLE_ROWS);
  const rows = shown.map(s => [
    html`<${Text} kind="number" size="small">${s.items.length}<//>`,
    html`<${Stack} direction="wrap" align="center" density="compact">
      <${Action} kind="text" onClick=${() => ctx.pickView({ kind: 'space', id: s.id })}>${s.label}<//>
      ${s.publicN ? html`<${Chip} tone="sun">${c('publicN', '{n} public').replace('{n}', String(s.publicN))}<//>` : null}
      ${s.membersN ? html`<${Chip}>${c('membersN', '{n} for members').replace('{n}', String(s.membersN))}<//>` : null}
    <//>`,
    { text: formatBytes(s.bytes), mono: true },
    s.latest ? html`<${Action} kind="text" onClick=${() => ctx.pickView({ kind: 'record', key: s.latest.key })}>${displayRemainder(s.latest.key, s.g)} · ${formatRelativeTime(s.latest.updated_at || s.latest.created_at)}<//>` : '·',
    html`<${Action} onClick=${() => ctx.pickView({ kind: 'space', id: s.id })}>${c('open', 'Open')}<//>`,
  ]);
  return html`
    <${Table} density="compact" label=${c('colSpace', 'Key space')} headers=${['', c('colSpace', 'Key space'), c('colSize', 'Size'), c('colLatest', 'Latest'), '']} rows=${rows} />
    ${list.length > TABLE_ROWS && !open ? html`<${Action} onClick=${() => ctx.toggleMore(id)}>${c('showAll', 'show all {n}').replace('{n}', String(list.length))}<//>` : null}`;
}

function fileRows(ctx, files) {
  const { NODE_URL, setPreviewFile, handleDownloadFile, handleDeleteFile, showToast } = ctx;
  if (!files.length) return html`<${Text} tone="muted">${t('profile.files.empty') || 'No files yet.'}<//>`;
  return html`<${Stack} density="compact">${files.map(f => {
    const key = f.key || f.name;
    const cat = fileCategory(f.mime_type, key);
    const isImage = String(f.mime_type || '').startsWith('image');
    const url = f.owner_gaii ? `${NODE_URL}/v1/pub/${encodeURIComponent(f.owner_gaii)}/${String(key).split('/').map(encodeURIComponent).join('/')}` : `${NODE_URL}/v1/memory/files/${encodeURIComponent(key)}`;
    return html`
      <${ListRow} key=${key} density="compact" name=${key}
        mark=${isImage ? html`<${AuthImage} src=${fileBytesUrl(f, NODE_URL)} alt=${key} />` : html`<${Chip}>${String(cat || 'file').slice(0, 4)}<//>`}
        detail=${`${f.size ? formatBytes(f.size) : ''} · ${t('knowledge.visibility.' + (f.visibility || 'private')) || f.visibility}`}
        actions=${html`
          <${Action} onClick=${() => setPreviewFile(f)}>${t('profile.files.preview') || 'Preview'}<//>
          <${CopyAction} text=${url} label=${t('common.copyUrl') || 'Copy URL'} onCopied=${() => showToast(t('profile.files.urlCopied') || 'URL copied')} />
          <${Action} onClick=${() => handleDownloadFile(f)}>${t('profile.files.download') || 'Download'}<//>
          <${Action} onClick=${() => handleDeleteFile(key)}>${t('profile.files.delete') || 'Delete'}<//>`} />`;
  })}<//>`;
}

function agentPicker(ctx, agentName) {
  const { agents, setSelectedAgent } = ctx;
  if (agents.length <= 1) return html`<${Chip} tone="muted">${agentName}<//>`;
  return html`<${Menu} label=${t('profile.memory.agent') || 'Agent'} trigger=${agentName} items=${[
    { id: '', label: t('profile.memory.defaultAgent') || 'Default agent', onClick: () => setSelectedAgent('') },
    ...agents.map(a => ({ id: a.gaii, label: a.name || a.gaii, onClick: () => setSelectedAgent(a.gaii) })),
  ]} />`;
}

/* ── The cover ─────────────────────────────────────────────────────────────────────────────── */
function renderCover(ctx) {
  const {
    memories, files, memQuota, orgNames, agents, selectedAgent, fedConsents, shares, groups,
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
  const ownCount = cls.own.reduce((n, s) => n + s.items.length, 0);
  const orgCount = cls.org.reduce((n, s) => n + s.items.length, 0);
  const seenRows = [];
  if (publicKeys.length) seenRows.push(html`<${ListRow} key="pub" density="compact" name=${c('publicKeys', '{n} public keys').replace('{n}', String(publicKeys.length))}
    detail=${publicKeys.slice(0, 3).map(m => m.key).join(' · ') + (publicKeys.length > 3 ? ' …' : '')} value=${visChip('public')} />`);
  if (membersKeys.length) seenRows.push(html`<${ListRow} key="mem" density="compact" name=${c('membersKeys', '{n} keys for signed-in users').replace('{n}', String(membersKeys.length))} value=${visChip('members')} />`);
  for (const sh of shares || []) seenRows.push(html`<${ListRow} key=${'sh' + sh.id} density="compact" name=${sh.key_pattern}
    detail=${'→ ' + (groups.find(g => g.id === sh.group_id)?.name || sh.group_id)} value=${html`<${Chip}>${c('share', 'key-space share')}<//>`}
    actions=${html`<${Action} onClick=${() => ctx.revokeCoveringShare(sh)}>${t('profile.memory.shRevoke') || 'Stop sharing'}<//>`} />`);
  if (fedKeys.length) seenRows.push(html`<${ListRow} key="fed" density="compact" name=${c('fedKeys', '{n} keys in the federation').replace('{n}', String(fedKeys.length))}
    detail=${fedKeys.slice(0, 3).join(' · ')} value=${html`<${Chip} tone="muted">${c('federation', 'federation')}<//>`} />`);

  const nSys = '03';
  const railEntries = [
    { id: 'mp-own', href: '#mp-own', label: c('own', 'Mine'), count: ownCount },
    { id: 'mp-org', href: '#mp-org', label: c('orgs', 'Organisms’'), count: orgCount },
    { id: 'mp-sys', href: '#mp-sys', label: c('sys', 'The machine’s bookkeeping'), count: sysCount },
    { id: 'mp-files', href: '#mp-files', label: c('files', 'Files'), count: (files || []).length },
    { id: 'mp-history', href: '#mp-history', label: c('happened', 'What has happened'), count: '→' },
    { id: 'mp-stale', href: '#mp-stale', label: c('stale', 'Stale'), count: stale.length },
    { id: 'mp-seen', href: '#mp-seen', label: c('seen', 'Who else sees'), count: seenRows.length },
  ];

  const searchRow = (showSearch || searchResults !== null) ? html`
    <${Stack} direction="wrap" align="end">
      <${Field} type="search" label=${c('searchSlab', 'Search memory')} placeholder=${t('profile.memory.searchContents') || 'Search content or key…'} value=${searchInput}
        onInput=${e => setSearchInput(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') runServerSearch(searchInput, ctx.searchScopePrefix); }} />
      <${Action} disabled=${searchLoading} onClick=${() => runServerSearch(searchInput, ctx.searchScopePrefix)}>${searchLoading ? '…' : (t('profile.memory.searchBtn') || 'Search')}<//>
      <${Action} onClick=${() => { clearServerSearch(); setShowSearch(false); }}>${t('search.clear') || 'Clear'}<//>
    <//>` : null;

  const resultRows = searchResults !== null ? html`
    <${Section} id="mp-results" title=${c('searchResults', '{n} matches').replace('{n}', String(searchResults.length))}>
      ${searchResults.length === 0 ? html`<${Text} tone="muted">${t('profile.memory.searchEmpty') || 'No matches'}<//>` : html`<${Stack} density="compact">${searchResults.map(m => html`
        <${ListRow} key=${m.key} density="compact" time=${formatRelativeTime(m.updated_at || m.created_at)} name=${m.key}
          onOpen=${() => pickView({ kind: 'record', key: m.key })} value=${visChip(m.visibility)} />`)}<//>`}
    <//>` : null;

  const doorsAll = (arrow) => html`<${Action} onClick=${() => pickView({ kind: 'page', id: 'all' })}>${c('allKeys', 'All as keys')}${arrow ? ' →' : ''}<//>`;

  return html`<${Page} title=${t('profile.memory.title') || 'Memory'} crumbs=${crumbList(ctx, [])}
    identity=${html`<${Stack} direction="wrap" align="center" density="compact">
      <${Chip}>${num(all.length)} ${c('figKeys', 'keys')}<//>
      <${Chip}>${formatBytes(bytes)}<//>
      ${changedToday ? html`<${Chip} tone="sun">${c('changedToday', '{n} changed today').replace('{n}', String(changedToday))}<//>` : null}
      ${agentPicker(ctx, agentName)}
    <//>`}
    actions=${html`
      <${Action} kind="primary" onClick=${() => setShowSearch(true)}>${c('searchSlab', 'Search memory')}<//>
      <${Action} onClick=${() => { setShowFileForm(false); setShowMemForm(s => !s); }}>${c('newEntry', '+ New entry')}<//>
      <${Action} onClick=${() => { setShowMemForm(false); setShowFileForm(s => !s); }}>${c('upload', 'Upload a file')}<//>`}
    rail=${html`<${Rail} kind="index" title=${c('railTitle', 'In your memory')} entries=${railEntries}>
      <${Stack} density="compact">${pageDoors(ctx, null)}<//>
    <//>`}>
    <${Stack}>
      <${Text} tone="muted">${c('desc', 'What you and your agents have written here: notes, settings, research and the organisms’ content. Yours, and yours to decide about.')}<//>
      <${NumeralBand} tone="plain" size="small" items=${[
        { id: 'keys', label: c('figKeys', 'keys'), value: num(all.length), note: `${memQuota?.max_keys ? c('figOf', 'of {n}').replace('{n}', num(memQuota.max_keys)) + ' · ' : ''}${c('figSpaces', '{n} key spaces').replace('{n}', String(cls.spaces.size))}` },
        { id: 'bytes', label: '', value: formatBytes(memQuota?.used_bytes ?? bytes), note: memQuota?.max_bytes ? c('figOf', 'of {n}').replace('{n}', formatBytes(memQuota.max_bytes)) : undefined },
        { id: 'stale', label: c('figStale', 'stale'), value: stale.length, note: c('figStaleSub', 'not changed in 90 days') },
        { id: 'last', label: c('figLast', 'last change'), value: last ? formatRelativeTime(last.updated_at || last.created_at) : '·', tone: last ? 'coral' : undefined,
          note: last ? `${agentOf(last.owner_gaii) || c('you', 'you')} ${c('wrote', 'wrote')} ${last.key}` : undefined },
      ]} />
      ${searchRow}
      ${showMemForm ? formBox(c('newEntry', '+ New entry'), html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} />`) : null}
      ${showFileForm ? formBox(c('upload', 'Upload a file'), html`<${FileUploadForm} onUpload=${handleUploadFiles} onCancel=${() => setShowFileForm(false)} />`) : null}
      ${resultRows}

      <${Section} id="mp-own" title=${c('own', 'Mine')} count=${ownCount} actions=${doorsAll(false)}>
        <${Stack}>
          ${cls.own.length ? spaceTable(ctx, cls.own, { id: 'own' }) : html`<${Text} tone="muted">${t('profile.memory.empty') || 'Nothing here yet.'}<//>`}
          <${Text} kind="caption" tone="muted">${c('spaceHint', 'A key space is the first part of a key: document/pitch-2026 belongs to document. It is the unit that is shared, exported and cleaned.')}<//>
        <//>
      <//>

      <${Section} id="mp-org" title=${c('orgs', 'Organisms’')} count=${orgCount}
        actions=${html`<${Action} onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }))}>${t('organisms.title') || 'Organisms'} →<//>`}>
        <${Stack}>
          ${cls.org.length ? spaceTable(ctx, cls.org, { id: 'org' }) : html`<${Text} tone="muted">${t('profile.memory.empty') || 'Nothing here yet.'}<//>`}
          <${Text} kind="caption" tone="muted">${c('orgHint', 'An organism’s content lives in your memory when you or your agents wrote it. It is managed on the organism’s page; here it shows so you know what you own and how much it takes.')}<//>
        <//>
      <//>

      <${Fold} id="mp-sys" number=${nSys} title=${c('sys', 'The machine’s bookkeeping')} sub=${`${sysCount} ${c('figKeys', 'keys')} · ${formatBytes(sysBytes)}`} open=${sysOpen} onToggle=${() => setSysOpen(o => !o)}>
        <${Text} kind="caption" tone="muted">${c('sysHint', 'What your environment and your agents write for their own use: notices, meters, receipts. Yours as well, but rarely for you to read.')}<//>
        ${cls.sys.length ? spaceTable(ctx, cls.sys, { id: 'sys' }) : html`<${Text} tone="muted">${t('profile.memory.empty') || 'Nothing here yet.'}<//>`}
      <//>

      <${Section} id="mp-files" title=${c('files', 'Files')} count=${(files || []).length}
        actions=${html`<${Action} onClick=${() => { setShowMemForm(false); setShowFileForm(s => !s); }}>${c('upload', 'Upload a file')}<//>`}>
        ${fileRows(ctx, files || [])}
      <//>

      <${Section} id="mp-history" title=${c('happened', 'What has happened')} actions=${doorsAll(true)}>
        ${recent.length ? html`<${Stack} density="compact">${recent.map(m => html`
          <${ListRow} key=${m.key} density="compact" time=${formatRelativeTime(m.updated_at || m.created_at)} name=${m.key}
            onOpen=${() => pickView({ kind: 'record', key: m.key })} detailKind="text"
            detail=${`${agentOf(m.owner_gaii) || c('you', 'you')} ${c('wrote', 'wrote')}`} />`)}<//>`
          : html`<${Text} tone="muted">${t('profile.memory.empty') || 'Nothing here yet.'}<//>`}
      <//>

      <${Section} id="mp-stale" title=${c('stale', 'Stale')} count=${stale.length}
        description=${c('staleHint', 'Keys nobody has changed in 90 days. Open one to decide; delete what no longer matters.')}>
        ${stale.length ? html`<${Stack} density="compact">${(staleAll ? stale : stale.slice(0, 8)).map(m => html`
          <${ListRow} key=${m.key} density="compact" name=${m.key} detail=${`${formatBytes(m.bytes)} · ${formatRelativeTime(m.updated_at || m.created_at)}`}
            actions=${html`<${Action} onClick=${() => pickView({ kind: 'record', key: m.key })}>${c('open', 'Open')}<//>
              <${Action} onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn') || 'Delete'}<//>`} />`)}
          ${stale.length > 8 && !staleAll ? html`<${Action} onClick=${() => setStaleAll(true)}>${c('showAll', 'show all {n}').replace('{n}', String(stale.length))}<//>` : null}<//>`
          : html`<${Text} tone="muted">${c('noStale', 'Nothing has gone stale.')}<//>`}
      <//>

      <${Section} id="mp-seen" title=${c('seen', 'Who else sees')} count=${seenRows.length}
        actions=${html`<${Action} onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'access' } }))}>${t('profile.tabs.access') || 'Access'} →<//>`}>
        ${seenRows.length ? html`<${Stack} density="compact">${seenRows}<//>` : html`<${Text} tone="muted">${c('none', 'Nobody but you and your agents.')}<//>`}
      <//>
    <//>
  <//>`;
}

/* ── A key space as a page ─────────────────────────────────────────────────────────────────── */
function renderSpace(ctx, id) {
  const { memories, orgNames, spaceSort, setSpaceSort, pickView, handleExport, addCartItems, memCartItem, deleteGroup, openSharePanel, sharePanelFor, setSharePanelFor, sharePattern, setSharePattern, shareGroupId, setShareGroupId, submitShare, groups, showMemForm, setShowMemForm, handleCreateMemory, setShowSearch, setSearchScopePrefix, sharedWith } = ctx;
  const cls = classify(memories, orgNames);
  const s = cls.spaces.get(id);
  if (!s) return renderPage(ctx, { id: 'space', crumbs: [{ label: id }], title: id, children: html`<${Text} tone="muted">${t('profile.memory.empty') || 'Nothing here.'}<//>` });
  const prefix = s.g.kind === 'organism' ? 'organism.' + s.g.uuid + '.' : s.g.kind === 'plain' ? s.id + '.' : '';
  const items = [...s.items];
  if (spaceSort === 'alpha') items.sort((a, b) => a.key.localeCompare(b.key));
  else if (spaceSort === 'size') items.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  const kind = s.bucket === 'org' ? c('kindOrg', 'organism') : s.bucket === 'sys' ? c('kindSys', 'bookkeeping') : c('kindOwn', 'your key space');
  const sub = html`<${Stack} direction="wrap" align="center" density="compact">
    <${Chip} tone="muted">${kind}<//><${Chip}>${s.items.length} ${c('figKeys', 'keys')}<//><${Chip}>${formatBytes(s.bytes)}<//>
    ${s.publicN ? html`<${Chip} tone="sun">${c('publicN', '{n} public').replace('{n}', String(s.publicN))}<//>` : null}<//>`;
  const doors = html`
    ${prefix ? html`<${Action} onClick=${() => { setSearchScopePrefix(prefix); setShowSearch(true); pickView({ kind: 'cover' }); }}>${c('searchHere', 'Search this space')}<//>` : null}
    <${Action} onClick=${() => setShowMemForm(v => !v)}>${c('newEntry', '+ New entry')}<//>`;
  const rail = html`<${Rail} kind="index" title=${c('thisSpace', 'This key space')}><${Stack} density="compact">
    ${prefix ? html`<${Action} kind="text" onClick=${() => openSharePanel(s.items[0].key)}>${c('shareGroup', 'Share with a group')} →<//>` : null}
    ${prefix ? html`<${Action} kind="text" onClick=${() => handleExport(prefix)}>${c('exportSpace', 'Export this space')} →<//>` : null}
    <${Action} kind="text" onClick=${() => addCartItems(s.items.map(memCartItem))}>${c('toCart', 'To the collection')} +${s.items.length}<//>
    ${prefix ? html`<${Action} kind="text" onClick=${() => deleteGroup(s.g, s.items.length)}>${c('deleteSpace', 'Delete the space')} …<//>` : null}
  <//><//>`;
  const rows = items.map(m => [
    html`<${Stack} direction="wrap" align="center" density="compact">
      <${Action} kind="text" onClick=${() => pickView({ kind: 'record', key: m.key })}>${displayRemainder(m.key, s.g)}<//>
      ${sharedWith(m.key).length ? html`<${Chip}>${t('profile.memory.shSharedBadge') || 'shared'}<//>` : null}<//>`,
    { text: formatBytes(m.bytes), mono: true },
    { text: formatRelativeTime(m.updated_at || m.created_at), mono: true },
    visChip(m.visibility),
    html`<${Action} onClick=${() => pickView({ kind: 'record', key: m.key })}>${c('open', 'Open')}<//>`,
  ]);
  return renderPage(ctx, { id: 'space', crumbs: [{ label: s.label }], title: s.label, sub, doors, rail, children: html`
    ${showMemForm ? formBox(c('newEntry', '+ New entry'), html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} />`) : null}
    ${sharePanelFor ? html`<${Surface} kind="aside" density="compact"><${Stack}>
      <${Text} kind="label">${c('shareGroup', 'Share with a group')}<//>
      ${groups.length === 0 ? html`<${Text} tone="muted">${t('profile.memory.shNoGroups') || 'No sharing groups yet.'}<//>` : html`
        <${Field} label=${t('profile.access.shPattern') || 'Pattern'} value=${sharePattern} onInput=${e => setSharePattern(e.target.value)} hint=${t('profile.access.shPatternHelp') || undefined} />
        <${Field} type="select" label=${t('profile.memory.shPickGroup') || 'Group'} value=${shareGroupId} onChange=${e => setShareGroupId(e.target.value)}
          options=${groups.map(g => ({ value: g.id, label: g.name }))} />
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" onClick=${submitShare}>${t('profile.access.shCreate') || 'Share'}<//>
          <${Action} onClick=${() => setSharePanelFor(null)}>${t('profile.access.shCancel') || 'Cancel'}<//>
        <//>`}
    <//><//>` : null}
    <${Table} density="compact" label=${s.label} headers=${[c('colKey', 'Key'), c('colSize', 'Size'), c('colChanged', 'Changed'), c('colVisibility', 'Visibility'), '']} rows=${rows} />
    <${Stack} direction="wrap" align="center" density="compact">${[['updated', c('sortUpdated', 'by change')], ['alpha', c('sortAlpha', 'alphabetical')], ['size', c('sortSize', 'largest first')]].map(([k, l]) => html`
      <${Action} key=${k} kind="tab" semantics="radio" selected=${spaceSort === k} onClick=${() => setSpaceSort(k)}>${l}<//>`)}<//>` });
}

/* ── The other pages: the old list, discovery, remote nodes, the collection, export/import ── */
function renderOther(ctx, id) {
  const { cart, cartOrgs, removeCartItem, clearCart, NODE_URL, showToast, memArchived, setMemArchived, fullLoaded, loadFullContents, handleExport, importing, triggerImport, importMode, setImportMode, importFileRef, handleImportFile } = ctx;
  const page = PAGES.find(p => p[0] === id) || PAGES[0];
  const title = c(page[1], page[2]);
  let body = null, doors = null;
  if (id === 'all' || id === 'archived') {
    doors = html`
      <${Action} kind="tab" semantics="radio" selected=${!memArchived} onClick=${() => setMemArchived(false)}>${t('profile.memory.viewActive') || 'Active'}<//>
      <${Action} kind="tab" semantics="radio" selected=${memArchived} onClick=${() => setMemArchived(true)}>${t('profile.memory.viewArchived') || 'Archived'}<//>`;
    body = renderEntries(ctx);
  } else if (id === 'discover' || id === 'remote') {
    body = renderBrowsePanel(ctx);
  } else if (id === 'cart') {
    body = cart.length ? html`<${CartTray} cart=${cart} nodeUrl=${NODE_URL} orgs=${cartOrgs} onRemove=${removeCartItem} onClear=${clearCart} showToast=${showToast} />`
      : html`<${Text} tone="muted">${c('cartEmpty', 'The collection is empty. Add records and files to it from their pages, then export them as a list, a ZIP or a workspace source.')}<//>`;
  } else if (id === 'tools') {
    body = html`
      <${Section} id="mp-export" size="small" title=${t('profile.memory.exportBtn') || 'Export'}
        description=${c('exportHint', 'A JSON backup of every key in this memory (the selected agent’s, if one is chosen). A key space can be exported alone from its own page.')}>
        <${Stack} direction="wrap"><${Action} kind="primary" onClick=${() => handleExport()}>${t('profile.memory.exportBtn') || 'Export'}<//><//>
      <//>
      <${Section} id="mp-import" size="small" title=${t('profile.memory.importBtn') || 'Import'}
        description=${c('importHint', 'A JSON backup made here or by an agent. Choose first what happens when a key already exists.')}>
        <${Stack} direction="wrap" align="center">
          ${['skip', 'overwrite', 'rename'].map(mode => html`<${Action} key=${mode} kind="tab" semantics="radio" selected=${importMode === mode} onClick=${() => setImportMode(mode)}>${t('profile.memory.importMode.' + mode) || mode}<//>`)}
          <${Action} disabled=${importing} onClick=${triggerImport}>${importing ? '…' : (t('profile.memory.importBtn') || 'Import')}<//>
        <//>
        <input type="file" accept="application/json,.json" ref=${importFileRef} hidden onChange=${handleImportFile} />
      <//>
      ${!fullLoaded ? html`<${Section} id="mp-loadall" size="small" title=${t('profile.memory.loadContents') || 'Load all contents'}
        description=${c('loadAllHint', 'The list carries keys and sizes only; loading every value lets the filter on the All-as-keys page search inside them. Costs one large read.')}>
        <${Stack} direction="wrap"><${Action} onClick=${loadFullContents}>${t('profile.memory.loadContents') || 'Load all contents'}<//><//>
      <//>` : null}`;
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
