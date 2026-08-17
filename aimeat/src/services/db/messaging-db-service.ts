/**
 * @file src/services/db/messaging-db-service.ts
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
      return { conversations: await this.nameGroupThreads(ownerGhii, [...own, ...agentConvs]) };
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
   * ONE query for the reader's whole group membership, so this costs nothing per row.
   */
  private async nameGroupThreads(readerGhii: string, rows: OwnerConversation[]): Promise<OwnerConversation[]> {
    if (!rows.length) return rows;
    const groups = await this.storage.listConversationsForParticipant(readerGhii)
      .catch(err => { logger.warn('nameGroupThreads: continuing without group identity', { error: String(err) }); return []; });
    if (!groups.length) return rows;

    const byId = new Map(groups.map(g => [g.id, g] as const));
    return rows.map(row => {
      const convo = byId.get(row.conversationId);
      if (!convo) return row;
      const readerOpenedIt = parseGaiiLoose(convo.createdBy).owner === parseGaiiLoose(readerGhii).owner;
      const address = convo.alias ?? `group:${convo.id}`;
      return {
        ...row,
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

/** Assemble the messaging conversations composite over the given storage. */
export function createMessagingDbService(storage: Storage): MessagingDbService {
  return new MessagingDbService(storage);
}
