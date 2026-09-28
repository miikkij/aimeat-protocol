/**
 * @file offer-card-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Single source for the agent-offer card presentation. Exports small presentational
 *   pieces (badges, example, requirements, deliverable + sample) shared by every surface that shows
 *   an offer — the profile Offers feed AND the company catalog — so the format is identical and lives
 *   in ONE place instead of duplicated bespoke cards. `OfferCardView` composes them into the full
 *   card with an `actions` slot for the per-surface controls (run / order / sell). Its look is
 *   css/components/offer-card-view.css (.offer-card and its parts).
 * @structure OfferBadges · OfferExample · OfferRequirements · OfferDeliverable · OfferCardView
 * @usage
 *   html`<${OfferCardView} entry=${{ agent, online }} offer=${offer} actions=${html`…`} />`
 *   // or use the pieces directly inside an existing card (e.g. offers-tab):
 *   html`<${OfferBadges} offer=${offer} /> … <${OfferDeliverable} offer=${offer} />`
 * @version-history
 *   v1.0.0 — 2026-06-23 — extracted from views/profile/offers-tab.js OfferCard
 *   v1.1.0 — 2026-06-23 — split into reusable pieces; offers-tab migrated to use them (single source)
 *   v1.2.0 — 2026-09-27 — Draws its own names (.of-* → .offer-card*: -name for the offer's title,
 *     -reqs for the requirement list, -sample for the sample's box, -dot for the agent's dot); the
 *     rules moved with them out of css/views/offers.css and profile-poster.css into
 *     css/components/offer-card-view.css (a move).
 *   v1.2.1 — 2026-09-28 — No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so an offer title, ask, example, requirement or deliverable with a quote or an
 *     ampersand showed as &quot; / &amp;.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';

const html = htm.bind(h);

/** Trust/price chips for an offer. */
export function OfferBadges({ offer }) {
  const chips = [];
  if (offer.visibility && offer.visibility !== 'private') chips.push(['vis', t('profile.offers.visibility.' + offer.visibility) || offer.visibility]);
  if (offer.price && offer.price.morsels > 0) chips.push(['price', offer.price.morsels + ' ' + (t('profile.offers.morsels') || 'morsels')]);
  if (offer.verification) chips.push(['ver', t('profile.offers.verification.' + offer.verification) || offer.verification]);
  if (offer.dataHandling) chips.push(['data', t('profile.offers.dataHandling.' + offer.dataHandling) || offer.dataHandling]);
  if (offer.cost) chips.push(['cost', t('profile.offers.cost.' + offer.cost) || offer.cost]);
  if (offer.latency) chips.push(['lat', t('profile.offers.latency.' + offer.latency) || offer.latency]);
  return html`<span class="offer-card-badges">${chips.map(([k, label]) => html`<span class="offer-card-badge offer-card-badge--${k}" key=${k}>${label}</span>`)}</span>`;
}

/** The "Example:" line. */
export function OfferExample({ offer }) {
  if (!offer.example) return null;
  return html`<div class="offer-card-example"><span class="offer-card-label">${t('profile.offers.example') || 'Example'}:</span> ${offer.example}</div>`;
}

/** The "Before you ask" requirements list. */
export function OfferRequirements({ offer }) {
  const reqs = offer.requirements || [];
  if (!reqs.length) return null;
  return html`
    <div class="offer-card-label">${t('profile.offers.requirements') || 'Before you ask'}</div>
    <div class="offer-card-reqs">${reqs.map((r, i) => html`
      <span class="offer-card-req" key=${i}>${r.need}${r.instruction ? html` <span class="offer-card-mini">— ${r.instruction}</span>` : null}${r.fix ? html` <span class="offer-card-fix">${r.fix}</span>` : null}</span>`)}</div>`;
}

/** The "You'll get back" deliverable label + sample (or "untested" badge). */
export function OfferDeliverable({ offer }) {
  if (!offer.deliverable) return null;
  return html`
    <div class="offer-card-label">${t('profile.offers.deliverable') || 'You’ll get back'}: ${offer.deliverable.format || ''}${offer.deliverable.location?.space ? html` <span class="offer-card-mini">→ ${offer.deliverable.location.space}</span>` : null}</div>
    ${offer.deliverable.sample === 'untested'
      ? html`<span class="offer-card-badge offer-card-badge--untested">${t('profile.offers.untested') || 'untested — no sample yet'}</span>`
      : html`<div class="offer-card-md offer-card-sample"><${DeliverableBody} value=${offer.deliverable.sample} alt=${offer.title} format=${offer.deliverable.format} /></div>`}`;
}

/**
 * Full presentational offer card. `entry` = { agent, online }, `offer` = the Offer object, `actions`
 * = an optional vnode rendered at the bottom of the detail (run/order/sell controls per surface).
 */
export function OfferCardView({ entry, offer, actions }) {
  return html`
    <div class="offer-card offer-card--open">
      <div class="offer-card-head offer-card-head--static">
        <div class="offer-card-title">
          <span class="offer-card-name">${offer.title}</span>
          <span class="offer-card-agent">${entry.agent} <span class="offer-card-dot ${entry.online ? 'offer-card-dot--on' : 'offer-card-dot--off'}"></span></span>
        </div>
        <${OfferBadges} offer=${offer} />
      </div>
      <div class="offer-card-ask">${offer.ask}</div>
      <div class="offer-card-detail">
        <${OfferExample} offer=${offer} />
        <${OfferRequirements} offer=${offer} />
        <${OfferDeliverable} offer=${offer} />
        ${actions ?? null}
      </div>
    </div>`;
}

export default OfferCardView;
