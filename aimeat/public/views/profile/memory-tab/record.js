/**
 * @file public/views/profile/memory-tab/record.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One memory record as a page: the key, when it was made and changed, its value read
 *   as prose, as label/value rows or as raw JSON, and beside it the visibility, the tags, the shares
 *   that reach it and what can be done to it. Composed from the shared component set.
 * @structure renderValue · renderRecord
 * @usage import { renderRecord } from './record.js';
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- The key is the page title in mono (so the identity line no longer repeats
 *     it), typed line breaks are kept by Text lines, raw and JSON values sit in the tall code box,
 *     Delete is in the danger tone.
 *   v1.0.0 -- 2026-09-22 -- Extracted from cover.js when the Memory page moved onto the shared
 *     component set; same content and handlers.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { detectImage, ImageView } from '/components/ImageDeliverable.js';
import TagEditor from '/js/components/tag-editor.js';
import { Rail, ListRow, KeyValue, Chip, Action, CopyAction, Surface, Text, Stack } from '/components/poster-parts.js';
import { formatBytes, formatRelativeTime, groupOfKey, displayRemainder, VIS_OPTIONS } from './helpers.js';
import { c, day, agentOf, classify, visChip, renderPage } from './frame.js';

const looksLikeMarkdown = (s) => /(^|\n)#{1,6}\s|(^|\n)[-*]\s|\*\*|\[[^\]]+\]\(/.test(s);
const lines = (s) => html`<${Text} lines>${String(s)}<//>`;

function renderValue(ctx, m, raw) {
  const v = ctx.valueOf(m);
  if (v === undefined) return html`<${Text} tone="muted">${t('profile.memory.loadingValue') || 'Loading value…'}<//>`;
  const im = detectImage(v, m.key);
  const image = im ? html`<${ImageView} desc=${im} />` : null;
  if (raw) return html`<${Surface} kind="code" height="tall">${typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? '')}<//>`;
  if (typeof v === 'string') return html`${image}${looksLikeMarkdown(v) ? html`<${Markdown} text=${v} />` : lines(v)}`;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const rows = Object.entries(v);
    const flat = rows.every(([, x]) => x === null || typeof x !== 'object');
    if (flat && rows.length) return html`${image}<div>${rows.map(([k, x]) => html`<${KeyValue} key=${k} label=${k} value=${String(x ?? '')} />`)}</div>`;
  }
  return html`${image}<${Surface} kind="code" height="tall">${JSON.stringify(v, null, 2)}<//>`;
}

export function renderRecord(ctx, key) {
  const { memories, orgNames, showRaw, setShowRaw, valueCopyText, valueOf, setEditModal, handleQuickVis, editingMemTags, setEditingMemTags, handleUpdateMemoryTags, sharesCovering, revokeCoveringShare, openSharePanel, inCart, memCartItem, toggleCartItem, fedConsents, handleShareToFederation, handleStopSharing, togglingFed, session, doPull, doPush, handleDeleteMemory, showToast, NODE_URL, pickView } = ctx;
  const m = (memories || []).find(x => x.key === key) || (ctx.searchResults || []).find(x => x.key === key);
  const g = groupOfKey(key);
  const cls = classify(memories, orgNames);
  const space = cls.spaces.get(g.id);
  const crumbs = [{ label: space ? space.label : g.id, go: () => pickView({ kind: 'space', id: g.id }) }, { label: displayRemainder(key, g) }];
  if (!m) return renderPage(ctx, { id: 'record', crumbs, title: key, titleKind: 'mono', children: html`<${Text} tone="muted">${t('profile.memory.empty') || 'Not found.'}<//>` });
  const v = valueOf(m);
  const owner = m.owner_gaii || ctx.currentGhii();
  const url = `${NODE_URL}/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`;
  const covering = sharesCovering(key);
  const cartItem = memCartItem(m);
  const doors = html`
    ${v !== undefined ? html`<${CopyAction} text=${valueCopyText(m)} label=${t('profile.memory.copyValue') || 'Copy value'} onCopied=${() => showToast(t('profile.memory.valueCopied') || 'Value copied')} />` : null}
    <${CopyAction} text=${url} label=${t('common.copyUrl') || 'Copy URL'} onCopied=${() => showToast(t('profile.files.urlCopied') || 'URL copied')} />
    <${Action} onClick=${() => setEditModal({ key, value: typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''), visibility: m.visibility || 'private', version: m.version, isJson: typeof v === 'object' && v !== null })}>${t('profile.memory.editBtn') || 'Edit'}<//>`;
  // The key is a machine value, so the page title is set in mono exactly as written.
  const sub = html`<${Stack} direction="wrap" align="center" density="compact">
    ${m.created_at ? html`<${Text} kind="mono" tone="muted">${c('created', 'created')} ${day(m.created_at)}<//>` : null}
    ${m.updated_at ? html`<${Text} kind="mono" tone="muted">${c('changed', 'changed')} ${formatRelativeTime(m.updated_at)}${agentOf(m.owner_gaii) ? ' · ' + agentOf(m.owner_gaii) : ''}<//>` : null}
    ${m.version != null ? html`<${Text} kind="mono" tone="muted">${c('version', 'version {n}').replace('{n}', String(m.version))}<//>` : null}
    ${typeof m.bytes === 'number' ? html`<${Text} kind="mono" tone="muted">${formatBytes(m.bytes)}<//>` : null}
    ${visChip(m.visibility)}
  <//>`;
  const rail = html`<${Stack}>
    <${Stack} density="compact">
      <${Text} kind="label">${c('visibility', 'Visibility')}<//>
      <${Stack} direction="wrap" density="compact">${VIS_OPTIONS.filter(x => x !== 'group').map(x => html`
        <${Action} key=${x} kind="tab" semantics="radio" selected=${(m.visibility || 'private') === x} onClick=${() => handleQuickVis(m, x)}>${t('knowledge.visibility.' + x) || x}<//>`)}<//>
      <${Text} kind="caption" tone="muted">${c('visHint', 'Public: anyone with the address reads it. Sharing with a group is done per key space, not per key.')}<//>
    <//>
    <${Stack} density="compact">
      <${Text} kind="label">${c('tags', 'Tags')}<//>
      ${editingMemTags === key ? html`<${TagEditor} tags=${m.tags || []} onSave=${(tags) => { handleUpdateMemoryTags(key, tags, m.version); setEditingMemTags(null); }} />`
        : html`<${Stack} direction="wrap" align="center" density="compact">${(m.tags || []).map(tag => html`<${Chip} tone="muted" key=${tag}>${tag}<//>`)}
          <${Action} onClick=${() => setEditingMemTags(key)}>${t('tags.editTags') || 'Edit tags'}<//><//>`}
    <//>
    ${covering.length ? html`<${Stack} density="compact"><${Text} kind="label">${c('share', 'key-space share')}<//>${covering.map(sh => html`
      <${ListRow} key=${sh.id} density="compact" name=${sh.key_pattern} detail=${'→ ' + (sh.group?.name || sh.group_id)}
        actions=${html`<${Action} onClick=${() => revokeCoveringShare(sh)}>${t('profile.memory.shRevoke') || 'Stop sharing'}<//>`} />`)}<//>` : null}
    <${Rail} kind="index" title=${c('thisRecord', 'This record')}><${Stack} density="compact">
      <${Action} kind="text" onClick=${() => pickView({ kind: 'space', id: g.id })}>↩ ${space ? space.label : g.id}<//>
      <${Action} kind="text" onClick=${() => toggleCartItem(cartItem)}>${inCart(cartItem) ? (t('profile.memory.cartRemove') || 'Remove from collection') + ' ✓' : c('toCart', 'To the collection') + ' +'}<//>
      <${Action} kind="text" onClick=${() => { openSharePanel(key); pickView({ kind: 'space', id: g.id }); }}>${c('shareGroup', 'Share with a group')} →<//>
      ${fedConsents[key]
        ? html`<${Action} kind="text" disabled=${togglingFed === key} onClick=${() => handleStopSharing(key)}>${t('profile.memory.stopSharing') || 'Stop federation sharing'} →<//>`
        : html`<${Action} kind="text" disabled=${togglingFed === key} onClick=${() => handleShareToFederation(key)}>${c('federate', 'Share to the federation')} →<//>`}
      ${session?.federated ? html`<${Action} kind="text" onClick=${() => doPull(key)}>${t('profile.memory.pullFromHome')}<//><${Action} kind="text" onClick=${() => doPush(key)}>${t('profile.memory.pushToHome')}<//>` : null}
      <${Action} kind="text" tone="danger" onClick=${() => handleDeleteMemory(key)}>${t('profile.memory.deleteBtn') || 'Delete'} …<//>
    <//><//>
  <//>`;
  return renderPage(ctx, { id: 'record', crumbs, title: key, titleKind: 'mono', sub, doors, rail, children: html`
    ${renderValue(ctx, m, showRaw)}
    ${v !== undefined ? html`<${Stack} direction="wrap"><${Action} onClick=${() => setShowRaw(r => !r)}>${showRaw ? c('showPretty', 'Show readable') : c('showRaw', 'Show raw')}<//><//>` : null}` });
}
