/**
 * @file data/index.js
 * @description The aimeat-data library (SDK-libs migration — config-path proof lib). Exposes
 *   AIMEAT.data: the Memory API (Tier 1, JWT auth via AIMEAT.auth) with an app-creator public-read
 *   fallback, and Micro-Memory (Tier 0.5, GET-based). This is the componentized ESM source esbuild
 *   bundles to the IIFE served, unchanged, at /v1/libs/aimeat-data.js. It is the first migrated lib
 *   that actually CONSUMES the shared config: `NODE_URL` (direct public/micro fetches) and `NODE_ID`
 *   (the `creator@node` construction in get()'s fallback) come from _core/config — the exact values
 *   the legacy string form baked in via `${config.baseUrl}` / `${config.nodeId}`.
 * @structure imports NODE_URL/NODE_ID (config), authFetch (session), attach (namespace); data.set/
 *   get/getEntry/update/delete/list/search/getPublic; data.micro()/microSets(); attach('data', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-data.js"></script>
 *   await AIMEAT.data.set('key', { value }); await AIMEAT.data.get('key');
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-data.ts; NODE_URL/NODE_ID now from _core/config.
 */
import { NODE_URL, NODE_ID } from '../_core/config.js';
import { authFetch } from '../_core/session.js';
import { attach } from '../_core/namespace.js';

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
  async get(key) {
    const res = await authFetch('/v1/memory/' + encodeURIComponent(key) + '?soft=1');
    var val = res.ok ? res.data.value : null;
    var isEmpty = val == null || (typeof val === 'object' && Object.keys(val).length === 0);
    if (!isEmpty) return val;
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

  // Read full entry metadata
  async getEntry(key) {
    const res = await authFetch('/v1/memory/' + encodeURIComponent(key));
    if (!res.ok) {
      if (res.error?.code === 'NOT_FOUND') return null;
      throw new Error(res.error?.message || 'Failed to get memory');
    }
    return res.data;
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

  // Delete an entry
  async delete(key) {
    const res = await authFetch('/v1/memory/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to delete memory');
    return res.data;
  },

  // List all memory keys
  async list(opts) {
    const params = new URLSearchParams();
    if (opts?.prefix) params.set('prefix', opts.prefix);
    if (opts?.visibility) params.set('visibility', opts.visibility);
    if (opts?.tags) params.set('tags', opts.tags.join(','));
    const qs = params.toString();
    const res = await authFetch('/v1/memory' + (qs ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list memory');
    return res.data;
  },

  // Search memory entries
  async search(query, opts) {
    const params = new URLSearchParams({ q: query });
    if (opts?.visibility) params.set('visibility', opts.visibility);
    const res = await authFetch('/v1/memory/search?' + params.toString());
    if (!res.ok) throw new Error(res.error?.message || 'Failed to search memory');
    return res.data;
  },

  // Read another agent's public memory (no auth needed). ?soft=1: missing (or hidden)
  // keys resolve null via a clean 200 instead of logging a console 404.
  async getPublic(gaii, key) {
    const url = NODE_URL + '/v1/memory/' + encodeURIComponent(gaii) + '/' + encodeURIComponent(key) + '?soft=1';
    const r = await fetch(url);
    const res = await r.json();
    if (!res.ok) {
      if (res.error?.code === 'NOT_FOUND') return null;
      throw new Error(res.error?.message || 'Failed to read public memory');
    }
    return res.data.value;
  },

  // ── Micro-Memory (Tier 0.5, GET-based) ──
  micro(setName, accessCode) {
    const base = NODE_URL + '/v1/mm';

    function mmUrl(params) {
      const p = new URLSearchParams(params);
      if (accessCode) p.set('access_code', accessCode);
      return base + '?' + p.toString();
    }

    async function mmFetch(params) {
      const r = await fetch(mmUrl(params));
      const res = await r.json();
      if (!res.ok) throw new Error(res.error?.message || 'Micro-memory operation failed');
      return res.data;
    }

    return {
      // Add or overwrite a key
      async add(key, value) {
        return mmFetch({ op: 'add', set: setName, key, value: typeof value === 'object' ? JSON.stringify(value) : String(value) });
      },
      // Modify existing key
      async mod(key, value) {
        return mmFetch({ op: 'mod', set: setName, key, value: typeof value === 'object' ? JSON.stringify(value) : String(value) });
      },
      // Delete a key
      async del(key) {
        return mmFetch({ op: 'del', set: setName, key });
      },
      // List all entries in this set
      async list() {
        return mmFetch({ op: 'list', set: setName });
      },
      // Batch add multiple key-value pairs
      async batch(entries) {
        const params = { op: 'batch', set: setName };
        Object.keys(entries).forEach((k, i) => {
          params['key' + i] = k;
          const v = entries[k];
          params['value' + i] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        });
        return mmFetch(params);
      },
      // Configure visibility
      async config(visibility) {
        const params = { op: 'config', set: setName, access: visibility };
        return mmFetch(params);
      },
      // Get a single key value
      async get(key) {
        const d = await mmFetch({ op: 'list', set: setName });
        return d.entries?.[key] ?? null;
      },
    };
  },

  // List all micro-memory sets
  async microSets() {
    const url = NODE_URL + '/v1/mm?op=list';
    const r = await fetch(url);
    const res = await r.json();
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list micro-memory sets');
    return res.data;
  },
};

// ── Expose globally ──
attach('data', data);
