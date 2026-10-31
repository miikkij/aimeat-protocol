/**
 * @file public/views/home/buyer-steps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Getting started on a node the store sold: four steps in doing-words, each ticked
 *   from the account's real state, and one button to the next one (Jouni's review of v31, K27,
 *   2026-10-31: "Alkuun pääseminen: 1/4 tehty", "Seuraavaksi: Kerro itsestäsi →").
 *
 *   The states come from the journey the server derives (services/journey-state.ts): connect = an
 *   AI of theirs has reached this node; first-result = their profile is saved; agents = an agent they
 *   made has finished work; apps = they have an app. Nothing is ticked that has not happened.
 *
 *   Composed from library components only (Chooser, IndexList, IndexStep, Action, Loud, Hint); no
 *   sheet of its own.
 * @structure buyerSteps(journey) · BuyerSteps({ journey })
 * @usage html`<${BuyerSteps} journey=${journey} />`
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (v31 K27).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Chooser } from '/components/Chooser.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Action, Actions, Loud } from '/components/Action.js';

const html = htm.bind(h);

/** The four steps: the journey stage that ticks each, its words, and where it is done. */
const STEPS = [
  { id: 'connect', stage: 'connect', href: '/v1/profile?tab=mcp' },
  { id: 'profile', stage: 'first-result', href: '/v1/chat' },
  { id: 'agent', stage: 'agents', href: '/v1/home?new-agent=1' },
  { id: 'app', stage: 'apps', href: '/v1/chat' },
];

/** The steps with their state, in order. */
export function buyerSteps(journey) {
  const done = new Map((journey?.stages ?? []).map((s) => [s.id, !!s.done]));
  return STEPS.map((s) => ({ ...s, done: !!done.get(s.stage) }));
}

/** @param {{ journey: any }} props */
export function BuyerSteps({ journey }) {
  const steps = buyerSteps(journey);
  const count = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return html`
    <${Chooser} titleId="home-journey-title"
      title=${t('buyerSteps.title', { done: count, total: steps.length })}
      lead=${next ? t('buyerSteps.lead') : t('buyerSteps.allDone')}>
      <${IndexList} steps>
        ${steps.map((s) => html`
          <${IndexStep} key=${s.id} line=${t('buyerSteps.' + s.id + 'Line')} endWord=${s.done ? t('buyerSteps.done') : null}>
            <${Action} href=${s.href}>${t('buyerSteps.' + s.id)}<//>
          <//>`)}
      <//>
      ${next && html`<${Actions}><${Loud} href=${next.href}>${t('buyerSteps.next', { step: t('buyerSteps.' + next.id + 'Short') })}<//><//>`}
    <//>`;
}

export default BuyerSteps;
