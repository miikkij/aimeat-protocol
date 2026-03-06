/**
 * AIMEAT Work Service
 * Work inbox, sent items, and ratings.
 */
import { apiGet, api } from '/js/api.js';

/** Load work inbox items. Returns array. */
export async function listInbox() {
  const data = await apiGet('/v1/work/inbox');
  return data?.data?.items || data?.data || [];
}

/** Load sent work items. Returns array. */
export async function listSent() {
  const data = await apiGet('/v1/work/sent');
  return data?.data?.items || data?.data || [];
}

/** Submit a rating for a completed work item. */
export async function submitRating(workId, rating, comment) {
  return api(`/v1/work/${encodeURIComponent(workId)}/rate`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment }),
  });
}
