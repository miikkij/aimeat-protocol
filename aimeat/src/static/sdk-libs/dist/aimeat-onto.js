// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/onto/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-onto.js (with a per-node config prelude).
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
    if (typeof self !== "undefined" && typeof self.origin === "string" && self.origin.indexOf("http") === 0) {
      return self.origin;
    }
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

  // src/static/sdk-libs/onto/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-onto.js");
  var PREFIXES = Object.freeze({
    aimeat: "https://aimeat.io/ns/",
    schema: "https://schema.org/",
    skos: "http://www.w3.org/2004/02/skos/core#",
    dcterms: "http://purl.org/dc/terms/",
    prov: "http://www.w3.org/ns/prov#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    qudt: "http://qudt.org/schema/qudt/",
    saref: "https://saref.etsi.org/core/"
  });
  function context(extra) {
    return Object.assign({}, PREFIXES, extra || {});
  }
  function expand(term, ctx) {
    const t = String(term || "");
    if (/^https?:\/\//i.test(t) || t.indexOf("urn:") === 0 || t.indexOf("did:") === 0) return t;
    const i = t.indexOf(":");
    if (i <= 0) return t;
    const base = (ctx || PREFIXES)[t.slice(0, i)];
    return base ? base + t.slice(i + 1) : t;
  }
  function describe(value, type, props, prefixes) {
    const out = Object.assign({}, value || {});
    if (type) out["@type"] = type;
    if (props) Object.assign(out, props);
    if (prefixes && Object.keys(prefixes).length) out["@context"] = context(prefixes);
    return out;
  }
  function typeOf(value) {
    if (!value || typeof value !== "object") return null;
    const t = (
      /** @type {any} */
      value["@type"]
    );
    return typeof t === "string" ? t : Array.isArray(t) && typeof t[0] === "string" ? t[0] : null;
  }
  function isTyped(value, type) {
    const t = typeOf(value);
    if (!t) return false;
    const want = Array.isArray(type) ? type : [type];
    const ctx = context(value && value["@context"] || void 0);
    const have = expand(t, ctx);
    return want.some(function(w) {
      return expand(w, ctx) === have;
    });
  }
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().trim();
  }
  function labelsOf(c) {
    const out = [];
    const add = (v) => {
      if (!v) return;
      if (typeof v === "string") {
        out.push(v);
        return;
      }
      if (Array.isArray(v)) {
        v.forEach(add);
        return;
      }
      if (typeof v === "object") Object.keys(v).forEach((k) => add(v[k]));
    };
    add(c["skos:prefLabel"]);
    add(c["skos:altLabel"]);
    return out;
  }
  function labelOf(c, lang) {
    if (!c) return "";
    const p = c["skos:prefLabel"];
    if (typeof p === "string") return p;
    if (p && typeof p === "object") {
      if (lang && p[lang]) return p[lang];
      if (p.en) return p.en;
      const first = Object.keys(p)[0];
      if (first) return p[first];
    }
    return c["@id"] || "";
  }
  function scheme(spec) {
    const s = spec || /** @type {any} */
    {};
    return {
      "@context": context(),
      "@type": "skos:ConceptScheme",
      "@id": "vocab:" + (s.id || ""),
      "skos:prefLabel": typeof s.label === "string" ? { en: s.label } : s.label || {},
      "dcterms:description": s.description || void 0,
      "dcterms:modified": (/* @__PURE__ */ new Date()).toISOString(),
      concepts: Array.isArray(s.concepts) ? s.concepts : []
    };
  }
  function concept(spec) {
    const s = spec || /** @type {any} */
    {};
    const c = {
      "@id": s.id,
      "@type": "skos:Concept",
      "skos:prefLabel": typeof s.label === "string" ? { en: s.label } : s.label || {}
    };
    if (s.altLabel) c["skos:altLabel"] = s.altLabel;
    if (s.broader) c["skos:broader"] = s.broader;
    if (s.narrower && s.narrower.length) c["skos:narrower"] = s.narrower;
    if (s.related && s.related.length) c["skos:related"] = s.related;
    if (s.exactMatch) c["skos:exactMatch"] = s.exactMatch;
    if (s.deprecated) c["owl:deprecated"] = true;
    if (s.replacedBy) c["dcterms:isReplacedBy"] = s.replacedBy;
    return c;
  }
  function makeVocabulary(id, doc) {
    const concepts = Array.isArray(doc && doc.concepts) ? doc.concepts : [];
    const byId = /* @__PURE__ */ new Map();
    concepts.forEach(function(c) {
      if (c && c["@id"]) byId.set(c["@id"], c);
    });
    function get(uri) {
      return byId.get(uri) || null;
    }
    function search(q, lang, limit) {
      const needle = norm(q);
      if (!needle) return [];
      const cap = limit || 50;
      const exact = [], starts = [], contains = [];
      for (const c of concepts) {
        const labels = lang ? [(c["skos:prefLabel"] || {})[lang], ...(c["skos:altLabel"] || {})[lang] || []].filter(Boolean) : labelsOf(c);
        let best = -1;
        for (const l of labels) {
          const n = norm(l);
          if (!n) continue;
          if (n === needle) {
            best = 0;
            break;
          }
          if (n.indexOf(needle) === 0) {
            best = best < 0 || best > 1 ? 1 : best;
          } else if (n.indexOf(needle) > 0 && best < 0) {
            best = 2;
          }
        }
        if (best === 0) exact.push(c);
        else if (best === 1) starts.push(c);
        else if (best === 2) contains.push(c);
      }
      return exact.concat(starts, contains).slice(0, cap);
    }
    function broader(uri) {
      const c = get(uri);
      return c && c["skos:broader"] ? get(c["skos:broader"]) : null;
    }
    function narrower(uri) {
      const c = get(uri);
      const declared = c && Array.isArray(c["skos:narrower"]) ? c["skos:narrower"].map(get).filter(Boolean) : [];
      if (declared.length) return declared;
      return concepts.filter(function(k) {
        return k["skos:broader"] === uri;
      });
    }
    function ancestors(uri) {
      const out = [], seen = /* @__PURE__ */ new Set([uri]);
      let cur = broader(uri);
      while (cur && !seen.has(cur["@id"])) {
        out.push(cur);
        seen.add(cur["@id"]);
        cur = broader(cur["@id"]);
      }
      return out;
    }
    function isDeprecated(uri) {
      const c = get(uri);
      return !!(c && c["owl:deprecated"]);
    }
    function replacedBy(uri) {
      const c = get(uri);
      return c && c["dcterms:isReplacedBy"] ? get(c["dcterms:isReplacedBy"]) : null;
    }
    return {
      id,
      doc,
      label: function(uri, lang) {
        return labelOf(get(uri), lang);
      },
      schemeLabel: function(lang) {
        return labelOf(doc, lang);
      },
      get,
      search,
      broader,
      narrower,
      ancestors,
      isDeprecated,
      replacedBy,
      all: function() {
        return concepts.slice();
      },
      size: concepts.length
    };
  }
  async function vocab(id, opts) {
    const key = "vocab." + String(id);
    const o = opts || {};
    let env;
    if (o.owner) {
      const res = await fetch(NODE_URL + "/v1/memory/" + encodeURIComponent(o.owner) + "/" + encodeURIComponent(key) + "?soft=1");
      env = await res.json();
    } else {
      env = await authFetch2("/v1/memory/" + encodeURIComponent(key) + "?soft=1");
    }
    const doc = env && env.ok && env.data ? env.data.value : null;
    if (!doc) throw new Error("No vocabulary at " + key + (o.owner ? " for " + o.owner : ""));
    return makeVocabulary(id, doc);
  }
  async function saveVocab(id, doc, opts) {
    const body = {
      key: "vocab." + String(id),
      value: Object.assign({}, doc, { "dcterms:modified": (/* @__PURE__ */ new Date()).toISOString() }),
      visibility: opts && opts.visibility || "public"
    };
    return authFetch2("/v1/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
  var _core = null;
  async function core() {
    if (_core) return _core;
    const res = await fetch(NODE_URL + "/v1/ns", { headers: { Accept: "application/ld+json" } });
    if (!res.ok) throw new Error("Could not read the core ontology (" + res.status + ")");
    _core = await res.json();
    return _core;
  }
  async function suggest(text, vocabulary, opts) {
    const ai = window.AIMEAT && window.AIMEAT.ai;
    if (!ai) throw new Error("AIMEAT.ai is required. Include aimeat-ai.js before calling suggest().");
    const v = typeof vocabulary === "string" ? await vocab(vocabulary) : vocabulary;
    const o = opts || {};
    const lang = o.lang || "en";
    const max = o.max || 5;
    const list = v.all().map(function(c) {
      return c["@id"] + " = " + labelOf(c, lang);
    }).join("\n");
    const prompt = 'Here is a vocabulary of concepts, one per line as "id = label":\n\n' + list + "\n\nHere is a piece of text:\n\n" + String(text) + "\n\nWhich of those concepts is the text about? Answer with at most " + max + " ids from the list above, one per line, and nothing else. If none of them fit, answer with the single word NONE.";
    const answer = await ai.complete(prompt);
    const said = String(answer && answer.text ? answer.text : answer || "");
    if (/^\s*NONE\s*$/i.test(said)) return [];
    const picked = [];
    said.split("\n").forEach(function(line) {
      const id = line.replace(/^[-*\d.\s]+/, "").split("=")[0].trim();
      const c = id && v.get(id);
      if (c && picked.indexOf(c) < 0) picked.push(c);
    });
    return picked.slice(0, max);
  }
  var onto = {
    PREFIXES,
    context,
    expand,
    describe,
    typeOf,
    isTyped,
    scheme,
    concept,
    vocab,
    saveVocab,
    core,
    suggest
  };
  attach("onto", onto);
})();
