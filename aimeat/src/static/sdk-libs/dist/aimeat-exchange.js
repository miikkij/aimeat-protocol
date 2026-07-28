// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/exchange/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-exchange.js (with a per-node config prelude).
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

  // src/static/sdk-libs/exchange/client.js
  var NODE_URL2 = APEX_URL;
  var { authFetch: authFetch2 } = makeSession("aimeat-exchange.js");
  function exchangeError(res, fallback) {
    const e = (
      /** @type {Error & { code?: string, details?: unknown }} */
      new Error(res && res.error && res.error.message || fallback)
    );
    e.code = res && res.error && res.error.code;
    e.details = res && res.error && res.error.details;
    return e;
  }
  function qs(params) {
    const parts = [];
    for (const k of Object.keys(params || {})) {
      const v = params[k];
      if (v === null || v === void 0 || v === "") continue;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
    }
    return parts.length ? "?" + parts.join("&") : "";
  }
  function hasSession() {
    try {
      const auth = window.AIMEAT && window.AIMEAT.auth;
      return !!(auth && auth.getSession());
    } catch {
      return false;
    }
  }
  async function pub(path, fallback) {
    const r = await fetch(NODE_URL2 + path);
    const res = await r.json();
    if (!res.ok) throw exchangeError(res, fallback);
    return res.data;
  }
  async function pubText(path, fallback) {
    const r = await fetch(NODE_URL2 + path);
    const text = await r.text();
    if (!r.ok) {
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
      }
      throw exchangeError(parsed, fallback);
    }
    return text;
  }
  async function authed(path, opts, fallback) {
    const res = await authFetch2(path, opts);
    if (!res.ok) throw exchangeError(res, fallback || "EXCHANGE request failed");
    return res.data;
  }
  async function maybe(path, fallback) {
    if (!hasSession()) return pub(path, fallback);
    try {
      return await authed(path, void 0, fallback);
    } catch (e) {
      if (e && (e.code === "UNAUTHORIZED" || e.code === "FORBIDDEN")) return pub(path, fallback);
      throw e;
    }
  }
  function send(path, method, body, fallback) {
    const opts = (
      /** @type {RequestInit} */
      { method }
    );
    if (body !== void 0) opts.body = JSON.stringify(body);
    return authed(path, opts, fallback);
  }

  // src/static/sdk-libs/exchange/browse.js
  var enc = encodeURIComponent;
  function info() {
    return pub("/v1/exchange/info", "Failed to read the EXCHANGE economics");
  }
  function list(filter) {
    const f = filter || {};
    const query = qs({ ext: f.ext, action: f.action, q: f.q, stats: f.stats ? "1" : null });
    return maybe("/v1/exchange/offerings" + query, "Failed to browse the marketplace");
  }
  function search(q, filter) {
    return list({ ...filter || {}, q });
  }
  function get(id) {
    return pub("/v1/exchange/offerings/" + enc(id), "No such offering");
  }
  function odps(id) {
    return pub("/v1/exchange/offerings/" + enc(id) + "/odps", "No such offering");
  }
  function odpsYaml(id) {
    return pubText("/v1/exchange/offerings/" + enc(id) + "/odps.yaml", "No such offering");
  }

  // src/static/sdk-libs/exchange/sell.js
  var enc2 = encodeURIComponent;
  function pick(...vals) {
    for (const v of vals) if (v !== void 0 && v !== null) return v;
    return void 0;
  }
  function compact(obj) {
    const out = {};
    for (const k of Object.keys(obj)) if (obj[k] !== void 0) out[k] = obj[k];
    return out;
  }
  function normalizeSpec(spec) {
    const s = (
      /** @type {Record<string, any>} */
      spec || {}
    );
    return compact({
      kind: s.kind,
      // ext-action: the extension + action you own.
      ext: s.ext,
      action: s.action,
      // app-tool: one tool of one of your apps (the node pins its interface version on listing).
      app_id: pick(s.appId, s.app_id),
      tool: s.tool,
      // agent-work: a task type one of your agents performs, settled per delivered task.
      agent_name: pick(s.agentName, s.agent_name),
      task_type: pick(s.taskType, s.task_type),
      price_morsels: pick(s.priceMorsels, s.price_morsels),
      price_money: pick(s.priceMoney, s.price_money),
      plans: s.plans,
      input_schema: pick(s.inputSchema, s.input_schema),
      output_schema: pick(s.outputSchema, s.output_schema),
      // Shared framing.
      title: s.title,
      description: s.description,
      tags: s.tags,
      usage_terms: pick(s.usageTerms, s.usage_terms),
      provenance: s.provenance,
      odps: s.odps
    });
  }
  async function publish(spec) {
    const d = await send("/v1/exchange/offerings", "POST", normalizeSpec(spec), "Failed to list the offering");
    return d.offering;
  }
  async function update(id, patch) {
    const detail = await get(id);
    const o = detail.offering;
    if (o.auto) {
      throw exchangeError({ error: {
        code: "SOURCE_MANAGED",
        message: "This listing is projected from its source (" + o.ext + "/" + o.action + "). Edit the source — the app-tool manifest, the extension action or the agent offer — then call AIMEAT.exchange.reconcile(). Editing the listing here would be undone by the next reconcile."
      } }, "This listing is managed by its source");
    }
    const surface = o.surface || {};
    const base = compact({
      kind: o.kind,
      ext: o.kind === "ext-action" ? o.ext : void 0,
      action: o.kind === "ext-action" ? o.action : void 0,
      appId: surface.kind === "app-tool" ? surface.appId : void 0,
      tool: surface.kind === "app-tool" ? surface.tool : void 0,
      agentName: surface.kind === "agent-work" ? surface.agentName : void 0,
      taskType: surface.kind === "agent-work" ? surface.taskType : void 0,
      priceMorsels: o.kind === "agent-work" && o.unit === "morsels" ? o.basePrice : void 0,
      priceMoney: o.kind === "agent-work" && o.unit === "money" ? { amount: o.basePrice, currency: o.currency } : void 0,
      inputSchema: o.taskSpec ? o.taskSpec.inputSchema : void 0,
      outputSchema: o.taskSpec ? o.taskSpec.outputSchema : void 0,
      title: o.title,
      description: o.description,
      tags: o.tags,
      usageTerms: o.usageTerms,
      provenance: o.provenance,
      odps: o.odps
    });
    const next = await publish({ ...base, ...patch || {} });
    await delist(id).catch(() => {
    });
    return next;
  }
  function delist(id, opts) {
    const query = qs({ force: opts && opts.force ? "1" : null });
    return authed("/v1/exchange/offerings/" + enc2(id) + query, { method: "DELETE" }, "Failed to delist the offering");
  }
  async function stats(id) {
    const d = await pub("/v1/exchange/offerings/" + enc2(id), "No such offering");
    return d.stats;
  }
  function consumers(id) {
    return authed("/v1/exchange/offerings/" + enc2(id) + "/consumers", void 0, "No such offering of yours");
  }
  function reconcile(opts) {
    const o = opts || {};
    return send("/v1/exchange/reconcile", "POST", compact({
      dry_run: o.dryRun,
      migrate: o.migrate,
      app_id: o.appId,
      ext: o.ext,
      agent: o.agent
    }), "Failed to reconcile your listings");
  }
  function providerHistory() {
    return authed("/v1/exchange/provider/history", void 0, "Failed to read your provider history");
  }
  function grants(opts) {
    return authed("/v1/exchange/grants" + qs({ app_id: opts && opts.appId }), void 0, "Failed to read your grants");
  }
  async function grant(spec) {
    const s = (
      /** @type {Record<string, any>} */
      spec || {}
    );
    const d = await send("/v1/exchange/grants", "POST", compact({
      consumer: s.consumer,
      offering_id: pick(s.offeringId, s.offering_id),
      cap_carried_units: pick(s.capCarriedUnits, s.cap_carried_units),
      note: s.note,
      app_id: pick(s.appId, s.app_id),
      reason: s.reason ? { app_id: pick(s.reason.appId, s.reason.app_id), role: s.reason.role } : void 0
    }), "Failed to issue the grant");
    return d.grant;
  }
  function revokeGrant(spec) {
    const s = (
      /** @type {Record<string, any>} */
      spec || {}
    );
    return send("/v1/exchange/grants/revoke", "POST", compact({
      consumer: s.consumer,
      offering_id: pick(s.offeringId, s.offering_id),
      app_id: pick(s.appId, s.app_id),
      role: s.role
    }), "Failed to withdraw the grant");
  }

  // src/static/sdk-libs/exchange/contracts.js
  var enc3 = encodeURIComponent;
  function compact2(obj) {
    const out = {};
    for (const k of Object.keys(obj)) if (obj[k] !== void 0) out[k] = obj[k];
    return out;
  }
  function pick2(...vals) {
    for (const v of vals) if (v !== void 0 && v !== null) return v;
    return void 0;
  }
  function contracts() {
    return authed("/v1/exchange/entitlements", void 0, "Failed to read your contracts");
  }
  async function accept(offeringId, opts) {
    const o = (
      /** @type {Record<string, any>} */
      opts || {}
    );
    const d = await send("/v1/exchange/entitlements", "POST", compact2({
      offering_id: offeringId,
      cap_units: pick2(o.capUnits, o.cap_units),
      app_id: pick2(o.appId, o.app_id),
      plan_id: pick2(o.planId, o.plan_id),
      contract_ref: pick2(o.contractRef, o.contract_ref),
      escrow_party: pick2(o.escrowParty, o.escrow_party)
    }), "Failed to accept the contract");
    return d.entitlement;
  }
  async function coordinateOf(contract) {
    if (typeof contract === "string") {
      const d = await get(contract);
      return { ext: d.offering.ext, action: d.offering.action };
    }
    const c = contract || {};
    const ext = c.ext || c.offering && c.offering.ext;
    const action = c.action || c.offering && c.offering.action;
    if (!ext || !action) {
      throw exchangeError(
        { error: { code: "BAD_REQUEST", message: "Name the contract by its capability coordinate ({ ext, action }), a contract row from contracts(), or an offering id." } },
        "Unresolvable contract reference"
      );
    }
    return { ext, action };
  }
  async function off(contract, opts) {
    const { ext, action } = await coordinateOf(contract);
    return send("/v1/exchange/entitlements/off", "POST", {
      ext,
      action,
      mode: (opts && opts.mode) === "revoke" ? "revoke" : "pause"
    }, "Failed to switch the contract off");
  }
  function history() {
    return authed("/v1/exchange/entitlements/history", void 0, "Failed to read your contract history");
  }
  async function spend() {
    const { entitlements } = await contracts();
    const byUnit = (
      /** @type {Record<string, { spentUnits: number, calls: number, contracts: number }>} */
      {}
    );
    const providers = (
      /** @type {Record<string, any>} */
      {}
    );
    let totalCalls = 0;
    for (const e of entitlements || []) {
      const rail = e.unit === "money" ? e.currency || "EUR" : "morsels";
      const u = byUnit[rail] || (byUnit[rail] = { spentUnits: 0, calls: 0, contracts: 0 });
      u.spentUnits += e.budget ? e.budget.spent_units : 0;
      u.calls += e.budget ? e.budget.calls : 0;
      u.contracts += 1;
      totalCalls += e.budget ? e.budget.calls : 0;
      const key = e.provider + "|" + rail;
      const p = providers[key] || (providers[key] = {
        provider: e.provider,
        unit: rail,
        spentUnits: 0,
        calls: 0,
        contracts: 0,
        capabilities: []
      });
      p.spentUnits += e.budget ? e.budget.spent_units : 0;
      p.calls += e.budget ? e.budget.calls : 0;
      p.contracts += 1;
      if (p.capabilities.indexOf(e.capability) === -1) p.capabilities.push(e.capability);
    }
    const byProvider = Object.keys(providers).map((k) => providers[k]).sort((a, b) => b.spentUnits - a.spentUnits);
    return { byProvider, byUnit, totalCalls, totalContracts: (entitlements || []).length };
  }
  function proposals() {
    return authed("/v1/exchange/proposals", void 0, "Failed to read proposals");
  }
  async function propose(spec) {
    const s = (
      /** @type {Record<string, any>} */
      spec || {}
    );
    const { ext, action } = await coordinateOf(s.contract || { ext: s.ext, action: s.action });
    const d = await send("/v1/exchange/proposals", "POST", compact2({
      ext,
      action,
      consumer_gaii: pick2(s.consumerGaii, s.consumer_gaii),
      new_price_per_call: pick2(s.newPricePerCall, s.new_price_per_call),
      new_cap_units: pick2(s.newCapUnits, s.new_cap_units),
      note: s.note
    }), "Failed to propose new terms");
    return d.proposal;
  }
  function acceptProposal(id) {
    return send("/v1/exchange/proposals/" + enc3(id) + "/accept", "POST", {}, "Failed to accept the proposal");
  }
  function declineProposal(id) {
    return send("/v1/exchange/proposals/" + enc3(id) + "/decline", "POST", {}, "Failed to decline the proposal");
  }
  function withdrawProposal(id) {
    return send("/v1/exchange/proposals/" + enc3(id) + "/withdraw", "POST", {}, "Failed to withdraw the proposal");
  }
  async function startWork(spec) {
    const s = (
      /** @type {Record<string, any>} */
      spec || {}
    );
    const d = await send("/v1/exchange/work", "POST", compact2({
      offering_id: pick2(s.offeringId, s.offering_id),
      input: s.input,
      note: s.note
    }), "Failed to start the work");
    return d.work;
  }
  async function deliverWork(id, spec) {
    const s = (
      /** @type {Record<string, any>} */
      spec || {}
    );
    const d = await send(
      "/v1/exchange/work/" + enc3(id) + "/deliver",
      "POST",
      compact2({ output: s.output, note: s.note }),
      "Failed to deliver the work"
    );
    return d.work;
  }
  function work(opts) {
    return authed("/v1/exchange/work" + qs({ role: opts && opts.role }), void 0, "Failed to read your work items");
  }

  // src/static/sdk-libs/exchange/earnings.js
  function earnings(opts) {
    const o = opts || {};
    return authed(
      "/v1/exchange/earnings" + qs({ status: o.status, currency: o.currency, limit: o.limit }),
      void 0,
      "Failed to read your earnings"
    );
  }

  // src/static/sdk-libs/exchange/demand.js
  var enc4 = encodeURIComponent;
  function compact3(obj) {
    const out = {};
    for (const k of Object.keys(obj)) if (obj[k] !== void 0) out[k] = obj[k];
    return out;
  }
  function pick3(...vals) {
    for (const v of vals) if (v !== void 0 && v !== null) return v;
    return void 0;
  }
  function needs(opts) {
    const o = opts || {};
    const query = qs({ open: o.open ? "1" : null, mine: o.mine ? "1" : null });
    return o.mine ? authed("/v1/exchange/needs" + query, void 0, "Failed to read your needs") : pub("/v1/exchange/needs" + query, "Failed to browse needs");
  }
  function postNeed(spec) {
    const s = (
      /** @type {Record<string, any>} */
      spec || {}
    );
    return send("/v1/exchange/needs", "POST", compact3({
      app_id: pick3(s.appId, s.app_id),
      description: s.description,
      ext: s.ext,
      action: s.action,
      spec: s.spec,
      usage_intent: pick3(s.usageIntent, s.usage_intent),
      budget_unit: pick3(s.budgetUnit, s.budget_unit),
      budget_cap: pick3(s.budgetCap, s.budget_cap),
      autonomy: s.autonomy
    }), "Failed to post the need");
  }
  function closeNeed(id) {
    return send("/v1/exchange/needs/" + enc4(id) + "/close", "POST", {}, "Failed to close the need");
  }
  function bids(needId) {
    return pub("/v1/exchange/needs/" + enc4(needId) + "/bids", "Failed to read bids");
  }
  async function bid(needId, spec) {
    const s = (
      /** @type {Record<string, any>} */
      spec || {}
    );
    const d = await send("/v1/exchange/needs/" + enc4(needId) + "/bids", "POST", compact3({
      ext: s.ext,
      action: s.action,
      offering_id: pick3(s.offeringId, s.offering_id),
      plan_id: pick3(s.planId, s.plan_id),
      note: s.note
    }), "Failed to place the bid");
    return d.bid;
  }
  function acceptBid(needId, bidId, opts) {
    const o = (
      /** @type {Record<string, any>} */
      opts || {}
    );
    return send(
      "/v1/exchange/needs/" + enc4(needId) + "/bids/" + enc4(bidId) + "/accept",
      "POST",
      compact3({ cap_units: pick3(o.capUnits, o.cap_units) }),
      "Failed to accept the bid"
    );
  }

  // src/static/sdk-libs/exchange/format.js
  function commerce() {
    return window.AIMEAT && window.AIMEAT.commerce || null;
  }
  function fmtMorsels(amount) {
    const n = Math.round(Number(amount) || 0);
    return n + (Math.abs(n) === 1 ? " morsel" : " morsels");
  }
  var MORSEL_UNITS = ["morsels", "morsel", "MORSEL", "MORSELS"];
  var MONEY_UNITS = ["money"];
  function fmtUnit(amount, unit, currency) {
    if (unit === void 0 || unit === null || unit === "") {
      const impliedMoney = !!currency && currency !== "morsel" && currency !== "MORSEL";
      return impliedMoney ? money(amount, currency) : fmtMorsels(amount);
    }
    if (MORSEL_UNITS.indexOf(unit) !== -1) return fmtMorsels(amount);
    if (MONEY_UNITS.indexOf(unit) !== -1) return money(amount, currency);
    throw new Error(
      `fmtUnit: unknown unit "${unit}". The signature is fmtUnit(amount, unit, currency), where unit is "money" or "morsels". If "${unit}" is a currency, you want fmtUnit(amount, "money", "${unit}") — passing it as the unit used to render money as morsels, silently and wrongly.`
    );
  }
  function money(amount, currency) {
    const c = commerce();
    if (!c) {
      throw new Error("AIMEAT.commerce is required to format money. Include aimeat-commerce.js before aimeat-exchange.js");
    }
    return c.fmtMoney(amount, currency);
  }

  // src/static/sdk-libs/exchange/odps-completeness.js
  var ODPS_AUTHORED_FIELDS = [
    // ── Framing: what a buyer reads to decide ──
    { key: "title", path: "product.details.name", group: "framing", label: "Title" },
    { key: "description", path: "product.details.description", group: "framing", label: "Description" },
    { key: "odps.valueProposition", path: "product.details.valueProposition", group: "framing", label: "Value proposition" },
    { key: "odps.productType", path: "product.details.type", group: "framing", label: "Product type" },
    { key: "odps.categories", path: "product.details.categories", group: "framing", label: "Categories" },
    { key: "tags", path: "product.details.tags", group: "framing", label: "Tags" },
    { key: "odps.useCases", path: "product.details.useCases", group: "framing", label: "Use cases" },
    { key: "odps.contentSample", path: "product.details.contentSample", group: "framing", label: "Output sample" },
    { key: "odps.outputFileFormats", path: "product.details.outputFileFormats", group: "framing", label: "Output formats" },
    { key: "odps.standards", path: "product.details.standards", group: "framing", label: "Standards followed" },
    { key: "odps.productSeries", path: "product.details.productSeries", group: "framing", label: "Product series" },
    { key: "odps.logoURL", path: "product.details.logoURL", group: "framing", label: "Logo" },
    { key: "odps.brandSlogan", path: "product.details.brandSlogan", group: "framing", label: "Slogan" },
    { key: "odps.recommendedDataProducts", path: "product.details.recommendedDataProducts", group: "framing", label: "Related products" },
    // ── Commitments: promises no observation can substitute for ──
    { key: "odps.sla", path: "product.SLA.declarative", group: "commitments", label: "Service-level commitments" },
    { key: "odps.dataQuality", path: "product.dataQuality.declarative", group: "commitments", label: "Data-quality commitments" },
    // ── Provenance: where the material came from, and on what basis ──
    { key: "provenance.source", path: "product.license.governance.ownership", group: "provenance", label: "Source" },
    { key: "provenance.legalBasis", path: "product.license.governance.applicableLaws", group: "provenance", label: "Legal basis" },
    { key: "provenance.consentStatus", path: "product.license.governance.audit", group: "provenance", label: "Consent status" },
    { key: "provenance.retention", path: "product.license.governance.audit", group: "provenance", label: "Retention" },
    { key: "provenance.transformations", path: "product.details.versionNotes", group: "provenance", label: "Transformations applied" },
    { key: "provenance.snapshotHash", path: "product.dataAccess[].checksum", group: "provenance", label: "Snapshot hash" },
    { key: "provenance.lineage", path: "product.license.governance.ownership", group: "provenance", label: "Upstream lineage" },
    // ── Usage terms: the three flags every AIMEAT listing must state to be listed at all ──
    { key: "usageTerms", path: "product.license.scope.rights", group: "legal", label: "Usage terms" },
    // ── Legal identity + jurisdiction: what a validator reports as missing on an otherwise full listing ──
    { key: "odps.dataHolder.legalName", path: "product.dataHolder.legalName", group: "legal", label: "Legal name" },
    { key: "odps.dataHolder.businessID", path: "product.dataHolder.businessID", group: "legal", label: "Business ID" },
    { key: "odps.dataHolder.URL", path: "product.dataHolder.URL", group: "legal", label: "Company website" },
    { key: "odps.dataHolder.addressCountry", path: "product.dataHolder.addressCountry", group: "legal", label: "Country" },
    { key: "odps.dataHolder.addressLocality", path: "product.dataHolder.addressLocality", group: "legal", label: "City" },
    { key: "odps.license.applicableLaws", path: "product.license.governance.applicableLaws", group: "legal", label: "Applicable law" },
    { key: "odps.license.geographicalArea", path: "product.license.scope.geographicalArea", group: "legal", label: "Geographical area" },
    { key: "odps.license.exclusive", path: "product.license.scope.exclusive", group: "legal", label: "Exclusivity stated" },
    { key: "odps.license.terminationConditions", path: "product.license.termination.terminationConditions", group: "legal", label: "Termination conditions" },
    // ── Support + versioning: what a buyer needs after they have bought ──
    { key: "odps.documentationURL", path: "product.SLA.declarative[].support.documentationURL", group: "support", label: "Documentation" },
    { key: "odps.supportEmail", path: "product.SLA.declarative[].support.email", group: "support", label: "Support email" },
    { key: "odps.supportHours", path: "product.SLA.declarative[].support.emailServiceHours", group: "support", label: "Support hours" },
    { key: "odps.issues", path: "product.details.issues", group: "support", label: "Known issues" },
    { key: "odps.productVersion", path: "product.details.productVersion", group: "support", label: "Product version" },
    // ── Governance + tax: how strictly it is run, and what the price includes ──
    { key: "odps.language", path: "product.details", group: "governance", label: "Content language" },
    { key: "odps.governanceProfile", path: "product.details.governanceProfile", group: "governance", label: "Governance profile" },
    { key: "odps.portfolioPriority", path: "product.details.portfolioPriority", group: "governance", label: "Portfolio priority" },
    { key: "odps.valueAddedTaxIncluded", path: "product.pricingPlans.declarative[].valueAddedTaxIncluded", group: "governance", label: "VAT included" },
    { key: "odps.valueAddedTaxPercentage", path: "product.pricingPlans.declarative[].valueAddedTaxPercentage", group: "governance", label: "VAT percentage" }
  ];
  function valueAt(obj, path) {
    let node = obj;
    for (const part of path.split(".")) {
      if (node === null || node === void 0 || typeof node !== "object") return void 0;
      node = node[part];
    }
    return node;
  }
  function isFilled(v) {
    if (v === void 0 || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }
  function odpsCompleteness(offering) {
    const o = offering && offering.offering ? offering.offering : offering || {};
    const missing = [];
    const present = [];
    const byGroup = (
      /** @type {Record<string, { filled: number, total: number, percent: number }>} */
      {}
    );
    for (const field of ODPS_AUTHORED_FIELDS) {
      const g = byGroup[field.group] || (byGroup[field.group] = { filled: 0, total: 0, percent: 0 });
      g.total += 1;
      if (isFilled(valueAt(o, field.key))) {
        g.filled += 1;
        present.push(field);
      } else {
        missing.push(field);
      }
    }
    for (const k of Object.keys(byGroup)) {
      byGroup[k].percent = Math.round(byGroup[k].filled / byGroup[k].total * 100);
    }
    const total = ODPS_AUTHORED_FIELDS.length;
    return {
      percent: Math.round(present.length / total * 100),
      filled: present.length,
      total,
      missing,
      present,
      byGroup,
      // The version the descriptor follows — stamped by the node onto provenance when the listing is
      // written, so a listing authored before a version bump still says which spec it answers to.
      odpsVersion: o.provenance && o.provenance.odpsVersion || "4.1"
    };
  }

  // src/static/sdk-libs/exchange/index.js
  var exchange = {
    // ── Browsing (public where the route is public) ──
    info,
    list,
    search,
    get,
    odps,
    odpsYaml,
    // ── Selling ──
    publish,
    update,
    delist,
    stats,
    consumers,
    reconcile,
    providerHistory,
    grants,
    grant,
    revokeGrant,
    // ── Buying + contracts ──
    contracts,
    accept,
    off,
    history,
    spend,
    coordinateOf,
    proposals,
    propose,
    acceptProposal,
    declineProposal,
    withdrawProposal,
    startWork,
    deliverWork,
    work,
    // ── Earnings (read-only: the accrual, not a payout) ──
    earnings,
    // ── Demand ──
    needs,
    postNeed,
    closeNeed,
    bids,
    bid,
    acceptBid,
    // ── Helpers ──
    fmtUnit,
    fmtMorsels,
    odpsCompleteness,
    ODPS_AUTHORED_FIELDS
  };
  attach("exchange", exchange);
})();
