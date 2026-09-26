/**
 * @file security-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for CORS origin management (GHII + per-agent): which web addresses may
 *   reach the account's API. Operator-only in the menu (the Infrastructure group).
 * @version-history
 *   v1.21.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.20.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.19.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.18.0 -- 2026-09-25 -- A node's agents, the CORS chain, the ecosystem's identifiers and its pairing code are inline code (.code-inline); their own mono looks go (a unification: the look most tabs use).
 *   v1.17.0 -- 2026-09-25 -- The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.16.0 -- 2026-09-25 -- A table of rows is the Listing (css/components/listing.css): the P&L lines, the accountants, the usage report, the AI spend per app, the security overrides and an agent's internal jobs; figures stand at the right of their column (a unification: the look most tabs use).
 *   v1.15.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.13.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.12.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.11.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.10.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.9.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.8.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.7.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { LoadingLine } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as securityService from '/js/services/security.js';
import { listAgents } from '/js/services/agents.js';
import { swallowed } from '/js/swallowed.js';
import { Hint } from '/components/Hint.js';

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

  if (loading || !securityData) return html`<${LoadingLine} text=${t('profile.security.loading')} />`;

  const ghii = securityData.ghii || {};
  const agentsCors = securityData.agents || [];
  const isInherited = ghii.inherited !== false;
  const effectiveOrigins = ghii.effective || [];

  return html`
    <div class="og mb-1">
      <div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuInfra')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.security')}</span></div>
      <div class="og-mast"><div class="og-mast-words">
        <div class="og-title poster-page-title">${t('profile.security.title')}</div>
        <div class="og-desc">${t('profile.security.desc')}</div>
      </div></div>
    </div>

    ${securityData.managedBy && html`
      <div class="card mb-1 poster-row--thing">
        <span class="sub-heading">${t('profile.security.managedTitle')}</span>
        <p class="poster-hint mb-0">${t('profile.security.managedDesc').replace('{name}', securityData.managedBy.name)}</p>
      </div>
    `}

    <p class="poster-hint mb-1">${t('profile.security.signInMoved')}</p>

    <h3 class="card-h3 sub-heading mt-section">${t('profile.security.ghiiTitle')}</h3>
    <p class="poster-hint mb-1">${t('profile.security.ghiiDesc')}</p>
    <div class="card poster-row--thing">
      <div class="flex-between mb-half">
        <span class="sub-heading">${t('profile.security.allowedOrigins')}</span>
        <span class=${`poster-chip ${isInherited ? '' : 'poster-chip--ink'}`}>${isInherited ? t('profile.security.inherited') : t('profile.security.custom')}</span>
      </div>
      <div class="poster-hint mb-half">
        ${t('profile.security.effective')}: ${effectiveOrigins.includes('*') ? t('profile.security.wildcard') : effectiveOrigins.join(', ') || '-'}
      </div>
      ${corsEditGhii !== null ? html`
        <textarea class="og-textarea mb-half"
          placeholder=${t('profile.security.originsPlaceholder')}
          value=${corsEditGhii}
          onInput=${e => setCorsEditGhii(e.target.value)}></textarea>
        <div class="flex-row">
          <button class="poster-slab" onClick=${() => saveGhiiCors(corsEditGhii)}>${t('profile.security.save')}</button>
          <button class="poster-action poster-action--small poster-action--danger" onClick=${() => saveGhiiCors('')}>${t('profile.security.reset')}</button>
          <button class="poster-action poster-action--small" onClick=${() => setCorsEditGhii(null)}>${t('profile.cancel')}</button>
        </div>
      ` : html`
        <button class="poster-action poster-action--small" onClick=${() => setCorsEditGhii(ghii.allowed_origins ? ghii.allowed_origins.join('\\n') : '')}>${t('profile.security.edit')}</button>
      `}
    </div>

    <h3 class="card-h3 sub-heading mt-section">${t('profile.security.agentsTitle')}</h3>
    <p class="poster-hint mb-1">${t('profile.security.agentsDesc')}</p>
    ${agentsCors.length === 0
      ? html`<div class="poster-quiet">${t('profile.security.noAgents')}</div>`
      : html`<div class="card poster-row--thing">
          <div class="listing listing--name-desc-state-doors">
            <div class="listing-row listing-row--head">
              ${[t('profile.security.agent'), t('profile.security.origins'), t('profile.security.status'), ''].map(hd => html`<div class="poster-label">${hd}</div>`)}
            </div>
            ${agentsCors.map(ac => {
              const agentName = (ac.gaii || '').split('#')[0] || ac.gaii;
              const hasCustom = ac.allowed_origins !== null && ac.allowed_origins !== undefined;
              const isEditing = corsEditAgent && corsEditAgent.name === agentName;
              return html`<div class="listing-row" key=${agentName}>
                <div class="listing-name">${escHtml(agentName)}</div>
                ${isEditing
                  ? html`<div><textarea class="og-textarea pf-textarea-sm"
                      value=${corsEditAgent.value}
                      onInput=${e => setCorsEditAgent({name: agentName, value: e.target.value})}></textarea></div>`
                  : html`<div class="listing-desc">${hasCustom ? (ac.allowed_origins || []).join(', ') : (ac.effective || []).join(', ')}</div>`}
                <div>${hasCustom
                  ? html`<span class="poster-chip poster-chip--ink">${t('profile.security.custom')}</span>`
                  : html`<span class="poster-chip">${t('profile.security.inheritedFrom')}: ${ac.inherited_from || t('profile.security.nodeDefault')}</span>`}</div>
                <div class="listing-doors">${isEditing
                  ? html`
                      <button class="poster-slab poster-slab--control" onClick=${() => saveAgentCors(agentName, corsEditAgent.value)}>${t('profile.security.save')}</button>
                      <button class="poster-action poster-action--small poster-action--row poster-action--danger" onClick=${() => saveAgentCors(agentName, '')}>${t('profile.security.reset')}</button>
                      <button class="poster-action poster-action--small poster-action--row" onClick=${() => setCorsEditAgent(null)}>${t('profile.cancel')}</button>`
                  : html`<button class="poster-action poster-action--small poster-action--row" onClick=${() => setCorsEditAgent({name: agentName, value: hasCustom ? (ac.allowed_origins || []).join('\\n') : ''})}>${t('profile.security.edit')}</button>`}</div>
              </div>`;
            })}
          </div>
        </div>`
    }

    <h3 class="card-h3 sub-heading mt-section">${t('profile.security.inheritanceTitle')}</h3>
    <div class="card poster-row--thing">
      <${Hint}>${t('profile.security.inheritanceDesc')}<//>
      <div class="mt-xs"><code class="code-inline">
        Memory key \u2192 Agent \u2192 GHII (your account) \u2192 Node default
      </code></div>
    </div>

    <${ConfirmUI} />
  `;
}
