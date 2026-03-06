import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as securityService from '/js/services/security.js';
import { listAgents } from '/js/services/agents.js';

export default function SecurityTab({ session, showToast }) {
  const [securityData, setSecurityData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [corsEditGhii, setCorsEditGhii] = useState(null);
  const [corsEditAgent, setCorsEditAgent] = useState(null);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function loadData() {
    setLoading(true);
    try {
      const agents = await listAgents(session.owner);
      const result = await securityService.loadAll(agents);
      setSecurityData(result);
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

  if (loading || !securityData) return html`<${Spinner} text=${t('profile.security.loading')} />`;

  const ghii = securityData.ghii || {};
  const agentsCors = securityData.agents || [];
  const isInherited = ghii.inherited !== false;
  const effectiveOrigins = ghii.effective || [];

  return html`
    <div class="section-title">\u{1F512} ${t('profile.security.title')}</div>
    <div class="section-desc">${t('profile.security.desc')}</div>

    <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('profile.security.ghiiTitle')}</h3>
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">${t('profile.security.ghiiDesc')}</p>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
        <span style="font-weight:600">${t('profile.security.allowedOrigins')}</span>
        <span class="badge ${isInherited ? 'badge-muted' : 'badge-success'}">${isInherited ? t('profile.security.inherited') : t('profile.security.custom')}</span>
      </div>
      <div style="font-size:.85rem;color:var(--muted);margin-bottom:.5rem">
        ${t('profile.security.effective')}: ${effectiveOrigins.includes('*') ? t('profile.security.wildcard') : effectiveOrigins.join(', ') || '-'}
      </div>
      ${corsEditGhii !== null ? html`
        <textarea style="width:100%;min-height:60px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:4px;font-family:monospace;font-size:.85rem;margin-bottom:.5rem"
          placeholder=${t('profile.security.originsPlaceholder')}
          value=${corsEditGhii}
          onInput=${e => setCorsEditGhii(e.target.value)}></textarea>
        <div style="display:flex;gap:.5rem">
          <button class="btn-primary" onClick=${() => saveGhiiCors(corsEditGhii)}>${t('profile.security.save')}</button>
          <button class="revoke-btn" onClick=${() => saveGhiiCors('')}>${t('profile.security.reset')}</button>
          <button style="background:none;border:1px solid var(--border);color:var(--muted);padding:4px 12px;border-radius:4px;cursor:pointer" onClick=${() => setCorsEditGhii(null)}>\u2715</button>
        </div>
      ` : html`
        <button class="btn-primary" onClick=${() => setCorsEditGhii(ghii.allowed_origins ? ghii.allowed_origins.join('\\n') : '')}>${t('profile.security.edit')}</button>
      `}
    </div>

    <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('profile.security.agentsTitle')}</h3>
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">${t('profile.security.agentsDesc')}</p>
    ${agentsCors.length === 0
      ? html`<div class="empty">${t('profile.security.noAgents')}</div>`
      : html`<div class="card" style="overflow-x:auto">
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
                <td><span style="font-family:monospace;font-size:.8rem;color:var(--love3)">${escHtml(agentName)}</span></td>
                <td style="font-size:.8rem">${isEditing
                  ? html`<textarea style="width:200px;min-height:40px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:4px;font-family:monospace;font-size:.8rem"
                      value=${corsEditAgent.value}
                      onInput=${e => setCorsEditAgent({name: agentName, value: e.target.value})}></textarea>`
                  : html`${hasCustom ? (ac.allowed_origins || []).join(', ') : (ac.effective || []).join(', ')}`
                }</td>
                <td>${hasCustom
                  ? html`<span class="badge badge-success">${t('profile.security.custom')}</span>`
                  : html`<span class="badge badge-muted">${t('profile.security.inheritedFrom')}: ${ac.inherited_from || t('profile.security.nodeDefault')}</span>`
                }</td>
                <td>${isEditing
                  ? html`<div style="display:flex;gap:.25rem">
                      <button class="btn-primary" style="font-size:.75rem;padding:2px 8px" onClick=${() => saveAgentCors(agentName, corsEditAgent.value)}>${t('profile.security.save')}</button>
                      <button class="revoke-btn" style="font-size:.75rem" onClick=${() => saveAgentCors(agentName, '')}>${t('profile.security.reset')}</button>
                      <button style="background:none;border:1px solid var(--border);color:var(--muted);padding:2px 8px;border-radius:4px;cursor:pointer;font-size:.75rem" onClick=${() => setCorsEditAgent(null)}>\u2715</button>
                    </div>`
                  : html`<button class="revoke-btn" onClick=${() => setCorsEditAgent({name: agentName, value: hasCustom ? (ac.allowed_origins || []).join('\\n') : ''})}>${t('profile.security.edit')}</button>`
                }</td>
              </tr>`;
            })}
          </tbody></table>
        </div>`
    }

    <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('profile.security.inheritanceTitle')}</h3>
    <div class="card">
      <p style="font-size:.85rem;color:var(--muted)">${t('profile.security.inheritanceDesc')}</p>
      <div style="margin-top:.75rem;font-size:.8rem;font-family:monospace;color:var(--love3)">
        Memory key \u2192 Agent \u2192 GHII (your account) \u2192 Node default
      </div>
    </div>
  `;
}
