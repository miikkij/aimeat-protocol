/**
 * @file landing-v2-projector.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The slide projector on the front page (TARGET-075): an old carousel projector with
 *   one big button. CLICK-ZIG, and the picture changes. Every page of Settings & Controls and of
 *   Admin is a slide, and so is every app chosen for the show, so the counter says how many there
 *   really are. Around the slide sits the word cloud: the two menus exactly as the product has
 *   them (profile.js TABS and admin.js NAV_GROUPS, the same locale keys) and the apps, and the word
 *   the slide is about lights up. Every word is a button: press it and the projector jumps there.
 *   It runs on its own, quickly, and the big button or any word stops it.
 *
 *   A SLIDE CARRIES A SENTENCE WHERE ONE IS WRITTEN. The sentence names what the page did for
 *   somebody, never what it can do (LINES below, the frame's own list first). A page without one
 *   yet shows its name and a marked placeholder, so the missing sentence is visible rather than
 *   invented. An app slide carries the app's own description.
 *
 *   THE PICTURES ARE REAL SCREENSHOTS, TAKEN BY scripts/projector-shots.ts in the operator's
 *   session. Each menu slide looks for /img/frontdemo/projector/<where>-<id>.png; until the file
 *   exists the slide shows the page's name on a placeholder. An app slide uses the catalogue's own
 *   screenshot.
 *
 *   THE SOUND IS SYNTHESISED. WebAudio, no file: a noise click, a square wave sliding down as the
 *   carousel turns, and a second click as the slide seats. The context is created on the first
 *   press and never before, because a browser refuses audio that nobody asked for; the automatic
 *   run is silent until then.
 *
 *   The section is optional and its title says so: this is for whoever wants to see everything.
 * @structure SETTINGS_TABS · ADMIN_GROUPS · LINES · inLocale · pickApps · clickZig · Projector
 * @usage import { Projector } from './landing-v2-projector.js';
 * @version-history
 *   v0.3.0 — 2026-09-14 — The apps in the show come from show.json, the file the shots script
 *     photographs, with a picture of their own and a sentence in three languages; the catalogue's
 *     screenshot is the fallback.
 *   v0.2.0 — 2026-09-14 — Every menu page is a slide and every word is a button that jumps to it;
 *     the apps chosen for the show are the third group of the cloud, with the catalogue's own
 *     screenshots. Jouni, on seeing the first round.
 *   v0.1.0 — 2026-09-14 — Design round, TARGET-075.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * Settings & Controls, the tab list of profile.js in its own order and with its own keys.
 * scripts/projector-shots.ts carries the same ids; a tab added here is added there.
 * @type {[string, string][]}
 */
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
 * The sentence a slide carries, where one is written: "<where>:<id>" → [locale key, English].
 * Outcomes in the frame's own words (the doc's list first). Figures in a sentence are the ones
 * the page itself shows; this round carries them as written, a later one reads them live.
 * @type {Record<string, [string, string]>}
 */
const LINES = {
  'settings:apps': ['landing2.slideApps', 'Installed on your phone and your desktop. No app store in between.'],
  'settings:access': ['landing2.slideAccess', 'You sign in with a finger or a QR code. There is no password.'],
  'settings:appdev': ['landing2.slideAppdev', 'Forked somebody\'s app. The origin is recorded and the copy is yours.'],
  'settings:portfolio': ['landing2.slidePortfolio', 'Seven versions of the same app, every one of them restorable.'],
  'settings:organisms': ['landing2.slideOrganisms', 'Your team edits the same app. The working copy and the published one stay apart.'],
  'settings:actions': ['landing2.slideServices', 'Your app sells tool calls to other agents, and the money lands in your wallet.'],
  'admin:discovery': ['landing2.slideDiscovery', 'Search engines and AI chats find your app, because you told them how.'],
  'settings:scheduler': ['landing2.slideScheduler', '29 schedules, 15 of them made by agents themselves, 0 failed.'],
  'settings:agents': ['landing2.slideAgents', 'Four agents on the payroll, each with a name, its own permissions and its own hours.'],
  'settings:memory': ['landing2.slideMemory', 'What you told your AI in March is still here in September.'],
  'settings:offers': ['landing2.slideOffers', 'An agent bid for you at three in the morning and won.'],
  'settings:mcp': ['landing2.slideMcp', 'Claude, ChatGPT and Claude Code all plugged in. Same memory, same rules.'],
  'settings:companies': ['landing2.slideCompanies', 'Two companies, separate books, one sign-in.'],
  'settings:pnl': ['landing2.slidePnl', 'Every euro an agent spent, next to what it earned.'],
  'settings:usage': ['landing2.slideUsage', 'Each model call, with who asked and what it cost.'],
  'settings:security': ['landing2.slideSecurity', 'Two-step sign-in on, and every session listed by device.'],
  'admin:config': ['landing2.slideConfig', '109 settings changed, each with a name, a key and a default.'],
  'admin:security': ['landing2.slideAdminSecurity', 'Every action signed by whoever did it, and the trail is yours to read.'],
  'admin:compliance': ['landing2.slideCompliance', 'The EU AI Act statement, written from what actually runs here.'],
  'admin:federation': ['landing2.slideFederation', 'Signed in from a friend\'s AIMEAT, and your own things are still at home.'],
};

const AUTO_MS = 1600;
const SWIPE_PX = 40;
const APPS_IN_SHOW = 12;

/** A show.json text: one string, or one per language with English as the fallback. */
const inLocale = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v[getLocale()] || v.en || Object.values(v)[0] || '';
};

/**
 * The apps in the show. show.json (public/img/frontdemo/projector/show.json, the same file
 * scripts/projector-shots.ts photographs) names them in order, with a picture taken by that
 * script and a sentence of its own or the catalogue's description. Without the file, the show is
 * the apps tagged `reference` in their manifest, which is how the catalogue curates, or the most
 * opened when nobody has tagged one yet, with the catalogue's own screenshot.
 * @param {any[]} entries  show.json's `apps`, or [] when there is no file
 * @param {any[]} apps     the catalogue's listing, for descriptions and screenshots
 */
function pickApps(entries, apps) {
  const byPath = new Map(apps.map((a) => [`${a.owner}/${a.filename}`, a]));
  if (entries.length > 0) {
    return entries.map((e) => {
      const a = e.app ? byPath.get(e.app) : null;
      return {
        where: 'apps',
        id: String(e.id),
        name: inLocale(e.name) || a?.manifest?.name || String(e.id),
        shot: `/img/frontdemo/projector/apps-${encodeURIComponent(String(e.id))}.png`,
        fallbackShot: a?.has_screenshot && a.screenshot_url ? a.screenshot_url : null,
        line: inLocale(e.line) || (a?.manifest?.description || '').slice(0, 160),
      };
    });
  }
  const tagged = apps.filter((a) => (a.manifest?.tags || []).some((x) => String(x).toLowerCase() === 'reference'));
  const chosen = tagged.length > 0 ? tagged : [...apps].sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, APPS_IN_SHOW);
  return chosen.map((a) => ({
    where: 'apps',
    id: `${a.owner}/${a.filename}`,
    name: a.manifest?.name || a.filename,
    shot: a.has_screenshot && a.screenshot_url ? a.screenshot_url : null,
    fallbackShot: null,
    line: (a.manifest?.description || '').slice(0, 160),
  }));
}

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
  const [appSlides, setAppSlides] = useState([]);
  const audio = useRef(null);
  const ref = useRef(null);
  const touchX = useRef(null);

  // The slides, in the order of the cloud: every settings page, every admin page, every app in the
  // show. The same list the words are drawn from, so a word and its slide cannot drift apart.
  const slides = [
    ...SETTINGS_TABS.map(([id, page]) => ({ where: 'settings', id, page })),
    ...ADMIN_GROUPS.flatMap(([, items]) => items.map(([id, page]) => ({ where: 'admin', id, page }))),
    ...appSlides,
  ];
  const total = slides.length;
  const slide = slides[Math.min(idx, total - 1)];
  const indexOf = new Map(slides.map((s, i) => [`${s.where}:${s.id}`, i]));

  useEffect(() => {
    let alive = true;
    // The show file and the catalogue, together: the file says which apps and in what order, the
    // catalogue supplies a description and a picture where the file gives none. A missing file is
    // an empty show, and then the catalogue picks.
    const showReq = fetch('/img/frontdemo/projector/show.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => (Array.isArray(j?.apps) ? j.apps.filter((e) => e && e.id) : []))
      .catch(err => { swallowed('landing-v2: projector show', err); return []; });
    const appsReq = fetch('/v1/apps?sort=popular&limit=200').then(r => r.json())
      .then(j => j?.data?.apps || [])
      .catch(err => { swallowed('landing-v2: projector apps', err); return []; });
    Promise.all([showReq, appsReq]).then(([entries, apps]) => { if (alive) setAppSlides(pickApps(entries, apps)); });
    return () => { alive = false; };
  }, []);

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
    const iv = setInterval(() => setIdx((i) => (i + 1) % Math.max(total, 1)), AUTO_MS);
    return () => clearInterval(iv);
  }, [auto, total]);

  const press = (dir = 1) => {
    setAuto(false);
    clickZig(audio);
    setIdx((i) => (i + dir + total) % total);
  };
  const jump = (i) => {
    setAuto(false);
    clickZig(audio);
    setIdx(i);
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

  // An app slide tries the show's own picture first and the catalogue's screenshot when that file
  // is missing; a menu slide has only the one place to look.
  const own = slide.where === 'apps' ? slide.shot : `/img/frontdemo/projector/${slide.where}-${slide.id}.png`;
  const src = (own && !missing[own]) ? own : (slide.where === 'apps' ? slide.fallbackShot : own);
  const pageName = slide.where === 'apps' ? slide.name : tr(slide.page, slide.id);
  const whereName = slide.where === 'admin' ? tr('nav.admin', 'Admin')
    : slide.where === 'apps' ? tr('landing2.cloudApps', 'Apps in the show')
    : tr('nav.profile', 'Settings & Controls');
  const line = LINES[`${slide.where}:${slide.id}`];
  const sentence = line ? tr(...line)
    : (slide.where === 'apps' && slide.line) ? slide.line
    : tr('landing2.slideGeneric', '[What this page did for someone: the sentence comes later.]');
  const isLit = (where, id) => slide.where === where && slide.id === id;
  const word = (where, id, label) => html`
    <button type="button" class=${`ld-v2-word ${isLit(where, id) ? 'is-lit showroom-slab--sun' : ''}`} key=${where + ':' + id}
      aria-pressed=${isLit(where, id)} onClick=${() => jump(indexOf.get(`${where}:${id}`) ?? 0)}>${label}</button>`;

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
          <div class="ld-v2-cloud-words">${SETTINGS_TABS.map(([id, key]) => word('settings', id, tr(key, id)))}</div>
        </div>
        <div class="ld-v2-projector">
          ${/* Lowercase on purpose: Preact registers a camel-cased touch handler under the camel-cased
                name on a browser without touch, and the lowercase form is 'touchstart' everywhere. */''}
          <div class="ld-v2-slide" ontouchstart=${onTouchStart} ontouchend=${onTouchEnd}>
            <div class="ld-v2-slide-frame" key=${idx}>
              ${!src || missing[src] ? html`
                <div class="ld-v2-slide-placeholder">
                  <span class="ld-v2-slide-page">${pageName}</span>
                  <span class="ld-v2-slide-note">${tr('landing2.projShotHere', 'Screenshot of this page goes here')}</span>
                </div>` : html`
                <img class="ld-v2-slide-img" src=${src} alt=${pageName} onError=${() => setMissing((m) => ({ ...m, [src]: true }))} />`}
            </div>
            <p class="ld-v2-slide-caption" aria-live="polite">
              <span class="ld-v2-slide-where">${whereName} · ${pageName}</span>
              <span class="ld-v2-slide-text">${sentence}</span>
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
              <div class="ld-v2-cloud-words">${items.map(([id, key]) => word('admin', id, tr(key, id)))}</div>
            </div>`)}
        </div>
        ${appSlides.length > 0 ? html`
          <div class="ld-v2-cloud ld-v2-cloud--apps" aria-label=${tr('landing2.cloudApps', 'Apps in the show')}>
            <span class="ld-v2-cloud-title poster-section-title">${tr('landing2.cloudApps', 'Apps in the show')}</span>
            <div class="ld-v2-cloud-words">${appSlides.map((s) => word('apps', s.id, s.name))}</div>
          </div>` : ''}
      </div>
    </section>`;
}
