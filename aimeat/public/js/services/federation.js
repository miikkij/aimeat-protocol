/**
 * AIMEAT Federation Service
 * Federation directory.
 */
import { apiGet } from '/js/api.js';

/** List federated peers. Returns array. */
export async function listPeers() {
  const data = await apiGet('/v1/federation/directory');
  return data?.data?.peers || [];
}
