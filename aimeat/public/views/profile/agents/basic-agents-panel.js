/**
 * @file public/views/profile/agents/basic-agents-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "create my basic agents" panel: one button, three working agents.
 *
 *   It exists because the alternative is the road every other agent takes — install a connector,
 *   run a command, paste a prompt into a chat, approve a code — and someone who has just arrived
 *   should be able to have agents before learning any of that.
 *
 *   THE ONE PRECONDITION IS STATED UP FRONT, not discovered by pressing. The agents run in the
 *   person's own `aimeat connect serve`, so with nothing connected there is nothing to run them; the
 *   panel says that and disables the button rather than letting the press fail. The state comes from
 *   the node (GET /v1/agents/v2/basic-agents), which is also where the SET is defined — this panel
 *   carries no list of its own, so the three names can change on the node without touching it.
 *
 * @structure BasicAgentsPanel({ session, showToast, onCreated })
 * @usage <${BasicAgentsPanel} session=${session} showToast=${showToast} onCreated=${loadData} />
 * @version-history
 *   2026-09-03 — An `emphasis` prop so the Agents section can render the button as an outline, and
 *     the acts-alone notice agrees with itself when there is one name. Default unchanged.
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { areaLine } from '/js/consent-vocab.js';

/** The plug icon: what "your connector is connected" looks like without a word for it. */
const PlugIcon = html`<svg class="pf-agd-basic-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v6"></path><path d="M15 2v6"></path><path d="M6 8h12v4a6 6 0 0 1-12 0z"></path><path d="M12 18v4"></path></svg>`;

/** `emphasis`: 'secondary' renders the create button as an outline. The Agents section shows this
 *  card beside a warning whose button is the page's one live action, and two primary buttons —
 *  both disabled while the connector is down — made the two loudest controls the two that do
 *  nothing. Omitted everywhere else, so the Agents tab is unchanged. */
export default function BasicAgentsPanel({ session, showToast, onCreated, emphasis }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  // Open while there is still something to press. What each agent gets, and which of them start
  // work without asking, is what the person is agreeing to — so it is on the screen at the moment
  // they decide, not one click away. Once they all exist it collapses back to a summary.
  const [expanded, setExpanded] = useState(null);

  async function load() {
    try {
      const resp = await apiGet('/v1/agents/v2/basic-agents');
      setState(resp?.data ?? null);
    } catch (err) { swallowed('basic-agents-panel: load', err); setState(null); }
  }

  useEffect(() => { if (session) load(); }, [session]);

  // The connector connecting or dropping is an `agents` change, so this panel re-reads on the same
  // event the fleet list does — otherwise the button would still say "not connected" a minute after
  // the person started their connector.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail?.domains;
      if (d && !d.has('agents')) return;
      loadRef.current();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function create() {
    setBusy(true);
    try {
      const resp = await apiPost('/v1/agents/v2/basic-agents', {});
      const made = resp?.data?.enrolled?.length ?? 0;
      showToast(made > 0
        ? t('profile.agents.basic.done').replace('{count}', String(made))
        : t('profile.agents.basic.alreadyThere'));
      await load();
      onCreated?.();
    } catch (err) {
      showToast(err?.message || t('profile.agents.basic.failed'), true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const missing = (state.agents ?? []).filter(a => !a.exists || !a.enrolled);
  const allThere = missing.length === 0;
  const connected = state.daemon_connected === true;
  const open = expanded === null ? !allThere : expanded;
  // `task-runner` is, in the node's own words, "the person saying start without asking me each
  // time" — services/agent-task-rules.ts activates a queued task for one without the owner. That
  // is the single most consequential thing about this button, so it is named rather than left in
  // a mode string nobody outside the code reads.
  const actsAlone = (state.agents ?? []).filter(a => a.mode === 'task-runner');

  return html`
    <div class="pf-agd-basic">
      <div class="pf-agd-basic-head">
        <div>
          <div class="pf-agd-basic-title">${t('profile.agents.basic.title')}</div>
          <div class="pf-agd-basic-desc">${t('profile.agents.basic.desc')}</div>
        </div>
        ${allThere
          ? html`<span class="pf-agd-basic-state">${t('profile.agents.basic.allThere')}</span>`
          : html`<button class="${emphasis === 'secondary' ? 'btn-outline' : 'btn-primary'} btn-sm" disabled=${!connected || busy} onClick=${create}>
              ${busy ? t('profile.agents.basic.working') : t('profile.agents.basic.button')}
            </button>`}
      </div>

      <div class="pf-agd-basic-status ${connected ? 'is-connected' : 'is-offline'}">
        ${PlugIcon}
        <span>${connected ? t('profile.agents.basic.connected') : t('profile.agents.basic.notConnected')}</span>
      </div>
      ${!connected && html`<div class="pf-agd-basic-hint">${t('profile.agents.basic.notConnectedHint')}</div>`}

      <button class="expand-btn" onClick=${() => setExpanded(!open)}>
        <span>${t('profile.agents.basic.whatYouGet')}</span>
        <span class="pf-chevron ${open ? 'pf-chevron-open' : ''}">▼</span>
      </button>
      ${open && html`
        <ul class="pf-agd-basic-list">
          ${(state.agents ?? []).map(a => html`
            <li class="pf-agd-basic-item" key=${a.name}>
              <div class="pf-agd-basic-item-head">
                <span class="pf-agd-basic-name">${a.display_name || a.name}</span>
                <span class="pf-agd-badge pf-agd-badge--run pf-agd-badge--run-${a.run_mode}">
                  ${t(`profile.agents.runMode.${a.run_mode}`)}
                </span>
                ${a.mode === 'task-runner' && html`
                  <span class="pf-agd-basic-alone" title=${t('profile.agents.basic.actsAloneWhy')}>
                    ${t('profile.agents.basic.actsAlone')}
                  </span>`}
                ${a.enrolled && html`<span class="pf-agd-basic-have">${t('profile.agents.basic.have')}</span>`}
              </div>
              <div class="pf-agd-basic-item-desc">${a.description}</div>
              ${(a.scopes ?? []).length > 0 && html`
                <div class="pf-agd-basic-item-gets">
                  <span class="pf-agd-basic-gets-label">${t('profile.agents.basic.reaches')}</span>
                  <span>${areaLine(a.scopes, t)}</span>
                </div>`}
            </li>
          `)}
        </ul>
        ${actsAlone.length > 0 && html`
          <div class="pf-agd-basic-notice">
            ${/* One name took the plural verb: "Workflow manager start work as soon as it
                  arrives". The template was written for a list and there is usually one. */''}
            ${t(actsAlone.length === 1 ? 'profile.agents.basic.actsAloneNoticeOne' : 'profile.agents.basic.actsAloneNotice')
              .replace('{names}', actsAlone.map(a => a.display_name || a.name).join(', '))}
          </div>`}
      `}
    </div>
  `;
}
