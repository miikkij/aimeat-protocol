/**
 * @file public/views/profile/memory-tab/browse-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cross-node / public-discovery browse panel for the Memory tab and its handlers —
 *   browse the home node or a remote peer's shared memory, pull entries (single/all), and discover
 *   public memories to copy. Extracted verbatim from memory-tab.js; handlers and the render function
 *   take the shared ctx so all state/handlers still live in the MemoryTab component.
 * @version-history
 *   2026-09-22 -- The panel is composed from the shared component set (Field, ListRow, Chip, Action,
 *     Surface, Text); the loaders and handlers are unchanged.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.0.0 — 2026-07-13 — Extracted from public/views/profile/memory-tab.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as memoryService from '/js/services/memory.js';
import { listPeers } from '/js/services/federation.js';
import { ListRow, Chip, Action, Field, Surface, Text, Stack } from '/components/poster-parts.js';
import { formatRelativeTime } from './helpers.js';
import { DiscoverPreview } from './components.js';
import { swallowed } from '/js/swallowed.js';

function browseErrorMessage(e) {
  const code = e.code || '';
  const msg = e.message || '';
  if (code === 'FEDERATION_PROXY_ERROR' || msg.includes('Localhost not allowed') || msg.includes('ocalhost'))
    return t('profile.memory.errorLocalhost');
  if (code === 'PEER_NOT_FOUND' || msg.includes('not found'))
    return t('profile.memory.errorPeerNotFound');
  if (code === 'ROUTE_NOT_FOUND' || e.status === 404)
    return t('profile.memory.errorPeerUnsupported');
  return msg;
}

export async function loadBrowseHome(ctx) {
  ctx.setBrowseMode('home');
  ctx.setBrowseLoading(true);
  ctx.setBrowseError(null);
  ctx.setRemoteEntries(null);
  try {
    const entries = await memoryService.listHomeMemories();
    ctx.setRemoteEntries(entries);
  } catch (e) {
    ctx.setBrowseError(browseErrorMessage(e));
    ctx.setRemoteEntries([]);
  } finally { ctx.setBrowseLoading(false); }
}

export async function loadBrowseRemote(ctx, peerNodeId) {
  if (!peerNodeId) return;
  ctx.setSelectedPeer(peerNodeId);
  ctx.setBrowseMode('remote');
  ctx.setBrowseLoading(true);
  ctx.setBrowseError(null);
  ctx.setRemoteEntries(null);
  try {
    const entries = await memoryService.listRemoteMemories(peerNodeId);
    ctx.setRemoteEntries(entries);
  } catch (e) {
    ctx.setBrowseError(browseErrorMessage(e));
    ctx.setRemoteEntries([]);
  } finally { ctx.setBrowseLoading(false); }
}

export async function initBrowseRemote(ctx) {
  ctx.setBrowseMode('remote');
  ctx.setRemoteEntries(null);
  ctx.setSelectedPeer('');
  try {
    const peers = await listPeers();
    ctx.setRemotePeers(Array.isArray(peers) ? peers.filter(p => p.status === 'active' || p.status === 'healthy') : []);
  } catch (err) { swallowed('browse-view', err); ctx.setRemotePeers([]); }
}

export async function handlePullRemoteEntry(ctx, key, peerNodeId) {
  const nodeId = peerNodeId || ctx.selectedPeer;
  ctx.setPullingKeys(prev => new Set([...prev, key]));
  try {
    if (ctx.session?.federated) {
      await memoryService.pullFromHome(key);
    } else {
      await memoryService.pullFromRemote(nodeId, key);
    }
    ctx.showToast(t('profile.memory.pullSuccess'));
    ctx.loadMemories();
  } catch (e) {
    ctx.showToast(e.message, true);
  } finally {
    ctx.setPullingKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
  }
}

export async function handlePullAll(ctx) {
  if (!ctx.remoteEntries?.length) return;
  const node = ctx.session?.federated ? (ctx.session.homeNode || 'home') : ctx.selectedPeer;
  const msg = t('profile.memory.pullAllConfirm').replace('{count}', ctx.remoteEntries.length).replace('{node}', node);
  ctx.confirm(msg, async () => {
    let pulled = 0;
    for (const entry of ctx.remoteEntries) {
      try {
        if (ctx.session?.federated) {
          await memoryService.pullFromHome(entry.key);
        } else {
          await memoryService.pullFromRemote(ctx.selectedPeer, entry.key);
        }
        pulled++;
      } catch (err) { swallowed('browse-view: handlePullAll', err); }
    }
    ctx.showToast(t('profile.memory.pullAllSuccess').replace('{count}', pulled));
    ctx.loadMemories();
  });
}

export async function loadDiscoverEntries(ctx, query) {
  ctx.setDiscoverLoading(true);
  ctx.setDiscoverError(null);
  ctx.setDiscoverEntries(null);
  ctx.setExpandedDiscover(null);
  try {
    const result = await memoryService.discoverPublicMemories({ q: query || undefined, limit: 100 });
    ctx.setDiscoverEntries(result.items || []);
  } catch (e) {
    ctx.setDiscoverError(e.message || t('profile.error'));
    ctx.setDiscoverEntries([]);
  } finally { ctx.setDiscoverLoading(false); }
}

export function initDiscover(ctx) {
  ctx.setBrowseMode('discover');
  loadDiscoverEntries(ctx, '');
}

export async function handleCopyEntry(ctx, ownerGaii, key) {
  ctx.setCopyingKeys(prev => new Set([...prev, key]));
  try {
    const resp = await memoryService.copyPublicMemory(ownerGaii, key, 'private');
    if (resp.ok === false) { ctx.showToast(resp.error?.message || t('profile.error'), true); return; }
    ctx.showToast(t('profile.memory.discoverCopied'));
    ctx.loadMemories();
  } catch (e) {
    ctx.showToast(e.message || t('profile.error'), true);
  } finally {
    ctx.setCopyingKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
  }
}

export function closeBrowse(ctx) {
  ctx.setBrowseMode(null);
  ctx.setRemoteEntries(null);
  ctx.setSelectedPeer('');
  ctx.setDiscoverEntries(null);
  ctx.setDiscoverSearch('');
  ctx.setExpandedDiscover(null);
}

const warning = (message) => html`<${Surface} kind="aside" density="compact" tone="danger"><${Text}>${message}<//><//>`;

export function renderBrowsePanel(ctx) {
  const {
    browseMode, discoverSearch, setDiscoverSearch, discoverLoading, discoverError, discoverEntries,
    expandedDiscover, setExpandedDiscover, copyingKeys, selectedPeer, remotePeers, browseLoading,
    browseError, remoteEntries, pullingKeys,
  } = ctx;

  if (!browseMode) return null;

  if (browseMode === 'discover') {
    return html`<${Stack}>
      <${Text} tone="muted">${t('profile.memory.discoverDesc')}<//>
      <${Stack} direction="wrap" align="end">
        <${Field} type="search" placeholder=${t('profile.memory.discoverSearchPlaceholder')} value=${discoverSearch}
          onInput=${e => setDiscoverSearch(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && loadDiscoverEntries(ctx, discoverSearch)} />
        <${Action} onClick=${() => loadDiscoverEntries(ctx, discoverSearch)}>${t('profile.memory.searchBtn')}<//>
      <//>
      ${discoverLoading && html`<${Text} tone="muted">${t('profile.memory.discoverLoading')}<//>`}
      ${discoverError && !discoverLoading && warning(discoverError)}
      ${discoverEntries && !discoverLoading && !discoverError && html`
        <${Text} kind="caption" tone="muted">${t('profile.memory.discoverCount').replace('{count}', discoverEntries.length)}<//>
        ${discoverEntries.length === 0
          ? html`<${Text} tone="muted">${t('profile.memory.discoverEmpty')}<//>`
          : html`<${Stack} density="compact">${discoverEntries.map(entry => {
              const ownerShort = entry.owner_gaii?.split('@')[0] || entry.owner_gaii;
              const id = entry.owner_gaii + '/' + entry.key;
              const isExpanded = expandedDiscover === id;
              return html`<${ListRow} key=${id} density="compact" name=${entry.key} detail=${ownerShort}
                onOpen=${() => setExpandedDiscover(isExpanded ? null : id)}
                value=${`${entry.tags?.length > 0 ? entry.tags.join(', ') + ' · ' : ''}${formatRelativeTime(entry.updated_at || entry.created_at)}`}
                actions=${html`<${Action} disabled=${copyingKeys.has(entry.key)} onClick=${() => handleCopyEntry(ctx, entry.owner_gaii, entry.key)}>
                  ${copyingKeys.has(entry.key) ? '...' : t('common.copy')}<//>`}>
                ${isExpanded ? html`<${DiscoverPreview} ownerGaii=${entry.owner_gaii} memKey=${entry.key} />` : null}
              <//>`;
            })}<//>`}`}
    <//>`;
  }

  const isHome = browseMode === 'home';
  const desc = isHome ? t('profile.memory.browseHomeDesc') : t('profile.memory.browseRemoteDesc');

  return html`<${Stack}>
    <${Text} tone="muted">${desc}<//>
    ${!isHome && !selectedPeer && (remotePeers.length === 0
      ? html`<${Text} tone="muted">${t('profile.memory.noPeers')}<//>`
      : html`<${Field} type="select" value="" onChange=${e => loadBrowseRemote(ctx, e.target.value)}
          options=${[{ value: '', label: t('profile.memory.browseRemoteSelect') }, ...remotePeers.map(p => ({ value: p.node_id, label: `${p.node_id} (${p.url || ''})` }))]} />`)}
    ${browseLoading && html`<${Text} tone="muted">${isHome ? t('profile.memory.loadingHome') : t('profile.memory.loadingRemote')}<//>`}
    ${browseError && !browseLoading && warning(browseError)}
    ${remoteEntries && !browseLoading && !browseError && html`
      <${Stack} direction="wrap" align="center">
        <${Text} kind="caption" tone="muted">${isHome
          ? t('profile.memory.homeEntries').replace('{count}', remoteEntries.length)
          : t('profile.memory.remoteEntries').replace('{count}', remoteEntries.length).replace('{node}', selectedPeer)}<//>
        ${remoteEntries.length > 0 && html`<${Action} onClick=${() => handlePullAll(ctx)}>${t('profile.memory.pullAllBtn')}<//>`}
      <//>
      ${remoteEntries.length === 0
        ? html`<${Text} tone="muted">${isHome ? t('profile.memory.noHomeEntries') : t('profile.memory.noRemoteEntries')}<//>`
        : html`<${Stack} density="compact">${remoteEntries.map(entry => html`
            <${ListRow} key=${entry.key} density="compact" name=${entry.key}
              detail=${entry.tags?.length > 0 ? entry.tags.join(', ') : undefined}
              value=${html`<${Chip} tone=${entry.visibility === 'public' ? 'sun' : 'plain'}>${t('profile.visibility.' + entry.visibility)}<//>`}
              actions=${html`<${Action} disabled=${pullingKeys.has(entry.key)} onClick=${() => handlePullRemoteEntry(ctx, entry.key)}>
                ${pullingKeys.has(entry.key) ? '...' : t('profile.memory.pullEntry')}<//>`} />`)}<//>`}`}
  <//>`;
}
