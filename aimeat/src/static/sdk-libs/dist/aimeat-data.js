// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/data/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-data.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

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

  // src/static/sdk-libs/data/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-data.js");
  function withProvenance(res) {
    const prov = res.meta?.provenance;
    return prov ? { ...res.data, provenance: prov } : res.data;
  }
  async function publicEntryResponse(gaii, key) {
    const url = NODE_URL + "/v1/memory/" + encodeURIComponent(gaii) + "/" + encodeURIComponent(key) + "?soft=1";
    const r = await fetch(url);
    const res = await r.json();
    if (!res.ok) {
      if (res.error?.code === "NOT_FOUND") return null;
      throw new Error(res.error?.message || "Failed to read public memory");
    }
    return res;
  }
  function scopeParams(opts) {
    const p = new URLSearchParams();
    if (opts?.agent) p.set("agent", opts.agent);
    else if (opts?.ownerScope) p.set("owner_scope", "true");
    return p;
  }
  function withParams(path, params) {
    const qs = params.toString();
    if (!qs) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + qs;
  }
  var data = {
    // Write or upsert a memory entry
    async set(key, value, opts) {
      const body = { key, value, visibility: "private", ...opts };
      const res = await authFetch2("/v1/memory", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error(res.error?.message || "Failed to set memory");
      return res.data;
    },
    // Read a single entry (falls back to public read from app creator if not found or empty).
    // Uses ?soft=1 so a missing key is a clean 200 (value null) — no browser-console 404 noise;
    // the contract is unchanged: resolves null when the key does not exist.
    // opts: { agent, ownerScope } — read from one of the owner's agents' namespaces, or
    // across the owner's whole set (GHII + agents). Omitted → unchanged behaviour.
    async get(key, opts) {
      const res = await authFetch2(withParams(
        "/v1/memory/" + encodeURIComponent(key) + "?soft=1",
        scopeParams(opts)
      ));
      var val = res.ok ? res.data.value : null;
      var isEmpty = val == null || typeof val === "object" && Object.keys(val).length === 0;
      if (!isEmpty) return val;
      if (opts?.agent || opts?.ownerScope) return val;
      var creator = document.querySelector('meta[name="aimeat-creator"]')?.getAttribute("content");
      if (!creator) {
        var m = location.pathname.match(/\/v1\/apps\/([^/]+)\//);
        if (m) {
          creator = decodeURIComponent(m[1]);
          if (creator && !creator.includes("@")) creator = creator + "@" + NODE_ID;
        }
      }
      if (creator) {
        try {
          var pub = await data.getPublic(creator, key);
          if (pub != null) return pub;
        } catch {
        }
      }
      return val;
    },
    // Read full entry metadata. opts: { agent, ownerScope } as in get().
    // `provenance` is folded in from the envelope's `meta` — see withProvenance().
    async getEntry(key, opts) {
      const res = await authFetch2(withParams(
        "/v1/memory/" + encodeURIComponent(key),
        scopeParams(opts)
      ));
      if (!res.ok) {
        if (res.error?.code === "NOT_FOUND") return null;
        throw new Error(res.error?.message || "Failed to get memory");
      }
      return withProvenance(res);
    },
    // Update with optimistic locking
    async update(key, value, version, opts) {
      const body = { value, version, ...opts };
      const res = await authFetch2("/v1/memory/" + encodeURIComponent(key), {
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to update memory");
      return res.data;
    },
    /**
     * Delete an entry.
     *
     * `{ ownerScope: true }` deletes the key wherever it sits in this owner's scope — including a
     * namespace one of their agents wrote it into. `list({ ownerScope: true })` already returns those
     * keys, so without the same opt-in here an app can show a record it cannot remove.
     *
     * @param {string} key
     * @param {{ ownerScope?: boolean }} [opts]
     */
    async delete(key, opts) {
      const res = await authFetch2(withParams(
        "/v1/memory/" + encodeURIComponent(key),
        scopeParams(opts)
      ), { method: "DELETE" });
      if (!res.ok) throw new Error(res.error?.message || "Failed to delete memory");
      return res.data;
    },
    /**
     * List memory keys.
     *
     * opts:
     *   prefix, visibility, tags   — as before
     *   agent      — list ONE of the owner's agents' namespaces (full GAII `name#owner@node`)
     *   ownerScope — list across the owner's GHII + every same-owner agent. An owner session
     *                already gets this server-side; an app-grant token needs it stated.
     *   meta       — omit every `value` and report each entry's `bytes` instead. Use this for
     *                any listing you render as a table/board: the default response inlines
     *                every value, so a fleet-wide prefix can be megabytes per call.
     *   count      — return only `{ count }` (server-side COUNT, no values). A cheap
     *                "did anything change?" probe; its cache is dropped by any memory write.
     */
    async list(opts) {
      const params = scopeParams(opts);
      if (opts?.prefix) params.set("prefix", opts.prefix);
      if (opts?.visibility) params.set("visibility", opts.visibility);
      if (opts?.tags) params.set("tags", opts.tags.join(","));
      if (opts?.meta) params.set("include", "meta");
      if (opts?.count) params.set("count", "true");
      const qs = params.toString();
      const res = await authFetch2("/v1/memory" + (qs ? "?" + qs : ""));
      if (!res.ok) throw new Error(res.error?.message || "Failed to list memory");
      return res.data;
    },
    /** Cheap change probe: the number of keys under a prefix, no values transferred. */
    async count(opts) {
      const d = await data.list({ ...opts || {}, count: true });
      return d && typeof d.count === "number" ? d.count : null;
    },
    // Search memory entries
    // opts: { visibility, agent, ownerScope } — scoping as in list().
    async search(query, opts) {
      const params = scopeParams(opts);
      params.set("q", query);
      if (opts?.visibility) params.set("visibility", opts.visibility);
      const res = await authFetch2("/v1/memory/search?" + params.toString());
      if (!res.ok) throw new Error(res.error?.message || "Failed to search memory");
      return res.data;
    },
    // Read another agent's public memory (no auth needed). ?soft=1: missing (or hidden)
    // keys resolve null via a clean 200 instead of logging a console 404.
    //
    // Returns the VALUE, deliberately unchanged: every published app reading this library expects
    // the bare value here, so widening the return type would break them all. To see how the value
    // was made, use getPublicEntry() below.
    async getPublic(gaii, key) {
      const res = await publicEntryResponse(gaii, key);
      return res === null ? null : res.data.value;
    },
    /**
     * The same public read, as a full entry: `{ key, value, visibility, version, …, provenance }`.
     *
     * WHY THIS EXISTS. The node serves an item's AI provenance on the envelope's `meta`, and
     * getPublic() returns `res.data.value` — so the statement about how the content was made was
     * being thrown away at the last hop, on the one read path published apps actually use. An app
     * could render a model-written article and have no way to say so, however carefully the writing
     * agent had declared it. This is the same READ-DIRECTION loss that had to be fixed in the
     * connector (ai-provenance-carry.ts v1.1.0, "read_provenance() never returns anything"); the
     * browser library had it too.
     *
     * `provenance` is `{ id, record, record_url }` or undefined when the node holds no record for
     * the item. Undefined means UNSTATED, and never "a person wrote it".
     */
    async getPublicEntry(gaii, key) {
      const res = await publicEntryResponse(gaii, key);
      return res === null ? null : withProvenance(res);
    },
    // ── Micro-Memory (Tier 0.5, GET-based) ──
    micro(setName, accessCode) {
      const base = NODE_URL + "/v1/mm";
      function mmUrl(params) {
        const p = new URLSearchParams(params);
        if (accessCode) p.set("access_code", accessCode);
        return base + "?" + p.toString();
      }
      async function mmFetch(params) {
        const r = await fetch(mmUrl(params));
        const res = await r.json();
        if (!res.ok) throw new Error(res.error?.message || "Micro-memory operation failed");
        return res.data;
      }
      return {
        // Add or overwrite a key
        async add(key, value) {
          return mmFetch({ op: "add", set: setName, key, value: typeof value === "object" ? JSON.stringify(value) : String(value) });
        },
        // Modify existing key
        async mod(key, value) {
          return mmFetch({ op: "mod", set: setName, key, value: typeof value === "object" ? JSON.stringify(value) : String(value) });
        },
        // Delete a key
        async del(key) {
          return mmFetch({ op: "del", set: setName, key });
        },
        // List all entries in this set
        async list() {
          return mmFetch({ op: "list", set: setName });
        },
        // Batch add multiple key-value pairs
        async batch(entries) {
          const params = { op: "batch", set: setName };
          Object.keys(entries).forEach((k, i) => {
            params["key" + i] = k;
            const v = entries[k];
            params["value" + i] = typeof v === "object" ? JSON.stringify(v) : String(v);
          });
          return mmFetch(params);
        },
        // Configure visibility
        async config(visibility) {
          const params = { op: "config", set: setName, access: visibility };
          return mmFetch(params);
        },
        // Get a single key value
        async get(key) {
          const d = await mmFetch({ op: "list", set: setName });
          return d.entries?.[key] ?? null;
        }
      };
    },
    // List all micro-memory sets
    async microSets() {
      const url = NODE_URL + "/v1/mm?op=list";
      const r = await fetch(url);
      const res = await r.json();
      if (!res.ok) throw new Error(res.error?.message || "Failed to list micro-memory sets");
      return res.data;
    }
  };
  attach("data", data);
})();
