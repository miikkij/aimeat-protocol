/**
 * AIMEAT Wallet Service
 * Balance, transactions.
 */
import { apiGet } from '/js/api.js';

/** Get wallet balance and info. Returns wallet object or null. */
export async function getWallet() {
  const data = await apiGet('/v1/wallet');
  return data?.data || null;
}

/** Get recent transactions. Returns array. */
export async function getTransactions(limit = 20) {
  const data = await apiGet(`/v1/wallet/transactions?limit=${limit}`);
  return data?.data?.transactions || data?.data || [];
}
