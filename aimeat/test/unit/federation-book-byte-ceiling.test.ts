/**
 * @file test/unit/federation-book-byte-ceiling.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A peer's node card and a primary's book are read under a byte ceiling, as the
 *   network policy pull beside them is (routes/federation-peer/policy-book.ts). An oversized card is
 *   skipped with a warning and the other cards stay in the book; an oversized book is FETCH_FAILED.
 *   Cards and books of a normal size assemble and pull as before.
 *
 *   WHY. assembleBook and pullBook read the peer's answer with resp.json(), which holds the whole
 *   body in memory before anything measures it, so an admitted peer decided how much the primary
 *   read, signed, stored as a public record and served to every leaf. The two attack cases fail on
 *   src/services/federation-book.ts v1.1.0.
 * @usage cd aimeat && pnpm exec vitest run test/unit/federation-book-byte-ceiling.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The answer each fetched address gives, by its URL. */
const answers = new Map<string, string>();
vi.mock('../../src/utils/url-validator.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/url-validator.js')>()),
  validateOutboundUrl: async () => ({ valid: true }),
  safeFetch: async (url: string) => {
    const body = answers.get(url);
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  },
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { PeerInfo } from '../../src/services/federation.js';
import {
  assembleBook, pullBook, getActiveBook, bookSignString,
  type FederationBook, type NodeCard,
} from '../../src/services/federation-book.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';

const NODE = 'aimeat-test-001-primary';

function fresh(): Storage {
  return new SqliteStorage(':memory:') as unknown as Storage;
}

function peer(nodeId: string, url: string, publicKey = ''): PeerInfo {
  return { nodeId, url, publicKey, status: 'active', peerMode: 'federation' } as PeerInfo;
}

function card(nodeId: string, url: string, extra: Partial<NodeCard> = {}): NodeCard {
  return {
    node_id: nodeId, url, listed: true, software_version: '4.0.3', node_type: 'full',
    operators: [{ ghii: `op@${nodeId}`, display_name: 'Op', avatar: null }],
    resources: { actions: 2, agents: 1, boards: 0, csms: 0, highlights: ['Weather'] },
    node_card_hash: `hash-${nodeId}`, ...extra,
  };
}

const primaryConfig = { nodeId: NODE, baseUrl: 'https://primary.example', federationBookListed: false } as AimeatConfig;

describe('assembleBook reads each peer card under a byte ceiling', () => {
  beforeEach(() => { answers.clear(); });

  it('keeps every normal-size card (usage: the book as before)', async () => {
    const storage = fresh();
    answers.set('https://a.example/v1/federation/node-card', JSON.stringify({ data: card('node-a', 'https://a.example') }));
    answers.set('https://b.example/v1/federation/node-card', JSON.stringify({ data: card('node-b', 'https://b.example') }));
    const peers = new Map([['node-a', peer('node-a', 'https://a.example')], ['node-b', peer('node-b', 'https://b.example')]]);

    const book = await assembleBook(primaryConfig, storage, peers);
    expect(book.nodes.map(n => n.node_id)).toEqual(['node-a', 'node-b']);
    expect(book.book_version).toBe(1);
    expect((await getActiveBook(storage))?.nodes.length).toBe(2);
    expect(peers.get('node-a')?.nodeCardHash).toBe('hash-node-a');
  });

  it('skips a card over the ceiling and keeps the others', async () => {
    const storage = fresh();
    const padding = 'x'.repeat(2 * 1024 * 1024);
    answers.set('https://a.example/v1/federation/node-card', JSON.stringify({ data: card('node-a', 'https://a.example') }));
    answers.set('https://big.example/v1/federation/node-card', JSON.stringify({ data: card('node-big', 'https://big.example', { settings: { padding } }) }));
    const peers = new Map([['node-a', peer('node-a', 'https://a.example')], ['node-big', peer('node-big', 'https://big.example')]]);

    const book = await assembleBook(primaryConfig, storage, peers);
    expect(book.nodes.map(n => n.node_id)).toEqual(['node-a']);
    const stored = await getActiveBook(storage);
    expect(stored?.nodes.map(n => n.node_id)).toEqual(['node-a']);
    expect(peers.get('node-big')?.nodeCardHash).toBeUndefined();
  });
});

describe('pullBook reads the primary book under a byte ceiling', () => {
  beforeEach(() => { answers.clear(); });

  async function signedBook(nodes: NodeCard[]): Promise<{ book: FederationBook; publicKey: string }> {
    const keys = await generateKeyPair();
    const book: FederationBook = { book_version: 4, issued_by: 'primary', issued_at: '2026-11-01T00:00:00.000Z', nodes };
    book.signature = await sign(keys.privateKey, bookSignString(book));
    return { book, publicKey: keys.publicKey };
  }

  const leafConfig = { nodeId: 'leaf-1', genesisUrl: 'https://primary.example' } as AimeatConfig;

  it('applies a normal-size signed book (usage: the pull as before)', async () => {
    const storage = fresh();
    const { book, publicKey } = await signedBook([card('node-a', 'https://a.example'), card('node-b', 'https://b.example')]);
    answers.set('https://primary.example/v1/federation/book', JSON.stringify({ data: { book } }));
    const peers = new Map([['primary', peer('primary', 'https://primary.example', publicKey)]]);

    const result = await pullBook(leafConfig, storage, peers);
    expect(result).toMatchObject({ ok: true, status: 200, applied: true, book_version: 4, nodes: 2 });
    expect((await getActiveBook(storage))?.book_version).toBe(4);
  });

  it('answers FETCH_FAILED for a book over the ceiling and stores nothing', async () => {
    const storage = fresh();
    const padding = 'x'.repeat(5 * 1024 * 1024);
    const { book, publicKey } = await signedBook([card('node-a', 'https://a.example', { settings: { padding } })]);
    answers.set('https://primary.example/v1/federation/book', JSON.stringify({ data: { book } }));
    const peers = new Map([['primary', peer('primary', 'https://primary.example', publicKey)]]);

    const result = await pullBook(leafConfig, storage, peers);
    expect(result).toMatchObject({ ok: false, status: 502, code: 'FETCH_FAILED' });
    expect(await getActiveBook(storage)).toBeNull();
  });
});
