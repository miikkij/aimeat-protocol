/**
 * @file landing-showroom-rooms.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The showroom front page's second half (2026-08-28): the store section, the safety
 *   list and the two rooms. The hero, the wall's introduction and the last word are in
 *   landing-showroom.js; the split keeps both files well under the 800-line limit.
 *
 *   THE STORE SECTION CARRIES THE ONLY PRICES ON THE SITE, AND THE STORE IS THEIR SOURCE. The
 *   store is its own AIMEAT instance and the one place a price is decided, so this section reads
 *   the public record `tiers` from the store's shop extension (GET {store}/v1/memory/ext:shop/
 *   tiers, value { from, tiers: [{ name, price }] }) and shows that. The ladder the operator typed
 *   into the block is the fallback for a store that has not published the record, never a second
 *   copy that could disagree with it. The block itself is offered only when the node has a store
 *   (AIMEAT_SITE_STORE_URL), so a node without one never states a price at all.
 *
 *   The safety list is where the trust claims live now, and it ends with the one line about how
 *   AI content is marked and the link to the page that states the limits properly.
 * @structure StoreSection · parseTiers · Star · TrustList · Rooms
 * @usage import { StoreSection, TrustList, Rooms } from '/views/landing-showroom-rooms.js';
 * @version-history
 *   v1.1.0 — 2026-08-28 — The store section reads its ladder and its "from" price from the store's
 *     public record (ext:shop / tiers); the block's settings became the fallback.
 *   v1.0.0 — 2026-08-28 — Initial, built to the design canvas "AIMEAT Front Page" (direction A).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { siteLink, hasSite, storeHref } from '/js/site.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** A star, drawn rather than typed, so it is the same picture on every platform. */
const Star = html`<svg class="ld-sh-star" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.4 5.8 21.1l1.6-7L2 9.3l7.1-.7z"></path></svg>`;

/**
 * "Solo: 19 · Team: 59 · Managed: from 2 000" → [{ name, price }]. A pair without a colon is
 * dropped rather than guessed at, so a typo in the admin form loses one box, never the section.
 * @param {string} line
 * @returns {{ name: string, price: string }[]}
 */
export function parseTiers(line) {
  return String(line || '')
    .split('·')
    .map((pair) => {
      const at = pair.indexOf(':');
      if (at < 0) return null;
      const name = pair.slice(0, at).trim();
      const price = pair.slice(at + 1).trim();
      return name && price ? { name, price } : null;
    })
    .filter(Boolean);
}

/**
 * Loved the demo? Take one home. The picture with the price sticker, three reasons, the ladder
 * and the one door. `fromPrice` and `tiers` are the block's settings.
 */
export function StoreSection({ fromPrice, tiers }) {
  const store = storeHref();
  // THE STORE IS THE SOURCE OF ITS OWN PRICES. When the node has a store, the NODE asks it for
  // the public record `tiers` in its shop extension's namespace and serves the answer at
  // GET /v1/site/store-tiers ({ from, tiers: [{ name, price }] }), held five minutes. This page
  // reads that: the browser cannot reach the store's origin under the node's CSP. The block's own
  // settings are the fallback for a store that has not published the record (or is down), never a
  // second copy that could disagree with it.
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!store) return undefined;
    let alive = true;
    fetch('/v1/site/store-tiers')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const d = j?.data;
        if (!alive || !d || !Array.isArray(d.tiers) || d.tiers.length === 0) return;
        setLive({ tiers: d.tiers, from: typeof d.from === 'string' ? d.from.trim() : '' });
      })
      .catch(err => swallowed('showroom: store tiers', err));
    return () => { alive = false; };
  }, [store]);
  const ladder = live ? live.tiers : parseTiers(tiers);
  const from = (live?.from || fromPrice || '').trim();
  return html`
    <section class="ld-sh-store">
      <div class="ld-sh-store-art">
        <img class="ld-sh-store-img" src="/img/frontdemo/ownbox.jpg" width="640" height="640" loading="lazy"
          alt=${tr('landing.storeAlt', 'An overjoyed person carries a glowing boxed computer out of a store while retro robots cheer')} />
        ${from ? html`<span class="ld-sh-sticker ld-sh-sticker--price">${tr('landing.storeFrom', 'From {price}').replace('{price}', from)}</span>` : ''}
      </div>
      <div class="ld-sh-store-copy">
        <h2 class="ld-sh-h2">
          <span>${tr('landing.storeTitle1', 'Loved the demo?')}</span>
          <span class="ld-sh-accent">${tr('landing.storeTitle2', 'Take one home.')}</span>
        </h2>
        <p class="ld-sh-text">
          ${tr('landing.storeText', 'Everything you just tried is the display model. Your own AIMEAT is the same whole place on an address with your name on it, kept running and updated for a monthly fee, and every bit of it yours the way your house is yours.')}
        </p>
        <ul class="ld-sh-list">
          <li>${Star}<span>${tr('landing.storeLi1', 'Every AI you use, Claude, ChatGPT, local models, under one roof, working on the same memory.')}</span></li>
          <li>${Star}<span>${tr('landing.storeLi2', 'Keeping your own stuff is a joy. Nobody takes it, rents it back to you, or peeks at it.')}</span></li>
          <li>${Star}<span>${tr('landing.storeLi3', 'Sell what you build: payment rails and agent-to-agent commerce come with the house.')}</span></li>
        </ul>
        ${ladder.length > 0 ? html`
          <div class="ld-sh-tiers">
            ${ladder.map((tier) => html`
              <div class="ld-sh-tier" key=${tier.name}>
                <span class="ld-sh-tier-name">${tier.name}</span>
                <span class="ld-sh-tier-price">${tier.price} €</span>
                <span class="ld-sh-tier-unit">${tr('landing.storePerMonth', 'per month')}</span>
              </div>`)}
          </div>` : ''}
        ${store ? html`<a class="ld-sh-btn ld-sh-btn--ink" href=${store} target="_blank" rel="noopener">${tr('landing.storeCta', 'Step into the store →')}</a>` : ''}
      </div>
    </section>`;
}

/** Safe is not a word here. It is a list. */
export function TrustList({ navigate }) {
  const items = [
    [tr('landing.trust1Title', 'Every action signed'), tr('landing.trust1Text', 'Whatever a person, an app or an AI does here carries the name of who did it, and you can read the trail.')],
    [tr('landing.trust2Title', 'AI content labeled'), tr('landing.trust2Text', 'What a model wrote says so where a person reads it, with a record of how it was made. The EU AI Act disclosure is served, live.')],
    [tr('landing.trust3Title', 'Consent you can revoke'), tr('landing.trust3Text', 'A helper reaches exactly what you handed it. Taking a permission back is one click, and it holds.')],
    [tr('landing.trust4Title', 'GDPR as buttons'), tr('landing.trust4Text', 'Export and delete are things you press, in Europe, on European terms.')],
  ];
  return html`
    <section class="ld-sh-trust">
      <h2 class="ld-sh-trust-title">${tr('landing.trustTitle', 'Safe is not a word here. It is a list.')}</h2>
      <div class="ld-sh-trust-grid">
        ${items.map(([title, text]) => html`
          <div class="ld-sh-trust-item" key=${title}>
            <span class="ld-sh-trust-item-title">${title}</span>
            <span class="ld-sh-trust-item-text">${text}</span>
          </div>`)}
      </div>
      <p class="ld-sh-trust-line">
        ${tr('landing.trustEu', 'Built in Finland, in the EU: the rules this list names are the ones we live under ourselves.')}
        ${' '}
        <a href="/v1/transparency" onClick=${(e) => { e.preventDefault(); navigate('/v1/transparency'); }}>
          ${tr('landing.transCta', 'How this node marks AI content →')}
        </a>
      </p>
    </section>`;
}

/**
 * Two rooms: adopt agents from the incubator, and nobody in it but you. The incubator's "start
 * here" box exists only when the node has an incubator address (siteLinks.incubator).
 */
export function Rooms() {
  const incubator = siteLink('incubator');
  let incubatorHost = '';
  if (incubator) {
    // A link that is not a URL still renders, as itself: the operator typed it, and hiding the
    // door over a missing scheme would be a worse answer than showing the text they wrote.
    try { incubatorHost = new URL(incubator).host; } catch (err) { swallowed('showroom: incubator url', err); incubatorHost = incubator; }
  }
  return html`
    <section class="ld-sh-rooms">
      <div class="ld-sh-room ld-sh-room--sun">
        <img class="ld-sh-room-img" src="/img/wiifm/incubator.jpg" width="600" height="600" loading="lazy"
          alt=${tr('landing.roomIncAlt', 'A delighted scientist in a hatchery full of robot chicks hatching from glowing eggs')} />
        <h3 class="ld-sh-h3">${tr('landing.roomIncTitle', 'Adopt agents from the incubator')}</h3>
        <p class="ld-sh-text">
          ${tr('landing.roomIncText', 'A helper with a name, its own permissions and its own working hours: all of them. Adopt one, then a second. This is how one person starts moving like a crew.')}
        </p>
        ${hasSite('incubator') ? html`
          <div class="ld-sh-box">
            <span class="ld-sh-box-label">${tr('landing.roomIncStart', 'Start here:')}</span>
            ${' '}${tr('landing.roomIncStartText', 'the incubator at')}${' '}
            <a href=${incubator} target="_blank" rel="noopener">${incubatorHost}</a>
            ${' '}${tr('landing.roomIncStartTail', 'hatches helpers ready to work, and the demo lets you watch them earn their name before you take one home.')}
          </div>` : ''}
      </div>
      <div class="ld-sh-room ld-sh-room--coral">
        <img class="ld-sh-room-img" src="/img/frontdemo/clubhouse.jpg" width="600" height="600" loading="lazy"
          alt=${tr('landing.roomClubAlt', 'A warm treehouse clubhouse at dusk where a friendly robot doorman lifts a velvet rope for a group of friends')} />
        <h3 class="ld-sh-h3">${tr('landing.roomClubTitle', 'Nobody in it but you')}</h3>
        <p class="ld-sh-text">
          ${tr('landing.roomClubText', 'This demo is a public square. Your own AIMEAT is the opposite: a clubhouse with one name on the deed. Invite people in when you feel like company, or build alone in peace.')}
        </p>
        <div class="ld-sh-box">
          <span class="ld-sh-box-label">${tr('landing.roomClubRulesLabel', 'The house rules, all two of them:')}</span>
          ${' '}${tr('landing.roomClubRules', 'what you make there is yours, and the door opens only from the inside. Everything else you decide as you go.')}
        </div>
      </div>
    </section>`;
}
