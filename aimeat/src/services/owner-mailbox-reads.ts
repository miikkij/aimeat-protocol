/**
 * @file owner-mailbox-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading an owner's mailbox: WHO may, and WHAT each of them is shown. The one
 *   implementation behind the four REST read doors (inbox, conversations, one thread, overview) and
 *   the two `*_as_owner` MCP tools, so a surface cannot come to its own answer about either.
 *
 *   THREE READERS, and the difference between them is the whole design.
 *
 *   - The owner in person. An owner session, as before: everything the Messages page shows,
 *     including the threads their own agents had with other people, the agent list and the groups.
 *   - A published app acting in the owner's name, holding `messages:read`. An app grant already
 *     resolves to the owner, and `messages:send` already sends as the owner, so this is the read half
 *     of a pair that existed with one half missing. The consent screen has promised it all along:
 *     "Read direct messages addressed to you".
 *   - An agent (or an ecosystem app) holding `messages:read-as-owner`. An agent acts under its own
 *     identity, so reaching the owner's mailbox is a delegation of its own, beside
 *     `messages:send-as-owner` and `messages:delete-as-owner`, and outside every wildcard.
 *
 *   The last two see the owner's OWN mailbox and nothing next to it: no agent's threads, no agent
 *   list, no groups, no tracked-response rules. Those are other things with other permissions, and a
 *   word about messages does not reach them.
 *
 *   `messages:read` on an AGENT still means that agent's own messages (agent-inbox, agent-thread),
 *   and nothing here changes it. An agent holding only that word is refused at these doors, because
 *   the handlers below read the owner's mailbox by the owner's name, and an owner name is not a
 *   principal (security-development-dna invariant 11): letting it through would have handed every
 *   agent with the commonest messaging word its siblings' conversations.
 *
 *   A FEDERATED session is refused as well. Its `owner` is the local part of a name that belongs to
 *   another node, so the mailbox it resolves to is whichever local account happens to share that
 *   name.
 * @structure MESSAGES_READ_AS_OWNER_SCOPE · mailboxReaderOf · delegateReaderFor · readOwnerInbox ·
 *   readOwnerConversations · readOwnerThread · readOwnerOverview · noteDelegatedRead
 * @usage
 *   const reader = mailboxReaderOf(req.auth!, config.nodeId);
 *   if (!reader) → 403
 *   const { conversations } = await readOwnerConversations(storage, reader);
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial: messages:read-as-owner for agents, and the messages:read door for
 *     apps, on the four mailbox reads that were owner-session only.
 */
import type { Storage, DirectMessageRecord, ConversationRecord } from '../storage/interface.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { createMessagingDbService, type OwnerConversation } from './db/messaging-db-service.js';
import { createMessagesInboxService, type InboxOverview } from './db/messages-inbox-db-service.js';
import { withMessageProvenance } from './message-provenance.js';
import { readAgentDmThread } from './agent-dm-reads.js';
import { isParticipant } from './conversation-group.js';
import { logger } from '../utils/logger.js';

/**
 * Read the owner's mailbox as the owner. Outside every wildcard (utils/scope-coverage.ts): "Full
 * access" is one click, and nobody clicking it is deciding that an agent may read every conversation
 * they have.
 */
export const MESSAGES_READ_AS_OWNER_SCOPE = 'messages:read-as-owner';

/** What a principal's session says, and only the fields this decision reads. */
export interface MailboxPrincipal {
  sub: string;
  owner: string;
  roles: string[];
  scopes?: string[];
  federated?: boolean;
}

export type MailboxReaderKind = 'owner' | 'app' | 'delegate';

/** Somebody the mailbox doors serve, and the mailbox they reach. */
export interface MailboxReader {
  kind: MailboxReaderKind;
  /** The mailbox: always the principal's OWN owner, derived from the session. */
  ownerGhii: string;
  ownerName: string;
  /** Who is actually reading, for the audit line. */
  actor: string;
}

/**
 * Who is reading, or null when the principal is none of the three readers.
 *
 * The mailbox is `${owner}@${nodeId}` in every case. `owner` names the account, never the principal,
 * so it decides WHERE the door leads and nothing about whether it opens; the roles and the word do
 * that.
 */
export function mailboxReaderOf(auth: MailboxPrincipal, nodeId: string): MailboxReader | null {
  const roles = auth.roles ?? [];
  const scopes = auth.scopes ?? [];
  const at = (kind: MailboxReaderKind): MailboxReader => ({
    kind, ownerGhii: `${auth.owner}@${nodeId}`, ownerName: auth.owner, actor: auth.sub,
  });
  if (auth.federated) return null;
  const isApp = roles.includes('app');
  const actsForSomeone = isApp || roles.includes('agent') || roles.includes('ecosystem');
  if (!actsForSomeone && (roles.includes('owner') || roles.includes('operator'))) return at('owner');
  if (isApp) return scopeIsCovered(scopes, 'messages:read') ? at('app') : null;
  if (scopeIsCovered(scopes, MESSAGES_READ_AS_OWNER_SCOPE)) return at('delegate');
  return null;
}

/**
 * The reader for an MCP session. The tool is registered only for a principal holding the word, so
 * the session GAII is enough: the mailbox is that GAII's own owner's.
 */
export function delegateReaderFor(agentGaii: string, nodeId: string): MailboxReader {
  const { owner } = parseGaiiLoose(agentGaii);
  return { kind: 'delegate', ownerGhii: `${owner}@${nodeId}`, ownerName: owner, actor: agentGaii };
}

/**
 * The audit line for a delegated read. An agent that reads a person's correspondence leaves no trace
 * in the mailbox itself, so this line is the only record of which agent read what — the same record
 * aimeat_dm_send_as_owner and aimeat_dm_delete_as_owner keep for theirs.
 */
export function noteDelegatedRead(reader: MailboxReader, what: string, detail: Record<string, unknown> = {}): void {
  if (reader.kind !== 'delegate') return;
  logger.info('mailbox read as owner (delegated)', { agent: reader.actor, owner: reader.ownerGhii, what, ...detail });
}

/** Inbound messages from accepted contacts, newest first. Pending first-contact senders stay out. */
export async function readOwnerInbox(
  storage: Storage,
  reader: MailboxReader,
  opts: { unreadOnly?: boolean; page: number; perPage: number },
): Promise<{ messages: DirectMessageRecord[]; total: number; unread: number }> {
  const { messages, total, unread } = await storage.listInbox(reader.ownerGhii, {
    unreadOnly: opts.unreadOnly ?? false, page: opts.page, perPage: opts.perPage,
  });
  const pending = new Set((await storage.listContacts(reader.ownerGhii, { state: 'pending' })).map(c => c.contactId));
  const visible = messages.filter(m => !pending.has(m.senderGhii));
  noteDelegatedRead(reader, 'inbox', { page: opts.page });
  return { messages: await withMessageProvenance(storage, visible), total, unread };
}

/** The conversation list. The owner in person also sees their agents' threads with other people. */
export async function readOwnerConversations(
  storage: Storage,
  reader: MailboxReader,
): Promise<{ conversations: OwnerConversation[] }> {
  const result = await createMessagingDbService(storage).ownerConversations(reader.ownerGhii, reader.ownerName, {
    agentThreads: reader.kind === 'owner',
  });
  noteDelegatedRead(reader, 'conversations', { count: result.conversations.length });
  return result;
}

export type OwnerThreadResult =
  | { ok: true; messages: DirectMessageRecord[]; total: number;
      conversation: { id: string; kind: ConversationRecord['kind']; subject?: string; participants: string[]; alias?: string; created_by: string } | null }
  | { ok: false; code: 'FORBIDDEN'; message: string };

/**
 * One thread from the owner's mailbox.
 *
 * `agentGaii` reads one of the owner's agents' own threads (the "via <agent>" rows of the list). Only
 * the owner in person may, because only the owner in person is shown those rows; and only for their
 * OWN agent, verified before anything is read under that identity.
 */
export async function readOwnerThread(
  storage: Storage,
  reader: MailboxReader,
  conversationId: string,
  opts: { page: number; perPage: number; agentGaii?: string },
): Promise<OwnerThreadResult> {
  let readAs = reader.ownerGhii;
  if (opts.agentGaii) {
    if (reader.kind !== 'owner') {
      return { ok: false, code: 'FORBIDDEN', message: "An agent's own threads are shown to the owner in person only" };
    }
    const agents = await storage.getAgentsByOwner(reader.ownerName).catch(err => {
      logger.warn('readOwnerThread: continuing after a suppressed failure', { error: String(err) });
      return [];
    });
    if (!agents.some(a => a.gaii === opts.agentGaii)) {
      return { ok: false, code: 'FORBIDDEN', message: 'Not one of your agents' };
    }
    readAs = opts.agentGaii;
  }
  // `agentGaii` reads under the agent, and a GROUP thread's copies live in the owner's mailbox rather
  // than the agent's, so the plain owner-keyed read returned an empty thread for exactly the rows the
  // list had just advertised. readAgentDmThread resolves that the way the agent's own door does.
  const result = opts.agentGaii
    ? await readAgentDmThread(storage, opts.agentGaii, conversationId, { page: opts.page, perPage: opts.perPage })
    : await storage.listConversation(readAs, conversationId, { page: opts.page, perPage: opts.perPage });
  // A group thread carries its membership, which is part of reading it for a PARTICIPANT and for
  // nobody else: anyone holding the id would otherwise get the subject, the creator and every
  // participant back with the empty page.
  const found = await storage.getConversation(conversationId);
  const conversation = found && isParticipant(found, readAs) ? found : null;
  noteDelegatedRead(reader, 'thread', { conversationId, page: opts.page });
  return {
    ok: true,
    messages: await withMessageProvenance(storage, result.messages),
    total: result.total,
    conversation: conversation ? {
      id: conversation.id, kind: conversation.kind, subject: conversation.subject,
      participants: conversation.participants, alias: conversation.alias, created_by: conversation.createdBy,
    } : null,
  };
}

/**
 * The whole inbox in one call. The owner in person gets every part the Messages page mounts; anyone
 * reading in their name gets the messages part (requests, conversations, flags, names) with the other
 * parts present and empty, so a client written against the owner's shape keeps working.
 *
 * `unreadOnly` and `limit` narrow the conversation list after it is composed, newest first, and
 * `conversationsTotal` says how many matched before the limit. Without either, the list is whole,
 * which is what the Messages page mounts. They exist for a chat: a busy mailbox is a hundred and
 * fifty threads, and an AI asked "what is waiting for me" needs the first few.
 */
export async function readOwnerOverview(
  storage: Storage,
  reader: MailboxReader,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<InboxOverview & { conversationsTotal: number }> {
  const data = await createMessagesInboxService(storage).overview(reader.ownerGhii, reader.ownerName, {
    inPerson: reader.kind === 'owner',
  });
  const matching = opts.unreadOnly ? data.conversations.filter(c => c.unread > 0) : data.conversations;
  const conversations = opts.limit ? matching.slice(0, opts.limit) : matching;
  noteDelegatedRead(reader, 'overview', { conversations: conversations.length });
  return { ...data, conversations, conversationsTotal: matching.length };
}
