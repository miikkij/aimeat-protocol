/**
 * @file contacts.js
 * @description AIMEAT Contacts Service — the owner's address book (/v1/contacts): merged list
 *   (saved contacts ∪ DM conversation peers with display names), proactive save, gate-safe
 *   remove, exact-match email resolve, and the directory name-search (/v1/ghii/list) that feeds
 *   identity pickers alongside contacts.
 * @usage import * as contactsService from '/js/services/contacts.js';
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: list/add/remove/resolveEmail/searchDirectory.
 */
import { apiGet, apiPost, apiDelete } from '/js/api.js';

/** The merged address book. opts: { q, state }. Returns [{ contact_id, kind, display_name, state, origin, has_messages }]. */
export async function listContacts(opts = {}) {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.state) params.set('state', opts.state);
  const qs = params.toString();
  const resp = await apiGet(`/v1/contacts${qs ? `?${qs}` : ''}`);
  return Array.isArray(resp?.data?.contacts) ? resp.data.contacts : [];
}

/** Save an identity to the address book (bare local owner name, GHII, GAII, or GEAI). */
export async function addContact(contactId) {
  return apiPost('/v1/contacts', { contact_id: contactId });
}

/** Remove a contact — never resets the DM first-contact gate (messaged rows keep their state). */
export async function removeContact(contactId) {
  return apiDelete(`/v1/contacts/${encodeURIComponent(contactId)}`);
}

/** EXACT-match email → local owner: { found, ghii?, owner?, display_name?, can_invite? }. */
export async function resolveEmail(email) {
  const resp = await apiPost('/v1/contacts/resolve', { email });
  return resp?.data ?? { found: false };
}

/** Directory name-search over owners who opted into the member directory ("List me in the member
 *  directory"). Returns [{ ghii, name, display_name }] best-effort. */
export async function searchDirectory(q) {
  try {
    const resp = await apiGet(`/v1/ghii/list?q=${encodeURIComponent(q)}`);
    const list = resp?.data?.humans ?? [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
