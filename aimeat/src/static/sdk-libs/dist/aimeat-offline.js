// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/offline/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-offline.js (with a per-node config prelude).
"use strict";
(() => {
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

  // src/static/sdk-libs/offline/store.js
  var DB_NAME = "aimeat-offline";
  var STORES = ["copy", "queue"];
  function openDb() {
    return new Promise(function(resolve, reject) {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = function() {
        STORES.forEach(function(name) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        });
      };
      req.onsuccess = function() {
        resolve(req.result);
      };
      req.onerror = function() {
        reject(req.error);
      };
      req.onblocked = function() {
        reject(new Error("The database is held open by another page"));
      };
    });
  }
  function openStore() {
    const memory = { copy: /* @__PURE__ */ new Map(), queue: /* @__PURE__ */ new Map() };
    const db = openDb().then(null, function(err) {
      console.warn("[aimeat-offline] this browser keeps nothing for this app; it works until the page closes:", err && err.message);
      return null;
    });
    function ask2(store2, mode, run, inMemory) {
      return db.then(function(d) {
        if (!d) return inMemory(memory[store2]);
        return new Promise(function(resolve) {
          let req;
          try {
            const tx = d.transaction(store2, mode);
            req = run(tx.objectStore(store2));
            tx.oncomplete = function() {
              resolve(req.result);
            };
            tx.onerror = tx.onabort = function() {
              console.warn("[aimeat-offline] a write to the device failed:", tx.error && tx.error.message);
              resolve(void 0);
            };
          } catch (err) {
            console.warn("[aimeat-offline] the device store could not be used:", err && /** @type {Error} */
            err.message);
            resolve(void 0);
          }
        });
      });
    }
    return {
      /** True when the browser gave a database; false when everything lives in the page's memory. */
      persistent: function() {
        return db.then(function(d) {
          return !!d;
        });
      },
      /** @returns {Promise<{ value: any, at: string } | null>} */
      get: function(store2, key) {
        return ask2(store2, "readonly", function(s) {
          return s.get(key);
        }, function(m) {
          return m.get(key);
        }).then(function(v) {
          return v && typeof v === "object" && "value" in v ? v : null;
        });
      },
      put: function(store2, key, value) {
        const row = { value, at: (/* @__PURE__ */ new Date()).toISOString() };
        return ask2(store2, "readwrite", function(s) {
          return s.put(row, key);
        }, function(m) {
          m.set(key, row);
          return key;
        }).then(function(done) {
          return done !== void 0;
        });
      },
      remove: function(store2, key) {
        return ask2(store2, "readwrite", function(s) {
          return s.delete(key);
        }, function(m) {
          m.delete(key);
          return true;
        }).then(function() {
          return true;
        });
      },
      /** Every key of the store that starts with the prefix. @returns {Promise<string[]>} */
      keys: function(store2, prefix) {
        return ask2(store2, "readonly", function(s) {
          return s.getAllKeys();
        }, function(m) {
          return Array.from(m.keys());
        }).then(function(all) {
          return (Array.isArray(all) ? all : []).map(String).filter(function(k) {
            return k.indexOf(prefix) === 0;
          });
        });
      }
    };
  }

  // src/static/sdk-libs/offline/queue.js
  function createQueue(spec) {
    let items = [];
    let seq = 0;
    let busy = false;
    let reachable = true;
    let closed = false;
    let retryTimer = null;
    let saving = Promise.resolve();
    const listeners = [];
    const setTimer = spec.setTimer || function(fn, ms) {
      return setTimeout(fn, ms);
    };
    const clearTimer = spec.clearTimer || function(h) {
      clearTimeout(h);
    };
    const retryMs = spec.retryMs === void 0 ? 2e4 : spec.retryMs;
    const keyOf = function(entry) {
      return spec.group ? String(spec.group(entry.value)) : "#" + entry.n;
    };
    function tell() {
      listeners.slice().forEach(function(fn) {
        fn();
      });
    }
    function persist() {
      const snapshot = { items: items.map(function(e) {
        return { n: e.n, value: e.value };
      }), seq };
      saving = saving.then(function() {
        return spec.save(snapshot);
      }).then(null, function(err) {
        console.warn("[aimeat-offline] the waiting changes were not kept:", err && err.message);
      });
      return saving;
    }
    const ready = Promise.resolve().then(function() {
      return spec.load();
    }).then(function(kept) {
      const had = kept && Array.isArray(kept.items) ? kept.items.filter(function(e) {
        return e && typeof e.n === "number";
      }) : [];
      const early = items;
      seq = Math.max(kept && Number(kept.seq) || 0, had.reduce(function(m, e) {
        return Math.max(m, e.n);
      }, 0));
      early.forEach(function(e) {
        e.n = ++seq;
      });
      items = had.concat(early);
      if (had.length) tell();
    }, function(err) {
      console.warn("[aimeat-offline] the kept changes could not be read:", err && err.message);
    });
    function retryLater() {
      if (!retryMs || closed) return;
      clearTimer(retryTimer);
      retryTimer = setTimer(function() {
        retryTimer = null;
        flush();
      }, retryMs);
    }
    function flush() {
      if (closed) return Promise.resolve(false);
      if (busy) return Promise.resolve(items.length === 0);
      if (!items.length) return Promise.resolve(true);
      if (spec.online && !spec.online()) {
        if (reachable) {
          reachable = false;
          tell();
        }
        return Promise.resolve(false);
      }
      busy = true;
      function next() {
        if (!items.length || closed) return Promise.resolve(true);
        const head = items[0], key = keyOf(head), batch = [];
        for (let i = 0; i < items.length && keyOf(items[i]) === key; i++) batch.push(items[i]);
        return Promise.resolve().then(function() {
          return spec.send(batch.map(function(e) {
            return e.value;
          }));
        }).then(function(settled) {
          if (!settled) return false;
          items = items.filter(function(e) {
            return batch.indexOf(e) < 0;
          });
          reachable = true;
          return persist().then(function() {
            tell();
            return next();
          });
        });
      }
      return next().then(null, function(err) {
        console.warn("[aimeat-offline] a send failed without an answer:", err && err.message);
        return false;
      }).then(function(all) {
        busy = false;
        if (!all) {
          reachable = false;
          retryLater();
        }
        tell();
        return !!all;
      });
    }
    return {
      /** Resolves when the kept list has been read. push() before it is safe. */
      ready,
      /**
       * Add one change at the end, keep the list, and try to send.
       * @param {any} value  The change, as plain data the browser can store.
       * @returns {Promise<any>} Resolves when the list is kept.
       */
      push: function(value) {
        items.push({ n: ++seq, value });
        const kept = ready.then(persist);
        tell();
        ready.then(flush);
        return kept;
      },
      /** The waiting changes, oldest first. */
      items: function() {
        return items.map(function(e) {
          return e.value;
        });
      },
      size: function() {
        return items.length;
      },
      /**
       * Take out every waiting change the test picks (a change that depended on a refused one).
       * @param {(value: any) => boolean} test
       * @returns {number} How many left.
       */
      drop: function(test) {
        const before = items.length;
        items = items.filter(function(e) {
          return !test(e.value);
        });
        if (items.length !== before) {
          ready.then(persist);
          tell();
        }
        return before - items.length;
      },
      flush: function() {
        return ready.then(flush);
      },
      /**
       * Hear every change of the list or of its state.
       * @param {() => void} fn
       * @returns {() => void} Stop hearing.
       */
      on: function(fn) {
        listeners.push(fn);
        return function() {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      /** waiting: how many changes wait; busy: a send is running; reachable: the last send got an answer. */
      state: function() {
        return { waiting: items.length, busy, reachable };
      },
      /** The device reports a network again, or lost it: index.js calls these from the window's events. */
      networkChanged: function(on) {
        if (!on) {
          if (reachable) {
            reachable = false;
            tell();
          }
          return;
        }
        ready.then(flush);
      },
      /** Stop sending and forget the timers. The kept list stays. */
      destroy: function() {
        closed = true;
        clearTimer(retryTimer);
        listeners.length = 0;
      }
    };
  }

  // src/static/sdk-libs/offline/index.js
  var SW_PATH = "/sw-offline.js";
  var SW_SCOPE = "/";
  var WORKER_ANSWER_MS = 3e4;
  var opened = null;
  function store() {
    if (!opened) opened = openStore();
    return opened;
  }
  function refuse(code, reason) {
    return { ok: false, code, reason };
  }
  function say(err) {
    return err && err.message ? err.message : String(err);
  }
  function declared() {
    const meta = document.querySelector('meta[name="aimeat-offline"]');
    return !!meta && /\bshell\b/.test(meta.getAttribute("content") || "");
  }
  function supported() {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined";
  }
  function partsOfPage() {
    const seen = {};
    const add = function(raw) {
      if (!raw) return;
      try {
        const url = new URL(raw, location.href);
        if (url.protocol === "http:" || url.protocol === "https:") seen[url.href.split("#")[0]] = true;
      } catch (err) {
        console.debug("[aimeat-offline] not an address:", raw, say(err));
      }
    };
    add(location.origin + "/");
    document.querySelectorAll("script[src]").forEach(function(n) {
      add(n.getAttribute("src"));
    });
    document.querySelectorAll("link[href]").forEach(function(n) {
      if (/\b(stylesheet|icon|manifest|apple-touch-icon|preload)\b/i.test(n.getAttribute("rel") || "")) add(n.getAttribute("href"));
    });
    document.querySelectorAll("img[src]").forEach(function(n) {
      const src = n.getAttribute("src") || "";
      if (src.indexOf("data:") !== 0) add(src);
    });
    if (typeof performance !== "undefined" && performance.getEntriesByType) {
      performance.getEntriesByType("resource").forEach(function(e) {
        const entry = (
          /** @type {PerformanceResourceTiming} */
          e
        );
        if (["script", "link", "css", "img"].indexOf(entry.initiatorType) >= 0) add(entry.name);
      });
    }
    return Object.keys(seen).filter(function(href) {
      return href.indexOf(location.origin + "/") === 0;
    });
  }
  function ask(worker, message) {
    return new Promise(function(resolve) {
      const channel = new MessageChannel();
      const timer = setTimeout(function() {
        resolve(refuse("WORKER_SILENT", "The app's worker did not answer."));
      }, WORKER_ANSWER_MS);
      channel.port1.onmessage = function(ev) {
        clearTimeout(timer);
        resolve(ev.data);
      };
      worker.postMessage(message, [channel.port2]);
    });
  }
  async function registration() {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    const worker = reg && (reg.active || reg.waiting || reg.installing);
    return reg && worker && new URL(worker.scriptURL).pathname === SW_PATH ? reg : null;
  }
  var shell = {
    /** Whether this browser can keep a page at all. */
    supported,
    /** Whether the page carries the meta that asks for it. */
    declared,
    /**
     * Keep this app's page so that it opens with no connection. Safe at every start: once the page
     * is kept, a call costs one message to the worker. Never throws.
     * @returns {Promise<{ok: true, enabled: true, entries: number, first: boolean} | {ok: false, code: string, reason: string}>}
     */
    enable: async function() {
      if (!supported()) return refuse("NO_WORKER_SUPPORT", "This browser cannot keep an app for use with no connection.");
      if (!declared()) return refuse("NOT_DECLARED", 'This app does not ask to be kept: its page needs <meta name="aimeat-offline" content="shell"> in the head.');
      let reg;
      try {
        reg = await registration() || await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
        await navigator.serviceWorker.ready;
      } catch (err) {
        return refuse("WORKER_FAILED", "This app could not start its worker. An app is kept only at its own address on a node that serves /sw-offline.js there: " + say(err));
      }
      const worker = reg.active || (await navigator.serviceWorker.ready).active;
      if (!worker) return refuse("WORKER_FAILED", "The app's worker did not start.");
      const now = await ask(worker, { type: "aimeat-shell-status" });
      if (now && now.ok && now.on && now.entries > 0) return { ok: true, enabled: true, entries: now.entries, first: false };
      const kept = await ask(worker, { type: "aimeat-shell-keep", urls: partsOfPage() });
      if (!kept || !kept.ok) return refuse(kept && kept.code || "KEEP_FAILED", "The app's page could not be kept: " + (kept && kept.reason || "no answer"));
      return { ok: true, enabled: true, entries: kept.kept, first: true };
    },
    /**
     * Stop keeping the page: the kept copy is deleted. The worker stays, because it also carries the
     * app's notifications; without a kept copy it answers nothing.
     * @returns {Promise<{ok: boolean, code?: string, reason?: string}>}
     */
    disable: async function() {
      if (!supported()) return { ok: true };
      try {
        const reg = await registration();
        if (!reg || !reg.active) return { ok: true };
        const done = await ask(reg.active, { type: "aimeat-shell-drop" });
        return done && done.ok ? { ok: true } : refuse("DROP_FAILED", "The kept page could not be deleted: " + (done && done.reason || "no answer"));
      } catch (err) {
        return refuse("DROP_FAILED", "The kept page could not be deleted: " + say(err));
      }
    },
    /**
     * Whether this app's page is kept, read from the worker: no registration is made.
     * @returns {Promise<{ok: true, enabled: boolean, entries: number}>}
     */
    status: async function() {
      if (!supported()) return { ok: true, enabled: false, entries: 0 };
      try {
        const reg = await registration();
        if (!reg || !reg.active) return { ok: true, enabled: false, entries: 0 };
        const now = await ask(reg.active, { type: "aimeat-shell-status" });
        return { ok: true, enabled: !!(now && now.ok && now.on), entries: now && now.entries || 0 };
      } catch (err) {
        console.warn("[aimeat-offline] the worker could not be asked:", say(err));
        return { ok: true, enabled: false, entries: 0 };
      }
    }
  };
  function prefixOf(name, account) {
    const clean = function(s) {
      return String(s == null ? "" : s).replace(/[\n\r]/g, " ");
    };
    if (!clean(name) || !clean(account)) throw new Error("A copy and a queue need a name and the account they belong to");
    return clean(account) + "\n" + clean(name) + "\n";
  }
  function copy(name, account) {
    const prefix = prefixOf(name, account);
    return {
      /** True when the browser keeps the copy across reloads; false in a private window. */
      persistent: function() {
        return store().persistent();
      },
      /** The kept value, or null. */
      get: function(key) {
        return store().get("copy", prefix + key).then(function(row) {
          return row ? row.value : null;
        });
      },
      /** When the value was kept (ISO), or null: how an app says how old what it shows is. */
      kept: function(key) {
        return store().get("copy", prefix + key).then(function(row) {
          return row ? row.at : null;
        });
      },
      /** Keep a value: plain data the browser can store. Resolves true when it is kept. */
      set: function(key, value) {
        return store().put("copy", prefix + key, value);
      },
      remove: function(key) {
        return store().remove("copy", prefix + key);
      },
      /** The keys this copy holds. */
      keys: function() {
        return store().keys("copy", prefix).then(function(all) {
          return all.map(function(k) {
            return k.slice(prefix.length);
          });
        });
      },
      /** Delete the whole copy. */
      clear: function() {
        return store().keys("copy", prefix).then(function(all) {
          return Promise.all(all.map(function(k) {
            return store().remove("copy", k);
          }));
        }).then(function() {
          return true;
        });
      }
    };
  }
  function queue(spec) {
    const key = prefixOf(spec.name, spec.account) + "queue";
    const q = createQueue({
      load: function() {
        return store().get("queue", key).then(function(row) {
          return row ? row.value : null;
        });
      },
      save: function(state) {
        return store().put("queue", key, state);
      },
      send: spec.send,
      group: spec.group,
      retryMs: spec.retryMs,
      online: function() {
        return navigator.onLine !== false;
      }
    });
    const up = function() {
      q.networkChanged(true);
    };
    const down = function() {
      q.networkChanged(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const destroy = q.destroy;
    q.destroy = function() {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      destroy();
    };
    return q;
  }
  function forget(account) {
    const prefix = String(account == null ? "" : account).replace(/[\n\r]/g, " ") + "\n";
    if (prefix === "\n") return Promise.resolve(false);
    return Promise.all(["copy", "queue"].map(function(name) {
      return store().keys(name, prefix).then(function(all) {
        return Promise.all(all.map(function(k) {
          return store().remove(name, k);
        }));
      });
    })).then(function() {
      return true;
    });
  }
  function identity() {
    const auth = namespace().auth;
    return auth && typeof auth.offlineIdentity === "function" ? auth.offlineIdentity() : null;
  }
  var offline = {
    shell,
    identity,
    /** Whether the device reports a network. False is certain; true only says the device has one. */
    reachable: function() {
      return typeof navigator === "undefined" || navigator.onLine !== false;
    },
    copy,
    queue,
    forget
  };
  attach("offline", offline);
})();
