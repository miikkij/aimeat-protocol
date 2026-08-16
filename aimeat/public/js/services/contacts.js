/**
 * @file contacts.js
 * @description AIMEAT Contacts Service — the owner's address book (/v1/contacts): the merged list
 *   (saved identities ∪ DM conversation peers ∪ saved PEOPLE, with display names), saving either
 *   shape, editing what the owner knows about a person, gate-safe remove, exact-match email
 *   resolve, and the directory name-search (/v1/ghii/list) that feeds identity pickers alongside
 *   contacts.
 * @usage import * as contactsService from '/js/services/contacts.js';
 * @version-history
 *   v1.1.0 — 2026-08-17 — TARGET-063: savePerson/updatePerson for someone with no account on this
 *     node, and the list now carries their card (saved_name, email, note, tags, links, relation).
 *   v1.0.0 — 2026-07-16 — Initial: list/add/remove/resolveEmail/searchDirectory.
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** The merged address book. opts: { q, state }. Each row carries contact_id, kind
 *  (ghii|gaii|geai|mail), display_name, saved_name, email, note, tags, links, relation,
 *  state, origin and has_messages. */
export async function listContacts(opts = {}) {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.state) params.set('state', opts.state);
  const qs = params.toString();
  const resp = await apiGet(`/v1/contacts${qs ? `?${qs}` : ''}`);
  return Array.isArray(resp?.data?.contacts) ? resp.data.contacts : [];
}

/** Save an IDENTITY to the address book (bare local owner name, GHII, GAII, or GEAI). */
export async function addContact(contactId) {
  return apiPost('/v1/contacts', { contact_id: contactId });
}

/** Save a PERSON who may have no account on this node. `card` carries name, email and anything
 *  else the owner knows (note, tags, links, relation). */
export async function savePerson(card) {
  return apiPost('/v1/contacts', card);
}

/** Edit what the owner knows about a saved person. Never touches delivery state. */
export async function updatePerson(contactId, patch) {
  return apiPatch(`/v1/contacts/${encodeURIComponent(contactId)}`, patch);
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
  } catch (err) { swallowed('contacts: searchDirectory', err); return []; }
}
