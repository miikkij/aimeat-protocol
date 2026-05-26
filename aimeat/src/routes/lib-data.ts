import type { AimeatConfig } from '../config.js';

/**
 * aimeat-data.js — Memory & Micro-Memory client library
 * Depends on AIMEAT.auth being loaded first.
 */
export function aimeatDataLib(config: AimeatConfig): string {
    return `// aimeat-data.js — AIMEAT Data Library (Memory + Micro-Memory)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
// Usage: await AIMEAT.data.set('key', {value}); await AIMEAT.data.get('key');
(function(global) {
'use strict';

const NODE_URL = (function() {
  const meta = document.querySelector('meta[name="aimeat-node"]');
  if (meta) return meta.getAttribute('content').replace(/\\/$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return '${config.baseUrl}';
})();

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-data.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function authFetch(path, opts) {
  const session = getSession();
  return session.fetch(path, opts);
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

  // Read a single entry (falls back to public read from app creator if not found in own namespace)
  async get(key) {
    const res = await authFetch('/v1/memory/' + encodeURIComponent(key));
    if (res.ok) return res.data.value;
    if (res.error?.code === 'NOT_FOUND') {
      // Fallback: try public read from app creator's namespace
      var creator = document.querySelector('meta[name="aimeat-creator"]')?.getAttribute('content');
      if (!creator) {
        var m = location.pathname.match(/\\/v1\\/apps\\/([^/]+)\\//);
        if (m) creator = decodeURIComponent(m[1]);
      }
      if (creator) {
        try {
          var pub = await data.getPublic(creator, key);
          if (pub != null) return pub;
        } catch(e) {}
      }
      return null;
    }
    throw new Error(res.error?.message || 'Failed to get memory');
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
      method: 'PUT', body: JSON.stringify(body)
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

  // Read another agent's public memory (no auth needed)
  async getPublic(gaii, key) {
    const url = NODE_URL + '/v1/memory/' + encodeURIComponent(gaii) + '/' + encodeURIComponent(key);
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
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.data = data;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
