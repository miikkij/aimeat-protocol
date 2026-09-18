/**
 * @file landing-v2.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The front page as the message frame says it (2026-09-14, TARGET-075): say what you
 *   want, then make sure it happens, and AIMEAT is where it happens. The page keeps the showroom's
 *   face (ink, sun, coral, capital headlines, hard shadows, the 80s pictures) and changes the order
 *   and the words. Every sentence names an outcome, never a capability.
 *
 *   THIS FILE HOLDS SECTIONS, NOT A PAGE. The front page is a layout of blocks the operator can
 *   arrange (views/surface/renderer.js), and views/surface/blocks-portal.js adapts these sections
 *   into it; views/landing.js keeps the same order as its fallback for the day the layout cannot be
 *   read. The showroom's own blocks (the counters, the store, the safety list) are reused where the
 *   frame keeps them.
 *
 *   The default order (operators can save another): the hero (the claim, the wish box, the two doors, the picture) · the
 *   counters · ten seconds under the hood (six outcomes, then the question, then the answer that is
 *   the hinge of the whole page) · the slide projector (landing-v2-projector.js) · prompts and what
 *   they produced (landing-v2-cards.js) · the wall, the community first (same file) · the store ·
 *   ownership and AI processing limits · the safety list · the last word.
 * @structure Hero2 · WishBox2 · TenSeconds · LinuxLine · Close2
 * @usage import { Hero2, TenSeconds, LinuxLine, Close2 } from '/views/landing-v2.js';
 * @version-history
 *   v1.2.0 - 2026-09-17 - TARGET-078: ownership, AI processing limits and continuity in one block.
 *   v1.1.0 — 2026-09-15 — Built here, with itself: the kicker says it, and the ten seconds end on a
 *     frame of this very page. Jouni, as the proof of the hero's claim.
 *   v1.0.0 — 2026-09-14 — The front page. The sections are exported for the block registry and the
 *     page composition moved to the layout; /v1/portal-v2 is gone because /v1/portal is this now.
 *   v0.1.0 — 2026-09-14 — Design round, built to "Viestikehys normipopulaatiolle" (Marketing,
 *     doc-mu0fimbx8fkn) and TARGET-075.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { storeHref } from '/js/site.js';
import { showLoginModal } from '/js/services/auth.js';
import { storeWish } from './landing-doors.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const hasJwt = () => {
  try { const raw = localStorage.getItem('aimeat_session'); return !!(raw && JSON.parse(raw)?.jwt); }
  catch (err) { swallowed('landing-v2: session read', err); return false; }
};

/**
 * The wish box with the frame's question. The showroom's box asks what to build; this one asks
 * what to get done, because the person is the operator and the building is the AI's part. The
 * rail underneath is the same: the wish is stored, a signed-in person lands in the chat with it,
 * a new person makes an account on the way and loses nothing (landing.js's auth listener moves
 * them on once the account exists).
 */
function WishBox2({ navigate }) {
  const [wish, setWish] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('wish')?.trim() || ''; }
    catch (err) { swallowed('landing-v2: url wish', err); return ''; }
  });
  const go = (e) => {
    e.preventDefault();
    const text = wish.trim();
    if (!text) return;
    storeWish(text);
    if (hasJwt()) { navigate('/v1/chat'); return; }
    showLoginModal({ tab: 'register', onLogin: () => window.dispatchEvent(new Event('aimeat-auth-change')) });
  };
  return html`
    <form class="ld-wish" onSubmit=${go}>
      <input class="ld-wish-input" type="text" maxlength="500" value=${wish}
        onInput=${(e) => setWish(e.target.value)}
        placeholder=${tr('landing2.wishPh', 'What do you want done?')}
        aria-label=${tr('landing2.wishPh', 'What do you want done?')} />
      <button class="btn-primary ld-wish-go" type="submit">${tr('landing.wishGo', 'GO')}</button>
    </form>`;
}

/**
 * The hero: the frame's claim in two lines, the one sentence under it, the four steps as one
 * paragraph, the wish box, and the two doors with "plug in the AI you already use" first, because
 * that is the step the whole page turns on. The picture and the sticker are the showroom's;
 * `picture` is the block's one setting.
 */
export function Hero2({ navigate, picture = true }) {
  const store = storeHref();
  const go = (path) => (e) => { e.preventDefault(); navigate(path); };
  // The whole feature list's row count, from the file the build writes next to the list itself;
  // until it arrives, or if it never does, the link says the same thing without a number.
  const [everyCount, setEveryCount] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch('/data/everything-meta.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j && Number.isFinite(j.rows)) setEveryCount(j.rows); })
      .catch((err) => swallowed('landing-v2: everything meta', err));
    return () => { alive = false; };
  }, []);
  const everyLabel = everyCount > 0
    ? tr('landing2.everythingLink', 'See everything AIMEAT can do, all {n} →').replace('{n}', String(everyCount))
    : tr('landing2.everythingLinkNoCount', 'See everything AIMEAT can do →');
  return html`
    <section class="ld-sh-hero">
      <div class="ld-v2-kickerrow">
        <span class="ld-sh-kicker">${tr('landing.showKicker', 'This is the demo. It runs for real, every day.')} ${tr('landing2.kickerBuilt', 'Built here, with itself.')}</span>
        <a class="ld-v2-everything showroom-door" href="/v1/everything" target="_blank" rel="noopener">${everyLabel}</a>
      </div>
      <h1 class="ld-sh-title ld-v2-title">
        <span>${tr('landing2.title1', 'Say what you want.')}</span>
        <span>${tr('landing2.title2', 'Then make sure it happens.')}</span>
      </h1>
      <p class="ld-sh-position">${tr('landing2.position', 'That is the whole job now. AIMEAT is where it happens.')}</p>
      <div class="ld-sh-hero-cols">
        <p class="ld-sh-sub">${tr('landing2.body', 'You already talk to an AI. It is smart, but it works alone and it forgets. Here it gets hands, a memory and colleagues. You learn nothing new: you keep talking to the same AI, and it picks up its powers from here. Everything it does happens in your place, with your permission, on your record. So you can let others in.')}</p>
        <div class="ld-sh-action">
          <${WishBox2} navigate=${navigate} />
          <p class="ld-sh-lead">${tr('landing2.wishLead', 'Type it, hit GO. A chat opens and starts on it with you. New here? You get an account on the way, and nothing you typed is lost.')}</p>
          <div class="ld-v2-doors">
            <a class="ld-sh-btn showroom-slab ld-sh-btn--hot showroom-slab--hot" href="/v1/connect-your-ai" onClick=${go('/v1/connect-your-ai')}>
              ${tr('landing2.plugIn', 'Plug in the AI you already use →')}
            </a>
            ${store ? html`<a class="ld-sh-door showroom-door" href=${store} target="_blank" rel="noopener">${tr('landing2.getOwn', 'Get your own AIMEAT →')}</a>` : ''}
          </div>
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

/** The six outcomes, in the frame's order, then the question, then the answer. */
const FRAMES = [
  ['landing2.ten1', 'A website went up.'],
  ['landing2.ten2', 'A shop opened.'],
  ['landing2.ten3', 'An auction closed.'],
  ['landing2.ten4', 'The report went out.'],
  ['landing2.ten5', 'A 3D world got built.'],
  ['landing2.ten6', 'An agent woke at seven and did it again.'],
];
const MORE = ['landing2.tenMore', 'And more. But why should you care?'];
const ANSWER = ['landing2.tenAnswer', 'Because your AI gets these powers, and you get them through it.'];
/** The last frame: this very page, as the proof of the claim. The picture is scripts/projector-shots.ts --only front. */
const SELF = ['landing2.tenSelf', 'Including this page. Built here, with itself.'];
const SELF_SHOT = '/img/frontdemo/front-page.png';
const TEN_STEP_MS = 1400;

/**
 * Ten seconds under the hood: one outcome at a time, quickly, then a black frame with the
 * question, then the answer, then this page itself as the last proof. The run starts when the
 * section scrolls into view and stops at the last frame; a click on the stage steps it by hand,
 * and "play again" runs it once more. With reduced motion every frame is on screen at once,
 * because a sequence that cannot be paused is not one everybody can read.
 */
export function TenSeconds({ navigate }) {
  const total = FRAMES.length + 3;
  const [shotMissing, setShotMissing] = useState(false);
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const ref = useRef(null);
  const reduced = (() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (err) { swallowed('landing-v2: reduced motion', err); return false; }
  })();

  // Start once, when the section is in view; a page that plays its film off-screen plays to nobody.
  useEffect(() => {
    if (reduced || started || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some(en => en.isIntersecting)) { setStarted(true); setRunning(true); io.disconnect(); }
    }, { threshold: 0.5 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [reduced, started]);

  useEffect(() => {
    if (!running) return undefined;
    const iv = setInterval(() => {
      setIdx((i) => {
        if (i + 1 >= total - 1) { setRunning(false); return total - 1; }
        return i + 1;
      });
    }, TEN_STEP_MS);
    return () => clearInterval(iv);
  }, [running, total]);

  const replay = () => { setIdx(0); setRunning(true); };
  const step = () => { setRunning(false); setIdx((i) => (i + 1) % total); };
  const phase = idx < FRAMES.length ? 'frame'
    : idx === FRAMES.length ? 'more'
    : idx === FRAMES.length + 1 ? 'answer'
    : 'self';
  const text = idx < FRAMES.length ? tr(...FRAMES[idx])
    : idx === FRAMES.length ? tr(...MORE)
    : idx === FRAMES.length + 1 ? tr(...ANSWER)
    : tr(...SELF);
  // The last frame carries the page's own picture behind its sentence; a missing file leaves a
  // named placeholder rather than a broken image.
  const selfPicture = shotMissing
    ? html`<span class="ld-v2-self-ph">${tr('landing2.tenSelfPh', 'aimeat.io front page')}</span>`
    : html`<img class="ld-v2-self-img" src=${SELF_SHOT} alt=${tr('landing2.tenSelfPh', 'aimeat.io front page')} onError=${() => setShotMissing(true)} />`;

  return html`
    <section class="ld-v2-ten" ref=${ref}>
      <h2 class="ld-sh-h2 ld-v2-h2-row">
        <span>${tr('landing2.tenTitle1', 'Ten seconds')}</span>
        <span class="ld-sh-accent">${tr('landing2.tenTitle2', 'under the hood')}</span>
      </h2>
      ${reduced ? html`
        <div class="ld-v2-ten-all">
          ${FRAMES.map(([k, f], i) => html`<div class=${`ld-v2-frame poster-frame ld-v2-frame--${i % 3} ${i % 3 === 0 ? 'showroom-slab--sun' : ''}`} key=${k}>${tr(k, f)}</div>`)}
          <div class="ld-v2-frame poster-frame ld-v2-frame--more">${tr(...MORE)}</div>
          <div class="ld-v2-frame poster-frame ld-v2-frame--answer showroom-slab--sun">${tr(...ANSWER)}</div>
          <div class="ld-v2-frame poster-frame ld-v2-frame--self">${selfPicture}<span class="ld-v2-self-text">${tr(...SELF)}</span></div>
        </div>` : html`
        <div class=${`ld-v2-stage ld-v2-stage--${phase} ld-v2-frame--${idx % 3} ${(phase === 'frame' && idx % 3 === 0) || phase === 'answer' ? 'showroom-slab--sun' : ''}`} role="button" tabindex="0"
          aria-live="polite" onClick=${step}
          onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(); } }}>
          ${phase === 'self' ? html`<div class="ld-v2-self" key="self">${selfPicture}<span class="ld-v2-self-text">${text}</span></div>`
            : html`<span class="ld-v2-stage-text" key=${idx}>${text}</span>`}
        </div>
        <div class="ld-v2-ten-bar">
          <div class="ld-v2-dots" aria-hidden="true">
            ${Array.from({ length: total }, (_, i) => html`<span class=${`ld-v2-dot ${i === idx ? 'is-on' : ''} ${i >= FRAMES.length ? 'ld-v2-dot--end' : ''}`} key=${i}></span>`)}
          </div>
          <button type="button" class="btn-outline ld-v2-replay" onClick=${replay}>${tr('landing2.tenReplay', 'Play it again')}</button>
        </div>`}
      <p class="ld-v2-ten-after">
        ${tr('landing2.tenAfter', 'Nothing new to learn. You keep talking to the AI you already use, and it picks its powers up here.')}
        ${' '}
        <a href="/v1/connect-your-ai" onClick=${(e) => { e.preventDefault(); navigate('/v1/connect-your-ai'); }}>${tr('landing2.plugIn', 'Plug in the AI you already use →')}</a>
      </p>
    </section>`;
}

/**
 * Ownership with its hosting, AI processing and licence limits. The stable block id lets
 * operators move it without losing their saved layout.
 */
export function LinuxLine() {
  const continuity = tr('landing2.linuxContinuity', 'The protocol and server software are open source under the MIT license. What you build remains yours. If we are sold or stop operating, you can continue running that software yourself with your data.');
  const [beforeMit, afterMit] = continuity.split('MIT');
  return html`
    <section class="ld-sh-box poster-aside ld-v2-linux">
      <h2 class="ld-sh-box-label">${tr('landing2.linuxLabel', 'You own your data and your AI memory.')}</h2>
      <p>${tr('landing2.linuxText', 'Run your own AIMEAT on a server in the EU or on your own machine. Your data and saved AI memory are stored there. You decide who can access them.')}</p>
      <p>${tr('landing2.linuxAi', 'Cloud AI processes the information you send to it, even when you use your own API key. A local model lets you keep AI processing on your own machine.')}</p>
      <p>${afterMit === undefined ? continuity : html`${beforeMit}<a href="https://github.com/miikkij/aimeat-protocol/blob/main/LICENSE" target="_blank" rel="noopener">MIT</a>${afterMit}`}</p>
      <a class="showroom-door" href="/v1/business">${tr('landing2.linuxBusiness', 'AIMEAT for your business →')}</a>
      <!-- "or on your own machine" above had no way to act on it until 2026-09-18: the desktop
           app was built but nothing on this site linked to it. The address carries no version,
           because the release workflow copies every new installer to this same name. -->
      <a class="showroom-door" href="https://github.com/miikkij/aimeat-protocol/releases/download/desktop-latest/AIMEAT-Personal-Node-setup.exe">${tr('landing.heroGetApp', 'Put it on your computer (Windows) →')}</a>
    </section>`;
}

/**
 * The last word: the name's reading guide as one line, and the showroom's two buttons.
 * "Founder #NN/50" is the frame's own wording for the founding campaign; the number comes from the
 * store once the two pages are joined.
 */
export function Close2() {
  const store = storeHref();
  const backToTop = (e) => {
    e.preventDefault();
    try {
      const input = /** @type {HTMLElement|null} */ (document.querySelector('.ld-wish-input'));
      if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus({ preventScroll: true }); }
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { swallowed('landing-v2: back to top', err); }
  };
  return html`
    <section class="ld-sh-close">
      <p class="ld-v2-close-line">
        <span>${tr('landing2.closeWork', 'AI & me at work.')}</span>
        <span>${tr('landing2.closeShop', 'AI & me at the shop.')}</span>
        <span>${tr('landing2.closeSeven', 'AI & me at 7 am.')}</span>
        <span>${tr('landing2.closeStart', 'AI & me at the start, Founder #NN/50.')}</span>
      </p>
      <div class="ld-sh-close-actions">
        <a class="ld-sh-btn showroom-slab ld-sh-btn--hot showroom-slab--hot" href="#top" onClick=${backToTop}>${tr('landing.closeDemo', 'Into the demo')}</a>
        ${store ? html`<a class="ld-sh-btn showroom-slab ld-sh-btn--sun showroom-slab--sun" href=${store} target="_blank" rel="noopener">${tr('landing.closeStore', 'Into the store')}</a>` : ''}
      </div>
    </section>`;
}
