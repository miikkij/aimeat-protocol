/**
 * @file offer-card-view.js
 * @description Single source for the agent-offer card presentation. Exports small presentational
 *   pieces (badges, example, requirements, deliverable + sample) shared by every surface that shows
 *   an offer — the profile Offers feed AND the company catalog — so the format is identical and lives
 *   in ONE place instead of duplicated bespoke cards. `OfferCardView` composes them into the full
 *   card with an `actions` slot for the per-surface controls (run / order / sell).
 * @structure OfferBadges · OfferExample · OfferRequirements · OfferDeliverable · OfferCardView
 * @usage
 *   html`<${OfferCardView} entry=${{ agent, online }} offer=${offer} actions=${html`…`} />`
 *   // or use the pieces directly inside an existing card (e.g. offers-tab):
 *   html`<${OfferBadges} offer=${offer} /> … <${OfferDeliverable} offer=${offer} />`
 * @version-history
 *   v1.0.0 — 2026-06-23 — extracted from views/profile/offers-tab.js OfferCard
 *   v1.1.0 — 2026-06-23 — split into reusable pieces; offers-tab migrated to use them (single source)
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
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
  return html`<span class="of-badges">${chips.map(([k, label]) => html`<span class="of-badge of-badge--${k}" key=${k}>${escHtml(label)}</span>`)}</span>`;
}

/** The "Example:" line. */
export function OfferExample({ offer }) {
  if (!offer.example) return null;
  return html`<div class="of-example"><span class="of-label">${t('profile.offers.example') || 'Example'}:</span> ${escHtml(offer.example)}</div>`;
}

/** The "Before you ask" requirements list. */
export function OfferRequirements({ offer }) {
  const reqs = offer.requirements || [];
  if (!reqs.length) return null;
  return html`
    <div class="of-label">${t('profile.offers.requirements') || 'Before you ask'}</div>
    <div class="of-req-list">${reqs.map((r, i) => html`
      <span class="of-req" key=${i}>${escHtml(r.need)}${r.instruction ? html` <span class="of-mini">— ${escHtml(r.instruction)}</span>` : null}${r.fix ? html` <span class="of-fix">${escHtml(r.fix)}</span>` : null}</span>`)}</div>`;
}

/** The "You'll get back" deliverable label + sample (or "untested" badge). */
export function OfferDeliverable({ offer }) {
  if (!offer.deliverable) return null;
  return html`
    <div class="of-label">${t('profile.offers.deliverable') || 'You’ll get back'}: ${escHtml(offer.deliverable.format || '')}${offer.deliverable.location?.space ? html` <span class="of-mini">→ ${escHtml(offer.deliverable.location.space)}</span>` : null}</div>
    ${offer.deliverable.sample === 'untested'
      ? html`<span class="of-badge of-badge--untested">${t('profile.offers.untested') || 'untested — no sample yet'}</span>`
      : html`<div class="of-md of-sample-md"><${DeliverableBody} value=${offer.deliverable.sample} alt=${offer.title} format=${offer.deliverable.format} /></div>`}`;
}

/**
 * Full presentational offer card. `entry` = { agent, online }, `offer` = the Offer object, `actions`
 * = an optional vnode rendered at the bottom of the detail (run/order/sell controls per surface).
 */
export function OfferCardView({ entry, offer, actions }) {
  return html`
    <div class="of-card of-card--open">
      <div class="of-card-head of-card-head--static">
        <div class="of-card-title">
          <span class="of-offer-title">${escHtml(offer.title)}</span>
          <span class="of-agent">${escHtml(entry.agent)} <span class="of-dot ${entry.online ? 'of-dot--on' : 'of-dot--off'}"></span></span>
        </div>
        <${OfferBadges} offer=${offer} />
      </div>
      <div class="of-ask">${escHtml(offer.ask)}</div>
      <div class="of-detail">
        <${OfferExample} offer=${offer} />
        <${OfferRequirements} offer=${offer} />
        <${OfferDeliverable} offer=${offer} />
        ${actions ?? null}
      </div>
    </div>`;
}

export default OfferCardView;
