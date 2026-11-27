/**
 * @file public/views/profile/wallet/subscriptions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The wallet's subscriptions: what renews by itself on the person's card, an app's
 *   membership they bought or an extension's plan, and the one press that stops a renewal. The paid
 *   period runs to its end either way (commerce/subscriptions.ts). Read from GET
 *   /v1/commerce/subscriptions by wallet-tab.js, stopped with POST
 *   /v1/commerce/subscriptions/:ext/:plan/cancel.
 * @structure secSubscriptions(ctx, n) · subRow(sub, ctx)
 * @usage import { secSubscriptions } from './subscriptions.js';
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import { h } from 'preact';
import htm from 'htm';
import { Section } from '/components/Section.js';
import { List, Row, Name, Num, When, Doors } from '/components/List.js';
import { Figure } from '/components/Figure.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { x, money, dateWord } from './frame.js';

const html = htm.bind(h);

/** One subscription: what it is, until when it is paid, its price, and the stop button while it renews. */
function subRow(s, ctx) {
  const name = s.kind === 'membership' ? x('subs.membership', { app: String(s.app || '').split('/')[1]?.replace(/\.html$/, '') || s.title, role: s.role }) : s.title;
  const state = !s.active ? x('subs.ended') : s.auto_renew ? x('subs.renews', { date: dateWord(s.active_until) }) : x('subs.endsOn', { date: dateWord(s.active_until) });
  return html`
    <${Row} key=${`${s.ext}/${s.plan}`}>
      <${Name} meta=${`${state} · ${x('subs.period', { days: s.period_days })}`}>${name}<//>
      <${When}>${dateWord(s.active_until)}<//>
      <${Num}><${Figure} small end tone=${s.active ? undefined : 'dim'} n=${money(s.amount, s.currency)} /><//>
      <${Doors}>${s.active && s.auto_renew
        ? html`<${Action} small soft disabled=${ctx.busy === `sub:${s.ext}/${s.plan}`} onClick=${() => ctx.stopRenewal(s)}>${x('subs.stop')}<//>`
        : html`<${Mark} kind="status" tone="off">${s.active ? x('subs.noRenewal') : x('subs.ended')}<//>`}<//>
    <//>`;
}

/** The section: drawn only when the person has a subscription. */
export function secSubscriptions(ctx, n) {
  const subs = ctx.subscriptions || [];
  return html`
    <${Section} id="wal-subs" num=${n} title=${x('secSubs')} count=${x('secSubsSub', { n: subs.filter((s) => s.active && s.auto_renew).length })}>
      <${Note} kind="lead">${x('subs.intro')}<//>
      <${List} cols="name-when-amount-doors" keepCols apart head=${[x('subs.colWhat'), x('subs.colUntil'), { label: x('subs.colPrice'), num: true }, '']}>
        ${subs.map((s) => subRow(s, ctx))}
      <//>
    <//>`;
}
