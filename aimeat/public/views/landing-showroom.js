/**
 * @file landing-showroom.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The front page as a showroom (2026-08-28): the visitor drives a fully working AIMEAT
 *   for free, and when they like it they take one home from the store. This file holds the three
 *   sections that frame the page: the hero at the top, the introduction to the wall of apps, and
 *   the last word at the bottom. The store, the safety list and the two rooms are in
 *   landing-showroom-rooms.js, so neither file nears the 800-line limit.
 *
 *   ONE ACTION. The wish box is the only primary control on the page. The three other doors under
 *   it (get your own, connect the AI you already use, let your AI register you) are one quiet line
 *   of links: four buttons of equal weight asked the visitor to choose before they knew enough to
 *   choose, and that is the front page this one replaces.
 *
 *   THE STORE IS AN ADDRESS THIS NODE IS TOLD, NOT A PAGE IT HAS. Every "get your own" here reads
 *   storeHref() and hides itself when the node has no store, because the store is its own AIMEAT
 *   instance and the one place a price exists.
 *
 *   The pictures are the showroom set in /img/frontdemo/ (already shipped for the static demo
 *   front), so a node renders this page with nothing to configure.
 * @structure ShowroomHero · WallIntro · ShowroomClose · AgentDoor (private)
 * @usage import { ShowroomHero, WallIntro, ShowroomClose } from '/views/landing-showroom.js';
 * @version-history
 *   v1.0.1 — 2026-08-29 — The connect door leads to the connect story (/v1/connect-your-ai): a signed-out
 *     visitor used to land on an empty profile that said sign in.
 *   v1.0.0 — 2026-08-28 — Initial, built to the design canvas "AIMEAT Front Page" (direction A).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { siteLink, hasSite, storeHref } from '/js/site.js';
import { showLoginModal } from '/js/services/auth.js';
import { CopyButton } from '/components/CopyButton.js';
import { WishBox } from '/views/landing-doors.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * The third door, opened from its link: the prompt a visitor pastes into their own AI so that it
 * registers them here. The same prompt the old front door carried (GET /v1/prompts/agent-onboard),
 * fetched when the door is opened rather than on every page view.
 */
function AgentDoor({ open }) {
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    if (!open || prompt) return undefined;
    let alive = true;
    apiGet('/v1/prompts/agent-onboard')
      .then(r => { if (alive) setPrompt(r?.data?.prompt || ''); })
      .catch(e => swallowed('showroom: agent-onboard prompt', e));
    return () => { alive = false; };
  }, [open, prompt]);
  if (!open) return null;
  return html`
    <div class="ld-sh-agentdoor">
      <p class="ld-sh-agentdoor-sub">
        ${tr('landing.agentDoorSub', 'Copy the prompt into your own AI chat. If it can, a link arrives in your email and your account is done.')}
      </p>
      <${CopyButton}
        text=${prompt}
        className="btn-primary"
        disabled=${!prompt}
        label=${tr('landing.agentDoorCopy', 'Copy the prompt')}
        copiedLabel=${tr('landing.agentDoorCopied', 'Copied. Paste it in your AI chat')} />
      <p class="ld-sh-agentdoor-note">
        ${tr('landing.agentDoorAfter', 'It will ask you for your email address and nothing else. You choose your own username afterwards, from the link.')}
        ${' '}
        ${/* Its own key, not the front door's: there the register control sits below this note, here it sits above. */''}
        ${tr('landing.showAgentDoorCannot', 'If it says it cannot, that is a fine answer. Register your home from the link above instead.')}
      </p>
    </div>`;
}

/**
 * The hero: the claim in one sticker and one headline, the wish box as the only action, three
 * quieter doors, and the showroom picture at full width so it carries the weight of the headline.
 * `picture` is the block's one setting.
 */
export function ShowroomHero({ navigate, picture = true }) {
  const session = useSession();
  const [agentOpen, setAgentOpen] = useState(false);
  const go = (path) => (e) => { e.preventDefault(); navigate(path); };
  const register = (e) => {
    e.preventDefault();
    // The auth modal is the real thing; the front page's listener moves a signed-in person on.
    if (!showLoginModal({ tab: 'register', onLogin: () => window.dispatchEvent(new Event('aimeat-auth-change')) })) {
      navigate('/v1/portal');
    }
  };
  const store = storeHref();

  return html`
    <section class="ld-sh-hero">
      <span class="ld-sh-kicker">${tr('landing.showKicker', 'This whole place is a demo. Everything in it is real.')}</span>
      <h1 class="ld-sh-title">
        <span>${tr('landing.showTitle1', 'Try it all.')}</span>
        <span>${tr('landing.showTitle2', 'Then own it.')}</span>
      </h1>
      <p class="ld-sh-position">${tr('landing.showPosition', 'AIMEAT, the Linux of AI. Open, self-hosted, yours.')}</p>
      <div class="ld-sh-hero-cols">
        <p class="ld-sh-sub">
          ${tr('landing.showSub', 'This is a fully working AIMEAT you can drive today, free. Build a whole system in an hour, bring every AI you already use under one roof, and let agents carry the repeat work. When you like what you see, take one home on an address with your name on it.')}
        </p>
        <div class="ld-sh-action">
          <${WishBox} navigate=${navigate} />
          <p class="ld-sh-lead">
            ${tr('landing.wishLead', 'Say what you need and press GO. You land in a chat that starts building it with you; new here, you make an account on the way and lose nothing you typed.')}
          </p>
          <div class="ld-sh-doors">
            ${store ? html`<a class="ld-sh-door" href=${store} target="_blank" rel="noopener">${tr('landing.showGetOwn', 'Get your own →')}</a>` : ''}
            <a class="ld-sh-door" href="/v1/connect-your-ai" onClick=${go('/v1/connect-your-ai')}>${tr('landing.showConnect', 'Connect the AI you already use →')}</a>
            ${session ? '' : html`
              <a class="ld-sh-door" href="#agent-door" aria-expanded=${agentOpen}
                onClick=${(e) => { e.preventDefault(); setAgentOpen(o => !o); }}>
                ${tr('landing.showAgentDoor', 'Let your AI register you →')}
              </a>
              <a class="ld-sh-door" href="/v1/portal" onClick=${register}>${tr('landing.registerHome', 'Register your home')} →</a>`}
          </div>
          <${AgentDoor} open=${agentOpen && !session} />
        </div>
      </div>
      ${picture ? html`
        <div class="ld-sh-picture">
          <img class="ld-sh-picture-img" src="/img/frontdemo/hero.jpg" width="1100" height="471"
            alt=${tr('landing.showPictureAlt', 'A grand-opening showroom: a beaming host cuts a giant ribbon while people and retro robots celebrate among glowing machines')} />
          <span class="ld-sh-sticker ld-sh-sticker--live">${tr('landing.showLive', 'Live · all real')}</span>
        </div>` : ''}
    </section>`;
}

/**
 * What the wall under it is: whole systems, built in an hour by chatting, several of which earn
 * their keep. With `money` on, the payment-rails passage follows, and the node's marketplace link
 * when it has one (siteLinks.exchange) is the live proof.
 */
export function WallIntro({ money = true }) {
  return html`
    <section class="ld-sh-wallintro">
      <img class="ld-sh-wallintro-img" src="/img/frontdemo/workfloor.jpg" width="640" height="640" loading="lazy"
        alt=${tr('landing.wallIntroAlt', 'A bright workshop floor where retro robots sort customer cards, print a morning paper and file receipts while a delighted business person watches')} />
      <div class="ld-sh-wallintro-copy">
        <h2 class="ld-sh-h2">
          ${tr('landing.wallIntroTitle1', 'Whole systems,')}
          ${' '}
          <span class="ld-sh-accent">${tr('landing.wallIntroTitle2', 'built in an hour')}</span>
        </h2>
        <p class="ld-sh-text">
          ${tr('landing.wallIntroText', 'Everything below is a real app someone created here by chatting, and several of them earn their keep: a CRM that took over from HubSpot, an auction house where agents bid for you, a morning brief that publishes itself. Open any of them. When one is close to what you need, copy it and make it your own. And when yours is good, sell it.')}
          ${' '}
          <a href="/v1/how-an-app-builds">${tr('landing.wallIntroStory', 'How an app gets built here →')}</a>
        </p>
        ${money ? html`
          <div class="ld-sh-box">
            <span class="ld-sh-box-label">${tr('landing.moneyLabel', 'Money angle, said out loud:')}</span>
            ${' '}
            ${tr('landing.moneyText', 'the payment rails are built in. Cards ride through Stripe (UCP), and x402 lets agents pay agents, so your own store or marketplace is up the same day.')}
            ${hasSite('exchange') ? html`
              ${' '}${tr('landing.moneyProof', 'Live proof:')}${' '}
              <a href=${siteLink('exchange')} target="_blank" rel="noopener">${tr('landing.moneyProofLink', 'the marketplace →')}</a>` : ''}
          </div>` : ''}
      </div>
    </section>`;
}

/**
 * The last word: the demo is free and does not mind being poked. "Into the demo" goes back up to
 * the wish box; "Into the store" exists only when the node has one.
 */
export function ShowroomClose() {
  const store = storeHref();
  const backToTop = (e) => {
    e.preventDefault();
    try {
      const input = /** @type {HTMLElement|null} */ (document.querySelector('.ld-wish-input'));
      if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus({ preventScroll: true }); }
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { swallowed('showroom: back to top', err); }
  };
  return html`
    <section class="ld-sh-close">
      <p class="ld-sh-close-text">
        ${tr('landing.closeText', 'Still reading? The demo is right there, it is free, and it does not mind being poked. Say what you need at the top of this page and watch it happen.')}
      </p>
      <div class="ld-sh-close-actions">
        <a class="ld-sh-btn ld-sh-btn--hot" href="#top" onClick=${backToTop}>${tr('landing.closeDemo', 'Into the demo')}</a>
        ${store ? html`<a class="ld-sh-btn ld-sh-btn--sun" href=${store} target="_blank" rel="noopener">${tr('landing.closeStore', 'Into the store')}</a>` : ''}
      </div>
    </section>`;
}
