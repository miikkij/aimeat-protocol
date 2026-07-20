// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/organism/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-organism.js (with a per-node config prelude).
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

  // src/static/sdk-libs/organism/index.js
  function getSession() {
    if (!window.AIMEAT || !window.AIMEAT.auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before aimeat-organism.js");
    }
    var s = window.AIMEAT.auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  async function authFetch(path, opts) {
    var res = await getSession().fetch(path, opts);
    if (res && typeof res.json === "function") res = await res.json();
    return res;
  }
  function fail(res, fallback) {
    var e = (
      /** @type {Error & { code?: string, envelope?: unknown }} */
      new Error(res && res.error && (res.error.message || res.error.code) || fallback)
    );
    e.code = res && res.error && res.error.code;
    e.envelope = res;
    return e;
  }
  var TITLE_FIELDS = ["title", "name", "subject", "label"];
  var BODY_FIELDS = ["content", "body", "markdown", "text", "md", "description", "summary"];
  function pickField(obj, names) {
    if (!obj || typeof obj !== "object") return null;
    for (var i = 0; i < names.length; i++) if (typeof obj[names[i]] === "string") return names[i];
    return null;
  }
  function isMetaField(k) {
    return typeof k === "string" && k.charAt(0) === "_";
  }
  function stripMeta(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    var out = {};
    Object.keys(v).forEach(function(k) {
      if (!isMetaField(k)) out[k] = v[k];
    });
    return out;
  }
  function slugify(s) {
    return String(s || "untitled").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "untitled";
  }
  function titleOf(value, fallbackId) {
    var v = value || {};
    var f = pickField(v, TITLE_FIELDS);
    if (f && v[f]) return v[f];
    if (typeof v.id === "string" && v.id) return v.id;
    var bf = pickField(v, BODY_FIELDS);
    if (bf && typeof v[bf] === "string" && v[bf]) return String(v[bf]).replace(/\s+/g, " ").slice(0, 48);
    return fallbackId || "Untitled";
  }
  function bodyFieldOf(value) {
    return pickField(value, BODY_FIELDS);
  }
  function isDocLike(value) {
    var bf = bodyFieldOf(value);
    if (!bf || !value || typeof value[bf] !== "string") return false;
    return bf === "markdown" || bf === "content" || value[bf].length > 120 || /\n/.test(value[bf]);
  }
  function valueUpdatedAt(v) {
    if (v && typeof v === "object" && (v._updatedAt || v._createdAt)) {
      var t = new Date(v._updatedAt || v._createdAt).getTime();
      return isNaN(t) ? 0 : t;
    }
    return 0;
  }
  function wsRoot(orgId, wsId) {
    return "organism." + orgId + (wsId ? ".w." + wsId : "");
  }
  function draftKey(orgId, wsId, namespace2, id) {
    return wsRoot(orgId, wsId) + "." + namespace2 + "." + id + ".draft";
  }
  function normalizeWorkspace(data) {
    var manifest = data && data.manifest || null;
    var otList = manifest && (manifest.objectTypes || manifest.object_types || manifest.types) || [];
    if (!Array.isArray(otList) && otList && typeof otList === "object") {
      otList = Object.keys(otList).map(function(k) {
        var o = otList[k];
        o = o && typeof o === "object" ? o : {};
        if (!o.name) o.name = k;
        return o;
      });
    }
    var byName = {};
    otList.forEach(function(ot) {
      var n = ot.name || ot.id || ot.type;
      if (n) byName[n] = ot;
    });
    var objects = data && data.objects || {};
    var draftsMap = data && data.drafts || {};
    var typeNames = [];
    otList.forEach(function(ot) {
      var n = ot.name || ot.id || ot.type;
      if (n && typeNames.indexOf(n) < 0) typeNames.push(n);
    });
    Object.keys(objects).forEach(function(n) {
      if (typeNames.indexOf(n) < 0) typeNames.push(n);
    });
    Object.keys(draftsMap).forEach(function(n) {
      if (typeNames.indexOf(n) < 0) typeNames.push(n);
    });
    return typeNames.map(function(typeName) {
      var ot = byName[typeName] || {};
      var instances = {};
      var order = [];
      var seq = 0;
      function instIdOf(v) {
        if (v && typeof v === "object" && typeof v.id === "string" && v.id) return { id: v.id, real: true };
        if (v && typeof v === "object") {
          var tf = pickField(v, TITLE_FIELDS);
          if (tf && v[tf]) return { id: "t-" + slugify(v[tf]), real: false };
        }
        return { id: "item-" + seq++, real: false };
      }
      function add(v, slot) {
        if (v == null) return;
        var m = instIdOf(v);
        if (!instances[m.id]) {
          instances[m.id] = { id: m.id, hasRealId: m.real, draft: null, latest: null };
          order.push(m.id);
        }
        if (slot === "draft") instances[m.id].draft = v;
        else instances[m.id].latest = instances[m.id].latest || v;
      }
      var pub = objects[typeName] || [];
      if (!Array.isArray(pub)) pub = [pub];
      pub.forEach(function(v) {
        add(v, "latest");
      });
      var dr = draftsMap[typeName] || [];
      if (!Array.isArray(dr)) dr = [dr];
      dr.forEach(function(v) {
        add(v, "draft");
      });
      var items = order.map(function(id) {
        var inst = instances[id];
        var best = inst.draft || inst.latest;
        inst.value = best;
        inst.title = titleOf(best, id);
        inst.updatedAt = Math.max(valueUpdatedAt(inst.draft), valueUpdatedAt(inst.latest));
        inst.status = inst.draft && inst.latest ? "draft+published" : inst.draft ? "draft" : "published";
        return inst;
      });
      return {
        name: typeName,
        namespace: ot.namespace || ot.ns || typeName,
        kind: ot.kind || ot.type || null,
        schemaRef: ot.schemaRef || null,
        writeRole: ot.writeRole || null,
        items
      };
    });
  }
  function readmeText(readme) {
    if (readme == null) return "";
    if (typeof readme === "string") return readme;
    if (typeof readme === "object") return readme.content || readme.text || readme.markdown || JSON.stringify(readme, null, 2);
    return String(readme);
  }
  var organism = {
    // List organisms the signed-in owner is a member of.
    async list() {
      var s = getSession();
      var owner = s.owner || s.user && s.user.owner || "";
      var res;
      try {
        res = await authFetch("/v1/organisms?member=" + encodeURIComponent(owner) + "&per_page=100");
      } catch {
        res = null;
      }
      if (!res || res.ok === false) res = await authFetch("/v1/organisms");
      if (res.ok === false) throw fail(res, "Failed to list organisms");
      var d = res.data !== void 0 ? res.data : res;
      return d && (d.organisms || d.items) || (Array.isArray(d) ? d : []);
    },
    async get(orgId) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId));
      if (res.ok === false) throw fail(res, "Failed to load organism");
      return res.data !== void 0 ? res.data : res;
    },
    // Create a NEW organism (the signed-in owner becomes creator/member). Needs the organism:write app
    // scope (declare it in <meta name="aimeat-scopes">). Returns { id, name, ... }. Use this + createWorkspace
    // to let a multi-tenant app provision its own data space for each user on first use.
    async create(name, opts) {
      opts = opts || {};
      var res = await authFetch("/v1/organisms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: opts.type || "project",
          visibility: opts.visibility || "private",
          join_policy: opts.join_policy || "invite_only",
          description: opts.description
        })
      });
      if (res.ok === false) throw fail(res, "Failed to create organism");
      var d = res.data !== void 0 ? res.data : res;
      return d && d.organism ? d.organism : d;
    },
    // Create a NEW schema-locked workspace inside an organism from a manifest + per-namespace JSON schemas.
    // manifest = { manifestVersion:'1', name, kind, objectTypes:[{ name, namespace, mode:'records',
    // backing:'memory', writeRole:'member', schemaRef? }] }; schemas = { '<namespace>': <JSON Schema> }.
    // Needs organism:write. Returns { ws, types, schemas_locked }.
    async createWorkspace(orgId, name, manifest, schemas, readme) {
      var m = manifest && typeof manifest === "object" ? JSON.parse(JSON.stringify(manifest)) : manifest;
      var sc = schemas && typeof schemas === "object" ? Object.assign({}, schemas) : {};
      if (m && Array.isArray(m.objectTypes)) {
        for (var oi = 0; oi < m.objectTypes.length; oi++) {
          var ot = m.objectTypes[oi];
          if (ot && !ot.schemaRef) {
            var slug = String(ot.name || "type" + oi).replace(/[^a-zA-Z0-9_-]/g, "-");
            ot.schemaRef = "schema:" + name + "-" + slug + "@1";
          }
          if (ot && ot.namespace && sc[ot.namespace] === void 0 && (ot.mode || "records") === "records") {
            sc[ot.namespace] = { type: "object", additionalProperties: true };
          }
        }
      }
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, manifest: m, schemas: sc, readme })
      });
      if (res.ok === false) throw fail(res, "Failed to create workspace");
      return res.data !== void 0 ? res.data : res;
    },
    // List workspaces (access + enrichment counts included).
    async workspaces(orgId) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspaces?include=enrichment");
      if (res.ok === false) throw fail(res, "Failed to list workspaces");
      var d = res.data !== void 0 ? res.data : res;
      return d && (d.workspaces || d.items) || (Array.isArray(d) ? d : []);
    },
    // Read one workspace, normalized: { manifest, readme, readmeText, spaces, raw }.
    // spaces[].items[]: { id, hasRealId, draft, latest, value, title, updatedAt, status }.
    async read(orgId, wsId) {
      var q = wsId ? "?ws=" + encodeURIComponent(wsId) : "";
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace" + q);
      if (res.ok === false) throw fail(res, "Failed to read workspace");
      var d = res.data !== void 0 ? res.data : res;
      return {
        manifest: d && d.manifest || null,
        readme: d && d.readme || null,
        readmeText: readmeText(d && d.readme),
        spaces: normalizeWorkspace(d),
        raw: d
      };
    },
    // Write/overwrite an object's draft. Embeds the instance id into the value (SPA convention)
    // unless opts.embedId === false (needed for locked schemas that reject an id property).
    async writeDraft(orgId, wsId, namespace2, id, value, opts) {
      opts = opts || {};
      var v = stripMeta(value);
      if (opts.embedId !== false && v && typeof v === "object" && !Array.isArray(v)) {
        v = Object.assign({}, v, { id });
      }
      var body = (
        /** @type {Record<string, any>} */
        { key: draftKey(orgId, wsId, namespace2, id), value: v, visibility: opts.visibility || "private" }
      );
      if (opts.group_id) body.group_id = opts.group_id;
      if (Array.isArray(opts.tags) && opts.tags.length) body.tags = opts.tags;
      var res = await authFetch("/v1/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok === false) throw fail(res, "Failed to save draft");
      return res.data !== void 0 ? res.data : res;
    },
    // Publish a draft -> new .version.N + .latest (or a pending approval when the workspace gates publishes).
    async publish(orgId, wsId, namespace2, id) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: wsId || void 0, namespace: namespace2, id })
      });
      if (res.ok === false) throw fail(res, "Failed to publish");
      return res.data !== void 0 ? res.data : res;
    },
    // BULK publish MANY records in ONE request (data-access redesign). Two shapes:
    //   • ids: ['id', ...]                → publish each record's existing DRAFT (the edit → publish flow)
    //   • records: [{ id, value }, ...]   → DRAFT-LESS: publish the supplied values directly (imports —
    //     one request for a whole CSV migration, no per-record draft write). optional expectedVersions.
    // Replaces a loop of publish() (each a server-side scan + 2 writes + draft delete). Returns
    // { published, skipped, failed, results }. create_only 409s; a publish review gate refuses the batch.
    async publishRecords(orgId, wsId, namespace2, idsOrRecords, expectedVersions) {
      var body = (
        /** @type {Record<string, any>} */
        { ws: wsId || void 0, namespace: namespace2 }
      );
      var arr = idsOrRecords || [];
      if (arr.length && typeof arr[0] === "object") body.records = arr;
      else body.instances = arr;
      if (expectedVersions && typeof expectedVersions === "object") body.expected_versions = expectedVersions;
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace/records/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok === false) throw fail(res, "Failed to publish records");
      return res.data !== void 0 ? res.data : res;
    },
    // BULK delete MANY record families in ONE request (data-access redesign) — ids: [id,...]. Removes each
    // record's bare/.draft/.latest/.version.N owned by the caller's own identity in one batched call
    // (needs memory:delete scope). Replaces a loop of deleteObject() (a scan + per-key delete each).
    // Returns { deleted:[{id,keys}], failed:[{id,reason}], rows_removed }.
    async deleteRecords(orgId, wsId, namespace2, ids) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace/records/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: wsId || void 0, namespace: namespace2, ids: ids || [] })
      });
      if (res.ok === false) throw fail(res, "Failed to delete records");
      return res.data !== void 0 ? res.data : res;
    },
    // Reopen a published record for editing (server copies .latest -> .draft; 409 if a draft exists).
    async revertToDraft(orgId, wsId, namespace2, id) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: wsId || void 0, namespace: namespace2, id })
      });
      if (res.ok === false) throw fail(res, "Failed to revert to draft");
      return res.data !== void 0 ? res.data : res;
    },
    // Delete one object: bare key + .draft + .latest + all .version.N history (re-run for huge
    // histories). NOTE: needs the memory:delete scope — app-grant tokens don't get it by default,
    // declare it via <meta name="aimeat-scopes" content="memory:read memory:write memory:delete">.
    async deleteObject(orgId, wsId, namespace2, id) {
      var base = wsRoot(orgId, wsId) + "." + namespace2 + "." + id;
      var res = await authFetch("/v1/memory?prefix=" + encodeURIComponent(base) + "&limit=200");
      if (res.ok === false) throw fail(res, "Failed to list object keys");
      var items = res.data && res.data.items || [];
      var deleted = 0, attempted = 0, lastErr = null;
      for (var i = 0; i < items.length; i++) {
        var key = items[i].key;
        if (key !== base && key.indexOf(base + ".") !== 0) continue;
        attempted++;
        var dres = await authFetch("/v1/memory/" + encodeURIComponent(key), { method: "DELETE" });
        if (dres.ok !== false) deleted++;
        else lastErr = dres;
      }
      if (attempted > 0 && deleted === 0 && lastErr) throw fail(lastErr, "Failed to delete object keys");
      return { deleted, attempted };
    },
    // Save the workspace README (creator/org-admin only — the server enforces it).
    async saveReadme(orgId, wsId, readme) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace?ws=" + encodeURIComponent(wsId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readme })
      });
      if (res.ok === false) throw fail(res, "Failed to save README");
      return res.data !== void 0 ? res.data : res;
    },
    // Organism-wide server-side search.
    async search(orgId, q) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/search?q=" + encodeURIComponent(q));
      if (res.ok === false) throw fail(res, "Search failed");
      var d = res.data !== void 0 ? res.data : res;
      return d && (d.results || d.hits || d.items) || (Array.isArray(d) ? d : []);
    },
    util: {
      stripMeta,
      isMetaField,
      titleOf,
      bodyFieldOf,
      isDocLike,
      updatedAt: valueUpdatedAt,
      wsRoot,
      draftKey,
      normalizeWorkspace,
      readmeText,
      TITLE_FIELDS: TITLE_FIELDS.slice(),
      BODY_FIELDS: BODY_FIELDS.slice()
    }
  };
  attach("organism", organism);
})();
