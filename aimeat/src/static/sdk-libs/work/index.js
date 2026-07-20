/**
 * @file work/index.js
 * @description The aimeat-work library (SDK-libs migration Phase 2). Exposes AIMEAT.work — action
 *   catalogue browsing (public) plus the work-exchange lifecycle (request/batch/inbox/status/accept/
 *   progress/reject/deliver/rate + a waitFor poll helper). Authenticated calls go through the
 *   AIMEAT.auth session; public catalogue/stats reads go direct to NODE_URL. Componentized ESM source
 *   esbuild bundles to the IIFE served, unchanged, at /v1/libs/aimeat-work.js. Ported verbatim from
 *   lib-work.ts; NODE_URL now comes from _core/config.
 * @structure imports NODE_URL (config) + authFetch (session) + attach (namespace); publicFetch();
 *   the `work` object; attach('work', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-work.js"></script>
 *   const actions = await AIMEAT.work.catalogue();
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-work.ts (SDK-libs migration Phase 2).
 */
import { NODE_URL } from '../_core/config.js';
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-work.js');
import { attach } from '../_core/namespace.js';

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
    const body = /** @type {Record<string, any>} */ ({ output });
    if (metadata) body.metadata = metadata;
    const res = await authFetch('/v1/work/' + encodeURIComponent(trackingCode) + '/deliver', {
      method: 'POST', body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to deliver work');
    return res.data;
  },

  // Rate a delivery (requester)
  async rate(trackingCode, rating, comment) {
    const body = /** @type {Record<string, any>} */ ({ rating });
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
attach('work', work);
