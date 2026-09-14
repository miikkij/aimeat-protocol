/**
 * @file landing-v2-projector.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The slide projector on the front page's design round (TARGET-075): an old carousel
 *   projector with one big button. CLICK-ZIG, and the picture changes. One slide is one page of
 *   Settings & Controls or Admin and one sentence about what it did for somebody, never what it
 *   can do. Around the slide sits the word cloud: the two menus exactly as the product has them
 *   (profile.js TABS and admin.js NAV_GROUPS, the same locale keys), and the word the slide is
 *   about lights up. It runs on its own, quickly, and the button stops it.
 *
 *   THE PICTURES ARE REAL SCREENSHOTS, TAKEN LATER. Each slide looks for
 *   /img/frontdemo/projector/<where>-<id>.png; until the file exists, the slide shows the page's
 *   name on a placeholder, so the section reads and the slot is obvious.
 *
 *   THE SOUND IS SYNTHESISED. WebAudio, no file: a noise click, a square wave sliding down as the
 *   carousel turns, and a second click as the slide seats. The context is created on the first
 *   press and never before, because a browser refuses audio that nobody asked for; the automatic
 *   run is silent until then.
 *
 *   The section is optional and its title says so: this is for whoever wants to see everything.
 * @structure SETTINGS_TABS · ADMIN_GROUPS · SLIDES · clickZig · Projector
 * @usage import { Projector } from './landing-v2-projector.js';
 * @version-history
 *   v0.1.0 — 2026-09-14 — Design round, TARGET-075.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** Settings & Controls, the tab list of profile.js in its own order and with its own keys. */
const SETTINGS_TABS = [
  ['messages', 'profile.tabs.inbox'], ['contacts', 'contacts.tabLabel'], ['discover', 'discover.tabLabel'],
  ['portfolio', 'portfolio.tabLabel'], ['fleet', 'profile.tabs.fleet'], ['agents', 'profile.tabs.agents'],
  ['ecosystem', 'profile.tabs.ecosystem'], ['offers', 'profile.tabs.offers'], ['scheduler', 'profile.tabs.scheduler'],
  ['workflows', 'profile.tabs.workflows'], ['chatsessions', 'profile.tabs.chatSessions'], ['mcp', 'profile.tabs.mcp'],
  ['wallet', 'profile.tabs.wallet'], ['usage', 'profile.tabs.usage'], ['pnl', 'profile.tabs.pnl'],
  ['companies', 'profile.tabs.companies'], ['knowledge', 'knowledge.tabLabel'], ['skills', 'skills.tabLabel'],
  ['organisms', 'profile.tabs.organisms'], ['memory', 'profile.tabs.memory'], ['notebook', 'profile.tabs.notebook'],
  ['living', 'profile.tabs.living'], ['work', 'profile.tabs.work'], ['actions', 'profile.tabs.services'],
  ['boards', 'profile.tabs.boards'], ['apps', 'profile.tabs.apps'], ['appdev', 'profile.tabs.appDev'],
  ['extensions', 'profile.tabs.extensions'], ['capabilities', 'capabilities.tabLabel'], ['federation', 'profile.tabs.federation'],
  ['nodes', 'profile.tabs.nodes'], ['access', 'profile.tabs.access'], ['dataWallet', 'profile.tabs.dataWallet'],
  ['nodeStats', 'profile.tabs.nodeStats'], ['security', 'profile.tabs.security'], ['email', 'profile.tabs.email'],
  ['notifications', 'profile.tabs.notifications'], ['ai', 'profile.generator.openrouter.title'], ['calibrator', 'profile.calibrator.tabLabel'],
  ['packages', 'profile.tabs.packages'], ['libraries', 'librariesTab.tabLabel'],
];

/**
 * Admin, the sidebar groups of admin.js in their own order and with their own keys.
 * @type {[string, [string, string][]][]}
 */
const ADMIN_GROUPS = [
  ['dashboard.navNode', [
    ['overview', 'dashboard.overview'], ['economy', 'dashboard.economy'], ['config', 'dashboard.config'],
    ['security', 'admin.security.title'], ['compliance', 'admin.compliance.title'], ['cors', 'dashboard.cors'],
    ['maintenance', 'dashboard.maintenance'], ['hooks', 'dashboard.hooks'], ['portal', 'dashboard.portal'],
    ['discovery', 'dashboard.seo.tab'], ['subdomains', 'admin.subdomains.title'], ['stats', 'dashboard.stats'],
    ['database', 'dashboard.database'], ['metrics', 'dashboard.metrics'], ['usage', 'dashboard.usage'],
    ['prompts', 'dashboard.promptsTab'],
  ]],
  ['dashboard.navIdentity', [
    ['owners', 'dashboard.owners'], ['agents', 'dashboard.agents'], ['ghii', 'dashboard.ghii'],
    ['agent-integration', 'admin.tabs.agentIntegration'], ['org-ownership', 'admin.tabs.orgOwnership'], ['sso', 'dashboard.ssoTab'],
  ]],
  ['dashboard.navData', [
    ['actions', 'dashboard.actions'], ['boards', 'dashboard.boards'], ['chatInstances', 'dashboard.chatInstances'],
    ['realtime', 'dashboard.realtime'], ['work', 'dashboard.work'], ['messages', 'admin.messages.title'],
    ['memory-admin', 'dashboard.memoryAdmin'], ['agent-tasks', 'dashboard.agentTasksTab'], ['sharing-groups', 'dashboard.sharingGroupsTab'],
    ['capabilities', 'capabilities.adminTitle'], ['apps', 'admin.apps.title'],
  ]],
  ['dashboard.navInfrastructure', [
    ['email', 'dashboard.email'], ['push', 'dashboard.push'], ['consul', 'dashboard.consul'], ['scheduler', 'dashboard.scheduler'],
  ]],
  ['dashboard.navServices', [
    ['directory', 'dashboard.directory'], ['extensions', 'dashboard.extensionsTab'], ['cortex', 'dashboard.cortexTab'],
    ['csm', 'dashboard.csmManagement'], ['knowledge', 'knowledge.operator.tabLabel'], ['skills', 'dashboard.skills.tabLabel'],
    ['packages', 'dashboard.packagesTab'],
  ]],
  ['dashboard.navIntegrations', [['msm', 'dashboard.msmManagement']]],
  ['dashboard.navFederation', [['federation', 'dashboard.federation'], ['genesis', 'dashboard.genesis']]],
];

/**
 * The slides: which page, and what it did. The sentence names an outcome in the frame's own
 * words (the doc's list, then one per page in the same spirit). Figures in a sentence are the
 * ones the page itself shows; the design round carries them as written, and a later round reads
 * them live from the same endpoints the pages use.
 */
const SLIDES = [
  { where: 'settings', id: 'apps', page: 'profile.tabs.apps', key: 'landing2.slideApps', en: 'Installed on your phone and your desktop. No app store in between.' },
  { where: 'settings', id: 'access', page: 'profile.tabs.access', key: 'landing2.slideAccess', en: 'You sign in with a finger or a QR code. There is no password.' },
  { where: 'settings', id: 'appdev', page: 'profile.tabs.appDev', key: 'landing2.slideAppdev', en: 'Forked somebody\'s app. The origin is recorded and the copy is yours.' },
  { where: 'settings', id: 'portfolio', page: 'portfolio.tabLabel', key: 'landing2.slidePortfolio', en: 'Seven versions of the same app, every one of them restorable.' },
  { where: 'settings', id: 'organisms', page: 'profile.tabs.organisms', key: 'landing2.slideOrganisms', en: 'Your team edits the same app. The working copy and the published one stay apart.' },
  { where: 'settings', id: 'actions', page: 'profile.tabs.services', key: 'landing2.slideServices', en: 'Your app sells tool calls to other agents, and the money lands in your wallet.' },
  { where: 'admin', id: 'discovery', page: 'dashboard.seo.tab', key: 'landing2.slideDiscovery', en: 'Search engines and AI chats find your app, because you told them how.' },
  { where: 'settings', id: 'scheduler', page: 'profile.tabs.scheduler', key: 'landing2.slideScheduler', en: '29 schedules, 15 of them made by agents themselves, 0 failed.' },
  { where: 'settings', id: 'agents', page: 'profile.tabs.agents', key: 'landing2.slideAgents', en: 'Four agents on the payroll, each with a name, its own permissions and its own hours.' },
  { where: 'settings', id: 'memory', page: 'profile.tabs.memory', key: 'landing2.slideMemory', en: 'What you told your AI in March is still here in September.' },
  { where: 'settings', id: 'offers', page: 'profile.tabs.offers', key: 'landing2.slideOffers', en: 'An agent bid for you at three in the morning and won.' },
  { where: 'settings', id: 'mcp', page: 'profile.tabs.mcp', key: 'landing2.slideMcp', en: 'Claude, ChatGPT and Claude Code all plugged in. Same memory, same rules.' },
  { where: 'settings', id: 'companies', page: 'profile.tabs.companies', key: 'landing2.slideCompanies', en: 'Two companies, separate books, one sign-in.' },
  { where: 'settings', id: 'pnl', page: 'profile.tabs.pnl', key: 'landing2.slidePnl', en: 'Every euro an agent spent, next to what it earned.' },
  { where: 'settings', id: 'usage', page: 'profile.tabs.usage', key: 'landing2.slideUsage', en: 'Each model call, with who asked and what it cost.' },
  { where: 'settings', id: 'security', page: 'profile.tabs.security', key: 'landing2.slideSecurity', en: 'Two-step sign-in on, and every session listed by device.' },
  { where: 'admin', id: 'config', page: 'dashboard.config', key: 'landing2.slideConfig', en: '109 settings changed, each with a name, a key and a default.' },
  { where: 'admin', id: 'security', page: 'admin.security.title', key: 'landing2.slideAdminSecurity', en: 'Every action signed by whoever did it, and the trail is yours to read.' },
  { where: 'admin', id: 'compliance', page: 'admin.compliance.title', key: 'landing2.slideCompliance', en: 'The EU AI Act statement, written from what actually runs here.' },
  { where: 'admin', id: 'federation', page: 'dashboard.federation', key: 'landing2.slideFederation', en: 'Signed in from a friend\'s AIMEAT, and your own things are still at home.' },
];

const AUTO_MS = 1600;
const SWIPE_PX = 40;

/**
 * CLICK-ZIG. A noise click, a square wave sliding down as the carousel turns, a second click as
 * the slide seats. `ref` holds the one AudioContext, made on the first press.
 */
function clickZig(ref) {
  try {
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return;
    const ctx = ref.current || (ref.current = new AC());
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const click = (at, gain) => {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.025), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, at);
      src.connect(g).connect(ctx.destination); src.start(at);
    };
    click(t0, 0.5);
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(880, t0 + 0.04);
    o.frequency.exponentialRampToValueAtTime(160, t0 + 0.24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
    o.connect(g).connect(ctx.destination); o.start(t0 + 0.04); o.stop(t0 + 0.27);
    click(t0 + 0.27, 0.35);
  } catch (err) { swallowed('landing-v2: click-zig', err); }
}

const Chevron = (dir) => html`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}></path></svg>`;

export function Projector() {
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(false);
  const [started, setStarted] = useState(false);
  const [missing, setMissing] = useState({});
  const audio = useRef(null);
  const ref = useRef(null);
  const touchX = useRef(null);
  const total = SLIDES.length;
  const slide = SLIDES[idx];

  // The automatic run starts when the projector scrolls into view, silent, and the first press
  // takes over: the person now holds the button.
  useEffect(() => {
    if (started || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (err) { swallowed('landing-v2: reduced motion', err); }
    const io = new IntersectionObserver((entries) => {
      if (entries.some(en => en.isIntersecting)) { setStarted(true); if (!reduced) setAuto(true); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [started]);

  useEffect(() => {
    if (!auto) return undefined;
    const iv = setInterval(() => setIdx((i) => (i + 1) % total), AUTO_MS);
    return () => clearInterval(iv);
  }, [auto, total]);

  const press = (dir = 1) => {
    setAuto(false);
    clickZig(audio);
    setIdx((i) => (i + dir + total) % total);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); press(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); press(-1); }
  };
  const onTouchStart = (e) => { touchX.current = e.touches?.[0]?.clientX ?? null; };
  const onTouchEnd = (e) => {
    const x0 = touchX.current; touchX.current = null;
    const x1 = e.changedTouches?.[0]?.clientX;
    if (x0 == null || x1 == null) return;
    const dx = x1 - x0;
    if (Math.abs(dx) >= SWIPE_PX) press(dx < 0 ? 1 : -1);
  };

  const src = `/img/frontdemo/projector/${slide.where}-${slide.id}.png`;
  const pageName = tr(slide.page, slide.id);
  const isLit = (where, id) => slide.where === where && slide.id === id;
  const word = (where, id, key) => html`<span class=${`ld-v2-word ${isLit(where, id) ? 'is-lit showroom-slab--sun' : ''}`} key=${where + ':' + id}>${tr(key, id)}</span>`;

  return html`
    <section class="ld-v2-proj" ref=${ref} onKeyDown=${onKey}>
      <div class="ld-v2-proj-head">
        <h2 class="ld-sh-h2 ld-v2-h2-row">
          <span>${tr('landing2.projTitle1', 'Want to see everything?')}</span>
          <span class="ld-sh-accent">${tr('landing2.projTitle2', 'The slide projector.')}</span>
        </h2>
        <p class="ld-sh-text ld-v2-proj-sub">${tr('landing2.projSub', 'Optional. This is for whoever wants to see the whole cockpit. Every slide is one page of Settings & Controls or Admin, and what it did for someone.')}</p>
      </div>
      <div class="ld-v2-proj-grid">
        <div class="ld-v2-cloud ld-v2-cloud--settings" aria-label=${tr('nav.profile', 'Settings & Controls')}>
          <span class="ld-v2-cloud-title poster-section-title">${tr('nav.profile', 'Settings & Controls')}</span>
          <div class="ld-v2-cloud-words">${SETTINGS_TABS.map(([id, key]) => word('settings', id, key))}</div>
        </div>
        <div class="ld-v2-projector">
          ${/* Lowercase on purpose: Preact registers a camel-cased touch handler under the camel-cased
                name on a browser without touch, and the lowercase form is 'touchstart' everywhere. */''}
          <div class="ld-v2-slide" ontouchstart=${onTouchStart} ontouchend=${onTouchEnd}>
            <div class="ld-v2-slide-frame" key=${idx}>
              ${missing[src] ? html`
                <div class="ld-v2-slide-placeholder">
                  <span class="ld-v2-slide-page">${pageName}</span>
                  <span class="ld-v2-slide-note">${tr('landing2.projShotHere', 'Screenshot of this page goes here')}</span>
                </div>` : html`
                <img class="ld-v2-slide-img" src=${src} alt=${pageName} onError=${() => setMissing((m) => ({ ...m, [src]: true }))} />`}
            </div>
            <p class="ld-v2-slide-caption" aria-live="polite">
              <span class="ld-v2-slide-where">${tr(slide.where === 'admin' ? 'nav.admin' : 'nav.profile', slide.where)} · ${pageName}</span>
              <span class="ld-v2-slide-text">${tr(slide.key, slide.en)}</span>
            </p>
          </div>
          <div class="ld-v2-controls">
            <button type="button" class="ld-v2-arrow poster-frame" aria-label=${tr('landing2.projPrev', 'Previous slide')} onClick=${() => press(-1)}>${Chevron(-1)}</button>
            <button type="button" class="ld-v2-bigbutton showroom-slab--sun" onClick=${() => press(1)} aria-label=${tr('landing2.projClick', 'Next slide')}>
              <span class="ld-v2-bigbutton-cap">${tr('landing2.projButton', 'CLICK')}</span>
            </button>
            <button type="button" class="ld-v2-arrow poster-frame" aria-label=${tr('landing2.projNext', 'Next slide')} onClick=${() => press(1)}>${Chevron(1)}</button>
          </div>
          <div class="ld-v2-proj-bar">
            <span class="ld-v2-counter">${tr('landing2.projCounter', 'Slide {n} of {total}').replace('{n}', String(idx + 1)).replace('{total}', String(total))}</span>
            <button type="button" class=${`btn-outline ld-v2-autobtn ${auto ? 'is-on' : ''}`} aria-pressed=${auto} onClick=${() => setAuto((a) => !a)}>
              ${auto ? tr('landing2.projStop', 'Stop') : tr('landing2.projAuto', 'Run it')}
            </button>
          </div>
        </div>
        <div class="ld-v2-cloud ld-v2-cloud--admin" aria-label=${tr('nav.admin', 'Admin')}>
          <span class="ld-v2-cloud-title poster-section-title">${tr('nav.admin', 'Admin')}</span>
          ${ADMIN_GROUPS.map(([gkey, items]) => html`
            <div class="ld-v2-cloud-group" key=${gkey}>
              <span class="ld-v2-cloud-groupname">${tr(gkey, gkey)}</span>
              <div class="ld-v2-cloud-words">${items.map(([id, key]) => word('admin', id, key))}</div>
            </div>`)}
        </div>
      </div>
    </section>`;
}
