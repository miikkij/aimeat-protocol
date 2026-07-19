/**
 * @file capabilities/index.js
 * @description The aimeat-capabilities library (SDK-libs migration Phase 1). Exposes
 *   AIMEAT.capabilities — discovery (list/search/get), invocation (client-side cortex + server-side
 *   /v1/capabilities/:id/invoke), management (create/update/delete/mine), testing and vouching, all
 *   over the AIMEAT.auth session. Componentized ESM source esbuild bundles to the IIFE served,
 *   unchanged, at /v1/libs/aimeat-capabilities.js. Ported verbatim from lib-capabilities.ts.
 * @structure imports getSession/authFetch (session) + attach (namespace); loadCortexLib(); the
 *   `capabilities` object; attach('capabilities', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-capabilities.js"></script>
 *   await AIMEAT.capabilities.list(); await AIMEAT.capabilities.invoke('id', input);
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-capabilities.ts (SDK-libs migration Phase 1).
 */
import { getSession, authFetch } from '../_core/session.js';
import { attach } from '../_core/namespace.js';

// Cortex library cache (loaded libs stay in memory)
const _loadedCortex = {};

async function loadCortexLib(url) {
  if (_loadedCortex[url]) return;
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = function () { _loadedCortex[url] = true; resolve(undefined); };
    s.onerror = function () { reject(new Error('Failed to load: ' + url)); };
    document.head.appendChild(s);
  });
}

const capabilities = {

  // ── Discovery ──

  async list(filters) {
    var params = new URLSearchParams();
    if (filters) {
      if (filters.search) params.set('search', filters.search);
      if (filters.tags) params.set('tags', filters.tags.join(','));
      if (filters.callable !== undefined) params.set('callable', String(filters.callable));
      if (filters.authRequired) params.set('authRequired', filters.authRequired);
      if (filters.source_type) params.set('source_type', filters.source_type);
      if (filters.status) params.set('status', filters.status);
      if (filters.page) params.set('page', String(filters.page));
      if (filters.per_page) params.set('per_page', String(filters.per_page));
    }
    var qs = params.toString();
    var res = await authFetch('/v1/capabilities' + (qs ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list capabilities');
    return res.data;
  },

  async search(query) {
    return capabilities.list({ search: query });
  },

  async get(id) {
    var res = await authFetch('/v1/capabilities/' + encodeURIComponent(id));
    if (!res.ok) throw new Error(res.error?.message || 'Capability not found');
    return res.data;
  },

  // ── Invocation ──

  async invoke(id, input, opts) {
    var cap = await capabilities.get(id);
    var mode = (opts && opts.mode) || 'normal';

    // Client-side cortex invoke
    if (cap.source && cap.source.type === 'cortex') {
      var usage = cap.usage || '';
      // Try to load the cortex lib
      var libMatch = usage.match(/loadScript\(['"]([^'"]+)['"]/);
      if (libMatch) {
        await loadCortexLib(libMatch[1]);
      }
      // Find the export function
      if (cap.exports && cap.exports.length > 0) {
        // If id contains export name like "cortex:name:funcName"
        var parts = id.split(':');
        var funcName = parts.length >= 3 ? parts[2] : null;
        if (funcName) {
          // Search global scope for the function
          var fn = window[funcName] || (window.AIMEAT && window.AIMEAT[funcName]);
          if (typeof fn === 'function') {
            var start = performance.now();
            var result = await fn(input);
            var duration = Math.round(performance.now() - start);
            // Fire-and-forget telemetry
            try {
              authFetch('/v1/capabilities/' + encodeURIComponent(id) + '/telemetry', {
                method: 'POST',
                body: JSON.stringify({ duration_ms: duration, status: 'success' }),
              }).catch(function () {});
            } catch { /* telemetry is fire-and-forget */ }
            return result;
          }
        }
      }
      throw new Error('Cortex capability loaded but export function not found. Use direct loadScript() instead.');
    }

    // Server-side invoke (extensions, webhooks)
    var res = await authFetch('/v1/capabilities/' + encodeURIComponent(id) + '/invoke' + (mode === 'raw' ? '?mode=raw' : ''), {
      method: 'POST',
      body: JSON.stringify({ input: input || {} }),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Invoke failed');
    return res.data.result !== undefined ? res.data.result : res.data;
  },

  // ── Management ──

  async create(record) {
    var res = await authFetch('/v1/capabilities', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to create capability');
    return res.data;
  },

  async update(id, updates) {
    var res = await authFetch('/v1/capabilities/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to update capability');
    return res.data;
  },

  async delete(id) {
    var res = await authFetch('/v1/capabilities/' + encodeURIComponent(id), {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to delete capability');
    return res.data;
  },

  async mine() {
    var session = getSession();
    return capabilities.list({ owner: session.ghii || session.owner });
  },

  // ── Testing ──

  async test(id, input) {
    var res = await authFetch('/v1/capabilities/' + encodeURIComponent(id) + '/test', {
      method: 'POST',
      body: JSON.stringify({ input: input || {} }),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Test failed');
    return res.data;
  },

  // ── Vouching ──

  async vouch(id, comment) {
    var body = comment ? { comment } : {};
    var res = await authFetch('/v1/capabilities/' + encodeURIComponent(id) + '/vouch', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Vouch failed');
    return res.data;
  },

  async unvouch(id) {
    var res = await authFetch('/v1/capabilities/' + encodeURIComponent(id) + '/vouch', {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(res.error?.message || 'Unvouch failed');
    return res.data;
  },
};

attach('capabilities', capabilities);
