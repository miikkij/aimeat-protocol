/**
 * @file public/views/home/journey-roads.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two parts of the home that come before any task: the person's path in seven
 *   stages, and the first question, "Which AI do you use?", with its three roads in (guided
 *   journey P1 and P2, brief doc-mupor242l3cq).
 *
 *   The path is drawn from GET /v1/home/state `journey`, the same answer the person's AI reads at
 *   the end of its handbook. The road a person picks is their own word, so it is written into the
 *   memory record `journey.state` beside what their AI wrote there, never over it.
 *
 *   Composed only from the existing parts: NamedRow and CheckItem (the tried-so-far row), the
 *   Chooser, the setup guide, PromptCard, PasteBox and ErrorNote. Nothing here writes a class of
 *   its own.
 * @structure JourneyPath · RoadChooser · ConnectBox (moved from journey.js) · PromptRoad
 * @usage html`<${JourneyPath} journey=${journey} />  <${RoadChooser} journey=${journey} />`
 * @version-history
 *   v1.3.0 — 2026-10-03 — The road for an AI that cannot connect makes the profile: it offers the
 *     served welcome-mat interview prompt in the page's language (with its shorter fallback after a
 *     refused paste) and sends the answer to POST /v1/home/welcome-mat, which publishes the card and
 *     keeps the interview answers. The note prompt (buildPastePrompt) is no longer offered here.
 *   v1.2.0 — 2026-10-03 — The first result (the profile) links to the home's own task, not to Memory.
 *   v1.1.0 — 2026-10-01 — Jouni's review: the free road's claude.ai line names the free plan's model
 *     instead of Opus; the road is held by the home (it hides the task chooser on the prompt road);
 *     the prompt road shows the saved note itself, since the task chooser no longer has a note task.
 *   v1.0.0 — 2026-10-01 — Initial. ConnectBox is the connection block journey.js drew, unchanged.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { api } from '/js/api.js';
import { useShared, invalidateShared } from '/views/surface/shared-read.js';
import { useHomeState } from '/views/surface/home-state.js';
import { NamedRow } from '/components/NamedRow.js';
import { CheckItem } from '/components/CheckItem.js';
import { PromptCard } from '/components/PromptCard.js';
import { PasteBox } from '/components/PasteBox.js';
import { ErrorNote, ErrorNoteFallback } from '/components/ErrorNote.js';
import { Hint } from '/components/Hint.js';
import { Action } from '/components/Action.js';
import { ChooserChoices, ChooserChoice, ChooserBox, ChooserFold, ChooserLinks, ChooserResult } from '/components/Chooser.js';
import { McpSetupGuide } from '/views/profile/ai-setup-guide.js';
import { StepAgent } from './step-agent.js';
import { FIRST_NOTE_KEY } from './journey-prompts.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const JOURNEY_KEY = 'journey.state';
const ROADS = ['subscription', 'free', 'prompt'];
const ROAD_LABEL = { subscription: 'roadSubscription', free: 'roadFree', prompt: 'roadPrompt' };

/** Where each stage is looked after, so a stage in the row is a door as well as a mark. */
const STAGE_HREF = {
  ai: '/v1/home#home-roads',
  connect: '/v1/profile?tab=mcp',
  'first-result': '/v1/home#home-journey-title',
  organise: '/v1/profile?tab=organisms',
  apps: '/v1/appcat',
  agents: '/v1/profile?tab=agents',
  share: '/v1/profile?tab=organisms',
};
const stageKey = (id) => 'homeJourney.stage.' + (id === 'first-result' ? 'firstResult' : id);

export const refreshHome = () => {
  invalidateShared('home-state', '/v1/home/state');
  invalidateShared('home-first-note', `/v1/memory/${FIRST_NOTE_KEY}?soft=1`);
};

/** The seven stages, done or open, each a link to where it is looked after. */
export function JourneyPath({ journey }) {
  if (!journey?.stages?.length) return null;
  return html`
    <${NamedRow} label=${t('homeJourney.path')}>
      ${journey.stages.map((s) => html`
        <${CheckItem} key=${s.id} done=${s.done} href=${STAGE_HREF[s.id]}>${t(stageKey(s.id))}<//>`)}
    <//>`;
}

/** Write the chosen road into the person's record, keeping whatever their AI wrote there. */
async function saveRoad(road) {
  let current = {};
  try {
    const got = await api(`/v1/memory/${JOURNEY_KEY}?soft=1`);
    const value = got?.data?.value;
    if (value && typeof value === 'object') current = value;
  } catch (e) { swallowed('home journey: road read', e); }
  await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: JOURNEY_KEY, value: { ...current, road }, visibility: 'private' }) });
}

/** How to connect an AI and prove it: the block journey.js drew under "Connect my AI". */
export function ConnectBox({ onMessage, claudeNote = null }) {
  const { data: proof } = useShared('home-proof-prompt', '/v1/prompts/hello-mcp?lang=en', []);
  return html`<${ChooserBox}>
    <p>${t('homeJourney.consent')}</p>
    <${McpSetupGuide} poster claudeNote=${claudeNote} />
    <h3>${t('homeJourney.prove')}</h3>
    <p>${t('homeJourney.proveHint')}</p>
    <${PromptCard} label=${t('homeJourney.prove')} prompt=${proof?.prompt || ''} quiet
      copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')} />
    <${Action} onClick=${refreshHome}>${t('homeJourney.check')}<//>
    <${ChooserFold} summary=${t('homeJourney.deviceFlow')}>
      <${StepAgent} onChanged=${refreshHome} showToast=${onMessage} />
    <//>
  <//>`;
}

/** A refused paste in words, from the reason POST /v1/home/welcome-mat gives. */
function pasteRefusal(reason) {
  if (reason === 'empty') return t('home.mat.errEmpty');
  if (reason === 'empty_page') return t('home.mat.errEmptyPage');
  return t('home.mat.errGeneric');
}

/**
 * The road for an AI that cannot connect: the profile interview. The prompt is the served
 * GET /v1/prompts/welcome-mat in the page's language; the AI's answer (the card, with the private
 * answers block) is pasted back to POST /v1/home/welcome-mat, which publishes the card and keeps
 * the answers in `journey.state`. A refused paste keeps the text in the box.
 */
function PromptRoad() {
  const lang = getLocale();
  const { data: served } = useShared('home-profile-prompt-' + lang, `/v1/prompts/welcome-mat?lang=${encodeURIComponent(lang)}`, []);
  const { state } = useHomeState();
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [refusal, setRefusal] = useState('');
  const [shorter, setShorter] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim()) { setStatus(t('homeJourney.pasteEmpty')); return; }
    setBusy(true); setStatus(''); setRefusal('');
    try {
      const r = await api('/v1/home/welcome-mat', { method: 'POST', body: JSON.stringify({ paste: text }) });
      setText('');
      const answers = Array.isArray(r?.data?.profile_saved) && r.data.profile_saved.length > 0;
      setStatus(t('homeJourney.profilePasteSaved') + (answers ? ' ' + t('homeJourney.profileAnswersSaved') : ''));
      refreshHome();
    } catch (e) {
      // The text stays in the box: the person's AI may not write the same answer twice.
      setRefusal(pasteRefusal(e?.response?.error?.details?.reason));
    } finally {
      setBusy(false);
    }
  };
  const prompt = (shorter && served?.fallback_prompt) || served?.prompt || '';
  const mat = state?.mat;
  return html`<${ChooserBox}>
    <p>${t('homeJourney.profilePromptIntro')}</p>
    <${PromptCard} label=${t('homeJourney.profile')} prompt=${prompt} quiet
      copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')} />
    <${PasteBox} id="home-paste-profile" label=${t('homeJourney.pasteLabel')} rows="4" value=${text}
      placeholder=${t('home.mat.pastePlaceholder')}
      onInput=${(e) => setText(e.currentTarget.value)} />
    ${refusal && html`<${ErrorNote} text=${refusal} hint=${t('home.mat.errKept')}>
      ${served?.fallback_prompt && !shorter && html`<${ErrorNoteFallback} onClick=${() => setShorter(true)}>
        ${t('home.mat.tryShorter')}
      <//>`}
    <//>`}
    <${ChooserLinks}>
      <${Action} onClick=${save} disabled=${busy}>${busy ? t('home.mat.sending') : t('homeJourney.profilePasteSave')}<//>
    <//>
    ${status && html`<p role="status">${status}</p>`}
    ${mat?.done && html`<${ChooserResult}>
      <h3>${t('homeJourney.profileSaved')}</h3>
      <p><${Action} href=${mat.standaloneUrl || mat.url}>${t('home.mat.view')} →<//></p>
    <//>`}
    <${Hint}>${t('homeJourney.promptOther')}<//>
  <//>`;
}

/** "Which AI do you use?" and the road each answer opens. */
export function RoadChooser({ road, onRoad, chatEnabled, onMessage }) {
  const pick = (id) => {
    onRoad(id);
    saveRoad(id).then(refreshHome).catch(e => swallowed('home journey: road write', e));
  };
  return html`
    <div id="home-roads">
      <h3>${t('homeJourney.roadsTitle')}</h3>
      <${ChooserChoices} label=${t('homeJourney.roadsTitle')}>
        ${ROADS.map(id => html`<${ChooserChoice} key=${id} on=${road === id} onClick=${() => pick(id)}>
          ${t('homeJourney.' + ROAD_LABEL[id])}
        <//>`)}
      <//>
      ${road === 'subscription' && html`
        <${Hint}>${t('homeJourney.roadSubscriptionHint')}<//>
        <${ConnectBox} onMessage=${onMessage} />`}
      ${road === 'free' && html`
        <${Hint}>${t('homeJourney.roadFreeHint')}<//>
        <${ConnectBox} onMessage=${onMessage} claudeNote=${t('homeJourney.freeModelNote')} />
        <p>${t('homeJourney.roadFreeOpenRouter')}</p>
        <${ChooserLinks}>
          <${Action} href="/v1/profile?tab=generator">${t('homeJourney.openRouterKey')} →<//>
          ${chatEnabled && html`<${Action} href="/v1/chat">${t('homeJourney.localChat')} →<//>`}
        <//>`}
      ${road === 'prompt' && html`
        <${Hint}>${t('homeJourney.roadPromptHint')}<//>
        <${PromptRoad} />`}
    </div>`;
}
