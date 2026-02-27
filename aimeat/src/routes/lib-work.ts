import type { MeatConfig } from '../config.js';

/**
 * aimeat-work.js — Actions & work exchange client library
 * Depends on AIMEAT.auth being loaded first.
 */
export function aimeatWorkLib(config: MeatConfig): string {
  return `// aimeat-work.js — AIMEAT Work Library (Actions, Catalogue & Work Exchange)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
// Usage: const actions = await AIMEAT.work.catalogue(); await AIMEAT.work.request(actionId, providerGaii, input);
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
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-work.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function authFetch(path, opts) {
  const session = getSession();
  return session.fetch(path, opts);
}

async function publicFetch(path) {
  const r = await fetch(NODE_URL + path);
  return r.json();
}

const work = {
  // ── Catalogue (public, no auth) ──

  // Browse action catalogue
  async catalogue(opts) {
    const params = new URLSearchParams();
    if (opts?.search) params.set('search', opts.search);
    if (opts?.category) params.set('category', opts.category);
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.per_page) params.set('per_page', String(opts.per_page));
    const qs = params.toString();
    const res = await publicFetch('/v1/catalogue' + (qs ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.error?.message || 'Failed to browse catalogue');
    return res.data;
  },

  // Get action details
  async getAction(actionId) {
    const res = await publicFetch('/v1/catalogue/' + encodeURIComponent(actionId));
    if (!res.ok) {
      if (res.error?.code === 'NOT_FOUND') return null;
      throw new Error(res.error?.message || 'Failed to get action');
    }
    return res.data;
  },

  // Browse agent directory
  async agents(opts) {
    const params = new URLSearchParams();
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.per_page) params.set('per_page', String(opts.per_page));
    const qs = params.toString();
    const res = await publicFetch('/v1/catalogue/agents' + (qs ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list agents');
    return res.data;
  },

  // Get node stats
  async stats() {
    const res = await publicFetch('/v1/stats');
    if (!res.ok) throw new Error(res.error?.message || 'Failed to get stats');
    return res.data;
  },

  // Catalogue change detection hash
  async hash() {
    const res = await publicFetch('/v1/catalogue/hash');
    if (!res.ok) throw new Error(res.error?.message || 'Failed to get hash');
    return res.data;
  },

  // ── Work Requests (Tier 1, JWT auth) ──

  // Submit a work request
  async request(actionId, providerGaii, input, opts) {
    const body = {
      action_id: actionId,
      provider_gaii: providerGaii,
      input,
      ...opts,
    };
    const res = await authFetch('/v1/work/request', {
      method: 'POST', body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to submit work request');
    return res.data;
  },

  // Submit batch work requests
  async batch(requests) {
    const res = await authFetch('/v1/work/batch', {
      method: 'POST', body: JSON.stringify({ requests }),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to submit batch');
    return res.data;
  },

  // ── Provider Inbox ──

  // Get pending work items (provider perspective)
  async inbox() {
    const res = await authFetch('/v1/work/inbox');
    if (!res.ok) throw new Error(res.error?.message || 'Failed to get inbox');
    return res.data;
  },

  // ── Work Status & Actions ──

  // Get work status by tracking code
  async status(trackingCode) {
    const res = await authFetch('/v1/work/' + encodeURIComponent(trackingCode));
    if (!res.ok) throw new Error(res.error?.message || 'Failed to get work status');
    return res.data;
  },

  // Accept work (provider)
  async accept(trackingCode) {
    const res = await authFetch('/v1/work/' + encodeURIComponent(trackingCode) + '/accept', {
      method: 'POST',
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to accept work');
    return res.data;
  },

  // Mark work as in_progress (provider)
  async progress(trackingCode) {
    const res = await authFetch('/v1/work/' + encodeURIComponent(trackingCode) + '/progress', {
      method: 'POST',
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to update progress');
    return res.data;
  },

  // Reject work (provider)
  async reject(trackingCode, reason) {
    const res = await authFetch('/v1/work/' + encodeURIComponent(trackingCode) + '/reject', {
      method: 'POST', body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to reject work');
    return res.data;
  },

  // Deliver work output (provider)
  async deliver(trackingCode, output, metadata) {
    const body = { output };
    if (metadata) body.metadata = metadata;
    const res = await authFetch('/v1/work/' + encodeURIComponent(trackingCode) + '/deliver', {
      method: 'POST', body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to deliver work');
    return res.data;
  },

  // Rate a delivery (requester)
  async rate(trackingCode, rating, comment) {
    const body = { rating };
    if (comment) body.comment = comment;
    const res = await authFetch('/v1/work/' + encodeURIComponent(trackingCode) + '/rate', {
      method: 'POST', body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to rate work');
    return res.data;
  },

  // ── Convenience: Poll for completion ──
  async waitFor(trackingCode, opts) {
    const interval = opts?.interval || 2000;
    const timeout = opts?.timeout || 60000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const data = await work.status(trackingCode);
      if (data.status === 'delivered' || data.status === 'rated' || data.status === 'completed') {
        return data;
      }
      if (data.status === 'rejected' || data.status === 'expired' || data.status === 'failed') {
        throw new Error('Work ' + data.status + ': ' + (data.output || trackingCode));
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('Work timed out after ' + timeout + 'ms');
  },
};

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.work = work;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
