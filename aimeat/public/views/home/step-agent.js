/**
 * @file public/views/home/step-agent.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 * @structure StepAgent({ state, onChanged }) — the open step 2.
 * @usage import { StepAgent } from './step-agent.js';
 * @version-history
 *   2026-09-23: AgentCard deleted (Jouni's decision): no page had drawn it since eaf81e18c
 *     (2026-08-18), when the one-line fleet summary took its place.
 *   2026-09-23: StepAgent is composed from library components (StepCard, StepLede, PasteLabel, Hint,
 *     TextInput, ActionRow, NamedValue, ModeTabs, StepList, WaitingNote), which emit the markup this
 *     file wrote. AgentCard stays as it was: no page mounts it (UI consolidation phase 1, a move).
 *   2026-09-23: Composed from the shared parts in css/parts.css and css/parts-steps.css (class names by role, values moved from views/home.css unchanged; UI consolidation slice 1).
 *   v1.3.0 — 2026-08-24 — The name the person gives is RECORDED (memory key `home.agent-name`,
 *     private), not just embedded in the connect prompt. Until now it lived only in this
 *     component's state, so the OAuth consent page — a different door into the same account —
 *     could not see it, asked for a name again, and a second agent could be born from one
 *     person's one intention. The consent page now prefills and preselects from this record,
 *     so the name is given once and both doors lead to the same agent.
 *   (2026-08-23) Em-dashes swept from the copied and state fallbacks (banned in every surface).
 *   v1.2.0 — 2026-08-16 — The card invites instead of alarming: "It has hit a snag. Shall we take
 *     a look?" and the fleet line stops reading out the damage count — the number of problems
 *     lives one click away, on the page that can act on it. A count of worries is not what
 *     anyone comes home to.
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
import { StepCard, StepLede } from '/components/StepCard.js';
import { PasteLabel } from '/components/PasteBox.js';
import { Hint } from '/components/Hint.js';
import { TextInput } from '/components/TextInput.js';
import { ActionRow } from '/components/ActionRow.js';
import { NamedValue } from '/components/NamedValue.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import { StepList } from '/components/StepList.js';
import { WaitingNote } from '/components/WaitingNote.js';
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
    <${StepCard} num="2" title=${tr('home.agent.title', 'Connect your first agent')}>

      <${StepLede}>
        ${tr('home.agent.lede', 'An agent here is simply the AI you already talk to, given a way into your home. Once it is connected it can read and write things for you directly, instead of you copying text back and forth. You decide what it may do, and you can take it back at any time.')}
      <//>

      ${!named ? html`
        ${/* This wrapper wears the masthead's name class, as it did before the library. Found,
              not fixed: a visible change needs Jouni's decision (UI consolidation phase 1). */''}
        <div class="poster-masthead-name">
          <${PasteLabel} htmlFor="koti-agent-name">
            ${tr('home.agent.nameLabel', 'Give your agent a name')}
          <//>
          <${Hint}>${tr('home.agent.nameHint', 'Whatever you will recognise it by. Lower-case letters, numbers and dashes.')}<//>
          <${TextInput}
            id="koti-agent-name"
            maxLength="40"
            placeholder=${tr('home.agent.namePlaceholder', 'claude')}
            value=${agentName}
            onInput=${(e) => setAgentName(e.target.value)} />
          <${ActionRow}>
            <button type="button" class=${cleanName ? 'poster-slab' : 'btn-outline'}
              disabled=${!cleanName}
              onClick=${() => {
                setAgentName(cleanName); setNamed(true);
                // Record the name where OTHER doors can see it: the OAuth consent page (a
                // connector arriving before this prompt is ever pasted) prefills from this key,
                // so one intention cannot become two agents. Overwritten on rename; the agent
                // itself is still only ever created through an approval.
                api('/v1/memory', { method: 'POST', body: JSON.stringify({
                  key: 'home.agent-name',
                  value: { name: cleanName, recordedAt: new Date().toISOString(), source: 'home-step-agent' },
                  visibility: 'private',
                }) }).catch((e) => swallowed('home/step-agent: name record', e));
              }}>
              ${tr('home.agent.nameSubmit', 'That is its name')}
            </button>
          <//>
        </div>
      ` : html`
        <${NamedValue} label=${tr('home.agent.named', 'Your agent is called')} value=${agentName}
          renameLabel=${tr('home.agent.rename', 'Change it')}
          onRename=${() => { setNamed(false); setWaiting(false); }} />

        <${ModeTabs}>
          <${ModeTab} on=${mode === 'prompt'} onClick=${() => setMode('prompt')}>
            ${tr('home.agent.modePrompt', 'Give it a prompt')}
          <//>
          <${ModeTab} on=${mode === 'steps'} onClick=${() => setMode('steps')}>
            ${tr('home.agent.modeSteps', 'Do it step by step')}
          <//>
        <//>

        ${mode === 'prompt' ? html`
          <${PromptCard}
            label=${tr('home.agent.promptLabel', 'The prompt')}
            prompt=${prompt}
            className=${waiting ? 'btn-outline' : 'poster-slab'}
            copyLabel=${tr('home.agent.copy', 'Copy the prompt')}
            copiedLabel=${tr('home.agent.copied', 'Copied. Paste it in your AI chat')}
            onCopied=${() => setWaiting(true)} />
        ` : html`
          <${StepList} steps=${steps} />
          <${ActionRow}>
            <button type="button" class=${waiting ? 'btn-outline' : 'poster-slab'} onClick=${() => setWaiting(true)}>
              ${tr('home.agent.doneManual', 'I have started it')}
            </button>
          <//>`}

        ${waiting && pending.length === 0 && html`
          <${WaitingNote} title=${tr('home.agent.waitTitle', 'Waiting for your agent to knock.')}>
            ${tr('home.agent.waitBody', 'The next move is in your AI chat: it has to run the prompt and show you a code. When it does, its request appears here and you approve it.')}
          <//>`}

        ${/* The SAME component the profile Agents tab renders — one source, two places. */''}
        <${AgentConsent} requests=${pending} onApprove=${approve} onDeny=${deny}
          busyCode=${busyCode} variant="step" />
      `}
    <//>`;
}
