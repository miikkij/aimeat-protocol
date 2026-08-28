/**
 * @file build-story.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How an app gets built here, as a page (/v1/how-an-app-builds): four beats in the
 *   order the generator's own steps happen, told with the real pieces, and the generator itself
 *   open at the end. It exists because the front page folded the builder to one line (measured:
 *   an open generator on the front page held nobody) and a stranger then never saw the road.
 *
 *   THE COPY IS THE GENERATOR'S. The track descriptions, the "paste it into any AI" line and the
 *   two doors at the end are the same keys landing-builder.js reads (landing.trackClassicDesc,
 *   landing.genStep2Hint, landing.genStep3Hint, landing.genStep3Mcp), so the story and the tool
 *   cannot say different things. The prompt the second beat copies is the node's canonical build
 *   prompt, fetched the same way the builder fetches it. Beat four shows real cards from the wall
 *   with the visitor's own slotted in among them.
 *
 *   NO CONNECTOR IS NEEDED FOR ANY OF THIS, and the page says so where it matters: that is the
 *   whole reason the prompt-driven road exists.
 * @structure BEATS · BeatRail · Beat · default export BuildStory({ navigate })
 * @usage routed at /v1/how-an-app-builds by spa.html; listed in routes/portal.ts spaRoutes
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial, built to the design canvas "Changelog and Build Story".
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { showLoginModal } from '/js/services/auth.js';
import { CopyButton } from '/components/CopyButton.js';
import { BuildInvite, fetchCanonicalBuildPrompt } from '/views/landing-builder.js';
import { escHtml } from '/js/utils.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const BEATS = [
  { id: 'say', label: () => tr('story.beat1', 'Say what you need') },
  { id: 'carry', label: () => tr('story.beat2', 'Carry the prompt to any AI') },
  { id: 'bring', label: () => tr('story.beat3', 'Bring the file back') },
  { id: 'wall', label: () => tr('story.beat4', 'It lands on the wall') },
];

/** The four beats, stuck to the side; the one on screen is lit. */
function BeatRail({ current }) {
  const go = (id) => (e) => { e.preventDefault(); document.getElementById('beat-' + id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  return html`
    <nav class="bs-rail" aria-label=${tr('story.railLabel', 'The four beats')}>
      <span class="bs-rail-label">${tr('story.railLabel', 'The four beats')}</span>
      ${BEATS.map((b, i) => html`
        <a key=${b.id} class=${`bs-rail-item ${current === b.id ? 'is-on' : ''}`} href=${'#beat-' + b.id} onClick=${go(b.id)}>
          <span class="bs-rail-num">${i + 1}</span>${b.label()}
        </a>`)}
    </nav>`;
}

export default function BuildStory({ navigate }) {
  const [current, setCurrent] = useState('say');
  const [prompt, setPrompt] = useState('');
  const [apps, setApps] = useState([]);
  const rootRef = useRef(null);

  // The prompt the second beat copies is the node's own, in the visitor's language.
  useEffect(() => {
    let alive = true;
    fetchCanonicalBuildPrompt(getLocale(), 'classic')
      .then(p => { if (alive) setPrompt(p); })
      .catch(err => swallowed('build-story: prompt', err));
    return () => { alive = false; };
  }, []);

  // Three real cards from the wall, so the fourth beat shows where the visitor's app lands.
  useEffect(() => {
    fetch('/v1/apps?sort=newest&limit=3').then(r => r.json())
      .then(j => setApps(j?.data?.apps || []))
      .catch(err => swallowed('build-story: apps', err));
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

  const register = (e) => {
    e.preventDefault();
    if (!showLoginModal({ tab: 'register', onLogin: () => window.dispatchEvent(new Event('aimeat-auth-change')) })) navigate('/v1/portal');
  };
  const toBuilder = (e) => { e.preventDefault(); document.getElementById('bs-builder')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };

  // Beat four: the visitor's own card second, among real ones.
  const wallCards = [];
  const real = apps.map(a => ({ name: a.manifest?.name || a.filename, desc: (a.manifest?.description || '').slice(0, 70), by: a.manifest?.authorDisplay || a.owner || '', shot: a.screenshot_url || '' }));
  if (real[0]) wallCards.push(real[0]);
  wallCards.push({ mine: true, name: tr('story.yourApp', 'Your app'), desc: tr('story.yourAppDesc', 'you · just now · v1'), by: '', shot: '' });
  wallCards.push(...real.slice(1, 3));

  return html`
    <div class="ld bs" ref=${rootRef}>
      <section class="bs-head">
        <div class="bs-head-copy">
          <span class="ld-sh-kicker">${tr('story.kicker', 'No coding. No connector needed.')}</span>
          <h1 class="bs-title">
            <span>${tr('story.title1', 'From a sentence')}</span>
            <span>${tr('story.title2', 'to an app on the wall')}</span>
          </h1>
          <p class="ld-sh-position">${tr('story.position', 'Four beats. Ten minutes. Any AI chat you already have.')}</p>
          <p class="bs-lead">${tr('story.lead', 'This is the whole road, shown once, with the real pieces. Read it through, or skip to the bottom where the builder is open and waiting.')}</p>
          <a class="ld-sh-door" href="#bs-builder" onClick=${toBuilder}>${tr('story.skip', 'Skip to the builder ↓')}</a>
        </div>
        <${BeatRail} current=${current} />
      </section>

      <section class="bs-beat" id="beat-say">
        <div class="bs-beat-copy">
          <span class="bs-num">1</span>
          <h2 class="ld-sh-h2"><span>${tr('story.b1Title1', 'Say what')}</span><span class="ld-sh-accent">${tr('story.b1Title2', 'you need')}</span></h2>
          <p class="ld-sh-text">${tr('story.b1Text', 'Describe the app in your own words. One line is enough; a paragraph is better. Then pick how it should be built: the proven way with templates and capability packs, or the new track with living looks your AI can rearrange later.')}</p>
          <a class="bs-ideabox" href="#bs-builder" onClick=${toBuilder}>${tr('landing.genIdeaPh', 'Describe what the app should do…')}</a>
          <div class="bs-tracks">
            <div class="bs-track">
              <span class="bs-track-name">${tr('landing.trackClassic', 'Classic')}</span>
              <span class="bs-track-desc">${tr('landing.trackClassicDesc', 'The proven way: templates, capability packs, the familiar clean style.')}</span>
            </div>
            <div class="bs-track bs-track--new">
              <span class="bs-track-name">${tr('landing.trackAtelier', 'Atelier')} <span class="ld-sh-accent">· ${tr('landing.trackNew', 'new')}</span></span>
              <span class="bs-track-desc">${tr('landing.trackAtelierDesc', 'The new track: living looks (newspaper, gallery, neon console…), layouts your AI can rearrange later without republishing, motion built in.')}</span>
            </div>
          </div>
          <div class="ld-sh-box"><span class="ld-sh-box-label">${tr('story.b1PacksLabel', 'Packs, picked for you:')}</span> ${tr('landing.genPacksHint', 'Charts, editable flow diagrams, games, 3D. Self-hosted libraries with AI instructions baked into the prompt. Your idea text pre-selects matching packs.')}</div>
        </div>
        <img class="bs-picture bs-picture--sun" src="/img/build-story/beat1-say.jpg" width="1200" height="900" loading="lazy"
          alt=${tr('story.b1Alt', 'A person at a bright workshop counter telling a friendly retro robot what they want; the robot writes it on a paper ticket')} />
      </section>

      <section class="bs-beat bs-beat--flip" id="beat-carry">
        <img class="bs-picture bs-picture--coral" src="/img/build-story/beat2-carry.jpg" width="1200" height="900" loading="lazy"
          alt=${tr('story.b2Alt', 'The person carries a glowing paper ticket across a sunny street toward a huge chat bubble on the wall of a building')} />
        <div class="bs-beat-copy">
          <span class="bs-num">2</span>
          <h2 class="ld-sh-h2"><span>${tr('story.b2Title1', 'Carry the prompt')}</span><span class="ld-sh-accent">${tr('story.b2Title2', 'to any AI')}</span></h2>
          <p class="ld-sh-text">${tr('story.b2Text', 'One button assembles the prompt: this place\'s own build guide, plus what you chose. Paste it into Claude, ChatGPT, Gemini, any chat. The AI asks a few questions, builds the app and hands you back one HTML file. Nothing here needs a connector.')}</p>
          <div class="bs-promptbox">
            <span class="bs-promptbox-label">${tr('landing.promptContains', 'This prompt contains')}</span>
            <div class="bs-chips">
              <span>${tr('story.chipGuide', 'this place\'s build guide')}</span>
              <span>${tr('story.chipIdea', 'your idea')}</span>
              <span>${tr('story.chipTemplate', 'a template, or none')}</span>
              <span>${tr('story.chipPacks', 'the packs you ticked')}</span>
              <span>${tr('story.chipPitfalls', 'the pitfalls other builders hit')}</span>
            </div>
            <pre class="bs-prompt-preview">${prompt ? escHtml(prompt.slice(0, 600)) : tr('landing.buildLoading', 'Loading the build prompt from this node…')}</pre>
            <${CopyButton} text=${prompt} disabled=${!prompt} className="btn-primary bs-copy"
              label=${tr('common.copyPrompt', 'Copy the prompt')} copiedLabel=${tr('common.copied', 'Copied')} />
          </div>
          ${/* The company-managed-account note is shown once on this page, inside the builder at
                the bottom, where the copy button a security team actually presses sits. */''}
        </div>
      </section>

      <section class="bs-beat" id="beat-bring">
        <div class="bs-beat-copy">
          <span class="bs-num">3</span>
          <h2 class="ld-sh-h2"><span>${tr('story.b3Title1', 'Bring the')}</span><span class="ld-sh-accent">${tr('story.b3Title2', 'file back')}</span></h2>
          <p class="ld-sh-text">${tr('story.b3Text', 'Got the HTML back? Two doors, and you take the one you have.')}</p>
          <div class="bs-doors">
            <div class="bs-door bs-door--coral">
              <span class="bs-door-title">${tr('story.b3ByHand', 'By hand')}</span>
              <span class="bs-door-text">${tr('landing.genStep3Hint', 'Got the code or HTML file back from the AI? Create an account, it takes a minute, then paste the code or upload the file. The app goes live at its own address and you get a link to share.')}</span>
              <a class="ld-sh-btn ld-sh-btn--ink bs-door-btn" href="/v1/portal" onClick=${register}>${tr('landing.genStep3Btn', 'Register and add your app')} →</a>
            </div>
            <div class="bs-door bs-door--ink">
              <span class="bs-door-title">${tr('story.b3ByAi', 'By your AI')}</span>
              <span class="bs-door-text">${tr('landing.genStep3Mcp', 'If the AI you pasted the prompt into is connected to this node over MCP, it can publish the app for you, with no file to move by hand.')} ${tr('story.b3Connect', 'Connecting takes five minutes and is the better road for everything after this.')}</span>
              <a class="ld-sh-door" href="/v1/profile?tab=mcp" onClick=${(e) => { e.preventDefault(); navigate('/v1/profile?tab=mcp'); }}>${tr('landing.showConnect', 'Connect the AI you already use →')}</a>
            </div>
          </div>
        </div>
        <img class="bs-picture bs-picture--ink" src="/img/build-story/beat3-bring.jpg" width="1200" height="900" loading="lazy"
          alt=${tr('story.b3Alt', 'The person walks back into the showroom carrying a glowing framed web page; a retro robot at a counter stamps it')} />
      </section>

      <section class="bs-beat bs-beat--flip" id="beat-wall">
        <div class="bs-wallmock">
          ${wallCards.map((c, i) => html`
            <div key=${i} class=${`bs-card ${c.mine ? 'bs-card--mine' : ''}`}>
              ${c.shot ? html`<img class="bs-card-shot" src=${c.shot} alt="" loading="lazy" />` : html`<div class="bs-card-shot bs-card-shot--empty"></div>`}
              <span class="bs-card-name">${c.name}</span>
              <span class="bs-card-desc">${c.desc}${c.by ? html` <span class="bs-card-by">· ${c.by}</span>` : ''}</span>
            </div>`)}
          <span class="ld-sh-sticker bs-wall-sticker">${tr('story.justPublished', 'Just published')}</span>
        </div>
        <div class="bs-beat-copy">
          <span class="bs-num">4</span>
          <h2 class="ld-sh-h2"><span>${tr('story.b4Title1', 'It lands')}</span><span class="ld-sh-accent">${tr('story.b4Title2', 'on the wall')}</span></h2>
          <p class="ld-sh-text">${tr('story.b4Text', 'Your card appears among the others, with your name, the date and a live count of opens. Anyone can open it; anyone who likes it can copy it and make it their own, the same way you can copy theirs. From here on your AI can keep it running, and when it is good, you can sell it.')}</p>
          <div class="ld-sh-box"><span class="ld-sh-box-label">${tr('story.b4ThenLabel', 'And then:')}</span> ${tr('story.b4Then', 'connect the AI you already use, and the next app, the next change and the publishing itself all happen from your own chat.')}</div>
          <img class="bs-picture bs-picture--small" src="/img/build-story/beat4-wall.jpg" width="1200" height="900" loading="lazy"
            alt=${tr('story.b4Alt', 'A bright gallery wall of framed app pictures; a retro robot on a stepladder hangs the newest frame with a yellow ribbon while a small crowd applauds')} />
        </div>
      </section>

      <section class="bs-builder" id="bs-builder">
        <h2 class="ld-sh-h2">${tr('story.builderTitle', 'The builder, open, right here')}</h2>
        <p class="ld-sh-text bs-builder-lead">${tr('story.builderLead', 'Everything above describes what happens when you press the button below. The same generator the front page used to fold into one line.')}</p>
        <${BuildInvite} openByDefault=${true} />
      </section>
    </div>`;
}
