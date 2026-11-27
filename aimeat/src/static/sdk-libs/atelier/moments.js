/**
 * @file atelier/moments.js
 * @description THE MOMENTS: the three designed states where an app and a person meet, drawn the
 *   same way in every app so that no app writes them by hand. They exist for the reason the empty
 *   state does (state.js): the Design Book's own record of parts made by hand showed the same
 *   three written again in app after app, each time a little differently.
 *
 *     ask       A STOP. A block cannot do its work until the person does one thing: signs in,
 *               turns a setting on, asks for access, gives a permission, lets the browser use the
 *               microphone, waits for a limit, or gets the connection back. Eight kinds; each has
 *               its words in three languages and, where a platform library on the page knows the
 *               way out, its button.
 *     propose   A PROPOSAL. A machine or another person proposes, the person decides: a draft to
 *               read and send, a value beside the sentence it was read from, a change to take or
 *               leave whole, a plan before it runs. With `gate: false` the same block says what
 *               was done instead of asking, because whether a person approves is the owner's
 *               setting and never the block's.
 *     handoff   A HAND-OFF to the person's own AI: one sentence to copy, or a prompt whose answer
 *               comes back (the prompt panel, workbench-parts.js, inside the same frame).
 *
 *   All three share one frame and one set of part names (kicker, title, lead, body, ways, note),
 *   so a look styles them once. `requires` (requires.js) is the caller that finds out which stop
 *   applies; these functions only draw what they are told.
 *
 *   WHAT FETCHES AND WHY. Nothing here fetches. The sign-in button calls AIMEAT.auth.signIn() when
 *   the page loaded that library; a settings or permission button is a link to the address the
 *   caller gives; the device button raises the browser's own permission question and releases the
 *   stream at once; the copy goes through the kit's clipboard helper (copy.js).
 *
 *   THE SAMPLE STATE. `sample: true` marks the block as a sample and its buttons do nothing.
 * @parts ask root · words · kicker · title · lead · body · ways · way · note
 * @slots ask kicker() · title() · lead() · body() · note()
 * @variants ask inline
 * @tokens ask --ak-ask-width · --ak-ask-kicker-mark
 * @fork ask Copy .ak-ask* out of moments.css; you give up the eight kinds' words in three languages and the way out each kind finds on the page.
 * @use ask wait · explain · act
 * @parts propose root · words · kicker · title · lead · body · source · steps · step · ways · accept · edit · reject · note
 * @slots propose kicker() · title() · lead() · body() · note()
 * @variants propose inline
 * @tokens propose --ak-ask-width · --ak-ask-kicker-mark
 * @fork propose Copy .ak-ask* out of moments.css and keep the three presses; you give up the decided states and the same block for an owner who turned approval off.
 * @use propose confirm · view
 * @parts handoff root · words · kicker · title · lead · body · say · ways · way · note
 * @slots handoff kicker() · title() · lead() · note()
 * @variants handoff inline
 * @tokens handoff --ak-ask-width · --ak-ask-kicker-mark
 * @fork handoff Copy .ak-ask* out of moments.css and call AIMEAT.atelier.copy(text) yourself; you give up the selected text when the browser refuses the clipboard.
 * @use handoff copy · act
 * @structure frame (shared) · ask(spec) · propose(spec) · handoff(spec)
 * @usage
 *   AIMEAT.atelier.ask({ target: '#work', kind: 'signIn', lead: 'Your notes are kept in your own AIMEAT.' });
 *   AIMEAT.atelier.propose({ target: row, kind: 'draft', title: 'Reminder of invoice 1042',
 *     body: draftText, onAccept: send, onEdit: openEditor, onReject: drop });
 *   AIMEAT.atelier.handoff({ target: host, kind: 'say', text: 'Make me an agent that watches my invoices.' });
 * @version-history
 *   v0.73.0 — 2026-11-27 — Initial (wish-atelier-contextual-templates-pyynt-lohko-ask).
 */
import { el, clear, resolve, enter, uid, whileBusy } from './dom.js';
import { i18n } from './i18n.js';
import { copy, selectForHand } from './copy.js';
import { partValue, fillPart, applyVariant } from './parts-model.js';
import { promptPanel } from './workbench-parts.js';
import { refusalWords } from './members-shared.js';
import { dateTime } from '../_core/format.js';
import { tmo } from './moments-i18n.js';

/** The eight stops, in the order `requires` reports them. */
export const ASK_KINDS = ['signIn', 'settings', 'access', 'permission', 'refused', 'device', 'limit', 'offline'];
/** The four proposals. */
export const PROPOSE_KINDS = ['draft', 'extract', 'change', 'run'];
/** The two hand-offs. */
export const HANDOFF_KINDS = ['say', 'prompt'];
/** What the browser may be asked for by a `device` stop. */
const DEVICES = ['microphone', 'camera', 'location'];

/**
 * One of the allowed kinds, or the first of them with a word in the console: a typo that silently
 * drew nothing is the bug this guard exists to prevent.
 * @param {unknown} kind @param {string[]} allowed @param {string} block @returns {string}
 */
function kindOf(kind, allowed, block) {
  if (allowed.indexOf(String(kind)) >= 0) return String(kind);
  console.warn('aimeat-atelier: ' + block + ' has no kind "' + kind + '" — it has: ' + allowed.join(', '));
  return allowed[0];
}

/**
 * A date the caller gave, in the page's language; a text that is not a date stays as written.
 * @param {unknown} when @returns {string}
 */
function whenWords(when) {
  if (when == null || when === '') return '';
  if (when instanceof Date || !Number.isNaN(Date.parse(String(when)))) {
    return dateTime(/** @type {any} */ (when), { dateStyle: 'medium', timeStyle: 'short' });
  }
  return String(when);
}

/**
 * One part of the frame: what the app declared for it, else the kit's own content; nothing at all
 * when neither has anything, and nothing when the app declared `null`.
 * @param {HTMLElement} host @param {any} spec @param {string} name @param {string} tag
 * @param {any} own @param {Record<string, any>} [attrs]
 * @returns {HTMLElement|null}
 */
function put(host, spec, name, tag, own, attrs) {
  const given = partValue(spec, name);
  if (given === null) return null;
  const value = given === undefined ? own : given;
  if (value == null || value === '' || value === false) return null;
  const node = el(tag, Object.assign({ class: 'ak-ask__' + name, 'data-ak-part': name }, attrs || {}));
  if (!fillPart(node, value)) return null;
  host.appendChild(node);
  return node;
}

/**
 * The shared frame: root attributes, then the words (kicker, title, lead). The caller appends the
 * body, the ways and the note after it.
 * @param {HTMLElement} root @param {any} spec @param {string} block  'ask' | 'propose' | 'handoff'
 * @param {string} kind @param {{ kicker: string, title: string, lead: string }} words
 */
function frame(root, spec, block, kind, words) {
  clear(root);
  root.className = 'ak-root ak-ask ak-ask--' + block;
  root.setAttribute('data-ak-kind', kind);
  root.removeAttribute('data-ak-variant');
  applyVariant(root, spec, ['inline']);
  const box = el('div', { class: 'ak-ask__words', 'data-ak-part': 'words' });
  root.appendChild(box);
  const kicker = put(box, spec, 'kicker', 'p', words.kicker);
  if (kicker && spec.sample) kicker.appendChild(el('span', { class: 'ak-ask__sample' }, tmo('sample')));
  const titleId = uid('ak-ask');
  const title = put(box, spec, 'title', 'h3', words.title, { id: titleId });
  put(box, spec, 'lead', 'p', words.lead);
  if (title) { root.setAttribute('role', 'group'); root.setAttribute('aria-labelledby', titleId); }
}

/**
 * One way out: a button that runs something, or a link that opens an address.
 * @param {{ label: string, run?: () => any, href?: string, tone?: string, part?: string, direct?: boolean }} way
 * @param {boolean} first  the first way is the primary one unless its tone says otherwise
 * @param {boolean} sample
 * @param {(why: string) => void} onFail
 * @returns {HTMLElement}
 */
function wayButton(way, first, sample, onFail) {
  const cls = 'ak-btn' + ((way.tone ? way.tone === 'primary' : first) ? ' ak-btn--primary' : '');
  const part = way.part || 'way';
  if (way.href) {
    return el('a', { class: cls, href: sample ? null : way.href, target: '_blank', rel: 'noopener', 'data-ak-part': part }, way.label);
  }
  const b = el('button', { type: 'button', class: cls, 'data-ak-part': part, 'data-ak-noguard': way.direct ? true : null }, way.label);
  b.addEventListener('click', function () {
    if (sample || typeof way.run !== 'function') return;
    // A direct way (the sign-in window, the browser's permission question) needs the click
    // itself as its user gesture, so it is called in the handler and never behind a busy guard.
    const work = Promise.resolve().then(way.run);
    (way.direct ? work : whileBusy(b, work)).catch(function (e) { onFail(String((e && e.message) || e)); });
  });
  return b;
}

// ── ask: a stop ──────────────────────────────────────────────────────────────────────────────

/**
 * A stop: why a block cannot work now, and the one thing the person does about it.
 * @param {{
 *   target?: string|Element,
 *   kind: 'signIn'|'settings'|'access'|'permission'|'refused'|'device'|'limit'|'offline',
 *   kicker?: string, title?: string, lead?: string, note?: string, body?: any,
 *   ways?: Array<{ label: string, run?: () => any, href?: string, tone?: 'primary'|'quiet' }>|null,
 *   url?: string, wayLabel?: string,
 *   what?: 'microphone'|'camera'|'location', request?: () => any, onGranted?: () => void, onDenied?: (e: any) => void,
 *   when?: string|Date, code?: string, details?: any,
 *   onRetry?: () => any,
 *   variant?: 'inline', parts?: Record<string, any>, sample?: boolean,
 * }} spec0
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function ask(spec0) {
  /** @type {any} */
  const spec = Object.assign({}, spec0);
  const root = el('section', { class: 'ak-root ak-ask', 'data-ak-part': 'root' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let failure = '';
  let denied = false;

  /** The browser's own permission question, with the stream released the moment it is granted. */
  async function requestDevice() {
    const what = DEVICES.indexOf(spec.what) >= 0 ? spec.what : 'microphone';
    try {
      if (typeof spec.request === 'function') await spec.request();
      else if (what === 'location') {
        await new Promise(function (ok, no) { navigator.geolocation.getCurrentPosition(function () { ok(null); }, no); });
      } else {
        const stream = await navigator.mediaDevices.getUserMedia(what === 'camera' ? { video: true } : { audio: true });
        stream.getTracks().forEach(function (t) { t.stop(); });
      }
      denied = false;
      if (spec.onGranted) spec.onGranted();
    } catch (e) {
      denied = true;
      draw();
      if (spec.onDenied) spec.onDenied(e);
    }
  }

  /** The way out a kind finds on the page, when the caller named none. */
  function ownWays(kind, key) {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (kind === 'signIn') {
      const auth = ns && ns.auth;
      return auth && typeof auth.signIn === 'function'
        ? [{ label: tmo('ask.signIn.way'), run: function () { return auth.signIn(); }, direct: true }] : [];
    }
    if (kind === 'settings' || kind === 'permission') {
      return spec.url ? [{ label: spec.wayLabel || tmo('ask.' + kind + '.way'), href: String(spec.url) }] : [];
    }
    if (kind === 'device') return [{ label: tmo(key + '.way'), run: requestDevice, direct: true }];
    if (kind === 'offline') {
      return typeof spec.onRetry === 'function' ? [{ label: tmo('ask.offline.way'), run: spec.onRetry, tone: 'quiet' }] : [];
    }
    return [];
  }

  function draw() {
    const kind = kindOf(spec.kind, ASK_KINDS, 'ask');
    const what = DEVICES.indexOf(spec.what) >= 0 ? spec.what : 'microphone';
    const key = kind === 'device' ? 'ask.device.' + what : 'ask.' + kind;
    let lead = spec.lead;
    if (lead == null) {
      if (kind === 'device') lead = tmo(denied ? 'ask.device.denied' : 'ask.device.lead');
      else if ((kind === 'refused' || kind === 'limit') && spec.when) lead = tmo(key + '.when', { d: whenWords(spec.when) });
      else if (kind === 'refused' && spec.code) lead = refusalWords(spec.code, spec.details);
      else lead = tmo(key + '.lead');
    }
    frame(root, spec, 'ask', kind, {
      kicker: spec.kicker == null ? tmo(key + '.kicker') : spec.kicker,
      title: spec.title == null ? tmo(key + '.title') : spec.title,
      lead: lead,
    });
    put(root, spec, 'body', 'div', spec.body);
    const ways = spec.ways === null ? [] : (Array.isArray(spec.ways) ? spec.ways : ownWays(kind, key));
    if (ways.length) {
      const row = el('div', { class: 'ak-ask__ways', 'data-ak-part': 'ways' });
      ways.forEach(function (w, i) {
        row.appendChild(wayButton(w, i === 0, !!spec.sample, function (why) { failure = why; draw(); }));
      });
      root.appendChild(row);
    }
    // The sign-in stop says where the sign-in happens, because the button opens a window of its
    // own and a person who expected a form on this page looks for one. The inline row stays one row.
    const ownNote = kind === 'signIn' && ways.length && spec.ways === undefined && spec.variant !== 'inline'
      ? tmo('ask.signIn.note') : '';
    put(root, spec, 'note', 'p', failure ? tmo('failed', { why: failure }) : (spec.note == null ? ownNote : spec.note));
  }

  function online() { if (spec.kind === 'offline' && typeof spec.onRetry === 'function' && !spec.sample) spec.onRetry(); }
  window.addEventListener('online', online);
  draw();
  enter(root);
  const stopLang = i18n.onChange(function () { if (root.isConnected) draw(); });
  return {
    el: root,
    set: function (patch) { Object.assign(spec, patch || {}); failure = ''; draw(); },
    destroy: function () {
      window.removeEventListener('online', online);
      if (typeof stopLang === 'function') stopLang();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

// ── propose: a machine or another person proposes, the person decides ───────────────────────

/**
 * A proposal and its decision. The three presses report to the app; a handler that returns
 * `false` keeps the proposal open (the app's own editor was cancelled), anything else settles it.
 * @param {{
 *   target?: string|Element,
 *   kind: 'draft'|'extract'|'change'|'run',
 *   kicker?: string, title: string, lead?: string, note?: string,
 *   body?: any, source?: string, steps?: string[],
 *   gate?: boolean, state?: 'open'|'accepted'|'rejected',
 *   onAccept?: () => any, onEdit?: () => any, onReject?: () => any,
 *   labels?: { accept?: string, edit?: string, reject?: string },
 *   variant?: 'inline', parts?: Record<string, any>, sample?: boolean,
 * }} spec0
 * @returns {{ el: HTMLElement, set: (patch: any) => void, state: () => string, destroy: () => void }}
 */
export function propose(spec0) {
  /** @type {any} */
  const spec = Object.assign({}, spec0);
  const root = el('section', { class: 'ak-root ak-ask', 'data-ak-part': 'root' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let state = spec.state === 'accepted' || spec.state === 'rejected' ? spec.state : 'open';
  let failure = '';

  function draw() {
    const kind = kindOf(spec.kind, PROPOSE_KINDS, 'propose');
    const key = 'propose.' + kind;
    const gated = spec.gate !== false;
    frame(root, spec, 'propose', kind, {
      kicker: spec.kicker == null ? tmo(key + '.kicker') : spec.kicker,
      title: spec.title == null ? '' : spec.title,
      lead: spec.lead == null ? '' : spec.lead,
    });
    root.setAttribute('data-ak-state', gated ? state : 'auto');

    const given = partValue(spec, 'body');
    const hasEvidence = spec.body != null || spec.source || (Array.isArray(spec.steps) && spec.steps.length) || given != null;
    if (hasEvidence && given !== null) {
      const body = el('div', { class: 'ak-ask__body', 'data-ak-part': 'body' });
      if (given !== undefined) fillPart(body, given);
      else {
        if (spec.body != null) fillPart(body, spec.body);
        if (spec.source) {
          body.appendChild(el('p', { class: 'ak-ask__source', 'data-ak-part': 'source' }, [
            el('b', null, tmo('propose.extract.source') + ' '), String(spec.source),
          ]));
        }
        if (Array.isArray(spec.steps) && spec.steps.length) {
          body.appendChild(el('ol', { class: 'ak-ask__steps', 'data-ak-part': 'steps' },
            spec.steps.map(function (s) { return el('li', { 'data-ak-part': 'step' }, String(s)); })));
        }
      }
      root.appendChild(body);
    }

    if (gated && state === 'open') {
      const labels = spec.labels || {};
      const row = el('div', { class: 'ak-ask__ways', 'data-ak-part': 'ways' });
      /** @param {'accept'|'edit'|'reject'} which @param {any} fn @param {boolean} always */
      const add = function (which, fn, always) {
        if (!always && typeof fn !== 'function') return;
        row.appendChild(wayButton({
          label: labels[which] || tmo(key + '.' + which),
          part: which,
          tone: which === 'accept' ? 'primary' : 'quiet',
          run: function () {
            return Promise.resolve(typeof fn === 'function' ? fn() : undefined).then(function (answer) {
              if (which === 'edit' || answer === false) return;
              state = which === 'accept' ? 'accepted' : 'rejected';
              failure = '';
              draw();
            });
          },
        }, false, !!spec.sample, function (why) { failure = why; draw(); }));
      };
      add('accept', spec.onAccept, true);
      add('edit', spec.onEdit, false);
      add('reject', spec.onReject, kind !== 'extract');
      root.appendChild(row);
    }

    let note = spec.note;
    if (failure) note = tmo('failed', { why: failure });
    else if (!gated) note = spec.note || tmo(key + '.auto');
    else if (state !== 'open') note = spec.note || tmo(key + '.' + state);
    put(root, spec, 'note', 'p', note);
  }

  draw();
  enter(root);
  const stopLang = i18n.onChange(function () { if (root.isConnected) draw(); });
  return {
    el: root,
    set: function (patch) {
      Object.assign(spec, patch || {});
      if (patch && (patch.state === 'open' || patch.state === 'accepted' || patch.state === 'rejected')) state = patch.state;
      failure = '';
      draw();
    },
    state: function () { return spec.gate === false ? 'auto' : state; },
    destroy: function () {
      if (typeof stopLang === 'function') stopLang();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

// ── handoff: take this to your own AI ────────────────────────────────────────────────────────

/**
 * A hand-off to the person's own AI: one sentence to copy (`say`), or a prompt whose answer comes
 * back (`prompt`, the kit's prompt panel inside this frame).
 * @param {{
 *   target?: string|Element,
 *   kind: 'say'|'prompt',
 *   kicker?: string, title?: string, lead?: string, note?: string,
 *   text?: string | (() => string), copyLabel?: string, onCopied?: (text: string) => void,
 *   prompt?: string | (() => string), expect?: 'json'|'text'|null, onResult?: (value: any, raw: string) => any,
 *   applyLabel?: string,
 *   variant?: 'inline', parts?: Record<string, any>, sample?: boolean,
 * }} spec0
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function handoff(spec0) {
  /** @type {any} */
  const spec = Object.assign({}, spec0);
  const root = el('section', { class: 'ak-root ak-ask', 'data-ak-part': 'root' });
  if (spec.target) resolve(spec.target).appendChild(root);
  /** @type {{ destroy: () => void }|null} */
  let panel = null;
  let said = '';

  function draw() {
    if (panel) { panel.destroy(); panel = null; }
    const kind = kindOf(spec.kind, HANDOFF_KINDS, 'handoff');
    const key = 'handoff.' + kind;
    frame(root, spec, 'handoff', kind, {
      kicker: spec.kicker == null ? tmo(key + '.kicker') : spec.kicker,
      title: spec.title == null ? tmo(key + '.title') : spec.title,
      lead: spec.lead == null ? '' : spec.lead,
    });
    const body = el('div', { class: 'ak-ask__body', 'data-ak-part': 'body' });
    root.appendChild(body);
    if (kind === 'prompt') {
      panel = promptPanel({
        target: body,
        prompt: spec.prompt == null ? '' : spec.prompt,
        expect: spec.expect,
        onResult: spec.sample ? undefined : spec.onResult,
        copyLabel: spec.copyLabel,
        applyLabel: spec.applyLabel,
      });
      put(root, spec, 'note', 'p', spec.note);
      return;
    }
    const text = String(typeof spec.text === 'function' ? spec.text() : (spec.text == null ? '' : spec.text));
    const line = el('p', { class: 'ak-ask__say', 'data-ak-part': 'say' }, text);
    body.appendChild(line);
    const row = el('div', { class: 'ak-ask__ways', 'data-ak-part': 'ways' });
    row.appendChild(wayButton({
      label: spec.copyLabel || tmo('handoff.say.copy'),
      run: function () {
        return copy(text).then(function (ok) {
          if (!ok) selectForHand(line);
          said = tmo(ok ? 'handoff.say.copied' : 'handoff.say.copyFailed');
          const old = root.querySelector('[data-ak-part="note"]');
          if (old && old.parentNode) old.parentNode.removeChild(old);
          put(root, {}, 'note', 'p', said, { role: 'status' });
          if (ok && spec.onCopied) spec.onCopied(text);
        });
      },
    }, true, !!spec.sample, function () { /* copy() never rejects */ }));
    root.appendChild(row);
    put(root, spec, 'note', 'p', said || spec.note, said ? { role: 'status' } : undefined);
  }

  draw();
  enter(root);
  const stopLang = i18n.onChange(function () { if (root.isConnected) { said = ''; draw(); } });
  return {
    el: root,
    set: function (patch) { Object.assign(spec, patch || {}); said = ''; draw(); },
    destroy: function () {
      if (panel) panel.destroy();
      if (typeof stopLang === 'function') stopLang();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
