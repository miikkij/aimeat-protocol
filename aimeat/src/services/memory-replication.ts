/**
 * @file src/services/memory-replication.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Memory Replication Service — consent-based replication of public memory
 *   entries to federation peers (RFC v1.6 §13.11.4 protocol, §13.11.5 queue). Only
 *   entries that are public and covered by an active `federation`-scope consent are
 *   eligible; replication is signed and tracked per key/peer.
 *
 * @structure
 *   - ReplicationResult: per-peer replication outcome shape
 *   - isEligibleForReplication(storage, ownerGaii, key): public + federation-consent gate
 *   - (module) replicationState + tracking-key helpers for per-peer/per-key sync state
 *   - replicateMemoryToPeer / replicateMemoryToAllPeers: the single send and the scheduled round
 *   - retractMemoryFromPeer: the signed "this record is gone" a peer removes its replica on
 *   - enqueueMemoryReplication / sendQueuedMemoryEntries / onMemoryReplicationEnqueued: the queue
 *
 * @version-history
 *   v1.6.1 — 2026-10-27 — The consent pattern is matched as a glob by a walk over the key, never
 *     compiled as a regular expression: `*` is one segment between dots (it may be empty), `**` any
 *     rest, and every other character is itself. The owner's pattern was compiled with its regex
 *     syntax intact, so a pattern built to backtrack held the event loop on every public write
 *     (secaudit2026oct26, memory-replication:matchesPattern-compiles-owner-pattern-as-raw-regex).
 *   v1.6.0 — 2026-10-20 — RETRACTION. A record that stops being eligible is taken back from the peers
 *     that hold it: retractMemoryFromPeer sends a signed POST /v1/federation/retract, and the
 *     scheduled round reconciles what it has sent to each peer against what is eligible now and
 *     retracts the rest. That covers a delete, a visibility change away from public, a revoked
 *     federation consent and an erased account, none of which told a peer anything before. The round
 *     reads each identity's consents once instead of asking isEligibleForReplication per record, so
 *     an already-synced record's consent is checked too; it was not, and a revoked consent left the
 *     replica in place (secaudit 2026-10, replica retention).
 *   v1.5.0 — 2026-10-16 — The queued path sends (QA audit F3-01): sendQueuedMemoryEntries is the
 *     single-record send per queued job, which the scheduler's drain calls and marks by result;
 *     enqueueMemoryReplication writes one row per replicating peer, skips a peer that already has
 *     the same key pending, and runs the drain the scheduler registered. The scheduled round also
 *     reads the records of each person of this node who holds a federation consent, not agents only.
 *   v1.4.0 — 2026-10-06 — A replicate carries a delivery proof: the peer it is for and the send time,
 *     since its signed timestamp is the record's (deliveryProof; secaudit 2026-10 last items, D3).
 *   v1.3.0 — 2026-10-05 — Requests to peer nodes go through peerFetch (utils/peer-fetch.ts): no redirect, a time limit, and the answer read under a ceiling (secaudit 2026-10, C6).
 *   v1.2.0 — 2026-09-29 — TARGET-082 review: what the classification keeps on this node is counted
 *     (`classified_withheld` per peer) and logged by key; a single replication says CLASSIFIED.
 *   v1.1.0 — 2026-09-29 — Both replications ask leaveToPeer before a record leaves (TARGET-082).
 *   v1.0.1 — 2026-09-13 — A consent pattern that will not compile now says so and matches nothing.
 *     It fell back to `key === pattern`, which cannot be true — the equal case returns true at the
 *     top of the same function — so it was `false` written in a way that hid a malformed consent
 *     pattern from the operator who wrote it. Found by no-silent-catch's fourth shape.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { sign } from '../auth/keypair.js';
import { deliveryProof, audienceProof } from './signed-node-request.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { peerFetch } from '../utils/peer-fetch.js';
import { logger } from '../utils/logger.js';
import { leaveMemoriesToPeer, WITHHELD_REASON } from './classification-exits.js';

export interface ReplicationResult {
  peer_node_id: string;
  entries_sent: number;
  entries_failed: number;
  consent_denied: number;
  /** Public records the classification kept on this node (TARGET-082); their keys are in the log. */
  classified_withheld: number;
  /** Records this round told the peer to remove, because they stopped being eligible. */
  entries_retracted: number;
  success: boolean;
  error?: string;
}

/** What this node has sent to one peer, for one record: the address, so nothing is parsed back out. */
interface SentRecord {
  peerId: string;
  ownerGaii: string;
  key: string;
  lastSyncAt: string;
}

/**
 * Per-key per-peer replication tracking, and what the scheduled round reconciles against. It lives in
 * this process only: after a restart the node no longer knows what it sent, so a retraction can be
 * missed and the receiving peer's 168 h TTL (services/cache-cleanup.ts) is the backstop.
 */
const replicationState = new Map<string, SentRecord>(); // `${peerId}:${gaii}:${key}` → what was sent

function replicationTrackingKey(peerId: string, gaii: string, key: string): string {
  return `${peerId}:${gaii}:${key}`;
}

/** One record's address within a round, for the set the reconciliation compares against. */
function recordMark(ownerGaii: string, key: string): string {
  return `${ownerGaii}\u0000${key}`;
}

/**
 * Check if a memory entry is eligible for federation replication.
 * Requirements:
 * 1. visibility: 'public'
 * 2. Active consent with scope 'federation' exists
 */
export async function isEligibleForReplication(
  storage: Storage,
  ownerGaii: string,
  key: string,
): Promise<{ eligible: boolean; consentId?: string }> {
  // Get the memory entry
  const memory = await storage.getMemory(ownerGaii, key);
  if (!memory) return { eligible: false };

  // Must be public visibility
  if (memory.visibility !== 'public') return { eligible: false };

  // Check for active federation consent
  const consents = await storage.listConsents(ownerGaii);
  const federationConsent = consents.find(c =>
    c.status === 'active' &&
    c.scope === 'federation' &&
    matchesPattern(key, c.dataPattern),
  );

  if (!federationConsent) return { eligible: false };

  return { eligible: true, consentId: federationConsent.id };
}

/**
 * Whether one of an identity's active federation consents covers this key: the same rule
 * isEligibleForReplication applies, for a reader that holds the consents already. The genesis memory
 * read asked only that SOME federation consent existed, so a consent for one key opened every public
 * key of the identity (feature-list audit 166).
 */
export function federationConsentCovers(
  consents: ReadonlyArray<{ status: string; scope: string; dataPattern: string }>,
  key: string,
): boolean {
  return consents.some(c => c.status === 'active' && c.scope === 'federation' && matchesPattern(key, c.dataPattern));
}

/** One step of a consent pattern: a character, `*` (one segment, may be empty) or `**` (any rest). */
type GlobStep = { lit: string } | { star: 1 | 2 };

function globSteps(pattern: string): GlobStep[] {
  const steps: GlobStep[] = [];
  for (let i = 0; i < pattern.length;) {
    if (pattern[i] === '*') {
      const two = pattern[i + 1] === '*';
      steps.push({ star: two ? 2 : 1 });
      i += two ? 2 : 1;
    } else {
      steps.push({ lit: pattern[i]! });
      i += 1;
    }
  }
  return steps;
}

/**
 * Glob matching for consent data patterns: exact match, `*` (any run of characters without a dot)
 * and `**` (any run at all), every other character itself. The same meaning the regex this replaced
 * gave a plain pattern (`[^.]*` and `.*`), read by a walk over key and pattern that takes at most
 * their two lengths multiplied, so no pattern can make it backtrack. The regex compiled every other
 * character as regex syntax, so an owner's pattern decided how long the event loop was held.
 */
function matchesPattern(key: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === key) return true;
  const steps = globSteps(pattern);
  // at[j]: the first j steps match the key read so far.
  let at = new Uint8Array(steps.length + 1);
  at[0] = 1;
  for (let j = 0; j < steps.length; j++) if ('star' in steps[j]! && at[j]) at[j + 1] = 1;
  for (const ch of key) {
    const next = new Uint8Array(steps.length + 1);
    for (let j = 0; j < steps.length; j++) {
      const s = steps[j]!;
      if ('lit' in s) {
        if (at[j] && s.lit === ch) next[j + 1] = 1;
      } else if (next[j] || (at[j + 1] && (s.star === 2 || ch !== '.'))) {
        next[j + 1] = 1;
      }
    }
    at = next;
  }
  return at[steps.length] === 1;
}

/**
 * Replicate a single memory entry to a specific peer.
 */
export async function replicateMemoryToPeer(
  peer: PeerInfo,
  ownerGaii: string,
  key: string,
  config: AimeatConfig,
  storage: Storage,
): Promise<{ success: boolean; error?: string }> {
  const found = await storage.getMemory(ownerGaii, key);
  if (!found) return { success: false, error: 'Memory entry not found' };
  // Memory leaving for a peer asks the classification component first (TARGET-082). A record that
  // stays says why here and in the log; the peer is sent nothing.
  const { kept: [memory], withheld } = await leaveMemoriesToPeer({ storage, config }, [found], peer.nodeId, 'memory replication');
  if (!memory) return { success: false, error: `CLASSIFIED: ${withheld?.reason ?? WITHHELD_REASON}` };

  // Check eligibility
  const eligibility = await isEligibleForReplication(storage, ownerGaii, key);
  if (!eligibility.eligible) {
    return { success: false, error: 'Entry not eligible for replication' };
  }

  if (!peer.replicateMemory) {
    return { success: false, error: 'Peer has memory replication disabled' };
  }

  try {
    const urlCheck = await validateOutboundUrl(peer.url);
    if (!urlCheck.valid) {
      return { success: false, error: `SSRF blocked: ${urlCheck.reason}` };
    }

    const payload = {
      source_node: config.nodeId,
      gaii: ownerGaii,
      key,
      value: memory.value,
      visibility: memory.visibility,
      version: memory.version,
      timestamp: memory.updatedAt,
      consent_ref: eligibility.consentId,
    };

    // Sign the payload
    const nodeKey = await storage.getNodeKey();
    let replicateSignature: string | undefined;
    let delivery: Record<string, string> = {};
    if (nodeKey?.privateKey) {
      const signPayload = JSON.stringify({
        source_node: payload.source_node,
        gaii: payload.gaii,
        key: payload.key,
        value: payload.value,
        visibility: payload.visibility,
        version: payload.version,
        timestamp: payload.timestamp,
      });
      replicateSignature = await sign(nodeKey.privateKey, signPayload);
      // The timestamp is the record's update time, so the send time and the peer go in the
      // delivery proof (secaudit 2026-10 last items, D3).
      delivery = await deliveryProof(nodeKey.privateKey, signPayload, peer.nodeId);
    }

    const resp = await peerFetch(`${peer.url}/v1/federation/replicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, signature: replicateSignature, ...delivery }),
    }, { timeoutMs: config.federationTimeoutMs });
    if (!resp.ok) return { success: false, error: resp.message };

    if (resp.status >= 200 && resp.status < 300) {
      // Track successful replication
      const trackKey = replicationTrackingKey(peer.nodeId, ownerGaii, key);
      replicationState.set(trackKey, { peerId: peer.nodeId, ownerGaii, key, lastSyncAt: new Date().toISOString() });
      return { success: true };
    } else {
      return { success: false, error: `HTTP ${resp.status}: ${resp.text}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

/** Why a record is taken back. The receiving node stores no reason; it is for the peer's log. */
export type RetractionReason = 'deleted' | 'not_public' | 'consent_revoked' | 'no_longer_eligible';

/**
 * Tell one peer that a record it replicated is gone or no longer eligible, so it removes its copy.
 *
 * The message is signed with this node's key the way a replicate is, and the receiving end builds the
 * replica key from the node id its signature proved, never from a body field, so this can only reach
 * the copies THIS node put there (routes/federation-sync/messaging.ts, POST /v1/federation/retract).
 * It carries its own send time: unlike a replicate, whose timestamp is the record's update time,
 * nothing here is older than the moment it is sent, so the five-minute window applies.
 *
 * A peer on an older version answers 404. That is reported as a failure and left to the peer's TTL.
 */
export async function retractMemoryFromPeer(
  peer: PeerInfo,
  ownerGaii: string,
  key: string,
  reason: RetractionReason,
  config: AimeatConfig,
  storage: Storage,
): Promise<{ success: boolean; error?: string }> {
  if (!peer.replicateMemory) return { success: false, error: 'Peer has memory replication disabled' };

  const nodeKey = await storage.getNodeKey();
  if (!nodeKey?.privateKey) return { success: false, error: 'This node has no signing key' };

  const urlCheck = await validateOutboundUrl(peer.url);
  if (!urlCheck.valid) return { success: false, error: `SSRF blocked: ${urlCheck.reason}` };

  const payload = {
    source_node: config.nodeId,
    gaii: ownerGaii,
    key,
    reason,
    timestamp: new Date().toISOString(),
  };
  const signed = JSON.stringify(payload);
  // The audience proof names the node this retraction is for, under a second signature, so a captured
  // one cannot be sent to a third node. Carried from the first version of this message, so no peer
  // ever sees it without the proof.
  const audience = await audienceProof(nodeKey.privateKey, signed, peer.nodeId);

  try {
    const resp = await peerFetch(`${peer.url}/v1/federation/retract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, signature: await sign(nodeKey.privateKey, signed), ...audience }),
    }, { timeoutMs: config.federationTimeoutMs });
    if (!resp.ok) return { success: false, error: resp.message };
    if (resp.status >= 200 && resp.status < 300) return { success: true };
    return { success: false, error: `HTTP ${resp.status}: ${resp.text}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

/**
 * The records this node has sent to `peer` that are no longer eligible, taken back.
 *
 * `stillEligible` holds the addresses the round has just confirmed, so the common case costs nothing.
 * Everything else is asked again through isEligibleForReplication, which answers false for a record
 * that was deleted, made private, lost its federation consent or went with an erased account: the
 * four ways a replica outlived its source. A peer that accepts the retraction is forgotten, so the
 * next round does not ask again.
 */
async function retractNoLongerEligible(
  peer: PeerInfo,
  stillEligible: ReadonlySet<string>,
  config: AimeatConfig,
  storage: Storage,
): Promise<number> {
  let retracted = 0;
  for (const [trackKey, sent] of [...replicationState]) {
    if (sent.peerId !== peer.nodeId) continue;
    if (stillEligible.has(recordMark(sent.ownerGaii, sent.key))) continue;

    const { eligible } = await isEligibleForReplication(storage, sent.ownerGaii, sent.key);
    if (eligible) continue;

    const result = await retractMemoryFromPeer(peer, sent.ownerGaii, sent.key, 'no_longer_eligible', config, storage);
    if (result.success) {
      replicationState.delete(trackKey);
      retracted++;
    } else {
      logger.warn('A replica could not be taken back from a peer; its TTL there is the backstop', {
        peer: peer.nodeId, gaii: sent.ownerGaii, key: sent.key, error: result.error,
      });
    }
  }
  return retracted;
}

/**
 * Replicate all eligible memories to all active peers.
 * Called during scheduled sync cycles.
 */
export async function replicateMemoryToAllPeers(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<ReplicationResult[]> {
  const activePeers = [...peers.values()].filter(p => p.status === 'active');
  if (activePeers.length === 0) return [];

  // The identities whose records may federate: every agent, and every person of this node who holds
  // an active federation consent. The person half was missing until 2026-10-16, so a public record a
  // person owned directly, under a federation consent, was sent by neither this round nor the queue.
  // A person with no federation consent has nothing eligible, and their memory is not read at all.
  const owners: Array<{ gaii: string; listOpts: { visibility?: string } }> =
    (await storage.listAgents()).map(a => ({ gaii: a.gaii, listOpts: {} }));
  for (const g of await storage.listGHIIs()) {
    if (!g.ghii.endsWith(`@${config.nodeId}`)) continue;
    const consents = await storage.listConsents(g.ghii);
    if (!consents.some(c => c.status === 'active' && c.scope === 'federation')) continue;
    owners.push({ gaii: g.ghii, listOpts: { visibility: 'public' } });
  }
  const results: ReplicationResult[] = [];

  for (const peer of activePeers) {
    let entriesSent = 0;
    let entriesFailed = 0;
    let consentDenied = 0;
    let classifiedWithheld = 0;
    // What this round confirmed is still eligible, so the reconciliation below knows what it may
    // leave on the peer.
    const stillEligible = new Set<string>();

    for (const agent of owners) {
      try {
        const memories = await storage.listMemory(agent.gaii, agent.listOpts);
        // The identity's federation consents, read ONCE for the whole listing. Until 2026-10-20 the
        // round asked isEligibleForReplication per record, which re-read both the record and the
        // consents, and asked it only for a record that had changed: a revoked consent on an
        // already-synced record was never noticed. The record itself is listed here as public, so
        // the consent is the whole of what is left to decide.
        const consents = await storage.listConsents(agent.gaii);
        // Memory leaving for a peer asks the classification component first (TARGET-082), and what
        // stays is counted in the peer's result (keys in the log only).
        const { kept: publicMemories, withheld } = await leaveMemoriesToPeer({ storage, config },
          memories.filter(m => m.visibility === 'public'), peer.nodeId, 'memory replication');
        classifiedWithheld += withheld?.count ?? 0;

        for (const memory of publicMemories) {
          // Skip federation-managed entries
          if (memory.key.startsWith('replica:') || memory.key.startsWith('federated:') ||
              memory.key.startsWith('genesis:') || memory.key.startsWith('expiring:') ||
              memory.key.includes('._conflict_')) {
            continue;
          }

          // Eligibility: the record is public (the listing filtered on that) and a federation
          // consent covers the key. Asked BEFORE the already-synced skip, so a record whose consent
          // was revoked is reported here and taken back below.
          if (!federationConsentCovers(consents, memory.key)) {
            consentDenied++;
            continue;
          }
          stillEligible.add(recordMark(agent.gaii, memory.key));

          // Check if already synced and unchanged
          const trackKey = replicationTrackingKey(peer.nodeId, agent.gaii, memory.key);
          const lastSync = replicationState.get(trackKey);
          if (lastSync && new Date(lastSync.lastSyncAt) >= new Date(memory.updatedAt)) {
            continue; // Already synced, no changes
          }

          // Replicate
          const result = await replicateMemoryToPeer(peer, agent.gaii, memory.key, config, storage);
          if (result.success) {
            entriesSent++;
          } else {
            entriesFailed++;
          }
        }
      } catch (err) {
        // Skip agent on error
        logger.warn('replicateMemoryToAllPeers: continuing after a suppressed failure', { error: String(err) });
      }
    }

    // What this node already sent to the peer and may no longer leave there.
    let entriesRetracted = 0;
    try {
      entriesRetracted = await retractNoLongerEligible(peer, stillEligible, config, storage);
    } catch (err) {
      logger.warn('replicateMemoryToAllPeers: the retraction pass was suppressed, continuing', { peer: peer.nodeId, error: String(err) });
    }

    results.push({
      peer_node_id: peer.nodeId,
      entries_sent: entriesSent,
      entries_failed: entriesFailed,
      consent_denied: consentDenied,
      classified_withheld: classifiedWithheld,
      entries_retracted: entriesRetracted,
      success: entriesFailed === 0,
    });

    if (entriesSent > 0 || entriesFailed > 0 || entriesRetracted > 0) {
      logger.info(`Memory replication to peer ${peer.nodeId}`, {
        sent: entriesSent,
        failed: entriesFailed,
        consent_denied: consentDenied,
        retracted: entriesRetracted,
      });
    }
  }

  return results;
}

/**
 * The function that drains the queue soon after a memory job is enqueued, per storage instance.
 * The sync scheduler registers it when it starts (onMemoryReplicationEnqueued). It is a registration
 * rather than an import because the scheduler imports this module; keyed by storage because more
 * than one node can run in one process (the two-node test suites).
 */
const enqueueListeners = new Map<Storage, () => void>();

/** Register what runs after a memory job is enqueued on this storage. Returns the unregister call. */
export function onMemoryReplicationEnqueued(storage: Storage, listener: () => void): () => void {
  enqueueListeners.set(storage, listener);
  return () => { if (enqueueListeners.get(storage) === listener) enqueueListeners.delete(storage); };
}

/** How far the duplicate check reads into a peer's pending jobs. The scheduler throttles at 1000. */
const PENDING_SCAN_LIMIT = 1000;

interface MemoryJobPayload { gaii?: string; key?: string; consent_ref?: string }

/**
 * Enqueue a memory entry for replication via the replication queue.
 * Called from memory write handlers when an eligible entry is created/updated.
 *
 * One row per peer, so each peer's send is marked by its own result. A peer that already has a
 * pending job for the same identity and key gets no second row: the job reads the record when it is
 * sent, so one pending job carries the latest value. After enqueueing, the registered drain runs
 * (instant and hybrid send each change at once; the scheduled round is the fallback).
 */
export async function enqueueMemoryReplication(
  ownerGaii: string,
  key: string,
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<void> {
  // Only in instant or hybrid mode
  if (config.syncMode === 'bulk') return;

  const eligibility = await isEligibleForReplication(storage, ownerGaii, key);
  if (!eligibility.eligible) return;

  const targets = [...peers.values()].filter(p => p.status === 'active' && p.replicateMemory !== false);
  if (targets.length === 0) return;

  let enqueued = 0;
  for (const peer of targets) {
    const pending = await storage.dequeueReplication(peer.nodeId, PENDING_SCAN_LIMIT);
    const already = pending.some(e => e.type === 'memory_replicate'
      && (e.payload as MemoryJobPayload)?.gaii === ownerGaii && (e.payload as MemoryJobPayload)?.key === key);
    if (already) continue;
    await storage.enqueueReplication({
      type: 'memory_replicate',
      targetPeers: [peer.nodeId],
      payload: { gaii: ownerGaii, key, consent_ref: eligibility.consentId },
      createdAt: new Date().toISOString(),
    });
    enqueued++;
  }
  if (enqueued > 0) enqueueListeners.get(storage)?.();
}

/**
 * Send queued memory jobs to one peer: each job is the single-record send (replicateMemoryToPeer),
 * which re-reads the record and re-checks visibility, consent and classification at send time.
 * Answers the ids that were sent and the ids that were not; the caller marks them. A job whose
 * record is gone, private, no longer consented or kept by the classification is NOT sent, and is
 * reported with the failures, because 'sent' means a peer received it.
 */
export async function sendQueuedMemoryEntries(
  peer: PeerInfo,
  entries: ReadonlyArray<{ id: string; payload: unknown }>,
  config: AimeatConfig,
  storage: Storage,
): Promise<{ sent: string[]; failed: string[] }> {
  const sent: string[] = [];
  const failed: string[] = [];
  for (const entry of entries) {
    const p = entry.payload as MemoryJobPayload;
    if (!p?.gaii || !p?.key) { failed.push(entry.id); continue; }
    const result = await replicateMemoryToPeer(peer, p.gaii, p.key, config, storage);
    if (result.success) {
      sent.push(entry.id);
    } else {
      failed.push(entry.id);
      logger.warn('Queued memory replication was not sent', { peer: peer.nodeId, gaii: p.gaii, key: p.key, error: result.error });
    }
  }
  return { sent, failed };
}
