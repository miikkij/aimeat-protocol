/**
 * @file federation-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing federated peer nodes and their online/offline status.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, Section, ListRow, Chip); no own
 *     classes. A peer is a list row; its tier, availability and online state are chips, the online
 *     dot is the success or danger chip beside it.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-03-16 — Initial federation tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.2.0 — 2026-06-02 — Component unification (#11): peer online/offline dot
 *     uses canonical <StatusDot> (alive/dead) instead of bespoke .peer-dot.
 *   v1.3.0 — 2026-06-19 — Show peer tier (visiting/member/genesis) + availability
 *     (temporary/permanent) pills next to the status (visiting-node feature).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { Page, Section, Stack, ListRow, Chip, Surface, Text } from '/components/poster-parts.js';
import { listPeers } from '/js/services/federation.js';
import { swallowed } from '/js/swallowed.js';

export default function FederationTab() {
  const [federation, setFederation] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const peers = await listPeers();
      setFederation(peers);
    } catch (err) { swallowed('federation-tab', err); setFederation([]); }
  }

  // Live update listener
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => onLiveUpdate(['federation'], () => loadRef.current()), []);

  return html`<${Page} width="wide" title=${t('profile.federation.title')}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuInfra') }, { label: t('profile.tabs.federation') }]}>
    <${Stack}>
      <${Text} kind="lead">${t('profile.federation.desc')}<//>
      ${!federation ? html`<${Spinner} text=${t('profile.federation.loading')} />`
        : federation.length === 0 ? html`<${Surface} kind="aside"><${Text} tone="muted">${t('profile.federation.empty')}<//><//>`
        : html`<${Section} title=${t('profile.federation.peers')} count=${federation.length}>
            <${Stack} density="compact">${federation.map(p => {
              const alive = p.status === 'active' || p.alive;
              const tier = p.tier || 'member';
              return html`<${ListRow} key=${p.node_id || p.nodeId || p.url}
                name=${escHtml(p.node_id || p.nodeId || p.url)} detail=${escHtml(p.url || '')}
                value=${html`<${Stack} direction="wrap" density="compact">
                  <${Chip} tone=${tier === 'member' ? 'success' : 'plain'}>${t('profile.federation.tier_' + tier) || tier}<//>
                  ${p.availability && p.availability !== 'unknown' ? html`<${Chip} tone=${p.availability === 'permanent' ? 'success' : 'plain'}>${t('profile.federation.avail_' + p.availability) || p.availability}<//>` : null}
                  <${Chip} tone=${alive ? 'success' : 'danger'}>${alive ? t('profile.federation.online') : t('profile.federation.offline')}<//>
                <//>`} />`;
            })}<//>
          <//>`}
    <//>
  <//>`;
}
