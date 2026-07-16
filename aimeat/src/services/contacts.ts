/**
 * @file contacts.ts
 * @description Framework-agnostic core for the per-owner CONTACTS (address book), shared by the
 *   REST routes (src/routes/contacts.ts) and the MCP tools (src/mcp/contacts.ts). Builds on the
 *   existing contact-consent rows (the DM first-contact gate): `origin` marks how a row arrived
 *   ('message' = the gate created it reactively; 'saved' = explicitly added here). The merged
 *   list view unions the consent rows with the owner's DM conversation peers and resolves display
 *   names at read time (nothing cached on the row). Email lookup is EXACT-match only via the same
 *   privacy-preserving hash the invite flow uses.
 * @structure ContactsError; contactKind; listContactsMerged; saveContact; removeContact; resolveContactEmail.
 * @usage const { contacts } = await listContactsMerged(storage, config, ownerGhii, { q });
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: merged list, proactive save, gate-safe remove, email resolve.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ContactConsentRecord } from '../storage/interface.js';
import { conversationIdFor } from '../utils/messaging.js';
import { emitChange } from './event-bus.js';
import { inviteEmailHash } from './invitations.js';
import { getActiveEmailService } from './email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A validation/precondition failure the caller maps to its own error shape (HTTP envelope / MCP text). */
export class ContactsError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ContactsError';
  }
}

/** The identity class of a contact id: ecosystem app, agent, or human. */
export function contactKind(id: string): 'geai' | 'gaii' | 'ghii' {
  if (id.startsWith('eco:')) return 'geai';
  if (id.includes('#')) return 'gaii';
  return 'ghii';
}

/** Normalize a save target: a bare local owner name becomes a full GHII; everything else passes
 *  through (GAII/GEAI/full GHII). */
export function normalizeContactId(raw: string, nodeId: string): string {
  const s = raw.trim();
  if (!s.includes('@') && !s.includes('#') && !s.startsWith('eco:')) return `${s.toLowerCase()}@${nodeId}`;
  return s;
}

export interface ContactRow {
  contact_id: string;
  kind: 'geai' | 'gaii' | 'ghii';
  display_name: string | null;
  state: string | null;
  origin: string;
  has_messages: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** Resolve display names for the ghii-kind ids in one parallel sweep (contact lists are small). */
async function displayNames(storage: Storage, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(id => contactKind(id) === 'ghii'))];
  await Promise.all(unique.map(async (id) => {
    try {
      const rec = await storage.getGHII(id);
      if (rec?.displayName) out.set(id, rec.displayName);
    } catch { /* display names are best-effort */ }
  }));
  return out;
}

/** The merged address book: saved/gate contact rows ∪ DM conversation peers, enriched with kind +
 *  display name. `state` narrows to one consent state (default hides blocked); `q` filters on
 *  id/display name (case-insensitive substring). */
export async function listContactsMerged(
  storage: Storage, ownerGhii: string,
  opts?: { state?: ContactConsentRecord['state']; q?: string },
): Promise<ContactRow[]> {
  const [rows, conversations] = await Promise.all([
    storage.listContacts(ownerGhii, opts?.state ? { state: opts.state } : undefined),
    storage.listConversations(ownerGhii).catch(() => []),
  ]);
  const byId = new Map(rows.map(c => [c.contactId, c]));
  const messaged = new Set(conversations.map(c => c.peerGhii).filter(Boolean));

  const out: ContactRow[] = [];
  for (const c of rows) {
    if (!opts?.state && c.state === 'blocked') continue;   // hidden unless explicitly requested
    out.push({
      contact_id: c.contactId, kind: contactKind(c.contactId), display_name: null,
      state: c.state, origin: c.origin ?? 'message', has_messages: messaged.has(c.contactId),
      created_at: c.createdAt, updated_at: c.updatedAt,
    });
  }
  if (!opts?.state) {
    // Conversation peers without a consent row (e.g. outbound-only threads) are contacts too.
    for (const peer of messaged) {
      if (byId.has(peer) || peer === ownerGhii) continue;
      out.push({ contact_id: peer, kind: contactKind(peer), display_name: null, state: null, origin: 'message', has_messages: true, created_at: null, updated_at: null });
    }
  }
  const names = await displayNames(storage, out.map(r => r.contact_id));
  for (const r of out) r.display_name = names.get(r.contact_id) ?? null;

  const q = (opts?.q ?? '').trim().toLowerCase();
  return q
    ? out.filter(r => r.contact_id.toLowerCase().includes(q) || (r.display_name ?? '').toLowerCase().includes(q))
    : out;
}

/** Save a contact to the address book (state accepted, origin 'saved'). Throws ContactsError on
 *  self-add, a blocked row, or an unknown local owner. */
export async function saveContact(
  storage: Storage, config: AimeatConfig, ownerGhii: string, rawContactId: string,
): Promise<ContactConsentRecord> {
  const contactId = normalizeContactId(rawContactId, config.nodeId);
  if (contactId === ownerGhii) throw new ContactsError(400, 'INVALID_INPUT', 'You cannot add yourself as a contact');
  const existing = await storage.getContact(ownerGhii, contactId);
  if (existing?.state === 'blocked') throw new ContactsError(409, 'BLOCKED', 'That contact is blocked — unblock them in Messages first');
  // Validate the target exists when it is a LOCAL human identity; rows already known to the
  // gate (any kind) may always be saved.
  if (!existing && contactKind(contactId) === 'ghii') {
    const [name, node] = contactId.split('@');
    if (node === config.nodeId && !(await storage.getOwner(name))) {
      throw new ContactsError(404, 'OWNER_NOT_FOUND', `No owner named "${name}" on this node`);
    }
  }
  const contact = await storage.setContactState(ownerGhii, contactId, 'accepted', undefined, 'saved');
  emitChange('messages', ownerGhii);
  return contact;
}

/** Remove a contact from the address book WITHOUT resetting the DM first-contact gate: a row with
 *  message history flips back to origin 'message' (the gate state survives); a pure saved row with
 *  no history is deleted. Blocked rows are managed in Messages. Throws ContactsError. */
export async function removeContact(
  storage: Storage, ownerGhii: string, contactId: string,
): Promise<void> {
  const existing = await storage.getContact(ownerGhii, contactId);
  if (!existing) throw new ContactsError(404, 'NOT_FOUND', 'No such contact');
  if (existing.state === 'blocked') throw new ContactsError(409, 'BLOCKED', 'Blocked contacts are managed in Messages');
  const conv = await storage.listConversation(ownerGhii, conversationIdFor(ownerGhii, contactId), { page: 1, perPage: 1 }).catch(() => ({ messages: [] }));
  if (conv.messages.length > 0) {
    await storage.setContactState(ownerGhii, contactId, existing.state, undefined, 'message');
  } else {
    await storage.deleteContact(ownerGhii, contactId);
  }
  emitChange('messages', ownerGhii);
}

export type ResolveEmailResult =
  | { found: true; ghii: string; owner: string; display_name: string | null }
  | { found: false; can_invite: boolean };

/** EXACT-match email → local owner (privacy-preserving hash equality; no enumeration). Not found
 *  → can_invite signals whether an email invitation could be sent. Throws ContactsError on a bad email. */
export async function resolveContactEmail(storage: Storage, email: string): Promise<ResolveEmailResult> {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) throw new ContactsError(400, 'INVALID_INPUT', 'A valid "email" is required');
  const rec = await storage.getGHIIByEmailHash(inviteEmailHash(clean));
  if (rec) return { found: true, ghii: rec.ghii, owner: rec.ghii.split('@')[0], display_name: rec.displayName ?? null };
  return { found: false, can_invite: !!getActiveEmailService()?.enabled };
}
