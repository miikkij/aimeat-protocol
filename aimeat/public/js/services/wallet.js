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
