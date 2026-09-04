/**
 * @file security-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for CORS origin management (GHII + per-agent): which web addresses may
 *   reach the account's API. Operator-only in the menu (the Infrastructure group).
 * @version-history
 *   v1.5.0 — 2026-09-05 — Two-step sign-in, the passkeys and the sessions moved to the Access page,
 *     which every member can open; this tab sits in the operator-only group, so a member could not
 *     switch two-step on from anywhere. What stays here is the one thing that belongs to an
 *     operator or a developer: the CORS origins (design canvas "AIMEAT Pääsy-sivu", decision 1).
 *   v1.4.0 — 2026-09-04 — The passkey section, under two-step sign-in: the devices that can sign
 *     in as you, adding this one, renaming and removing. Hidden for an organisation-managed
 *     account, whose way in is the organisation's directory.
 *   v1.3.0 — 2026-09-04 — Two-step sign-in (TOTP) has a door, in the section-tab/two-factor.js
 *     panel: the routes shipped in July with no way to reach them from a screen. It sits first,
 *     above CORS, because it is the one thing on this tab a person came here to switch on. The
 *     lock glyph leaves the section title with it — no emoji in the interface.
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
import { swallowed } from '/js/swallowed.js';

export default function SecurityTab({ session, showToast }) {
  const { ConfirmUI } = useConfirm();
  const [securityData, setSecurityData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [corsEditGhii, setCorsEditGhii] = useState(null);
  const [corsEditAgent, setCorsEditAgent] = useState(null);

  // No setLoading(true) here, on purpose. The render guard below already shows the spinner while
  // there is no data, which covers the first read; raising the flag again on a RE-read replaced the
  // whole tab with a spinner, unmounted the two-step panel mid-setup, and took the secret and the
  // backup codes with it — material the server shows once and never again. Measured in a browser:
  // arming the factor emits a change event, the tab re-read, and the QR being scanned vanished.
  const loadData = useCallback(async () => {
    try {
      // Mount fold: ONE composite (GHII CORS + per-agent CORS resolved server-side + sessions). On failure,
      // fall back to listAgents + the per-agent CORS fan-out + listSessions.
      const ov = await securityService.getSecurityOverview();
      if (ov) {
        setSecurityData({ ghii: ov.ghii, agents: ov.agents, managedBy: ov.managed_by || null });
      } else {
        const agents = await listAgents(session.owner);
        const result = await securityService.loadAll(agents);
        setSecurityData(result);
      }
    } catch (err) { swallowed('security-tab', err); setSecurityData({ ghii: { }, agents: [] }); }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // This tab shows server state (sessions, and now whether a second factor is armed), so it follows
  // the node-wide convention and re-reads on the live-update event.
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadData]);

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
    <div class="section-title">${t('profile.security.title')}</div>
    <div class="section-desc">${t('profile.security.desc')}</div>

    ${securityData.managedBy && html`
      <div class="card mb-1">
        <span class="pf-bold">${t('profile.security.managedTitle')}</span>
        <p class="text-caption mb-0">${t('profile.security.managedDesc').replace('{name}', securityData.managedBy.name)}</p>
      </div>
    `}

    <p class="text-caption mb-1">${t('profile.security.signInMoved')}</p>

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

    <${ConfirmUI} />
  `;
}
