/**
 * @file access-tab.js
 * @description Profile tab displaying session info, public key, owner key,
 *   MCP endpoint details, and federation access management for the current user.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial access tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.2.0 — 2026-05-21 — Add Federation Access section for auth consent management
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { getNodeUrl } from '/js/services/auth.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';

export default function AccessTab({ session, showToast }) {
  const NODE_URL = getNodeUrl();
  const ownerKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aimeat_owner_key') : null;
  const [keyBlurred, setKeyBlurred] = useState(true);
  const [authConsents, setAuthConsents] = useState([]);
  const [newNodeId, setNewNodeId] = useState('');
  const [fedLoading, setFedLoading] = useState(false);

  // Load auth consents on mount
  useEffect(() => {
    apiGet('/v1/consent').then(data => {
      const all = data.data?.consents || [];
      setAuthConsents(all.filter(c => c.scope === 'auth' && c.status === 'active'));
    }).catch(() => {});
  }, []);

  async function addAuthNode() {
    if (!newNodeId.trim()) return;
    setFedLoading(true);
    try {
      await apiPost('/v1/consent', {
        data_pattern: '_identity',
        recipient: 'node:' + newNodeId.trim(),
        scope: 'auth',
        purpose: 'federation_login',
      });
      setNewNodeId('');
      const data = await apiGet('/v1/consent');
      setAuthConsents((data.data?.consents || []).filter(c => c.scope === 'auth' && c.status === 'active'));
      showToast(t('profile.access.fedGranted'));
    } catch (e) {
      showToast(e.message);
    } finally {
      setFedLoading(false);
    }
  }

  async function removeAuthConsent(id) {
    try {
      await apiDelete('/v1/consent/' + id);
      setAuthConsents(prev => prev.filter(c => c.id !== id));
      showToast(t('profile.access.fedRevoked'));
    } catch (e) {
      showToast(e.message);
    }
  }

  async function toggleAllowAll() {
    const wildcard = authConsents.find(c => c.recipient === '*');
    if (wildcard) {
      await removeAuthConsent(wildcard.id);
    } else {
      try {
        await apiPost('/v1/consent', {
          data_pattern: '_identity',
          recipient: '*',
          scope: 'auth',
          purpose: 'federation_login_all',
        });
        const data = await apiGet('/v1/consent');
        setAuthConsents((data.data?.consents || []).filter(c => c.scope === 'auth' && c.status === 'active'));
      } catch (e) {
        showToast(e.message);
      }
    }
  }

  return html`
    <div class="section-title">${t('profile.access.title')}</div>
    <div class="section-desc">${t('profile.access.desc')}</div>

    <h3 class="card-h3">\u{1F4BB} ${t('profile.access.session')}</h3>
    <div class="card">
      <div class="mem-item"><span class="mem-key">${t('profile.access.owner')}</span><span>${escHtml(session.owner || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.ghii')}</span><span>${escHtml(session.ghii || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.agentGaii')}</span><span>${escHtml(session.gaii || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.node')}</span><span>${escHtml(NODE_URL)}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.jwtValid')}</span><span>${session.valid ? html`<span class="badge badge-success">${t('profile.access.yes')}</span>` : html`<span class="badge badge-danger">${t('profile.access.expired')}</span>`}</span></div>
    </div>

    <h3 class="card-h3 mt-section">\u{1F510} ${t('profile.access.publicKey')}</h3>
    <div class="card"><div class="access-mono">${escHtml(session.publicKey || 'N/A')}</div></div>

    ${ownerKey && html`
      <h3 class="card-h3 mt-section">\u{1F5DD}️ ${t('profile.access.ownerKey')}</h3>
      <div class="card access-card-warn" onClick=${() => copyToClipboard(ownerKey).then(() => showToast(t('profile.access.keyCopied')))}>
        <div class="flex-between">
          <div class="access-mono ${keyBlurred ? 'access-key-blur' : 'access-key-blur revealed'}"
            onMouseEnter=${() => setKeyBlurred(false)} onMouseLeave=${() => setKeyBlurred(true)}>
            ${escHtml(ownerKey)}
          </div>
          <span class="badge badge-warn">${t('profile.access.hoverReveal')}</span>
        </div>
        <div class="access-warn-text">⚠ ${t('profile.access.keepSafe')}</div>
      </div>
    `}

    <h3 class="card-h3 mt-section">\u{1F517} ${t('profile.access.mcpEndpoint')}</h3>
    <div class="card">
      <div class="access-mcp-url">${escHtml(NODE_URL + '/v1/mcp')}</div>
      <div class="access-mcp-desc">${t('profile.access.mcpDesc')}</div>
    </div>

    <h3 class="card-h3 mt-section">\u{1F310} ${t('profile.access.fedTitle')}</h3>
    <div class="section-desc">${t('profile.access.fedDesc')}</div>

    <div class="card">
      <div class="mem-item">
        <label class="flex-row">
          <input type="checkbox"
            checked=${authConsents.some(c => c.recipient === '*')}
            onChange=${toggleAllowAll} />
          ${t('profile.access.fedAllowAll')}
        </label>
        ${authConsents.some(c => c.recipient === '*') && html`
          <span class="badge badge-warn">${t('profile.access.fedAllowAllWarn')}</span>
        `}
      </div>

      ${authConsents.filter(c => c.recipient !== '*').length === 0 && !authConsents.some(c => c.recipient === '*') && html`
        <p class="adm-text-dim">${t('profile.access.fedNoConsents')}</p>
      `}
      ${authConsents.filter(c => c.recipient !== '*').map(c => html`
        <div class="mem-item">
          <span class="mem-key">${escHtml(c.recipient.replace('node:', ''))}</span>
          <button class="btn-ghost btn-danger" onClick=${() => removeAuthConsent(c.id)}>
            ${t('profile.access.fedRemove')}
          </button>
        </div>
      `)}

      <div class="mem-item access-fed-add">
        <input type="text" class="input-field input-sm" placeholder=${t('profile.access.fedNodeId')}
          value=${newNodeId} onInput=${e => setNewNodeId(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && addAuthNode()} />
        <button class="btn-primary" onClick=${addAuthNode} disabled=${fedLoading}>
          ${t('profile.access.fedAddNode')}
        </button>
      </div>
    </div>
  `;
}
