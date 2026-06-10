/**
 * @file pricing.js
 * @description Pricing ladder: Try it (0 €) → Own node (49 €/mo) → Own node Pro (99 €/mo)
 *   → Done for you (setup + monthly) → Enterprise (contact). No payment integration at
 *   this stage — CTAs are mailto links. #packages anchors the Done-for-you section
 *   (landing path card C links here). Short sentences, no hype adjectives.
 * @usage routed at /v1/pricing by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial pricing page (landing/portal split).
 */
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ContactCard } from '/components/ContactCard.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const CONTACT = 'mailto:jouni.miikki@aimeat.io';

export default function Pricing() {
  // Honour the #packages anchor on arrival.
  useEffect(() => {
    if (window.location.hash) {
      setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 200);
    }
  }, []);

  const tier = (id, name, price, lines, ctaLabel, ctaHref, hot) => html`
    <div class="ld-tier${hot ? ' ld-tier--hot' : ''}" id=${id || null}>
      <h3 class="ld-tier-name">${name}</h3>
      <div class="ld-tier-price">${price}</div>
      <ul class="ld-tier-lines">${lines.map(l => html`<li key=${l}>${l}</li>`)}</ul>
      <a class="ld-path-cta" href=${ctaHref}>${ctaLabel}</a>
    </div>
  `;

  return html`
    <div class="ld ld-pricing">
      <h1 class="ld-h1">${tr('pricing.title', 'Pricing')}</h1>
      <p class="ld-hero-sub">${tr('pricing.sub', 'Start free. Move to your own node when the data should be yours.')}</p>

      <div class="ld-tiers">
        ${tier('try-it', tr('pricing.tryName', 'Try it'), '0 €', [
          tr('pricing.try1', 'On the genesis node.'),
          tr('pricing.try2', 'Morsels, public apps, the prompt loop.'),
        ], tr('pricing.tryCta', 'Start free →'), '/v1/portal')}
        ${tier('own-node', tr('pricing.ownName', 'Own node'), '49 €/' + tr('pricing.mo', 'mo'), [
          tr('pricing.own1', 'Your own instance, your data, BYOK.'),
          tr('pricing.own2', 'No backups, community support.'),
        ], tr('pricing.contactCta', 'Contact us →'), CONTACT)}
        ${tier('own-node-pro', tr('pricing.proName', 'Own node Pro'), '99 €/' + tr('pricing.mo', 'mo'), [
          tr('pricing.pro1', 'Backups and a bigger instance.'),
          tr('pricing.pro2', 'Ready-made agent packages (CrewAI crew installed).'),
          tr('pricing.pro3', 'Email support.'),
        ], tr('pricing.contactCta', 'Contact us →'), CONTACT, true)}
      </div>

      <div class="ld-tiers" id="packages">
        ${tier(null, tr('pricing.dfyName', 'Done for you'), '990 € + 49 €/' + tr('pricing.mo', 'mo') + ' · 2500 € + 250 €/' + tr('pricing.mo', 'mo'), [
          tr('pricing.dfy1', 'Installation, your agents built, onboarding.'),
          tr('pricing.dfy2', 'For small businesses.'),
          tr('pricing.dfyExample', 'Example: a barbershop. Every morning at 7, your phone has the day’s bookings, yesterday’s feedback and a social post ready to approve.'),
        ], tr('pricing.dfyCta', 'See what it looks like →'), '/v1/business')}
        ${tier(null, tr('pricing.entName', 'Enterprise'), tr('pricing.entPrice', 'contact'), [
          tr('pricing.ent1', 'Governance, data inside your own walls.'),
          tr('pricing.ent2', 'Health and finance sectors.'),
        ], tr('pricing.contactCta', 'Contact us →'), CONTACT)}
      </div>

      <${ContactCard} />
    </div>
  `;
}
