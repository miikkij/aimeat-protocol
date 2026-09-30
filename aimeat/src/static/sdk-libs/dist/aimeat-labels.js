// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/labels/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-labels.js (with a per-node config prelude).
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

  // src/static/sdk-libs/labels/warning.js
  var WARNING_CLASS = "aimeat-label-warning";
  function warningOf(item) {
    if (!item || typeof item !== "object") return null;
    const w = item.classificationWarning || item.classification_warning;
    if (!w || typeof w !== "object" || typeof w.label !== "string") return null;
    return { label: w.label, name: String(w.name || w.label), says: String(w.says || "") };
  }
  var STYLE = [
    "display:block",
    "margin:0 0 .5em",
    "padding:.35em .6em",
    "font:inherit",
    "font-family:var(--font-body, inherit)",
    "font-size:var(--text-sm, var(--text-fine, .875em))",
    "line-height:1.4",
    "background:var(--warn-bg, var(--color-warning, transparent))",
    "color:var(--warn-fg, var(--color-warning-content, currentColor))",
    "border:1px solid var(--warn-border, var(--color-warning, currentColor))",
    "border-radius:var(--radius-sm, var(--radius-field, 4px))"
  ].join(";");
  function renderWarning(item, container) {
    if (typeof document === "undefined") return null;
    const old = container ? container.querySelector(":scope > ." + WARNING_CLASS) : null;
    const w = warningOf(item);
    if (!w) {
      if (old) old.remove();
      return null;
    }
    const el = document.createElement("p");
    el.className = WARNING_CLASS;
    el.setAttribute("role", "note");
    el.dataset.label = w.label;
    el.setAttribute("style", STYLE);
    const name = document.createElement("strong");
    name.textContent = w.name;
    el.appendChild(name);
    if (w.says) el.appendChild(document.createTextNode(": " + w.says));
    if (container) {
      if (old) old.replaceWith(el);
      else container.insertBefore(el, container.firstChild);
    }
    return el;
  }

  // src/static/sdk-libs/labels/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-labels.js");
  var HUMAN = {
    CLASSIFIED: "This content is classified so that an AI may not read it. Nothing was sent to the AI.",
    AUDIENCE_LOCKOUT: "This label limits who may read the content, and you are not among them. Pick another label, or add yourself to its audience first.",
    JUSTIFICATION_REQUIRED: "Lowering this label needs a written reason: why the content is less sensitive than its label says.",
    POLICY_DILUTES: "A lower level may only make the node policy stricter.",
    INVALID_POLICY: "The policy is not valid.",
    PERSON_REQUIRED: "A person decides this, signed in themselves.",
    AI_LABELLING_OFF: "The classification policy does not let an AI set labels. A person sets the label.",
    LABEL_UNKNOWN: "That label is not active in the policy that applies here.",
    CLASSIFICATION_OFF: "Classification is off on this server.",
    NO_SUGGESTION: "Nothing is waiting for a review on this content.",
    NO_PROPOSAL: "Nothing is waiting for a review on this policy.",
    OPERATOR_REQUIRED: "Only an operator of this server changes the node policy.",
    NOT_FOUND: "No such content, or it is not yours to label.",
    FOREIGN_VISITOR: "A visitor from another node labels nothing here.",
    AUTH_REQUIRED: "Sign in to see or change a classification.",
    INVALID_INPUT: "The request does not name the content the way the node expects.",
    EXCEPTION_LIMIT: "This month already holds as many exceptions as it may. Withdraw ones that are no longer needed."
  };
  function labelsError(r) {
    const e = r && r.error;
    const code = e && e.code || "UNKNOWN";
    const err = (
      /** @type {Error & { code?: string, details?: any }} */
      new Error(e && e.message || HUMAN[code] || "The classification call failed")
    );
    err.code = code;
    if (e && e.details !== void 0 && e.details !== null) err.details = e.details;
    return err;
  }
  async function call(path, init) {
    const r = await authFetch2(path, init);
    if (!r || r.ok === false) throw labelsError(r);
    return r.data;
  }
  var send = (method, path, body) => call(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  function query(params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== void 0 && v !== null && v !== "") p.set(k, String(v));
    const qs = p.toString();
    return qs ? "?" + qs : "";
  }
  function targetParams(t) {
    if (typeof t === "string") return { kind: "memory", key: t };
    const o = (
      /** @type {any} */
      t || {}
    );
    const row = o.row || (o.kind === "row" ? o : null);
    if (row) {
      return {
        kind: "row",
        organism_id: row.organismId ?? row.organism_id,
        ws: row.ws,
        space: row.space,
        row_id: row.rowId ?? row.row_id
      };
    }
    return { kind: o.kind || "memory", key: o.key, owner: o.owner };
  }
  function get(target) {
    return call("/v1/classification/label" + query(targetParams(target)));
  }
  async function set(input) {
    const o = (
      /** @type {any} */
      input || {}
    );
    if (typeof o.label !== "string" || !o.label) throw new Error("label is required: a label id from policy()");
    return send("PUT", "/v1/classification/label", {
      ...targetParams(o),
      label: o.label,
      justification: o.justification,
      humanSaid: o.humanSaid,
      confidence: o.confidence,
      reason: o.reason
    });
  }
  async function review(input) {
    const o = (
      /** @type {any} */
      input || {}
    );
    if (o.decision !== "accept" && o.decision !== "reject") throw new Error("decision is accept or reject");
    return send("POST", "/v1/classification/label/review", {
      ...targetParams(o),
      decision: o.decision,
      justification: o.justification,
      humanSaid: o.humanSaid
    });
  }
  function policy(opts) {
    const o = opts || {};
    return call("/v1/classification/policy" + query({ level: o.level, organism_id: o.organismId }));
  }
  function audit(opts) {
    const o = opts || {};
    return call("/v1/classification/audit" + query({
      level: o.level,
      organism_id: o.organismId,
      since: o.since,
      action: o.action,
      limit: o.limit
    }));
  }
  function list(opts) {
    const o = opts || {};
    return call("/v1/classification/labels" + query({
      level: o.level,
      organism_id: o.organismId,
      label: o.label,
      pending: o.pending ? "true" : void 0,
      kind: o.kind,
      limit: o.limit,
      cursor: o.cursor
    }));
  }
  async function scan(input) {
    const o = input || {};
    if (o.prefix) return send("POST", "/v1/classification/scan", { prefix: o.prefix });
    const keys = o.keys || (o.key ? [o.key] : null);
    if (!keys || keys.length === 0) throw new Error("scan needs key, keys or prefix");
    return send("POST", "/v1/classification/scan", { keys });
  }
  function exceptions(opts) {
    const o = opts || {};
    return call("/v1/classification/exceptions" + query({
      level: o.level,
      organism_id: o.organismId,
      action: o.action,
      since: o.since,
      limit: o.limit
    }));
  }
  async function except(input) {
    const o = (
      /** @type {any} */
      input || {}
    );
    if (o.action !== "leave" && o.action !== "ai-send") throw new Error("action is leave or ai-send");
    if (typeof o.reason !== "string" || !o.reason.trim()) throw new Error("reason is required: why the item may go out");
    return send("POST", "/v1/classification/exceptions", {
      ...targetParams(o),
      action: o.action,
      reason: o.reason,
      until: o.until
    });
  }
  function withdrawException(id) {
    return call("/v1/classification/exceptions/" + encodeURIComponent(id), { method: "DELETE" });
  }
  function isClassified(err) {
    return !!err && err.code === "CLASSIFIED";
  }
  var labels = {
    get,
    set,
    review,
    policy,
    audit,
    list,
    scan,
    exceptions,
    except,
    withdrawException,
    warningOf,
    renderWarning,
    isClassified
  };
  attach("labels", labels);
})();
