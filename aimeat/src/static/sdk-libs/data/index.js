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
 *   delete/list/count/discover/search/getPublic/getPublicEntry; attach('data', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-data.js"></script>
 *   await AIMEAT.data.set('key', { value }); await AIMEAT.data.get('key');
 * @version-history
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
 */
import { NODE_URL, NODE_ID } from '../_core/config.js';
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

/** The public (unauthenticated) memory read, shared by getPublic + getPublicEntry. */
async function publicEntryResponse(gaii, key) {
  const url = NODE_URL + '/v1/memory/' + encodeURIComponent(gaii) + '/' + encodeURIComponent(key) + '?soft=1';
  const r = await fetch(url);
  const res = await r.json();
  if (!res.ok) {
    if (res.error?.code === 'NOT_FOUND') return null;
    throw new Error(res.error?.message || 'Failed to read public memory');
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
    if (!res.ok) throw new Error(res.error?.message || 'Failed to set memory');
    return res.data;
  },

  // Read a single entry (falls back to public read from app creator if not found or empty).
  // Uses ?soft=1 so a missing key is a clean 200 (value null) — no browser-console 404 noise;
  // the contract is unchanged: resolves null when the key does not exist.
  // opts: { agent, ownerScope } — read from one of the owner's agents' namespaces, or
  // across the owner's whole set (GHII + agents). Omitted → unchanged behaviour.
  async get(key, opts) {
    const res = await authFetch(withParams(
      '/v1/memory/' + encodeURIComponent(key) + '?soft=1', scopeParams(opts)));
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
      } catch { /* public-read fallback is best-effort */ }
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
      throw new Error(res.error?.message || 'Failed to get memory');
    }
    return withProvenance(res);
  },

  // Update with optimistic locking
  async update(key, value, version, opts) {
    const body = { value, version, ...opts };
    const res = await authFetch('/v1/memory/' + encodeURIComponent(key), {
      method: 'PUT', body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to update memory');
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
    if (!res.ok) throw new Error(res.error?.message || 'Failed to delete memory');
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
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list memory');
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
    if (!res.ok) throw new Error(res.error?.message || 'Failed to discover public memory');
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
      if (!mineRes.ok) throw new Error(mineRes.error?.message || 'Failed to list your own public memory');
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
    if (!res.ok) throw new Error(res.error?.message || 'Failed to search memory');
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
};

// ── Expose globally ──
attach('data', data);
