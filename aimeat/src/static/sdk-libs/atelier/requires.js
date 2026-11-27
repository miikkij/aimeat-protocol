/**
 * @file atelier/requires.js
 * @description WHAT A SCREEN NEEDS, SAID ONCE. An app names what one area of its page needs before
 *   it can work (`needs: ['session', 'ai']`), and this block does the rest: it finds the first need
 *   that is not met, draws that stop (moments.js `ask`), waits for the person, and calls the app's
 *   `render` when every need is met. It is accessState (members.js) made general: that block knows
 *   one need, membership; this one knows four and draws them all the same way.
 *
 *   THE NEEDS (a closed list; an unknown word is said on the page, never skipped in silence):
 *     session        somebody is signed in (AIMEAT.auth)
 *     ai             the person's own AI route answers for this app (AIMEAT.ai; needs `app`)
 *     member:<cap>   the person's role in this app holds <cap> (AIMEAT.iam; needs `app`)
 *     online         the browser has a connection
 *
 *   WHAT FETCHES AND WHY. The kit's charter is "it renders; it does not fetch", and this block
 *   keeps it: every read goes through the platform library the page loaded (AIMEAT.auth,
 *   AIMEAT.ai, AIMEAT.iam). A need whose library is absent is said on the page in words.
 *
 *   A SIGNED-OUT VISITOR IS A STATE, NOT A FLASH. The app-origin silent sign-in resolves late and
 *   may raise no event, so the first look waits a short grace before it draws the sign-in stop
 *   (the same grace the app shell gives, shell.js SIGNIN_GRACE_MS), and while that stop stands the
 *   block reads the session on a local timer. The timer reads memory, never the network.
 *
 *   THE APP'S CONTENT IS DRAWN ONCE. `render(host, ctx)` runs when the needs become met, not on
 *   every language change or repeated sign-in event, so what the person was doing stays. When a
 *   need stops being met (a sign-out) the content is removed and the stop stands in its place.
 *
 *   THE STATE IS ON THE ELEMENT. `data-ak-state` on the root is `checking`, the kind of the stop
 *   that stands (`signIn`, `settings`, `access`, `offline`), `blocked` for a page that lacks a
 *   library, or `ready`. A playtest scenario asserts on it, so an app that declares its needs can
 *   prove them without a line of its own.
 *
 *   THE SAMPLE STATE. `sample: true`, or an `app` that is still a fill's <placeholder>, draws the
 *   first need's stop marked as a sample and reads nothing.
 * @parts requires root · checking · note
 * @fork requires Copying it out means reading AIMEAT.auth.getSession(), AIMEAT.ai.capabilities() and AIMEAT.iam.can() yourself, in order, and drawing each refusal.
 * @use requires wait · layout
 * @structure NEEDS · kindOfNeed · requires(spec) (check · run · show · pollSession)
 * @usage
 *   AIMEAT.atelier.requires({ target: '#work', needs: ['session', 'ai'], app: 'me/notes.html',
 *     render(host) { drawNotes(host); } });
 * @version-history
 *   v0.73.0 — 2026-11-27 — Initial (wish-atelier-contextual-templates-pyynt-lohko-ask).
 */
import { el, clear, resolve } from './dom.js';
import { ask } from './moments.js';
import { tmo } from './moments-i18n.js';
import { probeAi } from './ai-task.js';
import { watch, ready, isPlaceholder } from './members-shared.js';
import { joinRequest } from './members.js';

/** The plain needs; `member:<cap>` is the fourth. */
export const NEEDS = ['session', 'ai', 'online'];

/** How long the first look waits for a silent sign-in before it draws the sign-in stop. */
const GRACE_MS = 2500;
/** How often the session is read from memory while the sign-in stop stands. */
const POLL_MS = 300;

/**
 * The stop a need draws when it is not met, for the sample state.
 * @param {string} need @returns {'signIn'|'settings'|'access'|'offline'}
 */
function kindOfNeed(need) {
  if (need === 'ai') return 'settings';
  if (need === 'online') return 'offline';
  if (need.indexOf('member:') === 0) return 'access';
  return 'signIn';
}

/**
 * Draw an area's stop until its needs are met, then the app's own content.
 * @param {{
 *   target?: string|Element,
 *   needs: string[],
 *   app?: string, roles?: any,
 *   render?: (host: HTMLElement, ctx: { session: any }) => void,
 *   onState?: (state: string) => void,
 *   signInLead?: string,
 *   variant?: 'inline', sample?: boolean,
 * }} spec
 * @returns {{ el: HTMLElement, check: () => Promise<void>, state: () => string, destroy: () => void }}
 */
export function requires(spec) {
  const needs = Array.isArray(spec.needs) ? spec.needs.map(String) : [];
  const sample = spec.sample === true || (spec.app != null && isPlaceholder(spec.app));
  const root = el('section', {
    class: 'ak-root ak-requires', 'data-ak-part': 'root',
    'data-ak-requires': needs.join(' '), 'data-ak-state': 'checking',
  });
  if (spec.target) resolve(spec.target).appendChild(root);

  /** @type {{ destroy: () => void }|null} */
  let stopCard = null;
  /** @type {{ destroy: () => void }|null} */
  let inner = null;
  /** @type {any} */
  let timer = null;
  let open = false;
  let state = 'checking';
  let destroyed = false;
  let seq = 0;
  const started = Date.now();

  function authOf() {
    const ns = /** @type {any} */ (window).AIMEAT;
    return ns && ns.auth ? ns.auth : null;
  }

  /** @param {string} next */
  function setState(next) {
    if (state === next) return;
    state = next;
    root.setAttribute('data-ak-state', next);
    if (typeof spec.onState === 'function') spec.onState(next);
  }

  function dropStop() {
    if (inner) { inner.destroy(); inner = null; }
    if (stopCard) { stopCard.destroy(); stopCard = null; }
  }

  /** Remove whatever stands in the area: the app's content, a stop, or the checking line. */
  function empty() {
    dropStop();
    open = false;
    clear(root);
  }

  /**
   * One stop in the area's place.
   * @param {string} kind @param {Record<string, any>} [more]
   */
  function show(kind, more) {
    empty();
    stopCard = ask(/** @type {any} */ (Object.assign({ target: root, kind: kind, variant: spec.variant, sample: sample }, more || {})));
    setState(kind);
  }

  /** A page that lacks what a need reads says so in words; this is the builder's to fix. */
  function blocked(text) {
    empty();
    root.appendChild(el('p', { class: 'ak-ask__builder', 'data-ak-part': 'note' }, text));
    setState('blocked');
  }

  /**
   * The first need that is not met, or `{ ready: true }`.
   * @returns {Promise<{ ready?: boolean, kind?: string, more?: Record<string, any>, blocked?: string, wait?: boolean }>}
   */
  async function check() {
    for (const need of needs) {
      if (need === 'online') {
        if (navigator.onLine === false) return { kind: 'offline', more: { onRetry: run } };
        continue;
      }
      if (need === 'session') {
        const auth = authOf();
        if (!auth || typeof auth.getSession !== 'function') return { blocked: tmo('noLib', { lib: 'aimeat-auth.js' }) };
        if (!auth.getSession()) return { kind: 'signIn', wait: true };
        continue;
      }
      if (need === 'ai') {
        const st = await probeAi(String(spec.app || ''), false);
        if (st.avail === 'nolib') return { blocked: tmo('noLib', { lib: 'aimeat-ai.js' }) };
        if (st.avail === 'signedout') return { kind: 'signIn', wait: true };
        if (st.avail === 'off') {
          return { kind: 'settings', more: {
            title: tmo('ask.settings.ai.title'),
            lead: st.fix || tmo('ask.settings.ai.lead'),
            url: st.settingsUrl || undefined,
            wayLabel: tmo('ask.settings.ai.way'),
          } };
        }
        continue;
      }
      if (need.indexOf('member:') === 0 && need.length > 7 && spec.app) {
        const iam = await ready({ app: spec.app, roles: spec.roles });
        if (!iam) return { blocked: tmo('noLib', { lib: 'aimeat-iam.js' }) };
        const me = iam.me();
        if (!(me && (me.isOwner || iam.can(need.slice(7))))) return { kind: 'access' };
        continue;
      }
      return { blocked: tmo('unknownNeed', { need: need }) };
    }
    return { ready: true };
  }

  /** While the sign-in stop stands: read the session from memory until one is there. */
  function pollSession() {
    timer = null;
    if (destroyed || !root.isConnected) return;
    const auth = authOf();
    if (auth && typeof auth.getSession === 'function' && auth.getSession()) { run(); return; }
    timer = setTimeout(pollSession, POLL_MS);
  }

  /** @returns {Promise<void>} */
  function run() {
    const mine = ++seq;
    if (timer) { clearTimeout(timer); timer = null; }
    if (sample) {
      show(needs.length ? kindOfNeed(needs[0]) : 'signIn', needs[0] === 'ai'
        ? { title: tmo('ask.settings.ai.title'), lead: tmo('ask.settings.ai.lead') } : undefined);
      return Promise.resolve();
    }
    return check().then(function (v) {
      if (destroyed || mine !== seq) return;
      if (v.ready) {
        if (open) return;
        empty();
        open = true;
        setState('ready');
        const auth = authOf();
        if (typeof spec.render === 'function') {
          spec.render(root, { session: auth && typeof auth.getSession === 'function' ? auth.getSession() : null });
        }
        return;
      }
      if (v.blocked) { blocked(v.blocked); return; }
      if (v.kind === 'signIn' && v.wait) {
        if (state === 'checking' && Date.now() - started < GRACE_MS) {
          if (!root.firstChild) root.appendChild(el('p', { class: 'ak-ask__checking', 'data-ak-part': 'checking' }, tmo('checking')));
          timer = setTimeout(run, POLL_MS);
          return;
        }
        if (state !== 'signIn') show('signIn', spec.signInLead ? { lead: spec.signInLead } : undefined);
        timer = setTimeout(pollSession, POLL_MS);
        return;
      }
      if (v.kind === 'access') {
        const host = el('div');
        show('access', { body: host, ways: null });
        inner = joinRequest({ target: host, app: String(spec.app), roles: spec.roles });
        return;
      }
      show(String(v.kind), v.more);
    }).catch(function (e) {
      if (destroyed || mine !== seq) return;
      blocked(tmo('failed', { why: String((e && e.message) || e) }));
    });
  }

  function onNet() { if (!destroyed && root.isConnected) run(); }
  const watchesNet = needs.indexOf('online') >= 0;
  if (watchesNet) { window.addEventListener('online', onNet); window.addEventListener('offline', onNet); }
  // A sign-in, a sign-out or a language change: look again. A stop that stands is drawn again in
  // the new language; content that stands is left alone (run() returns when it is already open).
  const stopWatch = watch(function () {
    if (state !== 'ready' && state !== 'checking') { state = 'again'; }
    run();
  }, root);
  run();

  return {
    el: root,
    check: run,
    state: function () { return state; },
    destroy: function () {
      destroyed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (watchesNet) { window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); }
      stopWatch();
      dropStop();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
