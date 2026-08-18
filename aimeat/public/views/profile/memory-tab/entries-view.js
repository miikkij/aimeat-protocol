/**
 * @file public/views/profile/memory-tab/entries-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Renderer for the Memory tab "entries" sub-tab — quota bar, data tools (load/export/
 *   import), content search + filters, sort, bulk bar, tag cloud, and the collapsible grouped list
 *   of memory rows with per-row visibility/rules/cart/federation controls. Extracted verbatim from
 *   memory-tab.js as a ctx-consuming plain render function (all state/handlers passed in via ctx).
 * @version-history
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
import { escHtml } from '/js/utils.js';
import { Spinner, recipientBadge, VisibilityPill } from '../shared.js';
import { detectImage, ImageView } from '/components/ImageDeliverable.js';
import TagCloud from '/js/components/tag-cloud.js';
import TagEditor from '/js/components/tag-editor.js';
import { CopyButton } from '/components/CopyButton.js';
import { formatBytes, formatRelativeTime, shortTok, groupOfKey, displayRemainder, VIS_OPTIONS } from './helpers.js';
import { MemoryForm } from './components.js';
import { swallowed } from '/js/swallowed.js';

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

export function renderEntries(ctx) {
  const {
    memories, valueOf, sortBy, setSortBy, memTagFilter, setMemTagFilter, filterText, setFilterText,
    expandedMem, setExpandedMem, ensureValue, selectedKeys, toggleSelected, setSelectedKeys,
    visPopoverFor, setVisPopoverFor, keyHasRules, loadKeyPerms, fedConsents, inCart, memCartItem,
    toggleCartItem, addCartItems, applyVis, groups, handleQuickVis, fullLoaded,
    editingMemTags, setEditingMemTags, keyRulesPopover, setKeyRulesPopover, handleUpdateMemoryTags,
    setEditModal, valueCopyText, showToast, togglingFed, handleStopSharing, handleShareToFederation,
    session, doPull, doPush, handleDeleteMemory, memQuota, loadFullContents, handleExport, importing,
    triggerImport, importMode, setImportMode, importFileRef, handleImportFile, searchInput,
    setSearchInput, runServerSearch, searchScopePrefix, setSearchScopePrefix, searchLoading,
    searchResults, clearServerSearch, memArchived, setMemArchived, showMemForm, setShowMemForm,
    handleCreateMemory, bulkVis, setBulkVis, applyBulkVis, bulkDelete, collapsedGroups,
    toggleGroupCollapsed, groupLabel, orgNames, deleteGroup,
    sharedWith, sharesCovering, revokeCoveringShare, sharePanelFor, openSharePanel, setSharePanelFor,
    sharePattern, setSharePattern, shareGroupId, setShareGroupId, submitShare,
  } = ctx;

  if (!memories) return html`<${Spinner} text=${t('profile.memory.loading')} />`;

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

  const renderRow = (m, g) => html`
    <div key=${m.key}>
      <div class="mem-item mem-item--grouped" onClick=${() => { const opening = expandedMem !== m.key; setExpandedMem(opening ? m.key : null); if (opening) ensureValue(m.key); }}>
        <input type="checkbox" class="mem-row-check" checked=${selectedKeys.has(m.key)}
          onClick=${(e) => e.stopPropagation()} onChange=${() => toggleSelected(m.key)} />
        <span class="mem-key" title=${m.key}>${escHtml(displayRemainder(m.key, g))}</span>
        ${typeof m.bytes === 'number' && html`<span class="pf-mem-size" title=${t('profile.memory.sizeLabel') || 'Value size'}>${formatBytes(m.bytes)}</span>`}
        <span class="mem-time" title="${m.created_at ? new Date(m.created_at).toLocaleString() : ''} / ${m.updated_at ? new Date(m.updated_at).toLocaleString() : ''}">
          ${formatRelativeTime(m.updated_at || m.created_at)}
        </span>
        <${VisibilityPill} visibility=${m.visibility || 'private'}
          onClick=${(e) => { e.stopPropagation(); setVisPopoverFor(visPopoverFor === m.key ? null : m.key); }} />
        ${(() => {
          // A key covered by a share reads as private in the pill above, because it IS private —
          // the share is the exception on top. Saying so on the row is the only way the owner can
          // see, while scanning, which of their records somebody else can also read.
          const via = sharedWith(m.key);
          return via.length > 0 && html`
            <span class="badge badge-info" title=${t('profile.memory.shSharedWith').replace('{names}', via.map(g => g.name).join(', '))}>
              ${t('profile.memory.shSharedBadge')} · ${via.length}
            </span>`;
        })()}
        ${keyHasRules(m.key) && html`<span class="shield-icon" title=${t('permissions.sharingRules')} onClick=${(e) => { e.stopPropagation(); loadKeyPerms(m.key); }}>\u{1F6E1}️</span>`}
        ${fedConsents[m.key] && html`<span class="badge badge-success pf-fed-badge">${t('profile.memory.syncedToFederation')}</span>`}
        <button class="mem-cart-btn ${inCart(memCartItem(m)) ? 'mem-cart-btn--on' : ''}"
          title=${inCart(memCartItem(m)) ? (t('profile.memory.cartRemove') || 'Remove from collection') : (t('profile.memory.cartAdd') || 'Add to collection')}
          onClick=${(e) => { e.stopPropagation(); toggleCartItem(memCartItem(m)); }}>🛒</button>
      </div>
      ${visPopoverFor === m.key && html`
        <div class="mem-vis-pop" onClick=${(e) => e.stopPropagation()}>
          ${VIS_OPTIONS.filter(v => v !== 'group').map(v => html`
            <button key=${v} class="mem-vis-opt ${(m.visibility || 'private') === v ? 'mem-vis-opt--current' : ''}"
              onClick=${() => applyVis(m, v)}>${t('knowledge.visibility.' + v)}</button>
          `)}
        </div>
      `}
      ${expandedMem === m.key && html`
        <div class="mem-detail">
          <div class="mem-detail-key" title=${m.key}>${escHtml(m.key)}</div>
          ${(!fullLoaded && valueOf(m) === undefined)
            // Always "loading", never a bare ellipsis: the open row fetches its own value (see the
            // effect in memory-tab.js), so a missing value is a read in flight and not a state a
            // person is supposed to interpret. It used to render "…" for good when a background
            // refresh replaced the list with a values-free one under an already-open row.
            ? html`<div class="text-meta-sm">${t('profile.memory.loadingValue') || 'Loading value…'}</div>`
            : html`
              ${(() => { const v = valueOf(m); const im = detectImage(v, m.key); return im ? html`<${ImageView} desc=${im} />` : null; })()}
              <pre>${(() => { const v = valueOf(m); return typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''); })()}</pre>
            `}
          <div class="mem-detail-visrow mb-half">
            <span class="text-meta-sm">${t('profile.memory.visLabel')}</span>
            <select class="input-field mem-vis-select" value=${m.visibility || 'private'}
              onClick=${(e) => e.stopPropagation()}
              onChange=${(e) => handleQuickVis(m, e.target.value)}>
              ${VIS_OPTIONS.map(v => html`<option key=${v} value=${v}>${t('knowledge.visibility.' + v)}</option>`)}
            </select>
          </div>
          <div class="mb-half">
            <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setEditingMemTags(editingMemTags === m.key ? null : m.key); }}>
              ${t('tags.editTags') || 'Edit tags'}
            </button>
            <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); if (keyRulesPopover?.key === m.key) setKeyRulesPopover(null); else loadKeyPerms(m.key); }}>
              \u{1F6E1}️ ${t('permissions.sharingRules')}
            </button>
            <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); if (sharePanelFor === m.key) setSharePanelFor(null); else openSharePanel(m.key); }}>
              ${t('profile.memory.shShareThis')}
            </button>
          </div>
          ${(() => {
            // Every share that reaches this key, each with the way to end it. A share is a rule over
            // a PATTERN, so the button says what it revokes: pressing it takes the whole pattern
            // back, not this one record.
            const covering = sharesCovering ? sharesCovering(m.key) : [];
            return covering.length > 0 && html`
              <div class="mem-shares mb-half">
                ${covering.map(sh => html`
                  <div class="mem-share-row" key=${sh.id}>
                    <span class="text-meta-sm">${sh.group?.name || sh.group_id} · <code>${escHtml(sh.key_pattern)}</code></span>
                    <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); revokeCoveringShare(sh); }}
                      title=${(t('profile.memory.shRevokeTitle') || 'Stop sharing {pattern}').replace('{pattern}', sh.key_pattern)}>
                      ${t('profile.memory.shRevoke') || 'Stop sharing'}
                    </button>
                  </div>`)}
              </div>`;
          })()}
          ${sharePanelFor === m.key && html`
            <div class="key-rules-box" onClick=${(e) => e.stopPropagation()}>
              ${groups.length === 0 ? html`
                <div class="text-meta-sm mb-half">${t('profile.memory.shNoGroups')}</div>
                <button class="btn-outline btn-sm" onClick=${() => {
                  try { sessionStorage.setItem('aimeat.access.focus', 'groups'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
                  window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'access' } }));
                }}>${t('profile.memory.createGroupBtn')}</button>
              ` : html`
                <div class="form-row">
                  <label>${t('profile.access.shPattern')}</label>
                  <input type="text" class="input-field input-sm" value=${sharePattern}
                    onInput=${e => setSharePattern(e.target.value)} />
                  <div class="text-meta-sm">${t('profile.access.shPatternHelp')}</div>
                </div>
                <div class="form-row">
                  <label>${t('profile.memory.shPickGroup')}</label>
                  <select class="input-field input-sm" value=${shareGroupId} onChange=${e => setShareGroupId(e.target.value)}>
                    ${groups.map(g => html`<option key=${g.id} value=${g.id}>${g.name}</option>`)}
                  </select>
                </div>
                <div class="form-actions">
                  <button class="btn-primary btn-sm" onClick=${submitShare}>${t('profile.access.shCreate')}</button>
                  <button class="btn-ghost btn-sm" onClick=${() => setSharePanelFor(null)}>${t('profile.access.shCancel')}</button>
                </div>
              `}
            </div>
          `}
          ${editingMemTags === m.key && html`
            <div class="mb-half">
              <${TagEditor} tags=${m.tags || []} onSave=${(tags) => handleUpdateMemoryTags(m.key, tags, m.version)} />
            </div>
          `}
          ${editingMemTags !== m.key && m.tags?.length > 0 && html`<div class="text-meta-sm mb-half">${m.tags.join(', ')}</div>`}
          ${keyRulesPopover && keyRulesPopover.key === m.key && html`
            <div class="key-rules-box">
              <div class="flex-between mb-half">
                <strong class="text-caption">\u{1F6E1}️ ${t('permissions.sharingRules')}</strong>
                <button class="btn-outline btn-sm" onClick=${() => setKeyRulesPopover(null)}>✕</button>
              </div>
              <div class="text-meta-sm mb-half">${t('profile.memory.visLabel')} ${t('knowledge.visibility.' + keyRulesPopover.visibility) || keyRulesPopover.visibility}</div>
              ${keyRulesPopover.rules.length === 0
                ? html`<div class="text-meta pf-italic">${t('permissions.noRules')}</div>`
                : keyRulesPopover.rules.map(r => html`
                  <div class="pf-rule-row">
                    ${recipientBadge(r.recipient)}
                    <span class="text-code text-meta-sm">${escHtml(r.data_pattern)}</span>
                    <span class="text-meta-sm pf-ml-auto">${escHtml(r.scope || '-')}</span>
                  </div>`)
              }
            </div>
          `}
          <div class="mem-actions">
            <button class="btn-sm" onClick=${() => { const v = valueOf(m); setEditModal({ key: m.key, value: typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''), visibility: m.visibility || 'private', version: m.version, isJson: typeof v === 'object' && v !== null }); }}>${t('profile.memory.editBtn')}</button>
            ${valueOf(m) !== undefined && html`<${CopyButton}
              text=${valueCopyText(m)}
              label=${'\u{1F4CB} ' + (t('profile.memory.copyValue') || 'Copy value')}
              className="btn-outline btn-sm"
              onCopied=${() => showToast(t('profile.memory.valueCopied') || 'Value copied')} />`}
            ${fedConsents[m.key]
              ? html`<button class="btn-outline btn-sm" disabled=${togglingFed === m.key}
                  onClick=${() => handleStopSharing(m.key)}>
                  ${togglingFed === m.key ? '...' : t('profile.memory.stopSharing')}
                </button>`
              : html`<button class="btn-ghost btn-sm" disabled=${togglingFed === m.key}
                  onClick=${() => handleShareToFederation(m.key)}>
                  ${togglingFed === m.key ? '...' : t('profile.memory.shareToFederation')}
                </button>`
            }
            ${session.federated && html`
              <button class="btn-ghost" onClick=${() => doPull(m.key)} title=${t('profile.memory.pullFromHome')}>
                ↓ ${t('profile.memory.pullFromHome')}
              </button>
              <button class="btn-ghost" onClick=${() => doPush(m.key)} title=${t('profile.memory.pushToHome')}>
                ↑ ${t('profile.memory.pushToHome')}
              </button>
            `}
            <button class="btn-danger mem-delete-btn" onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn')}</button>
          </div>
        </div>
      `}
    </div>
  `;

  const quotaPct = memQuota && memQuota.max_bytes ? Math.min(100, Math.round((memQuota.used_bytes / memQuota.max_bytes) * 100)) : 0;

  return html`
    ${memQuota && html`
      <div class="pf-mem-quota">
        <div class="pf-mem-quota-row">
          <span class="text-meta-sm">${t('profile.memory.storageUsed') || 'Storage'}: ${memQuota.used_keys}/${memQuota.max_keys} ${t('profile.memory.keysWord') || 'keys'} · ${formatBytes(memQuota.used_bytes)} / ${formatBytes(memQuota.max_bytes)}</span>
        </div>
        <div class="pf-mem-quota-bar"><div class="pf-mem-quota-fill ${quotaPct >= 90 ? 'pf-mem-quota-fill--danger' : ''}" style=${`width:${quotaPct}%`}></div></div>
      </div>
    `}
    <div class="mem-tools-section">
      <span class="mem-tools-label">${t('profile.memory.toolsLabel') || 'Tools'}</span>
      <div class="mem-tools-actions">
        ${!fullLoaded && html`<button class="btn-outline btn-sm" onClick=${loadFullContents}>${t('profile.memory.loadContents') || 'Load all contents'}</button>`}
        <span class="mem-import-group">
          <button class="btn-outline btn-sm" onClick=${() => handleExport()}>${t('profile.memory.exportBtn') || 'Export'}</button>
          <button class="btn-outline btn-sm" disabled=${importing} onClick=${triggerImport}>${importing ? '…' : (t('profile.memory.importBtn') || 'Import')}</button>
          <select class="input-field mem-vis-select" value=${importMode} onChange=${e => setImportMode(e.target.value)} title=${t('profile.memory.importModeLabel') || 'Conflict handling'}>
            <option value="skip">${t('profile.memory.importMode.skip') || 'Skip existing'}</option>
            <option value="overwrite">${t('profile.memory.importMode.overwrite') || 'Overwrite'}</option>
            <option value="rename">${t('profile.memory.importMode.rename') || 'Import as new'}</option>
          </select>
          <input type="file" accept="application/json,.json" ref=${importFileRef} class="pf-hidden" onChange=${handleImportFile} />
        </span>
      </div>
    </div>
    <div class="action-bar">
      <div class="search-bar">
        <input type="text" class="input-field" placeholder=${t('profile.memory.searchContents') || 'Search content or key…'}
          value=${searchInput} onInput=${e => setSearchInput(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Enter') runServerSearch(searchInput, searchScopePrefix); }} />
        <button class="btn-sm" disabled=${searchLoading} onClick=${() => runServerSearch(searchInput, searchScopePrefix)}>${searchLoading ? '…' : (t('profile.memory.searchBtn') || 'Search')}</button>
        ${searchResults !== null && html`<button class="btn-ghost btn-sm" onClick=${clearServerSearch}>✕</button>`}
      </div>
      <div class="search-bar">
        <input type="text" class="input-field" placeholder=${t('profile.memory.filterType')}
          value=${filterText} onInput=${e => setFilterText(e.target.value)} />
        ${filterText && html`<button class="btn-ghost btn-sm" onClick=${() => setFilterText('')}>✕</button>`}
      </div>
      <div class="search-bar">
        <button class="btn-sm ${!memArchived ? 'btn-primary' : 'btn-outline'}" onClick=${() => setMemArchived(false)}>${t('profile.memory.viewActive') || 'Active'}</button>
        <button class="btn-sm ${memArchived ? 'btn-primary' : 'btn-outline'}" onClick=${() => setMemArchived(true)}>${'🗄️ '}${t('profile.memory.viewArchived') || 'Archived'}</button>
      </div>
    </div>
    <div class="action-bar mem-bottom-bar">
      <div class="mem-sort-bar">
        <label class="text-meta-sm">${t('profile.memory.sortLabel')}</label>
        <select class="input-field mem-sort-select" value=${sortBy} onChange=${e => setSortBy(e.target.value)}>
          <option value="updated">${t('profile.memory.sortUpdated')}</option>
          <option value="created">${t('profile.memory.sortCreated')}</option>
          <option value="alpha">${t('profile.memory.sortAlpha')}</option>
          <option value="size">${t('profile.memory.sortSize') || 'Largest first'}</option>
        </select>
      </div>
      <button class="btn-primary mem-new-btn" onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}</button>
    </div>
    <${TagCloud} tags=${tagsByFreq} selected=${memTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemTagFilter(new Set())} limit=${10} />
    ${showMemForm && html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} />`}
    ${selectedKeys.size > 0 && html`
      <div class="mem-bulkbar">
        <span class="mem-bulkbar-count">${(t('profile.memory.bulkSelected') || '{n} selected').replace('{n}', String(selectedKeys.size))}</span>
        ${/* Sharing is not a visibility any more, so the bulk bar changes visibility only. Sharing
              many keys at once is one share over a pattern that covers them, which is the Access
              tab or the row's own share panel — not a per-record loop dressed up as a bulk edit. */''}
        <select class="input-field mem-vis-select" value=${bulkVis} onChange=${e => setBulkVis(e.target.value)}>
          ${VIS_OPTIONS.filter(v => v !== 'group').map(v => html`<option key=${v} value=${v}>${t('knowledge.visibility.' + v)}</option>`)}
        </select>
        <button class="btn-outline btn-sm" onClick=${applyBulkVis}>${t('profile.memory.bulkApply') || 'Change visibility'}</button>
        <button class="btn-outline btn-sm" onClick=${() => { addCartItems((memories || []).filter(m => selectedKeys.has(m.key)).map(memCartItem)); }}>🛒 ${t('profile.memory.cartAddSelected') || 'Add to collection'}</button>
        <button class="btn-danger btn-sm" onClick=${bulkDelete}>${t('profile.memory.deleteBtn')}</button>
        <button class="btn-ghost btn-sm" onClick=${() => setSelectedKeys(new Set())}>✕ ${t('profile.memory.bulkClear') || 'Clear selection'}</button>
      </div>
    `}
    ${searchResults !== null
      ? html`
          <div class="mem-search-summary">
            <span class="text-meta-sm">${(t('profile.memory.searchResultCount') || '{n} matches').replace('{n}', String(searchResults.length))}${searchScopePrefix ? ` · ${escHtml(searchScopePrefix)}` : ''}</span>
            <button class="btn-ghost btn-sm" onClick=${clearServerSearch}>✕ ${t('profile.memory.searchClear') || 'Clear search'}</button>
          </div>
          ${searchResults.length === 0
            ? html`<div class="empty">${t('profile.memory.searchEmpty') || 'No matches'}</div>`
            : sortEntries(searchResults, sortBy).map(m => renderRow(m, groupOfKey(m.key)))}
        `
      : filtered.length === 0
        ? html`<div class="empty">${memories.length > 0 ? (t('tags.noMatch') || 'No items match selected tags') : t('profile.memory.empty')}</div>`
        : groupsOrdered.map(g => {
            const collapsed = !filtering && collapsedGroups.has(g.id);
            const groupPrefix = g.kind === 'organism' ? 'organism.' + g.uuid + '.' : g.kind === 'plain' ? g.id + '.' : null;
            return html`
              <div class="mem-group" key=${g.id}>
                <div class="mem-group-header" role="button" tabindex="0" onClick=${() => toggleGroupCollapsed(g.id)}>
                  <span class="pf-chevron ${collapsed ? '' : 'pf-chevron-open'}">▼</span>
                  <span class="mem-group-name">${escHtml(groupLabel(g))}</span>
                  <span class="mem-group-count">${g.items.length === 1 ? (t('profile.memory.keysOne') || '1 key') : (t('profile.memory.keysCount') || '{n} keys').replace('{n}', String(g.items.length))}</span>
                  ${g.kind === 'organism' && orgNames[g.uuid] && html`<span class="mem-group-sub">${shortTok(g.uuid)}</span>`}
                  <span class="mem-group-actions">
                    ${groupPrefix && html`<button class="btn-ghost btn-sm" title=${t('profile.memory.searchInGroup') || 'Search in this group'}
                      onClick=${(e) => { e.stopPropagation(); setSearchInput(''); setSearchScopePrefix(groupPrefix); showToast((t('profile.memory.searchInGroupHint') || 'Type a query to search within {g}').replace('{g}', groupLabel(g))); }}>🔍</button>`}
                    ${groupPrefix && html`<button class="btn-ghost btn-sm" title=${t('profile.memory.deleteGroup') || 'Delete group'}
                      onClick=${(e) => { e.stopPropagation(); deleteGroup(g, g.items.length); }}>🗑️</button>`}
                  </span>
                </div>
                ${!collapsed && g.items.map(m => renderRow(m, g))}
              </div>
            `;
          })
    }`;
}
