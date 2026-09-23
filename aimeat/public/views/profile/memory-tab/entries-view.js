/**
 * @file public/views/profile/memory-tab/entries-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Renderer for the Memory tab "entries" sub-tab — quota bar, data tools (load/export/
 *   import), content search + filters, sort, bulk bar, tag cloud, and the collapsible grouped list
 *   of memory rows with per-row visibility/rules/cart/federation controls. Extracted verbatim from
 *   memory-tab.js as a ctx-consuming plain render function (all state/handlers passed in via ctx).
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: a key space is a Fold, a key is a ListRow
 *     whose visibility badge opens a Menu, the quota is a Meter, fields are Fields. The emoji
 *     buttons (cart, shield, magnifier, bin, archive) became words or inline SVG icons.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.1.0 — 2026-08-11 — Sharing left the visibility menu. A row shows a "shared · N" badge when a
 *     key-space share covers its key (with the group names in the title), and the expanded row can
 *     open a share panel pre-filled with the key's own space. Picking a group from a VISIBILITY
 *     list shared exactly one record, which went stale the moment the next one was written.
 *   v1.0.0 — 2026-07-13 — Extracted from public/views/profile/memory-tab.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { recipientBadge } from '../shared.js';
import { detectImage, ImageView } from '/components/ImageDeliverable.js';
import TagCloud from '/js/components/tag-cloud.js';
import TagEditor from '/js/components/tag-editor.js';
import { Fold, ListRow, Chip, Action, CopyAction, Field, Menu, Meter, Surface, Text, Stack } from '/components/poster-parts.js';
import { formatBytes, formatRelativeTime, shortTok, groupOfKey, displayRemainder, VIS_OPTIONS } from './helpers.js';
import { MemoryForm } from './components.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime as fmtDateTime } from '/js/format.js';

// Inline icons on the 20 px grid (the design language allows no emoji).
const SHIELD = html`<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2 3 5v5c0 4 3 7 7 8 4-1 7-4 7-8V5z" /></svg>`;
const CART = html`<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h3l2 10h9l2-7H6" /><circle cx="8" cy="17" r="1.3" /><circle cx="15" cy="17" r="1.3" /></svg>`;

export function sortEntries(entries, sortBy) {
  const sorted = [...entries];
  switch (sortBy) {
    case 'updated':
      return sorted.sort((a, b) => +new Date(b.updated_at || 0) - +new Date(a.updated_at || 0));
    case 'created':
      return sorted.sort((a, b) => +new Date(b.created_at || 0) - +new Date(a.created_at || 0));
    case 'alpha':
      return sorted.sort((a, b) => a.key.localeCompare(b.key));
    case 'size':
      return sorted.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
    default:
      return sorted;
  }
}

/** The opened row: the whole key, the value, and everything that can be done to the record. */
function renderDetail(ctx, m) {
  const {
    valueOf, fullLoaded, handleQuickVis, editingMemTags, setEditingMemTags, keyRulesPopover, setKeyRulesPopover,
    loadKeyPerms, sharePanelFor, openSharePanel, setSharePanelFor, sharesCovering, revokeCoveringShare, groups,
    sharePattern, setSharePattern, shareGroupId, setShareGroupId, submitShare, handleUpdateMemoryTags, setEditModal,
    valueCopyText, showToast, fedConsents, togglingFed, handleStopSharing, handleShareToFederation, session, doPull,
    doPush, handleDeleteMemory,
  } = ctx;
  // Every share that reaches this key, each with the way to end it. A share is a rule over a
  // PATTERN, so the action says what it revokes: pressing it takes the whole pattern back.
  const covering = sharesCovering ? sharesCovering(m.key) : [];
  return html`<${Stack} density="compact">
    <${Text} kind="mono">${m.key}<//>
    ${(!fullLoaded && valueOf(m) === undefined)
      // Always "loading", never a bare ellipsis: the open row fetches its own value (see the
      // effect in memory-tab.js), so a missing value is a read in flight and not a state a
      // person is supposed to interpret.
      ? html`<${Text} kind="caption" tone="muted">${t('profile.memory.loadingValue') || 'Loading value…'}<//>`
      : html`
        ${(() => { const v = valueOf(m); const im = detectImage(v, m.key); return im ? html`<${ImageView} desc=${im} />` : null; })()}
        <${Surface} kind="code">${(() => { const v = valueOf(m); return typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''); })()}<//>`}
    <${Field} type="select" label=${t('profile.memory.visLabel')} value=${m.visibility || 'private'}
      onChange=${(e) => handleQuickVis(m, e.target.value)}
      options=${VIS_OPTIONS.map(v => ({ value: v, label: t('knowledge.visibility.' + v) }))} />
    <${Stack} direction="wrap" align="center">
      <${Action} onClick=${() => setEditingMemTags(editingMemTags === m.key ? null : m.key)}>${t('tags.editTags') || 'Edit tags'}<//>
      <${Action} onClick=${() => { if (keyRulesPopover?.key === m.key) setKeyRulesPopover(null); else loadKeyPerms(m.key); }}>${t('permissions.sharingRules')}<//>
      <${Action} onClick=${() => { if (sharePanelFor === m.key) setSharePanelFor(null); else openSharePanel(m.key); }}>${t('profile.memory.shShareThis')}<//>
    <//>
    ${covering.length > 0 && html`<${Stack} density="compact">${covering.map(sh => html`
      <${ListRow} key=${sh.id} density="compact" name=${sh.group?.name || sh.group_id} detail=${sh.key_pattern}
        actions=${html`<${Action} title=${(t('profile.memory.shRevokeTitle') || 'Stop sharing {pattern}').replace('{pattern}', sh.key_pattern)}
          onClick=${() => revokeCoveringShare(sh)}>${t('profile.memory.shRevoke') || 'Stop sharing'}<//>`} />`)}<//>`}
    ${sharePanelFor === m.key && html`<${Surface} kind="box" density="compact"><${Stack}>
      ${groups.length === 0 ? html`
        <${Text} kind="caption" tone="muted">${t('profile.memory.shNoGroups')}<//>
        <${Stack} direction="wrap"><${Action} onClick=${() => {
          try { sessionStorage.setItem('aimeat.access.focus', 'groups'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
          window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'access' } }));
        }}>${t('profile.memory.createGroupBtn')}<//><//>` : html`
        <${Field} label=${t('profile.access.shPattern')} value=${sharePattern} hint=${t('profile.access.shPatternHelp')}
          onInput=${e => setSharePattern(e.target.value)} />
        <${Field} type="select" label=${t('profile.memory.shPickGroup')} value=${shareGroupId} onChange=${e => setShareGroupId(e.target.value)}
          options=${groups.map(g => ({ value: g.id, label: g.name }))} />
        <${Stack} direction="wrap" align="center">
          <${Action} onClick=${submitShare}>${t('profile.access.shCreate')}<//>
          <${Action} onClick=${() => setSharePanelFor(null)}>${t('profile.access.shCancel')}<//>
        <//>`}
    <//><//>`}
    ${editingMemTags === m.key && html`<${TagEditor} tags=${m.tags || []} onSave=${(tags) => handleUpdateMemoryTags(m.key, tags, m.version)} />`}
    ${editingMemTags !== m.key && m.tags?.length > 0 && html`<${Text} kind="caption" tone="muted">${m.tags.join(', ')}<//>`}
    ${keyRulesPopover && keyRulesPopover.key === m.key && html`<${Surface} kind="box" density="compact"><${Stack} density="compact">
      <${Stack} direction="horizontal" align="between">
        <${Text} kind="label">${t('permissions.sharingRules')}<//>
        <${Action} kind="text" label=${t('profile.cancel')} onClick=${() => setKeyRulesPopover(null)}>✗<//>
      <//>
      <${Text} kind="caption" tone="muted">${t('profile.memory.visLabel')} ${t('knowledge.visibility.' + keyRulesPopover.visibility) || keyRulesPopover.visibility}<//>
      ${keyRulesPopover.rules.length === 0
        ? html`<${Text} kind="caption" tone="muted">${t('permissions.noRules')}<//>`
        : keyRulesPopover.rules.map((r, i) => html`<${ListRow} key=${i} density="compact" name=${r.data_pattern} value=${r.scope || '-'} actions=${recipientBadge(r.recipient)} />`)}
    <//><//>`}
    <${Stack} direction="wrap" align="center">
      <${Action} onClick=${() => { const v = valueOf(m); setEditModal({ key: m.key, value: typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''), visibility: m.visibility || 'private', version: m.version, isJson: typeof v === 'object' && v !== null }); }}>${t('profile.memory.editBtn')}<//>
      ${valueOf(m) !== undefined && html`<${CopyAction} text=${valueCopyText(m)} label=${t('profile.memory.copyValue') || 'Copy value'}
        onCopied=${() => showToast(t('profile.memory.valueCopied') || 'Value copied')} />`}
      ${fedConsents[m.key]
        ? html`<${Action} disabled=${togglingFed === m.key} onClick=${() => handleStopSharing(m.key)}>${togglingFed === m.key ? '...' : t('profile.memory.stopSharing')}<//>`
        : html`<${Action} disabled=${togglingFed === m.key} onClick=${() => handleShareToFederation(m.key)}>${togglingFed === m.key ? '...' : t('profile.memory.shareToFederation')}<//>`}
      ${session.federated && html`
        <${Action} title=${t('profile.memory.pullFromHome')} onClick=${() => doPull(m.key)}>${t('profile.memory.pullFromHome')}<//>
        <${Action} title=${t('profile.memory.pushToHome')} onClick=${() => doPush(m.key)}>${t('profile.memory.pushToHome')}<//>`}
      <${Action} onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn')}<//>
    <//>
  <//>`;
}

export function renderEntries(ctx) {
  const {
    memories, valueOf, sortBy, setSortBy, memTagFilter, setMemTagFilter, filterText, setFilterText,
    expandedMem, setExpandedMem, ensureValue, selectedKeys, toggleSelected, setSelectedKeys,
    keyHasRules, loadKeyPerms, fedConsents, inCart, memCartItem, toggleCartItem, addCartItems, applyVis, groups,
    showToast, memQuota, loadFullContents, handleExport, importing, fullLoaded,
    triggerImport, importMode, setImportMode, importFileRef, handleImportFile, searchInput,
    setSearchInput, runServerSearch, searchScopePrefix, setSearchScopePrefix, searchLoading,
    searchResults, clearServerSearch, memArchived, setMemArchived, showMemForm, setShowMemForm,
    handleCreateMemory, bulkVis, setBulkVis, applyBulkVis, bulkDelete, collapsedGroups,
    toggleGroupCollapsed, groupLabel, orgNames, deleteGroup, sharedWith,
  } = ctx;

  if (!memories) return html`<${Text} tone="muted">${t('profile.memory.loading')}<//>`;

  // Tag counts across memories — the cloud shows the most-used first, capped at 10.
  const tagCounts = new Map();
  for (const m of memories) {
    if (m.tags) for (const tag of m.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const tagsByFreq = [...tagCounts.keys()].sort((a, b) => (tagCounts.get(b) - tagCounts.get(a)) || a.localeCompare(b));

  // Filter: selected tags AND the live type-to-filter text (key, tags, value).
  const ft = filterText.trim().toLowerCase();
  const filtered = sortEntries(memories.filter(m => {
    if (memTagFilter.size > 0 && !(m.tags && [...memTagFilter].every(tag => m.tags.includes(tag)))) return false;
    if (!ft) return true;
    if (m.key.toLowerCase().includes(ft)) return true;
    if (m.tags && m.tags.some(tag => tag.toLowerCase().includes(ft))) return true;
    const v = valueOf(m);   // undefined in meta mode (value not loaded) → key/tag filter only
    if (v === undefined) return false;
    try { return JSON.stringify(v).toLowerCase().includes(ft); } catch (err) { swallowed('entries-view', err); return false; }
  }), sortBy);

  const toggleMemTag = (tag) => {
    setMemTagFilter(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  // Group in sorted order (group order = first appearance, so sort semantics hold).
  const groupsOrdered = [];
  const byId = new Map();
  for (const m of filtered) {
    const g = groupOfKey(m.key);
    let entry = byId.get(g.id);
    if (!entry) { entry = { ...g, items: [] }; byId.set(g.id, entry); groupsOrdered.push(entry); }
    entry.items.push(m);
  }
  // An active filter force-expands all groups — a hit hidden in a collapsed group reads as "no hit".
  const filtering = !!ft || memTagFilter.size > 0;

  const renderRow = (m, g) => {
    // A key covered by a share reads as private in the badge, because it IS private — the share is
    // the exception on top. Saying so on the row is the only way the owner can see, while scanning,
    // which of their records somebody else can also read.
    const via = sharedWith(m.key);
    const carted = inCart(memCartItem(m));
    return html`<${ListRow} key=${m.key} density="compact" name=${displayRemainder(m.key, g)}
      onOpen=${() => { const opening = expandedMem !== m.key; setExpandedMem(opening ? m.key : null); if (opening) ensureValue(m.key); }}
      mark=${html`<${Field} type="checkbox" value=${selectedKeys.has(m.key)} onChange=${() => toggleSelected(m.key)} />`}
      detail=${html`<span title="${m.created_at ? fmtDateTime(m.created_at) : ''} / ${m.updated_at ? fmtDateTime(m.updated_at) : ''}">${typeof m.bytes === 'number' ? formatBytes(m.bytes) + ' · ' : ''}${formatRelativeTime(m.updated_at || m.created_at)}</span>`}
      value=${html`<${Stack} direction="wrap" align="center" density="compact">
        ${via.length > 0 && html`<${Chip} title=${t('profile.memory.shSharedWith').replace('{names}', via.map(x => x.name).join(', '))}>${t('profile.memory.shSharedBadge')} · ${via.length}<//>`}
        ${fedConsents[m.key] && html`<${Chip} tone="sun">${t('profile.memory.syncedToFederation')}<//>`}
        ${keyHasRules(m.key) && html`<${Action} kind="icon" label=${t('permissions.sharingRules')} title=${t('permissions.sharingRules')} onClick=${() => loadKeyPerms(m.key)}>${SHIELD}<//>`}
        <${Menu} label=${t('profile.memory.visLabel')} trigger=${t('profile.visibility.' + (m.visibility || 'private'))}
          items=${VIS_OPTIONS.filter(v => v !== 'group').map(v => ({ id: v, label: t('knowledge.visibility.' + v), onClick: () => applyVis(m, v) }))} />
        <${Action} kind="icon" selected=${carted} onClick=${() => toggleCartItem(memCartItem(m))}
          label=${carted ? (t('profile.memory.cartRemove') || 'Remove from collection') : (t('profile.memory.cartAdd') || 'Add to collection')}
          title=${carted ? (t('profile.memory.cartRemove') || 'Remove from collection') : (t('profile.memory.cartAdd') || 'Add to collection')}>${CART}<//><//>`}>
      ${expandedMem === m.key ? renderDetail(ctx, m) : null}
    <//>`;
  };

  return html`<${Stack}>
    ${memQuota && html`<${Stack} density="compact">
      <${Text} kind="caption" tone="muted">${t('profile.memory.storageUsed') || 'Storage'}: ${memQuota.used_keys}/${memQuota.max_keys} ${t('profile.memory.keysWord') || 'keys'} · ${formatBytes(memQuota.used_bytes)} / ${formatBytes(memQuota.max_bytes)}<//>
      <${Meter} value=${memQuota.used_bytes || 0} max=${memQuota.max_bytes || 0} label=${t('profile.memory.storageUsed') || 'Storage'} />
    <//>`}
    <${Stack} direction="wrap" align="end">
      <${Text} kind="label">${t('profile.memory.toolsLabel') || 'Tools'}<//>
      ${!fullLoaded && html`<${Action} onClick=${loadFullContents}>${t('profile.memory.loadContents') || 'Load all contents'}<//>`}
      <${Action} onClick=${() => handleExport()}>${t('profile.memory.exportBtn') || 'Export'}<//>
      <${Action} disabled=${importing} onClick=${triggerImport}>${importing ? '…' : (t('profile.memory.importBtn') || 'Import')}<//>
      <${Field} type="select" label=${t('profile.memory.importModeLabel') || 'Conflict handling'} value=${importMode} onChange=${e => setImportMode(e.target.value)}
        options=${[{ value: 'skip', label: t('profile.memory.importMode.skip') || 'Skip existing' }, { value: 'overwrite', label: t('profile.memory.importMode.overwrite') || 'Overwrite' }, { value: 'rename', label: t('profile.memory.importMode.rename') || 'Import as new' }]} />
      <input type="file" accept="application/json,.json" ref=${importFileRef} hidden onChange=${handleImportFile} />
    <//>
    <${Stack} direction="wrap" align="end">
      <${Field} type="search" placeholder=${t('profile.memory.searchContents') || 'Search content or key…'}
        value=${searchInput} onInput=${e => setSearchInput(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter') runServerSearch(searchInput, searchScopePrefix); }} />
      <${Action} disabled=${searchLoading} onClick=${() => runServerSearch(searchInput, searchScopePrefix)}>${searchLoading ? '…' : (t('profile.memory.searchBtn') || 'Search')}<//>
      ${searchResults !== null && html`<${Action} kind="text" label=${t('profile.memory.searchClear') || 'Clear search'} onClick=${clearServerSearch}>✗<//>`}
      <${Field} type="search" placeholder=${t('profile.memory.filterType')} value=${filterText} onInput=${e => setFilterText(e.target.value)} />
      ${filterText && html`<${Action} kind="text" label=${t('search.clear') || 'Clear'} onClick=${() => setFilterText('')}>✗<//>`}
      <${Action} kind="tab" semantics="radio" selected=${!memArchived} onClick=${() => setMemArchived(false)}>${t('profile.memory.viewActive') || 'Active'}<//>
      <${Action} kind="tab" semantics="radio" selected=${memArchived} onClick=${() => setMemArchived(true)}>${t('profile.memory.viewArchived') || 'Archived'}<//>
    <//>
    <${Stack} direction="horizontal" align="between">
      <${Field} type="select" label=${t('profile.memory.sortLabel')} value=${sortBy} onChange=${e => setSortBy(e.target.value)}
        options=${[{ value: 'updated', label: t('profile.memory.sortUpdated') }, { value: 'created', label: t('profile.memory.sortCreated') }, { value: 'alpha', label: t('profile.memory.sortAlpha') }, { value: 'size', label: t('profile.memory.sortSize') || 'Largest first' }]} />
      <${Action} kind="primary" onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}<//>
    <//>
    <${TagCloud} tags=${tagsByFreq} selected=${memTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemTagFilter(new Set())} limit=${10} />
    ${showMemForm && html`<${Surface} kind="panel"><${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} /><//>`}
    ${selectedKeys.size > 0 && html`<${Stack} direction="wrap" align="end">
      <${Text} kind="label">${(t('profile.memory.bulkSelected') || '{n} selected').replace('{n}', String(selectedKeys.size))}<//>
      ${/* Sharing is not a visibility any more, so the bulk bar changes visibility only. Sharing
            many keys at once is one share over a pattern that covers them, which is the Access
            tab or the row's own share panel — not a per-record loop dressed up as a bulk edit. */''}
      <${Field} type="select" value=${bulkVis} onChange=${e => setBulkVis(e.target.value)}
        options=${VIS_OPTIONS.filter(v => v !== 'group').map(v => ({ value: v, label: t('knowledge.visibility.' + v) }))} />
      <${Action} onClick=${applyBulkVis}>${t('profile.memory.bulkApply') || 'Change visibility'}<//>
      <${Action} onClick=${() => { addCartItems((memories || []).filter(m => selectedKeys.has(m.key)).map(memCartItem)); }}>${t('profile.memory.cartAddSelected') || 'Add to collection'}<//>
      <${Action} onClick=${bulkDelete}>${t('profile.memory.deleteBtn')}<//>
      <${Action} onClick=${() => setSelectedKeys(new Set())}>${t('profile.memory.bulkClear') || 'Clear selection'}<//>
    <//>`}
    ${searchResults !== null
      ? html`
          <${Stack} direction="horizontal" align="between">
            <${Text} kind="caption" tone="muted">${(t('profile.memory.searchResultCount') || '{n} matches').replace('{n}', String(searchResults.length))}${searchScopePrefix ? ` · ${searchScopePrefix}` : ''}<//>
            <${Action} onClick=${clearServerSearch}>${t('profile.memory.searchClear') || 'Clear search'}<//>
          <//>
          ${searchResults.length === 0
            ? html`<${Text} tone="muted">${t('profile.memory.searchEmpty') || 'No matches'}<//>`
            : html`<${Stack} density="compact">${sortEntries(searchResults, sortBy).map(m => renderRow(m, groupOfKey(m.key)))}<//>`}`
      : filtered.length === 0
        ? html`<${Text} tone="muted">${memories.length > 0 ? (t('tags.noMatch') || 'No items match selected tags') : t('profile.memory.empty')}<//>`
        : html`<div>${groupsOrdered.map(g => {
            const collapsed = !filtering && collapsedGroups.has(g.id);
            const groupPrefix = g.kind === 'organism' ? 'organism.' + g.uuid + '.' : g.kind === 'plain' ? g.id + '.' : null;
            const count = g.items.length === 1 ? (t('profile.memory.keysOne') || '1 key') : (t('profile.memory.keysCount') || '{n} keys').replace('{n}', String(g.items.length));
            return html`<${Fold} key=${g.id} title=${groupLabel(g)} open=${!collapsed} onToggle=${() => toggleGroupCollapsed(g.id)}
              sub=${count + (g.kind === 'organism' && orgNames[g.uuid] ? ' · ' + shortTok(g.uuid) : '')}>
              ${groupPrefix && html`<${Stack} direction="wrap" align="center">
                <${Action} onClick=${() => { setSearchInput(''); setSearchScopePrefix(groupPrefix); showToast((t('profile.memory.searchInGroupHint') || 'Type a query to search within {g}').replace('{g}', groupLabel(g))); }}>${t('profile.memory.searchInGroup') || 'Search in this group'}<//>
                <${Action} onClick=${() => deleteGroup(g, g.items.length)}>${t('profile.memory.deleteGroup') || 'Delete group'}<//>
              <//>`}
              <${Stack} density="compact">${g.items.map(m => renderRow(m, g))}<//>
            <//>`;
          })}</div>`
    }
  <//>`;
}
