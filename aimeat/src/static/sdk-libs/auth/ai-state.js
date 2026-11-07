/**
 * @file auth/ai-state.js
 * @description The sign-in pill's AI state (wish-resurssipalkki-teko-lybudjetti-tallennus-ja-nelj-ovea,
 *   design C of 2026-11-07): the light before the name says whether the person's own AI is connected,
 *   the bolt after it says whether there is AI power to spend here (yellow: there is; red: today's
 *   limit is reached; grey: none), and in an app that declares AI roles, an icon per capability the app
 *   uses (green: works; red with a slash: missing). A hover or a press opens one popup with the detail:
 *   who is connected, what is left and who pays, what the person can do now, and one link to fix it.
 *
 *   ONE ANSWER. Everything comes from GET /v1/ai/capabilities (`main`, `power`, `needs`,
 *   `capabilities`), the same answer an AI reads through aimeat_ai_capabilities and an app through
 *   AIMEAT.ai.capabilities(). The pill computes nothing of its own.
 *
 *   NO POLLING. The answer is read once per session and kept here; it is read again only when the
 *   node says something changed: the SPA's `aimeat-live-update` event naming `ai-usage`,
 *   `ai-providers` or `agents`, and `aimeat-ai-used`, which the served AI library fires after a call.
 *   A refusal (a grant without ai:use) marks the state `unavailable`, and the pill then draws neither
 *   the light nor the bolt rather than a wrong one. The compact button's dot stays as it was.
 * @structure readAiState(session, onChange) · forgetAiState() · aiStatusHtml(state, i, place) ·
 *   aiCompactHtml(state) · aiDotClass(state) · wireAiState(container) · ensureAiStateStyles()
 * @usage
 *   const st = readAiState(session, render);   // null until the answer arrives, then render() runs
 *   pillHtml += aiStatusHtml(st, i, 'led') + name + aiStatusHtml(st, i, 'bolt');
 *   wireAiState(container);
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial.
 */
import { authApi } from './http.js';
import { NODE_URL } from './config.js';
import { escHtml } from './theme.js';
import { clampPopover } from './cluster.js';
import { money } from '../_core/format.js';

/** @type {{ key: string|null, data: any, pending: Promise<any>|null, session: any, listeners: Set<() => void> }} */
var cache = { key: null, data: null, pending: null, session: null, listeners: new Set() };

/** The live domains whose change can move the light or the bolt. */
var DOMAINS = ['ai-usage', 'ai-providers', 'agents'];

function keyOf(session) { return session && session.jwt ? session.jwt + '|' + (session._app || '') : null; }

function fetchState(session) {
  var key = keyOf(session);
  var path = '/v1/ai/capabilities' + (session._app ? '?app_id=' + encodeURIComponent(session._app) : '');
  cache.pending = authApi(path, session.jwt)
    .then(function (r) { if (cache.key === key) cache.data = r.data || { unavailable: true, reason: 'empty answer' }; })
    // A grant without ai:use (an app that uses no AI) is refused: the pill then draws neither the
    // light nor the bolt, because it cannot say anything true about them. The state carries why.
    .catch(function (err) {
      console.debug('[aimeat-auth] the AI state was not read:', err);
      if (cache.key === key) cache.data = { unavailable: true, reason: String((err && err.code) || err) };
    })
    .then(function () {
      if (cache.key !== key) return;
      cache.pending = null;
      cache.listeners.forEach(function (fn) { fn(); });
    });
  return cache.pending;
}

var invalidate = null;
function listenOnce() {
  if (invalidate || typeof window === 'undefined') return;
  invalidate = function (ev) {
    var d = ev && ev.detail && ev.detail.domains;
    if (Array.isArray(d) && !d.some(function (x) { return DOMAINS.indexOf(x) >= 0; })) return;
    var s = cache.session;
    if (s && keyOf(s) === cache.key && !cache.pending) fetchState(s);
  };
  window.addEventListener('aimeat-live-update', invalidate);
  window.addEventListener('aimeat-ai-used', invalidate);
}

/**
 * The AI state for this session: the kept answer, or null while it is read. `onChange` runs when an
 * answer arrives, so the pill draws again; one listener per pill (a second call with the same
 * function adds nothing).
 * @param {any} session
 * @param {() => void} onChange
 */
export function readAiState(session, onChange) {
  var key = keyOf(session);
  if (!key) return null;
  if (onChange) cache.listeners.add(onChange);
  listenOnce();
  if (cache.key !== key) {
    cache.key = key; cache.data = null; cache.session = session;
    fetchState(session);
  }
  return cache.data;
}

/** Drop the kept answer (a sign-out), so the next session reads its own. */
export function forgetAiState() { cache.key = null; cache.data = null; cache.pending = null; cache.session = null; }

// ── Icons: inline SVG in currentColor, so they follow the pill's ink in every theme ──
var BOLT = 'M13 2 3 14h9l-1 8 10-12h-9l1-8z';
var GLYPH = {
  picture: '<rect x="2" y="4" width="13" height="11"/><path d="M5 15l-2 6M12 15l2 6M22 2l-7.5 7.5"/>'
    + '<path d="M14.5 9.5c-1.6 0-2.8 1.1-3 3 1.9-.2 3-1.4 3-3z" fill="currentColor"/>',
  sound: '<rect x="3" y="2" width="6" height="11" rx="3"/><path d="M1 10a5 5 0 0 0 10 0M6 15v5M3.5 20h5"/>'
    + '<path d="M14 9h3l5-4v14l-5-4h-3zM25 9a4.5 4.5 0 0 1 0 6"/>',
};
var GLYPH_OF = { vision: 'picture', image: 'picture', transcription: 'sound', speech: 'sound' };
var WORD_OF = { vision: 'capVision', image: 'capImage', transcription: 'capTranscription', speech: 'capSpeech' };

function glyphSvg(cap, missing) {
  var g = GLYPH_OF[cap];
  var w = g === 'sound' ? 23 : 19;
  return '<svg class="aimeat-ai-need-ico" width="' + w + '" height="19" viewBox="0 0 ' + (g === 'sound' ? 28 : 24) + ' 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + GLYPH[g]
    + (missing ? '<path d="M2 2l' + (g === 'sound' ? 24 : 20) + ' 20" stroke-width="2.4"/>' : '') + '</svg>';
}

function boltSvg(size) {
  return '<svg class="aimeat-ai-bolt-ico" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="' + BOLT + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
}

function fill(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; }); }

/** The state words the light and the bolt carry, for their labels and the popup's first lines. */
function words(st, i) {
  var main = (st && st.main) || {};
  var power = (st && st.power) || { state: 'none' };
  return {
    led: main.connected ? (i.aiOn || 'Your AI is connected') : (i.aiOff || 'No AI connected yet'),
    bolt: power.state === 'ok' ? (i.powerOk || 'AI power available')
      : power.state === 'over' ? (i.powerOver || "Today's limit is reached") : (i.powerNone || 'No AI power here'),
  };
}

/** The popup's body: the connection, the power, what can be done now, and what this app uses. */
function popupHtml(st, i) {
  var main = st.main || {};
  var power = st.power || { state: 'none' };
  var caps = st.capabilities || {};
  var w = words(st, i);
  var out = '<div class="aimeat-ai-pop" role="dialog" aria-label="' + escHtml(i.powerName || 'AI power') + '">';
  // The connection.
  out += '<p class="aimeat-ai-line"><span class="aimeat-ai-led-mini' + (main.connected ? '' : ' is-off') + '" aria-hidden="true"></span>'
    + '<strong>' + escHtml(w.led) + '</strong></p>';
  if (main.latest && main.latest.name) out += '<p class="aimeat-ai-sub">' + escHtml(fill(i.aiLatest || 'Last active: {name}', { name: main.latest.name })) + '</p>';
  if (main.agents) out += '<p class="aimeat-ai-sub">' + escHtml(fill(i.aiAgents || 'Agents: {n}', { n: main.agents })) + '</p>';
  if (main.chat && !main.agents) out += '<p class="aimeat-ai-sub">' + escHtml(i.aiChat || 'The chat here is ready') + '</p>';
  if (main.agents != null) {
    out += main.connected
      ? '<a class="aimeat-ai-link" href="' + escHtml(NODE_URL + '/v1/home?agents=1') + '">' + escHtml(i.aiShow || 'Show connections') + '</a>'
      : '<a class="aimeat-ai-link" href="' + escHtml(NODE_URL + '/v1/connect-your-ai') + '">' + escHtml(i.aiConnect || 'Connect your AI') + '</a>';
  }
  // The power.
  out += '<hr class="aimeat-ai-rule"><p class="aimeat-ai-line"><span class="aimeat-ai-bolt is-' + escHtml(power.state) + '">' + boltSvg(18) + '</span>'
    + '<strong>' + escHtml(power.state === 'ok' ? (i.powerOk || 'AI power available') : power.state === 'over' ? (i.powerOver || "Today's limit is reached") : (i.powerNone || 'No AI power here')) + '</strong></p>';
  if (power.state === 'ok' && power.remainingUsd != null) {
    out += '<p class="aimeat-ai-text">' + escHtml(power.payer === 'node'
      ? fill(i.powerLeftNode || '{left} of your allowance left.', { left: money(power.remainingUsd, 'USD') })
      : fill(i.powerLeft || '{left} left today. Daily limit {limit}.', { left: money(power.remainingUsd, 'USD'), limit: money(power.limitUsd, 'USD') }))
      + (power.low ? ' <strong>' + escHtml(i.powerLow || 'Running low.') + '</strong>' : '') + '</p>';
  }
  if (power.payer) {
    out += '<p class="aimeat-ai-sub">' + escHtml(power.payer === 'node' ? (i.payerNode || 'This node pays.')
      : power.payer === 'agent' ? (i.payerAgent || "The agent's own key pays.") : (i.payerOwn || 'You pay with your own key.')) + '</p>';
  }
  if (power.state !== 'ok' && power.fix) out += '<p class="aimeat-ai-text">' + escHtml(power.fix) + '</p>';
  if (power.state !== 'ok' && main.agents) out += '<p class="aimeat-ai-sub">' + escHtml(i.aiOwnStill || 'Your connected AI still works on its own subscription.') + '</p>';
  // What can be done now.
  var rows = function (list) {
    return list.map(function (r) {
      return '<li><span>' + escHtml(i[WORD_OF[r.cap]] || r.cap) + '</span><strong class="' + (r.on ? 'is-on' : 'is-off') + '">'
        + escHtml(r.on ? (i.capOn || 'On') : (i.capOff || 'Off')) + '</strong></li>';
    }).join('');
  };
  if (Array.isArray(st.needs) && st.needs.length) {
    out += '<p class="aimeat-ai-head">' + escHtml(i.needHead || 'This app uses') + '</p><ul class="aimeat-ai-list">'
      + rows(st.needs.map(function (n) { return { cap: n.capability, on: !!n.on }; })) + '</ul>';
    // What is missing and why: the capability's own sentence, or, when the capability works but the
    // app's role is not connected yet, where the person connects it.
    var missing = st.needs.filter(function (n) { return !n.on; });
    var said = missing.map(function (n) { return n.fix; }).filter(Boolean);
    said.filter(function (s, k) { return said.indexOf(s) === k; }).forEach(function (s) { out += '<p class="aimeat-ai-text">' + escHtml(s) + '</p>'; });
    if (missing.some(function (n) { return !n.fix; })) out += '<p class="aimeat-ai-text">' + escHtml(i.needRole || "Connect this app's AI roles in your AI settings.") + '</p>';
  } else if (power.state === 'ok') {
    out += '<p class="aimeat-ai-head">' + escHtml(i.canHead || 'What you can do now') + '</p><ul class="aimeat-ai-list">'
      + rows(['vision', 'image', 'transcription', 'speech'].map(function (c) { return { cap: c, on: !!(caps[c] && caps[c].on) }; })) + '</ul>';
  }
  var settings = power.settingsUrl || (st.needs || []).map(function (n) { return n.settingsUrl; }).filter(Boolean)[0]
    || NODE_URL + '/v1/profile?tab=ai';
  if (/^https?:\/\//.test(settings) || settings.charAt(0) === '/') {
    out += '<a class="aimeat-ai-link" href="' + escHtml(settings) + '">' + escHtml(i.aiSettings || 'AI settings') + '</a>';
  }
  return out + '</div>';
}

/**
 * One part of the pill's row. `place` is 'led' (before the name) or 'bolt' (after it: the bolt, an
 * app's need icons and the popup). With no answer yet, the light is drawn neutral and the bolt not at all.
 * @param {any} st  readAiState's answer, or null
 * @param {Record<string, string>} i  the pill's words
 * @param {'led'|'bolt'} place
 */
export function aiStatusHtml(st, i, place) {
  var w = words(st, i);
  if (st && st.unavailable) return '';
  if (place === 'led') {
    var cls = !st ? '' : (st.main && st.main.connected ? ' is-on' : ' is-off');
    return '<button type="button" class="aimeat-auth-dot aimeat-ai-led' + cls + '" data-ai-open'
      + (st ? ' aria-label="' + escHtml(w.led) + '" title="' + escHtml(w.led) + '"' : ' aria-hidden="true" tabindex="-1"') + '></button>';
  }
  if (!st || !st.power) return '';
  var needs = Array.isArray(st.needs) ? st.needs : [];
  return '<span class="aimeat-ai">'
    + '<button type="button" class="aimeat-ai-bolt is-' + escHtml(st.power.state) + '" data-ai-open aria-haspopup="dialog" aria-expanded="false" '
    + 'aria-label="' + escHtml(w.bolt) + '" title="' + escHtml(w.bolt) + '">' + boltSvg(17) + '</button>'
    + needs.map(function (n) {
      var label = (i[WORD_OF[n.capability]] || n.capability) + ': ' + (n.on ? (i.capOn || 'On') : (i.capOff || 'Off'));
      return '<span class="aimeat-ai-need ' + (n.on ? 'is-on' : 'is-off') + '" role="img" aria-label="' + escHtml(label) + '" title="' + escHtml(label) + '">'
        + glyphSvg(n.capability, !n.on) + '</span>';
    }).join('')
    + popupHtml(st, i)
    + '</span>';
}

/** The compact button's part: the bolt beside the initials (the light is the button's own dot). */
export function aiCompactHtml(st) {
  if (!st || !st.power) return '';
  return '<span class="aimeat-ai-bolt is-' + escHtml(st.power.state) + '" aria-hidden="true">' + boltSvg(14) + '</span>';
}

/** The compact button's dot follows the light. */
export function aiDotClass(st) { return !st || st.unavailable ? '' : (st.main && st.main.connected ? ' is-on' : ' is-off'); }

/**
 * Open the popup: a press on the bolt or the light toggles it (touch, keyboard), a hover opens it
 * where the device can hover (CSS). The pill's own closers, registered once per mount, close it on
 * Escape and on a press elsewhere (pill.js, `.aimeat-ai.aimeat-open`); this binds only the elements
 * of one render, which go with it.
 * @param {Element} container
 */
export function wireAiState(container) {
  var group = /** @type {HTMLElement|null} */ (container.querySelector('.aimeat-ai'));
  if (!group) return;
  var bolt = group.querySelector('.aimeat-ai-bolt');
  var pop = /** @type {HTMLElement|null} */ (group.querySelector('.aimeat-ai-pop'));
  container.querySelectorAll('[data-ai-open]').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var open = group.classList.toggle('aimeat-open');
      if (bolt) bolt.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && pop) clampPopover(pop);
    });
  });
  group.addEventListener('mouseenter', function () { if (pop) clampPopover(pop); });
}

/**
 * The AI state's rules, in a sheet of their own beside the pill's (theme.js ensureAuthPillStyles,
 * which this module cannot import without a cycle). They read the same ink, paper and frame, so the
 * popup is drawn as the pill is.
 */
export function ensureAiStateStyles() {
  if (document.getElementById('aimeat-ai-state-css')) return;
  var st = document.createElement('style');
  st.id = 'aimeat-ai-state-css';
  st.textContent = aiStateCss('var(--aimeat-ink)', 'var(--aimeat-paper)', 'var(--shape-frame,2px) solid ');
  (document.head || document.documentElement).appendChild(st);
}

function aiStateCss(ink, paper, frame) {
  var on = 'var(--aimeat-pill-ok,var(--success-fg,#047857))';
  var off = 'var(--aimeat-pill-bad,var(--danger-fg,#C8322A))';
  return [
    '.aimeat-ai-led{appearance:none;border:0;padding:0;margin:0;cursor:pointer}',
    /* Before the answer arrives the light says nothing: neither green nor off. */
    '.aimeat-ai-led:not(.is-on):not(.is-off){background:color-mix(in oklab,' + ink + ' 18%,transparent);cursor:default}',
    '.aimeat-ai-led.is-off,.aimeat-auth-compact .cdot.is-off{background:color-mix(in oklab,' + ink + ' 38%,transparent)}',
    '.aimeat-ai-led:focus-visible,.aimeat-ai-bolt:focus-visible{outline:2px solid ' + ink + ';outline-offset:2px}',
    '.aimeat-ai{position:relative;display:inline-flex;align-items:center;gap:6px}',
    '.aimeat-ai-bolt{appearance:none;display:inline-flex;align-items:center;justify-content:center;background:none;border:0;',
      'padding:2px;margin:0;color:' + ink + ';cursor:pointer;line-height:0}',
    '.aimeat-ai-bolt.is-ok path{fill:var(--aimeat-pill-power,var(--sun,#FFB52E))}',
    '.aimeat-ai-bolt.is-over path{fill:var(--aimeat-pill-over,var(--danger,#E0453A))}',
    '.aimeat-ai-bolt.is-none{opacity:.5}.aimeat-ai-bolt.is-none path{fill:none}',
    '.aimeat-ai-need{display:inline-flex;line-height:0}.aimeat-ai-need.is-on{color:' + on + '}.aimeat-ai-need.is-off{color:' + off + '}',
    '.aimeat-ai-pop{position:absolute;top:100%;right:0;z-index:1100;display:none;box-sizing:border-box;width:280px;',
      'max-width:calc(100vw - 24px);margin-top:8px;padding:12px 14px;text-align:left;white-space:normal;',
      'background:' + paper + ';color:' + ink + ';border:' + frame + ink + ';',
      'box-shadow:0 8px 24px rgb(15 18 25 / .16);font-size:13px;line-height:1.45;font-weight:400}',
    /* The hover bridge: the gap above the popup belongs to it, so the pointer can move in. */
    '.aimeat-ai-pop::before{content:"";position:absolute;left:0;right:0;top:-10px;height:10px}',
    '.aimeat-ai.aimeat-open .aimeat-ai-pop{display:block}',
    '@media (hover:hover){.aimeat-ai:hover .aimeat-ai-pop{display:block}}',
    '.aimeat-ai-pop p{margin:0 0 6px}',
    '.aimeat-ai-line{display:flex;align-items:center;gap:8px;font-size:14px}',
    '.aimeat-ai-line .aimeat-ai-bolt{padding:0;cursor:default}',
    '.aimeat-ai-led-mini{display:inline-block;width:10px;height:10px;flex:0 0 auto;background:var(--aimeat-pill-live,var(--success,#10B981))}',
    '.aimeat-ai-led-mini.is-off{background:color-mix(in oklab,' + ink + ' 38%,transparent)}',
    '.aimeat-ai-sub{opacity:.78;font-size:12.5px}',
    '.aimeat-ai-rule{border:0;border-top:1px solid color-mix(in oklab,' + ink + ' 18%,transparent);margin:10px 0}',
    '.aimeat-ai-head{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;opacity:.75;margin-top:10px!important}',
    '.aimeat-ai-list{list-style:none;margin:0 0 8px;padding:0}',
    '.aimeat-ai-list li{display:flex;justify-content:space-between;gap:12px;padding:2px 0}',
    '.aimeat-ai-list .is-on{color:' + on + '}.aimeat-ai-list .is-off{color:' + off + '}',
    /* Specific enough to win over a host header's own link rules (the SPA's `.topnav-right a`). */
    '.aimeat-ai-pop a.aimeat-ai-link{display:inline-block;margin:2px 0 4px;padding:0;background:none;font-size:13px;font-weight:800;',
      'color:' + ink + ';text-decoration:underline;text-underline-offset:3px}',
    '.aimeat-ai-pop a.aimeat-ai-link:hover{color:var(--aimeat-pill-name,var(--accent,#E8564A))}',
    '.aimeat-auth-compact .aimeat-ai-bolt{padding:0}',
    /* In the compact popover (a phone) the detail is part of the panel: shown, not hovered. */
    '@media (max-width:600px){',
      '.aimeat-auth-wrap>.aimeat-auth-pill .aimeat-ai{flex:1 1 100%;flex-wrap:wrap}',
      '.aimeat-auth-wrap>.aimeat-auth-pill .aimeat-ai-pop{position:static;display:block;width:100%;margin:8px 0 0;box-shadow:none;border-width:1px}',
      '.aimeat-auth-wrap>.aimeat-auth-pill .aimeat-ai-pop::before{display:none}',
    '}',
  ].join('');
}
