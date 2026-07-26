/**
 * @file src/services/db/messages-inbox-db-service.ts
 * @description Purpose-built Application DB Service for the Messages/Inbox view — the ONE call behind
 *   GET /v1/messages/overview. The inbox mounts a 6-request fan-out (requests + conversations +
 *   important-flags + tracked-responses + agents + groups); this composes all six in ONE read scope so
 *   the owner's agent fleet is resolved a single time (IdentityMap) and the conversations composition is
 *   reused (not re-implemented). Single-master: it serves the inbox mount and nothing else — the
 *   individual list endpoints stay for interactive re-fetches (filter/live-update).
 *
 * @structure MessagesInboxService.overview(ownerGhii, ownerName) → { requests, conversations, important, tracked, agents, groups }
 * @usage const inbox = await createMessagesInboxService(storage).overview(ghii, owner);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the inbox mount's 6-request fan-out into one composite.
 */
import type { Storage, DirectMessageRecord, AgentRecord } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/uow/unit-of-work.js';
import { conversationIdFor, messagePreview } from '../../utils/messaging.js';
import { listTrackedResponses } from '../tracked-response.js';
import { MessagingDbService, type OwnerConversation } from './messaging-db-service.js';
import { logger } from '../../utils/logger.js';

/** The `message-flag.<id>` key prefix marks a message the owner flagged "important" (record-presence =
 *  flagged; un-flag deletes it). Mirrors public/js/services/tracked-responses.js FLAG_PREFIX. */
const FLAG_PREFIX = 'message-flag.';

export interface InboxRequest { contactId: string; conversationId: string; preview: string; createdAt: string }
export interface InboxOverview {
  requests: InboxRequest[];
  conversations: OwnerConversation[];
  important: string[];
  tracked: unknown[];
  agents: AgentRecord[];
  groups: unknown[];
}

export class MessagesInboxService {
  private readonly messaging: MessagingDbService;
  constructor(private readonly storage: Storage) {
    this.messaging = new MessagingDbService(storage);
  }

  /**
   * The whole inbox mount for one owner in a single read scope. The six lists load concurrently; the
   * conversation composition (owner + agents' external threads) is reused from MessagingDbService, and
   * the agent fleet it resolves is the same one the `agents` list returns.
   */
  overview(ownerGhii: string, ownerName: string): Promise<InboxOverview> {
    return runInReadScope(async () => {
      const [requests, convos, importantRecs, tracked, agents, ownedGroups, memberGroups] = await Promise.all([
        this.pendingRequests(ownerGhii),
        this.messaging.ownerConversations(ownerGhii, ownerName),
        this.storage.listMemory(ownerGhii, { prefix: FLAG_PREFIX }),
        listTrackedResponses(this.storage, ownerGhii),
        this.storage.getAgentsByOwner(ownerName).catch(() => [] as AgentRecord[]),
        this.storage.listSharingGroups(ownerGhii).catch(err => { logger.warn('overview: continuing after a suppressed failure', { error: String(err) }); return []; }),
        this.storage.listSharingGroupsByMember(ownerGhii).catch(err => { logger.warn('overview: continuing after a suppressed failure', { error: String(err) }); return []; }),
      ]);

      // important = the message ids behind the flag keys (key = `message-flag.<id>`), same as the
      // frontend's listImportantMessageIds prefix-map.
      const important = importantRecs
        .filter(r => r.key.startsWith(FLAG_PREFIX))
        .map(r => r.key.slice(FLAG_PREFIX.length));

      // groups: owned + member-of, deduped by id (mirrors the owner branch of GET /v1/groups).
      const seen = new Set<string>();
      const groups = [...ownedGroups, ...memberGroups].filter(g => {
        const id = (g as { id?: string }).id ?? '';
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      return { requests, conversations: convos.conversations, important, tracked, agents, groups };
    });
  }

  /** Pending first-contact requests with their first-message preview — mirrors GET /v1/messages/requests
   *  (one batched getDirectMessagesByIds read, not getDirectMessage per pending contact). */
  private async pendingRequests(ownerGhii: string): Promise<InboxRequest[]> {
    const pending = await this.storage.listContacts(ownerGhii, { state: 'pending' });
    const firstIds = pending.map(c => c.firstMessageId).filter((x): x is string => !!x);
    const firstById = new Map<string, DirectMessageRecord>();
    if (firstIds.length) {
      const msgs = this.storage.getDirectMessagesByIds
        ? await this.storage.getDirectMessagesByIds(firstIds, ownerGhii)
        : (await Promise.all(firstIds.map(id => this.storage.getDirectMessage(id, ownerGhii)))).filter((m): m is DirectMessageRecord => !!m);
      for (const m of msgs) firstById.set(m.id, m);
    }
    return pending.map(c => {
      const first = c.firstMessageId ? firstById.get(c.firstMessageId) ?? null : null;
      return {
        contactId: c.contactId,
        conversationId: first?.conversationId ?? conversationIdFor(ownerGhii, c.contactId),
        preview: messagePreview(first?.body ?? ''),
        createdAt: c.createdAt,
      };
    });
  }
}

/** Assemble the inbox composite over the given storage. */
export function createMessagesInboxService(storage: Storage): MessagesInboxService {
  return new MessagesInboxService(storage);
}
