/**
 * @file public/views/home/journey.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Choose useful work, connect an AI, copy the task and see the saved note at home.
 * @version-history
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
    <section class="koti-journey" aria-labelledby="home-journey-title">
      <h2 id="home-journey-title" class="koti-band-title">${t('homeJourney.title')}</h2>
      <p>${t(connected ? 'homeJourney.returning' : 'homeJourney.welcome')}</p>
      <div class="koti-journey-choices" role="group" aria-label=${t('homeJourney.title')}>
        ${actions.map(id => html`<button type="button" key=${id} class="btn-outline"
          aria-pressed=${action === id} onClick=${() => {
            setAction(id); setCopied(false);
            try { sessionStorage.setItem(choiceKey, id); }
            catch (e) { swallowed('home journey: choice write', e); }
          }}>
          ${t('homeJourney.' + id)}
        </button>`)}
      </div>
      <p class="koti-hint">${t('homeJourney.' + action + 'Hint')}</p>
      <div class="koti-journey-status" role="status">
        <span>${t(connected ? 'homeJourney.connected' : 'homeJourney.notConnected')}</span>
        <button type="button" class=${connected ? 'btn-ghost' : 'btn-primary'}
          aria-expanded=${connecting} onClick=${() => setConnecting(v => !v)}>
          ${t(connecting ? 'homeJourney.hideConnection' : connected ? 'homeJourney.anotherAi' : 'homeJourney.connect')}
        </button>
      </div>
      ${connecting && html`<div class="koti-journey-connect">
        <p>${t('homeJourney.consent')}</p>
        <${McpSetupGuide} />
        <h3>${t('homeJourney.prove')}</h3>
        <p>${t('homeJourney.proveHint')}</p>
        <${PromptCard} label=${t('homeJourney.prove')} prompt=${proof?.prompt || ''}
          copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')} />
        <button type="button" class="btn-outline" onClick=${refresh}>${t('homeJourney.check')}</button>
        <details class="koti-journey-details"><summary>${t('homeJourney.deviceFlow')}</summary>
          <${StepAgent} onChanged=${refresh} showToast=${setMessage} />
        </details>
      </div>`}
      <div class="koti-journey-task">
        <p>${t('homeJourney.copyHint')}</p>
        <${PromptCard} key=${action} label=${t('homeJourney.' + action)} prompt=${prompt}
          className=${connected ? 'btn-primary' : 'btn-outline'}
          copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')}
          onCopied=${() => setCopied(true)} />
        ${copied && html`<p role="status">${t('homeJourney.copied')}</p>`}
        <div class="koti-journey-links">
          <button type="button" class="btn-ghost" onClick=${refresh}>${t('homeJourney.checkResult')}</button>
          <a class="koti-link" href=${'/v1/profile?tab=' + targets[action]}>${t('homeJourney.open' + action)} →</a>
          ${chat?.enabled && html`<a class="koti-link" href="/v1/chat">${t('homeJourney.localChat')} →</a>`}
        </div>
        ${ready && saved && html`<div class="koti-journey-result" role="status">
          <h3>${t('homeJourney.saved')}</h3>
          ${typeof note.title === 'string' && html`<strong>${note.title}</strong>`}
          <p>${note.text}</p>
          <p class="koti-hint">${t('homeJourney.noteLifecycle')}</p>
        </div>`}
        ${copied && action === 'note' && ready && !saved && html`<p>${t('homeJourney.waiting')}</p>`}
      </div>
      <details class="koti-journey-details"><summary>${t('homeJourney.optionalPage')}</summary>
        <p>${t('homeJourney.optionalPageHint')}</p>
        ${state.mat.done
          ? html`<a class="koti-link" href=${state.mat.standaloneUrl || state.mat.url}>${t('home.mat.view')} →</a>`
          : html`<${StepMat} onDone=${refresh} />`}
      </details>
      ${message && html`<p role="alert">${message}</p>`}
    </section>`;
}
