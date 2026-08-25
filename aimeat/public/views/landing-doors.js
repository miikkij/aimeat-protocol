/**
 * @file landing-doors.js
 * @description The landing page's ways in, and the ownership question they lead to: the wish box
 *   ("say what you need and press GO"), the connect-your-own-AI invitation, and the owner-or-tenant
 *   hero.
 *
 *   Extracted from landing.js unchanged when that file reached 789 of its 800 allowed lines.
 *
 *   THE WISH RAIL. What the visitor types travels as sessionStorage 'aimeat.wish' and the chat
 *   composer drains it into the draft — never auto-sent, the person reads it and presses send.
 *   sessionStorage for the same reason the builder draft uses it: an unfinished thought belongs to
 *   this tab, not to the machine. Signed in it lands in the composer; signed out it survives
 *   registration and lands in the same place.
 *
 *   CONNECT IS THE SECOND DOOR, and in the chat-first model the bigger one. It was invisible on
 *   this page until 2026-08-07 — "MCP" appeared three times, never in a heading or a button, and
 *   the guided path lived behind the profile menu (UX-remake v3, P1, measured). It is named in
 *   plain language on purpose: "Hello MCP" is jargon to the person this door is for.
 * @structure storeWish · hasStoredWish · hasJwt · WishBox · ConnectInvite · BuildHero
 * @usage import { WishBox, ConnectInvite, BuildHero, storeWish, hasStoredWish } from './landing-doors.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Pure extraction from landing.js v5.3.0. No behaviour change.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { siteLink, hasSite } from '/js/site.js';
import { showLoginModal } from '/js/services/auth.js';
import { Collapsible } from '/components/Collapsible.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/* The wish rail: what the visitor typed travels as sessionStorage 'aimeat.wish' and the chat
   composer drains it into the draft — never auto-sent, the person reads it and presses send. */
const WISH_KEY = 'aimeat.wish';

export function storeWish(text) {
  try { sessionStorage.setItem(WISH_KEY, text); } catch (err) { swallowed('landing: store wish', err); }
}

export function hasStoredWish() {
  try { return !!sessionStorage.getItem(WISH_KEY); } catch (err) { swallowed('landing: read wish', err); return false; }
}

function hasJwt() {
  try { const raw = localStorage.getItem('aimeat_session'); return !!(raw && JSON.parse(raw)?.jwt); }
  catch (err) { swallowed('landing: read session', err); return false; }
}

/* One field, one button. The answer to "what is this place" is the visitor's own need coming
   back as a thing, and this is the door that promise walks through: signed in you land in the
   chat with your words already in the composer, new here you register on the way and land in
   the same place. */
export function WishBox({ navigate }) {
  // Prefilled from ?wish= so the wiifm page's GO box and this one are the same box.
  const [wish, setWish] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('wish')?.trim() || ''; }
    catch (err) { swallowed('landing: url wish', err); return ''; }
  });

  const go = (e) => {
    e.preventDefault();
    const text = wish.trim();
    if (!text) return;
    storeWish(text);
    if (hasJwt()) { navigate('/v1/chat'); return; }
    // The auth modal is the real thing; Landing's auth-change listener routes to the chat
    // when a wish is waiting. If the auth library has not loaded, the wish keeps sitting in
    // the box — a dead click, but never a lost sentence.
    showLoginModal({ tab: 'register', onLogin: () => window.dispatchEvent(new Event('aimeat-auth-change')) });
  };

  return html`
    <form class="ld-wish" onSubmit=${go}>
      <input class="ld-wish-input" type="text" maxlength="500" value=${wish}
        onInput=${(e) => setWish(e.target.value)}
        placeholder=${tr('landing.wishPh', 'What do you need?')}
        aria-label=${tr('landing.wishPh', 'What do you need?')} />
      <button class="btn-primary ld-wish-go" type="submit">${tr('landing.wishGo', 'GO')}</button>
    </form>
  `;
}

/**
 * The SECOND door: connect the AI you already use to this node, and the whole system runs from
 * that chat.
 */
export function ConnectInvite({ onNavigate }) {
  const [open, setOpen] = useState(false);
  return html`
    <section class="ld-invite">
      <${Collapsible}
        title=${html`
          <span class="ld-invite-title">${tr('landing.connectTitle', 'Connect the AI you already use')}</span>
          <span class="ld-invite-sub">${tr('landing.connectSub', 'Five minutes. After it, you run all of this from your own chat: notes, documents, team knowledge, agents.')}</span>
        `}
        open=${open} onToggle=${() => setOpen(o => !o)}>
        <div class="ld-loop">
          <span class="ld-loop-step">① ${tr('landing.connectLoop1', 'Add this node as a connector in your AI tool')}</span>
          <span class="ld-loop-arrow">→</span>
          <span class="ld-loop-step">② ${tr('landing.connectLoop2', 'Run one prompt that proves the connection works')}</span>
          <span class="ld-loop-arrow">→</span>
          <span class="ld-loop-step">③ ${tr('landing.connectLoop3', 'Your chat can now read and write your own space here')}</span>
        </div>
        <p class="ld-connect-note">${tr('landing.connectWorks', 'Works with Claude (a free account is enough to start), ChatGPT on a paid plan, Claude Code, Cursor, VS Code, Codex CLI and Grok. The guided path checks your setup at every step.')}</p>
        <div class="ld-connect-cta">
          <a class="btn-primary" href="/v1/profile?tab=mcp"
            onClick=${(e) => { e.preventDefault(); onNavigate('/v1/profile?tab=mcp'); }}>
            ${tr('landing.connectCta', 'Open the guided path →')}
          </a>
          <span class="ld-connect-hint">${tr('landing.connectAccount', 'Takes an account: the connection is to YOUR space, so there has to be one.')}</span>
        </div>
      <//>
    </section>
  `;
}

export function BuildHero({ onNavigate }) {
  // ONE primary action. This section used to carry four buttons of equal weight, which asks the
  // visitor to choose before they know enough to choose. It also sits BELOW the generator now, so
  // its old "Build something, free" button duplicated the copy button directly above it — the
  // remaining paths are the ones a person reaches for AFTER the ownership question lands.
  return html`
    <section class="ld-hero2">
      <p class="ld-hero2-kicker">${tr('landing.heroKicker', 'Two roles in the agent economy.')}</p>
      <h1 class="ld-hero2-title">${tr('landing.heroTitle', 'Owner, or tenant. Which one do you want to be?')}</h1>
      <p class="ld-hero2-sub">${tr('landing.heroSub', 'Your memory, your agents, your balance sheet. On a rented platform you build a tool and pay for it. Here the tool can bill someone else, and it is yours.')}</p>
      <div class="ld-hero2-cta">
        <a class="btn-primary" href="/v1/business" onClick=${(e) => { e.preventDefault(); onNavigate('/v1/business'); }}>${tr('landing.heroCtaBusiness', 'See what it does for a business →')}</a>
      </div>
      <div class="ld-hero2-more">
        <a href="https://github.com/miikkij/aimeat-protocol/releases/latest" target="_blank" rel="noopener">${tr('landing.heroGetOwn', 'Run it on your own server →')}</a>
        ${hasSite('learn') ? html`<a href=${siteLink('learn')} target="_blank" rel="noopener">${tr('landing.ecLinkShort', 'Learn it hands-on, free →')}</a>` : ''}
        <a href="/v1/pricing" onClick=${(e) => { e.preventDefault(); onNavigate('/v1/pricing'); }}>${tr('landing.heroPricing', 'Pricing →')}</a>
      </div>
    </section>
  `;
}
