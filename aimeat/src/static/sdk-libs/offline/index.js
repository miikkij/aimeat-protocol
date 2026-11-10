/**
 * @file offline/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The aimeat-offline library. Exposes AIMEAT.offline: what an app needs to keep
 *   working, and to open, with no connection. Served as /v1/libs/aimeat-offline.js.
 *
 *   FOUR PARTS, EACH USABLE ALONE.
 *   - shell: the app's own page opens with no connection. shell.enable() registers the app origin's
 *     wider service worker (/sw-offline.js: the push worker plus a kept copy of the page's parts)
 *     and has it keep the parts this page loaded. The page must declare <meta name="aimeat-offline"
 *     content="shell">. The node's answer always wins: the kept copy answers only when the node
 *     gives none. No record and no answer to a fetch() is ever in it.
 *   - identity(): who to open a kept copy for when the node gives no answer and nobody can sign in:
 *     the person who signed in on this browser last (AIMEAT.auth.offlineIdentity()).
 *   - copy(name, account): a place on the device for the app's own copy of a person's data, one
 *     value per key, each with the time it was kept.
 *   - queue(spec): the changes that wait for the node, in order, kept across reloads, sent by the
 *     app's own send function when the node can be reached (queue.js).
 *
 *   EVERYTHING HERE IS KEPT PER ACCOUNT, AND THE APP ENDS IT. A copy and a queue are named by the
 *   account they belong to, so two people on one browser never read each other's. The library
 *   deletes nothing by itself: on sign-out the app calls forget(account), unless changes still wait
 *   and it wants them sent at the next sign-in. A copy says how old it is (copy.kept(key)), which is
 *   how an app shows that what is on the screen is from before the connection was lost.
 *
 *   WHAT IT DOES NOT DO. It does not sync: the app reads from the node, keeps what it read, and
 *   sends its own changes. It holds no credentials. It never answers a request for data from the
 *   kept copy of the page.
 * @structure shell { supported, declared, enable, disable, status } · identity · reachable · copy ·
 *   queue · forget
 * @usage
 *   <meta name="aimeat-offline" content="shell">
 *   <script src="/v1/libs/aimeat-auth.js"></script>
 *   <script src="/v1/libs/aimeat-offline.js"></script>
 *   AIMEAT.offline.shell.enable();                                  // at each start; the first one keeps the page
 *   const mine = AIMEAT.offline.copy('tasks', session.owner);
 *   await mine.set('lists', lists);  const kept = await mine.get('lists');
 *   const q = AIMEAT.offline.queue({ name: 'tasks', account: session.owner, send: publishBatch, group: (c) => c.record });
 *   q.push({ record: 'p1', change });  q.on(() => paint(q.state()));
 *   AIMEAT.auth.on('offline', (who) => openCopyOf(who.owner));      // the node gives no answer
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (wish-teht-v-t-todoist-kind-task-app-on-aimeat-with-agents-app-too).
 */
import { attach, namespace } from '../_core/namespace.js';
import { openStore } from './store.js';
import { createQueue } from './queue.js';

/** The wider worker of an app that opens with no connection (src/static/app-sw-offline.js). */
const SW_PATH = '/sw-offline.js';
const SW_SCOPE = '/';
/** How long the worker gets to answer one message. Keeping a page's parts is a few dozen requests. */
const WORKER_ANSWER_MS = 30000;

/** @type {ReturnType<typeof openStore>|null} */
let opened = null;
function store() { if (!opened) opened = openStore(); return opened; }

/**
 * One refused answer.
 * @param {string} code    A stable string to branch on.
 * @param {string} reason  A sentence to show a person.
 * @returns {{ok: false, code: string, reason: string}}
 */
function refuse(code, reason) { return { ok: false, code: code, reason: reason }; }
function say(err) { return err && err.message ? err.message : String(err); }

function declared() {
  const meta = document.querySelector('meta[name="aimeat-offline"]');
  return !!meta && /\bshell\b/.test(meta.getAttribute('content') || '');
}
function supported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined';
}

/** The addresses this page is made of: its own, and every script, stylesheet, font and picture it loaded. */
function partsOfPage() {
  /** @type {Record<string, boolean>} */
  const seen = {};
  const add = function (raw) {
    if (!raw) return;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') seen[url.href.split('#')[0]] = true;
    } catch (err) {
      console.debug('[aimeat-offline] not an address:', raw, say(err));
    }
  };
  add(location.origin + '/');
  document.querySelectorAll('script[src]').forEach(function (n) { add(n.getAttribute('src')); });
  document.querySelectorAll('link[href]').forEach(function (n) {
    if (/\b(stylesheet|icon|manifest|apple-touch-icon|preload)\b/i.test(n.getAttribute('rel') || '')) add(n.getAttribute('href'));
  });
  document.querySelectorAll('img[src]').forEach(function (n) {
    const src = n.getAttribute('src') || '';
    if (src.indexOf('data:') !== 0) add(src);
  });
  // A font named inside a stylesheet is in no element; the browser's own list of what it fetched has it.
  if (typeof performance !== 'undefined' && performance.getEntriesByType) {
    performance.getEntriesByType('resource').forEach(function (e) {
      const entry = /** @type {PerformanceResourceTiming} */ (e);
      if (['script', 'link', 'css', 'img'].indexOf(entry.initiatorType) >= 0) add(entry.name);
    });
  }
  // Another origin's picture is never kept (the worker refuses it too).
  return Object.keys(seen).filter(function (href) {
    return href.indexOf(location.origin + '/') === 0 || !/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(href);
  });
}

/**
 * One message to the worker, answered on a port.
 * @param {ServiceWorker} worker
 * @param {any} message
 * @returns {Promise<any>}
 */
function ask(worker, message) {
  return new Promise(function (resolve) {
    const channel = new MessageChannel();
    const timer = setTimeout(function () { resolve(refuse('WORKER_SILENT', 'The app\'s worker did not answer.')); }, WORKER_ANSWER_MS);
    channel.port1.onmessage = function (ev) { clearTimeout(timer); resolve(ev.data); };
    worker.postMessage(message, [channel.port2]);
  });
}

/** This origin's registration when it runs the wider worker, else null. */
async function registration() {
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const worker = reg && (reg.active || reg.waiting || reg.installing);
  return reg && worker && new URL(worker.scriptURL).pathname === SW_PATH ? reg : null;
}

const shell = {
  /** Whether this browser can keep a page at all. */
  supported: supported,
  /** Whether the page carries the meta that asks for it. */
  declared: declared,

  /**
   * Keep this app's page so that it opens with no connection. Safe at every start: once the page
   * is kept, a call costs one message to the worker. Never throws.
   * @returns {Promise<{ok: true, enabled: true, entries: number, first: boolean} | {ok: false, code: string, reason: string}>}
   */
  enable: async function () {
    if (!supported()) return refuse('NO_WORKER_SUPPORT', 'This browser cannot keep an app for use with no connection.');
    if (!declared()) return refuse('NOT_DECLARED', 'This app does not ask to be kept: its page needs <meta name="aimeat-offline" content="shell"> in the head.');
    /** @type {ServiceWorkerRegistration} */
    let reg;
    try {
      reg = (await registration()) || (await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE }));
      await navigator.serviceWorker.ready;
    } catch (err) {
      return refuse('WORKER_FAILED', 'This app could not start its worker. An app is kept only at its own address on a node that serves /sw-offline.js there: ' + say(err));
    }
    const worker = reg.active || (await navigator.serviceWorker.ready).active;
    if (!worker) return refuse('WORKER_FAILED', 'The app\'s worker did not start.');
    const now = await ask(worker, { type: 'aimeat-shell-status' });
    if (now && now.ok && now.on && now.entries > 0) return { ok: true, enabled: true, entries: now.entries, first: false };
    const kept = await ask(worker, { type: 'aimeat-shell-keep', urls: partsOfPage() });
    if (!kept || !kept.ok) return refuse((kept && kept.code) || 'KEEP_FAILED', 'The app\'s page could not be kept: ' + ((kept && kept.reason) || 'no answer'));
    return { ok: true, enabled: true, entries: kept.kept, first: true };
  },

  /**
   * Stop keeping the page: the kept copy is deleted. The worker stays, because it also carries the
   * app's notifications; without a kept copy it answers nothing.
   * @returns {Promise<{ok: boolean, code?: string, reason?: string}>}
   */
  disable: async function () {
    if (!supported()) return { ok: true };
    try {
      const reg = await registration();
      if (!reg || !reg.active) return { ok: true };
      const done = await ask(reg.active, { type: 'aimeat-shell-drop' });
      return done && done.ok ? { ok: true } : refuse('DROP_FAILED', 'The kept page could not be deleted: ' + ((done && done.reason) || 'no answer'));
    } catch (err) {
      return refuse('DROP_FAILED', 'The kept page could not be deleted: ' + say(err));
    }
  },

  /**
   * Whether this app's page is kept, read from the worker: no registration is made.
   * @returns {Promise<{ok: true, enabled: boolean, entries: number}>}
   */
  status: async function () {
    if (!supported()) return { ok: true, enabled: false, entries: 0 };
    try {
      const reg = await registration();
      if (!reg || !reg.active) return { ok: true, enabled: false, entries: 0 };
      const now = await ask(reg.active, { type: 'aimeat-shell-status' });
      return { ok: true, enabled: !!(now && now.ok && now.on), entries: (now && now.entries) || 0 };
    } catch (err) {
      console.warn('[aimeat-offline] the worker could not be asked:', say(err));
      return { ok: true, enabled: false, entries: 0 };
    }
  },
};

/** Keys are plain text; an account or a name never carries the separator. */
function prefixOf(name, account) {
  const clean = function (s) { return String(s == null ? '' : s).replace(/[\n\r]/g, ' '); };
  if (!clean(name) || !clean(account)) throw new Error('A copy and a queue need a name and the account they belong to');
  return clean(account) + '\n' + clean(name) + '\n';
}

/**
 * The app's own copy of one person's data on this device.
 * @param {string} name     What the copy is of, e.g. 'tasks'. One app may keep several.
 * @param {string} account  The account it belongs to (session.owner).
 */
function copy(name, account) {
  const prefix = prefixOf(name, account);
  return {
    /** True when the browser keeps the copy across reloads; false in a private window. */
    persistent: function () { return store().persistent(); },
    /** The kept value, or null. */
    get: function (key) { return store().get('copy', prefix + key).then(function (row) { return row ? row.value : null; }); },
    /** When the value was kept (ISO), or null: how an app says how old what it shows is. */
    kept: function (key) { return store().get('copy', prefix + key).then(function (row) { return row ? row.at : null; }); },
    /** Keep a value: plain data the browser can store. Resolves true when it is kept. */
    set: function (key, value) { return store().put('copy', prefix + key, value); },
    remove: function (key) { return store().remove('copy', prefix + key); },
    /** The keys this copy holds. */
    keys: function () { return store().keys('copy', prefix).then(function (all) { return all.map(function (k) { return k.slice(prefix.length); }); }); },
    /** Delete the whole copy. */
    clear: function () {
      return store().keys('copy', prefix).then(function (all) { return Promise.all(all.map(function (k) { return store().remove('copy', k); })); }).then(function () { return true; });
    },
  };
}

/**
 * The changes of one account that wait for the node. See queue.js for what send must answer.
 * @param {{ name: string, account: string, send: (batch: any[]) => (boolean | Promise<boolean>),
 *   group?: (entry: any) => string, retryMs?: number }} spec
 */
function queue(spec) {
  const key = prefixOf(spec.name, spec.account) + 'queue';
  const q = createQueue({
    load: function () { return store().get('queue', key).then(function (row) { return row ? row.value : null; }); },
    save: function (state) { return store().put('queue', key, state); },
    send: spec.send, group: spec.group, retryMs: spec.retryMs,
    online: function () { return navigator.onLine !== false; },
  });
  const up = function () { q.networkChanged(true); };
  const down = function () { q.networkChanged(false); };
  window.addEventListener('online', up);
  window.addEventListener('offline', down);
  const destroy = q.destroy;
  q.destroy = function () {
    window.removeEventListener('online', up);
    window.removeEventListener('offline', down);
    destroy();
  };
  return q;
}

/**
 * Delete everything this library keeps for one account on this device: every copy and every queue,
 * whatever their names. For a sign-out. The kept page (shell) is the app's code and stays.
 * @param {string} account
 * @returns {Promise<boolean>}
 */
function forget(account) {
  const prefix = String(account == null ? '' : account).replace(/[\n\r]/g, ' ') + '\n';
  if (prefix === '\n') return Promise.resolve(false);
  return Promise.all(['copy', 'queue'].map(function (name) {
    return store().keys(name, prefix).then(function (all) { return Promise.all(all.map(function (k) { return store().remove(name, k); })); });
  })).then(function () { return true; });
}

/**
 * Who to open a kept copy for while the node gives no answer: { owner, ghii, displayName, at }, or
 * null. From the sign-in library when the page loaded it; it names a person and authorises nothing.
 */
function identity() {
  const auth = namespace().auth;
  return auth && typeof auth.offlineIdentity === 'function' ? auth.offlineIdentity() : null;
}

const offline = {
  shell: shell,
  identity: identity,
  /** Whether the device reports a network. False is certain; true only says the device has one. */
  reachable: function () { return typeof navigator === 'undefined' || navigator.onLine !== false; },
  copy: copy,
  queue: queue,
  forget: forget,
};

attach('offline', offline);
