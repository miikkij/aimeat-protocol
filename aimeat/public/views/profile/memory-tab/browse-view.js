/**
 * @file public/views/profile/memory-tab/browse-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cross-node / public-discovery browse panel for the Memory tab and its handlers —
 *   browse the home node or a remote peer's shared memory, pull entries (single/all), and discover
 *   public memories to copy. Extracted verbatim from memory-tab.js; handlers and the render function
 *   take the shared ctx so all state/handlers still live in the MemoryTab component. Every part is a
 *   component of the kit that gets data; the file writes no class.
 * @version-history
 *   v2.0.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a key or a peer URL with an ampersand or a quote showed as &amp; / &quot;.
 *   v2.0.0 -- 2026-09-26 -- On the component kit, class-free (page group G3): a panel is a section
 *     (Card tone="section") with its grey line (HeadDesc); the search is the SearchLine (Enter
 *     searches); loading is the loading line (the words main's Spinner said); an error is the
 *     attention note; the counts are meta lines; the public list is the List whose row opens its
 *     value in the raised panel (the key, the owner under it, the tags, the time, Copy); the home
 *     and remote entries are the List (the key, the visibility tag and the tags, Pull); the peer
 *     picker is the Select.
 *   v1.8.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.7.0 -- 2026-09-26 -- A key is the Key (.key-name, css/components/key-name.css): the public list's coral key and the listings' .mp-key (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-25 -- The home node's and a remote node's entries are the Listing (css/components/listing.css), a unification: the look most tabs use. The public discovery list stays: its row opens a preview under it.
 *   v1.4.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.3.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.2.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { VisibilityPill } from '../shared.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Card } from '/components/Card.js';
import { HeadDesc } from '/components/SubHeading.js';
import { List, Row, Name, Desc, When, Cell, Doors, SearchLine } from '/components/List.js';
import { Row as Line, Stack } from '/components/Layout.js';
import { Select } from '/components/Select.js';
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
      <${Card} tone="section">
        <${Stack}>
          <${HeadDesc}>${t('profile.memory.discoverDesc')}<//>
          <${SearchLine} text value=${discoverSearch} placeholder=${t('profile.memory.discoverSearchPlaceholder')}
            onInput=${e => setDiscoverSearch(e.target.value)}
            onEnter=${() => loadDiscoverEntries(ctx, discoverSearch)}>
            <${Action} small onClick=${() => loadDiscoverEntries(ctx, discoverSearch)}>${t('profile.memory.searchBtn')}<//>
          <//>

          ${discoverLoading ? html`<${Note} kind="loading">${t('profile.memory.discoverLoading')}<//>` : null}

          ${discoverError && !discoverLoading ? html`<${Note} kind="aside" size="small" role="alert">${discoverError}<//>` : null}

          ${discoverEntries && !discoverLoading && !discoverError ? html`
            <${Note} kind="meta">${t('profile.memory.discoverCount').replace('{count}', discoverEntries.length)}<//>
            <${List} cols="name-desc-when-doors" empty=${t('profile.memory.discoverEmpty')}>
              ${discoverEntries.map(entry => {
                const id = entry.owner_gaii + '/' + entry.key;
                const ownerShort = entry.owner_gaii?.split('@')[0] || entry.owner_gaii;
                const isExpanded = expandedDiscover === id;
                return html`
                  <${Row} key=${id} open=${isExpanded} onToggle=${() => setExpandedDiscover(isExpanded ? null : id)}
                    panel=${isExpanded ? html`<${DiscoverPreview} ownerGaii=${entry.owner_gaii} memKey=${entry.key} />` : null}>
                    <${Name} asKey title=${entry.key} meta=${ownerShort}>${entry.key}<//>
                    <${Desc} clip title=${entry.tags?.length > 0 ? entry.tags.join(', ') : undefined}>${entry.tags?.length > 0 ? entry.tags.join(', ') : ''}<//>
                    <${When}>${formatRelativeTime(entry.updated_at || entry.created_at)}<//>
                    <${Doors}>
                      <${Action} small disabled=${copyingKeys.has(entry.key)}
                        onClick=${(e) => { e.stopPropagation(); handleCopyEntry(ctx, entry.owner_gaii, entry.key); }}>
                        ${copyingKeys.has(entry.key) ? '...' : t('common.copy')}
                      <//>
                    <//>
                  <//>
                `;
              })}
            <//>
          ` : null}
        <//>
      <//>
    `;
  }

  const isHome = browseMode === 'home';
  const desc = isHome ? t('profile.memory.browseHomeDesc') : t('profile.memory.browseRemoteDesc');

  return html`
    <${Card} tone="section">
      <${Stack}>
        <${HeadDesc}>${desc}<//>

        ${!isHome && !selectedPeer ? (remotePeers.length === 0
          ? html`<${Note} kind="quiet">${t('profile.memory.noPeers')}<//>`
          : html`<${Select} fit ariaLabel=${t('profile.memory.browseRemoteSelect')} placeholder=${t('profile.memory.browseRemoteSelect')}
              onChange=${(peer) => loadBrowseRemote(ctx, peer)}
              options=${remotePeers.map(p => [p.node_id, `${p.node_id ?? ''} (${p.url || ''})`])} />`) : null}

        ${browseLoading ? html`<${Note} kind="loading">${isHome ? t('profile.memory.loadingHome') : t('profile.memory.loadingRemote')}<//>` : null}

        ${browseError && !browseLoading ? html`<${Note} kind="aside" size="small" role="alert">${browseError}<//>` : null}

        ${remoteEntries && !browseLoading && !browseError ? html`
          <${Line} wrap>
            <${Note} kind="meta" inline>
              ${isHome
                ? t('profile.memory.homeEntries').replace('{count}', remoteEntries.length)
                : t('profile.memory.remoteEntries').replace('{count}', remoteEntries.length).replace('{node}', selectedPeer)}
            <//>
            ${remoteEntries.length > 0 ? html`<${Action} small onClick=${() => handlePullAll(ctx)}>${t('profile.memory.pullAllBtn')}<//>` : null}
          <//>
          <${List} cols="name-tags-doors" keepCols empty=${isHome ? t('profile.memory.noHomeEntries') : t('profile.memory.noRemoteEntries')}>
            ${remoteEntries.map(entry => html`
              <${Row} key=${entry.key}>
                <${Name} asKey title=${entry.key}>${entry.key}<//>
                <${Cell} line>
                  <${VisibilityPill} visibility=${entry.visibility} />
                  ${entry.tags?.length > 0 ? html`<${Note} kind="meta" inline title=${entry.tags.join(', ')}>${entry.tags.join(', ')}<//>` : null}
                <//>
                <${Doors}>
                  <${Action} small row disabled=${pullingKeys.has(entry.key)} onClick=${() => handlePullRemoteEntry(ctx, entry.key)}>
                    ${pullingKeys.has(entry.key) ? '...' : t('profile.memory.pullEntry')}
                  <//>
                <//>
              <//>
            `)}
          <//>
        ` : null}
      <//>
    <//>
  `;
}
