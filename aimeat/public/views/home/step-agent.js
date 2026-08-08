/**
 * @file public/views/home/step-agent.js
 * @description Step 2 of the home path: connect your first agent (aimeat_remake/
 *   02-kayttajapolut.md, branch A). This is where the person turns the AI they already talk to
 *   into something that can reach their home directly, instead of copying text back and forth.
 *
 *   Three things the old path did not do, and this does:
 *     - it says what an "agent" means HERE, in one sentence, before asking for anything;
 *     - the approval is shown right here, using the SAME shared component the profile Agents tab
 *       renders (components/AgentConsent.js) — the first agent arrives while the person is still
 *       in onboarding, and sending them to a settings tab to finish is where the old path lost
 *       them;
 *     - there is a WAITING STATE. Between pasting the prompt and the agent knocking, the ball is
 *       in the person's chat window, and a blank screen does not say so.
 * @structure StepAgent({ state, onChanged }) — the open step 2; AgentCard({ agent }) — the
 *   connected agent, shown on an initialised home with its details in a details/summary section.
 * @usage import { StepAgent } from './step-agent.js';
 * @version-history
 *   v1.1.0 — 2026-08-09 — The card says what the agent is actually doing, and the dot takes its
 *     colour from that. It printed "Connected and at home." unconditionally next to a dot that
 *     was green in CSS — about an agent the Agents tab could be calling a problem. It also says
 *     how many other agents there are, so one card cannot imply the fleet is one.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 4).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet, apiPost } from '/js/api.js';
import { PromptCard } from '/components/PromptCard.js';
import { AgentConsent } from '/components/AgentConsent.js';
import { swallowed } from '/js/swallowed.js';
import { useSession } from '/js/use-session.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** How often to look for a knock while the person is in their chat window. */
const POLL_MS = 4000;

/**
 * The prompt the person pastes into their AI chat. Node-served (/v1/prompts/agent-connect) so it
 * can be corrected without a browser release — same reason as the welcome-mat prompt.
 */
function useConnectPrompt(agentName) {
  const [prompt, setPrompt] = useState('');
  const [steps, setSteps] = useState([]);
  useEffect(() => {
    let alive = true;
    const q = agentName ? `?agent_name=${encodeURIComponent(agentName)}` : '';
    apiGet(`/v1/prompts/agent-connect${q}`)
      .then((r) => { if (alive) { setPrompt(r?.data?.prompt || ''); setSteps(r?.data?.steps || []); } })
      .catch((e) => swallowed('home/step-agent: prompt', e));
    return () => { alive = false; };
  }, [agentName]);
  return { prompt, steps };
}

export function StepAgent({ onChanged, showToast }) {
  const session = useSession();
  const [agentName, setAgentName] = useState('');
  const [named, setNamed] = useState(false);
  const [mode, setMode] = useState('prompt');       // 'prompt' | 'steps'
  const [pending, setPending] = useState([]);
  const [busyCode, setBusyCode] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const { prompt, steps } = useConnectPrompt(named ? agentName : '');
  const timer = useRef(null);

  const loadPending = useCallback(async () => {
    try {
      const r = await apiGet('/v1/agents/device-authorize/pending');
      setPending(r?.data?.requests ?? []);
    } catch (e) { swallowed('home/step-agent: pending', e); }
  }, []);

  // Poll only while the person is actually waiting for a knock — the request is short-lived and
  // the alternative is a screen that never changes while they sit in another window.
  useEffect(() => {
    if (!waiting) return undefined;
    loadPending();
    timer.current = setInterval(loadPending, POLL_MS);
    return () => clearInterval(timer.current);
  }, [waiting, loadPending]);

  useEffect(() => {
    const handler = () => loadPending();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadPending]);

  const approve = useCallback(async (userCode, scopes) => {
    setBusyCode(userCode);
    try {
      // owner_token in the BODY, not just the Authorization header: /v1/agents/verify is reachable
      // from the standalone consent page too, so it verifies the approver's JWT itself rather than
      // trusting the session middleware.
      const resp = await apiPost('/v1/agents/verify', {
        user_code: userCode, action: 'approve', scopes, owner_token: session?.jwt,
      });
      if (resp?.ok === false) throw new Error(resp?.error?.message || 'approve failed');
      setPending(prev => prev.filter(r => r.user_code !== userCode));
      // Tell the node its owner just let their FIRST agent in — the funnel's first_agent_connected.
      await api('/v1/home/first-agent', { method: 'POST', body: JSON.stringify({ user_code: userCode }) })
        .catch(e => swallowed('home/step-agent: first-agent marker', e));
      onChanged();
    } catch (e) {
      showToast?.(e.message || String(e), true);
    } finally {
      setBusyCode(null);
    }
  }, [onChanged, showToast, session]);

  const deny = useCallback(async (userCode) => {
    setBusyCode(userCode);
    try {
      await apiPost('/v1/agents/verify', { user_code: userCode, action: 'deny', owner_token: session?.jwt });
      setPending(prev => prev.filter(r => r.user_code !== userCode));
    } catch (e) {
      showToast?.(e.message || String(e), true);
    } finally { setBusyCode(null); }
  }, [showToast, session]);

  const cleanName = agentName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

  return html`
    <div class="koti-step koti-step-open">
      <div class="koti-step-head">
        <span class="koti-step-num">2</span>
        <h2 class="koti-step-title">${tr('home.agent.title', 'Connect your first agent')}</h2>
      </div>

      <p class="koti-step-lede">
        ${tr('home.agent.lede', 'An agent here is simply the AI you already talk to, given a way into your home. Once it is connected it can read and write things for you directly, instead of you copying text back and forth. You decide what it may do, and you can take it back at any time.')}
      </p>

      ${!named ? html`
        <div class="koti-name">
          <label class="koti-paste-label" for="koti-agent-name">
            ${tr('home.agent.nameLabel', 'Give your agent a name')}
          </label>
          <p class="koti-hint">${tr('home.agent.nameHint', 'Whatever you will recognise it by. Lower-case letters, numbers and dashes.')}</p>
          <input
            id="koti-agent-name"
            class="koti-input"
            type="text"
            autocomplete="off"
            maxlength="40"
            placeholder=${tr('home.agent.namePlaceholder', 'claude')}
            value=${agentName}
            onInput=${(e) => setAgentName(e.target.value)} />
          <div class="koti-actions">
            <button type="button" class=${cleanName ? 'btn-primary' : 'btn-outline'}
              disabled=${!cleanName}
              onClick=${() => { setAgentName(cleanName); setNamed(true); }}>
              ${tr('home.agent.nameSubmit', 'That is its name')}
            </button>
          </div>
        </div>
      ` : html`
        <div class="koti-named">
          <span class="koti-named-label">${tr('home.agent.named', 'Your agent is called')}</span>
          <strong class="koti-named-value">${agentName}</strong>
          <button type="button" class="btn-ghost koti-rename" onClick=${() => { setNamed(false); setWaiting(false); }}>
            ${tr('home.agent.rename', 'Change it')}
          </button>
        </div>

        <div class="koti-modes" role="tablist">
          <button type="button" role="tab" aria-selected=${mode === 'prompt'}
            class=${mode === 'prompt' ? 'btn-outline koti-mode-on' : 'btn-ghost'}
            onClick=${() => setMode('prompt')}>
            ${tr('home.agent.modePrompt', 'Give it a prompt')}
          </button>
          <button type="button" role="tab" aria-selected=${mode === 'steps'}
            class=${mode === 'steps' ? 'btn-outline koti-mode-on' : 'btn-ghost'}
            onClick=${() => setMode('steps')}>
            ${tr('home.agent.modeSteps', 'Do it step by step')}
          </button>
        </div>

        ${mode === 'prompt' ? html`
          <${PromptCard}
            label=${tr('home.agent.promptLabel', 'The prompt')}
            prompt=${prompt}
            className=${waiting ? 'btn-outline' : 'btn-primary'}
            copyLabel=${tr('home.agent.copy', 'Copy the prompt')}
            copiedLabel=${tr('home.agent.copied', 'Copied — paste it in your AI chat')}
            onCopied=${() => setWaiting(true)} />
        ` : html`
          <ol class="koti-manual">
            ${steps.map((s, i) => html`<li key=${i} class="koti-manual-step">${s}</li>`)}
          </ol>
          <div class="koti-actions">
            <button type="button" class=${waiting ? 'btn-outline' : 'btn-primary'} onClick=${() => setWaiting(true)}>
              ${tr('home.agent.doneManual', 'I have started it')}
            </button>
          </div>`}

        ${waiting && pending.length === 0 && html`
          <div class="koti-waiting" role="status">
            <div class="koti-waiting-dot" aria-hidden="true"></div>
            <div>
              <p class="koti-waiting-title">${tr('home.agent.waitTitle', 'Waiting for your agent to knock.')}</p>
              <p class="koti-waiting-body">
                ${tr('home.agent.waitBody', 'The next move is in your AI chat: it has to run the prompt and show you a code. When it does, its request appears here and you approve it.')}
              </p>
            </div>
          </div>`}

        ${/* The SAME component the profile Agents tab renders — one source, two places. */''}
        <${AgentConsent} requests=${pending} onApprove=${approve} onDeny=${deny}
          busyCode=${busyCode} variant="step" />
      `}
    </div>`;
}

/**
 * How the home describes an agent's state. The same six states the Agents tab uses, in words that
 * fit a home rather than a dashboard.
 *
 * This card used to print "Connected and at home." unconditionally, next to a dot that was green in
 * CSS — about an agent the Agents tab was calling a problem, one click away. It now renders the
 * verdict the server computed (services/agent-health.ts), which is the same one that tab renders.
 */
const STATE_TEXT = {
  production: ['home.agent.stateProduction', 'Connected and at home.'],
  idle: ['home.agent.stateIdle', 'Here, but quiet just now.'],
  onboarding: ['home.agent.stateOnboarding', 'Settling in.'],
  new: ['home.agent.stateNew', 'Just arrived — it has not started yet.'],
  problem: ['home.agent.stateProblem', 'Something is wrong with it.'],
  system: ['home.agent.stateSystem', 'Part of the house.'],
};

/** The connected agent on an initialised home: a card, with its details below it. */
export function AgentCard({ agent }) {
  const [open, setOpen] = useState(false);
  if (!agent) return null;
  const state = agent.health?.state ?? 'production';
  const [subKey, subFallback] = STATE_TEXT[state] ?? STATE_TEXT.production;
  const others = (agent.total ?? 1) - 1;
  return html`
    <div class="koti-agent-card">
      <div class="koti-agent-head">
        <span class="koti-agent-dot koti-agent-dot--${state}" aria-hidden="true"></span>
        <div>
          <div class="koti-agent-name">${agent.name}</div>
          <div class="koti-agent-sub">${tr(subKey, subFallback)}</div>
          ${others > 0 && html`
            <div class="koti-agent-sub">
              ${agent.problems > 0
                ? tr('home.agent.othersProblem', `${others} more, ${agent.problems} needing attention.`)
                    .replace('{count}', String(others)).replace('{problems}', String(agent.problems))
                : tr('home.agent.othersOk', `${others} more, all fine.`).replace('{count}', String(others))}
            </div>`}
        </div>
      </div>
      <button type="button" class="btn-ghost koti-agent-toggle" aria-expanded=${open}
        onClick=${() => setOpen(v => !v)}>
        ${open ? tr('home.agent.hideDetails', 'Hide details') : tr('home.agent.showDetails', 'Details')}
      </button>
      ${open && html`
        <dl class="koti-agent-details">
          <dt>${tr('home.agent.dtId', 'Its identifier')}</dt>
          <dd class="koti-agent-gaii">${agent.gaii}</dd>
          ${agent.connectedAt && html`
            <dt>${tr('home.agent.dtSince', 'Connected')}</dt>
            <dd>${new Date(agent.connectedAt).toLocaleString()}</dd>`}
        </dl>
        <a class="btn-outline koti-agent-manage" href="/v1/profile?tab=agents">
          ${tr('home.agent.manage', 'Manage what it may do')}
        </a>`}
    </div>`;
}
