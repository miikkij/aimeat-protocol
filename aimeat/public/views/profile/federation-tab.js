import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
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
      : html`<div class="section-title" style="margin-top:0">${t('profile.federation.peers')}</div>
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
                    <span class="peer-dot ${alive ? 'alive' : 'dead'}"></span>
                    <span style="font-size:.8rem;color:${alive ? 'var(--success)' : 'var(--danger)'}">${alive ? t('profile.federation.online') : t('profile.federation.offline')}</span>
                  </div>
                </div>
              </div>`;
          })}`
    }`;
}
