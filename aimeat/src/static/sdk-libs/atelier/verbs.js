/**
 * @file atelier/verbs.js
 * @description The card verbs — the one runtime behind a control that says what it wants instead
 *   of carrying a script. A button (or any element) declares `data-ak-do="<verb>"`, names where
 *   its arguments come from (`data-ak-in="name=#elementId, other=literal"`) and where the answer
 *   goes (`data-ak-out="#elementId"`), and this module runs it. From ORIGAMI 1.2.0's card
 *   runtime, where the same attributes are spelled `data-og-*`; both spellings are read, so a
 *   card published before this file keeps working.
 *
 *   The verbs: `copy`, `random`, `now` and `count` are local and instant. `read` shows a PUBLIC
 *   memory value and reads it again on a timer, so a number stays true on a card that left the
 *   board. `save` writes what was typed into the signed-in person's memory under a prefix.
 *   `submit` POSTs to a public intake address with no session, which is what lets a stranger
 *   answer. `ai` asks the person's own AI. `offer` and `tool` reach an agent task and a priced
 *   app-tool, and the app supplies those two through `adapters`, because the routes they take
 *   belong to the app's contract, not to the kit.
 *
 *   WHAT FETCHES AND WHY. The kit's charter is that it renders; every read and write here goes
 *   through the platform libraries the page loaded (AIMEAT.data, AIMEAT.ai) or through an
 *   adapter the app gave, and `submit` is a plain fetch to the address the card names, with
 *   nothing about the sender attached. A verb whose library is absent says so in the output.
 * @parts verbs (none: it renders nothing of its own; the words it writes go into the element the card names)
 * @fork verbs Copy the run() switch out and keep the attribute names; you give up the on-sight reads, the picture detection and the sign-in wait.
 * @structure verbs(spec) → { run, scan, destroy } · attr/ref readers · say/show · the verbs
 * @usage
 *   var v = AIMEAT.atelier.verbs({ root: card, adapters: { offer: commission, tool: callTool } });
 *   // <button data-ak-do="submit" data-ak-target="/v1/intake/{org}/{ws}/{form}"
 *   //         data-ak-in="etunimi=#first, email=#mail" data-ak-out="#said">I will be there</button>
 * @version-history
 *   v0.64.0 — 2026-10-02 — Initial (wish-origami-atelieriin-ja-laudan-osat-kitin-lohkoiksi-ja-design-).
 */
import { resolve } from './dom.js';
import { copy } from './copy.js';
import { date, time, dateTime } from '../_core/format.js';
import { tb } from './board-i18n.js';

const PREFIXES = ['ak', 'og'];
const READ_MIN_S = 5;
const READ_DEFAULT_S = 20;

/** The first spelling of an attribute that the element carries. */
function attr(elm, name) {
  for (const p of PREFIXES) {
    const v = elm.getAttribute('data-' + p + '-' + name);
    if (v != null) return v;
  }
  return null;
}

/** A picture URL inside a value, or null. */
export function pictureIn(v) {
  const text = typeof v === 'string' ? v : JSON.stringify(v || '');
  const m = text.match(/https?:\/\/[^\s"')<>]+\.(?:png|jpe?g|gif|webp|svg)/i)
    || text.match(/https?:\/\/[^\s"')<>]*\/v1\/pub\/[^\s"')<>]+/i);
  return m ? m[0] : null;
}

/** `owner/key` or `key`: the owner whose public memory to read, and the key. */
export function splitTarget(target, selfOwner) {
  const at = String(target || '').trim();
  const cut = at.indexOf('/');
  return cut < 0 ? { gaii: selfOwner || '', key: at } : { gaii: at.slice(0, cut), key: at.slice(cut + 1) };
}

/**
 * The card verbs on one root.
 * @param {{
 *   root: string|Element, owner?: string, lang?: string,
 *   adapters?: {
 *     read?: (gaii: string, key: string) => Promise<any>,
 *     save?: (key: string, body: object) => Promise<any>,
 *     submit?: (url: string, body: object) => Promise<any>,
 *     ai?: (prompt: string) => Promise<string>,
 *     offer?: (target: string, input: Record<string, string>, report: (text: string, bad?: boolean) => void) => Promise<any>,
 *     tool?: (target: string, input: Record<string, string>, report: (text: string, bad?: boolean) => void) => Promise<any>,
 *   },
 *   signedIn?: () => boolean,
 *   onError?: (err: any, el: Element) => void,
 * }} spec
 * @returns {{ run: (el: Element) => Promise<void>, scan: () => void, destroy: () => void }}
 */
export function verbs(spec) {
  const root = /** @type {HTMLElement} */ (resolve(spec.root));
  const adapters = spec.adapters || {};
  const ns = /** @type {any} */ (window).AIMEAT || {};
  /** @type {Map<Element, number>} */
  const timers = new Map();
  let destroyed = false;

  function ref(sel) {
    if (!sel) return null;
    const id = String(sel).replace(/^#/, '');
    for (const p of PREFIXES) {
      const hit = root.querySelector('[data-' + p + '-el="' + id.replace(/"/g, '') + '"]');
      if (hit) return hit;
    }
    const byId = root.querySelector('#' + id.replace(/[^A-Za-z0-9_-]/g, ''));
    return byId || document.getElementById(id);
  }
  function readArgs(elm) {
    const out = {};
    String(attr(elm, 'in') || '').split(',').forEach(function (part) {
      const eq = part.indexOf('=');
      if (eq < 0) return;
      const name = part.slice(0, eq).trim(), from = part.slice(eq + 1).trim();
      if (!name) return;
      if (from.charAt(0) === '#') {
        const src = /** @type {any} */ (ref(from));
        out[name] = src ? (src.value !== undefined ? src.value : src.textContent) : '';
      } else out[name] = from;
    });
    return out;
  }
  function clearInputs(elm) {
    String(attr(elm, 'in') || '').split(',').forEach(function (part) {
      const eq = part.indexOf('=');
      if (eq < 0) return;
      const src = /** @type {any} */ (ref(part.slice(eq + 1).trim()));
      if (src && src.value !== undefined) src.value = '';
    });
  }
  function outOf(elm) { return ref(attr(elm, 'out')); }
  function say(out, text, bad) {
    if (!out) return;
    out.textContent = text;
    out.classList.toggle('ak-verbs__said', true);
    out.classList.toggle('ak-verbs__bad', !!bad);
  }
  function show(out, value) {
    if (!out) return;
    out.classList.remove('ak-verbs__bad');
    const url = pictureIn(value);
    if (out.tagName === 'IMG') {
      if (url) { out.setAttribute('src', url); out.removeAttribute('hidden'); }
      else { out.setAttribute('hidden', ''); }
      return;
    }
    if (url) {
      out.textContent = '';
      const im = document.createElement('img');
      im.setAttribute('src', url);
      im.setAttribute('alt', '');
      im.className = 'ak-verbs__picture';
      out.appendChild(im);
      return;
    }
    const anyOut = /** @type {any} */ (out);
    if (anyOut.value !== undefined && out.tagName === 'INPUT') { anyOut.value = typeof value === 'string' ? value : JSON.stringify(value); return; }
    out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  }
  function pick(value, path) {
    if (!path) return value;
    return String(path).split('.').reduce(function (v, k) { return (v === null || v === undefined) ? v : v[k]; }, value);
  }
  function signedIn() {
    if (spec.signedIn) return !!spec.signedIn();
    try { const s = ns.auth && ns.auth.getSession && ns.auth.getSession(); return !!(s && s.jwt); } catch { return false; }
  }

  async function run(elm) {
    const kind = attr(elm, 'do');
    const target = attr(elm, 'target') || '';
    const out = outOf(elm);
    const input = readArgs(elm);
    try {
      if (kind === 'random') {
        const n = Math.max(1, Math.min(100, parseInt(attr(elm, 'count') || '6', 10) || 6));
        let lo = parseInt(attr(elm, 'min') || '1', 10) || 0, hi = parseInt(attr(elm, 'max') || '40', 10) || 40;
        if (hi < lo) { const sw = lo; lo = hi; hi = sw; }
        const nums = [];
        for (let i = 0; i < n; i++) nums.push(lo + Math.floor(Math.random() * (hi - lo + 1)));
        show(out, nums.join(', '));
        return;
      }
      if (kind === 'now') {
        // The person's own regional format and time zone, through the platform formatter.
        const d = new Date(), f = attr(elm, 'format') || 'datetime';
        show(out, f === 'date' ? date(d) : f === 'time' ? time(d) : dateTime(d));
        return;
      }
      if (kind === 'count') {
        const step = parseInt(attr(elm, 'step') || '1', 10) || 1;
        const was = parseInt(String((out && out.textContent) || '0').replace(/[^\-0-9]/g, ''), 10);
        show(out, String((isNaN(was) ? 0 : was) + step));
        return;
      }
      if (kind === 'copy') {
        const what = Object.keys(input).map(function (k) { return input[k]; }).join(' ').trim() || (out && out.textContent) || '';
        const ok = await copy(what);
        if (out && out !== elm) say(out, ok ? tb('verbs.copied') : tb('verbs.failed'), !ok);
        return;
      }
      if (kind === 'read') {
        const where = splitTarget(target, spec.owner);
        if (!where.key) { say(out, tb('verbs.noTarget'), true); return; }
        const reader = adapters.read || function (g, k) { return ns.data && ns.data.getPublic ? ns.data.getPublic(g, k) : Promise.reject(new Error(tb('verbs.notHere'))); };
        const got = await reader(where.gaii, where.key);
        const val = pick(got, attr(elm, 'pick'));
        show(out, (val === null || val === undefined) ? '-' : val);
        return;
      }
      if (kind === 'submit') {
        const url = String(target).trim();
        if (!url) { say(out, tb('verbs.noTarget'), true); return; }
        if (!Object.keys(input).length) { say(out, tb('verbs.nothing'), true); return; }
        say(out, tb('verbs.sending'));
        const poster = adapters.submit || async function (u, body) {
          const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const got = await res.json().catch(function () { return {}; });
          if (!res.ok || got.ok === false) throw new Error((got.error && (got.error.message || got.error.code)) || ('HTTP ' + res.status));
          return got;
        };
        await poster(url, input);
        say(out, tb('verbs.sent'));
        clearInputs(elm);
        return;
      }
      if (kind === 'save') {
        const where = String(target).replace(/\.+$/, '');
        if (!where) { say(out, tb('verbs.noTarget'), true); return; }
        if (!Object.keys(input).length) { say(out, tb('verbs.nothing'), true); return; }
        if (!signedIn()) { say(out, tb('verbs.signIn'), true); return; }
        const body = Object.assign({}, input, { at: new Date().toISOString() });
        const key = where + '.' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const saver = adapters.save || function (k, b) { return ns.data && ns.data.set ? ns.data.set(k, b) : Promise.reject(new Error(tb('verbs.notHere'))); };
        await saver(key, body);
        say(out, tb('verbs.saved'));
        clearInputs(elm);
        return;
      }
      if (!signedIn()) { say(out, tb('verbs.signIn'), true); return; }
      if (kind === 'ai') {
        const ask = attr(elm, 'prompt') || target || '';
        const vals = Object.keys(input).map(function (k) { return k + ': ' + input[k]; }).join('\n');
        say(out, tb('verbs.thinking'));
        const lang = (spec.lang || document.documentElement.lang || 'en').slice(0, 2);
        const prompt = ask + (vals ? '\n\n' + vals : '') + '\n\nAnswer in ' + (lang === 'fi' ? 'Finnish' : lang === 'es' ? 'Spanish' : 'English') + ', plainly, with no preamble. Just the answer.';
        const asker = adapters.ai || async function (p) {
          if (!ns.ai || !ns.ai.complete) throw new Error(tb('verbs.notHere'));
          const a = await ns.ai.complete({ prompt: p });
          return (a && (a.text || a.content || a.output)) || String(a || '');
        };
        show(out, await asker(prompt));
        return;
      }
      if (kind === 'offer' || kind === 'tool') {
        const adapter = adapters[kind];
        if (!adapter) { say(out, tb('verbs.notHere'), true); return; }
        say(out, kind === 'offer' ? tb('verbs.working') : tb('verbs.thinking'));
        const result = await adapter(target, input, function (text, bad) { say(out, text, bad); });
        if (result !== undefined) show(out, result);
        return;
      }
    } catch (err) {
      say(out, (err && err.message) || tb('verbs.failed'), true);
      if (spec.onError) spec.onError(err, elm);
    }
  }

  // Reads start themselves: a visitor should not have to press anything to see a true number.
  function scan() {
    if (destroyed) return;
    const found = root.querySelectorAll('[data-ak-do="read"], [data-og-do="read"]');
    Array.prototype.forEach.call(found, function (elm) {
      if (timers.has(elm)) return;
      run(elm).catch(function () {});
      const every = Math.max(READ_MIN_S, parseInt(attr(elm, 'every') || String(READ_DEFAULT_S), 10) || READ_DEFAULT_S);
      const id = window.setInterval(function () {
        if (destroyed || !elm.isConnected) { window.clearInterval(id); timers.delete(elm); return; }
        run(elm).catch(function () {});
      }, every * 1000);
      timers.set(elm, id);
    });
  }

  function onClick(ev) {
    const target = /** @type {Element} */ (ev.target);
    const elm = target && target.closest ? target.closest('[data-ak-do], [data-og-do]') : null;
    if (!elm || !root.contains(elm)) return;
    if (attr(elm, 'do') === 'read') return;
    ev.preventDefault();
    run(elm).catch(function () {});
  }
  root.addEventListener('click', onClick);
  scan();

  return {
    run: run,
    scan: scan,
    destroy: function () {
      destroyed = true;
      root.removeEventListener('click', onClick);
      timers.forEach(function (id) { window.clearInterval(id); });
      timers.clear();
    },
  };
}
