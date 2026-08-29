/**
 * @file connect-story.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connect the AI you already use, as a page (/v1/connect-your-ai): four beats in the
 *   order the guided path (profile → Connections, the Hello MCP panel) makes them happen, told
 *   before the account exists. It exists because the front page's "Connect the AI you already
 *   use" door led a signed-out visitor to an empty profile that said "sign in to see your
 *   agents", which is the road ending in a wall. The page tells the road, then opens the door:
 *   create the account or sign in, and land on the guided path itself.
 *
 *   THE COPY IS THE DOOR'S. The tool list and the five-minute promise are the same keys the
 *   front page's connect block reads (landing.connectWorks, landing.connectSub), so the page and
 *   the door cannot say different things.
 * @structure BEATS · BeatRail · default export ConnectStory({ navigate })
 * @usage routed at /v1/connect-your-ai by spa.html; listed in routes/portal.ts spaRoutes
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial, on the build-story page's shapes (build-story.css, bs- prefix).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { showLoginModal, getSession } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const BEATS = [
  { id: 'pick', label: () => tr('connectStory.beat1', 'Pick the AI you already use') },
  { id: 'plug', label: () => tr('connectStory.beat2', 'Plug it in') },
  { id: 'prove', label: () => tr('connectStory.beat3', 'Prove it with one prompt') },
  { id: 'run', label: () => tr('connectStory.beat4', 'Run everything from your chat') },
];

const PLATFORMS = [
  { id: 'claude', name: 'Claude' },
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'copilot', name: 'Copilot' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'grok', name: 'Grok' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'lmstudio', name: 'LM Studio' },
  { id: 'other', name: () => tr('connectStory.otherTool', 'Your own') },
];

const GUIDED_PATH = '/v1/profile?tab=mcp';

/** The four beats, stuck to the side; the one on screen is lit. */
function BeatRail({ current }) {
  const go = (id) => (e) => { e.preventDefault(); document.getElementById('beat-' + id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  return html`
    <nav class="bs-rail" aria-label=${tr('connectStory.railLabel', 'The four beats')}>
      <span class="bs-rail-label">${tr('connectStory.railLabel', 'The four beats')}</span>
      ${BEATS.map((b, i) => html`
        <a key=${b.id} class=${`bs-rail-item ${current === b.id ? 'is-on' : ''}`} href=${'#beat-' + b.id} onClick=${go(b.id)}>
          <span class="bs-rail-num">${i + 1}</span>${b.label()}
        </a>`)}
    </nav>`;
}

export default function ConnectStory({ navigate }) {
  const [current, setCurrent] = useState('pick');
  const [signedIn, setSignedIn] = useState(false);

  // A signed-in reader gets the real path in the door at the end, not another account form.
  useEffect(() => {
    try { setSignedIn(!!getSession()); } catch (err) { swallowed('connect-story: session', err); }
  }, []);

  // Light the beat on screen. The sections are observed rather than the scroll position read,
  // because the page scrolls inside .page-content and window.scrollY says nothing here.
  useEffect(() => {
    const sections = BEATS.map(b => document.getElementById('beat-' + b.id)).filter(Boolean);
    if (!sections.length || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (hit) setCurrent(hit.target.id.replace('beat-', ''));
    }, { threshold: [0.25, 0.5] });
    sections.forEach(s => io.observe(s));
    return () => io.disconnect();
  }, []);

  const toDoor = (e) => { e.preventDefault(); document.getElementById('cs-door')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const toGuidedPath = () => { window.dispatchEvent(new Event('aimeat-auth-change')); navigate(GUIDED_PATH); };
  // The auth lib loads beside the page; a click that lands before it is ready is retried for a
  // couple of seconds before the full-page sign-in route takes over, so the door never goes dead.
  const tryOpen = (tab, tries) => {
    if (showLoginModal({ tab, onLogin: toGuidedPath })) return;
    if (tries > 0) setTimeout(() => tryOpen(tab, tries - 1), 250);
    else navigate('/v1/portal');
  };
  const open = (tab) => (e) => {
    e.preventDefault();
    if (signedIn) { navigate(GUIDED_PATH); return; }
    tryOpen(tab, 8);
  };

  return html`
    <div class="ld bs cs">
      <section class="bs-head">
        <div class="bs-head-copy">
          <span class="ld-sh-kicker">${tr('connectStory.kicker', 'Five minutes. Any AI you already pay for, or the free one.')}</span>
          <h1 class="bs-title">
            <span>${tr('connectStory.title1', 'Plug in the AI')}</span>
            <span>${tr('connectStory.title2', 'you already use')}</span>
          </h1>
          <p class="ld-sh-position">${tr('connectStory.position', 'After this, you run all of it from your own chat.')}</p>
          <p class="bs-lead">${tr('connectStory.lead', 'Here is the whole road, shown once, before you make an account. Read it through, or skip to the door at the bottom.')}</p>
          <a class="ld-sh-door" href="#cs-door" onClick=${toDoor}>${tr('connectStory.skip', 'Skip to the door ↓')}</a>
        </div>
        <${BeatRail} current=${current} />
      </section>

      <section class="bs-beat" id="beat-pick">
        <div class="bs-beat-copy">
          <span class="bs-num">1</span>
          <h2 class="ld-sh-h2"><span>${tr('connectStory.b1Title1', 'Pick the AI')}</span><span class="ld-sh-accent">${tr('connectStory.b1Title2', 'you already use')}</span></h2>
          <p class="ld-sh-text">${tr('connectStory.b1Text', 'No new subscription and no new app to learn. The chat you already have gets a door into this place; you keep talking to it the way you always do.')}</p>
          <div class="cs-platforms" role="list">
            ${PLATFORMS.map(p => html`
              <span key=${p.id} class="cs-platform" role="listitem">
                <img class="cs-platform-icon" src=${'/img/platforms/' + p.id + '.png'} width="28" height="28" alt="" loading="lazy" />
                <span>${typeof p.name === 'function' ? p.name() : p.name}</span>
              </span>`)}
          </div>
          <div class="ld-sh-box"><span class="ld-sh-box-label">${tr('connectStory.b1WorksLabel', 'Works with:')}</span> ${tr('landing.connectWorks', 'Works with Claude (a free account is enough to start), ChatGPT on a paid plan, Claude Code, Cursor, VS Code, Codex CLI and Grok. The guided path checks your setup at every step.')}</div>
        </div>
        <img class="bs-picture bs-picture--sun" src="/img/connect-story/beat1-pick.jpg" width="1200" height="900" loading="lazy"
          alt=${tr('connectStory.b1Alt', 'A person at a bright showroom counter choosing between four friendly retro robots, each holding up a small name sign')} />
      </section>

      <section class="bs-beat bs-beat--flip" id="beat-plug">
        <img class="bs-picture bs-picture--coral" src="/img/connect-story/beat2-plug.jpg" width="1200" height="900" loading="lazy"
          alt=${tr('connectStory.b2Alt', 'A friendly retro robot plugs a glowing coral cable into a wall socket shaped like a small house while a delighted person watches')} />
        <div class="bs-beat-copy">
          <span class="bs-num">2</span>
          <h2 class="ld-sh-h2"><span>${tr('connectStory.b2Title1', 'Plug it in:')}</span><span class="ld-sh-accent">${tr('connectStory.b2Title2', 'one address, one minute')}</span></h2>
          <p class="ld-sh-text">${tr('connectStory.b2Text', 'Every AI tool has a place for connectors. You give it this place’s address, it asks you to approve the connection, and you say yes. The guided path shows the exact clicks for your tool, and checks each one as you go.')}</p>
          <div class="cs-steps">
            <span class="cs-step"><span class="cs-step-n">1</span>${tr('landing.connectLoop1', 'Add this service as a connector in your AI tool')}</span>
            <span class="cs-step"><span class="cs-step-n">2</span>${tr('connectStory.b2Approve', 'Approve it once, here, with your own account')}</span>
            <span class="cs-step"><span class="cs-step-n">3</span>${tr('connectStory.b2Done', 'Done. Nothing to install, nothing to keep running')}</span>
          </div>
        </div>
      </section>

      <section class="bs-beat" id="beat-prove">
        <div class="bs-beat-copy">
          <span class="bs-num">3</span>
          <h2 class="ld-sh-h2"><span>${tr('connectStory.b3Title1', 'Prove it')}</span><span class="ld-sh-accent">${tr('connectStory.b3Title2', 'with one prompt')}</span></h2>
          <p class="ld-sh-text">${tr('connectStory.b3Text', 'A connection that looks fine and is not there fails quietly: the AI keeps answering and nothing errors. So the path hands you one prompt, you paste it into your chat, and one button here shows the answer. When it lands, you are in.')}</p>
          <div class="ld-sh-box"><span class="ld-sh-box-label">${tr('connectStory.b3WhyLabel', 'Why this step exists:')}</span> ${tr('connectStory.b3Why', 'because a silent failure would send you off building on top of nothing. Two minutes now, and you never wonder again.')}</div>
        </div>
        <img class="bs-picture bs-picture--ink" src="/img/connect-story/beat3-prove.jpg" width="1200" height="900" loading="lazy"
          alt=${tr('connectStory.b3Alt', 'A person types one line into a huge speech bubble while a retro robot holds up a big green check-mark sign')} />
      </section>

      <section class="bs-beat bs-beat--flip" id="beat-run">
        <img class="bs-picture bs-picture--sun" src="/img/connect-story/beat4-run.jpg" width="1200" height="900" loading="lazy"
          alt=${tr('connectStory.b4Alt', 'A relaxed person chatting on a phone in a garden chair while a small crew of retro robots carries notes, documents and framed web pages into a bright little house')} />
        <div class="bs-beat-copy">
          <span class="bs-num">4</span>
          <h2 class="ld-sh-h2"><span>${tr('connectStory.b4Title1', 'Then everything')}</span><span class="ld-sh-accent">${tr('connectStory.b4Title2', 'runs from your chat')}</span></h2>
          <p class="ld-sh-text">${tr('connectStory.b4Text', 'Your notes, your documents, what your team knows, the apps you build and the agents you adopt: your AI reads and writes them here, in your own space, under permissions you gave and can take back. You never have to open this site again to get work done. It stays here for when you want to look.')}</p>
          <div class="ld-sh-box"><span class="ld-sh-box-label">${tr('landing.connectSub', 'Five minutes. After it, you run all of this from your own chat: notes, documents, team knowledge, agents.')}</span></div>
        </div>
      </section>

      <section class="bs-builder cs-door" id="cs-door">
        <h2 class="ld-sh-h2">${tr('connectStory.doorTitle', 'The door')}</h2>
        <p class="ld-sh-text bs-builder-lead">${signedIn
          ? tr('connectStory.doorSignedIn', 'You are signed in, so the guided path is one click away.')
          : tr('connectStory.doorLead', 'The connection is to YOUR space, so there has to be one: an account takes a minute, and the guided path opens right after.')}</p>
        <div class="cs-door-actions">
          ${signedIn
            ? html`<a class="ld-sh-btn ld-sh-btn--hot" href=${GUIDED_PATH} onClick=${open('signin')}>${tr('landing.connectCta', 'Open the guided path →')}</a>`
            : html`
              <a class="ld-sh-btn ld-sh-btn--hot" href="/v1/portal" onClick=${open('register')}>${tr('connectStory.doorCreate', 'Create your account →')}</a>
              <a class="ld-sh-door" href="/v1/portal" onClick=${open('signin')}>${tr('connectStory.doorSignIn', 'I already have one, sign me in →')}</a>`}
        </div>
      </section>
    </div>`;
}
