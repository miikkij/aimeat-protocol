/**
 * @file src/services/db/messaging-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Composite Application DB Service for the owner's direct-message conversations list — the
 *   ONE call behind GET /v1/messages/conversations. It resolves the owner's agent fleet a SINGLE time,
 *   then batches the conversations read for the owner AND every agent into ONE storage call
 *   (listConversationsForOwners → 3 window-function queries) instead of one listConversations per agent.
 *   The owner-aggregation rules (hide pending/blocked contacts; surface agents' EXTERNAL threads tagged
 *   `viaAgent`; skip internal own-owner peers) live here, unchanged from the route — this composes the
 *   domain, it doesn't reinvent it (the fan-out→IN rule, mirroring HomeDashboardService).
 *
 * @structure MessagingDbService.ownerConversations(ownerGhii, ownerName, { agentThreads }) → { conversations } in a read scope
 * @usage const { conversations } = await createMessagingDbService(storage).ownerConversations(ghii, owner);
 * @version-history
 *   v1.7.0 — 2026-10-21 — Group chat. The group memberships are read once (groupsOf) for the whole list.
 *     A group row is not hidden because its last writer is a pending contact, and a group the reader is
 *     in without any message of it in their mailbox gets an empty row (withEmptyGroupRows), so a person
 *     who accepted an invitation sees the group at once.
 *   v1.6.0 — 2026-10-17 — The owner's row whose last message one of their agents sent in their name
 *     carries sentByAgent and sentByAgentName, so the list says which agent instead of "You".
 *   v1.5.1 — 2026-09-26 — The owner comparisons take account names from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so a visitor never counts as the local namesake (secaudit 2026-09, F-1).
 *   v1.5.0 — 2026-09-13 — The list is organised with the owner's own record before it is returned:
 *     each row carries its section (people, own agents, a rule's heading, archive), why it is
 *     archived, and the folds inside each section (services/inbox-organize/). foldBroadcasts moved
 *     there unchanged, because a broadcast now folds inside its section rather than across the list.
 *   v1.4.0 — 2026-09-12 — `agentThreads: false` lists the owner's own mailbox only, for an app or an
 *     agent reading in the owner's name (services/owner-mailbox-reads.ts).
 *   v1.3.0 — 2026-09-06 — The copies of one broadcast collapse into a single row (foldBroadcasts),
 *     carrying the others nested and the unread count summed. Keyed on the LAST message's
 *     broadcastId, so a thread somebody answered lifts back out with nothing detecting the reply.
 *   v1.2.0 — 2026-08-22 — An owner's row in their agent's group thread is recognised and attributed.
 *     Membership is an exact participant match and a thread an agent opened names the agent, so the
 *     owner's own row matched no group at all; the lookup now also asks under the fleet's identities.
 *     `sentByAgent` names the agent when the newest message in the owner's own thread was written by
 *     one of them, which the list had been rendering as "You: …".
 *   v1.1.0 — 2026-08-16 — A group row names a person. peerGhii on a group thread was the thread's own
 *     address, which resolves to no name and no presence, so the inbox showed "support · Unknown"
 *     beside a real question. An operator now sees whoever opened the thread; the person who opened
 *     it still sees the address, tagged `groupAlias` so the client renders a thread, not a principal.
 *   v1.0.0 — 2026-07-16 — Phase 3: batch the owner + per-agent conversations fan-out into one call.
 */
import type { ConversationRecord, Storage } from '../../storage/interface.js';
import type { ConversationSummary } from '../../storage/repositories/direct-message.repository.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { organizeConversations, type InboxSection, type RowArchive, type RowFold } from '../inbox-organize/organize.js';
import { readInboxOrganize } from '../inbox-organize/record.js';

/**
 * A conversations-list row, optionally tagged with the owning agent when it is an agent's own thread,
 * and — for a GROUP thread — with what the thread actually is.
 *
 * `groupAlias` is the named address the thread was opened through (`support@operators`). Its presence
 * is what tells a client this row is a thread rather than a person, which matters because everything
 * the inbox does with `peerGhii` assumes a principal: it looks up a display name, it asks the
 * presence store whether they are online, it seeds an avatar. A thread address answers none of those,
 * and the screen said so out loud: the row read "support · Unknown".
 */
export type OwnerConversation = ConversationSummary & {
  viaAgent?: string;
  groupAlias?: string;
  participants?: string[];
  /**
   * The owner's OWN agent wrote the last message in this thread, which is a different statement from
   * `viaAgent`. `viaAgent` means the thread belongs to the agent's mailbox and the owner is looking in
   * from outside, read-only. This row is the owner's own mailbox row in a thread they can post to; only
   * the last turn was spoken by their agent. Without the distinction the list read "You: …" over an
   * agent's words, and a person cannot supervise what they are told they said themselves.
   */
  sentByAgent?: string;
  /** The agent's name as the owner sees it, when its last message was sent in the owner's name. */
  sentByAgentName?: string;
  /**
   * How many copies of one broadcast this row stands for, when it stands for more than itself.
   * Present only on a folded row; its absence means the row is one thread and nothing else.
   */
  broadcastCount?: number;
  /**
   * The other copies, newest first, carried WITH the row rather than behind a second request.
   *
   * They were already in this response before folding, so nesting them cannot make it bigger, and it
   * is the only shape that serves both floods. The broadcast RESULTS view (GET
   * /v1/messages/broadcast/:id) covers the sender's own outbound copies and nothing else; the case
   * that filled a real list was the mirror of it — one person owning all twenty recipient agents, so
   * twenty INBOUND copies landed in their single mailbox, which that view does not serve at all.
   */
  folded?: OwnerConversation[];
  /** Where the Messages list puts this row, and why (services/inbox-organize/organize.ts). */
  section?: InboxSection;
  archived?: RowArchive;
  /** The heading a group rule names, when `section` is 'group'. */
  group?: string;
  /** Present on a row that stands for several threads with one opener and subject, or one fold rule. */
  fold?: RowFold;
};

/**
 * One row per conversation. An agent's 1:1 conversation is kept in two mailboxes (the agent's sent
 * copies under the agent, the other party's replies and the owner's own messages under the owner), so
 * the list had two rows for it once anyone answered: the owner's own row and the "via agent" row, with
 * one key, both highlighted, and neither whole. The two fold into the owner's row, which keeps
 * `viaAgent` so the page reads the conversation from both mailboxes and the owner can answer in it
 * (decision-viestin-puoli-ja-merkint-kertovat-kuka-sen-kirjoitti-ja-omis, 2026-10-17). The newest
 * message decides the preview; when the agent spoke last in its own name, `sentByAgent` names it.
 */
export function mergeAgentThreads(own: OwnerConversation[], agentConvs: OwnerConversation[]): OwnerConversation[] {
  if (!agentConvs.length) return own;
  const byId = new Map(own.map(c => [c.conversationId, c] as const));
  const alone: OwnerConversation[] = [];
  for (const a of agentConvs) {
    const mine = byId.get(a.conversationId);
    if (!mine) { alone.push(a); continue; }
    const agentNewer = (a.updatedAt || '') > (mine.updatedAt || '');
    byId.set(a.conversationId, {
      ...mine,
      viaAgent: a.viaAgent,
      messageCount: mine.messageCount + a.messageCount,
      ...(agentNewer ? {
        lastMessage: a.lastMessage, lastDirection: a.lastDirection, lastSenderGhii: a.lastSenderGhii,
        updatedAt: a.updatedAt, sentByAgent: a.viaAgent, sentByAgentName: undefined,
      } : {}),
      subject: mine.subject ?? a.subject,
    });
  }
  return [...own.map(c => byId.get(c.conversationId)!), ...alone];
}

/**
 * A row for every group the reader is in and holds no message of yet.
 *
 * The list is built from the copies in a mailbox, and a member who joins later holds no copy until
 * somebody writes again (a new member does not get the history, by ruling). Without this row a person
 * who accepted an invitation saw nothing happen, and could not open the group to write the first
 * message themselves. A named thread (support) is left out: it always holds the message that opened it.
 */
export function withEmptyGroupRows(rows: OwnerConversation[], groups: Map<string, ConversationRecord>): OwnerConversation[] {
  const present = new Set(rows.map(r => r.conversationId));
  const empty: OwnerConversation[] = [];
  for (const g of groups.values()) {
    if (present.has(g.id) || g.alias) continue;
    empty.push({
      conversationId: g.id, peerGhii: `group:${g.id}`, subject: g.subject, lastMessage: '', lastDirection: 'inbound',
      lastSenderGhii: g.createdBy, messageCount: 0, unread: 0, updatedAt: g.updatedAt,
    });
  }
  return empty.length ? [...rows, ...empty] : rows;
}

export class MessagingDbService {
  constructor(private readonly storage: Storage) {}

  /**
   * The owner's full conversations list — their own accepted threads PLUS their agents' external threads
   * (tagged `viaAgent`) — in one read scope. The agent fleet is resolved once; the conversations for the
   * owner and all agents are read in ONE batched call (per-agent fan-out killed). Contacts that are
   * pending/blocked are hidden from the owner's own list (same as the single-mailbox view).
   *
   * `agentThreads: false` is the list for someone reading IN the owner's name (an app, a delegated
   * agent): the owner's own mailbox only. The agents' threads are theirs, and a word about the owner's
   * messages does not reach them. The fleet is still resolved, because recognising the owner's own row
   * in a group thread one of their agents opened needs the agents' identities, and that names nothing
   * the owner's own row does not already hold.
   */
  ownerConversations(ownerGhii: string, ownerName: string, opts: { agentThreads?: boolean } = {}): Promise<{ conversations: OwnerConversation[] }> {
    const agentThreads = opts.agentThreads ?? true;
    return runInReadScope(async () => {
      const agents = await this.storage.getAgentsByOwner(ownerName).catch(err => { logger.warn('ownerConversations: continuing after a suppressed failure', { error: String(err) }); return []; });
      const [contacts, byOwner] = await Promise.all([
        this.storage.listContacts(ownerGhii),
        this.batchConversations(agentThreads ? [ownerGhii, ...agents.map(a => a.gaii)] : [ownerGhii]),
      ]);

      // Every group the owner or one of their agents is in, read once for the whole list.
      const groups = await this.groupsOf(ownerGhii, agents.map(a => a.gaii));
      const hidden = new Set(contacts.filter(c => c.state === 'pending' || c.state === 'blocked').map(c => c.contactId));
      // A pending contact hides a 1:1 thread, which is the first-contact gate. A GROUP thread is not
      // hidden that way: joining it answered the gate, and its rows name whoever wrote last, who may be
      // a member this person never accepted one to one.
      const own = withEmptyGroupRows((byOwner[ownerGhii] ?? []).filter(c => !hidden.has(c.peerGhii) || groups.has(c.conversationId)), groups)
        // The owner's last message here was sent in their name by one of their agents: the row says
        // which, where it read "You: ..." (services/message-send-as-owner.ts).
        .map(c => (c.lastDirection === 'outbound' && c.lastSentByAgent
          ? { ...c, sentByAgent: c.lastSentByAgent, sentByAgentName: c.lastSentByAgentName }
          : c));

      // Owner-aggregation: an owner also sees conversations their OWN agents had with EXTERNAL people
      // (an agent DM'd a user from its own inbox), tagged `viaAgent`. Internal threads (peer is this same
      // owner — an agent talking to the owner or a sibling agent) are skipped: not "sent to a user".
      const agentConvs: OwnerConversation[] = [];
      for (const a of agentThreads ? agents : []) {
        for (const c of (byOwner[a.gaii] ?? [])) {
          if (localAccountName(c.peerGhii) === ownerName) continue;
          agentConvs.push({ ...c, viaAgent: a.gaii });
        }
      }
      const named = this.nameGroupThreads(ownerGhii, mergeAgentThreads(own, agentConvs), groups);
      // Sections, archive, rules and folds: what the owner decided about their own list. The same
      // answer for the page and for anyone reading in the owner's name.
      const organize = await readInboxOrganize(this.storage, ownerGhii);
      return { conversations: organizeConversations(named, organize, ownerGhii) };
    });
  }

  /**
   * Give every GROUP row a peer a person can be identified by.
   *
   * The stored `recipientGhii` on a group message is the THREAD's address, because in a group there
   * is no single other party. The conversations list derives `peerGhii` from the last message, so a
   * group row came back naming the address: no display name resolved, no presence resolved, and the
   * inbox rendered "support · Unknown" next to a real person's question.
   *
   * Who the other party is depends on who is reading, so it is answered here rather than stored:
   *
   *   - Reading as someone OTHER than the person who opened the thread (an operator reading a support
   *     request) → the peer is the person who opened it. That is a GHII, so the name, the avatar and
   *     the presence dot all work exactly as they do on a 1:1 thread.
   *   - Reading as the person who opened it → the peer stays the address, because "support" is
   *     genuinely who they wrote to. `groupAlias` tells the client to render it as a thread and not
   *     to ask whether an address is online.
   *
   * The membership comes from groupsOf, read once for the whole list.
   */
  private nameGroupThreads(readerGhii: string, rows: OwnerConversation[], byId: Map<string, ConversationRecord>): OwnerConversation[] {
    if (!rows.length || !byId.size) return rows;
    return rows.map(row => {
      const convo = byId.get(row.conversationId);
      if (!convo) return row;
      const readerOpenedIt = localAccountName(convo.createdBy) === localAccountName(readerGhii);
      const address = convo.alias ?? `group:${convo.id}`;
      // Who spoke last, when it was not this person. `viaAgent` rows are already read under the agent,
      // so the tag would say nothing there; on the owner's own row it is the whole point.
      const lastByAgent = !row.viaAgent
        && row.lastDirection === 'outbound'
        && row.lastSenderGhii
        && row.lastSenderGhii !== readerGhii
        ? row.lastSenderGhii
        : undefined;
      return {
        ...row,
        ...(lastByAgent ? { sentByAgent: lastByAgent } : {}),
        // Assigned outright rather than left to the derived value. The list derives its peer from the
        // LAST message, so on a group thread the row changed identity every time somebody replied:
        // the person who asked saw "support" until an operator answered and then saw that operator.
        // Who the other party is does not depend on who spoke last.
        peerGhii: readerOpenedIt ? address : convo.createdBy,
        groupAlias: address,
        participants: convo.participants,
        subject: row.subject ?? convo.subject,
      };
    });
  }

  /**
   * Every group thread the reader or one of their agents is in, by id. ONE query per identity.
   *
   * The membership lookup is an exact match on the participant string, and a thread an AGENT opened
   * lists the agent, not the person. So the owner's own row in their agent's support thread matched
   * nothing: it was never recognised as a group at all, and the inbox showed the thread's address
   * where a name belongs. Asking under the agents' identities as well is what finds it. The reader's
   * own membership wins: if they are named in the thread themselves, they are not in it through an
   * agent.
   */
  private async groupsOf(readerGhii: string, agentGaiis: string[]): Promise<Map<string, ConversationRecord>> {
    const lookup = async (identity: string) => this.storage.listConversationsForParticipant(identity)
      .catch(err => { logger.warn('groupsOf: continuing without group identity', { error: String(err) }); return [] as ConversationRecord[]; });
    const [own, viaAgents] = await Promise.all([lookup(readerGhii), Promise.all(agentGaiis.map(lookup))]);
    const byId = new Map(own.map(g => [g.id, g] as const));
    for (const groups of viaAgents) {
      for (const g of groups) if (!byId.has(g.id)) byId.set(g.id, g);
    }
    return byId;
  }

  /** ONE batched read of every mailbox's conversations (fan-out→IN); falls back to a per-owner
   *  listConversations loop when the backend lacks the batch primitive (e.g. deprecating mongodb). */
  private async batchConversations(gaiis: string[]): Promise<Record<string, ConversationSummary[]>> {
    if (this.storage.listConversationsForOwners) return this.storage.listConversationsForOwners(gaiis);
    const out: Record<string, ConversationSummary[]> = {};
    await Promise.all(gaiis.map(async (g) => {
      const convs = await this.storage.listConversations(g).catch(err => { logger.warn('own: continuing after a suppressed failure', { error: String(err) }); return []; });
      if (convs.length) out[g] = convs;
    }));
    return out;
  }
}

/** Assemble the messaging conversations composite over the given storage. */
export function createMessagingDbService(storage: Storage): MessagingDbService {
  return new MessagingDbService(storage);
}
