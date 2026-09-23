/**
 * @file public/views/profile/offers/inbox.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What came back, as two pages under the Offers crumb. The INBOX is a register of
 *   every delivery (when, what, who, how it went) with three filters and the agents who delivered
 *   most in the rail. A DELIVERY is its own page: the content rendered in full (a document, an image
 *   or a record), where it came from, and the rating as one row, five stars and a note, which feeds
 *   the agent's trust. Both read the deliverables the tab already loaded; the content of one
 *   delivery is fetched when its page opens.
 * @structure renderInbox · renderDeliverable · RatingRow
 * @usage import { renderInbox, renderDeliverable } from './inbox.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { Section } from '/views/profile/organisms/poster-parts.js';
import { c, statusWord, statusClass, deliveryRows, deliveryHead, rel, hhmm, dayLabel, renderPage } from './frame.js';

const ROWS = 20;

export function renderInbox(ctx) {
  const m = ctx.model;
  const f = ctx.inboxFilter;
  const list = f === 'unrated' ? m.unrated : f === 'failed' ? m.failed : m.latest;
  const open = ctx.moreOpen.has('inbox');
  const shown = open ? list : list.slice(0, ROWS);
  const filterDoor = (id, label) => html`<button type="button" class=${`og-door og-door--quiet ${f === id ? 'on' : ''}`} onClick=${() => ctx.setInboxFilter(id)}>${label}</button>`;
  return renderPage(ctx, {
    id: 'inbox', crumbs: [c('inbox')], title: t('profile.offers.inboxTitle'),
    chips: html`
      <span class="og-chip">${c('chipDeliveries', { n: m.latest.length })}</span>
      <span class="og-chip">${c('doneN', { n: m.latest.filter(d => d.status === 'done').length })}</span>
      ${m.failed.length ? html`<span class="og-chip og-chip--coral">${c('failedN', { n: m.failed.length })}</span>` : null}
      ${m.waiting.length ? html`<span class="og-chip og-chip--dim">${c('waitingN', { n: m.waiting.length })}</span>` : null}
      <span class=${`og-chip ${m.rated ? '' : 'og-chip--dim'}`}>${c('ratedN', { n: m.rated })}</span>`,
    doors: html`${filterDoor('all', c('filterAll'))}${filterDoor('unrated', c('filterUnrated'))}${filterDoor('failed', c('filterFailed'))}`,
    rail: m.mostDelivered.length ? html`<hr /><span class="og-rail-label">${c('railMost')}</span>
      ${m.mostDelivered.map(([agent, n]) => html`<span class="og-rail-link on" key=${agent}><i>${n}</i>${agent}</span>`)}` : null,
    children: html`
      <p class="og-desc og-desc--page">${t('profile.offers.inboxDesc')}</p>
      ${list.length ? html`${deliveryHead()}${deliveryRows(ctx, shown)}` : html`<p class="og-empty">${ctx.loadingDeliveries ? '…' : t('profile.offers.inboxEmpty')}</p>`}
      ${list.length > ROWS ? html`<p class="op-more"><button type="button" onClick=${() => ctx.toggleMore('inbox')}>${open ? c('showFewer') : c('showRest', { n: list.length - ROWS })}</button></p>` : null}`,
  });
}

/** Five stars and a note; its own state, saved through the tab's handler. */
function RatingRow({ d, ctx }) {
  const [stars, setStars] = useState(d.rating?.stars || 0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => { if (!stars) return; setBusy(true); await ctx.rate(d, stars, note.trim()); setNote(''); setBusy(false); };
  return html`
    <div class="op-rate">
      <span class="og-label">${d.rating ? t('profile.offers.yourRating') : t('profile.offers.rateIt')}</span>
      <span class="op-stars">${[1, 2, 3, 4, 5].map(n => html`<button type="button" key=${n} class=${`op-star ${n <= stars ? 'on' : ''}`} disabled=${busy} onClick=${() => setStars(n)} title=${String(n)}>${n <= stars ? '★' : '☆'}</button>`)}</span>
      <input type="text" class="op-rate-note" placeholder=${t('profile.offers.ratePlaceholder')} value=${note} onInput=${(e) => setNote(e.target.value)} />
      <button type="button" class="og-door" disabled=${busy || !stars} onClick=${submit}>${t('profile.offers.submitRating')}</button>
    </div>`;
}

export function renderDeliverable(ctx, d) {
  const m = ctx.model;
  const content = ctx.contentOf(d);
  const it = d.offer_id ? m.items.find(x => x.offer.id === d.offer_id && x.agent === d.agent) : null;
  const others = m.latest.filter(x => x.agent === d.agent && x.task_id !== d.task_id).slice(0, 5);
  const at = new Date(d.updated_at || 0);
  return renderPage(ctx, {
    id: 'deliverable', crumbs: [{ label: c('inbox'), go: () => ctx.pickView({ kind: 'page', id: 'inbox' }) }, d.title || d.task_id], title: d.title || d.task_id,
    chips: html`
      <span class="og-chip og-chip--sun op-chip--case">${d.agent}</span>
      <span class=${`og-chip ${statusClass(d.status) === 'op-st--err' ? 'og-chip--coral' : ''}`}>${statusWord(d.status)}</span>
      <span class="og-chip og-chip--dim op-chip--case">${dayLabel(at)} ${hhmm(at)}</span>
      ${it ? html`<span class="og-chip op-chip--case">${it.offer.title}</span>` : null}`,
    doors: it ? html`<button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'offer', key: it.key })}>${c('askAgain')}</button>` : null,
    rail: others.length ? html`<hr /><span class="og-rail-label">${c('railSameAgent', { a: d.agent })}</span>
      ${others.map(x => html`<button type="button" class="og-rail-link" key=${x.task_id} onClick=${() => ctx.pickView({ kind: 'deliverable', taskId: x.task_id })}><i>→</i>${x.title || x.task_id}<em>${rel(x.updated_at)}</em></button>`)}` : null,
    children: html`
      <${Section} id="op-content" num="01" title=${c('secContent')} first=${true}>
        ${d.verification ? html`<p class="op-hint">${t('profile.offers.expected')}: ${d.verification}</p>` : null}
        ${d.status === 'failed' ? html`<p class="op-warn">${t('profile.offers.failedMsg')}</p>`
          : content === undefined || content === 'loading' ? html`<p class="og-empty">…</p>`
          : content === null ? html`<p class="og-empty">${t('profile.offers.noDeliverableYet')}</p>`
          : html`<div class="op-frame op-content"><${DeliverableBody} value=${content} alt=${d.title || d.task_id} /></div>`}
        <p class="op-prov">${t('profile.offers.provenance')}: <b>${d.agent}</b> · ${t('profile.offers.task')} ${d.task_id} · ${statusWord(d.status)} · ${dayLabel(at)} ${hhmm(at)}</p>
      <//>
      ${d.status === 'done' ? html`<${Section} id="op-rating" num="02" title=${c('secRate')}>
        <p class="op-hint">${c('rateHint')}</p>
        <${RatingRow} key=${d.task_id} d=${d} ctx=${ctx} />
      <//>` : null}`,
  });
}
