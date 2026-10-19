/**
 * @file data/index.js
 * @description The aimeat-data library (SDK-libs migration — config-path proof lib). Exposes
 *   AIMEAT.data: the Memory API (Tier 1, JWT auth via AIMEAT.auth) with an app-creator public-read
 *   fallback. This is the componentized ESM source esbuild
 *   bundles to the IIFE served, unchanged, at /v1/libs/aimeat-data.js. It is the first migrated lib
 *   that actually CONSUMES the shared config: `NODE_URL` (direct public reads) and `NODE_ID`
 *   (the `creator@node` construction in get()'s fallback) come from _core/config — the exact values
 *   the legacy string form baked in via `${config.baseUrl}` / `${config.nodeId}`.
 * @structure imports NODE_URL/NODE_ID (config), authFetch (session), attach (namespace);
 *   withProvenance()/publicEntryResponse()/mapAtMost()/discoverRow(); data.set/get/getEntry/update/
 *   delete/list/count/discover/search/getPublic/getPublicEntry/action; attach('data', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-data.js"></script>
 *   await AIMEAT.data.set('key', { value }); await AIMEAT.data.get('key');
 * @version-history
 *   v1.8.1 — 2026-10-19 — appConfig() and the public record read go through _core/public-fetch.js, so
 *     they work for a signed-in person on a node that shows its content to its own accounts only.
 *   v1.8.0 — 2026-10-18 — action(ext, actionId, input): an extension action as the signed-in person,
 *     or with nobody signed in for an action the manifest marks public (Comicland v3 A-7).
 *     adultStatus(): verified adult yes or no, the method and the time (A-3).
 *   v1.7.0 — 2026-10-16 — A refused read is an error, never an empty one (QA audit F6-03). get()
 *     resolves null only when the key does not exist (NOT_FOUND, or the soft 200 with no value); every
 *     other refusal (401, 403, 429, 5xx) throws an Error carrying the node's `code` and `details`,
 *     and the app creator's public value is read only after NOT_FOUND, never after a refusal. A
 *     creator read that fails is logged and get() resolves null, because the caller's own key is
 *     still absent. appConfig() and appWorkspace() resolve null only off a served app or when the node
 *     says the app is not found; any other refusal, a network failure or an answer that is not JSON
 *     throws. Every other throw here carries the code too. CONTRACT CHANGE: an app that read null
 *     from get() after a refusal now sees a throw, which is what stops "read, change, write the whole
 *     value" from replacing the stored record with a default.
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-data.ts; NODE_URL/NODE_ID now from _core/config.
 *   v1.1.0 — 2026-07-25 — Cross-namespace reads: get/getEntry/list/search take { agent, ownerScope };
 *     list takes { meta, count } (+ data.count()). Agent-published keys live under the agent's GAII,
 *     and an app-grant token gets no automatic owner-scope broadening, so apps had to bypass this
 *     library entirely to read their own owner's fleet output. All options are additive.
 *   v1.2.0 — 2026-07-29 — delete() takes { ownerScope } like the reads. list({ ownerScope }) already
 *     returned agent-written keys, so an app could render a record and then 404 trying to remove it.
 *   v1.3.0 — 2026-08-01 — TARGET-058: AI provenance survives the READ. getEntry() folds in the
 *     envelope's `meta.provenance`, and getPublicEntry() is the public sibling that does the same —
 *     getPublic() keeps returning the bare value, because every published app depends on that.
 *     Until now every read path here ended in `res.data`, so an app could render model-written
 *     content with no way to state its origin no matter how carefully the writing agent declared
 *     it. Same loss the connector had (ai-provenance-carry.ts v1.1.0); the browser had it too.
 *   v1.4.0 — 2026-09-13 — discover(prefix, opts): other people's public entries under a prefix, with
 *     their values and the caller's own rows put back. There was no browser method for
 *     GET /v1/memory/discover, and the node's own shared-feed template used search(), which reads only
 *     the caller's namespaces, so every visitor of a community feed saw only their own posts (appdev
 *     pitfall search-does-not-read-across-users-use-discover). Additive.
 *   v1.6.0 — 2026-10-02 — appWorkspace(contract): where a set's install made the workspace the app
 *     declares (GET /v1/apps/:owner/:filename/config `workspaces`). Additive.
 *   v1.5.0 — 2026-09-28 — appConfig(): the config the app's owner set for it (GET
 *     /v1/apps/:owner/:filename/config), found from the app's own #aimeat-app-ref block. Additive.
 */
import { NODE_URL, NODE_ID, APEX_URL } from '../_core/config.js';
import { publicFetch } from '../_core/public-fetch.js';
import { appRef } from '../_core/app-ref.js';
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-data.js');
import { attach } from '../_core/namespace.js';

/**
 * Cross-namespace read scoping, shared by get/getEntry/list/search.
 *
 * Agents publish under their OWN namespace (`name#owner@node`), not the owner's GHII.
 * An owner SESSION gets owner-scope broadening automatically server-side, but an
 * app-grant token (roles:['app']) does not — so an app reading its owner's fleet
 * output must say so explicitly. Before these options the only way to do that was
 * to bypass this library and hand-roll session.fetch calls.
 *
 * @param {{agent?: string, ownerScope?: boolean}} [opts]
 * @returns {URLSearchParams}
 */
/**
 * Fold the envelope's `meta.provenance` onto the entry the caller gets back.
 *
 * The node puts it on `meta` rather than in `data` on purpose: provenance DESCRIBES the content
 * instead of being part of it, and `data` shapes are what published apps read. That decision is
 * right, and it is also exactly why every `return res.data` in a client library silently drops it.
 * One helper, so a read path added later cannot lose it again.
 *
 * @param {{data: any, meta?: {provenance?: any}}} res
 */
function withProvenance(res) {
  const prov = res.meta?.provenance;
  return prov ? { ...res.data, provenance: prov } : res.data;
}

/**
 * The Error a refused call throws: the node's own sentence, with its machine-readable `code` and
 * `details` kept so an app can branch on them (RATE_LIMITED, ACCESS_DENIED, …) instead of on text.
 * A body that carries no code gets `fallbackCode`.
 * @param {any} res        The parsed envelope (`{ ok: false, error: { code, message, details } }`).
 * @param {string} fallback The message when the node sent none.
 * @param {string} [fallbackCode]
 * @returns {Error & { code: string, details?: unknown }}
 */
function refusal(res, fallback, fallbackCode) {
  const e = res && res.error;
  const err = /** @type {Error & { code: string, details?: unknown }} */ (new Error((e && e.message) || fallback));
  err.code = (e && e.code) || fallbackCode || 'REQUEST_FAILED';
  if (e && e.details !== undefined) err.details = e.details;
  return err;
}

/**
 * The served app's config view from GET /v1/apps/:owner/:filename/config, shared by appConfig() and
 * appWorkspace(). Null off a served app and when the node answers NOT_FOUND (no such published app,
 * or one an operator hid). Every other refusal throws, and so do a network failure and an answer
 * that is not JSON: a config the app could not read is not a config the app does not have.
 * @returns {Promise<any|null>}
 */
async function appConfigView() {
  const ref = appRef();
  if (!ref) return null;
  const r = await publicFetch((APEX_URL || '') + '/v1/apps/' + encodeURIComponent(ref.owner)
    + '/' + encodeURIComponent(ref.filename) + '/config');
  const body = await r.json();
  if (body && body.ok) return body.data || {};
  if (body && body.error && body.error.code === 'NOT_FOUND') return null;
  throw refusal(body, 'The app config could not be read (HTTP ' + r.status + '). Try again.', 'APP_CONFIG_UNREADABLE');
}

/** The public (unauthenticated) memory read, shared by getPublic + getPublicEntry. */
async function publicEntryResponse(gaii, key) {
  const url = NODE_URL + '/v1/memory/' + encodeURIComponent(gaii) + '/' + encodeURIComponent(key) + '?soft=1';
  const r = await publicFetch(url);
  const res = await r.json();
  if (!res.ok) {
    if (res.error?.code === 'NOT_FOUND') return null;
    throw refusal(res, 'Failed to read public memory');
  }
  return res;
}

function scopeParams(opts) {
  const p = new URLSearchParams();
  if (opts?.agent) p.set('agent', opts.agent);
  // `agent` already targets one namespace; sending both is contradictory (the server
  // ignores owner_scope when agent is present), so only one goes on the wire.
  else if (opts?.ownerScope) p.set('owner_scope', 'true');
  return p;
}

/** Append params to a path, preserving any query string already on it. */
function withParams(path, params) {
  const qs = params.toString();
  if (!qs) return path;
  return path + (path.indexOf('?') >= 0 ? '&' : '?') + qs;
}

/** How many public value reads discover() runs at once: one per row, but never a burst of 200. */
const DISCOVER_READS_AT_ONCE = 6;

/**
 * Run `fn` over `items` with at most `n` calls in flight, keeping the order of the results.
 * @template T, R
 * @param {T[]} items
 * @param {number} n
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapAtMost(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(n, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

/** The fields a discover row carries, whichever door it came through. */
function discoverRow(item, mine) {
  return {
    key: item.key,
    owner_gaii: item.owner_gaii,
    visibility: item.visibility,
    tags: item.tags,
    version: item.version,
    created_at: item.created_at,
    updated_at: item.updated_at,
    mine: mine,
  };
}

// ── Memory API (Tier 1, JWT auth) ──

const data = {
  // Write or upsert a memory entry
  async set(key, value, opts) {
    const body = { key, value, visibility: 'private', ...opts };
    const res = await authFetch('/v1/memory', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw refusal(res, 'Failed to set memory');
    return res.data;
  },

  /**
   * Read a single entry's value. Resolves null ONLY when the key does not exist; a read the node
   * refused (401, 403, 429, 5xx) throws an Error whose `code` is the node's (RATE_LIMITED,
   * ACCESS_DENIED, INTERNAL_ERROR, …). That is what makes "read, change, write the whole value" safe:
   * the write after a refused read never runs, so it cannot replace the stored record with a default.
   * Uses ?soft=1 so a missing key is a clean 200 (value null), with no 404 in the browser console.
   *
   * When the caller's own key is missing or empty, the app creator's public value of the same key is
   * read instead (the seed an app ships with). That fallback runs only after "does not exist", never
   * after a refusal, and only on an unscoped read. If the creator read itself fails it is logged and
   * get() resolves null, because the caller's own key is still absent.
   *
   * @param {string} key
   * @param {{ agent?: string, ownerScope?: boolean }} [opts] read from one of the owner's agents'
   *   namespaces, or across the owner's whole set (GHII + agents).
   */
  async get(key, opts) {
    const res = await authFetch(withParams(
      '/v1/memory/' + encodeURIComponent(key) + '?soft=1', scopeParams(opts)));
    if (!res.ok && res.error?.code !== 'NOT_FOUND') throw refusal(res, 'The key "' + key + '" could not be read. Nothing was changed; try again.', 'READ_FAILED');
    var val = res.ok ? res.data.value : null;
    var isEmpty = val == null || (typeof val === 'object' && Object.keys(val).length === 0);
    if (!isEmpty) return val;
    // A scoped read is explicit about where to look; do not silently widen it to the
    // app-creator's public namespace.
    if (opts?.agent || opts?.ownerScope) return val;
    // Fallback: try public read from app creator's namespace
    var creator = document.querySelector('meta[name="aimeat-creator"]')?.getAttribute('content');
    if (!creator) {
      var m = location.pathname.match(/\/v1\/apps\/([^/]+)\//);
      if (m) {
        creator = decodeURIComponent(m[1]);
        if (creator && !creator.includes('@')) creator = creator + '@' + NODE_ID;
      }
    }
    if (creator) {
      try {
        var pub = await data.getPublic(creator, key);
        if (pub != null) return pub;
      } catch (e) {
        // The caller's own key does not exist, which is what null says; only the creator's seed
        // value could not be read. Logged so the miss is visible, not thrown, because nothing of
        // the caller's is at stake.
        console.warn('[aimeat-data] get("' + key + '"): the app creator\'s public value could not be read:', e && /** @type {Error} */ (e).message);
      }
    }
    return val;
  },

  // Read full entry metadata. opts: { agent, ownerScope } as in get().
  // `provenance` is folded in from the envelope's `meta` — see withProvenance().
  async getEntry(key, opts) {
    const res = await authFetch(withParams(
      '/v1/memory/' + encodeURIComponent(key), scopeParams(opts)));
    if (!res.ok) {
      if (res.error?.code === 'NOT_FOUND') return null;
      throw refusal(res, 'Failed to get memory');
    }
    return withProvenance(res);
  },

  // Update with optimistic locking
  async update(key, value, version, opts) {
    const body = { value, version, ...opts };
    const res = await authFetch('/v1/memory/' + encodeURIComponent(key), {
      method: 'PUT', body: JSON.stringify(body),
    });
    if (!res.ok) throw refusal(res, 'Failed to update memory');
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
    const res = await authFetch(withParams(
      '/v1/memory/' + encodeURIComponent(key), scopeParams(opts)), { method: 'DELETE' });
    if (!res.ok) throw refusal(res, 'Failed to delete memory');
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
    if (opts?.prefix) params.set('prefix', opts.prefix);
    if (opts?.visibility) params.set('visibility', opts.visibility);
    if (opts?.tags) params.set('tags', opts.tags.join(','));
    if (opts?.meta) params.set('include', 'meta');
    if (opts?.count) params.set('count', 'true');
    const qs = params.toString();
    const res = await authFetch('/v1/memory' + (qs ? '?' + qs : ''));
    if (!res.ok) throw refusal(res, 'Failed to list memory');
    return res.data;
  },

  /** Cheap change probe: the number of keys under a prefix, no values transferred. */
  async count(opts) {
    const d = await data.list({ ...(opts || {}), count: true });
    return (d && typeof d.count === 'number') ? d.count : null;
  },

  /**
   * List OTHER people's public entries under a key prefix, with their values. The read for a shared
   * feed, a public leaderboard or a community map: each user writes their own public key, and this is
   * how everyone else finds them.
   *
   * search() and list() never do this. They read the caller's own identity set (the signed-in person
   * and their agents), so a feed built on them shows each visitor only their own posts, which looks
   * like "nobody has posted yet" and is invisible on a one-account test. This calls
   * GET /v1/memory/discover, which lists public entries across the node's users but carries no values
   * and leaves the caller out, and makes up both: one public read per row (at most six at a time) and
   * the caller's own public entries under the prefix, marked `mine: true`.
   *
   * It needs a signed-in session, because the listing door does: a signed-out visitor gets the usual
   * "Not logged in" error, so design that state rather than rendering it as an empty feed. A row whose
   * value is gone by the time it is read (deleted, or made private) is left out; if every read fails,
   * the first error is thrown instead of returning an empty list.
   *
   * @param {string} prefix  Key prefix, e.g. 'myapp.feed.'.
   * @param {{ limit?: number, offset?: number, owner?: string, withValues?: boolean, includeMine?: boolean }} [opts]
   *   limit       rows asked of the node, 1 to 200 (default 50); it pages with offset.
   *   owner       only entries whose owner GAII starts with this.
   *   withValues  false returns metadata only and makes no public reads (default true).
   *   includeMine false leaves the caller's own entries out, as the route does (default true).
   * @returns {Promise<Array<{ key: string, owner_gaii: string, value?: any, visibility: string,
   *   tags?: string[], version?: number, created_at?: string, updated_at?: string, mine: boolean }>>}
   *   The caller's own rows first, then everyone else's in the node's order.
   */
  async discover(prefix, opts) {
    const o = opts || {};
    const withValues = o.withValues !== false;
    const limit = Math.min(Math.max(parseInt(String(o.limit), 10) || 50, 1), 200);
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    params.set('limit', String(limit));
    if (o.offset) params.set('offset', String(o.offset));
    if (o.owner) params.set('owner', o.owner);
    const res = await authFetch('/v1/memory/discover?' + params.toString());
    if (!res.ok) throw refusal(res, 'Failed to discover public memory');
    const found = (res.data?.items || []).filter(function (i) { return i && i.key && i.owner_gaii; });

    const rows = [];
    const seen = new Set();
    if (o.includeMine !== false) {
      const own = new URLSearchParams();
      if (prefix) own.set('prefix', prefix);
      own.set('visibility', 'public');
      own.set('limit', String(limit));
      if (!withValues) own.set('include', 'meta');
      const mineRes = await authFetch('/v1/memory?' + own.toString());
      if (!mineRes.ok) throw refusal(mineRes, 'Failed to list your own public memory');
      (mineRes.data?.items || []).forEach(function (item) {
        const row = discoverRow(item, true);
        if (withValues) row.value = item.value;
        seen.add(row.owner_gaii + '\n' + row.key);
        rows.push(row);
      });
    }

    const theirs = found.filter(function (i) { return !seen.has(i.owner_gaii + '\n' + i.key); });
    if (!withValues) return rows.concat(theirs.map(function (i) { return discoverRow(i, false); }));

    // Each read settles to { value } or { error }, so one failed row neither aborts the list nor
    // disappears unaccounted: it is counted, and a list where EVERY read failed throws.
    const read = await mapAtMost(theirs, DISCOVER_READS_AT_ONCE, function (item) {
      return data.getPublic(item.owner_gaii, item.key).then(
        function (value) { return { item: item, value: value, error: null }; },
        function (error) { return { item: item, value: null, error: error }; });
    });
    const failures = read.filter(function (r) { return r.error; });
    if (failures.length > 0 && failures.length === read.length) throw failures[0].error;
    read.forEach(function (r) {
      if (r.error || r.value == null) return;   // failed, or gone since the listing (deleted, made private)
      const row = discoverRow(r.item, false);
      row.value = r.value;
      rows.push(row);
    });
    return rows;
  },

  // Search memory entries
  // opts: { visibility, agent, ownerScope } — scoping as in list().
  // Reads the CALLER's own identity set only; other people's public entries come from discover().
  async search(query, opts) {
    const params = scopeParams(opts);
    params.set('q', query);
    if (opts?.visibility) params.set('visibility', opts.visibility);
    const res = await authFetch('/v1/memory/search?' + params.toString());
    if (!res.ok) throw refusal(res, 'Failed to search memory');
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

  /**
   * This app's config: the values its owner set for the fields the app declares in its
   * `<script type="application/json" id="aimeat-config">` block, with the declared defaults filled
   * in. The OWNER's values, whoever opened the app, signed in or not, which is why a config field
   * is never a secret. Resolves null on a page that is not a served app, or when the node says the
   * app is not found. A read that fails in any other way (a refusal, the network, an answer that is
   * not JSON) throws, with the node's `code` when it sent one: a config the app could not read is
   * not a config the app does not have.
   * @returns {Promise<Record<string, string|number|boolean>|null>}
   */
  async appConfig() {
    const view = await appConfigView();
    return (view && view.values) || null;
  },

  /**
   * Where this installed copy's workspace for a contract the app declares in its
   * `<script type="application/json" id="aimeat-workspace">` block is: `{ organism_id, workspace_id,
   * name }`, made when a set was installed. Resolves null when no install made one (the app was not
   * installed from a set, or the page is not a served app); the app then finds or creates its own.
   * A read that fails throws, as appConfig() does, so a refused read never leads the app to create a
   * second workspace beside the one the install made.
   * @param {string} contract e.g. "aimeat.backoffice/1"
   * @returns {Promise<{ organism_id: string, workspace_id: string, name?: string }|null>}
   */
  async appWorkspace(contract) {
    if (typeof contract !== 'string' || !contract) return null;
    const view = await appConfigView();
    const links = view && view.workspaces;
    return (links && links[contract]) || null;
  },

  /**
   * Run an extension action and resolve with its result. A signed-in person calls as themselves; with
   * nobody signed in, the call goes without a sign-in and only an action whose manifest says
   * `public: true` answers (any other throws with code UNAUTHORIZED). A visitor's run reads and never
   * writes, so a reader page can list a catalogue or open a free episode for anyone. A refusal throws
   * with the node's `code` (EXTENSION_ERROR, EXTENSION_INACTIVE, RATE_LIMITED, …).
   * @param {string} ext The extension's name, or `name/instanceId` for one copy of it.
   * @param {string} actionId
   * @param {object} [input]
   * @returns {Promise<any>}
   */
  /**
   * Whether the signed-in person is a verified adult: { verified, method, verified_at }, never a birth
   * date. `method` is 'ftn' (bank identification), 'eudiw' (EUDI wallet) or 'credit-card' (a payment
   * with a credit card). Nobody signed in reads as not verified. Show adult content only when
   * `verified` is true, and gate it in the extension too (ctx.caller.adult), not only in the page.
   * @returns {Promise<{ verified: boolean, method: string|null, verified_at: string|null }>}
   */
  async adultStatus() {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!(auth && auth.getSession && auth.getSession())) return { verified: false, method: null, verified_at: null };
    const res = await authFetch('/v1/ghii/me/adult');
    if (!res.ok) throw refusal(res, 'The adult check could not be read.');
    return res.data;
  },

  async action(ext, actionId, input) {
    const path = '/v1/ext/' + String(ext).split('/').map(encodeURIComponent).join('/') + '/' + encodeURIComponent(actionId);
    const opts = { method: 'POST', body: JSON.stringify(input || {}) };
    const auth = window.AIMEAT && window.AIMEAT.auth;
    const signedIn = !!(auth && auth.getSession && auth.getSession());
    let res;
    if (signedIn) {
      res = await authFetch(path, opts);
    } else {
      const r = await fetch(NODE_URL + path, { ...opts, headers: { 'Content-Type': 'application/json' } });
      res = await r.json().catch(() => ({ ok: false, error: { code: 'HTTP_' + r.status, message: 'The action did not answer (HTTP ' + r.status + ').' } }));
    }
    if (!res || !res.ok) throw refusal(res, 'The action failed.', 'EXTENSION_ERROR');
    return res.data;
  },
};

// ── Expose globally ──
attach('data', data);
