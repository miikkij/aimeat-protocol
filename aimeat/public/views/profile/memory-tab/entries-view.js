/**
 * @file public/views/profile/memory-tab/entries-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Renderer for the Memory tab "entries" sub-tab — quota bar, data tools (load/export/
 *   import), content search + filters, sort, bulk bar, tag cloud, and the collapsible grouped list
 *   of memory rows with per-row visibility/rules/cart/federation controls. Extracted verbatim from
 *   memory-tab.js as a ctx-consuming plain render function (all state/handlers passed in via ctx).
 * @version-history
 *   v1.24.0 -- 2026-09-26 -- An entry's value is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.23.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.22.0 -- 2026-09-26 -- A key is the Key (.key-name, css/components/key-name.css); the key over an opened record keeps the small grey meta size (.text-meta-sm) (a unification: the look most tabs use).
 *   v1.21.0 -- 2026-09-26 -- A key's sharing rules are the Listing (who, the pattern, the scope); .pf-rule-row and .pf-ml-auto go (a unification: the look most tabs use).
 *   v1.20.0 -- 2026-09-26 -- The shield that opens a key's sharing rules is the small icon button (.poster-icon--small); .shield-icon's rules go (a unification: Jouni's decision Icon button).
 *   v1.19.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.18.0 -- 2026-09-25 -- A key's collection button is the Icon button's small cut (.poster-icon--small), pressed (.is-on, aria-pressed) while the key is in the collection, a unification.
 *   v1.17.0 -- 2026-09-25 -- Active and Archived over the key list, which choose what it shows, are the Tab's fold tone (.poster-tab--fold, the shown one is-on and aria-pressed), a unification: Jouni's decision "Tabs and filters".
 *   v1.16.0 -- 2026-09-25 -- The tools box's label is the row label (.poster-label) (Jouni's decision "Row label", a unification).
 *   v1.15.0 -- 2026-09-25 -- The storage bar is the quota meter (.poster-box--meter.poster-box--quota, is-full from 90 %), as the overview draws its storage, a unification: the look most tabs use.
 *   v1.14.0 -- 2026-09-25 -- A group of keys, a row that opens the keys under it, is the folded row (og-fold: its name, its count and id as the detail on the right, the arrow at the right; the chevron at the left goes), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- The visibility menu's options are the Tab (.poster-tab, the current one .is-on), a unification: Jouni's decision "Tabs and filters" (Choice).
 *   v1.12.0 -- 2026-09-25 -- A key's row, which opens its value in place, is the folded row (og-fold), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { escHtml } from '/js/utils.js';
import { LoadingLine, recipientBadge, VisibilityPill } from '../shared.js';
import { detectImage, ImageView } from '/components/ImageDeliverable.js';
import TagCloud from '/js/components/tag-cloud.js';
import TagEditor from '/js/components/tag-editor.js';
import { CopyButton } from '/components/CopyButton.js';
import { formatBytes, formatRelativeTime, shortTok, groupOfKey, displayRemainder, VIS_OPTIONS } from './helpers.js';
import { MemoryForm } from './components.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime as fmtDateTime } from '/js/format.js';

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

  if (!memories) return html`<${LoadingLine} text=${t('profile.memory.loading')} />`;

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
      <div class="og-fold mem-item--grouped" onClick=${() => { const opening = expandedMem !== m.key; setExpandedMem(opening ? m.key : null); if (opening) ensureValue(m.key); }}>
        <input type="checkbox" class="mem-row-check" checked=${selectedKeys.has(m.key)}
          onClick=${(e) => e.stopPropagation()} onChange=${() => toggleSelected(m.key)} />
        <span class="mem-key key-name" title=${m.key}>${escHtml(displayRemainder(m.key, g))}</span>
        ${typeof m.bytes === 'number' && html`<span class="pf-mem-size" title=${t('profile.memory.sizeLabel') || 'Value size'}>${formatBytes(m.bytes)}</span>`}
        <span class="mem-time poster-time" title="${m.created_at ? fmtDateTime(m.created_at) : ''} / ${m.updated_at ? fmtDateTime(m.updated_at) : ''}">
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
            <span class="poster-chip" title=${t('profile.memory.shSharedWith').replace('{names}', via.map(g => g.name).join(', '))}>
              ${t('profile.memory.shSharedBadge')} · ${via.length}
            </span>`;
        })()}
        ${keyHasRules(m.key) && html`<span class="poster-icon poster-icon--small" title=${t('permissions.sharingRules')} onClick=${(e) => { e.stopPropagation(); loadKeyPerms(m.key); }}>\u{1F6E1}️</span>`}
        ${fedConsents[m.key] && html`<span class="poster-chip pf-fed-badge">${t('profile.memory.syncedToFederation')}</span>`}
        <button class="poster-icon poster-icon--small ${inCart(memCartItem(m)) ? 'is-on' : ''}" aria-pressed=${inCart(memCartItem(m)) ? 'true' : 'false'}
          title=${inCart(memCartItem(m)) ? (t('profile.memory.cartRemove') || 'Remove from collection') : (t('profile.memory.cartAdd') || 'Add to collection')}
          onClick=${(e) => { e.stopPropagation(); toggleCartItem(memCartItem(m)); }}>🛒</button>
      </div>
      ${visPopoverFor === m.key && html`
        <div class="mem-vis-pop" onClick=${(e) => e.stopPropagation()}>
          ${VIS_OPTIONS.filter(v => v !== 'group').map(v => html`
            <button key=${v} class="poster-tab ${(m.visibility || 'private') === v ? 'is-on' : ''}"
              onClick=${() => applyVis(m, v)}>${t('knowledge.visibility.' + v)}</button>
          `)}
        </div>
      `}
      ${expandedMem === m.key && html`
        <div class="mem-detail poster-row--thing">
          <div class="mem-detail-key text-meta-sm key-name" title=${m.key}>${escHtml(m.key)}</div>
          ${(!fullLoaded && valueOf(m) === undefined)
            // Always "loading", never a bare ellipsis: the open row fetches its own value (see the
            // effect in memory-tab.js), so a missing value is a read in flight and not a state a
            // person is supposed to interpret. It used to render "…" for good when a background
            // refresh replaced the list with a values-free one under an already-open row.
            ? html`<div class="poster-quiet loading-mark">${t('profile.memory.loadingValue') || 'Loading value…'}</div>`
            : html`
              ${(() => { const v = valueOf(m); const im = detectImage(v, m.key); return im ? html`<${ImageView} desc=${im} />` : null; })()}
              <pre class="code-block">${(() => { const v = valueOf(m); return typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''); })()}</pre>
            `}
          <div class="mem-detail-visrow mb-half">
            <span class="text-meta-sm">${t('profile.memory.visLabel')}</span>
            <select class="select-field mem-vis-select" value=${m.visibility || 'private'}
              onClick=${(e) => e.stopPropagation()}
              onChange=${(e) => handleQuickVis(m, e.target.value)}>
              ${VIS_OPTIONS.map(v => html`<option key=${v} value=${v}>${t('knowledge.visibility.' + v)}</option>`)}
            </select>
          </div>
          <div class="mb-half">
            <button class="poster-action poster-action--small" onClick=${(e) => { e.stopPropagation(); setEditingMemTags(editingMemTags === m.key ? null : m.key); }}>
              ${t('tags.editTags') || 'Edit tags'}
            </button>
            <button class="poster-action poster-action--small" onClick=${(e) => { e.stopPropagation(); if (keyRulesPopover?.key === m.key) setKeyRulesPopover(null); else loadKeyPerms(m.key); }}>
              \u{1F6E1}️ ${t('permissions.sharingRules')}
            </button>
            <button class="poster-action poster-action--small" onClick=${(e) => { e.stopPropagation(); if (sharePanelFor === m.key) setSharePanelFor(null); else openSharePanel(m.key); }}>
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
                    <span class="text-meta-sm">${sh.group?.name || sh.group_id} · <code class="code-inline">${escHtml(sh.key_pattern)}</code></span>
                    <button class="poster-action poster-action--small" onClick=${(e) => { e.stopPropagation(); revokeCoveringShare(sh); }}
                      title=${(t('profile.memory.shRevokeTitle') || 'Stop sharing {pattern}').replace('{pattern}', sh.key_pattern)}>
                      ${t('profile.memory.shRevoke') || 'Stop sharing'}
                    </button>
                  </div>`)}
              </div>`;
          })()}
          ${sharePanelFor === m.key && html`
            <div class="key-rules-box poster-aside poster-aside--small" onClick=${(e) => e.stopPropagation()}>
              ${groups.length === 0 ? html`
                <div class="text-meta-sm mb-half">${t('profile.memory.shNoGroups')}</div>
                <button class="poster-action poster-action--small" onClick=${() => {
                  try { sessionStorage.setItem('aimeat.access.focus', 'groups'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
                  window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'access' } }));
                }}>${t('profile.memory.createGroupBtn')}</button>
              ` : html`
                <div class="form-row">
                  <label class="poster-label">${t('profile.access.shPattern')}</label>
                  <input type="text" class="og-input" value=${sharePattern}
                    onInput=${e => setSharePattern(e.target.value)} />
                  <div class="text-meta-sm">${t('profile.access.shPatternHelp')}</div>
                </div>
                <div class="form-row">
                  <label class="poster-label">${t('profile.memory.shPickGroup')}</label>
                  <select class="select-field" value=${shareGroupId} onChange=${e => setShareGroupId(e.target.value)}>
                    ${groups.map(g => html`<option key=${g.id} value=${g.id}>${g.name}</option>`)}
                  </select>
                </div>
                <div class="form-actions">
                  <button class="poster-slab poster-slab--control" onClick=${submitShare}>${t('profile.access.shCreate')}</button>
                  <button class="poster-action poster-action--small" onClick=${() => setSharePanelFor(null)}>${t('profile.access.shCancel')}</button>
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
            <div class="key-rules-box poster-aside poster-aside--small">
              <div class="flex-between mb-half">
                <strong class="text-caption">\u{1F6E1}️ ${t('permissions.sharingRules')}</strong>
                <button class="poster-icon poster-icon--small" onClick=${() => setKeyRulesPopover(null)}>✕</button>
              </div>
              <div class="text-meta-sm mb-half">${t('profile.memory.visLabel')} ${t('knowledge.visibility.' + keyRulesPopover.visibility) || keyRulesPopover.visibility}</div>
              ${keyRulesPopover.rules.length === 0
                ? html`<div class="poster-quiet">${t('permissions.noRules')}</div>`
                : html`<div class="listing listing--name-desc-doors">${keyRulesPopover.rules.map(r => html`
                  <div class="listing-row">
                    <div class="listing-name">${recipientBadge(r.recipient)}</div>
                    <div class="listing-desc"><span class="code-inline">${escHtml(r.data_pattern)}</span></div>
                    <div class="listing-doors">${escHtml(r.scope || '-')}</div>
                  </div>`)}</div>`
              }
            </div>
          `}
          <div class="mem-actions">
            <button class="poster-action poster-action--small" onClick=${() => { const v = valueOf(m); setEditModal({ key: m.key, value: typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''), visibility: m.visibility || 'private', version: m.version, isJson: typeof v === 'object' && v !== null }); }}>${t('profile.memory.editBtn')}</button>
            ${valueOf(m) !== undefined && html`<${CopyButton}
              text=${valueCopyText(m)}
              label=${'\u{1F4CB} ' + (t('profile.memory.copyValue') || 'Copy value')}
              className="poster-action poster-action--small"
              onCopied=${() => showToast(t('profile.memory.valueCopied') || 'Value copied')} />`}
            ${fedConsents[m.key]
              ? html`<button class="poster-action poster-action--small" disabled=${togglingFed === m.key}
                  onClick=${() => handleStopSharing(m.key)}>
                  ${togglingFed === m.key ? '...' : t('profile.memory.stopSharing')}
                </button>`
              : html`<button class="poster-action poster-action--small" disabled=${togglingFed === m.key}
                  onClick=${() => handleShareToFederation(m.key)}>
                  ${togglingFed === m.key ? '...' : t('profile.memory.shareToFederation')}
                </button>`
            }
            ${session.federated && html`
              <button class="poster-action poster-action--small" onClick=${() => doPull(m.key)} title=${t('profile.memory.pullFromHome')}>
                ↓ ${t('profile.memory.pullFromHome')}
              </button>
              <button class="poster-action poster-action--small" onClick=${() => doPush(m.key)} title=${t('profile.memory.pushToHome')}>
                ↑ ${t('profile.memory.pushToHome')}
              </button>
            `}
            <button class="poster-action poster-action--small poster-action--danger mem-delete-btn" onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn')}</button>
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
        <div class=${`pf-mem-quota-bar poster-box poster-box--meter poster-box--quota ${quotaPct >= 90 ? 'is-full' : ''}`}><svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true"><rect width=${quotaPct} height="100" /></svg></div>
      </div>
    `}
    <div class="mem-tools-section poster-row--thing">
      <span class="mem-tools-label poster-label">${t('profile.memory.toolsLabel') || 'Tools'}</span>
      <div class="mem-tools-actions">
        ${!fullLoaded && html`<button class="poster-action poster-action--small" onClick=${loadFullContents}>${t('profile.memory.loadContents') || 'Load all contents'}</button>`}
        <span class="mem-import-group">
          <button class="poster-action poster-action--small" onClick=${() => handleExport()}>${t('profile.memory.exportBtn') || 'Export'}</button>
          <button class="poster-action poster-action--small" disabled=${importing} onClick=${triggerImport}>${importing ? '…' : (t('profile.memory.importBtn') || 'Import')}</button>
          <select class="select-field mem-vis-select" value=${importMode} onChange=${e => setImportMode(e.target.value)} title=${t('profile.memory.importModeLabel') || 'Conflict handling'}>
            <option value="skip">${t('profile.memory.importMode.skip') || 'Skip existing'}</option>
            <option value="overwrite">${t('profile.memory.importMode.overwrite') || 'Overwrite'}</option>
            <option value="rename">${t('profile.memory.importMode.rename') || 'Import as new'}</option>
          </select>
          <input type="file" accept="application/json,.json" ref=${importFileRef} class="pf-hidden" onChange=${handleImportFile} />
        </span>
      </div>
    </div>
    <div class="action-bar">
      <div class="search-line">
        <input type="text" class="og-input" placeholder=${t('profile.memory.searchContents') || 'Search content or key…'}
          value=${searchInput} onInput=${e => setSearchInput(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Enter') runServerSearch(searchInput, searchScopePrefix); }} />
        <button class="poster-action poster-action--small" disabled=${searchLoading} onClick=${() => runServerSearch(searchInput, searchScopePrefix)}>${searchLoading ? '…' : (t('profile.memory.searchBtn') || 'Search')}</button>
        ${searchResults !== null && html`<button class="poster-icon poster-icon--small" onClick=${clearServerSearch}>✕</button>`}
      </div>
      <div class="search-line">
        <input type="text" class="og-input" placeholder=${t('profile.memory.filterType')}
          value=${filterText} onInput=${e => setFilterText(e.target.value)} />
        ${filterText && html`<button class="poster-icon poster-icon--small" onClick=${() => setFilterText('')}>✕</button>`}
      </div>
      <div class="search-bar">
        <button class="poster-tab poster-tab--fold ${!memArchived ? 'is-on' : ''}" aria-pressed=${!memArchived ? 'true' : 'false'} onClick=${() => setMemArchived(false)}>${t('profile.memory.viewActive') || 'Active'}</button>
        <button class="poster-tab poster-tab--fold ${memArchived ? 'is-on' : ''}" aria-pressed=${memArchived ? 'true' : 'false'} onClick=${() => setMemArchived(true)}>${'🗄️ '}${t('profile.memory.viewArchived') || 'Archived'}</button>
      </div>
    </div>
    <div class="action-bar mem-bottom-bar">
      <div class="mem-sort-bar">
        <label class="text-meta-sm">${t('profile.memory.sortLabel')}</label>
        <select class="select-field mem-sort-select" value=${sortBy} onChange=${e => setSortBy(e.target.value)}>
          <option value="updated">${t('profile.memory.sortUpdated')}</option>
          <option value="created">${t('profile.memory.sortCreated')}</option>
          <option value="alpha">${t('profile.memory.sortAlpha')}</option>
          <option value="size">${t('profile.memory.sortSize') || 'Largest first'}</option>
        </select>
      </div>
      <button class="poster-slab mem-new-btn" onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}</button>
    </div>
    <${TagCloud} tags=${tagsByFreq} selected=${memTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemTagFilter(new Set())} limit=${10} />
    ${showMemForm && html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} />`}
    ${selectedKeys.size > 0 && html`
      <div class="mem-bulkbar poster-row--thing">
        <span class="mem-bulkbar-count">${(t('profile.memory.bulkSelected') || '{n} selected').replace('{n}', String(selectedKeys.size))}</span>
        ${/* Sharing is not a visibility any more, so the bulk bar changes visibility only. Sharing
              many keys at once is one share over a pattern that covers them, which is the Access
              tab or the row's own share panel — not a per-record loop dressed up as a bulk edit. */''}
        <select class="select-field mem-vis-select" value=${bulkVis} onChange=${e => setBulkVis(e.target.value)}>
          ${VIS_OPTIONS.filter(v => v !== 'group').map(v => html`<option key=${v} value=${v}>${t('knowledge.visibility.' + v)}</option>`)}
        </select>
        <button class="poster-action poster-action--small" onClick=${applyBulkVis}>${t('profile.memory.bulkApply') || 'Change visibility'}</button>
        <button class="poster-action poster-action--small" onClick=${() => { addCartItems((memories || []).filter(m => selectedKeys.has(m.key)).map(memCartItem)); }}>🛒 ${t('profile.memory.cartAddSelected') || 'Add to collection'}</button>
        <button class="poster-action poster-action--small poster-action--danger" onClick=${bulkDelete}>${t('profile.memory.deleteBtn')}</button>
        <button class="poster-action poster-action--small" onClick=${() => setSelectedKeys(new Set())}>✕ ${t('profile.memory.bulkClear') || 'Clear selection'}</button>
      </div>
    `}
    ${searchResults !== null
      ? html`
          <div class="mem-search-summary">
            <span class="text-meta-sm">${(t('profile.memory.searchResultCount') || '{n} matches').replace('{n}', String(searchResults.length))}${searchScopePrefix ? ` · ${escHtml(searchScopePrefix)}` : ''}</span>
            <button class="poster-action poster-action--small" onClick=${clearServerSearch}>✕ ${t('profile.memory.searchClear') || 'Clear search'}</button>
          </div>
          ${searchResults.length === 0
            ? html`<div class="poster-quiet">${t('profile.memory.searchEmpty') || 'No matches'}</div>`
            : sortEntries(searchResults, sortBy).map(m => renderRow(m, groupOfKey(m.key)))}
        `
      : filtered.length === 0
        ? html`<div class="poster-quiet">${memories.length > 0 ? (t('tags.noMatch') || 'No items match selected tags') : t('profile.memory.empty')}</div>`
        : groupsOrdered.map(g => {
            const collapsed = !filtering && collapsedGroups.has(g.id);
            const groupPrefix = g.kind === 'organism' ? 'organism.' + g.uuid + '.' : g.kind === 'plain' ? g.id + '.' : null;
            return html`
              <div class="mem-group" key=${g.id}>
                <div class="og-fold mem-group-header" role="button" tabindex="0" aria-expanded=${collapsed ? 'false' : 'true'} onClick=${() => toggleGroupCollapsed(g.id)}>
                  <span class="og-fold-name">${escHtml(groupLabel(g))}</span>
                  <span class="og-fold-r">${g.items.length === 1 ? (t('profile.memory.keysOne') || '1 key') : (t('profile.memory.keysCount') || '{n} keys').replace('{n}', String(g.items.length))}${g.kind === 'organism' && orgNames[g.uuid] ? ` · ${shortTok(g.uuid)}` : ''}</span>
                  <span class="mem-group-actions">
                    ${groupPrefix && html`<button class="poster-icon poster-icon--small" title=${t('profile.memory.searchInGroup') || 'Search in this group'}
                      onClick=${(e) => { e.stopPropagation(); setSearchInput(''); setSearchScopePrefix(groupPrefix); showToast((t('profile.memory.searchInGroupHint') || 'Type a query to search within {g}').replace('{g}', groupLabel(g))); }}>🔍</button>`}
                    ${groupPrefix && html`<button class="poster-icon poster-icon--small" title=${t('profile.memory.deleteGroup') || 'Delete group'}
                      onClick=${(e) => { e.stopPropagation(); deleteGroup(g, g.items.length); }}>🗑️</button>`}
                  </span>
                  <span class="og-fold-arrow">${collapsed ? '→' : '↓'}</span>
                </div>
                ${!collapsed && g.items.map(m => renderRow(m, g))}
              </div>
            `;
          })
    }`;
}
