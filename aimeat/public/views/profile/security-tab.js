/**
 * @file security-tab.js
 * @description Profile tab for CORS origin management (GHII + per-agent) and session revocation.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes (card-h3, flex-between, etc.)
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as securityService from '/js/services/security.js';
import { listAgents } from '/js/services/agents.js';

export default function SecurityTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [securityData, setSecurityData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [corsEditGhii, setCorsEditGhii] = useState(null);
  const [corsEditAgent, setCorsEditAgent] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [revokingId, setRevokingId] = useState(null);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function loadData() {
    setLoading(true);
    try {
      const [agents, sessionsList] = await Promise.all([
        listAgents(session.owner),
        securityService.listSessions(),
      ]);
      const result = await securityService.loadAll(agents);
      setSecurityData(result);
      setSessions(sessionsList);
    } catch { setSecurityData({ ghii: {}, agents: [] }); }
    setLoading(false);
  }

  async function saveGhiiCors(originsText) {
    const origins = originsText.trim()
      ? originsText.split(/[,\n]/).map(o => o.trim()).filter(Boolean)
      : null;
    try {
      const resp = await securityService.setGhiiCors(origins);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Save failed');
      showToast(t('profile.security.saved'));
      setCorsEditGhii(null);
      loadData();
    } catch(e) { showToast(e.message || t('profile.error'), true); }
  }

  async function saveAgentCors(agentName, originsText) {
    const origins = originsText.trim()
      ? originsText.split(/[,\n]/).map(o => o.trim()).filter(Boolean)
      : null;
    try {
      const resp = await securityService.setAgentCors(agentName, origins);
      if (resp.ok === false) throw new Error(resp.error?.message || 'Save failed');
      showToast(t('profile.security.saved'));
      setCorsEditAgent(null);
      loadData();
    } catch(e) { showToast(e.message || t('profile.error'), true); }
  }

  async function handleRevokeAll() {
    confirm(t('profile.security.revokeConfirm') || 'Are you sure you want to revoke all active sessions? You will be logged out.', async () => {
      setRevoking(true);
      try {
        const data = await securityService.revokeAllSessions();
        if (data.ok !== false) {
          showToast((t('profile.security.sessionsRevoked') || 'All sessions revoked') + ` (${data.data?.revoked ?? 0})`);
          setTimeout(() => { localStorage.removeItem('aimeat_session'); location.reload(); }, 1500);
        } else {
          showToast(data.error?.message || 'Failed to revoke sessions', true);
        }
      } catch(e) { showToast(e.message || 'Error', true); }
      setRevoking(false);
    }, { danger: true });
  }

  if (loading || !securityData) return html`<${Spinner} text=${t('profile.security.loading')} />`;

  const ghii = securityData.ghii || {};
  const agentsCors = securityData.agents || [];
  const isInherited = ghii.inherited !== false;
  const effectiveOrigins = ghii.effective || [];

  return html`
    <div class="section-title">\u{1F512} ${t('profile.security.title')}</div>
    <div class="section-desc">${t('profile.security.desc')}</div>

    <h3 class="card-h3 mt-section">${t('profile.security.ghiiTitle')}</h3>
    <p class="text-caption mb-1">${t('profile.security.ghiiDesc')}</p>
    <div class="card">
      <div class="flex-between mb-half">
        <span class="pf-bold">${t('profile.security.allowedOrigins')}</span>
        <span class="badge ${isInherited ? 'badge-muted' : 'badge-success'}">${isInherited ? t('profile.security.inherited') : t('profile.security.custom')}</span>
      </div>
      <div class="text-caption mb-half">
        ${t('profile.security.effective')}: ${effectiveOrigins.includes('*') ? t('profile.security.wildcard') : effectiveOrigins.join(', ') || '-'}
      </div>
      ${corsEditGhii !== null ? html`
        <textarea class="input-field text-code mb-half"
          placeholder=${t('profile.security.originsPlaceholder')}
          value=${corsEditGhii}
          onInput=${e => setCorsEditGhii(e.target.value)}></textarea>
        <div class="flex-row">
          <button class="btn-primary" onClick=${() => saveGhiiCors(corsEditGhii)}>${t('profile.security.save')}</button>
          <button class="revoke-btn" onClick=${() => saveGhiiCors('')}>${t('profile.security.reset')}</button>
          <button class="btn-outline" onClick=${() => setCorsEditGhii(null)}>\u2715</button>
        </div>
      ` : html`
        <button class="btn-primary" onClick=${() => setCorsEditGhii(ghii.allowed_origins ? ghii.allowed_origins.join('\\n') : '')}>${t('profile.security.edit')}</button>
      `}
    </div>

    <h3 class="card-h3 mt-section">${t('profile.security.agentsTitle')}</h3>
    <p class="text-caption mb-1">${t('profile.security.agentsDesc')}</p>
    ${agentsCors.length === 0
      ? html`<div class="empty">${t('profile.security.noAgents')}</div>`
      : html`<div class="card scroll-x">
          <table class="consent-table"><thead><tr>
            <th>${t('profile.security.agent')}</th>
            <th>${t('profile.security.origins')}</th>
            <th>${t('profile.security.status')}</th>
            <th></th>
          </tr></thead><tbody>
            ${agentsCors.map(ac => {
              const agentName = (ac.gaii || '').split('#')[0] || ac.gaii;
              const hasCustom = ac.allowed_origins !== null && ac.allowed_origins !== undefined;
              const isEditing = corsEditAgent && corsEditAgent.name === agentName;
              return html`<tr>
                <td><span class="text-code text-accent">${escHtml(agentName)}</span></td>
                <td class="text-meta">${isEditing
                  ? html`<textarea class="input-field text-code pf-textarea-sm"
                      value=${corsEditAgent.value}
                      onInput=${e => setCorsEditAgent({name: agentName, value: e.target.value})}></textarea>`
                  : html`${hasCustom ? (ac.allowed_origins || []).join(', ') : (ac.effective || []).join(', ')}`
                }</td>
                <td>${hasCustom
                  ? html`<span class="badge badge-success">${t('profile.security.custom')}</span>`
                  : html`<span class="badge badge-muted">${t('profile.security.inheritedFrom')}: ${ac.inherited_from || t('profile.security.nodeDefault')}</span>`
                }</td>
                <td>${isEditing
                  ? html`<div class="flex-row">
                      <button class="btn-primary pf-btn-xs" onClick=${() => saveAgentCors(agentName, corsEditAgent.value)}>${t('profile.security.save')}</button>
                      <button class="revoke-btn pf-btn-xs" onClick=${() => saveAgentCors(agentName, '')}>${t('profile.security.reset')}</button>
                      <button class="btn-outline pf-btn-xs" onClick=${() => setCorsEditAgent(null)}>\u2715</button>
                    </div>`
                  : html`<button class="revoke-btn" onClick=${() => setCorsEditAgent({name: agentName, value: hasCustom ? (ac.allowed_origins || []).join('\\n') : ''})}>${t('profile.security.edit')}</button>`
                }</td>
              </tr>`;
            })}
          </tbody></table>
        </div>`
    }

    <h3 class="card-h3 mt-section">${t('profile.security.inheritanceTitle')}</h3>
    <div class="card">
      <p class="text-caption">${t('profile.security.inheritanceDesc')}</p>
      <div class="text-code text-meta text-accent mt-xs">
        Memory key \u2192 Agent \u2192 GHII (your account) \u2192 Node default
      </div>
    </div>

    <h3 class="card-h3 mt-section">${t('profile.security.sessions') || 'Session Management'}</h3>
    <p class="text-caption mb-1">${t('profile.security.sessionsHint') || 'Manage your active sessions. Revoking a session logs it out immediately.'}</p>

    ${sessions.length === 0
      ? html`<div class="empty">${t('profile.security.noSessions') || 'No active sessions'}</div>`
      : html`<div class="card scroll-x">
          <table class="consent-table"><thead><tr>
            <th>${t('profile.security.sessionIdentity') || 'Identity'}</th>
            <th>${t('profile.security.sessionIssuedAt') || 'Issued'}</th>
            <th>${t('profile.security.sessionExpiresAt') || 'Expires'}</th>
            <th></th>
          </tr></thead><tbody>
            ${sessions.map(s => html`<tr>
              <td>
                <span class="text-code">${escHtml(s.gaii || session.owner)}</span>
                ${s.current ? html` <span class="badge badge-success">${t('profile.security.currentSession') || 'current'}</span>` : null}
              </td>
              <td class="text-meta">${new Date(s.issued_at).toLocaleString()}</td>
              <td class="text-meta">${new Date(s.expires_at).toLocaleString()}</td>
              <td>${s.current ? null : html`
                <button class="revoke-btn pf-btn-xs" disabled=${revokingId === s.session_id}
                  onClick=${async () => {
                    setRevokingId(s.session_id);
                    try {
                      await securityService.revokeSession(s.session_id);
                      showToast(t('profile.security.sessionRevoked') || 'Session revoked');
                      setSessions(prev => prev.filter(x => x.session_id !== s.session_id));
                    } catch(e) { showToast(e.message || 'Error', true); }
                    setRevokingId(null);
                  }}>
                  ${revokingId === s.session_id ? '...' : (t('profile.security.revoke') || 'Revoke')}
                </button>
              `}</td>
            </tr>`)}
          </tbody></table>
        </div>`
    }

    <div class="card mt-1">
      <p class="text-caption mb-half">${t('profile.security.sessionsDesc') || 'Revoking all sessions will invalidate every active JWT token. You and all your agents will be logged out immediately.'}</p>
      <button class="sec-revoke-btn" onClick=${handleRevokeAll} disabled=${revoking}>
        ${revoking ? (t('profile.security.revoking') || 'Revoking...') : (t('profile.security.revokeAll') || 'Revoke All Sessions')}
      </button>
    </div>
    <${ConfirmUI} />
  `;
}
