/**
 * @file public/views/home/journey.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Choose useful work, connect an AI, copy the task and see the saved note at home.
 * @version-history
 *   2026-09-24: The setup guide's tools are tabs (Jouni's decision "Choice").
 *   2026-09-23: Composed from components/Chooser.js and Hint.js, which emit the markup this file
 *     wrote; what the chooser holds stays here (UI consolidation phase 1, a move).
 *   2026-09-23: Composed from the shared parts in css/parts.css and css/parts-steps.css (class names by role, values moved from views/home.css unchanged; UI consolidation slice 1).
 *   2026-09-13: Compose the existing home shapes with shared poster classes.
 *   v1.1.0 — 2026-09-12 — The lines the chosen task governs (hint, connection, prompt, links, result)
 *     sit in one .poster-chooser-panel; the optional webpage stays outside it.
 *   v1.0.1 — 2026-09-09 — Reuse the home's fold choices and underlined actions.
 *   v1.0.0 — 2026-09-09 — Shared journey for new and returning owners; optional personal webpage.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useSession } from '/js/use-session.js';
import { useShared, invalidateShared } from '/views/surface/shared-read.js';
import { useHomeState } from '/views/surface/home-state.js';
import { PromptCard } from '/components/PromptCard.js';
import { Hint } from '/components/Hint.js';
import {
  Chooser, ChooserChoices, ChooserChoice, ChooserPanel, ChooserStatus, ChooserBox, ChooserFold,
  ChooserLinks, ChooserResult,
} from '/components/Chooser.js';
import { McpSetupGuide } from '/views/profile/ai-setup-guide.js';
import { StepAgent } from './step-agent.js';
import { StepMat } from './step-mat.js';
import { swallowed } from '/js/swallowed.js';
import { buildJourneyPrompt, FIRST_NOTE_KEY } from './journey-prompts.js';

const html = htm.bind(h);
const notePath = `/v1/memory/${FIRST_NOTE_KEY}?soft=1`;
const actions = ['note', 'agent', 'schedule', 'app'];
const targets = { note: 'memory', agent: 'agents', schedule: 'scheduler', app: 'apps' };
const refresh = () => {
  invalidateShared('home-state', '/v1/home/state');
  invalidateShared('home-first-note', notePath);
};

export function HomeJourney() {
  const session = useSession();
  const { state } = useHomeState();
  const choiceKey = 'aimeat.home-task.' + session?.owner;
  const [action, setAction] = useState(() => {
    try { const stored = sessionStorage.getItem(choiceKey); return actions.includes(stored) ? stored : 'note'; }
    catch (e) { swallowed('home journey: choice read', e); return 'note'; }
  });
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const { data: record, ready } = useShared('home-first-note', notePath, ['memory']);
  const { data: proof } = useShared('home-proof-prompt', '/v1/prompts/hello-mcp?lang=en', []);
  const { data: chat } = useShared('chat-status', '/v1/chat/status', ['chat']);
  const { data: connection } = useShared('home-connection-proof', '/v1/memory/onboarding.hello_mcp?soft=1', ['memory']);
  const hasProof = !!connection && connection.exists !== false;
  useEffect(() => { if (hasProof) invalidateShared('home-state', '/v1/home/state'); }, [hasProof]);
  const note = record?.exists === false ? null : record?.value;
  const saved = typeof note?.text === 'string' && !!note.text.trim();
  if (!state || !session) return null;
  const connected = state.initialized;
  const prompt = buildJourneyPrompt(action, window.location.origin, session.owner);
  return html`
    <${Chooser} titleId="home-journey-title" title=${t('homeJourney.title')}
      lead=${t(connected ? 'homeJourney.returning' : 'homeJourney.welcome')}>
      <${ChooserChoices} label=${t('homeJourney.title')}>
        ${actions.map(id => html`<${ChooserChoice} key=${id} on=${action === id} onClick=${() => {
            setAction(id); setCopied(false);
            try { sessionStorage.setItem(choiceKey, id); }
            catch (e) { swallowed('home journey: choice write', e); }
          }}>
          ${t('homeJourney.' + id)}
        <//>`)}
      <//>
      <${ChooserPanel}>
      <${Hint}>${t('homeJourney.' + action + 'Hint')}<//>
      <${ChooserStatus}>
        <span>${t(connected ? 'homeJourney.connected' : 'homeJourney.notConnected')}</span>
        <button type="button" class="poster-action"
          aria-expanded=${connecting} onClick=${() => setConnecting(v => !v)}>
          ${t(connecting ? 'homeJourney.hideConnection' : connected ? 'homeJourney.anotherAi' : 'homeJourney.connect')}
        </button>
      <//>
      ${connecting && html`<${ChooserBox}>
        <p>${t('homeJourney.consent')}</p>
        <${McpSetupGuide} tabClass="poster-tab" activeClass="is-on" />
        <h3>${t('homeJourney.prove')}</h3>
        <p>${t('homeJourney.proveHint')}</p>
        <${PromptCard} label=${t('homeJourney.prove')} prompt=${proof?.prompt || ''} className="poster-action"
          copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')} />
        <button type="button" class="poster-action" onClick=${refresh}>${t('homeJourney.check')}</button>
        <${ChooserFold} summary=${t('homeJourney.deviceFlow')}>
          <${StepAgent} onChanged=${refresh} showToast=${setMessage} />
        <//>
      <//>`}
      <div>
        <p>${t('homeJourney.copyHint')}</p>
        <${PromptCard} key=${action} label=${t('homeJourney.' + action)} prompt=${prompt}
          className="poster-action"
          copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')}
          onCopied=${() => setCopied(true)} />
        ${copied && html`<p role="status">${t('homeJourney.copied')}</p>`}
        <${ChooserLinks}>
          <button type="button" class="poster-action" onClick=${refresh}>${t('homeJourney.checkResult')}</button>
          <a class="poster-action" href=${'/v1/profile?tab=' + targets[action]}>${t('homeJourney.open' + action)} →</a>
          ${chat?.enabled && html`<a class="poster-action" href="/v1/chat">${t('homeJourney.localChat')} →</a>`}
        <//>
        ${ready && saved && html`<${ChooserResult}>
          <h3>${t('homeJourney.saved')}</h3>
          ${typeof note.title === 'string' && html`<strong>${note.title}</strong>`}
          <p>${note.text}</p>
          <${Hint}>${t('homeJourney.noteLifecycle')}<//>
        <//>`}
        ${copied && action === 'note' && ready && !saved && html`<p>${t('homeJourney.waiting')}</p>`}
      </div>
      <//>
      <${ChooserFold} summary=${t('homeJourney.optionalPage')}>
        <p>${t('homeJourney.optionalPageHint')}</p>
        ${state.mat.done
          ? html`<a class="poster-action" href=${state.mat.standaloneUrl || state.mat.url}>${t('home.mat.view')} →</a>`
          : html`<${StepMat} onDone=${refresh} />`}
      <//>
      ${message && html`<p role="alert">${message}</p>`}
    <//>`;
}
