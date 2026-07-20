// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/live/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-live.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/session.js
  function getSession(libLabel) {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before " + (libLabel || "this library"));
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts, libLabel) {
    return getSession(libLabel).fetch(path, opts);
  }
  function makeSession(libLabel) {
    return {
      getSession: () => getSession(libLabel),
      authFetch: (path, opts) => authFetch(path, opts, libLabel)
    };
  }

  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/live/index.js
  var { getSession: getSession2 } = makeSession("aimeat-live.js");
  var es = null;
  var subscribers = [];
  var debounceTimer = null;
  var refCount = 0;
  var reconnectTimer = null;
  var reconnectDelay = 5e3;
  var everOpened = false;
  var MAX_RECONNECT_DELAY = 12e4;
  var DEBOUNCE_MS = 1e3;
  var pendingDomains = /* @__PURE__ */ new Set();
  var hadHiddenUpdate = false;
  var started = false;
  var isLeader = false;
  var bc = null;
  var leaderRelease = null;
  var leaderAbort = null;
  function connect() {
    refCount++;
    if (started) return;
    started = true;
    startShared();
  }
  function startShared() {
    var canShare = typeof BroadcastChannel !== "undefined" && typeof navigator !== "undefined" && navigator.locks;
    if (!canShare) {
      becomeLeader();
      return;
    }
    bc = new BroadcastChannel("aimeat-live");
    bc.onmessage = function(ev) {
      if (ev.data && ev.data.type === "domains") ingestDomains(ev.data.domains);
    };
    leaderAbort = new AbortController();
    navigator.locks.request("aimeat-live-leader", { mode: "exclusive", signal: leaderAbort.signal }, function() {
      return new Promise(function(release) {
        leaderRelease = release;
        becomeLeader();
      });
    }).catch(function() {
    });
  }
  function becomeLeader() {
    if (isLeader) return;
    isLeader = true;
    _open();
  }
  function relay(domains) {
    if (bc) {
      try {
        bc.postMessage({ type: "domains", domains });
      } catch {
      }
    }
  }
  async function _open() {
    var session;
    try {
      session = getSession2();
    } catch {
      scheduleReconnect();
      return;
    }
    try {
      var r = await session.fetch("/v1/events/ticket", { method: "POST" });
      if (!r || !r.ok || !r.data || !r.data.ticket) {
        scheduleReconnect();
        return;
      }
      es = new EventSource("/v1/events?ticket=" + encodeURIComponent(r.data.ticket));
      es.onopen = function() {
        reconnectDelay = 5e3;
        if (everOpened) {
          ingestDomains(null);
          relay(null);
        }
        everOpened = true;
      };
      es.onmessage = function(event) {
        reconnectDelay = 5e3;
        var domains = null;
        try {
          var p = JSON.parse(event.data);
          if (Array.isArray(p.domains)) domains = p.domains;
        } catch {
        }
        ingestDomains(domains);
        relay(domains);
      };
      es.onerror = function() {
        if (es) {
          es.close();
          es = null;
        }
        scheduleReconnect();
      };
    } catch {
      scheduleReconnect();
    }
  }
  function ingestDomains(domains) {
    if (domains === null) pendingDomains = null;
    else if (pendingDomains !== null) domains.forEach(function(d) {
      pendingDomains.add(d);
    });
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushDomains, DEBOUNCE_MS);
  }
  function flushDomains() {
    if (typeof document !== "undefined" && document.hidden) {
      hadHiddenUpdate = true;
      return;
    }
    var dset = pendingDomains;
    pendingDomains = /* @__PURE__ */ new Set();
    dispatch(dset);
  }
  function dispatch(dset) {
    try {
      window.dispatchEvent(new CustomEvent("aimeat-live-update", { detail: { domains: dset } }));
    } catch {
    }
    var list = subscribers.slice();
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (dset === null || s.domains === null) {
        try {
          s.fn(dset);
        } catch {
        }
        continue;
      }
      var it = dset.values ? dset.values() : dset[Symbol.iterator]();
      var hit = false, n;
      while (!(n = it.next()).done) {
        if (s.domains.has(n.value)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        try {
          s.fn(dset);
        } catch {
        }
      }
    }
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (refCount > 0 && isLeader) {
      reconnectTimer = setTimeout(function() {
        if (refCount > 0) _open();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function() {
      if (!document.hidden && hadHiddenUpdate) {
        hadHiddenUpdate = false;
        pendingDomains = null;
        flushDomains();
      }
    });
  }
  function disconnect() {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      started = false;
      if (es) {
        es.close();
        es = null;
      }
      if (leaderAbort) {
        try {
          leaderAbort.abort();
        } catch {
        }
        leaderAbort = null;
      }
      if (leaderRelease) {
        try {
          leaderRelease();
        } catch {
        }
        leaderRelease = null;
      }
      isLeader = false;
      if (bc) {
        try {
          bc.close();
        } catch {
        }
        bc = null;
      }
      clearTimeout(debounceTimer);
      clearTimeout(reconnectTimer);
      reconnectDelay = 5e3;
      everOpened = false;
      pendingDomains = /* @__PURE__ */ new Set();
      hadHiddenUpdate = false;
    }
  }
  function subscribe(domains, fn) {
    if (typeof domains === "function") {
      fn = domains;
      domains = null;
    }
    var entry = { domains: domains ? new Set(domains) : null, fn };
    subscribers.push(entry);
    connect();
    return function() {
      var i = subscribers.indexOf(entry);
      if (i >= 0) {
        subscribers.splice(i, 1);
        disconnect();
      }
    };
  }
  attach("live", {
    connect,
    disconnect,
    subscribe,
    onUpdate: function(fn) {
      return subscribe(null, fn);
    }
  });
})();
