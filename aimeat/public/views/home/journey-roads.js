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
 *   Chooser, the setup guide, PromptCard and PasteBox. Nothing here writes a class of its own.
 * @structure JourneyPath · RoadChooser · ConnectBox (moved from journey.js) · PromptRoad
 * @usage html`<${JourneyPath} journey=${journey} />  <${RoadChooser} journey=${journey} />`
 * @version-history
 *   v1.1.0 — 2026-10-01 — Jouni's review: the free road's claude.ai line names the free plan's model
 *     instead of Opus; the road is held by the home (it hides the task chooser on the prompt road);
 *     the prompt road shows the saved note itself, since the task chooser no longer has a note task.
 *   v1.0.0 — 2026-10-01 — Initial. ConnectBox is the connection block journey.js drew, unchanged.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { useShared, invalidateShared } from '/views/surface/shared-read.js';
import { NamedRow } from '/components/NamedRow.js';
import { CheckItem } from '/components/CheckItem.js';
import { PromptCard } from '/components/PromptCard.js';
import { PasteBox } from '/components/PasteBox.js';
import { Hint } from '/components/Hint.js';
import { Action } from '/components/Action.js';
import { ChooserChoices, ChooserChoice, ChooserBox, ChooserFold, ChooserLinks, ChooserResult } from '/components/Chooser.js';
import { McpSetupGuide } from '/views/profile/ai-setup-guide.js';
import { StepAgent } from './step-agent.js';
import { buildPastePrompt, parsePastedNote, FIRST_NOTE_KEY } from './journey-prompts.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const JOURNEY_KEY = 'journey.state';
const ROADS = ['subscription', 'free', 'prompt'];
const ROAD_LABEL = { subscription: 'roadSubscription', free: 'roadFree', prompt: 'roadPrompt' };

/** Where each stage is looked after, so a stage in the row is a door as well as a mark. */
const STAGE_HREF = {
  ai: '/v1/home#home-roads',
  connect: '/v1/profile?tab=mcp',
  'first-result': '/v1/profile?tab=memory',
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

/** The road for an AI that cannot connect: a prompt out, the answer pasted back as the first note. */
function PromptRoad() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const { data: record, ready } = useShared('home-first-note', `/v1/memory/${FIRST_NOTE_KEY}?soft=1`, ['memory']);
  const note = record?.exists === false ? null : record?.value;
  const saved = typeof note?.text === 'string' && !!note.text.trim();
  const save = async () => {
    const note = parsePastedNote(text);
    if (!note) { setStatus(t('homeJourney.pasteEmpty')); return; }
    try {
      await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: FIRST_NOTE_KEY, value: note, visibility: 'private' }) });
      setText('');
      setStatus(t('homeJourney.pasteSaved'));
      refreshHome();
    } catch (e) {
      setStatus(t('homeJourney.pasteFailed', { error: e?.message || String(e) }));
    }
  };
  return html`<${ChooserBox}>
    <p>${t('homeJourney.promptIntro')}</p>
    <${PromptCard} label=${t('homeJourney.note')} prompt=${buildPastePrompt()} quiet
      copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')} />
    <${PasteBox} id="home-paste-note" label=${t('homeJourney.pasteLabel')} rows="4" value=${text}
      onInput=${(e) => setText(e.currentTarget.value)} />
    <${ChooserLinks}>
      <${Action} onClick=${save}>${t('homeJourney.pasteSave')}<//>
    <//>
    ${status && html`<p role="status">${status}</p>`}
    ${ready && saved && html`<${ChooserResult}>
      <h3>${t('homeJourney.saved')}</h3>
      ${typeof note.title === 'string' && html`<strong>${note.title}</strong>`}
      <p>${note.text}</p>
      <${Hint}>${t('homeJourney.noteLifecycle')}<//>
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
