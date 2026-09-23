/**
 * @file public/views/profile/offers/inbox.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What came back, as two pages under the Offers crumb. The INBOX is a register of
 *   every delivery (when, what, who, how it went) with three filters and the agents who delivered
 *   most in the rail. A DELIVERY is its own page: the content rendered in full (a document, an image
 *   or a record), where it came from, and the rating as one row, five marks and a note, which feeds
 *   the agent's trust. Both read the deliverables the tab already loaded; the content of one
 *   delivery is fetched when its page opens.
 * @structure renderInbox · renderDeliverable · RatingRow
 * @usage import { renderInbox, renderDeliverable } from './inbox.js';
 * @version-history
 *   2026-09-22 -- A failed or stalled delivery's status chip takes the danger tone the chip now has,
 *     instead of the sun it borrowed.
 *   2026-09-22 -- Composed from the shared component set (Section, ListRow, Field, Action, Surface);
 *     no own CSS. The five rating stars are five numbered choices (the site's text glyphs are
 *     ✓ ✗ → ↩ only); what they save is unchanged.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { Section, Stack, Action, Field, Text, Surface } from '/components/poster-parts.js';
import { c, statusWord, statusTone, deliveryRows, rel, hhmm, dayLabel, chipRow, railList, renderPage } from './frame.js';

const ROWS = 20;

export function renderInbox(ctx) {
  const m = ctx.model;
  const f = ctx.inboxFilter;
  const list = f === 'unrated' ? m.unrated : f === 'failed' ? m.failed : m.latest;
  const open = ctx.moreOpen.has('inbox');
  const shown = open ? list : list.slice(0, ROWS);
  const filterTab = (id, label) => html`<${Action} kind="tab" selected=${f === id} onClick=${() => ctx.setInboxFilter(id)}>${label}<//>`;
  return renderPage(ctx, {
    id: 'inbox', crumbs: [c('inbox')], title: t('profile.offers.inboxTitle'),
    chips: chipRow([
      [c('chipDeliveries', { n: m.latest.length })],
      [c('doneN', { n: m.latest.filter(d => d.status === 'done').length })],
      m.failed.length && [c('failedN', { n: m.failed.length }), 'sun'],
      m.waiting.length && [c('waitingN', { n: m.waiting.length }), 'muted'],
      [c('ratedN', { n: m.rated }), m.rated ? 'plain' : 'muted'],
    ]),
    doors: html`${filterTab('all', c('filterAll'))}${filterTab('unrated', c('filterUnrated'))}${filterTab('failed', c('filterFailed'))}`,
    rail: m.mostDelivered.length ? railList(c('railMost'), m.mostDelivered.map(([agent, n]) => ({ key: agent, label: `${n} · ${agent}` }))) : null,
    children: html`
      <${Text} kind="lead">${t('profile.offers.inboxDesc')}<//>
      <${Section}>
        ${list.length ? deliveryRows(ctx, shown) : html`<${Text} tone="muted">${ctx.loadingDeliveries ? '…' : t('profile.offers.inboxEmpty')}<//>`}
      <//>
      ${list.length > ROWS ? html`<${Stack} direction="horizontal" align="start"><${Action} onClick=${() => ctx.toggleMore('inbox')}>${open ? c('showFewer') : c('showRest', { n: list.length - ROWS })}<//><//>` : null}`,
  });
}

/** Five marks and a note; its own state, saved through the tab's handler. */
function RatingRow({ d, ctx }) {
  const [stars, setStars] = useState(d.rating?.stars || 0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => { if (!stars) return; setBusy(true); await ctx.rate(d, stars, note.trim()); setNote(''); setBusy(false); };
  return html`<${Stack}>
    <${Text} kind="label">${d.rating ? t('profile.offers.yourRating') : t('profile.offers.rateIt')}<//>
    <${Stack} direction="wrap" density="compact">
      ${[1, 2, 3, 4, 5].map(n => html`<${Action} key=${n} kind="tab" selected=${n <= stars} disabled=${busy} title=${String(n)} onClick=${() => setStars(n)}>${n}<//>`)}
    <//>
    <${Field} type="text" placeholder=${t('profile.offers.ratePlaceholder')} value=${note} onInput=${(e) => setNote(e.target.value)} />
    <${Stack} direction="horizontal" align="start"><${Action} disabled=${busy || !stars} onClick=${submit}>${t('profile.offers.submitRating')}<//><//>
  <//>`;
}

export function renderDeliverable(ctx, d) {
  const m = ctx.model;
  const content = ctx.contentOf(d);
  const it = d.offer_id ? m.items.find(x => x.offer.id === d.offer_id && x.agent === d.agent) : null;
  const others = m.latest.filter(x => x.agent === d.agent && x.task_id !== d.task_id).slice(0, 5);
  const at = new Date(d.updated_at || 0);
  return renderPage(ctx, {
    id: 'deliverable', crumbs: [{ label: c('inbox'), go: () => ctx.pickView({ kind: 'page', id: 'inbox' }) }, d.title || d.task_id], title: d.title || d.task_id,
    chips: chipRow([
      [d.agent, 'sun'],
      [statusWord(d.status), statusTone(d.status) === 'danger' ? 'danger' : 'plain'],
      [`${dayLabel(at)} ${hhmm(at)}`, 'muted'],
      it && [it.offer.title],
    ]),
    doors: it ? html`<${Action} onClick=${() => ctx.pickView({ kind: 'offer', key: it.key })}>${c('askAgain')}<//>` : null,
    rail: others.length ? railList(c('railSameAgent', { a: d.agent }), others.map(x => ({ key: x.task_id, label: `${x.title || x.task_id} · ${rel(x.updated_at)}`, onClick: () => ctx.pickView({ kind: 'deliverable', taskId: x.task_id }) }))) : null,
    children: html`
      <${Section} id="op-content" title=${c('secContent')}>
        <${Stack}>
          ${d.verification ? html`<${Text} kind="caption" tone="muted">${t('profile.offers.expected')}: ${d.verification}<//>` : null}
          ${d.status === 'failed' ? html`<${Text} tone="danger">${t('profile.offers.failedMsg')}<//>`
            : content === undefined || content === 'loading' ? html`<${Text} tone="muted">…<//>`
            : content === null ? html`<${Text} tone="muted">${t('profile.offers.noDeliverableYet')}<//>`
            : html`<${Surface} kind="box"><${DeliverableBody} value=${content} alt=${d.title || d.task_id} /><//>`}
          <${Text} kind="mono" tone="muted">${t('profile.offers.provenance')}: ${d.agent} · ${t('profile.offers.task')} ${d.task_id} · ${statusWord(d.status)} · ${dayLabel(at)} ${hhmm(at)}<//>
        <//>
      <//>
      ${d.status === 'done' ? html`<${Section} id="op-rating" title=${c('secRate')}>
        <${Stack}>
          <${Text} kind="caption" tone="muted">${c('rateHint')}<//>
          <${RatingRow} key=${d.task_id} d=${d} ctx=${ctx} />
        <//>
      <//>` : null}`,
  });
}
