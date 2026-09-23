/**
 * @file security-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for CORS origin management (GHII + per-agent): which web addresses may
 *   reach the account's API. Operator-only in the menu (the Infrastructure group).
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, Section, Table that stacks on a
 *     phone, Chip, Field, Action); no own classes. The per-agent CORS list stays a table.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.6.0 — 2026-09-05 — Two-step sign-in, the passkeys and the sessions moved to the Access page,
 *     which every member can open; this tab sits in the operator-only group, so a member could not
 *     switch two-step on from anywhere. What stays here is the one thing that belongs to an
 *     operator or a developer: the CORS origins (design canvas "AIMEAT Pääsy-sivu", decision 1).
 *     Merged over v1.5.0, whose device list is now the Access page's.
 *   v1.5.0 — 2026-09-05 — The session list is a DEVICE list: agent sessions are gone from it (the
 *     composite dropped the filter GET /v1/auth/sessions always had), and the first column names
 *     the device rather than repeating the account name on every row. What the revoke-all button
 *     actually does is what the text now says: your devices, not your agents.
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
import { Page, Section, Stack, Table, Chip, Action, Field, Surface, Text } from '/components/poster-parts.js';
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

  return html`<${Page} width="wide" title=${t('profile.security.title')}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuInfra') }, { label: t('profile.tabs.security') }]}>
    <${Stack}>
      <${Text} kind="lead">${t('profile.security.desc')}<//>

      ${securityData.managedBy && html`<${Surface} kind="aside"><${Stack} density="compact">
        <${Text}><strong>${t('profile.security.managedTitle')}</strong><//>
        <${Text} kind="caption">${t('profile.security.managedDesc').replace('{name}', securityData.managedBy.name)}<//>
      <//><//>`}

      <${Text} kind="caption" tone="muted">${t('profile.security.signInMoved')}<//>

      <${Section} title=${t('profile.security.ghiiTitle')} description=${t('profile.security.ghiiDesc')}>
        <${Stack}>
          <${Stack} direction="horizontal" align="between">
            <${Text}><strong>${t('profile.security.allowedOrigins')}</strong><//>
            <${Chip} tone=${isInherited ? 'muted' : 'success'}>${isInherited ? t('profile.security.inherited') : t('profile.security.custom')}<//>
          <//>
          <${Text} kind="caption" tone="muted">
            ${t('profile.security.effective')}: ${effectiveOrigins.includes('*') ? t('profile.security.wildcard') : effectiveOrigins.join(', ') || '-'}
          <//>
          ${corsEditGhii !== null ? html`
            <${Field} type="textarea" rows="4" ariaLabel=${t('profile.security.allowedOrigins')}
              placeholder=${t('profile.security.originsPlaceholder')}
              value=${corsEditGhii}
              onInput=${e => setCorsEditGhii(e.target.value)} />
            <${Stack} direction="wrap" density="compact">
              <${Action} kind="primary" onClick=${() => saveGhiiCors(corsEditGhii)}>${t('profile.security.save')}<//>
              <${Action} tone="danger" onClick=${() => saveGhiiCors('')}>${t('profile.security.reset')}<//>
              <${Action} kind="text" onClick=${() => setCorsEditGhii(null)}>${t('profile.cancel')}<//>
            <//>
          ` : html`<${Stack} direction="horizontal" align="start">
            <${Action} onClick=${() => setCorsEditGhii(ghii.allowed_origins ? ghii.allowed_origins.join('\\n') : '')}>${t('profile.security.edit')}<//>
          <//>`}
        <//>
      <//>

      <${Section} title=${t('profile.security.agentsTitle')} description=${t('profile.security.agentsDesc')} count=${agentsCors.length || undefined}>
        ${agentsCors.length === 0
          ? html`<${Surface} kind="aside"><${Text} tone="muted">${t('profile.security.noAgents')}<//><//>`
          : html`<${Table} collapse="640" label=${t('profile.security.agentsTitle')}
              headers=${[t('profile.security.agent'), t('profile.security.origins'), t('profile.security.status'), '']}
              rows=${agentsCors.map(ac => {
                const agentName = (ac.gaii || '').split('#')[0] || ac.gaii;
                const hasCustom = ac.allowed_origins !== null && ac.allowed_origins !== undefined;
                const isEditing = corsEditAgent && corsEditAgent.name === agentName;
                return [
                  html`<${Text} kind="mono" tone="coral">${escHtml(agentName)}<//>`,
                  isEditing
                    ? html`<${Field} type="textarea" rows="2" ariaLabel=${t('profile.security.origins')}
                        value=${corsEditAgent.value}
                        onInput=${e => setCorsEditAgent({ name: agentName, value: e.target.value })} />`
                    : html`<${Text} kind="caption">${hasCustom ? (ac.allowed_origins || []).join(', ') : (ac.effective || []).join(', ')}<//>`,
                  hasCustom
                    ? html`<${Chip} tone="success">${t('profile.security.custom')}<//>`
                    : html`<${Chip} tone="muted">${t('profile.security.inheritedFrom')}: ${ac.inherited_from || t('profile.security.nodeDefault')}<//>`,
                  isEditing
                    ? html`<${Stack} direction="wrap" density="compact">
                        <${Action} onClick=${() => saveAgentCors(agentName, corsEditAgent.value)}>${t('profile.security.save')}<//>
                        <${Action} tone="danger" onClick=${() => saveAgentCors(agentName, '')}>${t('profile.security.reset')}<//>
                        <${Action} kind="text" onClick=${() => setCorsEditAgent(null)}>${t('profile.cancel')}<//>
                      <//>`
                    : html`<${Action} onClick=${() => setCorsEditAgent({ name: agentName, value: hasCustom ? (ac.allowed_origins || []).join('\\n') : '' })}>${t('profile.security.edit')}<//>`,
                ];
              })} />`}
      <//>

      <${Section} title=${t('profile.security.inheritanceTitle')}>
        <${Stack} density="compact">
          <${Text} kind="caption" tone="muted">${t('profile.security.inheritanceDesc')}<//>
          <${Text} kind="mono" tone="coral">Memory key \u2192 Agent \u2192 GHII (your account) \u2192 Node default<//>
        <//>
      <//>
    <//>

    <${ConfirmUI} />
  <//>`;
}
