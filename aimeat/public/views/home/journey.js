/**
 * @file public/views/home/journey.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the path ends and where the person is on it, which AI they use, then useful
 *   work for their AI: a shared place first, then an agent, a schedule or an app, with the result
 *   shown at home.
 * @version-history
 *   v1.3.0 — 2026-10-01 — Jouni's review: the first task is "Create a shared place" (an organism with
 *     a workspace) instead of a note, and its result lists the person's places; the road question
 *     goes once the path's connect stage is ticked, by the same test the tick uses; on the prompt
 *     road the task chooser is hidden, since none of its tasks work without a connection.
 *   v1.2.0 — 2026-10-01 — The block opens with where the path ends and the person's path in seven
 *     stages; before the first connection it asks "Which AI do you use?" with three roads
 *     (journey-roads.js). The connection block moved there unchanged; after a connection it still
 *     opens under "Connect another AI" (guided journey P1 and P2).
 *   2026-09-27: The page writes no class: the action links are the Action component, the prompts'
 *     copy is PromptCard `quiet`, the setup guide takes `poster` (its tabs); the markup is the same
 *     (page group G9, a move).
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
import { Action } from '/components/Action.js';
import {
  Chooser, ChooserChoices, ChooserChoice, ChooserPanel, ChooserStatus, ChooserFold,
  ChooserLinks, ChooserResult,
} from '/components/Chooser.js';
import { StepMat } from './step-mat.js';
import { swallowed } from '/js/swallowed.js';
import { buildJourneyPrompt } from './journey-prompts.js';
import { JourneyPath, RoadChooser, ConnectBox, refreshHome as refresh } from './journey-roads.js';

const html = htm.bind(h);
const actions = ['place', 'agent', 'schedule', 'app'];
const targets = { place: 'organisms', agent: 'agents', schedule: 'scheduler', app: 'apps' };
/** The same read and key the home's shared-spaces row uses (surface/blocks-home.js), so it is one read. */
const organismsPath = (owner) => (owner ? `/v1/organisms?member=${encodeURIComponent(owner)}&include=counts` : '');
const pickOrganisms = (d) => (d?.organisms ?? d?.items ?? []).map((o) => ({
  id: o.id, name: o.name || o.id, workspace_count: o.workspace_count, updatedAt: o.updated_at || o.updatedAt,
}));

export function HomeJourney() {
  const session = useSession();
  const { state, journey } = useHomeState();
  const choiceKey = 'aimeat.home-task.' + session?.owner;
  const [action, setAction] = useState(() => {
    try { const stored = sessionStorage.getItem(choiceKey); return actions.includes(stored) ? stored : 'place'; }
    catch (e) { swallowed('home journey: choice read', e); return 'place'; }
  });
  const [road, setRoad] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const { data: orgs, ready } = useShared('organisms', organismsPath(session?.owner), ['organisms'], pickOrganisms);
  const { data: chat } = useShared('chat-status', '/v1/chat/status', ['chat']);
  const { data: connection } = useShared('home-connection-proof', '/v1/memory/onboarding.hello_mcp?soft=1', ['memory']);
  const hasProof = !!connection && connection.exists !== false;
  useEffect(() => { if (hasProof) invalidateShared('home-state', '/v1/home/state'); }, [hasProof]);
  if (!state || !session) return null;
  // Connected means the same thing as the path's tick: any AI of theirs has reached this node.
  const connected = state.initialized || !!journey?.stages?.find(s => s.id === 'connect')?.done;
  const chosenRoad = road ?? journey?.road ?? null;
  const prompt = buildJourneyPrompt(action, window.location.origin, session.owner);
  // The newest five: the list grows with the account, and "Open shared places" holds all of them.
  const places = (Array.isArray(orgs) ? [...orgs] : [])
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 5);
  return html`
    <${Chooser} titleId="home-journey-title" title=${t('homeJourney.destinationTitle')}
      lead=${t(connected ? 'homeJourney.returning' : 'homeJourney.destinationLead')}>
      <${JourneyPath} journey=${journey} />
      ${!connected && html`<${RoadChooser} road=${chosenRoad} onRoad=${setRoad}
        chatEnabled=${!!chat?.enabled} onMessage=${setMessage} />`}
      ${/* An AI that cannot connect cannot do these tasks; its road carries the one task it can. */''}
      ${(connected || chosenRoad !== 'prompt') && html`
      <h3>${t('homeJourney.title')}</h3>
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
        ${connected && html`<${Action} expanded=${connecting} onClick=${() => setConnecting(v => !v)}>
          ${t(connecting ? 'homeJourney.hideConnection' : 'homeJourney.anotherAi')}
        <//>`}
      <//>
      ${connected && connecting && html`<${ConnectBox} onMessage=${setMessage} />`}
      <div>
        <p>${t('homeJourney.copyHint')}</p>
        <${PromptCard} key=${action} label=${t('homeJourney.' + action)} prompt=${prompt}
          quiet
          copyLabel=${t('common.copyPrompt')} copiedLabel=${t('common.copied')}
          onCopied=${() => setCopied(true)} />
        ${copied && html`<p role="status">${t('homeJourney.copied')}</p>`}
        <${ChooserLinks}>
          <${Action} onClick=${refresh}>${t('homeJourney.checkResult')}<//>
          <${Action} href=${'/v1/profile?tab=' + targets[action]}>${t('homeJourney.open' + action)} →<//>
          ${chat?.enabled && html`<${Action} href="/v1/chat">${t('homeJourney.localChat')} →<//>`}
        <//>
        ${action === 'place' && ready && places.length > 0 && html`<${ChooserResult}>
          <h3>${t('homeJourney.placesSaved')}</h3>
          ${places.map(o => html`<p key=${o.id}><${Action} href=${'/v1/profile?tab=organisms&org=' + encodeURIComponent(o.id)}>${o.name} →<//></p>`)}
          <${Hint}>${t('homeJourney.placeLifecycle')}<//>
        <//>`}
        ${copied && action === 'place' && ready && places.length === 0 && html`<p>${t('homeJourney.placeWaiting')}</p>`}
      </div>
      <//>`}
      <${ChooserFold} summary=${t('homeJourney.optionalPage')}>
        <p>${t('homeJourney.optionalPageHint')}</p>
        ${state.mat.done
          ? html`<${Action} href=${state.mat.standaloneUrl || state.mat.url}>${t('home.mat.view')} →<//>`
          : html`<${StepMat} onDone=${refresh} />`}
      <//>
      ${message && html`<p role="alert">${message}</p>`}
    <//>`;
}
