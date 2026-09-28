// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/refinery/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-refinery.js (with a per-node config prelude).
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

  // src/static/sdk-libs/refinery/console.js
  var WORDS = {
    en: {
      "refinery.run": "Process the next batch",
      "refinery.idle": "Ready to process",
      "refinery.processing": "Processing",
      "refinery.batch": "In this batch",
      "refinery.empty": "No messages in this batch yet.",
      "refinery.done": "Batch done",
      "refinery.processedN": "{n} messages processed",
      "refinery.none": "No new messages were found.",
      "refinery.failed": "The batch stopped",
      "refinery.step.read": "reading",
      "refinery.step.classify": "classifying",
      "refinery.step.attach": "reading attachments",
      "refinery.step.extract": "extracting fields",
      "refinery.step.save": "saving",
      "refinery.q.selkea": "Clear",
      "refinery.q.epaselva": "Unclear",
      "refinery.q.kelvoton": "Unusable",
      "refinery.q.ohitettu": "Skipped",
      "refinery.q.hyvaksytty": "Approved",
      "refinery.q.lahetetty": "Sent",
      "refinery.q.hylatty": "Rejected"
    },
    fi: {
      "refinery.run": "Käsittele seuraava erä",
      "refinery.idle": "Valmis käsittelemään",
      "refinery.processing": "Käsitellään",
      "refinery.batch": "Tässä erässä",
      "refinery.empty": "Tässä erässä ei ole vielä viestejä.",
      "refinery.done": "Erä valmis",
      "refinery.processedN": "{n} viestiä käsitelty",
      "refinery.none": "Uusia viestejä ei löytynyt.",
      "refinery.failed": "Erä pysähtyi",
      "refinery.step.read": "luetaan",
      "refinery.step.classify": "luokitellaan",
      "refinery.step.attach": "luetaan liitteitä",
      "refinery.step.extract": "poimitaan tietoja",
      "refinery.step.save": "tallennetaan",
      "refinery.q.selkea": "Selkeät",
      "refinery.q.epaselva": "Epäselvät",
      "refinery.q.kelvoton": "Kelvottomat",
      "refinery.q.ohitettu": "Ohitetut",
      "refinery.q.hyvaksytty": "Hyväksytyt",
      "refinery.q.lahetetty": "Lähetetyt",
      "refinery.q.hylatty": "Hylätyt"
    },
    es: {
      "refinery.run": "Procesar el siguiente lote",
      "refinery.idle": "Listo para procesar",
      "refinery.processing": "Procesando",
      "refinery.batch": "En este lote",
      "refinery.empty": "Todavía no hay mensajes en este lote.",
      "refinery.done": "Lote terminado",
      "refinery.processedN": "{n} mensajes procesados",
      "refinery.none": "No se encontraron mensajes nuevos.",
      "refinery.failed": "El lote se detuvo",
      "refinery.step.read": "leyendo",
      "refinery.step.classify": "clasificando",
      "refinery.step.attach": "leyendo adjuntos",
      "refinery.step.extract": "extrayendo datos",
      "refinery.step.save": "guardando",
      "refinery.q.selkea": "Claros",
      "refinery.q.epaselva": "Dudosos",
      "refinery.q.kelvoton": "Inservibles",
      "refinery.q.ohitettu": "Omitidos",
      "refinery.q.hyvaksytty": "Aprobados",
      "refinery.q.lahetetty": "Enviados",
      "refinery.q.hylatty": "Rechazados"
    }
  };
  var wordsAdded = false;
  function addConsoleWords() {
    const ak = (
      /** @type {any} */
      window.AIMEAT && /** @type {any} */
      window.AIMEAT.atelier
    );
    if (wordsAdded || !ak || !ak.i18n) return;
    wordsAdded = true;
    ak.i18n.use(WORDS);
  }
  var STEPS = ["read", "classify", "attach", "extract", "save"];
  var TALLIES = [["clear", "selkea", "ok"], ["unclear", "epaselva", "warn"], ["bad", "kelvoton", "err"], ["skip", "ohitettu", "quiet"]];
  var BADGE_TONE = (
    /** @type {Record<string, string>} */
    { selkea: "ok", epaselva: "warn", kelvoton: "err" }
  );
  function refineryConsole(api, spec) {
    const ak = (
      /** @type {any} */
      window.AIMEAT && /** @type {any} */
      window.AIMEAT.atelier
    );
    if (!ak || !ak.progressFigure) throw new Error("AIMEAT.refinery.console() draws with the atelier kit: load /v1/libs/aimeat-atelier.js before aimeat-refinery.js.");
    addConsoleWords();
    const t = function(k, v) {
      return ak.i18n.t(k, v);
    };
    const classLabel = spec.classLabel || function(k) {
      return k;
    };
    const place = function(x) {
      return !x ? null : typeof x === "string" ? document.querySelector(x) : x;
    };
    const root = place(spec.target);
    if (!root) throw new Error("AIMEAT.refinery.console(): target names no element on the page.");
    const listHost = place(spec.listTarget) || root;
    let busy = false;
    let total = spec.total || 10;
    let tally = { clear: 0, unclear: 0, bad: 0, skip: 0 };
    const counts = function() {
      return TALLIES.map(function(x) {
        return { id: x[0], label: t("refinery.q." + x[1]), value: tally[x[0]] || 0, tone: x[2] };
      });
    };
    const figure = ak.progressFigure({
      target: root,
      label: t("refinery.idle"),
      value: 0,
      total,
      counts: counts(),
      action: { label: t("refinery.run"), onClick: function() {
        return run();
      } }
    });
    const section = ak.section({ target: listHost, title: t("refinery.batch") });
    const list = ak.list({ target: section.body, variant: "plain", items: [], empty: { title: t("refinery.empty") } });
    function paintRows(rows) {
      list.set({ items: rows.map(function(r) {
        return {
          id: r.rowId,
          title: r.subject || "—",
          sub: r.klass && r.klass !== "NONE" && r.klass !== "ERROR" ? classLabel(r.klass) : "",
          badge: t("refinery.q." + r.queue),
          badgeTone: BADGE_TONE[r.queue] || "quiet"
        };
      }) });
    }
    function paint(r) {
      const at = STEPS.indexOf(r.step);
      const working = r.status === "running" && r.n > 0;
      tally = r.counts || tally;
      figure.set({
        label: r.status === "running" ? t("refinery.processing") : t("refinery.idle"),
        value: working ? Math.max(0, r.i - (r.step === "save" ? 0 : 1)) : r.n || 0,
        total: r.n || total,
        now: working && r.subject ? r.subject : "",
        steps: working ? STEPS.map(function(s, i) {
          return { label: t("refinery.step." + s), state: i < at ? "done" : i === at ? "now" : "todo" };
        }) : [],
        counts: counts()
      });
      paintRows(r.rows || []);
    }
    async function refresh() {
      if (busy) return;
      const def = await api.definition(spec.prefix);
      if (!def || !def.organismId) return;
      total = spec.total || def.batchSize || total;
      const got = await api.rows(def, { limit: total });
      paintRows(got.rows.map(function(b) {
        return { rowId: api.rowIdOf(def, b.messageId), subject: b.subject, klass: b.klass, queue: b.queue };
      }));
      figure.set({ total });
    }
    async function run() {
      if (busy) return null;
      busy = true;
      let lastLen = 0;
      try {
        const done = await api.run(spec.prefix, { onProgress: function(r) {
          paint(r);
          if (spec.onRow && r.rows && r.rows.length > lastLen) {
            for (let k = r.rows.length - lastLen - 1; k >= 0; k--) spec.onRow(r.rows[k]);
            lastLen = r.rows.length;
          }
        } });
        busy = false;
        paint(done);
        if (done.status === "failed") {
          const err = new Error(done.error || t("refinery.failed"));
          if (spec.onError) spec.onError(err);
          else ak.toast({ title: t("refinery.failed"), sub: err.message, tone: "err" });
        } else {
          const n = done.counts && done.counts.seen || 0;
          ak.toast({ title: t("refinery.done"), sub: n ? t("refinery.processedN", { n }) : t("refinery.none"), tone: "ok" });
        }
        if (spec.onDone) spec.onDone(done);
        return done;
      } catch (e) {
        busy = false;
        const err = (
          /** @type {Error} */
          e
        );
        if (spec.onError) spec.onError(err);
        else ak.toast({ title: t("refinery.failed"), sub: err.message, tone: "err" });
        return null;
      }
    }
    refresh().catch(function(e) {
      console.warn("[aimeat-refinery] the console could not read the newest rows:", e);
    });
    return {
      el: root,
      run,
      refresh,
      busy: function() {
        return busy;
      },
      destroy: function() {
        figure.destroy();
        section.el.remove();
      }
    };
  }

  // src/static/sdk-libs/refinery/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-refinery.js");
  var QUEUES = ["selkea", "epaselva", "kelvoton", "ohitettu", "hyvaksytty", "lahetetty", "hylatty"];
  var PREFIX_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;
  function refineryError(r, fallback) {
    const err = (
      /** @type {Error & { code?: string }} */
      new Error(r && r.error && r.error.message || fallback)
    );
    err.code = r && r.error && r.error.code || "UNKNOWN";
    return err;
  }
  function checkPrefix(prefix) {
    if (!PREFIX_RE.test(String(prefix || ""))) throw new Error("A refinery prefix is lowercase letters, digits, - or _ (the definition is <prefix>.config).");
  }
  async function call(path, init, fallback) {
    const r = await authFetch2(path, init);
    if (!r || !r.ok) throw refineryError(r, fallback || "The refinery call failed");
    return r.data;
  }
  async function readMemory(key) {
    const r = await authFetch2("/v1/memory/" + encodeURIComponent(key));
    if (r && r.ok) return r.data ? r.data.value : null;
    if (r && r.error && r.error.code === "NOT_FOUND") return null;
    throw refineryError(r, "Could not read " + key);
  }
  async function writeMemory(key, value) {
    return call("/v1/memory", { method: "POST", body: JSON.stringify({ key, value, visibility: "private" }) }, "Could not save " + key);
  }
  function rowsPath(def, which) {
    const space = def.spaces && def.spaces[which] || (which === "items" ? "viesti" : "tapahtuma");
    return "/v1/organisms/" + encodeURIComponent(def.organismId) + "/workspace/rows/" + encodeURIComponent(space) + "?ws=" + encodeURIComponent(def.workspaceId);
  }
  function sleep(ms) {
    return new Promise(function(r) {
      setTimeout(r, ms);
    });
  }
  var refinery = {
    QUEUES,
    /** The row id of a message: the provider and the mailbox's own message id. @param {RefineryDefinition} def @param {string} messageId */
    rowIdOf(def, messageId) {
      return (def.provider || "mail") + ":" + messageId;
    },
    /** The class packs a definition can name: `[{ id, label, process, type, describe, fields }]`. */
    async classes() {
      const d = await call("/v1/refinery/classes", void 0, "Could not read the class packs");
      return d.classes || [];
    },
    /** The definition at `<prefix>.config`, or null when there is none. @param {string} prefix @returns {Promise<RefineryDefinition|null>} */
    async definition(prefix) {
      checkPrefix(prefix);
      return readMemory(prefix + ".config");
    },
    /** Save the definition (private). @param {string} prefix @param {RefineryDefinition} def */
    async saveDefinition(prefix, def) {
      checkPrefix(prefix);
      await writeMemory(prefix + ".config", def);
      return def;
    },
    /**
     * Start one batch; answers at once. `messageIds` runs exactly those messages again.
     * @param {string} prefix
     * @param {{ messageIds?: string[] }} [opts]
     * @returns {Promise<{ run: any, alreadyRunning: boolean }>}
     */
    async start(prefix, opts) {
      checkPrefix(prefix);
      const body = { prefix };
      if (opts && Array.isArray(opts.messageIds) && opts.messageIds.length) body.message_ids = opts.messageIds;
      const d = await call("/v1/refinery/runs", { method: "POST", body: JSON.stringify(body) }, "Could not start the batch");
      return { run: d.run, alreadyRunning: !!d.already_running };
    },
    /** How far a batch is. @param {string} runId */
    async status(runId) {
      const d = await call("/v1/refinery/runs/" + encodeURIComponent(runId), void 0, "Could not read the batch");
      return d.run;
    },
    /**
     * Start a batch and follow it to the end. `onProgress(run)` is called on every change; the answer
     * is the finished run, `status` 'done' or 'failed' (with `error`). A batch already running is
     * followed instead of a second one started.
     * @param {string} prefix
     * @param {{ messageIds?: string[], onProgress?: (run: any) => void, every?: number }} [opts]
     */
    async run(prefix, opts) {
      const o = opts || {};
      const started = await refinery.start(prefix, o);
      let run = started.run;
      let seen = "";
      for (; ; ) {
        const mark = run.status + "|" + run.i + "|" + run.step + "|" + run.rows.length;
        if (mark !== seen && o.onProgress) {
          seen = mark;
          o.onProgress(run);
        }
        if (run.status !== "running") return run;
        await sleep(o.every || 700);
        run = await refinery.status(run.id);
      }
    },
    /**
     * The rows of one queue (or all), newest first: the row bodies and a cursor for more.
     * @param {RefineryDefinition} def
     * @param {{ queue?: string, limit?: number, order?: 'asc'|'desc', cursor?: string }} [opts]
     * @returns {Promise<{ rows: any[], cursor: string|null }>}
     */
    async rows(def, opts) {
      const o = opts || {};
      let url = rowsPath(def, "items") + "&limit=" + (o.limit || 100) + "&order=" + (o.order || "desc");
      if (o.queue) url += "&queue=" + encodeURIComponent(o.queue);
      if (o.cursor) url += "&cursor=" + encodeURIComponent(o.cursor);
      const d = await call(url, void 0, "Could not read the rows");
      return { rows: (d.rows || []).map(function(r) {
        return r.body;
      }), cursor: d.cursor || null };
    },
    /**
     * How many rows each queue holds, a hundred counted at most (then '100+').
     * @param {RefineryDefinition} def
     * @returns {Promise<Record<string, number|string>>}
     */
    async counts(def) {
      const out = {};
      await Promise.all(QUEUES.map(async function(q) {
        const r = await refinery.rows(def, { queue: q, limit: 100 });
        out[q] = r.rows.length >= 100 ? "100+" : r.rows.length;
      }));
      return out;
    },
    /** The log rows, newest first. @param {RefineryDefinition} def @param {{ limit?: number }} [opts] */
    async log(def, opts) {
      const d = await call(rowsPath(def, "events") + "&limit=" + (opts && opts.limit || 100) + "&order=desc", void 0, "Could not read the log");
      return (d.rows || []).map(function(r) {
        return Object.assign({ rowId: r.rowId }, r.body || {});
      });
    },
    /** The last fifty batches, newest first. @param {string} prefix */
    async runs(prefix) {
      checkPrefix(prefix);
      const v = await readMemory(prefix + ".runs");
      return Array.isArray(v) ? v : [];
    },
    /** Start again from the definition's first day: the next batch reads from the top. @param {string} prefix */
    async restart(prefix) {
      checkPrefix(prefix);
      const r = await authFetch2("/v1/memory/" + encodeURIComponent(prefix + ".cursor"), { method: "DELETE" });
      if (r && !r.ok && !(r.error && r.error.code === "NOT_FOUND")) throw refineryError(r, "Could not reset the place in the mailbox");
    },
    /**
     * Put a row in another queue, and write why in the log. `kind` is the log's word (approved,
     * sent, rejected, moved); `actor` defaults to the person.
     * @param {RefineryDefinition} def
     * @param {any} row
     * @param {string} queue
     * @param {{ kind?: string, detail?: any, actor?: string }} [opts]
     */
    async move(def, row, queue, opts) {
      if (QUEUES.indexOf(queue) < 0) throw new Error("Unknown queue " + queue + ". The queues are " + QUEUES.join(", ") + ".");
      const o = opts || {};
      return refinery.update(
        def,
        row,
        { queue, status: queue },
        { kind: o.kind || "moved", actor: o.actor, detail: Object.assign({ from: row.queue, to: queue }, o.detail || {}) }
      );
    },
    /**
     * Change a row (a field a person corrected, a note) and write why in the log. The row keeps its
     * id, so the change replaces it.
     * @param {RefineryDefinition} def
     * @param {any} row
     * @param {Record<string, any>} patch
     * @param {{ kind?: string, detail?: any, actor?: string }} [opts]
     */
    async update(def, row, patch, opts) {
      const o = opts || {};
      const next = Object.assign({}, row, patch, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      const rowId = refinery.rowIdOf(def, row.messageId);
      await call(rowsPath(def, "items"), { method: "POST", body: JSON.stringify({ body: next, row_id: rowId, occurred_at: row.date || void 0 }) }, "Could not save the row");
      const logged = await authFetch2(rowsPath(def, "events"), { method: "POST", body: JSON.stringify({ body: {
        app: def.app || "",
        kind: o.kind || "edited",
        message: rowId,
        subject: row.subject || "",
        actor: o.actor || "person",
        at: (/* @__PURE__ */ new Date()).toISOString(),
        detail: o.detail || {}
      } }) });
      if (!logged || !logged.ok) console.warn("[aimeat-refinery] the log row was not written:", logged && logged.error);
      return next;
    },
    /**
     * Teach the refinery: this sender (scope 'from'), this domain ('domain') or this message
     * ('message') is of kind `klass`. The rule goes into the definition and answers before the model
     * from now on; the message is then run again. Records the person's override on the decision
     * when aimeat-decide.js is on the page.
     * @param {string} prefix
     * @param {any} row
     * @param {string} klass
     * @param {'from'|'domain'|'message'} [scope]
     */
    async teach(prefix, row, klass, scope) {
      const def = await refinery.definition(prefix);
      if (!def) throw new Error("There is no refinery definition at " + prefix + ".config.");
      const how = scope || "domain";
      const m = /<([^>]+)>/.exec(row.from || "");
      const addr = (m ? m[1] : String(row.from || "")).trim().toLowerCase();
      const value = how === "from" ? addr : how === "domain" ? addr.split("@")[1] || "" : row.messageId;
      if (!value) throw new Error("This message has no sender to learn from; teach it by message instead.");
      def.rules = (def.rules || []).filter(function(r) {
        return !(r.match === how && r.value === value);
      });
      def.rules.unshift({ match: how, value, klass, at: (/* @__PURE__ */ new Date()).toISOString() });
      await refinery.saveDefinition(prefix, def);
      const decide = (
        /** @type {any} */
        window.AIMEAT && /** @type {any} */
        window.AIMEAT.decide
      );
      if (row.decisionId && decide && decide.review) {
        try {
          await decide.review(row.decisionId, "overridden", { override: klass });
        } catch (e) {
          console.warn("[aimeat-refinery] the decision review was not recorded:", e);
        }
      }
      return refinery.run(prefix, { messageIds: [row.messageId] });
    },
    /**
     * Put the refinery on the node's clock: one batch each time `cron` fires, also when the page is
     * closed. Needs connections:read-through, ai:use, organism:rows and memory:write.
     * @param {string} prefix
     * @param {{ cron: string, timezone?: string, name?: string }} spec
     */
    async schedule(prefix, spec) {
      checkPrefix(prefix);
      const d = await call("/v1/schedules", { method: "POST", body: JSON.stringify({
        kind: "refinery",
        cron: spec.cron,
        timezone: spec.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        display_name: spec.name || "Refinery " + prefix,
        input: { prefix }
      }) }, "Could not create the schedule");
      return d.schedule;
    },
    /** This definition's schedules. Reading them needs the workflow:read scope. @param {string} prefix */
    async schedules(prefix) {
      const d = await call("/v1/schedules", void 0, "Could not read the schedules");
      const list = Array.isArray(d.schedules) ? d.schedules : Array.isArray(d.managed) ? d.managed : [];
      return list.filter(function(s) {
        return s.type === "refinery" && s.input && s.input.prefix === prefix;
      });
    },
    /** Take a schedule off the clock. @param {string} id */
    async unschedule(id) {
      await call("/v1/schedules/" + encodeURIComponent(id), { method: "DELETE" }, "Could not remove the schedule");
    },
    /**
     * The workbench console: the batch figure with its button, the steps and tallies, and the rows
     * of the batch as they land. Built from the atelier kit's parts (aimeat-atelier.js on the page).
     * @param {{ target: string|Element, prefix: string, total?: number, classLabel?: (klass: string) => string,
     *   onRow?: (row: any) => void, onDone?: (run: any) => void, onError?: (err: Error) => void }} spec
     */
    console(spec) {
      return refineryConsole(refinery, spec);
    }
  };
  attach("refinery", refinery);
  addConsoleWords();
  var index_default = refinery;
})();
