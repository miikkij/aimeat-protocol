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
 *   v1.13.0 — 2026-09-26 — The deliveries' heading row is inside their Listing (deliveryRows with head), a unification: the look most tabs use.
 *   v1.12.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 — 2026-09-26 — A brief, a sample and a delivery are the Object box at the page's own size: the box's own words size goes (a unification).
 *   v1.10.0 — 2026-09-26 — A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.9.0 — 2026-09-25 — "Show more" under a list is the action link's more tone (.poster-action--more), a unification: the look most tabs use.
 *   v1.8.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.6.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.5.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { PageSection } from '/components/PageSection.js';
import { c, statusWord, statusClass, deliveryRows, rel, hhmm, dayLabel, renderPage } from './frame.js';
import { Hint } from '/components/Hint.js';

const ROWS = 20;

export function renderInbox(ctx) {
  const m = ctx.model;
  const f = ctx.inboxFilter;
  const list = f === 'unrated' ? m.unrated : f === 'failed' ? m.failed : m.latest;
  const open = ctx.moreOpen.has('inbox');
  const shown = open ? list : list.slice(0, ROWS);
  const filterDoor = (id, label) => html`<button type="button" class=${`poster-tab poster-tab--fold ${f === id ? 'is-on' : ''}`} onClick=${() => ctx.setInboxFilter(id)}>${label}</button>`;
  return renderPage(ctx, {
    id: 'inbox', crumbs: [c('inbox')], title: t('profile.offers.inboxTitle'),
    chips: html`
      <span class="poster-chip">${c('chipDeliveries', { n: m.latest.length })}</span>
      <span class="poster-chip">${c('doneN', { n: m.latest.filter(d => d.status === 'done').length })}</span>
      ${m.failed.length ? html`<span class="poster-chip poster-chip--coral">${c('failedN', { n: m.failed.length })}</span>` : null}
      ${m.waiting.length ? html`<span class="poster-chip">${c('waitingN', { n: m.waiting.length })}</span>` : null}
      <span class="poster-chip">${c('ratedN', { n: m.rated })}</span>`,
    doors: html`${filterDoor('all', c('filterAll'))}${filterDoor('unrated', c('filterUnrated'))}${filterDoor('failed', c('filterFailed'))}`,
    rail: m.mostDelivered.length ? html`<hr /><span class="og-rail-label">${c('railMost')}</span>
      ${m.mostDelivered.map(([agent, n]) => html`<span class="og-rail-link on" key=${agent}><i>${n}</i>${agent}</span>`)}` : null,
    children: html`
      <p class="og-desc og-desc--page">${t('profile.offers.inboxDesc')}</p>
      ${list.length ? deliveryRows(ctx, shown, { head: true }) : html`<p class="poster-quiet">${ctx.loadingDeliveries ? '…' : t('profile.offers.inboxEmpty')}</p>`}
      ${list.length > ROWS ? html`<p class="op-more"><button type="button" class="poster-action poster-action--more" onClick=${() => ctx.toggleMore('inbox')}>${open ? c('showFewer') : c('showRest', { n: list.length - ROWS })}</button></p>` : null}`,
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
      <span class="poster-label">${d.rating ? t('profile.offers.yourRating') : t('profile.offers.rateIt')}</span>
      <span class="op-stars">${[1, 2, 3, 4, 5].map(n => html`<button type="button" key=${n} class=${`op-star ${n <= stars ? 'on' : ''}`} disabled=${busy} onClick=${() => setStars(n)} title=${String(n)}>${n <= stars ? '★' : '☆'}</button>`)}</span>
      <input type="text" class="og-input op-rate-note" placeholder=${t('profile.offers.ratePlaceholder')} value=${note} onInput=${(e) => setNote(e.target.value)} />
      <button type="button" class="poster-action poster-action--small" disabled=${busy || !stars} onClick=${submit}>${t('profile.offers.submitRating')}</button>
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
      <span class="poster-chip poster-chip--sun">${d.agent}</span>
      <span class=${statusClass(d.status)}>${statusWord(d.status)}</span>
      <span class="poster-chip">${dayLabel(at)} ${hhmm(at)}</span>
      ${it ? html`<span class="poster-chip">${it.offer.title}</span>` : null}`,
    doors: it ? html`<button type="button" class="poster-action poster-action--small" onClick=${() => ctx.pickView({ kind: 'offer', key: it.key })}>${c('askAgain')}</button>` : null,
    rail: others.length ? html`<hr /><span class="og-rail-label">${c('railSameAgent', { a: d.agent })}</span>
      ${others.map(x => html`<button type="button" class="og-rail-link" key=${x.task_id} onClick=${() => ctx.pickView({ kind: 'deliverable', taskId: x.task_id })}><i>→</i>${x.title || x.task_id}<em>${rel(x.updated_at)}</em></button>`)}` : null,
    children: html`
      <${PageSection} id="op-content" num="01" title=${c('secContent')} first=${true}>
        ${d.verification ? html`<${Hint}>${t('profile.offers.expected')}: ${d.verification}<//>` : null}
        ${d.status === 'failed' ? html`<p class="op-warn">${t('profile.offers.failedMsg')}</p>`
          : content === undefined || content === 'loading' ? html`<p class="poster-quiet">…</p>`
          : content === null ? html`<p class="poster-quiet">${t('profile.offers.noDeliverableYet')}</p>`
          : html`<div class="op-frame poster-box"><${DeliverableBody} value=${content} alt=${d.title || d.task_id} /></div>`}
        <p class="poster-hint op-prov">${t('profile.offers.provenance')}: <b>${d.agent}</b> · ${t('profile.offers.task')} ${d.task_id} · ${statusWord(d.status)} · ${dayLabel(at)} ${hhmm(at)}</p>
      <//>
      ${d.status === 'done' ? html`<${PageSection} id="op-rating" num="02" title=${c('secRate')}>
        <${Hint}>${c('rateHint')}<//>
        <${RatingRow} key=${d.task_id} d=${d} ctx=${ctx} />
      <//>` : null}`,
  });
}
