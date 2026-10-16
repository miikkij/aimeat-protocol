/**
 * @file src/services/federation-remote-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The template listings this node fetched from its peers, kept so an owner's session can
 *   read them. POST /v1/federation/templates/sync fetches each peer's listing over the peer-signed GET
 *   and stores what it got as ONE memory record per peer (owner `__federation_templates__`, key
 *   `remote.<peer node id>`), with the fetch time and the last error. GET /v1/packages/tab reads the
 *   stored records of the peers that are active and share the catalogue now.
 *
 *   How it goes stale: each sync overwrites the peer's record; a failed fetch keeps the last good
 *   listing with its fetch time and records the error beside it; a peer that is no longer active is
 *   not read; removing a peer deletes its record (federation-peer-remove.ts).
 * @structure
 *   - REMOTE_TEMPLATES_OWNER, remoteTemplatesKey(peerId)
 *   - RemoteTemplate / RemoteTemplatesRecord: the stored shape (type 'federation.remote-templates')
 *   - syncRemoteTemplates(config, storage, peers): fetch every peer, store per peer, report per peer
 *   - readRemoteTemplates(storage, peers): what the Packages page shows, with per-peer status
 *   - deleteRemoteTemplates(storage, peerId): the cleanup on peer removal
 * @usage import { syncRemoteTemplates, readRemoteTemplates } from '../services/federation-remote-templates.js';
 * @version-history
 *   2026-10-16 — The listing request carries the audience headers the receiving route checks (QA audit S6-09).
 *   v1.0.0 — 2026-10-16 — Initial: the sync stores what it fetched and the Packages page reads it
 *     through an owner-session route (QA audit F1-04).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { validateOutboundUrl, safeFetch } from '../utils/url-validator.js';
import { sign } from '../auth/keypair.js';
import { audienceHeaders } from './signed-node-request.js';
import { readJson, OUTBOUND_READ_MAX_BYTES } from '../utils/read-capped.js';

/** The namespace the stored listings live in. Not an identity form, so no account can own it. */
export const REMOTE_TEMPLATES_OWNER = '__federation_templates__';
export const remoteTemplatesKey = (peerId: string): string => `remote.${peerId}`;

/** One listing as this node keeps it. `sourceNode` is the peer it was fetched from, never the peer's own claim. */
export interface RemoteTemplate {
  name: string;
  author: string;
  sourceNode: string;
  packageGroupId: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  rating: number;
  installCount: number;
  reviewCount: number;
  componentTypes: string[];
  componentCount: number;
  sizeMb: number;
}

export interface RemoteTemplatesRecord {
  type: 'federation.remote-templates';
  peer: string;
  /** When the listing below was fetched; null when no fetch has succeeded yet. */
  fetchedAt: string | null;
  lastAttemptAt: string;
  /** The last attempt's error, or null when it succeeded. */
  lastError: string | null;
  templates: RemoteTemplate[];
}

export interface RemoteTemplatesSyncResult {
  node: string;
  templates: number;
  /** Whether the listing was stored on this node. */
  stored: boolean;
  error?: string;
}

const MAX_LISTINGS_PER_PEER = 100;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, maxItems).map(s => s.slice(0, maxLen)) : [];

/** A peer's listing is remote input: keep the known fields, bounded, and name the source ourselves. */
function normalizeListing(raw: unknown, peerId: string): RemoteTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 200);
  const title = str(r.title, 200) || name;
  if (!title) return null;
  return {
    name, author: str(r.author, 200), sourceNode: peerId, packageGroupId: str(r.packageGroupId, 200),
    title, description: str(r.description, 2000), category: str(r.category, 100),
    tags: strList(r.tags, 20, 60), rating: num(r.rating), installCount: num(r.installCount),
    reviewCount: num(r.reviewCount), componentTypes: strList(r.componentTypes, 20, 40),
    componentCount: num(r.componentCount), sizeMb: num(r.sizeMb),
  };
}

async function readRecord(storage: Storage, peerId: string): Promise<RemoteTemplatesRecord | null> {
  const rec = await storage.getMemory(REMOTE_TEMPLATES_OWNER, remoteTemplatesKey(peerId));
  return rec ? rec.value as unknown as RemoteTemplatesRecord : null;
}

async function writeRecord(storage: Storage, value: RemoteTemplatesRecord): Promise<void> {
  const key = remoteTemplatesKey(value.peer);
  const existing = await storage.getMemory(REMOTE_TEMPLATES_OWNER, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: REMOTE_TEMPLATES_OWNER, value: value as unknown as Record<string, unknown>,
    visibility: 'private', tags: ['federation', 'remote-templates'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** The peers a listing is fetched from and shown for: active, and sharing the catalogue with this node. */
function listingPeers(peers: Map<string, PeerInfo>): PeerInfo[] {
  return [...peers.values()].filter(p => p.status === 'active' && p.shareCatalogue);
}

/**
 * Fetch every catalogue peer's template listing over the peer-signed GET and store it, one record per
 * peer. A peer that cannot be asked or does not answer is reported with its error, and its last good
 * listing stays stored with its fetch time.
 */
export async function syncRemoteTemplates(
  config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>,
): Promise<RemoteTemplatesSyncResult[]> {
  const results: RemoteTemplatesSyncResult[] = [];
  const nodeKey = await storage.getNodeKey();

  for (const peer of listingPeers(peers)) {
    const attemptAt = new Date().toISOString();
    let fetched: RemoteTemplate[] | null = null;
    let failure: string | null = null;
    try {
      const peerUrl = `${peer.url}/v1/federation/templates?limit=${MAX_LISTINGS_PER_PEER}`;
      // Kept for the message it produces: safeFetch below throws a generic "Fetch blocked", and a
      // peer whose URL has become unroutable reads better named per peer in the result list.
      const urlCheck = await validateOutboundUrl(peerUrl);
      if (!urlCheck.valid) {
        failure = urlCheck.reason ?? 'URL validation failed';
      } else if (!nodeKey) {
        failure = 'This node has no signing key';
      } else {
        // The receiving route requires proof that we are the node the header names.
        const timestamp = new Date().toISOString();
        const listSigned = JSON.stringify({ source_node: config.nodeId, timestamp });
        const listSignature = await sign(nodeKey.privateKey, listSigned);
        // The node this listing request is for; a peer on an older version ignores the headers
        // (QA audit S6-09: the listing checks its audience and one use).
        const listAudience = await audienceHeaders(nodeKey.privateKey, listSigned, peer.nodeId);
        // safeFetch re-validates every redirect hop (invariant 3).
        const response = await safeFetch(peerUrl, {
          headers: { 'Content-Type': 'application/json', 'x-source-node': config.nodeId, 'x-timestamp': timestamp, 'x-signature': listSignature, ...listAudience },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          failure = `HTTP ${response.status}`;
        } else {
          const data = await readJson(response, OUTBOUND_READ_MAX_BYTES) as { data?: { templates?: unknown[] } };
          if (!Array.isArray(data?.data?.templates)) {
            failure = 'The peer answered without a template list';
          } else {
            fetched = data.data.templates.slice(0, MAX_LISTINGS_PER_PEER)
              .map(t => normalizeListing(t, peer.nodeId)).filter((t): t is RemoteTemplate => t !== null);
          }
        }
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : 'unknown error';
    }

    if (fetched) {
      await writeRecord(storage, {
        type: 'federation.remote-templates', peer: peer.nodeId, fetchedAt: attemptAt,
        lastAttemptAt: attemptAt, lastError: null, templates: fetched,
      });
      results.push({ node: peer.nodeId, templates: fetched.length, stored: true });
    } else {
      // Keep the last good listing; record the failed attempt beside it.
      const previous = await readRecord(storage, peer.nodeId);
      await writeRecord(storage, {
        type: 'federation.remote-templates', peer: peer.nodeId, fetchedAt: previous?.fetchedAt ?? null,
        lastAttemptAt: attemptAt, lastError: failure ?? 'unknown error', templates: previous?.templates ?? [],
      });
      results.push({ node: peer.nodeId, templates: 0, stored: false, error: failure ?? 'unknown error' });
    }
  }
  return results;
}

export interface RemoteTemplatesView {
  templates: Array<RemoteTemplate & { fetchedAt: string | null }>;
  peers: Array<{ node: string; fetchedAt: string | null; lastAttemptAt: string | null; error: string | null; templates: number }>;
}

/** The stored listings of the peers that are active and share the catalogue now, with each peer's status. */
export async function readRemoteTemplates(storage: Storage, peers: Map<string, PeerInfo>): Promise<RemoteTemplatesView> {
  const view: RemoteTemplatesView = { templates: [], peers: [] };
  for (const peer of listingPeers(peers)) {
    const rec = await readRecord(storage, peer.nodeId);
    const templates = rec?.templates ?? [];
    view.peers.push({
      node: peer.nodeId, fetchedAt: rec?.fetchedAt ?? null, lastAttemptAt: rec?.lastAttemptAt ?? null,
      error: rec?.lastError ?? null, templates: templates.length,
    });
    for (const t of templates) view.templates.push({ ...t, sourceNode: peer.nodeId, fetchedAt: rec?.fetchedAt ?? null });
  }
  return view;
}

/** Forget a peer's stored listing (on peer removal). Answers whether a record was there. */
export async function deleteRemoteTemplates(storage: Storage, peerId: string): Promise<boolean> {
  return storage.deleteMemory(REMOTE_TEMPLATES_OWNER, remoteTemplatesKey(peerId));
}
