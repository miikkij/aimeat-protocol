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
 * @structure MessagingDbService.ownerConversations(ownerGhii, ownerName) → { conversations } in a read scope
 * @usage const { conversations } = await createMessagingDbService(storage).ownerConversations(ghii, owner);
 * @version-history
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
import type { Storage } from '../../storage/interface.js';
import type { ConversationSummary } from '../../storage/repositories/direct-message.repository.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { parseGaiiLoose } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

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
};

export class MessagingDbService {
  constructor(private readonly storage: Storage) {}

  /**
   * The owner's full conversations list — their own accepted threads PLUS their agents' external threads
   * (tagged `viaAgent`) — in one read scope. The agent fleet is resolved once; the conversations for the
   * owner and all agents are read in ONE batched call (per-agent fan-out killed). Contacts that are
   * pending/blocked are hidden from the owner's own list (same as the single-mailbox view).
   */
  ownerConversations(ownerGhii: string, ownerName: string): Promise<{ conversations: OwnerConversation[] }> {
    return runInReadScope(async () => {
      const agents = await this.storage.getAgentsByOwner(ownerName).catch(err => { logger.warn('ownerConversations: continuing after a suppressed failure', { error: String(err) }); return []; });
      const [contacts, byOwner] = await Promise.all([
        this.storage.listContacts(ownerGhii),
        this.batchConversations([ownerGhii, ...agents.map(a => a.gaii)]),
      ]);

      const hidden = new Set(contacts.filter(c => c.state === 'pending' || c.state === 'blocked').map(c => c.contactId));
      const own = (byOwner[ownerGhii] ?? []).filter(c => !hidden.has(c.peerGhii));

      // Owner-aggregation: an owner also sees conversations their OWN agents had with EXTERNAL people
      // (an agent DM'd a user from its own inbox), tagged `viaAgent`. Internal threads (peer is this same
      // owner — an agent talking to the owner or a sibling agent) are skipped: not "sent to a user".
      const agentConvs: OwnerConversation[] = [];
      for (const a of agents) {
        for (const c of (byOwner[a.gaii] ?? [])) {
          if (parseGaiiLoose(c.peerGhii).owner === ownerName) continue;
          agentConvs.push({ ...c, viaAgent: a.gaii });
        }
      }
      const named = await this.nameGroupThreads(ownerGhii, [...own, ...agentConvs], agents.map(a => a.gaii));
      return { conversations: foldBroadcasts(named) };
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
   * ONE query per identity for the whole group membership, so this costs nothing per row.
   *
   * The membership lookup is an exact match on the participant string, and a thread an AGENT opened
   * lists the agent, not the person. So the owner's own row in their agent's support thread matched
   * nothing here: it was never recognised as a group at all, and the inbox showed the thread's address
   * where a name belongs. Asking under the agents' identities as well is what finds it, and the
   * thread is recognised for what it is.
   */
  private async nameGroupThreads(readerGhii: string, rows: OwnerConversation[], agentGaiis: string[] = []): Promise<OwnerConversation[]> {
    if (!rows.length) return rows;
    const lookup = async (identity: string) => this.storage.listConversationsForParticipant(identity)
      .catch(err => { logger.warn('nameGroupThreads: continuing without group identity', { error: String(err) }); return []; });
    const [own, viaAgents] = await Promise.all([
      lookup(readerGhii),
      Promise.all(agentGaiis.map(async gaii => ({ groups: await lookup(gaii) }))),
    ]);
    if (!own.length && !viaAgents.some(a => a.groups.length)) return rows;

    // The reader's own membership wins: if they are named in the thread themselves, they are not in it
    // through an agent.
    const byId = new Map(own.map(g => [g.id, g] as const));
    for (const { groups } of viaAgents) {
      for (const g of groups) if (!byId.has(g.id)) byId.set(g.id, g);
    }
    return rows.map(row => {
      const convo = byId.get(row.conversationId);
      if (!convo) return row;
      const readerOpenedIt = parseGaiiLoose(convo.createdBy).owner === parseGaiiLoose(readerGhii).owner;
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

/**
 * Collapse the copies of one broadcast into a single row.
 *
 * One announcement to twenty recipients is twenty separate 1:1 threads, and that is deliberate: each
 * recipient answers privately, and the answer belongs to them. What it is not is twenty rows in one
 * list within the same minute, which is what a real inbox looked like on 2026-09-06 — a list of 149
 * conversations whose three unread ones were buried under the repetition.
 *
 * THE RULE IS THE LAST MESSAGE'S BROADCAST ID, and everything follows from that one choice. A copy
 * nobody has answered still ends on the announcement, so it folds. The moment someone REPLIES their
 * thread's newest message is the reply, which carries no broadcastId, and their row lifts out on its
 * own with nothing having to detect a reply. An answer cannot be folded away.
 *
 * A row is grouped by the broadcast AND by whose mailbox it came from: `viaAgent` rows are an agent's
 * outbound copies read from outside, and the owner's own rows are what arrived. Folding those two
 * together would put "what my agent sent" and "what I received" under one heading, which is two
 * different facts.
 *
 * A group of one is left alone: there is nothing to fold, and a lone copy that renders as a broadcast
 * would be a worse row than the thread it actually is.
 */
export function foldBroadcasts(rows: OwnerConversation[]): OwnerConversation[] {
  const groups = new Map<string, OwnerConversation[]>();
  const singles: OwnerConversation[] = [];
  for (const row of rows) {
    if (!row.broadcastId) { singles.push(row); continue; }
    const key = `${row.broadcastId} ${row.viaAgent ?? ''}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const out = [...singles];
  for (const copies of groups.values()) {
    if (copies.length === 1) { out.push(copies[0]); continue; }
    copies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const [head, ...rest] = copies;
    out.push({
      ...head,
      // The badge is what the person is owed: unread in a folded row means unread ANYWHERE under it,
      // or opening the newest copy would clear a count that belonged to nineteen other threads.
      unread: copies.reduce((n, c) => n + c.unread, 0),
      broadcastCount: copies.length,
      folded: rest,
    });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** Assemble the messaging conversations composite over the given storage. */
export function createMessagingDbService(storage: Storage): MessagingDbService {
  return new MessagingDbService(storage);
}
