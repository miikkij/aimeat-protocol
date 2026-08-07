/**
 * @file AgentConsent.js
 * @description The agent-approval consent panel — ONE source, mounted in two places
 *   (aimeat_remake/06-koti-feed-suostumus.md, E7). An agent asks to join by device authorization
 *   (RFC 8628); the account holder sees the request here, picks how much it may do, and approves
 *   or refuses.
 *
 *   It is a shared component rather than two copies on purpose. The approval also lives in the
 *   old profile Agents tab, for every agent after the first, and a copied panel would drift: one
 *   of the two would get the fix and the other would quietly keep the bug. A fix here shows up in
 *   both without a second edit — which is the acceptance criterion for the remake's step 2.
 *
 *   The protocol is untouched. This renders the same approval the Agents tab always did, in a
 *   second place, because the first agent arrives while the person is still in onboarding and
 *   sending them to a settings tab to finish is where the old path lost them.
 * @structure AgentConsent({ requests, onApprove, onDeny, busyCode, variant })
 *   - variant 'inline' (default, the profile tab) · 'step' (the home, with the fuller explanation)
 * @usage
 *   import { AgentConsent } from '/components/AgentConsent.js';
 *   html`<${AgentConsent} requests=${pending} onApprove=${fn} onDeny=${fn} />`
 * @version-history
 *   v1.0.0 — 2026-08-07 — Extracted from views/profile/agents-tab.js so the home and the profile
 *     render the same panel (remake phase 4, E7).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { SCOPE_TEMPLATES, templateLabel } from '/views/profile/agents/scope-config.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** mm:ss left before the request expires. Device codes are short-lived by design. */
function countdown(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * One pending request, with its scope choice.
 * @param {{ req: any, onApprove: (code: string, scopes: string[]) => void,
 *   onDeny: (code: string) => void, busy: boolean, variant: string }} props
 */
function ConsentCard({ req, onApprove, onDeny, busy, variant }) {
  const [expanded, setExpanded] = useState(false);
  const [preset, setPreset] = useState('standard');

  return html`
    <div class="card mt-1 p-1 agc-card" key=${req.user_code}>
      <div class="flex-row mb-half">
        <span class="badge badge-info">${t('profile.agents.pendingRequests.waiting')}</span>
        <span class="text-caption">
          ${t('profile.agents.pendingRequests.expiresIn')}: ${countdown(req.expires_in)}
        </span>
      </div>

      <div class="mb-half">
        <div class="text-caption mb-half">${t('profile.agents.pendingRequests.agentName')}</div>
        <div class="text-bold">
          ${escHtml(req.agent_name)}${req.display_name ? ` (${escHtml(req.display_name)})` : ''}
        </div>
      </div>

      <div class="mb-half">
        <div class="text-caption mb-half">${t('profile.agents.pendingRequests.code')}</div>
        <div class="pf-device-code">${req.user_code}</div>
      </div>

      ${variant === 'step' && html`
        <p class="text-caption agc-explain">
          ${tr('agentConsent.explain', 'Approving lets this AI read and write things in your home on your behalf. You choose how much it may do, and you can change it or remove the agent at any time.')}
        </p>`}

      ${expanded ? html`
        <div class="mb-half">
          <div class="text-caption mb-half">${t('profile.agents.pendingRequests.scopeLevel')}</div>
          <div class="flex-row pf-scope-presets">
            ${['readonly', 'standard', 'full'].map(p => html`
              <button type="button" key=${p}
                class="${preset === p ? 'btn-primary' : 'btn-outline'} pf-scope-preset-btn"
                onClick=${() => setPreset(p)}>
                ${templateLabel(p)}
              </button>`)}
          </div>
        </div>
        <div class="flex-row mt-1">
          <button type="button" class="btn-success" disabled=${busy}
            onClick=${() => onApprove(req.user_code, SCOPE_TEMPLATES[preset] || SCOPE_TEMPLATES.standard)}>
            ${t('profile.agents.pendingRequests.confirmApprove')}
          </button>
          <button type="button" class="btn-outline" onClick=${() => setExpanded(false)}>
            ${t('profile.agents.pendingRequests.cancel')}
          </button>
        </div>
      ` : html`
        <div class="flex-row mt-1">
          <button type="button" class="btn-success" disabled=${busy} onClick=${() => setExpanded(true)}>
            ${t('profile.agents.pendingRequests.approve')}
          </button>
          <button type="button" class="btn-danger-solid" disabled=${busy} onClick=${() => onDeny(req.user_code)}>
            ${t('profile.agents.pendingRequests.deny')}
          </button>
        </div>`}
    </div>`;
}

/**
 * The consent panel. Renders nothing when there is nothing to approve, so a caller can mount it
 * unconditionally.
 * @param {{ requests?: any[], onApprove: (code: string, scopes: string[]) => void,
 *   onDeny: (code: string) => void, busyCode?: string|null, variant?: 'inline'|'step' }} props
 */
export function AgentConsent({ requests, onApprove, onDeny, busyCode = null, variant = 'inline' }) {
  const list = Array.isArray(requests) ? requests : [];
  if (!list.length) return null;
  return html`
    <div class=${variant === 'step' ? 'agc agc-step' : 'agent-cta mb-1 agc'}>
      <div class="section-title">${t('profile.agents.pendingRequests.title')}</div>
      <p>${t('profile.agents.pendingRequests.desc')}</p>
      ${list.map(req => html`
        <${ConsentCard} key=${req.user_code} req=${req} variant=${variant}
          busy=${busyCode === req.user_code}
          onApprove=${onApprove} onDeny=${onDeny} />`)}
    </div>`;
}
