/**
 * @file src/static/app-sw-offline.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The service worker of a published app that OPENS WITH NO CONNECTION, served as
 *   /sw-offline.js on the app's own origin. It is the app origin's push worker (/sw.js, loaded here
 *   with importScripts, so an app keeps its notifications) plus one thing: a kept copy of what the
 *   app's page is made of, answered when the node gives no answer.
 *
 *   ONLY AN APP THAT ASKS GETS IT. /sw.js stays as it was, with no fetch handler, for every app
 *   that does not ask. An app asks twice: its page carries <meta name="aimeat-offline"
 *   content="shell">, and it loads the served library aimeat-offline, whose shell.enable()
 *   registers this file. When a later version of the page drops the meta, this worker deletes the
 *   kept copy on the next load that reaches the node and answers nothing from then on.
 *
 *   WHAT IS KEPT. The app's document at "/", and every script, stylesheet, font, image and manifest
 *   the page loads with a plain GET: the page's own parts. Nothing the page asks for with fetch()
 *   or XHR is kept or answered, and no request that carries an Authorization or Range header, so no
 *   record, no API answer and no file behind a session is ever in the copy. The copy holds the
 *   app's code and its public pictures, which anyone with the app's address can read from the node.
 *
 *   THE NODE'S ANSWER ALWAYS WINS. Every kept request goes to the network first, and the kept copy
 *   answers only when the network gives none (for the document, also when it gives none within four
 *   seconds). While the node can be reached, the bytes are the node's, as without this worker. An
 *   answer that says the app is gone or closed (401, 403, 404, 410) removes the kept document.
 *
 *   IT IS A CLASSIC WORKER, like /sw.js: no import, no export, no module syntax.
 * @structure
 *   - importScripts('/sw.js'): push and notificationclick, unchanged.
 *   - on / ready: whether a kept copy exists (the app asked), read once when the worker starts.
 *   - message: 'aimeat-shell-keep' { urls } warms the copy, 'aimeat-shell-drop' deletes it,
 *     'aimeat-shell-status' answers { on, entries } on the message's port.
 *   - fetch: partOf() decides whether a request is one of the page's parts; fromNetworkFirst()
 *     answers it and keeps the answer.
 * @usage Served at /sw-offline.js on a published app's own origin (server-bootstrap/static-files.ts).
 *   Registered by /v1/libs/aimeat-offline.js: AIMEAT.offline.shell.enable().
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (wish-teht-v-t-todoist-kind-task-app-on-aimeat-with-agents-app-too).
 */

/* eslint-disable no-undef */
importScripts('/sw.js');

const SHELL = 'aimeat-app-shell-v1';
/* The copy holds the parts of ONE page. Past this many entries the oldest leave. */
const SHELL_LIMIT = 150;
/* A picture larger than this is not kept: the copy is the app's frame, not its gallery. */
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/* How long the document waits for the node before the kept copy answers. */
const DOCUMENT_WAIT_MS = 4000;
const PART_KINDS = ['script', 'style', 'font', 'image', 'manifest'];
/* The app declares the wish in its head; a page without it is one that no longer asks. */
const WISH = /<meta\b[^>]*name\s*=\s*["']aimeat-offline["'][^>]*content\s*=\s*["'][^"']*\bshell\b/i;

/** true: a kept copy exists, false: none, undefined: not read yet. */
let on;
const ready = caches.has(SHELL).then((has) => { on = has; }, (err) => {
  console.warn('[app-sw-offline] the kept copy could not be looked for:', err && err.message);
  on = false;
});

function say(err) { return err && err.message ? err.message : String(err); }

/** Oldest entries leave when the copy has grown past its limit. Keys come back in insertion order. */
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - SHELL_LIMIT; i++) await cache.delete(keys[i]);
}

/** Delete the kept copy and answer nothing from now on. */
async function drop() {
  on = false;
  await caches.delete(SHELL);
}

/**
 * What a request is to the page: 'document' for the app's own page, 'part' for something the page
 * is made of, null for everything else (which this worker never touches).
 */
function partOf(request, url) {
  if (request.method !== 'GET') return null;
  if (request.headers.has('authorization') || request.headers.has('range')) return null;
  const own = url.origin === self.location.origin;
  if (request.mode === 'navigate') return own && url.pathname === '/' ? 'document' : null;
  if (PART_KINDS.indexOf(request.destination) < 0) return null;
  // Another origin's part is a web font and its stylesheet, or a library from a CDN the app's CSP allows.
  if (!own && request.destination === 'image') return null;
  return 'part';
}

/** Whether an answer is kept: a full answer, and for a picture one of a sane size. */
function keepable(request, response) {
  if (!response) return false;
  if (response.type === 'opaque') return true;   // another origin's font or stylesheet: the status is not readable
  if (response.status !== 200) return false;
  if (request.destination === 'image') {
    const size = Number(response.headers.get('content-length') || 0);
    if (size > IMAGE_MAX_BYTES) return false;
  }
  return true;
}

/** Keep one answer under its key; a failure to keep never fails the answer. */
function keep(key, request, response) {
  if (!keepable(request, response)) return;
  const copy = response.clone();
  caches.open(SHELL).then((cache) => cache.put(key, copy).then(() => trim(cache)))
    .catch((err) => console.warn('[app-sw-offline] an answer was not kept:', say(err)));
}

/** The document answered by the node: keep it while the page still asks, drop everything when it stopped. */
async function afterDocument(key, request, response) {
  if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
    const cache = await caches.open(SHELL);
    await cache.delete(key);
    return;
  }
  if (response.status !== 200) return;
  const text = await response.clone().text();
  if (!WISH.test(text)) { await drop(); return; }
  keep(key, request, response);
}

async function fromNetworkFirst(request, url, kind) {
  await ready;
  if (!on) return fetch(request);
  const isDocument = kind === 'document';
  // The document is kept under the bare path: an address with a query opens the same app.
  const key = isDocument ? new Request(url.origin + '/') : request;
  const cache = await caches.open(SHELL);
  const kept = await cache.match(key);
  const network = fetch(request).then((response) => {
    if (isDocument) afterDocument(key, request, response).catch((err) => console.warn('[app-sw-offline] the document was not kept:', say(err)));
    else keep(key, request, response);
    return response;
  });
  if (!kept) return network;
  // The one place the kept copy answers: the network gave nothing for this request.
  const fromCopy = network.catch((err) => {
    console.debug('[app-sw-offline] no answer from the network, the kept copy answers:', url.pathname, say(err));
    return kept;
  });
  if (!isDocument) return fromCopy;
  // A network that neither answers nor fails (a train, a lift) would hold the page for minutes.
  return Promise.race([
    fromCopy,
    new Promise((resolve) => { setTimeout(() => resolve(kept), DOCUMENT_WAIT_MS); }),
  ]);
}

self.addEventListener('fetch', (event) => {
  if (on === false) return;   // the app did not ask, or stopped asking: the network answers, untouched
  let url;
  try {
    url = new URL(event.request.url);
  } catch (err) {
    console.debug('[app-sw-offline] a request whose address does not parse is left to the network:', say(err));
    return;
  }
  const kind = partOf(event.request, url);
  if (!kind) return;
  event.respondWith(fromNetworkFirst(event.request, url, kind));
});

/** Fetch and keep the addresses the page names: the first load ran before this worker controlled it. */
async function warm(urls) {
  const cache = await caches.open(SHELL);
  on = true;
  let keptNow = 0;
  for (const raw of urls.slice(0, SHELL_LIMIT)) {
    let url;
    try {
      url = new URL(String(raw), self.location.origin);
    } catch (err) {
      console.debug('[app-sw-offline] not an address, not kept:', String(raw), say(err));
      continue;
    }
    const own = url.origin === self.location.origin;
    const request = new Request(url.href, own ? { cache: 'no-cache', credentials: 'same-origin' } : { mode: 'no-cors', credentials: 'omit' });
    try {
      const response = await fetch(request);
      if (response.type !== 'opaque' && response.status !== 200) continue;
      await cache.put(own && url.pathname === '/' ? new Request(url.origin + '/') : request, response);
      keptNow += 1;
    } catch (err) {
      console.warn('[app-sw-offline] a part was not kept:', url.href, say(err));
    }
  }
  await trim(cache);
  return keptNow;
}

self.addEventListener('message', (event) => {
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  const port = event.ports && event.ports[0];
  const answer = (value) => { if (port) port.postMessage(value); };
  // Only a page of this origin sets what this origin keeps.
  if (event.origin && event.origin !== self.location.origin) return;
  if (data.type === 'aimeat-shell-keep' && Array.isArray(data.urls)) {
    event.waitUntil(warm(data.urls).then((n) => answer({ ok: true, kept: n }), (err) => answer({ ok: false, reason: say(err) })));
  } else if (data.type === 'aimeat-shell-drop') {
    event.waitUntil(drop().then(() => answer({ ok: true }), (err) => answer({ ok: false, reason: say(err) })));
  } else if (data.type === 'aimeat-shell-status') {
    // Opening a cache creates it, and a cache that exists is what "the app asked" means: look only when it does.
    event.waitUntil(ready.then(() => (on ? caches.open(SHELL).then((cache) => cache.keys()) : []))
      .then((keys) => answer({ ok: true, on: !!on, entries: keys.length }), (err) => answer({ ok: false, reason: say(err) })));
  }
});
