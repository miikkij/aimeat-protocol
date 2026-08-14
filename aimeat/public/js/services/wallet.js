/**
 * @file public/js/services/wallet.js
 * @description Frontend wallet service — thin API-layer helpers for reading morsel balance,
 *   listing transactions, and requesting a daily allowance top-up.
 *
 * @structure
 *   - getWallet: GET /v1/wallet balance and info
 *   - getTransactions: GET /v1/wallet/transactions (paged)
 *   - requestMorsels: POST /v1/wallet/request to request a morsel allowance
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

/**
 * AIMEAT Wallet Service
 * Balance, transactions, morsel requests.
 */
import { apiGet, apiPost } from '/js/api.js';

/** Get wallet balance and info. Returns wallet object or null. */
export async function getWallet() {
  const data = await apiGet('/v1/wallet');
  return data?.data || null;
}

/** Get recent transactions. Returns array. */
export async function getTransactions(limit = 20) {
  const data = await apiGet(`/v1/wallet/transactions?per_page=${limit}`);
  return data?.data?.transactions || data?.data || [];
}

/** Request morsels (daily allowance top-up). Returns response data or throws. */
export async function requestMorsels(amount, reason) {
  const data = await apiPost('/v1/wallet/request', { amount, reason });
  if (data?.ok === false) throw new Error(data?.error?.message || 'Request failed');
  return data?.data || data;
}
