/**
 * @file security-tab.js
 * @description Profile tab for CORS origin management (GHII + per-agent) and session revocation.
 * @version-history
 *   v1.2.0 — 2026-07-18 — Vaihe 2d: the two bespoke `consent-table`s (per-agent CORS + sessions) →
 *     canonical generic <DataTable> (rows/headers), unifying them with the node-wide table look
 *     (accent-tinted divider/hover → neutral canonical). Cell content preserved verbatim.
 *   v1.1.0 — 2026-07-16 — Mount folds GHII CORS + per-agent CORS + sessions into GET /v1/security/overview
 *     (getSecurityOverview) — kills the CORS-per-agent fan-out; individual reads kept as fallback.
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes (card-h3, flex-between, etc.)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { DataTable } from '/components/DataTable.js';
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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Mount fold: ONE composite (GHII CORS + per-agent CORS resolved server-side + sessions). On failure,
      // fall back to listAgents + the per-agent CORS fan-out + listSessions.
      const ov = await securityService.getSecurityOverview();
      if (ov) {
        setSecurityData({ ghii: ov.ghii, agents: ov.agents });
        setSessions(ov.sessions);
      } else {
        const [agents, sessionsList] = await Promise.all([
          listAgents(session.owner),
          securityService.listSessions(),
        ]);
        const result = await securityService.loadAll(agents);
        setSecurityData(result);
        setSessions(sessionsList);
      }
    } catch { setSecurityData({ ghii: {}, agents: [] }); }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

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
          <button class="btn-danger-solid" onClick=${() => saveGhiiCors('')}>${t('profile.security.reset')}</button>
          <button class="btn-ghost" onClick=${() => setCorsEditGhii(null)}>${t('profile.cancel')}</button>
        </div>
      ` : html`
        <button class="btn-outline" onClick=${() => setCorsEditGhii(ghii.allowed_origins ? ghii.allowed_origins.join('\\n') : '')}>${t('profile.security.edit')}</button>
      `}
    </div>

    <h3 class="card-h3 mt-section">${t('profile.security.agentsTitle')}</h3>
    <p class="text-caption mb-1">${t('profile.security.agentsDesc')}</p>
    ${agentsCors.length === 0
      ? html`<div class="empty">${t('profile.security.noAgents')}</div>`
      : html`<div class="card scroll-x">
          <${DataTable}
            headers=${[t('profile.security.agent'), t('profile.security.origins'), t('profile.security.status'), '']}
            rows=${agentsCors.map(ac => {
              const agentName = (ac.gaii || '').split('#')[0] || ac.gaii;
              const hasCustom = ac.allowed_origins !== null && ac.allowed_origins !== undefined;
              const isEditing = corsEditAgent && corsEditAgent.name === agentName;
              return [
                html`<span class="text-code text-accent">${escHtml(agentName)}</span>`,
                isEditing
                  ? html`<textarea class="input-field text-code pf-textarea-sm"
                      value=${corsEditAgent.value}
                      onInput=${e => setCorsEditAgent({name: agentName, value: e.target.value})}></textarea>`
                  : html`<span class="text-meta">${hasCustom ? (ac.allowed_origins || []).join(', ') : (ac.effective || []).join(', ')}</span>`,
                hasCustom
                  ? html`<span class="badge badge-success">${t('profile.security.custom')}</span>`
                  : html`<span class="badge badge-muted">${t('profile.security.inheritedFrom')}: ${ac.inherited_from || t('profile.security.nodeDefault')}</span>`,
                isEditing
                  ? html`<div class="flex-row">
                      <button class="btn-primary btn-sm" onClick=${() => saveAgentCors(agentName, corsEditAgent.value)}>${t('profile.security.save')}</button>
                      <button class="btn-danger-solid btn-sm" onClick=${() => saveAgentCors(agentName, '')}>${t('profile.security.reset')}</button>
                      <button class="btn-ghost btn-sm" onClick=${() => setCorsEditAgent(null)}>${t('profile.cancel')}</button>
                    </div>`
                  : html`<button class="btn-outline" onClick=${() => setCorsEditAgent({name: agentName, value: hasCustom ? (ac.allowed_origins || []).join('\\n') : ''})}>${t('profile.security.edit')}</button>`,
              ];
            })}
          />
        </div>`
    }

    <h3 class="card-h3 mt-section">${t('profile.security.inheritanceTitle')}</h3>
    <div class="card">
      <p class="text-caption">${t('profile.security.inheritanceDesc')}</p>
      <div class="text-code text-meta text-accent mt-xs">
        Memory key \u2192 Agent \u2192 GHII (your account) \u2192 Node default
      </div>
    </div>

    <h3 class="card-h3 mt-section">${t('profile.security.sessions')}</h3>
    <p class="text-caption mb-1">${t('profile.security.sessionsHint')}</p>

    ${sessions.length === 0
      ? html`<div class="empty">${t('profile.security.noSessions')}</div>`
      : html`<div class="card scroll-x">
          <${DataTable}
            headers=${[t('profile.security.sessionIdentity'), t('profile.security.sessionIssuedAt'), t('profile.security.sessionExpiresAt'), '']}
            rows=${sessions.map(s => [
              html`<span class="text-code">${escHtml(s.gaii || session.owner)}</span>${s.current ? html` <span class="badge badge-success">${t('profile.security.currentSession')}</span>` : null}`,
              html`<span class="text-meta">${new Date(s.issued_at).toLocaleString()}</span>`,
              html`<span class="text-meta">${new Date(s.expires_at).toLocaleString()}</span>`,
              s.current ? null : html`
                <button class="btn-danger-solid btn-sm" disabled=${revokingId === s.session_id}
                  onClick=${async () => {
                    setRevokingId(s.session_id);
                    try {
                      await securityService.revokeSession(s.session_id);
                      showToast(t('profile.security.sessionRevoked'));
                      setSessions(prev => prev.filter(x => x.session_id !== s.session_id));
                    } catch(e) { showToast(e.message || 'Error', true); }
                    setRevokingId(null);
                  }}>
                  ${revokingId === s.session_id ? '...' : t('profile.security.revoke')}
                </button>
              `,
            ])}
          />
        </div>`
    }

    <div class="card mt-1">
      <p class="text-caption mb-half">${t('profile.security.sessionsDesc')}</p>
      <button class="btn-danger-solid" onClick=${handleRevokeAll} disabled=${revoking}>
        ${revoking ? t('profile.security.revoking') : t('profile.security.revokeAll')}
      </button>
    </div>
    <${ConfirmUI} />
  `;
}
