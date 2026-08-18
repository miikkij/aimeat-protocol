/**
 * @file public/views/profile/memory-tab/browse-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cross-node / public-discovery browse panel for the Memory tab and its handlers —
 *   browse the home node or a remote peer's shared memory, pull entries (single/all), and discover
 *   public memories to copy. Extracted verbatim from memory-tab.js; handlers and the render function
 *   take the shared ctx so all state/handlers still live in the MemoryTab component.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from public/views/profile/memory-tab.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner, VisibilityPill } from '../shared.js';
import * as memoryService from '/js/services/memory.js';
import { listPeers } from '/js/services/federation.js';
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

export function renderBrowsePanel(ctx) {
  const {
    browseMode, discoverSearch, setDiscoverSearch, discoverLoading, discoverError, discoverEntries,
    expandedDiscover, setExpandedDiscover, copyingKeys, selectedPeer, remotePeers, browseLoading,
    browseError, remoteEntries, pullingKeys,
  } = ctx;

  if (!browseMode) return null;

  if (browseMode === 'discover') {
    return html`
      <div class="mem-browse-panel">
        <div class="mem-browse-header">
          <div>
            <div class="section-desc">${t('profile.memory.discoverDesc')}</div>
          </div>
        </div>
        <div class="mem-discover-search mb-half">
          <input type="text" class="input-field" placeholder=${t('profile.memory.discoverSearchPlaceholder')}
            value=${discoverSearch}
            onInput=${e => setDiscoverSearch(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && loadDiscoverEntries(ctx, discoverSearch)} />
          <button class="btn-sm" onClick=${() => loadDiscoverEntries(ctx, discoverSearch)}>${t('profile.memory.searchBtn')}</button>
        </div>

        ${discoverLoading && html`<${Spinner} text=${t('profile.memory.discoverLoading')} />`}

        ${discoverError && !discoverLoading && html`
          <div class="alert alert-warning"><span class="alert-msg">${discoverError}</span></div>
        `}

        ${discoverEntries && !discoverLoading && !discoverError && html`
          <div class="mb-half text-meta">
            ${t('profile.memory.discoverCount').replace('{count}', discoverEntries.length)}
          </div>
          ${discoverEntries.length === 0
            ? html`<div class="empty">${t('profile.memory.discoverEmpty')}</div>`
            : html`<div class="mem-browse-list">
                ${discoverEntries.map(entry => {
                  const ownerShort = entry.owner_gaii?.split('@')[0] || entry.owner_gaii;
                  const isExpanded = expandedDiscover === entry.owner_gaii + '/' + entry.key;
                  return html`
                    <div key=${entry.owner_gaii + '/' + entry.key} class="mem-discover-item">
                      <div class="mem-discover-row" onClick=${() => setExpandedDiscover(isExpanded ? null : entry.owner_gaii + '/' + entry.key)}>
                        <div class="mem-discover-info">
                          <div class="mem-browse-key" title=${entry.key}>${escHtml(entry.key)}</div>
                          <div class="mem-discover-owner">${escHtml(ownerShort)}</div>
                        </div>
                        <div class="mem-browse-meta">
                          ${entry.tags?.length > 0 && html`<span class="text-meta-sm mem-browse-tags" title=${entry.tags.join(', ')}>${entry.tags.join(', ')}</span>`}
                          <span class="mem-time">${formatRelativeTime(entry.updated_at || entry.created_at)}</span>
                        </div>
                        <button class="btn-outline btn-sm"
                          disabled=${copyingKeys.has(entry.key)}
                          onClick=${(e) => { e.stopPropagation(); handleCopyEntry(ctx, entry.owner_gaii, entry.key); }}>
                          ${copyingKeys.has(entry.key) ? '...' : t('common.copy')}
                        </button>
                      </div>
                      ${isExpanded && html`
                        <${DiscoverPreview} ownerGaii=${entry.owner_gaii} memKey=${entry.key} />
                      `}
                    </div>
                  `;
                })}
              </div>`
          }
        `}
      </div>
    `;
  }

  const isHome = browseMode === 'home';
  const desc = isHome ? t('profile.memory.browseHomeDesc') : t('profile.memory.browseRemoteDesc');

  return html`
    <div class="mem-browse-panel">
      <div class="mem-browse-header">
        <div>
          <div class="section-desc">${desc}</div>
        </div>
      </div>

      ${!isHome && !selectedPeer && html`
        <div class="mb-1">
          ${remotePeers.length === 0
            ? html`<div class="empty">${t('profile.memory.noPeers')}</div>`
            : html`
              <select class="input-field" onChange=${e => loadBrowseRemote(ctx, e.target.value)}>
                <option value="">${t('profile.memory.browseRemoteSelect')}</option>
                ${remotePeers.map(p => html`<option key=${p.node_id} value=${p.node_id}>${escHtml(p.node_id)} (${escHtml(p.url || '')})</option>`)}
              </select>
            `}
        </div>
      `}

      ${browseLoading && html`<${Spinner} text=${isHome ? t('profile.memory.loadingHome') : t('profile.memory.loadingRemote')} />`}

      ${browseError && !browseLoading && html`
        <div class="alert alert-warning">
          <span class="alert-msg">${browseError}</span>
        </div>
      `}

      ${remoteEntries && !browseLoading && !browseError && html`
        <div class="mb-half text-meta">
          ${isHome
            ? t('profile.memory.homeEntries').replace('{count}', remoteEntries.length)
            : t('profile.memory.remoteEntries').replace('{count}', remoteEntries.length).replace('{node}', selectedPeer)}
          ${remoteEntries.length > 0 && html`
            <button class="btn-ghost btn-sm pf-ml-half" onClick=${() => handlePullAll(ctx)}>${t('profile.memory.pullAllBtn')}</button>
          `}
        </div>
        ${remoteEntries.length === 0
          ? html`<div class="empty">${isHome ? t('profile.memory.noHomeEntries') : t('profile.memory.noRemoteEntries')}</div>`
          : html`<div class="mem-browse-list">
              ${remoteEntries.map(entry => html`
                <div key=${entry.key} class="mem-browse-item">
                  <div class="mem-browse-key" title=${entry.key}>${escHtml(entry.key)}</div>
                  <div class="mem-browse-meta">
                    <${VisibilityPill} visibility=${entry.visibility} />
                    ${entry.tags?.length > 0 && html`<span class="text-meta-sm mem-browse-tags" title=${entry.tags.join(', ')}>${entry.tags.join(', ')}</span>`}
                  </div>
                  <button class="btn-outline btn-sm"
                    disabled=${pullingKeys.has(entry.key)}
                    onClick=${() => handlePullRemoteEntry(ctx, entry.key)}>
                    ${pullingKeys.has(entry.key) ? '...' : t('profile.memory.pullEntry')}
                  </button>
                </div>
              `)}
            </div>`
        }
      `}
    </div>
  `;
}
