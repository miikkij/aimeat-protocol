// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/datapackage/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-datapackage.js (with a per-node config prelude).
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

  // src/static/sdk-libs/datapackage/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-datapackage.js");
  async function call(path, opts) {
    const body = await authFetch2(path, opts);
    if (!body || body.ok === false || body.error) {
      const err = body && body.error || { code: "REQUEST_FAILED", message: "The request did not answer." };
      const e = new Error(err.message || "Request failed");
      e.code = err.code;
      e.issues = err.details && err.details.issues || [];
      throw e;
    }
    return body.data !== void 0 ? body.data : body;
  }
  var DataPackageBuilder = class {
    constructor(meta) {
      this._meta = meta || {};
      this._resources = [];
      this._changes = "";
      this._provenance = {};
    }
    /**
     * Add one tabular resource.
     *
     * `opts.schema` omitted means INFER, and inference is a PROPOSAL: the published descriptor records
     * `schemaSource: 'inferred'`, so a consumer can see that nobody confirmed the types. Call
     * inferSchema() first, show the result to the person publishing, and pass the corrected schema
     * here to publish as `declared`.
     */
    addResource(name, rows, opts) {
      const o = opts || {};
      this._resources.push({
        name,
        rows: rows || [],
        ...o.schema ? { schema: o.schema } : {},
        ...o.title ? { title: o.title } : {},
        ...o.description ? { description: o.description } : {}
      });
      return this;
    }
    /** REQUIRED before publish: what moved against the previous version and why. */
    changes(text) {
      this._changes = String(text || "");
      return this;
    }
    /** Origin, legal basis and licence. The owner is responsible for what they publish; this is where
     *  they say where it came from and on what terms. */
    provenance(block) {
      this._provenance = Object.assign({}, this._provenance, block || {});
      return this;
    }
    /** How many old versions to keep, by count or by months. */
    retention(policy) {
      this._retentionPolicy = policy;
      return this;
    }
    /** What the producer was asked for — the window, the keywords. Travels in the descriptor. */
    parameters(params) {
      this._parameters = params;
      return this;
    }
    /** Run the quality gate WITHOUT publishing. Answers `{ ok, issues, schemas }`; `issues` name the
     *  resource, the row and the field, which is what lets a page highlight the cell. */
    validate() {
      return call("/v1/datapackages/validate", {
        method: "POST",
        body: JSON.stringify({ resources: this._resources })
      });
    }
    /**
     * Publish one version. THROWS when the gate refuses, with `.code === 'QUALITY_GATE'` and `.issues`
     * carrying the coordinates — nothing was written, and the package stands on its previous version.
     *
     * `unchanged: true` in the answer means these exact bytes were already published: the address
     * already holds them, and no new version was created. Say "no change" rather than "updated".
     */
    publish() {
      return call("/v1/datapackages", {
        method: "POST",
        body: JSON.stringify(Object.assign({}, this._meta, {
          changes: this._changes,
          resources: this._resources,
          provenance: this._provenance,
          ...this._parameters ? { parameters: this._parameters } : {},
          ...this._retentionPolicy ? { retentionPolicy: this._retentionPolicy } : {}
        }))
      });
    }
  };
  var stripBom = (s) => s.charCodeAt(0) === 65279 ? s.slice(1) : s;
  function parseTable(text) {
    const raw = stripBom(String(text || "")).trim();
    if (!raw) return [];
    if (raw[0] === "[" || raw[0] === "{") {
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
        throw new Error("A JSON table must be an array of objects, one per row.");
      }
      return rows;
    }
    const head = raw.split(/\r?\n/)[0];
    const counts = [{ ch: ",", n: 0 }, { ch: ";", n: 0 }, { ch: "	", n: 0 }];
    let q = false;
    for (const ch of head) {
      if (ch === '"') q = !q;
      else if (!q) {
        for (const c of counts) if (ch === c.ch) c.n++;
      }
    }
    counts.sort((a, b) => b.n - a.n);
    const delim = counts[0].n > 0 ? counts[0].ch : ",";
    const records = [];
    let field = "";
    let record = [];
    let inQuotes = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inQuotes) {
        if (ch === '"') {
          if (raw[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      if (ch === delim) {
        record.push(field);
        field = "";
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && raw[i + 1] === "\n") i++;
        record.push(field);
        field = "";
        records.push(record);
        record = [];
        continue;
      }
      field += ch;
    }
    if (field !== "" || record.length) {
      record.push(field);
      records.push(record);
    }
    if (!records.length) return [];
    const header = records[0].map((h, i) => h.trim() || `column_${i + 1}`);
    return records.slice(1).filter((r) => r.length > 1 || (r[0] ?? "") !== "").map((r) => {
      const row = {};
      for (let c = 0; c < header.length; c++) row[header[c]] = (r[c] ?? "") === "" ? null : r[c];
      return row;
    });
  }
  var datapackage = {
    /** Start a package. `meta` is `{ name, title?, description? }`; the name is an address segment. */
    create(meta) {
      return new DataPackageBuilder(meta);
    },
    /** CSV / TSV / semicolon / JSON text → rows. See parseTable above for why it is lenient. */
    parseTable(text) {
      return parseTable(text);
    },
    /** The type proposal for a set of rows, without publishing anything. Show it to the publisher. */
    inferSchema(rows) {
      return call("/v1/datapackages/validate", {
        method: "POST",
        body: JSON.stringify({ resources: [{ name: "preview", rows: rows || [] }] })
      }).then((d) => d.schemas.preview);
    },
    /** One-shot publish for a caller that has everything already. Same refusal behaviour as the builder. */
    publish(input) {
      return call("/v1/datapackages", {
        method: "POST",
        body: JSON.stringify(input || {})
      });
    },
    /** The caller's own packages, newest version each, with `lastError` when the last run failed. */
    list() {
      return call("/v1/datapackages", { method: "GET" });
    },
    /**
     * Every version of one package, newest first: `{ contentHash, at, current, changes, rowCount,
     * bytes, descriptorUrl, supersedes }`.
     *
     * `changes` is why this is worth showing rather than a list of hashes — it is the sentence the
     * producer had to write to publish at all. Pin any of them by passing
     * `pkg:owner/name@<contentHash>` to open() or rows().
     */
    versions(ref) {
      const p = parseRef(ref);
      if (!p) return Promise.reject(new Error('versions() needs a reference like "pkg:owner/name"'));
      return call(
        "/v1/datapackages/" + encodeURIComponent(p.owner) + "/" + encodeURIComponent(p.name) + "/versions",
        { method: "GET" }
      );
    },
    /** A descriptor. `ref` is `pkg:owner/name`, optionally `@sha256:…` to pin a version. */
    open(ref) {
      const p = parseRef(ref);
      if (!p) return Promise.reject(new Error('open() needs a reference like "pkg:owner/name" or "pkg:owner/name@sha256:…"'));
      const q = p.version ? "?version=" + encodeURIComponent(p.version) : "";
      return call("/v1/datapackages/" + encodeURIComponent(p.owner) + "/" + encodeURIComponent(p.name) + q, { method: "GET" });
    },
    /** A window of rows, for a preview table. For the whole thing use the CSV address — it is
     *  permanent, needs no session and answers byte ranges. */
    rows(ref, resource, opts) {
      const p = parseRef(ref);
      if (!p) return Promise.reject(new Error('rows() needs a reference like "pkg:owner/name"'));
      const o = opts || {};
      const qs = [];
      if (p.version) qs.push("version=" + encodeURIComponent(p.version));
      if (o.offset != null) qs.push("offset=" + encodeURIComponent(o.offset));
      if (o.limit != null) qs.push("limit=" + encodeURIComponent(o.limit));
      if (o.select && o.select.length) qs.push("select=" + encodeURIComponent(o.select.join(",")));
      const q = qs.length ? "?" + qs.join("&") : "";
      return call("/v1/datapackages/" + encodeURIComponent(p.owner) + "/" + encodeURIComponent(p.name) + "/rows/" + encodeURIComponent(resource) + q, { method: "GET" });
    },
    /**
     * The permanent, session-free address of one resource's CSV — what you hand to DuckDB, pandas,
     * Google Sheets IMPORTDATA or a person with a download button.
     *
     * Derived from the descriptor rather than assembled from parts, because the descriptor's
     * `resources[].path` is the authority on where a resource lives and a hand-built URL would be a
     * second opinion about it.
     */
    urlFor(descriptorResponse, resource) {
      const d = descriptorResponse && (descriptorResponse.descriptor || descriptorResponse);
      if (!d || !d.resources) return null;
      const r = d.resources.find((x) => x.name === resource);
      const base = descriptorResponse && descriptorResponse.descriptor_url;
      if (!r || !base) return null;
      return base.replace(/datapackage\.json$/, "") + r.path.split("/").map(encodeURIComponent).join("/");
    },
    /**
     * Turn a resource into a file the person can keep. CSV is handed over as its permanent URL — no
     * download, no copy, the address IS the file. JSON is derived in the browser from a row read.
     *
     * There is no XLSX here yet, and it is left out rather than half-done: a spreadsheet writer is a
     * vendored dependency this node does not carry, and emitting a CSV named .xlsx would be exactly
     * the covering fallback this whole format exists to avoid.
     */
    async exportAs(ref, resource, format) {
      const fmt = String(format || "csv").toLowerCase();
      const opened = await this.open(ref);
      if (fmt === "csv") return { url: this.urlFor(opened, resource), format: "csv" };
      if (fmt === "json") {
        const all = [];
        let offset = 0;
        for (; ; ) {
          const page = await this.rows(ref, resource, { offset, limit: 5e3 });
          all.push.apply(all, page.rows);
          offset += page.rows.length;
          if (offset >= page.total || page.rows.length === 0) break;
        }
        const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
        return { url: URL.createObjectURL(blob), format: "json", rows: all.length };
      }
      throw new Error('exportAs supports "csv" (the permanent URL) and "json". XLSX needs a spreadsheet writer this node does not vendor yet, and a CSV named .xlsx would be a lie.');
    }
  };
  function parseRef(ref) {
    const m = /^pkg:([^/@]+)\/([^@]+)(?:@(sha256:[a-f0-9]{64}))?$/.exec(String(ref || "").trim());
    return m ? { owner: m[1], name: m[2], version: m[3] || null } : null;
  }
  attach("datapackage", datapackage);
})();
