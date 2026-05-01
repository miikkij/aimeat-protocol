/**
 * @file lib-capabilities.ts
 * @description aimeat-capabilities.js browser SDK library for capability discovery, invoke, and management.
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial SDK library
 */
import type { AimeatConfig } from '../config.js';

export function aimeatCapabilitiesLib(config: AimeatConfig): string {
    return `// aimeat-capabilities.js — AIMEAT Capabilities Library
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
// Usage: await AIMEAT.capabilities.list(); await AIMEAT.capabilities.invoke('id', input);
(function(global) {
'use strict';

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-capabilities.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function authFetch(path, opts) {
  const session = getSession();
  return session.fetch(path, opts);
}

// Cortex library cache (loaded libs stay in memory)
const _loadedCortex = {};

async function loadCortexLib(url) {
  if (_loadedCortex[url]) return;
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = function() { _loadedCortex[url] = true; resolve(); };
    s.onerror = function() { reject(new Error('Failed to load: ' + url)); };
    document.head.appendChild(s);
  });
}

if (!global.AIMEAT) global.AIMEAT = {};

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
      var libMatch = usage.match(/loadScript\\(['"]([^'"]+)['"]/);
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
          var fn = global[funcName] || (global.AIMEAT && global.AIMEAT[funcName]);
          if (typeof fn === 'function') {
            var start = performance.now();
            var result = await fn(input);
            var duration = Math.round(performance.now() - start);
            // Fire-and-forget telemetry
            try {
              authFetch('/v1/capabilities/' + encodeURIComponent(id) + '/telemetry', {
                method: 'POST',
                body: JSON.stringify({ duration_ms: duration, status: 'success' }),
              }).catch(function() {});
            } catch(e) {}
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
    var body = {};
    if (comment) body.comment = comment;
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

global.AIMEAT.capabilities = capabilities;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}
