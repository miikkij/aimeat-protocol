/**
 * @file contacts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT Contacts Service — the owner's address book (/v1/contacts): the merged list
 *   (saved identities ∪ DM conversation peers ∪ saved PEOPLE, with display names), saving either
 *   shape, editing what the owner knows about a person, gate-safe remove, exact-match email
 *   resolve, and the directory name-search (/v1/ghii/list) that feeds identity pickers alongside
 *   contacts.
 * @usage import * as contactsService from '/js/services/contacts.js';
 * @version-history
 *   v1.2.0 — 2026-08-30 — The Contacts page in the poster face: listContacts takes include
 *     ('together,invites'), together(id) reads what the owner and one person share, invite() sends
 *     an invitation to join here with no organism behind it, getPrompt() fetches the chat prompt.
 *   v1.1.0 — 2026-08-17 — TARGET-063: savePerson/updatePerson for someone with no account on this
 *     node, and the list now carries their card (saved_name, email, note, tags, links, relation).
 *   v1.0.0 — 2026-07-16 — Initial: list/add/remove/resolveEmail/searchDirectory.
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** The merged address book. opts: { q, state, include }. Each row carries contact_id, kind
 *  (ghii|gaii|geai|mail), display_name, saved_name, email, note, tags, links, relation, state,
 *  origin, has_messages, owner (an agent's or app's person), the last message (last_message_at,
 *  last_message, last_sender, message_count, conversation_id), and with include 'together' the
 *  shared_organisms of a person, with 'invites' the owner's open invitation on a mail row. */
export async function listContacts(opts = {}) {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.state) params.set('state', opts.state);
  if (opts.include) params.set('include', opts.include);
  const qs = params.toString();
  const resp = await apiGet(`/v1/contacts${qs ? `?${qs}` : ''}`);
  return Array.isArray(resp?.data?.contacts) ? resp.data.contacts : [];
}

/** What the owner and one person (a ghii) have in common: { organisms, workspaces, agents }. */
export async function together(contactId) {
  const resp = await apiGet(`/v1/contacts/${encodeURIComponent(contactId)}/together`);
  return resp?.data ?? { organisms: [], workspaces: [], agents: [] };
}

/** Invite a person to join here, no organism behind it. Returns the envelope
 *  ({ ok, data: { invitation, email_sent, accept_url } } or { ok: false, error }). */
export async function invite(email, message) {
  return apiPost('/v1/contacts/invite', { email, ...(message ? { message } : {}) });
}

/** The prompt for keeping the address book from a chat connected over MCP. */
export async function getPrompt() {
  const resp = await apiGet('/v1/templates/contacts-mcp');
  return resp?.data?.prompt ?? '';
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
