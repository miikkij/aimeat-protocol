import type { MeatConfig } from '../config.js';

/**
 * aimeat-wallet.js — Morsel economy client library
 * Depends on AIMEAT.auth being loaded first.
 */
export function aimeatWalletLib(config: MeatConfig): string {
  return `// aimeat-wallet.js — AIMEAT Wallet Library (Morsel Economy)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
// Usage: const bal = await AIMEAT.wallet.balance(); console.log(bal.available);
(function(global) {
'use strict';

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-wallet.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function authFetch(path, opts) {
  const session = getSession();
  return session.fetch(path, opts);
}

const wallet = {
  // Get current balance
  async balance() {
    const res = await authFetch('/v1/wallet');
    if (!res.ok) throw new Error(res.error?.message || 'Failed to get balance');
    return res.data;
  },

  // Get transaction history
  async transactions(opts) {
    const params = new URLSearchParams();
    if (opts?.type) params.set('type', opts.type);
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.per_page) params.set('per_page', String(opts.per_page));
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const res = await authFetch('/v1/wallet/transactions' + (qs ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.error?.message || 'Failed to get transactions');
    return res.data;
  },

  // Legacy: get transaction history
  async history(opts) {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const res = await authFetch('/v1/wallet/history' + (qs ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.error?.message || 'Failed to get history');
    return res.data;
  },

  // Request morsels (e.g. daily allowance)
  async request(amount, reason) {
    const res = await authFetch('/v1/wallet/request', {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Failed to request morsels');
    return res.data;
  },

  // ── UI Component: Balance Badge ──
  mountBadge(selector, opts) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) throw new Error('Badge element not found: ' + selector);

    const badge = document.createElement('div');
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:#1e293b;border:1px solid #475569;border-radius:20px;color:#e2e8f0;font-family:system-ui;font-size:13px;cursor:pointer';
    badge.innerHTML = '<span style="font-size:16px">\\u{1F36A}</span><span class="aimeat-balance">...</span>';
    el.appendChild(badge);

    async function refresh() {
      try {
        const data = await wallet.balance();
        badge.querySelector('.aimeat-balance').textContent = (data.available ?? data.balance ?? 0) + ' morsels';
      } catch(e) {
        badge.querySelector('.aimeat-balance').textContent = '--';
      }
    }

    refresh();

    // Auto-refresh
    const interval = setInterval(refresh, (opts?.refreshInterval || 30) * 1000);

    // Click to show transaction history
    badge.addEventListener('click', async () => {
      try {
        const txData = await wallet.transactions({ limit: 10 });
        const txList = (txData.transactions || []).map(tx =>
          '<div style="padding:4px 0;border-bottom:1px solid #334155;font-size:12px">'
          + '<span style="color:' + (tx.amount >= 0 ? '#4ade80' : '#f87171') + '">'
          + (tx.amount >= 0 ? '+' : '') + tx.amount + '</span> '
          + (tx.type || '') + ' '
          + '<span style="color:#94a3b8">' + new Date(tx.timestamp).toLocaleString() + '</span>'
          + '</div>'
        ).join('');

        const popup = document.createElement('div');
        popup.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:99999';
        popup.innerHTML = '<div style="background:#1e293b;border:1px solid #475569;border-radius:12px;padding:16px;max-width:320px;width:90%;color:#e2e8f0;font-family:system-ui;max-height:60vh;overflow-y:auto">'
          + '<h4 style="margin:0 0 12px">\\u{1F36A} Wallet Transactions</h4>'
          + (txList || '<p style="color:#94a3b8;font-size:13px">No transactions yet.</p>')
          + '<button style="margin-top:12px;padding:6px 16px;background:#334155;color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;font-size:13px">Close</button>'
          + '</div>';
        popup.querySelector('button').addEventListener('click', () => popup.remove());
        popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });
        document.body.appendChild(popup);
      } catch(e) { console.error('AIMEAT wallet:', e); }
    });

    return { refresh, destroy: () => { clearInterval(interval); badge.remove(); } };
  },
};

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.wallet = wallet;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
