/**
 * @file contacts.ts
 * @description Framework-agnostic core for the per-owner CONTACTS (address book), shared by the
 *   REST routes (src/routes/contacts.ts) and the MCP tools (src/mcp/contacts.ts).
 *
 *   The address book is a PROJECTION over three sources, never a table of its own:
 *     1. contact-consent rows (the DM first-contact gate) — `origin` marks how a row arrived
 *        ('message' = the gate created it reactively; 'saved' = explicitly added here),
 *     2. the owner's DM conversation peers, so an outbound-only thread is a contact too,
 *     3. contact records (models/outbound-schemas.ts) — a PERSON, who may have no identity on
 *        this node at all. That is the only source that carries a name and an address.
 *
 *   The rule the first two sources live under is unchanged: nothing about a node identity is
 *   cached on a row. Display names are resolved at read time from the identity's own record, so
 *   they cannot go stale. The third source is different data with a different provenance — it is
 *   what the OWNER knows about someone the node does not have, there is no profile for it to
 *   drift from, and it never overwrites one. When such a person later PROVES that address here,
 *   promoteContactsForVerifiedEmail links the two and the projection collapses them into one row.
 *
 *   Email lookup is EXACT-match only via the same privacy-preserving hash the invite flow uses.
 * @structure ContactsError; contactKind/normalizeContactId; resolveDisplayNames;
 *   listContactsMerged; addContact (identity | person); updatePersonContact; removeContact;
 *   resolveContactEmail; resolveOwnerByVerifiedEmail; promoteContactsForVerifiedEmail.
 * @usage const { contacts } = await listContactsMerged(storage, config, ownerGhii, { q });
 * @version-history
 *   v2.0.0 — 2026-08-17 — TARGET-063. Third source (people the node does not have, kind 'mail'),
 *     display names for agents and ecosystem apps (nine agent rows read back `null` before this),
 *     existence checks for GAII/GEAI on save (a contact naming a nonexistent app was accepted),
 *     and promotion on verified email. listContactsMerged now returns { contacts, truncated }.
 *   v1.1.0 — 2026-07-19 — Add resolveOwnerByVerifiedEmail: verified-email → owner handle for
 *     email-or-handle connect (device-auth --owner), reading the full match set to assert the
 *     one-verified-email-per-account invariant instead of silently picking.
 *   v1.0.0 — 2026-07-16 — Initial: merged list, proactive save, gate-safe remove, email resolve.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ContactConsentRecord } from '../storage/interface.js';
import type { OutboundContactRecord, OutboundContactLink } from '../models/outbound-schemas.js';
import { conversationIdFor } from '../utils/messaging.js';
import { emitChange } from './event-bus.js';
import { inviteEmailHash } from './invitations.js';
import { getActiveEmailService } from './email.js';
import { ensureContact, updateContactCard, sendOutbound, OutboundError } from './outbound/outbound-service.js';
import { revokeContactHandles } from './contact-handles.js';
import { parseGaiiLoose, isValidGAII, isValidGEAI, isValidGHII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * How many contact RECORDS the projection folds in. The consent sources are naturally bounded by
 * who has messaged the owner; this one is a registry an app may write to in bulk, so it is the
 * source that can actually grow without limit. The cap is reported rather than applied silently:
 * an address book that quietly stops at N reads as "this is everyone".
 */
const MAX_PERSON_ROWS = 2000;

/** A validation/precondition failure the caller maps to its own error shape (HTTP envelope / MCP text). */
export class ContactsError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ContactsError';
  }
}

/** The four things a contact can be. `mail` is a person this node has no identity for. */
export type ContactKind = 'geai' | 'gaii' | 'ghii' | 'mail';

/**
 * The address-book id of a person with no identity here. The prefix is load-bearing three times
 * over: contactKind classifies anything without '#' or 'eco:' as a GHII, the Postgres consent key
 * is a `::` string join, and every grant surface needs a way to say "you cannot grant to this one".
 */
export const MAIL_PREFIX = 'mail:';

/** The address-book id for a contact record. */
export const mailContactId = (recordId: string): string => `${MAIL_PREFIX}${recordId}`;

/** The contact-record id behind a `mail:` address-book id, or null if that is not one. */
export const mailRecordId = (contactId: string): string | null =>
  contactId.startsWith(MAIL_PREFIX) ? contactId.slice(MAIL_PREFIX.length) : null;

/** The identity class of a contact id: person-without-identity, ecosystem app, agent, or human. */
export function contactKind(id: string): ContactKind {
  if (id.startsWith(MAIL_PREFIX)) return 'mail';
  if (id.startsWith('eco:')) return 'geai';
  if (id.includes('#')) return 'gaii';
  return 'ghii';
}

/** Normalize a save target: a bare local owner name becomes a full GHII; everything else passes
 *  through (GAII/GEAI/full GHII/`mail:`). */
export function normalizeContactId(raw: string, nodeId: string): string {
  const s = raw.trim();
  if (s.startsWith(MAIL_PREFIX)) return s;
  if (!s.includes('@') && !s.includes('#') && !s.startsWith('eco:')) return `${s.toLowerCase()}@${nodeId}`;
  return s;
}

export interface ContactRow {
  contact_id: string;
  kind: ContactKind;
  /** The name to SHOW. A node identity's own profile name wins; a person's is what the owner wrote. */
  display_name: string | null;
  /** What the owner wrote, kept beside the profile name rather than replaced by it. */
  saved_name: string | null;
  email: string | null;
  note: string | null;
  tags: string[];
  links: OutboundContactLink[];
  relation: string | null;
  state: string | null;
  origin: string;
  has_messages: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Resolve display names for every kind that has one, in one parallel sweep (contact lists are small).
 *
 * Agents and ecosystem apps were left out of the first version because only GHIIs have a
 * `GHIIRecord`; the consequence was that every agent row in every address book read back `null`,
 * so the list showed a raw `bot#alice@node` where a name was meant to be. Each kind has its own
 * record with its own `displayName` — the lookup just has to ask the right one.
 */
async function resolveDisplayNames(storage: Storage, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  await Promise.all(unique.map(async (id) => {
    try {
      const kind = contactKind(id);
      if (kind === 'ghii') {
        const rec = await storage.getGHII(id);
        if (rec?.displayName) out.set(id, rec.displayName);
      } else if (kind === 'gaii') {
        // The same name GET /v1/agents/:gaii serves unauthenticated — public by design.
        const rec = await storage.getAgent(id);
        if (rec?.displayName) out.set(id, rec.displayName);
      } else if (kind === 'geai') {
        const rec = await storage.getEcosystemApp(id);
        if (rec?.displayName) out.set(id, rec.displayName);
      }
    } catch (err) { logger.warn('resolveDisplayNames: display names are best-effort', { error: String(err) }); }
  }));
  return out;
}

/** An empty card, so every row has the same shape whether or not a person record backs it. */
function blankCard(): Pick<ContactRow, 'saved_name' | 'email' | 'note' | 'tags' | 'links' | 'relation'> {
  return { saved_name: null, email: null, note: null, tags: [], links: [], relation: null };
}

/** What the owner knows about this person, lifted off a contact record. */
function cardOf(rec: OutboundContactRecord): ReturnType<typeof blankCard> {
  return {
    saved_name: rec.name || null,
    email: rec.email,
    note: rec.notes,
    tags: rec.tags ?? [],
    links: rec.links ?? [],
    relation: rec.relation,
  };
}

/**
 * A saved person as the ADDRESS BOOK shows them.
 *
 * The stored record carries three things this shape deliberately drops. `optOutToken` is the
 * recipient's own capability (whoever holds it can unsubscribe them). `emailHash` is the
 * server-internal promotion key. The bounce and suppression counters are delivery state, which
 * belongs to the outbound surface and means nothing about a person nobody mails. Projecting here
 * rather than in each route is what stops the next surface from spreading the record and leaking
 * all three at once.
 */
export interface PersonView {
  contact_id: string;
  name: string;
  email: string;
  /** The identity this person turned out to be, once they proved the address here. */
  ghii: string | null;
  note: string | null;
  tags: string[];
  links: OutboundContactLink[];
  relation: string | null;
  created_at: string;
  updated_at: string;
}

/** The only way a contact record leaves the address book. */
export function personView(rec: OutboundContactRecord): PersonView {
  return {
    contact_id: rec.ghii ?? mailContactId(rec.id),
    name: rec.name,
    email: rec.email,
    ghii: rec.ghii,
    note: rec.notes,
    tags: rec.tags ?? [],
    links: rec.links ?? [],
    relation: rec.relation,
    created_at: rec.createdAt,
    updated_at: rec.updatedAt,
  };
}

export interface MergedContacts {
  contacts: ContactRow[];
  /** True when contact records were left out because there are more than the projection folds. */
  truncated: boolean;
}

/**
 * The merged address book: consent rows ∪ DM conversation peers ∪ contact records, enriched with
 * kind + display name. `state` narrows to one consent state (default hides blocked); `q` filters
 * on id/display name/email (case-insensitive substring).
 *
 * A contact record that has been linked to an identity does NOT get its own row: its card is
 * attached to that identity's row instead, and the row is created if neither of the first two
 * sources produced one. That is what stops the same person appearing twice once they join.
 */
export async function listContactsMerged(
  storage: Storage, ownerGhii: string,
  opts?: { state?: ContactConsentRecord['state']; q?: string },
): Promise<MergedContacts> {
  const [rows, conversations, people] = await Promise.all([
    storage.listContacts(ownerGhii, opts?.state ? { state: opts.state } : undefined),
    storage.listConversations(ownerGhii).catch(err => { logger.warn('listContactsMerged: continuing after a suppressed failure', { error: String(err) }); return []; }),
    // A consent-state filter is a question about the DM gate, which a person with no identity
    // has never been through. Asking for one is asking for identities only.
    opts?.state
      ? Promise.resolve([] as OutboundContactRecord[])
      : storage.listOutboundContacts({ ownerGhii, limit: MAX_PERSON_ROWS + 1 })
          .catch(err => { logger.warn('listContactsMerged: continuing after a suppressed failure', { error: String(err) }); return []; }),
  ]);
  const byId = new Map(rows.map(c => [c.contactId, c]));
  const messaged = new Set(conversations.map(c => c.peerGhii).filter(Boolean));

  const truncated = people.length > MAX_PERSON_ROWS;
  const personRows = truncated ? people.slice(0, MAX_PERSON_ROWS) : people;
  if (truncated) {
    logger.warn('listContactsMerged: contact records capped', { ownerGhii, cap: MAX_PERSON_ROWS, found: people.length });
  }
  // Cards for people who DO have an identity here, keyed by it — these merge onto an identity row.
  const cardByIdentity = new Map<string, OutboundContactRecord>();
  for (const p of personRows) if (p.ghii) cardByIdentity.set(p.ghii, p);

  const out: ContactRow[] = [];
  const emit = (id: string, base: Omit<ContactRow, keyof ReturnType<typeof blankCard> | 'display_name'>) => {
    const card = cardByIdentity.get(id);
    out.push({ ...base, ...(card ? cardOf(card) : blankCard()), display_name: null } as ContactRow);
  };

  for (const c of rows) {
    if (!opts?.state && c.state === 'blocked') continue;   // hidden unless explicitly requested
    emit(c.contactId, {
      contact_id: c.contactId, kind: contactKind(c.contactId),
      state: c.state, origin: c.origin ?? 'message', has_messages: messaged.has(c.contactId),
      created_at: c.createdAt, updated_at: c.updatedAt,
    });
  }
  if (!opts?.state) {
    // Conversation peers without a consent row (e.g. outbound-only threads) are contacts too.
    for (const peer of messaged) {
      if (byId.has(peer) || peer === ownerGhii) continue;
      emit(peer, {
        contact_id: peer, kind: contactKind(peer), state: null, origin: 'message',
        has_messages: true, created_at: null, updated_at: null,
      });
    }
    // Contact records: a person with no identity here gets their own row; one who HAS an identity
    // was already merged onto it above, unless neither of the first two sources produced that row.
    //
    // `byId` and not `seen` is what makes the block hold. A blocked identity is deliberately absent
    // from `out`, so testing only what was emitted would let this source put the row back — the
    // owner blocks someone, later writes their address down, and they reappear. Any identity the
    // consent table knows about has already been decided on above, whichever way it went.
    const seen = new Set(out.map(r => r.contact_id));
    for (const p of personRows) {
      const id = p.ghii ?? mailContactId(p.id);
      if (seen.has(id) || byId.has(id)) continue;
      seen.add(id);
      out.push({
        contact_id: id, kind: contactKind(id), display_name: null,
        ...cardOf(p),
        state: null, origin: 'saved', has_messages: false,
        created_at: p.createdAt, updated_at: p.updatedAt,
      });
    }
  }
  const names = await resolveDisplayNames(storage, out.map(r => r.contact_id));
  // The identity's own name wins where there is one; the owner's note is what is left.
  for (const r of out) r.display_name = names.get(r.contact_id) ?? r.saved_name ?? null;

  const q = (opts?.q ?? '').trim().toLowerCase();
  const contacts = q
    ? out.filter(r => r.contact_id.toLowerCase().includes(q)
      || (r.display_name ?? '').toLowerCase().includes(q)
      || (r.saved_name ?? '').toLowerCase().includes(q)
      || (r.email ?? '').toLowerCase().includes(q))
    : out;
  return { contacts, truncated };
}

/**
 * Is this even shaped like an identity?
 *
 * Asked of EVERY id, local or federated, and it is the check that was missing. Existence can only
 * be asked of a local id, so without a shape test anything with an `@` in it was admitted as "a
 * GHII on some other node" — an email address landed in the address book as a person on a node
 * called `example.com`, which every consumer then read as a human and failed on. The node part
 * has a grammar (`aimeat-{region}-{nnn}-{name}`); a mail host does not fit it.
 */
function isIdentityShaped(contactId: string): boolean {
  const kind = contactKind(contactId);
  if (kind === 'gaii') return isValidGAII(contactId);
  if (kind === 'geai') return isValidGEAI(contactId);
  if (kind === 'ghii') return isValidGHII(contactId);
  return false;
}

/**
 * Does this identity exist on this node?
 *
 * Only asked of a LOCAL id: a federated one lives on a node we cannot interrogate, and refusing it
 * would make a remote person unaddressable. The three kinds each have their own record, and until
 * this existed only GHII was checked — so a contact naming an app that had never been onboarded,
 * under an owner who had never registered, was accepted and stored.
 */
async function localIdentityExists(storage: Storage, config: AimeatConfig, contactId: string): Promise<boolean | null> {
  const kind = contactKind(contactId);
  const { owner, node } = parseGaiiLoose(contactId);
  if (node !== config.nodeId) return null;          // not ours to judge
  if (kind === 'ghii') return !!(await storage.getOwner(owner));
  if (kind === 'gaii') return !!(await storage.getAgent(contactId));
  if (kind === 'geai') return !!(await storage.getEcosystemApp(contactId));
  return null;
}

/** What the caller wants saved: an identity on some node, or a person who may have none. */
export type AddContactInput =
  | { contact_id: string }
  | { name: string; email: string; note?: string | null; tags?: string[]; links?: OutboundContactLink[]; relation?: string | null };

export interface AddContactResult {
  contact_id: string;
  kind: ContactKind;
  /** The consent row, when the contact is an identity. Absent for a person. */
  consent?: ContactConsentRecord;
  /** The saved person, when the contact is one. Absent for a bare identity. */
  person?: PersonView;
}

/**
 * Save a contact. One entry point for both surfaces and both shapes, so the decision of what a
 * contact IS lives here rather than once in the route and once in the MCP tool.
 */
export async function addContact(
  storage: Storage, config: AimeatConfig, ownerGhii: string, input: AddContactInput,
): Promise<AddContactResult> {
  if ('email' in input) return addPersonContact(storage, ownerGhii, input);
  return addIdentityContact(storage, config, ownerGhii, input.contact_id);
}

/** Save an identity (GHII/GAII/GEAI) to the address book (state accepted, origin 'saved'). */
async function addIdentityContact(
  storage: Storage, config: AimeatConfig, ownerGhii: string, rawContactId: string,
): Promise<AddContactResult> {
  const contactId = normalizeContactId(rawContactId, config.nodeId);
  if (contactKind(contactId) === 'mail') {
    throw new ContactsError(400, 'INVALID_INPUT', 'A saved person is added with a name and an email, not by id');
  }
  if (contactId === ownerGhii) throw new ContactsError(400, 'INVALID_INPUT', 'You cannot add yourself as a contact');
  const existing = await storage.getContact(ownerGhii, contactId);
  if (existing?.state === 'blocked') throw new ContactsError(409, 'BLOCKED', 'That contact is blocked — unblock them in Messages first');
  // Shape first, existence second. The most common wrong input here is an email address, and the
  // useful answer to it is not "no such owner" but "that is a person, save them as one".
  if (!existing && !isIdentityShaped(contactId)) {
    throw new ContactsError(400, 'INVALID_INPUT', EMAIL_RE.test(contactId)
      ? `"${contactId}" is an email address — save them as a person with a name and an email instead`
      : `"${contactId}" is not an AIMEAT identity (expected owner@node, agent#owner@node, or eco:app#owner@node)`);
  }
  // Validate the target exists when it is a LOCAL identity of any kind. Rows the gate already
  // knows may always be saved: whoever it is, they have already reached this owner.
  if (!existing) {
    const exists = await localIdentityExists(storage, config, contactId);
    if (exists === false) {
      const kind = contactKind(contactId);
      const what = kind === 'gaii' ? 'agent' : kind === 'geai' ? 'app' : 'owner';
      throw new ContactsError(404, kind === 'ghii' ? 'OWNER_NOT_FOUND' : 'CONTACT_NOT_FOUND',
        `No ${what} "${contactId}" on this node — check the id, or add them as a person with a name and an email`);
    }
  }
  const contact = await storage.setContactState(ownerGhii, contactId, 'accepted', undefined, 'saved');
  emitChange('messages', ownerGhii);
  return { contact_id: contactId, kind: contactKind(contactId), consent: contact };
}

/** Save a PERSON: someone the owner knows, who may or may not have an identity on this node. */
async function addPersonContact(
  storage: Storage, ownerGhii: string,
  input: { name: string; email: string; note?: string | null; tags?: string[]; links?: OutboundContactLink[]; relation?: string | null },
): Promise<AddContactResult> {
  // REFUSE BEFORE YOU WRITE. Whoever this address turns out to belong to has to be decided before
  // a row exists, or a blocked person is written down and then refused — which is the shape of
  // three defects this project has already paid for. The resolution costs one indexed lookup that
  // ensureContact will repeat; that is the price of the check happening in the right order.
  const clean = (input.email || '').trim().toLowerCase();
  if (EMAIL_RE.test(clean)) {
    const identity = await storage.getGHIIByEmailHash(inviteEmailHash(clean));
    const resolved = identity?.emailVerifiedAt ? identity.ghii : null;
    if (resolved === ownerGhii) {
      throw new ContactsError(400, 'INVALID_INPUT', 'That address is your own account');
    }
    if (resolved) {
      const consent = await storage.getContact(ownerGhii, resolved);
      if (consent?.state === 'blocked') {
        throw new ContactsError(409, 'BLOCKED', 'That address belongs to someone you have blocked — unblock them in Messages first');
      }
    }
  }

  let person: OutboundContactRecord;
  try {
    person = await ensureContact(storage, ownerGhii, {
      name: input.name, email: input.email, tags: input.tags, notes: input.note ?? null,
      links: input.links, relation: input.relation ?? null,
    });
  } catch (e) {
    if (e instanceof OutboundError) throw new ContactsError(e.statusCode, e.code, e.message);
    throw e;
  }
  emitChange('messages', ownerGhii);
  return {
    contact_id: person.ghii ?? mailContactId(person.id),
    kind: person.ghii ? contactKind(person.ghii) : 'mail',
    person: personView(person),
  };
}

/**
 * Update what the owner knows about a person. Reached by the person's contact id, whether that is
 * a `mail:` id or the identity they have since been linked to.
 */
export async function updatePersonContact(
  storage: Storage, ownerGhii: string, contactId: string,
  patch: { name?: string; note?: string | null; tags?: string[]; links?: OutboundContactLink[]; relation?: string | null },
): Promise<PersonView> {
  const person = await findPersonRecord(storage, ownerGhii, contactId);
  if (!person) throw new ContactsError(404, 'NOT_FOUND', 'No saved person behind that contact');
  const updated = await updateContactCard(storage, person, {
    name: patch.name, notes: patch.note, tags: patch.tags, links: patch.links, relation: patch.relation,
  });
  emitChange('messages', ownerGhii);
  return personView(updated);
}

/** The contact record behind an address-book id, by `mail:` id or by the identity it is linked to. */
async function findPersonRecord(storage: Storage, ownerGhii: string, contactId: string): Promise<OutboundContactRecord | null> {
  const recordId = mailRecordId(contactId);
  if (recordId) {
    const rec = await storage.getOutboundContact(recordId);
    // Absent and not-yours answer identically, exactly as requireOwnContact does.
    return rec && rec.ownerGhii === ownerGhii ? rec : null;
  }
  const all = await storage.listOutboundContacts({ ownerGhii, limit: MAX_PERSON_ROWS });
  return all.find(p => p.ghii === contactId) ?? null;
}

/**
 * Remove a contact from the address book.
 *
 * For an identity this never resets the DM first-contact gate: a row with message history flips
 * back to origin 'message' (the gate state survives); a pure saved row with no history is deleted.
 * Blocked rows are managed in Messages. For a person, the contact record goes; the append-only
 * send log does not, which is the same bargain DELETE /v1/outbound/contacts/:id already makes —
 * what left the node stays answerable after the address book forgets the address.
 */
export async function removeContact(
  storage: Storage, ownerGhii: string, contactId: string,
): Promise<void> {
  const person = await findPersonRecord(storage, ownerGhii, contactId);
  const consent = await storage.getContact(ownerGhii, contactId);

  if (person) {
    await storage.deleteOutboundContact(person.id);
    // A handle outlives nothing it was minted for. An app holding one for someone the owner has
    // just removed must not still be able to write to them for the rest of the window.
    revokeContactHandles(ownerGhii, contactId);
    // A linked person may ALSO have a consent row (they messaged the owner). Dropping the card
    // must not drop the messaging relationship, so the identity half falls through below.
    if (!consent) {
      emitChange('messages', ownerGhii);
      return;
    }
  } else if (!consent) {
    throw new ContactsError(404, 'NOT_FOUND', 'No such contact');
  }

  if (consent) {
    if (consent.state === 'blocked') throw new ContactsError(409, 'BLOCKED', 'Blocked contacts are managed in Messages');
    const conv = await storage.listConversation(ownerGhii, conversationIdFor(ownerGhii, contactId), { page: 1, perPage: 1 }).catch(() => ({ messages: [] }));
    if (conv.messages.length > 0) {
      await storage.setContactState(ownerGhii, contactId, consent.state, undefined, 'message');
    } else {
      await storage.deleteContact(ownerGhii, contactId);
    }
  }
  emitChange('messages', ownerGhii);
}

/**
 * Send to an address-book contact, through the door that already exists.
 *
 * This is the outbound door with a contact id in front of it, not a second way out: opt-out,
 * suppression, the rolling daily ceiling and the append-only send log all apply unchanged, and the
 * channel is chosen the same way (an AIMEAT inbox when the person has an identity here, email
 * otherwise). What it adds is the ONLY thing missing — translating an address-book id into the
 * contact record the door is keyed on.
 *
 * A contact with no record behind it cannot be reached this way, and says so. Those are identities
 * the owner saved or messaged; writing to one is a direct message, which is a different door with
 * its own consent gate, and quietly routing there would make one permission mean two things.
 */
export async function sendToContact(
  config: AimeatConfig, storage: Storage, ownerGhii: string, contactId: string,
  message: { subject: string; body: string; kind: 'transactional' | 'marketing' },
): Promise<{ channel: string; status: string; message_id: string }> {
  const person = await findPersonRecord(storage, ownerGhii, contactId);
  if (!person) {
    throw new ContactsError(422, 'NOT_REACHABLE',
      'That contact has no saved address — only a person saved with an email can be written to this way');
  }
  if (!message.subject.trim() || !message.body.trim()) {
    throw new ContactsError(400, 'INVALID_INPUT', 'Both "subject" and "body" are required');
  }
  try {
    const result = await sendOutbound(config, storage, ownerGhii, {
      contactId: person.id, kind: message.kind, subject: message.subject, body: message.body,
    });
    return { channel: result.channel, status: result.status, message_id: result.log.id };
  } catch (e) {
    if (e instanceof OutboundError) throw new ContactsError(e.statusCode, e.code, e.message);
    throw e;
  }
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

/**
 * Link every saved person carrying this address to the identity that has just PROVEN it.
 *
 * Called from the three places a verified email binding is established, and from nowhere else:
 * routes/ghii/web-verify.ts (the code is confirmed), routes/ghii/recovery.ts (recovery proves the
 * address) and services/owner-provisioning.ts (an account created with an already-proven one).
 *
 * The merge is ADDITIVE and one-way. Nothing the owner wrote is discarded — the projection keeps
 * showing their own name beside the profile name — and nothing about consent moves: if the owner
 * had blocked that identity, it stays blocked, because a stranger registering an address must not
 * be able to talk their way past a block by owning the mailbox.
 *
 * Best-effort by design: this runs on a path a person is waiting on, and a contact that fails to
 * link is a cosmetic loss, while a verification that fails to complete is an account nobody can
 * get into. Callers log and continue.
 */
export async function promoteContactsForVerifiedEmail(
  storage: Storage, emailHash: string, ghii: string,
): Promise<number> {
  if (!emailHash || !ghii) return 0;
  const pending = await storage.findUnresolvedOutboundContactsByEmailHash(emailHash);
  let linked = 0;
  for (const rec of pending) {
    // The owner's own address book never holds the owner: they reach everything anyway, and a
    // self-row would show up in every picker as somebody to grant access to.
    if (rec.ownerGhii === ghii) continue;
    await storage.updateOutboundContact({ ...rec, ghii, updatedAt: new Date().toISOString() });
    linked++;
    emitChange('messages', rec.ownerGhii);
  }
  if (linked > 0) logger.info('Contacts promoted to a verified identity', { ghii, linked });
  return linked;
}

export type ResolveOwnerByEmailResult =
  | { ok: true; ownerName: string; ghii: string }
  | { ok: false; code: 'INVALID_EMAIL' | 'NO_ACCOUNT' | 'AMBIGUOUS'; message: string };

/**
 * Resolve an account's VERIFIED email → its local owner handle, case-insensitively (same
 * privacy-preserving hash as resolveContactEmail, gated to `emailVerifiedAt`). Used where a user may
 * name their account by email instead of handle (e.g. the connector's device-auth `--owner`). The
 * email only SELECTS the target account; it is never an authentication factor.
 *
 * Enforcement is layered: a partial-unique index on `emailHash` makes >1 verified match impossible at
 * the DB, but we still read the full set and ASSERT it (log + AMBIGUOUS) rather than silently pick one,
 * so any drift is surfaced loudly. Unverified email bindings never resolve.
 */
export async function resolveOwnerByVerifiedEmail(storage: Storage, email: string): Promise<ResolveOwnerByEmailResult> {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) {
    return { ok: false, code: 'INVALID_EMAIL', message: `"${email}" is not a valid email address.` };
  }
  const verified = (await storage.getGHIIsByEmailHash(inviteEmailHash(clean))).filter(m => !!m.emailVerifiedAt);
  if (verified.length === 0) {
    return { ok: false, code: 'NO_ACCOUNT', message: 'No account on this node has that email as a verified address.' };
  }
  if (verified.length > 1) {
    // Should be impossible under the one-verified-email-per-account-per-node invariant (DB-enforced).
    logger.error('Email→owner resolution is ambiguous: >1 account shares a verified email hash', {
      matches: verified.map(m => m.ghii),
    });
    return { ok: false, code: 'AMBIGUOUS', message: 'That email maps to more than one account — contact the node operator.' };
  }
  const rec = verified[0];
  return { ok: true, ownerName: rec.ownerName ?? rec.ghii.split('@')[0], ghii: rec.ghii };
}
