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

/** Accept a pending/offered work request. */
export async function acceptWork(tc) {
  return api(`/v1/work/${encodeURIComponent(tc)}/accept`, { method: 'POST' });
}

/** Reject a pending/offered work request. */
export async function rejectWork(tc) {
  return api(`/v1/work/${encodeURIComponent(tc)}/reject`, { method: 'POST' });
}

/** Deliver completed work with optional result. */
export async function deliverWork(tc, result) {
  return api(`/v1/work/${encodeURIComponent(tc)}/deliver`, {
    method: 'POST',
    body: JSON.stringify({ result }),
  });
}

/** Update work progress. */
export async function updateProgress(tc, progress, note) {
  return api(`/v1/work/${encodeURIComponent(tc)}/progress`, {
    method: 'POST',
    body: JSON.stringify({ progress, note }),
  });
}
