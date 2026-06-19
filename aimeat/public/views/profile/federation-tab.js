/**
 * @file federation-tab.js
 * @description Profile tab showing federated peer nodes and their online/offline status.
 * @version-history
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
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { StatusDot } from '/components/StatusDot.js';
import { listPeers } from '/js/services/federation.js';

export default function FederationTab({ session, showToast }) {
  const [federation, setFederation] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const peers = await listPeers();
      setFederation(peers);
    } catch { setFederation([]); }
  }

  // Live update listener
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  return html`
    <div class="section-title">${t('profile.federation.title')}</div>
    <div class="section-desc">${t('profile.federation.desc')}</div>
    ${!federation ? html`<${Spinner} text=${t('profile.federation.loading')} />`
      : federation.length === 0 ? html`<div class="empty">${t('profile.federation.empty')}</div>`
      : html`<div class="section-title">${t('profile.federation.peers')}</div>
          ${federation.map(p => {
            const alive = p.status === 'active' || p.alive;
            return html`
              <div class="card">
                <div class="peer-card">
                  <div>
                    <div class="card-title">${escHtml(p.node_id || p.nodeId || p.url)}</div>
                    <div class="card-subtitle">${escHtml(p.url || '')}</div>
                  </div>
                  <div class="peer-status">
                    <span class="badge ${(p.tier || 'member') === 'visiting' ? 'badge-info' : (p.tier || 'member') === 'genesis' ? 'badge-info' : 'badge-success'}">${t('profile.federation.tier_' + (p.tier || 'member')) || (p.tier || 'member')}</span>
                    ${p.availability && p.availability !== 'unknown' ? html`<span class="badge ${p.availability === 'permanent' ? 'badge-success' : 'badge-info'}">${t('profile.federation.avail_' + p.availability) || p.availability}</span>` : null}
                    <${StatusDot} status=${alive ? 'alive' : 'dead'} />
                    <span class="fed-status-text ${alive ? 'online' : 'offline'}">${alive ? t('profile.federation.online') : t('profile.federation.offline')}</span>
                  </div>
                </div>
              </div>`;
          })}`
    }`;
}
