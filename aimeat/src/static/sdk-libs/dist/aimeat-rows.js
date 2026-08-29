// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/rows/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-rows.js (with a per-node config prelude).
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

  // src/static/sdk-libs/rows/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-rows.js");
  function base(orgId, ws, space) {
    return "/v1/organisms/" + encodeURIComponent(orgId) + "/workspace/rows/" + encodeURIComponent(space) + "?ws=" + encodeURIComponent(ws);
  }
  function fail(res, fallback) {
    throw Object.assign(
      new Error(res && res.error && res.error.message || fallback),
      { code: res && res.error ? res.error.code : void 0 }
    );
  }
  var rows = {
    /**
     * Append one row (`body` an object) or many (`opts.rows`, each `{ body, rowId?, occurredAt? }`).
     * Returns `{ written, row_ids, pruned }`.
     */
    async append(orgId, ws, space, body, opts) {
      const payload = opts && Array.isArray(opts.rows) ? { rows: opts.rows.map(function(r) {
        return { row_id: r.rowId, occurred_at: r.occurredAt, body: r.body };
      }) } : { body, row_id: opts && opts.rowId, occurred_at: opts && opts.occurredAt };
      const res = await authFetch2(base(orgId, ws, space), { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) fail(res, "Failed to append rows");
      return res.data;
    },
    /**
     * Read rows by `occurredAt`. `opts`: `limit`, `since` / `until` (ISO, on occurredAt), `order`
     * ('asc' | 'desc'), `cursor` (from a previous answer), and `where` — one value per indexed
     * field (`{ where: { kind: 'order' } }`). Returns `{ rows, cursor, indexed }`; `cursor` is set
     * when there is more.
     */
    async read(orgId, ws, space, opts) {
      let url = base(orgId, ws, space);
      const o = opts || {};
      for (const k of ["limit", "since", "until", "order", "cursor"]) {
        if (o[k] !== void 0 && o[k] !== null && o[k] !== "") url += "&" + k + "=" + encodeURIComponent(o[k]);
      }
      if (o.where) for (const k of Object.keys(o.where)) url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(o.where[k]);
      const res = await authFetch2(url);
      if (!res.ok) fail(res, "Failed to read rows");
      return res.data;
    },
    /** What the space holds without reading a row: `{ rows, bytes, oldest, newest, lastWriteAt }`. */
    async stats(orgId, ws, space) {
      const res = await authFetch2("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace/rows/" + encodeURIComponent(space) + "/stats?ws=" + encodeURIComponent(ws));
      if (!res.ok) fail(res, "Failed to read row stats");
      return res.data && res.data.stats ? res.data.stats : res.data;
    }
  };
  attach("rows", rows);
  var index_default = rows;
})();
