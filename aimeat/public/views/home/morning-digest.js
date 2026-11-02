/**
 * @file public/views/home/morning-digest.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The first visit's offer ("three visits" a; Jouni, 2.11 00.52): a morning digest agent
 *   for tomorrow morning, made with one press. The press runs the home's own agent path
 *   (services/agent-draft.js startAgent: the proposal, the person's approval and the 7:00 schedule),
 *   with the ready definition crew-templates.js `morningDigest`. What the agent looks for is the
 *   person's own answer about their work from the profile interview (journey.profile), written into
 *   the request in their language, and the digest comes back in that language by email.
 *   Shown on a node the store sold, from the first visit, until the person starts it or says not
 *   now (`home.offers` { digest }), and never when an agent of that name exists or waits.
 * @structure MorningDigestOffer({ visit }) · DIGEST_NAME
 * @usage <${MorningDigestOffer} visit=${visit} />
 * @version-history
 *   v1.1.0 — 2026-11-02 — The schedule says deliver: "owner": the node emails each digest and writes its
 *     date (services/task-result-delivery.ts); on crew63 the model sent nothing and wrote October.
 *   v1.0.1 — 2026-11-02 — The answer is written through visits.js patchOffers, the one writer of `home.offers`.
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { customerNode } from '/js/site.js';
import { startAgent } from '/js/services/agent-draft.js';
import { useShared } from '/views/surface/shared-read.js';
import { OFFERS_PATH, patchOffers } from './visits.js';
import { useHomeState } from '/views/surface/home-state.js';
import { Band } from '/components/Band.js';
import { Note } from '/components/Note.js';
import { Action, Actions, Loud } from '/components/Action.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const fill = (s, vars) => Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s);

export const DIGEST_NAME = 'morning-digest';
const AGENT_PATH = `/v1/home/agents?agent=${DIGEST_NAME}`;
const CRON = '0 7 * * *';

/** What the agent looks for: the person's work in their own words, or what they need, or nothing. */
function workOf(journey) {
  const p = journey?.profile ?? {};
  return String(p.work || p.needs || journey?.want || '').trim().slice(0, 300);
}

/** The request the agent works from each morning, in the person's language; it is also what they read before pressing. */
function purposeFor(work) {
  return work
    ? fill(tr('home.digest.purpose', 'Every morning at 7: at most five news items or facts from the last day that touch your work ({work}), in short, sent to your email.'), { work })
    : tr('home.digest.purposeGeneral', 'Every morning at 7: the five most important news items of the day, in short, sent to your email.');
}

/** Write the person's answer to the offer, keeping what else the record holds. */
const rememberOffer = (answer) => patchOffers({ digest: answer, digestAt: new Date().toISOString() });

/** The card, or nothing: not a store's node, not read yet, already answered, or the agent exists. */
export function MorningDigestOffer({ visit }) {
  const enabled = customerNode() && !!visit;
  const { journey, ready } = useHomeState();
  const offers = useShared('home-offers', enabled ? OFFERS_PATH : '', ['memory'], (d) => (d?.value && typeof d.value === 'object' ? d.value : {}));
  const agents = useShared('home-digest-agent', enabled ? AGENT_PATH : '', ['agents'], (d) => d);
  const [phase, setPhase] = useState('offer');
  const [problem, setProblem] = useState('');

  if (!enabled || !ready || !offers.ready || !agents.ready) return null;
  const has = (list) => Array.isArray(list) && list.some((a) => a?.name === DIGEST_NAME);
  const exists = has(agents.data?.workers) || has(agents.data?.proposals);
  if (phase === 'offer' && (offers.data?.digest || exists)) return null;

  const work = workOf(journey);
  const title = tr('home.digest.title', 'A morning digest for tomorrow');

  const start = async () => {
    setPhase('busy');
    setProblem('');
    try {
      const draft = {
        name: DIGEST_NAME, displayName: tr('home.digest.agentName', 'Morning digest'),
        purpose: purposeFor(work), does: [], reach: 'standard', template: 'morningDigest', crewDef: null,
      };
      // deliver 'owner': the node sends each digest to the person itself, so the email the card
      // promises does not rest on the model calling its notify tool (crew63: it did not).
      const out = await startAgent(draft, { when: 'clock', cron: CRON, deliver: 'owner' });
      if (out?.schedule_problem) setProblem(String(out.schedule_problem));
      await rememberOffer('started').catch((err) => swallowed('morning digest: remember started', err));
      setPhase('done');
    } catch (err) {
      setProblem(err?.message || String(err));
      setPhase('error');
    }
  };
  const later = () => { rememberOffer('declined').catch((err) => swallowed('morning digest: remember declined', err)); };

  if (phase === 'done') {
    return html`
      <${Band} title=${title}>
        <${Note} kind="lead">${tr('home.digest.done', 'Done. Your first digest comes tomorrow morning at 7. The agent is called Morning digest, and you can change or stop it on the Agents page.')}<//>
        ${problem && html`<${Note} kind="hint" role="status">${fill(tr('home.digest.scheduleProblem', 'The agent was made, but its time was not set: {reason} Set the time on the Agents page.'), { reason: problem })}<//>`}
        <${Actions}><${Action} small soft href="/v1/profile?tab=agents">${tr('home.digest.agentsLink', 'Agents page')} →<//><//>
      <//>`;
  }

  return html`
    <${Band} title=${title}>
      <${Note} kind="lead">${tr('home.digest.lead', 'Your first agent can put together a short digest for you every morning at 7: at most five news items or facts that touch your work. It comes to your email.')}<//>
      ${work && html`<${Note} kind="hint">${fill(tr('home.digest.workLine', 'The work it looks for: {work}'), { work })}<//>`}
      ${phase === 'error' && html`<${Note} kind="report" tone="err" role="alert">${fill(tr('home.digest.failed', 'The morning digest could not be started: {reason}'), { reason: problem })}<//>`}
      <${Actions}>
        <${Loud} onClick=${start} disabled=${phase === 'busy'}>${phase === 'busy'
          ? tr('home.digest.starting', 'Starting…')
          : tr('home.digest.start', 'Start the morning digest')}<//>
        <${Action} small soft onClick=${later} disabled=${phase === 'busy'}>${tr('home.digest.notNow', 'Not now')}<//>
      <//>
    <//>`;
}
