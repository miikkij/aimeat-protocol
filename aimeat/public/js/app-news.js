/**
 * @file app-news.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The script of the app-info mark on a served app (src/utils/app-info-badge.ts loads it
 *   from the mark's own block). Three jobs, none of which the static mark can do:
 *
 *   1. THE PAGE FOLLOWS ITS APP. It opens the node's live stream for this one app (POST
 *      /v1/events/ticket with `{ app }` when the page has a signed-in session, else POST
 *      /v1/events/visitor-ticket) and reloads the page when a new version is published, so nobody
 *      has to press F5 (Jouni, 2026-10-18). An event, never a poll: one stream per app per browser,
 *      shared by the app's open tabs (Web Locks elect the tab that holds it, a BroadcastChannel
 *      relays to the rest), and a hidden tab reloads when it is shown again. After the reload the
 *      panel says which version the page now runs, for a few seconds.
 *   2. A BUILDER SEES THE DRAFT. When the page has a signed-in session and the session builds the app
 *      (the owner, the owner's agents, a development right), it reads GET /v1/apps/:o/:f/news and
 *      shows the draft under way and what it is changing, with a dot on the button. A `draft` event
 *      on the stream reads it again. A visitor never sees it: the server answers the draft only to a
 *      builder, and the visitor's stream never carries it.
 *   3. THE ROW CAN BE TUCKED AWAY. The owner sets the starting state (manifest.marks.tucked); a
 *      visitor's own choice, made from the panel, wins and is kept per app in this browser. Tucked,
 *      the optional marks come back while the pointer is near the corner, while the keyboard is on a
 *      mark or a panel is open. The CSS is the mark's; this only sets two classes on <html>.
 *
 *   Classic script on purpose, as public/js/install-chip.js: it runs inside somebody else's
 *   single-file app. Every storage access is guarded, because an app in the node's isolated frame
 *   has an opaque origin where storage and Web Locks refuse.
 * @structure data read → tucked state + peek → reload notice → builder draft → live stream (election,
 *   ticket, EventSource, reconnect)
 * @usage <script src="/js/app-news.js" defer></script> (inside the app-info mark's block)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish-p-ivitysmerkki-ja-tietomerkki-sovelluksen-p-lle-merkkien-pii).
 */
(function () {
  'use strict';
  var root = document.getElementById('aimeat-app-info');
  var dataEl = document.getElementById('aimeat-app-info-data');
  if (!root || !dataEl) return;
  /**
   * Storage, Web Locks and the app's own sign-in library refuse in an opaque origin (the node's
   * isolated frame) and in a private window, and the page works without them: a refusal there is an
   * expected absence with a stated fallback, never a failure to report.
   */
  function attempt(fn, fallback) {
    try { return fn(); } catch (err) {
      // Logged at debug level: a private window refuses storage on every page, and that is not news.
      console.debug('[app-news] refused, using the fallback:', err);
      return fallback;
    }
  }
  var data = attempt(function () { return JSON.parse(dataEl.textContent || '{}'); }, null);
  if (!data || typeof data.app !== 'string') return;

  var html = document.documentElement;
  var W = data.words || {};
  var slash = data.app.indexOf('/');
  var owner = data.app.slice(0, slash);
  var file = data.app.slice(slash + 1);
  var TUCK_KEY = 'aimeat-marks-tucked:' + data.app;
  var RELOAD_KEY = 'aimeat-app-reloaded:' + data.app;

  function fill(text, vars) {
    return String(text || '').replace(/\{\{(\w+)\}\}/g, function (m, k) { return vars[k] !== undefined ? String(vars[k]) : m; });
  }
  function dateText(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return attempt(function () {
      // eslint-disable-next-line aimeat/no-raw-locale-format -- runs inside somebody else's app, where neither /js/format.js nor the app's formatter is loaded; the page's language is the reader's
      return new Intl.DateTimeFormat(html.lang || navigator.language || 'en', { dateStyle: 'medium' }).format(d);
    }, iso.slice(0, 10));
  }
  function store(kind) {
    return attempt(function () { return kind === 'session' ? window.sessionStorage : window.localStorage; }, null);
  }
  function read(kind, key) {
    var s = store(kind);
    return s ? attempt(function () { return s.getItem(key); }, null) : null;
  }
  function write(kind, key, value) {
    var s = store(kind);
    if (s) attempt(function () { if (value === null) s.removeItem(key); else s.setItem(key, value); }, undefined);
  }

  /** A mark's open/closed checkbox by id. @returns {HTMLInputElement|null} */
  function checkbox(id) {
    return /** @type {HTMLInputElement|null} */ (document.getElementById(id));
  }

  // ── Tucked row ──────────────────────────────────────────────────────────────────────────────────
  var tuckBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('[data-tuck]'));
  function tucked() {
    var mine = read('local', TUCK_KEY);
    return mine === '1' ? true : mine === '0' ? false : !!data.tucked;
  }
  function applyTuck() {
    var on = tucked();
    html.classList.toggle('aimeat-marks-tucked', on);
    if (tuckBtn) {
      tuckBtn.textContent = on ? (W.untuck || '') : (W.tuck || '');
      tuckBtn.hidden = false;
    }
  }
  if (tuckBtn) {
    tuckBtn.addEventListener('click', function () {
      write('local', TUCK_KEY, tucked() ? '0' : '1');
      applyTuck();
      // The choice is made: close the panel and let go of the focus, or the row would stay in view
      // until the next click somewhere else.
      var open = checkbox('aimeat-app-info-open');
      if (open) open.checked = false;
      tuckBtn.blur();
      peek(false, 10);
    });
  }
  applyTuck();

  var peekTimer = null;
  var flashUntil = 0;
  function peek(on, holdMs) {
    clearTimeout(peekTimer);
    if (on) { html.classList.add('aimeat-marks-peek'); return; }
    peekTimer = setTimeout(function () {
      if (Date.now() < flashUntil || panelOpen() || markFocused()) return;
      html.classList.remove('aimeat-marks-peek');
    }, holdMs || 700);
  }
  function panelOpen() {
    return ['aimeat-ai-label-open', 'aimeat-app-badge-open', 'aimeat-ai-use-open', 'aimeat-app-info-open']
      .some(function (id) { var c = checkbox(id); return !!(c && c.checked); });
  }
  function markFocused() {
    var a = document.activeElement;
    return !!(a && a.closest && a.closest('#aimeat-app-badge,#aimeat-ai-use,#aimeat-app-info,#aimeat-install-chip'));
  }
  /** The corner the row sits in: as wide as the row's right edge plus some room, 96px high. */
  function inCorner(x, y) {
    var right = 0;
    var marks = document.querySelectorAll('#aimeat-app-badge>label,#aimeat-ai-use>label,#aimeat-app-info>label,#aimeat-install-chip,#aimeat-cookie-mark button,#aimeat-ai-label');
    for (var i = 0; i < marks.length; i++) {
      var r = marks[i].getBoundingClientRect();
      if (r.width) right = Math.max(right, r.right);
    }
    return x <= Math.max(right, 200) + 48 && y >= window.innerHeight - 96;
  }
  document.addEventListener('pointermove', function (e) {
    if (!html.classList.contains('aimeat-marks-tucked') || e.pointerType === 'touch') return;
    if (inCorner(e.clientX, e.clientY)) peek(true); else if (html.classList.contains('aimeat-marks-peek')) peek(false);
  }, { passive: true });
  document.addEventListener('focusin', function () { if (markFocused()) peek(true); });
  document.addEventListener('focusout', function () { peek(false); });
  // One panel on the row at a time, as the "Use with your AI" mark does it: opening this one closes the
  // others, opening another closes this one, and a tap outside the mark closes it.
  var PANELS = ['aimeat-ai-label-open', 'aimeat-app-badge-open', 'aimeat-ai-use-open', 'aimeat-app-info-open'];
  document.addEventListener('change', function (e) {
    var t = /** @type {HTMLInputElement|null} */ (e.target);
    if (!t || PANELS.indexOf(t.id || '') < 0) return;
    if (t.checked) {
      var mine = t.id === 'aimeat-app-info-open';
      PANELS.forEach(function (id) {
        if (id === t.id || (!mine && id !== 'aimeat-app-info-open')) return;
        var other = checkbox(id);
        if (other) other.checked = false;
      });
    }
    peek(!!t.checked || panelOpen());
  }, true);
  document.addEventListener('pointerdown', function (e) {
    var open = checkbox('aimeat-app-info-open');
    if (open && open.checked && !root.contains(/** @type {Node} */ (e.target))) { open.checked = false; peek(false); }
  }, true);
  /** Bring the row into view for a while: the news a tucked row would otherwise hide. */
  function flash(ms) {
    flashUntil = Date.now() + ms;
    peek(true);
    setTimeout(function () { peek(false, 10); }, ms);
  }

  // ── After a reload onto a new version ──────────────────────────────────────────────────────────
  var panel = root.querySelector(':scope > span');
  var box = checkbox('aimeat-app-info-open');
  var reloadedFrom = Number(read('session', RELOAD_KEY));
  if (reloadedFrom) {
    write('session', RELOAD_KEY, null);
    if (data.v !== reloadedFrom && panel && box) {
      var line = document.createElement('small');
      line.textContent = fill(W.reloaded, { v: data.v });
      panel.insertBefore(line, panel.children[1] || null);
      box.checked = true;
      flash(6000);
      setTimeout(function () { box.checked = false; if (line.parentNode) line.parentNode.removeChild(line); }, 6000);
    }
  }

  // ── A builder's draft ──────────────────────────────────────────────────────────────────────────
  var draftEl = /** @type {HTMLElement|null} */ (root.querySelector('[data-draft]'));
  var draftShown = false;
  /** The app's own aimeat-auth library, when the app loads it. */
  function appAuth() {
    // eslint-disable-next-line aimeat/no-direct-auth -- runs inside a published app, where /js/services/auth.js is not loaded; the app's own aimeat-auth session is the only one there
    return window.AIMEAT && window.AIMEAT.auth;
  }
  function session() {
    var auth = appAuth();
    return auth && auth.getSession ? attempt(function () { return auth.getSession(); }, null) : null;
  }
  function renderDraft(news) {
    if (!draftEl) return;
    var d = news && news.builder ? news.draft : null;
    if (!d) {
      draftEl.hidden = true;
      draftEl.textContent = '';
      root.classList.remove('aimeat-has-draft');
      return;
    }
    draftEl.textContent = '';
    var head = document.createElement('b');
    head.textContent = W.draft || '';
    draftEl.appendChild(head);
    if (d.notice && d.notice.text) {
      var what = document.createElement('span');
      what.textContent = d.notice.text;
      draftEl.appendChild(what);
      var by = document.createElement('small');
      by.textContent = fill(W.draftBy, { who: d.notice.by, date: dateText(d.notice.at) });
      draftEl.appendChild(by);
    }
    var saved = document.createElement('small');
    saved.textContent = d.stale ? (W.draftStale || '') : fill(W.draftSaved, { date: dateText(d.savedAt) });
    draftEl.appendChild(saved);
    if (data.more) {
      var open = document.createElement('a');
      open.href = data.more;
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = W.draftOpen || '';
      draftEl.appendChild(open);
    }
    draftEl.hidden = false;
    root.classList.toggle('aimeat-has-draft', !d.stale);
    // A draft under way shows itself once, even on a tucked row: that is the news the row is for.
    if (!d.stale && !draftShown && html.classList.contains('aimeat-marks-tucked')) flash(4000);
    draftShown = true;
  }
  var newsBusy = false;
  function readDraft() {
    var s = session();
    if (!s || !s.fetch || newsBusy) return;
    newsBusy = true;
    Promise.resolve(s.fetch('/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(file) + '/news'))
      .then(function (res) { if (res && res.ok !== false && res.data) renderDraft(res.data); })
      .catch(function (err) { console.warn('[app-news] the app news was not read', err); })
      .then(function () { newsBusy = false; });
  }

  // ── The live stream for this app ───────────────────────────────────────────────────────────────
  var current = data.v;
  var pendingReload = false;
  var es = null;
  var signedStream = false;
  var reconnectTimer = null;
  var delay = 2000;
  var leader = false;
  var bc = null;
  var CHANNEL = 'aimeat-app-news:' + data.app;

  function reloadNow() {
    write('session', RELOAD_KEY, String(current));
    location.reload();
  }
  function onApp(msg) {
    if (!msg) return;
    if (msg.kind === 'version') {
      if (typeof msg.version !== 'number' || msg.version === current) return;
      if (document.hidden) { pendingReload = true; return; }
      reloadNow();
    } else if (msg.kind === 'draft') {
      readDraft();
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && pendingReload) reloadNow();
    // Back in view with the stream down, its reconnect waiting or given up: try now, from the start.
    if (!document.hidden && leader && !es && (reconnectTimer || failures >= 5)) {
      clearTimeout(reconnectTimer); reconnectTimer = null; delay = 2000; failures = 0; open();
    }
  });

  /**
   * `{ ticket }`, or `{ stop: true }` when this caller may not follow the app (404), else `{}`.
   * @returns {Promise<{ ticket?: string, stop?: boolean }>}
   */
  function ticket() {
    var s = session();
    var body = JSON.stringify({ app: data.app });
    if (s && s.fetch) {
      signedStream = true;
      return Promise.resolve(s.fetch('/v1/events/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body }))
        .then(function (res) {
          if (res && res.ok !== false && res.data) return { ticket: res.data.ticket };
          return res && res.error && res.error.code === 'NOT_FOUND' ? { stop: true } : {};
        });
    }
    signedStream = false;
    return fetch('/v1/events/visitor-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, credentials: 'omit' })
      .then(function (r) {
        if (r.status === 404) return { stop: true };
        return r.ok ? r.json().then(function (res) { return res && res.data ? { ticket: res.data.ticket } : {}; }) : {};
      });
  }
  // A reconnect backs off from 2 s to a minute. Five failures in a row with no stream between them
  // end the attempts until the tab is shown again: a page that cannot reach the stream must not
  // knock on it every minute for as long as it stays open.
  var failures = 0;
  function retry() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    failures++;
    if (failures >= 5) return;
    reconnectTimer = setTimeout(function () { reconnectTimer = null; open(); }, delay);
    delay = Math.min(delay * 2, 60000);
  }
  function open() {
    if (es) return;
    ticket().then(function (t) {
      // Not followable for this caller (a gated app): nothing to retry.
      if (t.stop) return;
      // No ticket: the node is at its stream cap or unreachable. The page keeps working.
      if (!t.ticket) { retry(); return; }
      es = new EventSource('/v1/events?ticket=' + encodeURIComponent(t.ticket));
      es.onopen = function () { delay = 2000; failures = 0; };
      es.addEventListener('app', function (ev) {
        var msg = attempt(function () { return JSON.parse(ev.data); }, null);
        if (!msg) return;
        if (bc) attempt(function () { bc.postMessage(msg); }, undefined);
        onApp(msg);
      });
      es.onerror = function () {
        if (es) { es.close(); es = null; }
        retry();
      };
    }).catch(function (err) { console.warn('[app-news] stream ticket failed', err); retry(); });
  }
  /** A session that arrives after the visitor stream opened: reopen signed, so a builder hears the draft. */
  function upgrade() {
    readDraft();
    if (leader && es && !signedStream) { es.close(); es = null; open(); }
  }
  function becomeLeader() {
    if (leader) return;
    leader = true;
    open();
  }
  function start() {
    readDraft();
    // An app in the node's isolated frame has an opaque origin: the stream is another origin to it,
    // which it may not read. The mark still shows the version there; the page does not reload itself.
    if (location.origin === 'null') return;
    var canShare = typeof BroadcastChannel !== 'undefined' && navigator.locks && navigator.locks.request;
    if (!canShare) { becomeLeader(); return; }
    bc = attempt(function () { return new BroadcastChannel(CHANNEL); }, null);
    if (bc) bc.onmessage = function (ev) { onApp(ev.data); };
    // Whoever holds the lock holds the stream; when that tab closes the browser frees the lock and a
    // waiting tab takes over. A page the browser gives no locks (an opaque origin) leads for itself.
    navigator.locks.request(CHANNEL, function () {
      becomeLeader();
      return new Promise(function () { /* held until the tab goes */ });
    }).catch(function (err) { console.warn('[app-news] no lock for the stream; this tab holds its own', err); becomeLeader(); });
  }

  // The app's own scripts may still be setting up its sign-in, so the stream starts once the page has
  // loaded, and a sign-in afterwards reopens it signed.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  var auth = appAuth();
  if (auth && typeof auth.on === 'function') attempt(function () { auth.on('login', upgrade); }, undefined);
})();
