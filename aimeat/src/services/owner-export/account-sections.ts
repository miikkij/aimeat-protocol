/**
 * @file src/services/owner-export/account-sections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sections of a person's data export (GDPR Articles 15 and 20), one at a time. Moved
 *   from routes/owners/export.ts, where the route built the whole export as one object and sent it with
 *   one res.json(): on the largest account of a production node that string passed V8's limit of about
 *   a billion characters, and the export answered 500 after 108 seconds (2026-11-26). Each section is
 *   now yielded as soon as it is read, and a list that grows with the account (the memory records, the
 *   AI provenance records, the agents) is an ExportList read in pages, so neither the JSON route nor
 *   the ZIP job holds the whole account at once.
 *
 *   WHAT EACH SECTION HOLDS is unchanged from the route's version history (export.ts): the owner's and
 *   every agent's memory records (credentials masked, organism content named), work, transactions,
 *   board posts, consents with their audit trail, flags, file metadata, messages, disputes, the
 *   personal node, memberships, chat instances, and the sections of export-sections.ts and
 *   export-records.ts.
 *
 *   TWO SECTIONS ARE OPTIONAL. `memories` and `ai_provenance` are the largest lists an account holds;
 *   the background export writes them as NDJSON files of their own when the person chose them
 *   (services/owner-export/build.ts), and leaves them out of account.json. The JSON route keeps both.
 * @structure ExportList · ownerExportSections(deps, input) · memoryPages(...) · provenancePages(...)
 * @usage
 *   for await (const [key, value] of ownerExportSections(deps, { name, owner, reader, memories: true, provenance: true })) …
 * @version-history
 *   v1.0.0 — 2026-11-26 — Moved from routes/owners/export.ts and made a generator
 *     (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, WorkRecord, MemoryRecord, OwnerRecord } from '../../storage/interface.js';
import { calculateTrustScore } from '../trust.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { getPendingConsentAudit } from '../consent/audit-buffer.js';
import { presentMemories } from '../classification/present-memory.js';
import type { ContentReader } from '../classification/reader.js';
import { memoryTarget } from '../classification/labels.js';
import { scopeOrganism } from '../classification/policy.js';
import { exportExtraSections, exportAgentMessages } from './export-sections.js';
import { exportAccountRecords } from './export-records.js';
import { isValidGHII } from '../../utils/gaii.js';
import { serviceNamespaceOf } from '../../utils/service-namespace.js';

/** A list read in pages: the JSON writer streams it as an array, the ZIP job as NDJSON lines. */
export class ExportList {
  constructor(readonly items: () => AsyncIterable<unknown>) {}
}

export interface SectionDeps { storage: Storage; config: AimeatConfig }

export interface SectionInput {
  /** The account name (`alice`). */
  name: string;
  owner: OwnerRecord;
  /** Who reads: the classification reader the memory values pass (credentials masked). */
  reader: ContentReader;
  /** The owner's and the agents' memory records inline (the JSON route) or left out (the ZIP job). */
  memories: boolean;
  /** The AI provenance records inline (the JSON route) or left out (the ZIP job). */
  provenance: boolean;
}

/** Memory records read per page, and AI provenance records per page (the store's own ceiling). */
const MEMORY_PAGE = 200;
const PROVENANCE_PAGE = 500;

/** One work item this identity was to do, as the export shows it: the other side is the requester. */
function workProvidedView(w: WorkRecord) {
  return {
    tracking_code: w.trackingCode, action_id: w.actionId, status: w.status, requester_gaii: w.requesterGaii,
    cost: w.cost, rating: w.rating, created_at: w.createdAt, updated_at: w.updatedAt,
  };
}

/** One work item this identity asked for, as the export shows it: the other side is the provider. */
function workRequestedView(w: WorkRecord) {
  return {
    tracking_code: w.trackingCode, action_id: w.actionId, status: w.status, provider_gaii: w.providerGaii,
    cost: w.cost, rating: w.rating, created_at: w.createdAt, updated_at: w.updatedAt,
  };
}

/** A memory record as the export shows it. */
function memoryView(m: MemoryRecord) {
  return { key: m.key, value: m.value, visibility: m.visibility, tags: m.tags, version: m.version, created_at: m.createdAt, updated_at: m.updatedAt };
}

/**
 * Every memory record of one namespace, a page at a time, through the one presentation of memory values
 * (classification reader + credential mask, TARGET-082). NO leave() (decided by Jouni 2026-09-30): this
 * is the person's legal right to their own data, so an organism's record held under their name or an
 * agent's comes out whatever its classification, and `organismKey` hears each such key. `skip` leaves
 * out keys another namespace already gave (the service namespace's copy of an own key).
 */
export async function* memoryPages(
  storage: Storage, reader: ContentReader, namespace: string,
  organismKey: (key: string) => void, skip?: Set<string>, seen?: Set<string>,
): AsyncGenerator<ReturnType<typeof memoryView>> {
  let after: string | undefined;
  for (;;) {
    const page = await storage.listMemory(namespace, { limit: MEMORY_PAGE, ...(after !== undefined ? { after } : {}) });
    if (page.length === 0) return;
    after = page[page.length - 1].key;
    const kept = skip ? page.filter(r => !skip.has(r.key)) : page;
    for (const r of await presentMemories(reader, kept)) {
      if (scopeOrganism(memoryTarget(r.ownerGaii, r.key).scope)) organismKey(r.key);
      seen?.add(r.key);
      yield memoryView(r);
    }
    if (page.length < MEMORY_PAGE) return;
  }
}

/** The owner's own records, then the records this node's services keep for the account (a key the
 *  account's own namespace holds is shown once, from there). */
export async function* ownerMemoryPages(storage: Storage, reader: ContentReader, ghii: string, organismKey: (key: string) => void) {
  const own = new Set<string>();
  yield* memoryPages(storage, reader, ghii, organismKey, undefined, own);
  if (isValidGHII(ghii)) yield* memoryPages(storage, reader, serviceNamespaceOf(ghii), organismKey, own);
}

/** Every AI provenance record of the account, newest first, by keyset pages (no count, no offset). */
export async function* provenancePages(storage: Storage, ghii: string) {
  let before: { generatedAt: string; id: string } | undefined;
  for (;;) {
    const { items } = await storage.listAiProvenance({ ownerGhii: ghii, limit: PROVENANCE_PAGE, noTotal: true, ...(before ? { before } : {}) });
    for (const r of items) {
      yield { id: r.id, principal: r.principal, content_hash: r.contentHash, generated_at: r.generatedAt, created_at: r.createdAt, record: r.record };
    }
    if (items.length < PROVENANCE_PAGE) return;
    const last = items[items.length - 1];
    before = { generatedAt: last.generatedAt, id: last.id };
  }
}

/**
 * The export's sections in the order the JSON route has always answered them. A value is plain data or
 * an ExportList. Sections that depend on an earlier one (the disputes on the agents' work) come after it,
 * and the generator reads each list to its end before it goes on, as every consumer does.
 */
export async function* ownerExportSections(deps: SectionDeps, input: SectionInput): AsyncGenerator<[string, unknown]> {
  const { storage } = deps;
  const { name, owner, reader } = input;
  const ghiiRecord = await storage.getGHIIByOwner(name);
  const ghii = ghiiRecord?.ghii;
  const organismKeys: string[] = [];
  const organismKey = (k: string): void => { organismKeys.push(k); };

  yield ['owner', { name: owner.name, display_name: owner.displayName, roles: owner.roles, created_at: owner.createdAt }];
  yield ['ghii', ghiiRecord ? {
    username: ghiiRecord.username, ghii: ghiiRecord.ghii, display_name: ghiiRecord.displayName, bio: ghiiRecord.bio,
    avatar: ghiiRecord.avatar, locale: ghiiRecord.locale, verification_level: ghiiRecord.verificationLevel,
    totp_enabled: ghiiRecord.totpEnabled,
    // NOTE: TOTP secret is intentionally excluded for security
    email_verified_at: ghiiRecord.emailVerifiedAt, verification_method: ghiiRecord.verificationMethod,
    magic_link_enabled: ghiiRecord.magicLinkEnabled, notification_email: ghiiRecord.notificationEmail,
    last_login_at: ghiiRecord.lastLoginAt, login_count: ghiiRecord.loginCount, trust_score: ghiiRecord.trustScore,
    morsel_balance: ghiiRecord.morselBalance, verified_attributes: ghiiRecord.verifiedAttributes,
    ftn_verified: ghiiRecord.ftnVerified, created_at: ghiiRecord.createdAt, updated_at: ghiiRecord.updatedAt,
  } : null];

  // ── The owner's OWN memory and files (via GHII) ── An owner session resolves to the GHII, so everything
  // a person writes themselves, and everything an app grant or an ecosystem token writes in their name,
  // lands under this identity and not under any agent's (v1.2.0 of the route, 2026-08-29).
  if (input.memories) yield ['memories', ghii ? new ExportList(() => ownerMemoryPages(storage, reader, ghii, organismKey)) : []];
  // Metadata only — the bytes are downloaded from their own endpoint, or come in the ZIP's files part.
  const ownFiles = ghii ? await storage.listStorageFiles(ghii) : [];
  yield ['storage_files', ownFiles.map(f => ({ key: f.key, mime_type: f.mimeType, size: f.size, visibility: f.visibility, created_at: f.createdAt }))];

  // ── The person's own work, under their GHII ── An action published in person and a request made in
  // person are filed under the GHII, not under an agent.
  const ownWorkProvided = ghii ? await storage.listWorkByProvider(ghii) : [];
  const ownWorkRequested = ghii ? await storage.listWorkByRequester(ghii) : [];
  const allWorkTrackingCodes = new Set<string>();
  for (const w of [...ownWorkProvided, ...ownWorkRequested]) allWorkTrackingCodes.add(w.trackingCode);
  yield ['work_provided', ownWorkProvided.map(workProvidedView)];
  yield ['work_requested', ownWorkRequested.map(workRequestedView)];

  // ── Agents ── Owner-invariant reads hoisted OUT of the per-agent loop (an O(agents×boards) fix):
  // boards with their posts load once, flags load once.
  const agents = await loadOwnerAgents(storage, name);
  const agentGaiis = agents.map(a => a.gaii);
  const allBoards = await storage.listBoards();
  const postsByBoard = new Map<string, Awaited<ReturnType<typeof storage.listPosts>>>();
  for (const board of allBoards) postsByBoard.set(board.id, await storage.listPosts(board.id, { limit: 10000 }));
  const allFlags = await storage.listFlags();

  const agentEntry = async (agent: (typeof agents)[number]) => {
    const providerWork = await storage.listWorkByProvider(agent.gaii);
    const requesterWork = await storage.listWorkByRequester(agent.gaii);
    for (const w of providerWork) allWorkTrackingCodes.add(w.trackingCode);
    for (const w of requesterWork) allWorkTrackingCodes.add(w.trackingCode);
    const transactions = await storage.getTransactions(agent.gaii, 10000);
    const trust = await calculateTrustScore(agent.gaii, storage);
    const boardPosts = [];
    for (const board of allBoards) {
      for (const post of postsByBoard.get(board.id) ?? []) {
        if (post.authorGaii !== agent.gaii) continue;
        boardPosts.push({ board_id: post.boardId, post_id: post.id, title: post.title, body: post.body, category: post.category, tags: post.tags, reactions: post.reactions, reply_to: post.replyTo, created_at: post.createdAt });
      }
    }
    const consentsGranted = await storage.listConsents(agent.gaii);
    // Entries are buffered for up to a minute before they are stored (consent-audit-buffer.ts), so the
    // pending queue is merged in the way GET /v1/consent/audit does (2026-09-08, e2e-owner-export).
    const consentAudit = [
      ...getPendingConsentAudit(agent.gaii).sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0)),
      ...await storage.listConsentAudit(agent.gaii),
    ];
    const files = await storage.listStorageFiles(agent.gaii);
    const subscriptions = await storage.listSubscriptionsByAgent(agent.gaii);
    return {
      gaii: agent.gaii, display_name: agent.displayName, description: agent.description,
      capabilities: agent.capabilities, default_scopes: agent.defaultScopes, trust,
      // The morsel balance lives on the owner GHII (agent balances are always 0 in the morsel economy).
      morsel_balance: ghiiRecord?.morselBalance ?? 0,
      created_at: agent.createdAt, last_seen: agent.lastSeen,
      ...(input.memories ? { memories: new ExportList(() => memoryPages(storage, reader, agent.gaii, organismKey)) } : {}),
      work_provided: providerWork.map(workProvidedView),
      work_requested: requesterWork.map(workRequestedView),
      transactions: transactions.map(t => ({ id: t.id, type: t.type, amount: t.amount, counterparty_gaii: t.counterpartyGaii, tracking_code: t.trackingCode, timestamp: t.timestamp })),
      board_posts: boardPosts,
      consents_granted: consentsGranted.map(c => ({ id: c.id, data_pattern: c.dataPattern, recipient: c.recipient, purpose: c.purpose, scope: c.scope, expires: c.expires, status: c.status, granted_at: c.grantedAt, revoked_at: c.revokedAt })),
      consent_audit: consentAudit.map(a => ({ consent_id: a.consentId, accessor_gaii: a.accessorGaii, memory_key: a.memoryKey, action: a.action, allowed: a.allowed, timestamp: a.timestamp })),
      flags_filed: allFlags.filter(f => f.flaggedBy === agent.gaii).map(f => ({ id: f.id, target_type: f.targetType, target_id: f.targetId, reason: f.reason, description: f.description, status: f.status, created_at: f.createdAt })),
      flags_against: allFlags.filter(f => f.targetType === 'agent' && f.targetId === agent.gaii).map(f => ({ id: f.id, flagged_by: f.flaggedBy, reason: f.reason, description: f.description, status: f.status, created_at: f.createdAt })),
      storage_files: files.map(f => ({ key: f.key, mime_type: f.mimeType, size: f.size, visibility: f.visibility, created_at: f.createdAt })),
      board_subscriptions: subscriptions.map(s => ({ board_id: s.boardId, callback_url: s.callbackUrl, filters: s.filters, created_at: s.createdAt })),
      messages: await exportAgentMessages(storage, agent.gaii),
    };
  };
  yield ['agents', new ExportList(async function* () { for (const a of agents) yield await agentEntry(a); })];

  // ── Disputes (via the work tracking codes gathered above) ──
  const ownerDisputes = (await storage.listAllDisputes()).filter(d => agentGaiis.includes(d.openedBy) || allWorkTrackingCodes.has(d.trackingCode));
  const disputes = [];
  for (const d of ownerDisputes) {
    const log = await storage.getDisputeAuditLog(d.id);
    disputes.push({
      id: d.id, tracking_code: d.trackingCode, status: d.status, opened_by: d.openedBy, reason: d.reason, ruling: d.ruling,
      created_at: d.createdAt, updated_at: d.updatedAt,
      audit_log: log.map(e => ({ sequence: e.sequence, event: e.event, actor: e.actor, timestamp: e.timestamp, data: e.data })),
    });
  }
  yield ['disputes', disputes];

  // ── Personal node, its push subscriptions and notification preferences ──
  const personalNode = await storage.getPersonalNodeByOwner(name);
  let personalPushSubscriptions: unknown[] = [];
  let personalNodeData: Record<string, unknown> | null = null;
  if (personalNode) {
    personalNodeData = {
      node_id: personalNode.nodeId, anchor_node_id: personalNode.anchorNodeId, status: personalNode.status,
      agent_gaiis: personalNode.agentGaiis, last_seen: personalNode.lastSeen, mailbox_quota_bytes: personalNode.mailboxQuotaBytes,
      mailbox_used_bytes: personalNode.mailboxUsedBytes, visibility: personalNode.visibility,
      created_at: personalNode.createdAt, updated_at: personalNode.updatedAt,
    };
    personalPushSubscriptions = (await storage.listPersonalPushSubscriptions(personalNode.nodeId))
      .map(s => ({ id: s.id, endpoint: s.endpoint, failure_count: s.failureCount, created_at: s.createdAt, last_used_at: s.lastUsedAt }));
    const prefs = await storage.getNotificationPreferences(personalNode.nodeId);
    if (prefs) {
      personalNodeData.notification_preferences = {
        enabled: prefs.enabled, channels: prefs.channels, notify_types: prefs.notifyTypes,
        cooldown_minutes: prefs.cooldownMinutes, quiet_hours_utc: prefs.quietHoursUtc, email: prefs.email,
      };
    }
  }
  yield ['personal_node', personalNodeData];
  yield ['personal_push_subscriptions', personalPushSubscriptions];
  const pushSub = await storage.getPushSubscription(name);
  yield ['push_subscription', pushSub ? { endpoint: pushSub.endpoint, created_at: pushSub.createdAt, last_used_at: pushSub.lastUsedAt } : null];

  // ── Organism memberships ── Rows are written under the bare owner name and read by GHII too, so both
  // alphabets are read (2026-09-08, e2e-owner-export).
  const memberships: unknown[] = [];
  if (ghii) {
    const byGhii = await storage.listMembershipsByGhii(ghii);
    const byName = await storage.listMembershipsByGhii(name);
    const seen = new Set(byGhii.map(m => m.organismId));
    for (const mem of [...byGhii, ...byName.filter(m => !seen.has(m.organismId))]) {
      const organism = await storage.getOrganism(mem.organismId);
      memberships.push({ organism_id: mem.organismId, organism_name: organism?.name ?? null, role: mem.role, status: mem.status, joined_at: mem.joinedAt, invited_by: mem.invitedBy });
    }
  }
  yield ['organism_memberships', memberships];

  const chats = await storage.listChatInstances({ ownerName: name });
  yield ['chat_instances', chats.map(c => ({ id: c.id, platform: c.platform, app_name: c.appName, ghii: c.ghii, is_anonymous: c.isAnonymous, created_at: c.createdAt, last_seen: c.lastSeen }))];

  // POST /v1/flags stamps flaggedBy with the bare account name on an owner session, so both are read.
  yield ['ghii_flags_filed', ghii ? allFlags.filter(f => f.flaggedBy === ghii || f.flaggedBy === name)
    .map(f => ({ id: f.id, target_type: f.targetType, target_id: f.targetId, reason: f.reason, description: f.description, status: f.status, created_at: f.createdAt })) : []];

  // ── Published apps, outside-account connections (never the credential), the apps taken ──
  const extra = await exportExtraSections(storage, ghii, agentGaiis);
  yield ['published_apps', extra.published_apps];
  if (input.provenance) yield ['ai_provenance', ghii ? new ExportList(() => provenancePages(storage, ghii)) : []];
  yield ['connections', extra.connections];
  yield ['app_purchases', extra.app_purchases];

  // ── Message threads, contacts, bookkeeping, outbound mail, agent tasks and the account's other records ──
  const records = ghii ? await exportAccountRecords(storage, ghii, [ghii, ...agentGaiis]) : null;
  for (const key of ['message_threads', 'contacts', 'companies', 'invoices', 'vouchers', 'fiscal_years', 'outbound_contacts',
    'outbound_messages', 'agent_tasks', 'scheduled_jobs', 'capabilities', 'package_instances', 'help_questions',
    'sharing_groups', 'group_shares', 'ai_decisions', 'account_events'] as const) {
    yield [key, records?.[key] ?? []];
  }

  // Organism content is in this export because it is the person's own data; the file carries content an
  // organism classified, so it says which keys (decided 2026-09-30). The keys are known once every
  // memory list above was read.
  if (organismKeys.length) {
    yield ['classified_organism_content', {
      count: organismKeys.length, keys: organismKeys,
      note: 'This export includes records of organisms you belong to that you or your agents hold, whatever their classification, because they are your own data. Organism content may be classified: keep the file as carefully as the organism asks.',
    }];
  }
  yield ['exported_at', new Date().toISOString()];
}
