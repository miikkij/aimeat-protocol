/**
 * @file public/views/profile/memory-tab/entries-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Renderer for the Memory tab "entries" sub-tab — quota bar, data tools (load/export/
 *   import), content search + filters, sort, bulk bar, tag cloud, and the collapsible grouped list
 *   of memory rows with per-row visibility/rules/cart/federation controls. Extracted verbatim from
 *   memory-tab.js as a ctx-consuming plain render function (all state/handlers passed in via ctx).
 *   Every part is a component of the kit that gets data; the file writes no class.
 * @version-history
 *   v2.0.2 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a key, a share pattern or an organism group name with an ampersand or a quote showed
 *     as &amp; / &quot;.
 *   v2.0.1 -- 2026-09-26 -- The search line, the filter line and Active/Archived stand side by side
 *     again, as on main (SearchLine beside in a Row; fix pass).
 *   v2.0.0 -- 2026-09-26 -- On the component kit, class-free (page group G3): the storage bar is the
 *     quota Meter under its meta line; the tools and the bulk bar are sections (Card tone="section")
 *     with the row label, actions and Selects; the two search lines are SearchLine (Enter searches,
 *     ✕ clears); Active and Archived are Tabs in the fold tone; a key group's head is the FoldRow
 *     (→/↓, its count and id at the right, its search and delete beside it on hover or focus, as
 *     main showed them); the keys are the List (cut check-name-size-when-mark-doors): the pick box,
 *     the key (a button that opens the row: Enter works now), size, time, the visibility tag, the
 *     shared tag, the rules shield, the federation tag and the collection mark; the visibility
 *     picker stands under the row, the opened record in the row's raised panel (its value the Code
 *     block, its shares a dense List, its share and rules boxes the attention note, Delete kept at
 *     the far right). Loading is the loading line (the words main's Spinner said).
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
import { recipientBadge, VisibilityPill } from '../shared.js';
import { detectImage, ImageView } from '/components/ImageDeliverable.js';
import TagCloud from '/js/components/tag-cloud.js';
import TagEditor from '/js/components/tag-editor.js';
import { Action, Loud, Icon, Actions } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Meter, Tinted } from '/components/Figure.js';
import { Card } from '/components/Card.js';
import { List, Row, Name, Desc, Num, When, Cell, Doors, SearchLine } from '/components/List.js';
import { Row as Line, Stack } from '/components/Layout.js';
import { FoldRow } from '/components/Folds.js';
import { Tabs } from '/components/Tabs.js';
import { SubHeading } from '/components/SubHeading.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { FileDrop } from '/components/FileDrop.js';
import { openTab } from '/components/Rail.js';
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

/** The visibilities a person picks from, as Select options (the menus that share leave "group" out). */
const visWords = (list) => list.map(v => [v, t('knowledge.visibility.' + v)]);

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

  if (!memories) return html`<${Note} kind="loading">${t('profile.memory.loading')}<//>`;

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
  const visLabel = t('profile.memory.visLabel');
  const rulesWord = t('permissions.sharingRules');

  // Every share that reaches this key, each with the way to end it. A share is a rule over a
  // PATTERN, so the button says what it revokes: pressing it takes the whole pattern back, not this
  // one record.
  const sharesOf = (m) => {
    const covering = sharesCovering ? sharesCovering(m.key) : [];
    return covering.length > 0 && html`
      <${List} cols="name-doors" dense>
        ${covering.map(sh => html`
          <${Row} key=${sh.id}>
            <${Cell} dim>${sh.group?.name || sh.group_id} · <${Code}>${sh.key_pattern}<//><//>
            <${Doors}>
              <${Action} small onClick=${() => revokeCoveringShare(sh)}
                title=${(t('profile.memory.shRevokeTitle') || 'Stop sharing {pattern}').replace('{pattern}', sh.key_pattern)}>
                ${t('profile.memory.shRevoke') || 'Stop sharing'}
              <//>
            <//>
          <//>`)}
      <//>`;
  };

  // Share this key's space with a group: no groups yet → the way to make one on the Access tab.
  const sharePanel = () => html`
    <${Note} kind="aside" size="small">
      ${groups.length === 0 ? html`
        <${Stack}>
          <${Note} kind="meta">${t('profile.memory.shNoGroups')}<//>
          <${Actions}>
            <${Action} small onClick=${() => {
              try { sessionStorage.setItem('aimeat.access.focus', 'groups'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
              openTab('access');
            }}>${t('profile.memory.createGroupBtn')}<//>
          <//>
        <//>
      ` : html`
        <${Fields}>
          <${TextField} label=${t('profile.access.shPattern')} hint=${t('profile.access.shPatternHelp')}
            value=${sharePattern} onInput=${setSharePattern} />
          <${Select} label=${t('profile.memory.shPickGroup')} value=${shareGroupId} onChange=${setShareGroupId}
            options=${groups.map(g => [g.id, g.name])} />
          <${FormActions}>
            <${Loud} control onClick=${submitShare}>${t('profile.access.shCreate')}<//>
            <${Action} small onClick=${() => setSharePanelFor(null)}>${t('profile.access.shCancel')}<//>
          <//>
        <//>
      `}
    <//>`;

  // The rules that let others read this key, and the visibility it has for everyone else.
  const rulesBox = () => html`
    <${Note} kind="aside" size="small">
      <${Stack}>
        <${Line} justify="between">
          <${SubHeading} inline>\u{1F6E1}️ ${rulesWord}<//>
          <${Icon} small label=${t('common.close')} onClick=${() => setKeyRulesPopover(null)}>✕<//>
        <//>
        <${Note} kind="meta">${visLabel} ${t('knowledge.visibility.' + keyRulesPopover.visibility) || keyRulesPopover.visibility}<//>
        ${keyRulesPopover.rules.length === 0
          ? html`<${Note} kind="quiet">${t('permissions.noRules')}<//>`
          : html`<${List} cols="name-desc-doors">${keyRulesPopover.rules.map(r => html`
              <${Row}>
                <${Name}>${recipientBadge(r.recipient)}<//>
                <${Desc}><${Code}>${r.data_pattern}<//><//>
                <${Cell} dim>${r.scope || '-'}<//>
              <//>`)}<//>`}
      <//>
    <//>`;

  // An opened record: its whole key, its value, its visibility, and what can be done with it.
  const detail = (m) => {
    const v = valueOf(m);
    return html`
      <${Stack}>
        <${Note} kind="meta" title=${m.key}><${Code}>${m.key}<//><//>
        ${(!fullLoaded && v === undefined)
          // Always "loading", never a bare ellipsis: the open row fetches its own value (see the
          // effect in memory-tab.js), so a missing value is a read in flight and not a state a
          // person is supposed to interpret. It used to render "…" for good when a background
          // refresh replaced the list with a values-free one under an already-open row.
          ? html`<${Note} kind="loading">${t('profile.memory.loadingValue') || 'Loading value…'}<//>`
          : html`
            ${(() => { const im = detectImage(v, m.key); return im ? html`<${ImageView} desc=${im} />` : null; })()}
            <${Code} block>${typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? '')}<//>
          `}
        <${Line}>
          <${Note} kind="meta" inline>${visLabel}<//>
          <${Select} fit ariaLabel=${visLabel} value=${m.visibility || 'private'} options=${visWords(VIS_OPTIONS)}
            onChange=${(next) => handleQuickVis(m, next)} />
        <//>
        <${Actions}>
          <${Action} small expanded=${editingMemTags === m.key} onClick=${() => setEditingMemTags(editingMemTags === m.key ? null : m.key)}>
            ${t('tags.editTags') || 'Edit tags'}
          <//>
          <${Action} small expanded=${keyRulesPopover?.key === m.key} onClick=${() => { if (keyRulesPopover?.key === m.key) setKeyRulesPopover(null); else loadKeyPerms(m.key); }}>
            \u{1F6E1}️ ${rulesWord}
          <//>
          <${Action} small expanded=${sharePanelFor === m.key} onClick=${() => { if (sharePanelFor === m.key) setSharePanelFor(null); else openSharePanel(m.key); }}>
            ${t('profile.memory.shShareThis')}
          <//>
        <//>
        ${sharesOf(m)}
        ${sharePanelFor === m.key ? sharePanel() : null}
        ${editingMemTags === m.key
          ? html`<${TagEditor} tags=${m.tags || []} onSave=${(tags) => handleUpdateMemoryTags(m.key, tags, m.version)} />`
          : m.tags?.length > 0 ? html`<${Note} kind="meta">${m.tags.join(', ')}<//>` : null}
        ${keyRulesPopover && keyRulesPopover.key === m.key ? rulesBox() : null}
        <${Line} justify="between" wrap above="small">
          <${Actions}>
            <${Action} small onClick=${() => setEditModal({ key: m.key, value: typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''), visibility: m.visibility || 'private', version: m.version, isJson: typeof v === 'object' && v !== null })}>${t('profile.memory.editBtn')}<//>
            ${v !== undefined ? html`<${Action} small copy=${valueCopyText(m)}
              onCopied=${() => showToast(t('profile.memory.valueCopied') || 'Value copied')}>${'\u{1F4CB} ' + (t('profile.memory.copyValue') || 'Copy value')}<//>` : null}
            ${fedConsents[m.key]
              ? html`<${Action} small disabled=${togglingFed === m.key} onClick=${() => handleStopSharing(m.key)}>
                  ${togglingFed === m.key ? '...' : t('profile.memory.stopSharing')}
                <//>`
              : html`<${Action} small disabled=${togglingFed === m.key} onClick=${() => handleShareToFederation(m.key)}>
                  ${togglingFed === m.key ? '...' : t('profile.memory.shareToFederation')}
                <//>`}
            ${session.federated ? html`
              <${Action} small onClick=${() => doPull(m.key)} title=${t('profile.memory.pullFromHome')}>↓ ${t('profile.memory.pullFromHome')}<//>
              <${Action} small onClick=${() => doPush(m.key)} title=${t('profile.memory.pushToHome')}>↑ ${t('profile.memory.pushToHome')}<//>
            ` : null}
          <//>
          <${Action} small tone="danger" onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn')}<//>
        <//>
      <//>`;
  };

  // One key: a row that opens in place, picked by its own box. Its marks and its collection mark
  // are controls of their own, so a press on them does not open the row.
  const renderRow = (m, g) => {
    const open = expandedMem === m.key;
    const carried = inCart(memCartItem(m));
    // A key covered by a share reads as private in the tag, because it IS private — the share is
    // the exception on top. Saying so on the row is the only way the owner can see, while
    // scanning, which of their records somebody else can also read.
    const via = sharedWith(m.key);
    return html`
      <${Row} key=${m.key} open=${open}
        onToggle=${() => { const opening = expandedMem !== m.key; setExpandedMem(opening ? m.key : null); if (opening) ensureValue(m.key); }}
        picked=${selectedKeys.has(m.key)} onPick=${() => toggleSelected(m.key)} pickLabel=${m.key}
        below=${visPopoverFor === m.key ? html`
          <${Tabs} label=${visLabel} value=${m.visibility || 'private'} onSelect=${(next) => applyVis(m, next)}
            items=${VIS_OPTIONS.filter(x => x !== 'group').map(x => ({ value: x, label: t('knowledge.visibility.' + x) }))} />` : null}
        panel=${open ? detail(m) : null}>
        <${Name} asKey title=${m.key}>${displayRemainder(m.key, g)}<//>
        ${typeof m.bytes === 'number'
          ? html`<${Num} dim title=${t('profile.memory.sizeLabel') || 'Value size'}>${formatBytes(m.bytes)}<//>`
          : html`<${Cell} />`}
        <${When} title=${`${m.created_at ? fmtDateTime(m.created_at) : ''} / ${m.updated_at ? fmtDateTime(m.updated_at) : ''}`}>
          ${formatRelativeTime(m.updated_at || m.created_at)}
        <//>
        <${Cell} line>
          <${VisibilityPill} visibility=${m.visibility || 'private'}
            onClick=${(e) => { e.stopPropagation(); setVisPopoverFor(visPopoverFor === m.key ? null : m.key); }} />
          ${via.length > 0 ? html`
            <${Mark} title=${t('profile.memory.shSharedWith').replace('{names}', via.map(x => x.name).join(', '))}>
              ${t('profile.memory.shSharedBadge')} · ${via.length}
            <//>` : null}
          ${keyHasRules(m.key) ? html`<${Icon} small label=${rulesWord} onClick=${(e) => { e.stopPropagation(); loadKeyPerms(m.key); }}>\u{1F6E1}️<//>` : null}
          ${fedConsents[m.key] ? html`<${Mark}>${t('profile.memory.syncedToFederation')}<//>` : null}
        <//>
        <${Doors}>
          <${Icon} small pressed=${carried}
            label=${carried ? (t('profile.memory.cartRemove') || 'Remove from collection') : (t('profile.memory.cartAdd') || 'Add to collection')}
            onClick=${(e) => { e.stopPropagation(); toggleCartItem(memCartItem(m)); }}>🛒<//>
        <//>
      <//>`;
  };

  const quotaPct = memQuota && memQuota.max_bytes ? Math.min(100, Math.round((memQuota.used_bytes / memQuota.max_bytes) * 100)) : 0;
  const sortLabel = t('profile.memory.sortLabel');

  return html`
    ${memQuota ? html`
      <${Stack} gap="tight" below="medium">
        <${Note} kind="meta">${t('profile.memory.storageUsed') || 'Storage'}: ${memQuota.used_keys}/${memQuota.max_keys} ${t('profile.memory.keysWord') || 'keys'} · ${formatBytes(memQuota.used_bytes)} / ${formatBytes(memQuota.max_bytes)}<//>
        <${Meter} quota pct=${quotaPct} />
      <//>
    ` : null}
    <${Card} tone="section">
      <${Line} wrap gap="medium">
        <${Label}>${t('profile.memory.toolsLabel') || 'Tools'}<//>
        <${Line} wrap>
          ${!fullLoaded ? html`<${Action} small onClick=${loadFullContents}>${t('profile.memory.loadContents') || 'Load all contents'}<//>` : null}
          <${Line} gap="tight">
            <${Action} small onClick=${() => handleExport()}>${t('profile.memory.exportBtn') || 'Export'}<//>
            <${Action} small disabled=${importing} onClick=${triggerImport}>${importing ? '…' : (t('profile.memory.importBtn') || 'Import')}<//>
            <${Select} fit value=${importMode} onChange=${setImportMode} title=${t('profile.memory.importModeLabel') || 'Conflict handling'}
              options=${[
                ['skip', t('profile.memory.importMode.skip') || 'Skip existing'],
                ['overwrite', t('profile.memory.importMode.overwrite') || 'Overwrite'],
                ['rename', t('profile.memory.importMode.rename') || 'Import as new'],
              ]} />
            <${FileDrop} hidden accept="application/json,.json" inputRef=${importFileRef} onChange=${handleImportFile} />
          <//>
        <//>
      <//>
    <//>
    <${Line} justify="between" wrap gap="medium" below="large">
      <${SearchLine} beside text value=${searchInput} placeholder=${t('profile.memory.searchContents') || 'Search content or key…'}
        onInput=${e => setSearchInput(e.target.value)} onEnter=${() => runServerSearch(searchInput, searchScopePrefix)}>
        <${Action} small disabled=${searchLoading} onClick=${() => runServerSearch(searchInput, searchScopePrefix)}>${searchLoading ? '…' : (t('profile.memory.searchBtn') || 'Search')}<//>
        ${searchResults !== null ? html`<${Icon} small label=${t('profile.memory.searchClear') || 'Clear search'} onClick=${clearServerSearch}>✕<//>` : null}
      <//>
      <${SearchLine} beside text value=${filterText} placeholder=${t('profile.memory.filterType')}
        onInput=${e => setFilterText(e.target.value)} onClear=${() => setFilterText('')} />
      <${Tabs} tone="fold" kind="view" value=${memArchived ? 'archived' : 'active'} onSelect=${(v) => setMemArchived(v === 'archived')}
        items=${[
          { value: 'active', label: t('profile.memory.viewActive') || 'Active' },
          { value: 'archived', label: '🗄️ ' + (t('profile.memory.viewArchived') || 'Archived') },
        ]} />
    <//>
    <${Line} justify="between" wrap gap="medium" below="large">
      <${Line} gap="tight">
        <${Note} kind="meta" inline>${sortLabel}<//>
        <${Select} fit ariaLabel=${sortLabel} value=${sortBy} onChange=${setSortBy}
          options=${[
            ['updated', t('profile.memory.sortUpdated')],
            ['created', t('profile.memory.sortCreated')],
            ['alpha', t('profile.memory.sortAlpha')],
            ['size', t('profile.memory.sortSize') || 'Largest first'],
          ]} />
      <//>
      <${Loud} onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}<//>
    <//>
    <${TagCloud} tags=${tagsByFreq} selected=${memTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemTagFilter(new Set())} limit=${10} />
    ${showMemForm ? html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} />` : null}
    ${selectedKeys.size > 0 ? html`
      <${Card} tone="section">
        <${Line} wrap>
          <${Tinted} strong>${(t('profile.memory.bulkSelected') || '{n} selected').replace('{n}', String(selectedKeys.size))}<//>
          ${/* Sharing is not a visibility any more, so the bulk bar changes visibility only. Sharing
                many keys at once is one share over a pattern that covers them, which is the Access
                tab or the row's own share panel — not a per-record loop dressed up as a bulk edit. */''}
          <${Select} fit ariaLabel=${visLabel} value=${bulkVis} onChange=${setBulkVis} options=${visWords(VIS_OPTIONS.filter(v => v !== 'group'))} />
          <${Action} small onClick=${applyBulkVis}>${t('profile.memory.bulkApply') || 'Change visibility'}<//>
          <${Action} small onClick=${() => { addCartItems((memories || []).filter(m => selectedKeys.has(m.key)).map(memCartItem)); }}>🛒 ${t('profile.memory.cartAddSelected') || 'Add to collection'}<//>
          <${Action} small tone="danger" onClick=${bulkDelete}>${t('profile.memory.deleteBtn')}<//>
          <${Action} small onClick=${() => setSelectedKeys(new Set())}>✕ ${t('profile.memory.bulkClear') || 'Clear selection'}<//>
        <//>
      <//>
    ` : null}
    ${searchResults !== null
      ? html`
          <${Line} justify="between" below="small">
            <${Note} kind="meta" inline>${(t('profile.memory.searchResultCount') || '{n} matches').replace('{n}', String(searchResults.length))}${searchScopePrefix ? ` · ${searchScopePrefix}` : ''}<//>
            <${Action} small onClick=${clearServerSearch}>✕ ${t('profile.memory.searchClear') || 'Clear search'}<//>
          <//>
          <${List} cols="check-name-size-when-mark-doors" keepCols empty=${t('profile.memory.searchEmpty') || 'No matches'}>
            ${sortEntries(searchResults, sortBy).map(m => renderRow(m, groupOfKey(m.key)))}
          <//>
        `
      : filtered.length === 0
        ? html`<${Note} kind="quiet">${memories.length > 0 ? (t('tags.noMatch') || 'No items match selected tags') : t('profile.memory.empty')}<//>`
        : groupsOrdered.map(g => {
            const collapsed = !filtering && collapsedGroups.has(g.id);
            const groupPrefix = g.kind === 'organism' ? 'organism.' + g.uuid + '.' : g.kind === 'plain' ? g.id + '.' : null;
            return html`
              <${Stack} key=${g.id} gap="none" below="tight">
                <${FoldRow} name=${groupLabel(g)} open=${!collapsed} onClick=${() => toggleGroupCollapsed(g.id)}
                  right=${`${g.items.length === 1 ? (t('profile.memory.keysOne') || '1 key') : (t('profile.memory.keysCount') || '{n} keys').replace('{n}', String(g.items.length))}${g.kind === 'organism' && orgNames[g.uuid] ? ` · ${shortTok(g.uuid)}` : ''}`}
                  doors=${groupPrefix ? html`
                    <${Icon} small label=${t('profile.memory.searchInGroup') || 'Search in this group'}
                      onClick=${() => { setSearchInput(''); setSearchScopePrefix(groupPrefix); showToast((t('profile.memory.searchInGroupHint') || 'Type a query to search within {g}').replace('{g}', groupLabel(g))); }}>🔍<//>
                    <${Icon} small label=${t('profile.memory.deleteGroup') || 'Delete group'}
                      onClick=${() => deleteGroup(g, g.items.length)}>🗑️<//>` : null} />
                ${!collapsed ? html`<${List} cols="check-name-size-when-mark-doors" keepCols under>${g.items.map(m => renderRow(m, g))}<//>` : null}
              <//>
            `;
          })
    }`;
}
