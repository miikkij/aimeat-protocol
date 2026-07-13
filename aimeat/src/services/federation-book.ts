/**
 * @file federation-book.ts
 * @description The "federation book" — a phone-book of the federation: per node, its operator
 *   GHIIs, the resources it offers (counts + a few highlights), its AIMEAT version, and curated
 *   behaviour settings. The PRIMARY (genesis/anchor — a node with no genesisUrl) assembles the book
 *   from its peers' node-cards + its own, signs it, and serves it; leaf nodes pull + verify + cache
 *   + serve it, so EVERY node shows the full federation (not just its direct peers).
 *
 *   Reuses the signed-doc pattern from network-policy.ts: read straight from storage (no module
 *   cache → safe for multiple node instances in one test process); sign/verify with the node key.
 * @structure
 *   - NodeCard / FederationBook types
 *   - buildNodeCard(config, storage) — this node's card (or { listed:false } when opted out)
 *   - bookSignString() · getActiveBook() · storeActiveBook()
 *   - assembleBook(config, storage, peers) — primary: fetch peer cards + own → sign → store
 * @usage import { buildNodeCard, assembleBook, getActiveBook } from './federation-book.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial federation book (node-card + primary assembly + signed doc).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { buildNodeDescriptor } from '../utils/node-descriptor.js';
import { computeServiceSummary } from '../utils/service-summary.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { sign, verify } from '../auth/keypair.js';
import { peerKeyCache } from './federation-helpers.js';
import { logger } from '../utils/logger.js';

export const FEDERATION_BOOK_GAII = '__federation_book__';
export const FEDERATION_BOOK_KEY = 'federation-book.active';

export interface NodeCardOperator { ghii: string; display_name: string; avatar: string | null }
export interface NodeCardResources { actions: number; agents: number; boards: number; csms: number; highlights: string[] }

export interface NodeCard {
  node_id: string;
  url: string;
  listed: boolean;
  software_version?: string;
  node_type?: string;
  capabilities?: string[];
  settings?: Record<string, unknown>;
  operators?: NodeCardOperator[];
  resources?: NodeCardResources;
  node_card_hash?: string;
  computed_at?: string;
}

export interface FederationBook {
  book_version: number;
  issued_by: string;
  issued_at: string;
  signature?: string;
  nodes: NodeCard[];
}

/** Canonical string the primary signs (and leaves verify) for a book — excludes `signature`. */
export function bookSignString(book: FederationBook): string {
  const rest = Object.fromEntries(Object.entries(book).filter(([k]) => k !== 'signature'));
  return JSON.stringify(rest);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Build THIS node's card. When the node opts out of listing (config.federationBookListed=false)
 * the card carries only `{ node_id, url, listed:false }` — no operator identities.
 */
export async function buildNodeCard(config: AimeatConfig, storage: Storage): Promise<NodeCard> {
  if (!config.federationBookListed) {
    return { node_id: config.nodeId, url: config.baseUrl, listed: false };
  }
  const desc = buildNodeDescriptor(config);

  const operators: NodeCardOperator[] = [];
  try {
    for (const o of await storage.listOwners()) {
      if (o.name === 'anonymous' || !o.roles?.includes('operator')) continue;
      const ghii = await storage.getGHIIByOwner(o.name).catch(() => null);
      operators.push({
        ghii: ghii?.ghii ?? `${o.name}@${config.nodeId}`,
        display_name: ghii?.displayName ?? o.displayName ?? o.name,
        avatar: ghii?.avatar ?? null,
      });
    }
  } catch { /* operators best-effort */ }

  let resources: NodeCardResources = { actions: 0, agents: 0, boards: 0, csms: 0, highlights: [] };
  try {
    const s = await computeServiceSummary(config, storage);
    const highlights = [
      ...(s.actions ?? []).slice(0, 3).map(a => a.displayName),
      ...(s.csms ?? []).slice(0, 2).map(c => c.name),
    ].filter(Boolean).slice(0, 5);
    resources = { actions: s.actions?.length ?? 0, agents: s.agents?.length ?? 0, boards: s.boards?.length ?? 0, csms: s.csms?.length ?? 0, highlights };
  } catch { /* resources best-effort */ }

  const card: NodeCard = {
    node_id: config.nodeId,
    url: config.baseUrl,
    listed: true,
    software_version: desc.software_version,
    node_type: desc.node_type,
    capabilities: desc.capabilities,
    settings: desc.settings,
    operators,
    resources,
    computed_at: new Date().toISOString(),
  };
  const stable = Object.fromEntries(Object.entries(card).filter(([k]) => k !== 'node_card_hash' && k !== 'computed_at'));
  card.node_card_hash = sha256(JSON.stringify(stable));
  return card;
}

/** Read the active book from storage (no module cache — safe across in-process node instances). */
export async function getActiveBook(storage: Storage): Promise<FederationBook | null> {
  try {
    const rec = await storage.getMemory(FEDERATION_BOOK_GAII, FEDERATION_BOOK_KEY);
    if (rec) return rec.value as unknown as FederationBook;
  } catch { /* none */ }
  return null;
}

export async function storeActiveBook(storage: Storage, book: FederationBook): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(FEDERATION_BOOK_GAII, FEDERATION_BOOK_KEY).catch(() => null);
  await storage.setMemory({
    key: FEDERATION_BOOK_KEY,
    ownerGaii: FEDERATION_BOOK_GAII,
    value: book as unknown as Record<string, unknown>,
    visibility: 'public',
    tags: ['federation', 'federation-book'],
    ttlHours: null,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * PRIMARY: assemble the book from active federation peers' node-cards + this node's own card,
 * sign it, and store it. Bumps book_version only when the node set actually changed (so leaves
 * don't re-pull unchanged books). Returns the stored book (or the unchanged current one).
 */
export async function assembleBook(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Promise<FederationBook> {
  const nodes: NodeCard[] = [];
  const self = await buildNodeCard(config, storage);
  if (self.listed) nodes.push(self);

  const active = [...peers.values()].filter(p => p.status === 'active' && p.peerMode !== 'private');
  for (const peer of active) {
    try {
      const check = await validateOutboundUrl(peer.url);
      if (!check.valid) continue;
      const resp = await fetch(`${peer.url}/v1/federation/node-card`, { signal: AbortSignal.timeout(config.federationTimeoutMs ?? 5_000) });
      if (!resp.ok) continue;
      const body = await resp.json() as { data?: NodeCard };
      const card = body?.data;
      if (card && card.listed) {
        nodes.push(card);
        const p = peers.get(peer.nodeId);
        if (p && card.node_card_hash) p.nodeCardHash = card.node_card_hash;
      }
    } catch { /* skip unreachable peer */ }
  }

  nodes.sort((a, b) => a.node_id.localeCompare(b.node_id));
  const current = await getActiveBook(storage);
  const contentChanged = !current || JSON.stringify(current.nodes) !== JSON.stringify(nodes);
  if (!contentChanged) return current!;

  const book: FederationBook = {
    book_version: (current?.book_version ?? 0) + 1,
    issued_by: config.nodeId,
    issued_at: new Date().toISOString(),
    nodes,
  };
  const nodeKey = await storage.getNodeKey();
  if (nodeKey) book.signature = await sign(nodeKey.privateKey, bookSignString(book));
  await storeActiveBook(storage, book);
  logger.info('Federation book assembled', { nodes: nodes.length, version: book.book_version });
  return book;
}

export interface BookPullResult {
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  applied?: boolean;
  reason?: string;
  book_version?: number;
  nodes?: number;
}

/**
 * LEAF: fetch the book from a source (genesis), verify its signature against the issuing peer's
 * known key (peer record or key cache), version-gate, and store. Shared by the operator pull
 * endpoint and the leaf auto-sync timer.
 */
export async function pullBook(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>, sourceUrl?: string): Promise<BookPullResult> {
  const source = sourceUrl || config.genesisUrl;
  if (!source) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'No genesis/source URL configured' };
  const urlCheck = await validateOutboundUrl(source);
  if (!urlCheck.valid) return { ok: false, status: 400, code: 'INVALID_URL', message: urlCheck.reason ?? 'source URL failed validation' };

  let book: FederationBook;
  try {
    const resp = await fetch(`${source.replace(/\/+$/, '')}/v1/federation/book`, { signal: AbortSignal.timeout(config.federationTimeoutMs ?? 5_000) });
    if (!resp.ok) return { ok: false, status: 502, code: 'FETCH_FAILED', message: `Source returned ${resp.status}` };
    const body = await resp.json() as { data?: { book?: FederationBook } };
    book = body?.data?.book as FederationBook;
    if (!book || !Array.isArray(book.nodes)) return { ok: false, status: 502, code: 'FETCH_FAILED', message: 'Source returned no book' };
  } catch (e) {
    return { ok: false, status: 502, code: 'FETCH_FAILED', message: e instanceof Error ? e.message : 'fetch failed' };
  }

  const issuer = peers.get(book.issued_by) ?? [...peers.values()].find(p => p.nodeId === book.issued_by);
  const issuerKey = issuer?.publicKey || peerKeyCache.get(book.issued_by)?.publicKey;
  if (!issuerKey) return { ok: false, status: 403, code: 'UNKNOWN_ISSUER', message: `Book issuer ${book.issued_by} is not a known peer` };
  const sigOk = book.signature ? await verify(issuerKey, bookSignString(book), book.signature).catch(() => false) : false;
  if (!sigOk) return { ok: false, status: 401, code: 'INVALID_SIGNATURE', message: 'Book signature verification failed' };

  const current = await getActiveBook(storage);
  if (current && book.book_version <= current.book_version) {
    return { ok: true, status: 200, applied: false, reason: 'not_newer', book_version: current.book_version };
  }
  await storeActiveBook(storage, book);
  return { ok: true, status: 200, applied: true, book_version: book.book_version, nodes: book.nodes.length };
}
