/**
 * @file src/services/db/messages-inbox-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Purpose-built Application DB Service for the Messages/Inbox view — the ONE call behind
 *   GET /v1/messages/overview. The inbox mounts a 6-request fan-out (requests + conversations +
 *   important-flags + tracked-responses + agents + groups); this composes all six in ONE read scope so
 *   the owner's agent fleet is resolved a single time (IdentityMap) and the conversations composition is
 *   reused (not re-implemented). Single-master: it serves the inbox mount and nothing else — the
 *   individual list endpoints stay for interactive re-fetches (filter/live-update).
 *
 * @structure MessagesInboxService.overview(ownerGhii, ownerName, { inPerson }) → { requests, conversations, important, tracked, agents, groups, peerNames, peerAvatars }
 *   · MessagesInboxService.pendingRequests(ownerGhii) → InboxRequest[] · requestBody(body) · REQUEST_BODY_MAX
 * @usage const inbox = await createMessagesInboxService(storage).overview(ghii, owner);
 * @version-history
 *   v1.6.0 — 2026-11-08 — A request carries `body`, its first message with line breaks (cut at
 *     REQUEST_BODY_MAX), so the person reads all of it before accepting; a phone showed two lines of a
 *     140-character preview and no way to open the rest. pendingRequests is public and also serves
 *     GET /v1/messages/requests, which had its own copy of the same read.
 *   2026-11-04 — No per-id read for a storage without getDirectMessagesByIds: it is required on Storage
 *     (codebase analysis 2026-11-03, item D-e).
 *   v1.5.0 — 2026-10-19 — peerAvatars: the picture of every on-screen agent (services/agent-avatar.ts).
 *   v1.4.0 — 2026-10-09 — The agents go out without their webhook signing secret (agentRecordView),
 *     found by e2e-secret-canary-sweep (secrets audit 2026-10-09).
 *   v1.3.0 — 2026-09-13 — peerNames also covers the rows folded under another and, on a folded row,
 *     who opened each thread and to whom, which is how the Messages list names them.
 *   v1.2.0 — 2026-09-12 — `inPerson: false`: the messages part only, for an app or an agent reading in
 *     the owner's name (services/owner-mailbox-reads.ts).
 *   v1.1.0 — 2026-08-03 — peerNames: resolve every on-screen peer's display name (conversation peers,
 *     their owners, request contacts) in the same read scope, so the inbox mount stops fanning out one
 *     GET /v1/ghii|/v1/agents per peer from the browser (~48 requests on a busy account).
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the inbox mount's 6-request fan-out into one composite.
 */
import type { Storage, DirectMessageRecord, AgentRecord } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { conversationIdFor, messagePreview } from '../../utils/messaging.js';
import { listTrackedResponses } from '../tracked-response.js';
import { MessagingDbService, type OwnerConversation } from './messaging-db-service.js';
import { logger } from '../../utils/logger.js';
import { agentRecordView, type AgentRecordView } from '../agent-record-view.js';
import { readAvatarsOrEmpty, type AvatarView } from '../agent-avatar.js';

/** The `message-flag.<id>` key prefix marks a message the owner flagged "important" (record-presence =
 *  flagged; un-flag deletes it). Mirrors public/js/services/tracked-responses.js FLAG_PREFIX. */
const FLAG_PREFIX = 'message-flag.';

/** The most of a request's first message that goes out with the request list. A message body may
 *  be 50 000 characters; the list carries every pending request, so one is cut here, with a mark. */
export const REQUEST_BODY_MAX = 4000;

/** The first message as the person reads it before accepting: line breaks kept, cut at
 *  REQUEST_BODY_MAX with an ellipsis. */
export function requestBody(body: string): string {
  const text = body.trim();
  return text.length > REQUEST_BODY_MAX ? `${text.slice(0, REQUEST_BODY_MAX - 1)}…` : text;
}

/** One pending first-contact request. `preview` is one flattened line for a row; `body` is the first
 *  message with its line breaks, so the person can read all of it before accepting or blocking. */
export interface InboxRequest { contactId: string; conversationId: string; preview: string; body: string; createdAt: string }
export interface InboxOverview {
  requests: InboxRequest[];
  conversations: OwnerConversation[];
  important: string[];
  tracked: unknown[];
  agents: AgentRecordView[];
  groups: unknown[];
  /** Display name per on-screen principal id (conversation peers, their owners, request contacts).
   *  '' = looked up but not resolvable here (e.g. a federated peer) — the client keeps the handle. */
  peerNames: Record<string, string>;
  /** The picture of every on-screen agent that has one, by GAII: the owner's own and the peers'. */
  peerAvatars: Record<string, AvatarView>;
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
   *
   * `inPerson: false` is the overview for someone reading IN the owner's name: the messages part only.
   * The agent fleet, the sharing groups and the tracked-response rules are not messages, so they come
   * back present and empty rather than read, and the conversation list is the owner's own mailbox.
   */
  overview(ownerGhii: string, ownerName: string, opts: { inPerson?: boolean } = {}): Promise<InboxOverview> {
    const inPerson = opts.inPerson ?? true;
    return runInReadScope(async () => {
      // Every part is started inside its own async function, so a storage call that throws while this
      // array is being built rejects ITS promise instead of escaping the array. The difference is not
      // cosmetic: an escape skips Promise.all, and the parts already started reject with nobody
      // listening (test/unit/node-mcp-error-flag.test.ts drives a storage whose every method throws).
      const part = <T>(f: () => Promise<T>): Promise<T> => (async () => f())();
      const [requests, convos, importantRecs, tracked, agents, ownedGroups, memberGroups] = await Promise.all([
        part(() => this.pendingRequests(ownerGhii)),
        part(() => this.messaging.ownerConversations(ownerGhii, ownerName, { agentThreads: inPerson })),
        part(() => this.storage.listMemory(ownerGhii, { prefix: FLAG_PREFIX })),
        part(async () => inPerson ? listTrackedResponses(this.storage, ownerGhii) : []),
        part(async () => inPerson ? this.storage.getAgentsByOwner(ownerName).catch(() => [] as AgentRecord[]) : [] as AgentRecord[]),
        part(async () => inPerson ? this.storage.listSharingGroups(ownerGhii).catch(err => { logger.warn('overview: continuing after a suppressed failure', { error: String(err) }); return []; }) : []),
        part(async () => inPerson ? this.storage.listSharingGroupsByMember(ownerGhii).catch(err => { logger.warn('overview: continuing after a suppressed failure', { error: String(err) }); return []; }) : []),
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

      const peerNames = await this.resolvePeerNames(convos.conversations, requests);
      // Every on-screen agent's picture, the owner's own and the peers', in one read
      // (services/agent-avatar.ts), so the list draws them without a request per row.
      const agentIds = [...agents.map(a => a.gaii), ...Object.keys(peerNames).filter(id => id.includes('#'))];
      const avatars = await readAvatarsOrEmpty(this.storage, agentIds, logger.warn.bind(logger), 'GET /v1/messages/overview');
      const peerAvatars = Object.fromEntries(avatars);

      // The agents without their webhook signing secret (services/agent-record-view.ts).
      return { requests, conversations: convos.conversations, important, tracked, agents: agents.map(agentRecordView), groups, peerNames, peerAvatars };
    });
  }

  /**
   * Display names for every principal the inbox renders: each conversation's peer, the OWNER behind an
   * agent/app peer ('agent#owner@node' → 'owner@node', the person-group header), and each pending
   * request's contact. Mirrors the client's per-peer GET /v1/ghii/:ghii | /v1/agents/:gaii lookups —
   * agents by GAII, humans by GHII — but as parallel PK reads in this read scope instead of ~48 HTTP
   * round-trips. An id that doesn't resolve locally (federated peer) maps to '' so the client knows it
   * was looked up and falls back to the handle without re-fetching.
   */
  private async resolvePeerNames(convos: OwnerConversation[], requests: InboxRequest[]): Promise<Record<string, string>> {
    const ids = new Set<string>();
    const ownerKeyOf = (id: string) => { const h = id.indexOf('#'); return h >= 0 ? id.slice(h + 1) : id; };
    for (const c of convos) {
      // A folded row is filed under who opened it, and each copy under it named by who it went to,
      // so those names are resolved here too rather than fetched one by one by the page.
      for (const r of [c, ...(c.folded ?? [])]) {
        if (r.peerGhii) { ids.add(r.peerGhii); ids.add(ownerKeyOf(r.peerGhii)); }
        if (c.fold) { if (r.openedBy) ids.add(r.openedBy); if (r.openedTo) ids.add(r.openedTo); }
      }
    }
    for (const r of requests) if (r.contactId) ids.add(r.contactId);

    const peerNames: Record<string, string> = {};
    const missed = (err: unknown) => { logger.warn('resolvePeerNames: continuing after a suppressed failure', { error: String(err) }); return null; };
    await Promise.all([...ids].map(async (id) => {
      const name = id.includes('#')
        ? (await this.storage.getAgent(id).catch(missed))?.displayName
        : (await this.storage.getGHII(id).catch(missed))?.displayName;
      peerNames[id] = (name ?? '').trim();
    }));
    return peerNames;
  }

  /** Pending first-contact requests with their first message, as a preview line and as the whole body
   *  (one batched getDirectMessagesByIds read, not getDirectMessage per pending contact). Serves both
   *  GET /v1/messages/overview and GET /v1/messages/requests. */
  async pendingRequests(ownerGhii: string): Promise<InboxRequest[]> {
    const pending = await this.storage.listContacts(ownerGhii, { state: 'pending' });
    const firstIds = pending.map(c => c.firstMessageId).filter((x): x is string => !!x);
    const firstById = new Map<string, DirectMessageRecord>();
    if (firstIds.length) {
      const msgs = await this.storage.getDirectMessagesByIds(firstIds, ownerGhii);
      for (const m of msgs) firstById.set(m.id, m);
    }
    return pending.map(c => {
      const first = c.firstMessageId ? firstById.get(c.firstMessageId) ?? null : null;
      return {
        contactId: c.contactId,
        conversationId: first?.conversationId ?? conversationIdFor(ownerGhii, c.contactId),
        preview: messagePreview(first?.body ?? ''),
        body: requestBody(first?.body ?? ''),
        createdAt: c.createdAt,
      };
    });
  }
}

/** Assemble the inbox composite over the given storage. */
export function createMessagesInboxService(storage: Storage): MessagesInboxService {
  return new MessagesInboxService(storage);
}
