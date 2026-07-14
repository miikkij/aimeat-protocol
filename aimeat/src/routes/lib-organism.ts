/**
 * @file lib-organism.ts
 * @description aimeat-organism.js — organism/workspace content client for standalone published
 *   apps. Wraps the workspace read contract that every app otherwise re-derives (and gets wrong):
 *   GET workspace returns objects[type] = PUBLISHED values and drafts[type] = draft values as a
 *   SEPARATE map, both as bare values (no key envelope) with _createdAt/_updatedAt/_version
 *   metadata merged in. normalizeWorkspace() merges the two by instance id (value.id — the SPA
 *   convention; documents are {id,title,markdown}), strips nothing on read but writeDraft()
 *   strips _-prefixed meta fields before writing so read metadata is never persisted back.
 *   Values without an id field get a synthetic display id and hasRealId:false — such items
 *   cannot round-trip (publish/save would target the wrong key), callers should render them
 *   read-only.
 * @structure aimeatOrganismLib(config) -> string (IIFE attaching global.AIMEAT.organism)
 *   - list() / get(orgId) / workspaces(orgId)
 *   - read(orgId, wsId?) -> { manifest, readme, readmeText, spaces, raw }
 *   - writeDraft(orgId, wsId, namespace, id, value, opts?) / publish / revertToDraft / deleteObject
 *   - saveReadme(orgId, wsId, readme) / search(orgId, q)
 *   - util: { stripMeta, titleOf, bodyFieldOf, isDocLike, updatedAt, TITLE_FIELDS, BODY_FIELDS }
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-organism.js"></script>
 *   then  const ws = await AIMEAT.organism.read(orgId); ws.spaces[0].items[0].value
 * @version-history
 *   v1.0.0 — 2026-07-02 — initial: normalized workspace read (objects+drafts merge, value.id
 *     convention, _meta handling), draft/publish/revert/delete/readme/search, extracted from the
 *     AIMEAT Pages app where the raw contract had to be reverse-engineered.
 */
import type { AimeatConfig } from '../config.js';

export function aimeatOrganismLib(config: AimeatConfig): string {
  return `// aimeat-organism.js — AIMEAT Organism & Workspace Library
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
// Usage: const orgs = await AIMEAT.organism.list();
//        const ws = await AIMEAT.organism.read(orgId, wsId);   // ws.spaces -> normalized items
//        await AIMEAT.organism.writeDraft(orgId, wsId, 'pages', 'my-doc', { id:'my-doc', title:'T', markdown:'# hi' });
//        await AIMEAT.organism.publish(orgId, wsId, 'pages', 'my-doc');
(function (global) {
'use strict';

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-organism.js');
  }
  var s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}
async function authFetch(path, opts) {
  var res = await getSession().fetch(path, opts);
  if (res && typeof res.json === 'function') res = await res.json();
  return res;
}
function fail(res, fallback) {
  var e = new Error((res && res.error && (res.error.message || res.error.code)) || fallback);
  e.code = res && res.error && res.error.code;
  e.envelope = res;
  return e;
}

// ── field conventions (mirror the SPA + AIMEAT Pages) ──
var TITLE_FIELDS = ['title', 'name', 'subject', 'label'];
var BODY_FIELDS = ['content', 'body', 'markdown', 'text', 'md', 'description', 'summary'];

function pickField(obj, names) {
  if (!obj || typeof obj !== 'object') return null;
  for (var i = 0; i < names.length; i++) if (typeof obj[names[i]] === 'string') return names[i];
  return null;
}
function isMetaField(k) { return typeof k === 'string' && k.charAt(0) === '_'; }
// Read metadata (_createdAt/_updatedAt/_version) is merged into values by the workspace read;
// it must never be written back, so every write path strips it.
function stripMeta(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  var out = {};
  Object.keys(v).forEach(function (k) { if (!isMetaField(k)) out[k] = v[k]; });
  return out;
}
function slugify(s) {
  return String(s || 'untitled').toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled';
}
function titleOf(value, fallbackId) {
  var v = value || {};
  var f = pickField(v, TITLE_FIELDS);
  if (f && v[f]) return v[f];
  if (typeof v.id === 'string' && v.id) return v.id;
  var bf = pickField(v, BODY_FIELDS);
  if (bf && typeof v[bf] === 'string' && v[bf]) return String(v[bf]).replace(/\\s+/g, ' ').slice(0, 48);
  return fallbackId || 'Untitled';
}
function bodyFieldOf(value) { return pickField(value, BODY_FIELDS); }
function isDocLike(value) {
  var bf = bodyFieldOf(value);
  if (!bf || !value || typeof value[bf] !== 'string') return false;
  return bf === 'markdown' || bf === 'content' || value[bf].length > 120 || /\\n/.test(value[bf]);
}
function valueUpdatedAt(v) {
  if (v && typeof v === 'object' && (v._updatedAt || v._createdAt)) {
    var t = new Date(v._updatedAt || v._createdAt).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

// ── key layout: one workspace lives under organism.{orgId}.w.{wsId} ──
function wsRoot(orgId, wsId) {
  return 'organism.' + orgId + (wsId ? '.w.' + wsId : '');
}
function draftKey(orgId, wsId, namespace, id) {
  return wsRoot(orgId, wsId) + '.' + namespace + '.' + id + '.draft';
}

// ── workspace read normalization ──
// data.objects[type] = published values, data.drafts[type] = draft values (separate map!).
// Both are bare values; the instance id lives in value.id. Items without one get a synthetic
// id and hasRealId:false — they cannot be saved or published (the real key id is unknown).
function normalizeWorkspace(data) {
  var manifest = (data && data.manifest) || null;
  var otList = (manifest && (manifest.objectTypes || manifest.object_types || manifest.types)) || [];
  if (!Array.isArray(otList) && otList && typeof otList === 'object') {
    otList = Object.keys(otList).map(function (k) {
      var o = otList[k]; o = (o && typeof o === 'object') ? o : {};
      if (!o.name) o.name = k;
      return o;
    });
  }
  var byName = {};
  otList.forEach(function (ot) { var n = ot.name || ot.id || ot.type; if (n) byName[n] = ot; });

  var objects = (data && data.objects) || {};
  var draftsMap = (data && data.drafts) || {};
  var typeNames = [];
  otList.forEach(function (ot) { var n = ot.name || ot.id || ot.type; if (n && typeNames.indexOf(n) < 0) typeNames.push(n); });
  Object.keys(objects).forEach(function (n) { if (typeNames.indexOf(n) < 0) typeNames.push(n); });
  Object.keys(draftsMap).forEach(function (n) { if (typeNames.indexOf(n) < 0) typeNames.push(n); });

  return typeNames.map(function (typeName) {
    var ot = byName[typeName] || {};
    var instances = {};
    var order = [];
    var seq = 0;
    function instIdOf(v) {
      if (v && typeof v === 'object' && typeof v.id === 'string' && v.id) return { id: v.id, real: true };
      if (v && typeof v === 'object') {
        var tf = pickField(v, TITLE_FIELDS);
        if (tf && v[tf]) return { id: 't-' + slugify(v[tf]), real: false };
      }
      return { id: 'item-' + (seq++), real: false };
    }
    function add(v, slot) {
      if (v == null) return;
      var m = instIdOf(v);
      if (!instances[m.id]) { instances[m.id] = { id: m.id, hasRealId: m.real, draft: null, latest: null }; order.push(m.id); }
      if (slot === 'draft') instances[m.id].draft = v; else instances[m.id].latest = instances[m.id].latest || v;
    }
    var pub = objects[typeName] || []; if (!Array.isArray(pub)) pub = [pub];
    pub.forEach(function (v) { add(v, 'latest'); });
    var dr = draftsMap[typeName] || []; if (!Array.isArray(dr)) dr = [dr];
    dr.forEach(function (v) { add(v, 'draft'); });

    var items = order.map(function (id) {
      var inst = instances[id];
      var best = inst.draft || inst.latest;
      inst.value = best;
      inst.title = titleOf(best, id);
      inst.updatedAt = Math.max(valueUpdatedAt(inst.draft), valueUpdatedAt(inst.latest));
      inst.status = inst.draft && inst.latest ? 'draft+published' : (inst.draft ? 'draft' : 'published');
      return inst;
    });
    return {
      name: typeName,
      namespace: ot.namespace || ot.ns || typeName,
      kind: ot.kind || ot.type || null,
      schemaRef: ot.schemaRef || null,
      writeRole: ot.writeRole || null,
      items: items
    };
  });
}
function readmeText(readme) {
  if (readme == null) return '';
  if (typeof readme === 'string') return readme;
  if (typeof readme === 'object') return readme.content || readme.text || readme.markdown || JSON.stringify(readme, null, 2);
  return String(readme);
}

var organism = {
  // List organisms the signed-in owner is a member of.
  async list() {
    var s = getSession();
    var owner = s.owner || (s.user && s.user.owner) || '';
    var res;
    try { res = await authFetch('/v1/organisms?member=' + encodeURIComponent(owner) + '&per_page=100'); }
    catch (e) { res = null; }
    if (!res || res.ok === false) res = await authFetch('/v1/organisms');
    if (res.ok === false) throw fail(res, 'Failed to list organisms');
    var d = res.data !== undefined ? res.data : res;
    return (d && (d.organisms || d.items)) || (Array.isArray(d) ? d : []);
  },

  async get(orgId) {
    var res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId));
    if (res.ok === false) throw fail(res, 'Failed to load organism');
    return res.data !== undefined ? res.data : res;
  },

  // Create a NEW organism (the signed-in owner becomes creator/member). Needs the organism:write app
  // scope (declare it in <meta name="aimeat-scopes">). Returns { id, name, ... }. Use this + createWorkspace
  // to let a multi-tenant app provision its own data space for each user on first use.
  async create(name, opts) {
    opts = opts || {};
    var res = await authFetch('/v1/organisms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, type: opts.type || 'project', visibility: opts.visibility || 'private',
        join_policy: opts.join_policy || 'invite_only', description: opts.description })
    });
    if (res.ok === false) throw fail(res, 'Failed to create organism');
    return res.data !== undefined ? res.data : res;
  },

  // Create a NEW schema-locked workspace inside an organism from a manifest + per-namespace JSON schemas.
  // manifest = { manifestVersion:'1', name, kind, objectTypes:[{ name, namespace, mode:'records',
  // backing:'memory', writeRole:'member', schemaRef? }] }; schemas = { '<namespace>': <JSON Schema> }.
  // Needs organism:write. Returns { ws, types, schemas_locked }.
  async createWorkspace(orgId, name, manifest, schemas, readme) {
    var res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId) + '/workspaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, manifest: manifest, schemas: schemas, readme: readme })
    });
    if (res.ok === false) throw fail(res, 'Failed to create workspace');
    return res.data !== undefined ? res.data : res;
  },

  // List workspaces (access + enrichment counts included).
  async workspaces(orgId) {
    var res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId) + '/workspaces?include=enrichment');
    if (res.ok === false) throw fail(res, 'Failed to list workspaces');
    var d = res.data !== undefined ? res.data : res;
    return (d && (d.workspaces || d.items)) || (Array.isArray(d) ? d : []);
  },

  // Read one workspace, normalized: { manifest, readme, readmeText, spaces, raw }.
  // spaces[].items[]: { id, hasRealId, draft, latest, value, title, updatedAt, status }.
  async read(orgId, wsId) {
    var q = wsId ? ('?ws=' + encodeURIComponent(wsId)) : '';
    var res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId) + '/workspace' + q);
    if (res.ok === false) throw fail(res, 'Failed to read workspace');
    var d = res.data !== undefined ? res.data : res;
    return {
      manifest: (d && d.manifest) || null,
      readme: (d && d.readme) || null,
      readmeText: readmeText(d && d.readme),
      spaces: normalizeWorkspace(d),
      raw: d
    };
  },

  // Write/overwrite an object's draft. Embeds the instance id into the value (SPA convention)
  // unless opts.embedId === false (needed for locked schemas that reject an id property).
  async writeDraft(orgId, wsId, namespace, id, value, opts) {
    opts = opts || {};
    var v = stripMeta(value);
    if (opts.embedId !== false && v && typeof v === 'object' && !Array.isArray(v)) {
      v = Object.assign({}, v, { id: id });
    }
    var body = { key: draftKey(orgId, wsId, namespace, id), value: v, visibility: opts.visibility || 'private' };
    if (opts.group_id) body.group_id = opts.group_id;
    if (Array.isArray(opts.tags) && opts.tags.length) body.tags = opts.tags;
    var res = await authFetch('/v1/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok === false) throw fail(res, 'Failed to save draft');
    return res.data !== undefined ? res.data : res;
  },

  // Publish a draft -> new .version.N + .latest (or a pending approval when the workspace gates publishes).
  async publish(orgId, wsId, namespace, id) {
    var res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId) + '/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ws: wsId || undefined, namespace: namespace, id: id })
    });
    if (res.ok === false) throw fail(res, 'Failed to publish');
    return res.data !== undefined ? res.data : res;
  },

  // Reopen a published record for editing (server copies .latest -> .draft; 409 if a draft exists).
  async revertToDraft(orgId, wsId, namespace, id) {
    var res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId) + '/revert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ws: wsId || undefined, namespace: namespace, id: id })
    });
    if (res.ok === false) throw fail(res, 'Failed to revert to draft');
    return res.data !== undefined ? res.data : res;
  },

  // Delete one object: bare key + .draft + .latest + all .version.N history (re-run for huge
  // histories). NOTE: needs the memory:delete scope — app-grant tokens don't get it by default,
  // declare it via <meta name="aimeat-scopes" content="memory:read memory:write memory:delete">.
  async deleteObject(orgId, wsId, namespace, id) {
    var base = wsRoot(orgId, wsId) + '.' + namespace + '.' + id;
    var res = await authFetch('/v1/memory?prefix=' + encodeURIComponent(base) + '&limit=200');
    if (res.ok === false) throw fail(res, 'Failed to list object keys');
    var items = (res.data && res.data.items) || [];
    var deleted = 0, attempted = 0, lastErr = null;
    for (var i = 0; i < items.length; i++) {
      var key = items[i].key;
      // prefix match catches sibling ids (…my-doc2); keep only the exact instance's keys
      if (key !== base && key.indexOf(base + '.') !== 0) continue;
      attempted++;
      var dres = await authFetch('/v1/memory/' + encodeURIComponent(key), { method: 'DELETE' });
      if (dres.ok !== false) deleted++; else lastErr = dres;
    }
    if (attempted > 0 && deleted === 0 && lastErr) throw fail(lastErr, 'Failed to delete object keys');
    return { deleted: deleted, attempted: attempted };
  },

  // Save the workspace README (creator/org-admin only — the server enforces it).
  async saveReadme(orgId, wsId, readme) {
    var res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId) + '/workspace?ws=' + encodeURIComponent(wsId), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readme: readme })
    });
    if (res.ok === false) throw fail(res, 'Failed to save README');
    return res.data !== undefined ? res.data : res;
  },

  // Organism-wide server-side search.
  async search(orgId, q) {
    var res = await authFetch('/v1/organisms/' + encodeURIComponent(orgId) + '/search?q=' + encodeURIComponent(q));
    if (res.ok === false) throw fail(res, 'Search failed');
    var d = res.data !== undefined ? res.data : res;
    return (d && (d.results || d.hits || d.items)) || (Array.isArray(d) ? d : []);
  },

  util: {
    stripMeta: stripMeta,
    isMetaField: isMetaField,
    titleOf: titleOf,
    bodyFieldOf: bodyFieldOf,
    isDocLike: isDocLike,
    updatedAt: valueUpdatedAt,
    wsRoot: wsRoot,
    draftKey: draftKey,
    normalizeWorkspace: normalizeWorkspace,
    readmeText: readmeText,
    TITLE_FIELDS: TITLE_FIELDS.slice(),
    BODY_FIELDS: BODY_FIELDS.slice()
  }
};

global.AIMEAT = global.AIMEAT || {};
global.AIMEAT.organism = organism;
})(window);
`;
}
