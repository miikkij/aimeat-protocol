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
 *   v1.0.0 — 2026-07-16 — Phase 3: batch the owner + per-agent conversations fan-out into one call.
 */
import type { Storage } from '../../storage/interface.js';
import type { ConversationSummary } from '../../storage/repositories/direct-message.repository.js';
import { runInReadScope } from '../../storage/uow/unit-of-work.js';
import { parseGaiiLoose } from '../../utils/gaii.js';

/** A conversations-list row, optionally tagged with the owning agent when it is an agent's own thread. */
export type OwnerConversation = ConversationSummary & { viaAgent?: string };

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
      const agents = await this.storage.getAgentsByOwner(ownerName).catch(() => []);
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
      return { conversations: [...own, ...agentConvs] };
    });
  }

  /** ONE batched read of every mailbox's conversations (fan-out→IN); falls back to a per-owner
   *  listConversations loop when the backend lacks the batch primitive (e.g. deprecating mongodb). */
  private async batchConversations(gaiis: string[]): Promise<Record<string, ConversationSummary[]>> {
    if (this.storage.listConversationsForOwners) return this.storage.listConversationsForOwners(gaiis);
    const out: Record<string, ConversationSummary[]> = {};
    await Promise.all(gaiis.map(async (g) => {
      const convs = await this.storage.listConversations(g).catch(() => []);
      if (convs.length) out[g] = convs;
    }));
    return out;
  }
}

/** Assemble the messaging conversations composite over the given storage. */
export function createMessagingDbService(storage: Storage): MessagingDbService {
  return new MessagingDbService(storage);
}
