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
 *   v1.3.0 — 2026-11-02 — A step is ticked only in order: one done before a step it follows keeps its
 *     link without ✓ until the steps before it are done, and the count says the same.
 *   v1.2.0 — 2026-11-01 — While the place's chat answers (ai-credit.js chatWorks), an unconnected
 *     outside AI does not lock step 2, which is done in that chat.
 *   v1.1.0 — 2026-11-01 — A step after the next one is plain quiet text with "Aukeaa, kun edellinen on
 *     tehty", not a link (Jouni's review of v34).
 *   v1.0.0 — 2026-10-31 — Initial (v31 K27).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Chooser } from '/components/Chooser.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { useShared } from '/views/surface/shared-read.js';
import { chatWorks } from '/js/ai-credit.js';

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
  const { data: chatStatus } = useShared('chat-status', '/v1/chat/status', ['chat']);
  // While the place's own chat answers, connecting an outside AI does not hold back the steps after
  // it: the profile is made in that chat (commercial's crew52 check: step 2 looked locked although
  // the chat worked). The next action still names the first step not done.
  const holds = (s) => !s.done && !(s.id === 'connect' && chatWorks(chatStatus));
  const raw = buyerSteps(journey);
  const held = raw.find(holds);
  const nextAt = held ? raw.indexOf(held) : raw.length;
  // A step is ticked only in order: one done before a step it follows is not, keeps its link and
  // no tick until the order reaches it (aimeat-protocol-4e's first-timer round on crew60: step 3
  // showed ✓ before step 2).
  const steps = raw.map((s, i) => ({ ...s, ticked: s.done && i < nextAt }));
  const count = steps.filter((s) => s.ticked).length;
  const next = steps.find((s) => !s.ticked);
  return html`
    <${Chooser} titleId="home-journey-title"
      title=${t('buyerSteps.title', { done: count, total: steps.length })}
      lead=${next ? t('buyerSteps.lead') : t('buyerSteps.allDone')}>
      <${IndexList} steps>
        ${steps.map((s, i) => (!s.done && i > nextAt)
          // A step after the next one is not pressed yet: no link and no arrow, and it says when it
          // opens (Jouni's review of v34: steps 3 and 4 looked like links).
          ? html`
            <${IndexStep} key=${s.id} locked line=${t('buyerSteps.locked')}>
              <${Note} kind="quiet" inline>${t('buyerSteps.' + s.id)}<//>
            <//>`
          : html`
            <${IndexStep} key=${s.id} line=${t('buyerSteps.' + s.id + 'Line')} endWord=${s.ticked ? t('buyerSteps.done') : null}>
              <${Action} href=${s.href}>${t('buyerSteps.' + s.id)}<//>
            <//>`)}
      <//>
      ${next && html`<${Actions}><${Loud} href=${next.href}>${t('buyerSteps.next', { step: t('buyerSteps.' + next.id + 'Short') })}<//><//>`}
    <//>`;
}

export default BuyerSteps;
