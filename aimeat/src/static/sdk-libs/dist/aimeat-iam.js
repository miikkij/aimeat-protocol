// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/iam/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-iam.js (with a per-node config prelude).
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

  // src/static/sdk-libs/iam/dialect.js
  var DIALECTS = {
    op: { gate: "check", admin: "admin", key: "op", state: "getState", assign: "assign", revoke: "revoke" },
    command: { gate: "check", admin: "admin", key: "command", state: "list", assign: "approve", revoke: "revoke" },
    level: { gate: "mylevel", admin: "admin", key: "op", state: "getState", assign: "assign", revoke: "revoke" }
  };
  async function detectDialect(nodeUrl, ext) {
    const res = await fetch(nodeUrl + "/v1/extensions/" + encodeURIComponent(ext));
    if (!res.ok) {
      throw new Error('aimeat-iam: extension "' + ext + '" was not found on this node (' + res.status + ")");
    }
    const body = await res.json();
    const record = body.data && (body.data.extension || body.data) || {};
    const actions = (record.actions || []).map((a) => a.id);
    if (!actions.length) throw new Error('aimeat-iam: extension "' + ext + '" advertises no actions');
    if (actions.indexOf("mylevel") !== -1) {
      return { dialect: "level", actions, hasRequest: false };
    }
    const admin = (record.actions || []).find((a) => a.id === "admin");
    const props = admin && (admin.inputSchema || admin.input_schema) && (admin.inputSchema || admin.input_schema).properties || {};
    const dialect = props.command && !props.op ? "command" : "op";
    return { dialect, actions, hasRequest: actions.indexOf("request") !== -1 };
  }
  function callCheck(call, ext, dialect, input) {
    const d = DIALECTS[dialect];
    const body = dialect === "command" ? input && input.owner ? { owner: input.owner } : {} : input || {};
    return unwrap(call("/v1/ext/" + ext + "/" + d.gate, { method: "POST", body: JSON.stringify(body) }));
  }
  function callAdmin(call, ext, dialect, op, args) {
    const d = DIALECTS[dialect];
    const resolved = d[op] || op;
    const body = Object.assign({}, args || {});
    body[d.key] = resolved;
    return unwrap(call("/v1/ext/" + ext + "/" + d.admin, { method: "POST", body: JSON.stringify(body) }));
  }
  async function callRequest(call, ext, dialect, hasRequest, note) {
    if (!hasRequest) {
      return { recorded: true, passive: true };
    }
    const r = await unwrap(call("/v1/ext/" + ext + "/request", {
      method: "POST",
      body: JSON.stringify(note ? { note } : {})
    }));
    return { recorded: r.recorded !== false, passive: false, note: r.note, alreadyMember: r.alreadyMember };
  }
  async function unwrap(p) {
    const body = await p;
    if (body && body.data !== void 0) return body.data;
    return body;
  }

  // src/static/sdk-libs/iam/gate.js
  function makeGate(store, serverCheck) {
    function can(cap) {
      const me = store.me();
      if (!me) return false;
      const caps = me.caps || [];
      return caps.indexOf("*") !== -1 || caps.indexOf(cap) !== -1;
    }
    function gate(target, cap) {
      const el = (
        /** @type {HTMLElement|null} */
        typeof target === "string" ? document.querySelector(target) : target
      );
      if (!el) return;
      el.hidden = !can(cap);
    }
    async function guard(cap, fn) {
      const verdict = await serverCheck({ permission: cap });
      if (!verdict || !verdict.allowed) return void 0;
      return fn();
    }
    return { can, gate, guard };
  }

  // src/static/sdk-libs/iam/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-iam.js");
  var state = { ext: null, dialect: (
    /** @type {Dialect} */
    "op"
  ), hasRequest: false, me: null, roles: {} };
  function normalise(raw, roles, dialect) {
    const r = raw || {};
    if (dialect === "command") {
      return {
        member: !!(r.member || r.isOwner),
        isOwner: !!r.isOwner,
        role: r.role || null,
        level: typeof r.level === "number" ? r.level : null,
        caps: Array.isArray(r.may) ? r.may : [],
        mode: r.mode || null,
        via: null,
        subject: null,
        since: r.since || null
      };
    }
    if (dialect === "level") {
      return {
        member: typeof r.level === "number",
        isOwner: !!r.isOwner,
        role: r.role || r.key || null,
        level: typeof r.level === "number" ? r.level : null,
        caps: [],
        mode: null,
        via: null,
        subject: null,
        since: r.since || null
      };
    }
    const role = r.role || null;
    return {
      member: !!role && role !== (r.defaultRole || null),
      isOwner: !!r.isOwner,
      role,
      level: typeof r.level === "number" ? r.level : null,
      caps: role && roles[role] || [],
      mode: r.mode || null,
      via: r.via || null,
      subject: r.subject || null,
      since: r.since || null
    };
  }
  var iam = {
    /**
     * Learn how this app's gate is shaped, then read the caller's standing. One detection round-trip,
     * after which nothing guesses. Pass `dialect` to skip detection entirely.
     * @param {{ ext: string, dialect?: 'op'|'command'|'level' }} opts
     * @returns {Promise<IamMe>}
     */
    async init(opts) {
      if (!opts || !opts.ext) throw new Error("aimeat-iam: init({ ext }) needs the installed extension name");
      state.ext = opts.ext;
      if (opts.dialect) {
        state.dialect = opts.dialect;
        state.hasRequest = opts.dialect === "command";
      } else {
        const d = await detectDialect(resolveNodeUrl(), opts.ext);
        state.dialect = d.dialect;
        state.hasRequest = d.hasRequest;
      }
      return iam.refresh();
    },
    /**
     * Re-read the caller's standing from the server. Call this after anything that could change it,
     * and on the `aimeat-live-update` event if the host page listens for one.
     * @returns {Promise<IamMe>}
     */
    async refresh() {
      requireInit();
      if (state.dialect !== "command") {
        const st = await callAdmin(authFetch2, state.ext, state.dialect, "state").catch(() => null);
        if (st && st.roles) state.roles = st.roles;
      }
      const probe = state.dialect === "op" ? { permission: "\0probe" } : {};
      const raw = await callCheck(authFetch2, state.ext, state.dialect, probe);
      state.me = normalise(raw, state.roles, state.dialect);
      return state.me;
    },
    /**
     * The caller's standing as last read. Null until init() has run.
     * @returns {IamMe|null}
     */
    me() {
      return state.me;
    },
    /** The dialect in use, for an app that wants to explain itself. @returns {string} */
    dialect() {
      return state.dialect;
    },
    /**
     * Ask the gate directly. This is the call an app should mirror server-side before it mutates
     * anything; the answer carries the mutation tier when a command id is passed, so an agent knows
     * when to seek human confirmation.
     * @param {{ permission?: string, command?: string }} input
     * @returns {Promise<{ allowed: boolean, role?: string, tier?: string, needsConfirmation?: boolean, via?: string }>}
     */
    async check(input) {
      requireInit();
      if (state.dialect === "command") {
        const raw = await callCheck(authFetch2, state.ext, state.dialect, {});
        const me = normalise(raw, state.roles, state.dialect);
        const cap = input && (input.permission || input.command) || "";
        const allowed = me.caps.indexOf("*") !== -1 || me.caps.indexOf(cap) !== -1;
        return { allowed, role: me.role || void 0 };
      }
      return callCheck(authFetch2, state.ext, state.dialect, input || {});
    },
    /**
     * Ask the owner for access. Where the extension has no request action the visit itself is the
     * application, and the answer says so (`passive: true`) instead of reporting a send that did not
     * happen.
     * @param {string} [note]  Who you are and what you need it for.
     * @returns {Promise<{ recorded: boolean, passive: boolean }>}
     */
    request(note) {
      requireInit();
      return callRequest(authFetch2, state.ext, state.dialect, state.hasRequest, note);
    },
    /**
     * The member roster, owner-only. Normalised to one row shape across the dialects that keep a map
     * (`op`) and the one that keeps a list (`command`).
     * @returns {Promise<{ ok: boolean, members: Array<{ id: string, role: string|null, level: number|null, since: string|null, grants: string[] }>, error?: string }>}
     */
    async roster() {
      requireInit();
      const st = await callAdmin(authFetch2, state.ext, state.dialect, "state");
      if (st && st.ok === false) return { ok: false, members: [], error: st.error };
      if (state.dialect === "command") {
        const rows = st && st.members || [];
        return {
          ok: true,
          members: rows.map((m) => ({
            id: m.owner,
            role: m.role || null,
            level: typeof m.level === "number" ? m.level : null,
            since: m.since || null,
            grants: m.grants || []
          }))
        };
      }
      const map = st && st.assignments || {};
      const levels = st && st.levels || {};
      return {
        ok: true,
        members: Object.keys(map).map((id) => ({
          id,
          role: map[id],
          level: typeof levels[map[id]] === "number" ? levels[map[id]] : null,
          since: null,
          grants: []
        }))
      };
    },
    /**
     * Drive the admin surface in this app's own dialect. `op` is a logical name (state | assign |
     * revoke) that the adapter translates, so a caller never learns which key its fork multiplexes on.
     * @param {string} op
     * @param {Record<string, unknown>} [args]
     * @returns {Promise<any>}
     */
    admin(op, args) {
      requireInit();
      return callAdmin(authFetch2, state.ext, state.dialect, op, args);
    }
  };
  function requireInit() {
    if (!state.ext) throw new Error("aimeat-iam: call AIMEAT.iam.init({ ext }) first");
  }
  var gateApi = makeGate({ me: () => state.me }, (input) => iam.check(input));
  iam.can = gateApi.can;
  iam.gate = gateApi.gate;
  iam.guard = gateApi.guard;
  attach("iam", iam);
})();
