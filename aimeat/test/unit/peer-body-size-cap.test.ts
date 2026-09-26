/**
 * @file test/unit/peer-body-size-cap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An answer another server sends is read with its size cap WHILE it arrives, at the two
 *   doors that read one whole before measuring it (secaudit 2026-09, N3):
 *     - a direct message's attachment copied from another node. The recipient's quota is checked
 *       against the size the attachment declares, and the copy then read the peer's download whole
 *       with arrayBuffer(), so a peer that sent no Content-Length streamed as much as it liked;
 *     - an OAuth client's metadata document, fetched from the address a stranger names as its
 *       client_id. Its 32 KB cap was checked on the text after all of it had been read.
 *   Each far side here serves a stream ten times its cap with no Content-Length, and the test counts
 *   how much of it was read. The same shape the package pull was fixed for (package-pull-size-cap).
 * @structure
 *   - requestStorageGrant: a download past the declared size copies nothing and is cancelled; one of
 *     exactly the declared size is copied whole; a grant answer past 64 KB is refused unread
 *   - resolveClientIdMetadata: a document past 32 KB is refused unread
 * @usage cd aimeat && pnpm exec vitest run test/unit/peer-body-size-cap.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, N3). Failed on the old code first.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, DirectMessageRecord, DirectMessageAttachment } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { generateKeyPair } from '../../src/auth/keypair.js';

const CHUNK = 64 * 1024;
/** The size the attachment declares, which the quota was checked against: 1 MB. */
const DECLARED = 16 * CHUNK;
/** The chunk that crosses the declared size is the last one worth reading. */
const CHUNKS_TO_CROSS = DECLARED / CHUNK + 1;

/** A stream of `totalChunks` chunks, counting what was pulled from it and whether it was cancelled. */
function farStream(totalChunks: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= totalChunks) { controller.close(); return; }
      state.pulled++;
      controller.enqueue(new Uint8Array(CHUNK));
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, state };
}

let served: ReturnType<typeof farStream>;
let grantBody: () => BodyInit;

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
  return {
    ...actual,
    safeFetch: vi.fn(async (url: string) => (url.endsWith('/v1/federation/storage/grant')
      ? new Response(grantBody(), { status: 200, headers: { 'content-type': 'application/json' } })
      // No Content-Length on purpose: the header is the one thing a hostile far side leaves out.
      : new Response(served.stream, { status: 200 }))),
  };
});

const { requestStorageGrant } = await import('../../src/services/attachment-duplication.js');
const { resolveClientIdMetadata } = await import('../../src/services/oauth-client-metadata.js');

const config = { nodeId: 'node-b', federationTimeoutMs: 5000 } as unknown as AimeatConfig;
const peers = new Map<string, PeerInfo>([['peer', {
  nodeId: 'node-a', url: 'https://node-a.example', publicKey: 'peer-key', status: 'active',
} as unknown as PeerInfo]]);
let storage: Storage;

const message = {
  id: 'msg-1', conversationId: 'conv-1', senderGhii: 'alice@node-a', recipientGhii: 'bob@node-b',
} as unknown as DirectMessageRecord;
const att: DirectMessageAttachment = {
  id: 'a1', inline: false, storageKey: 'photos/one.png', ownerGhii: 'alice@node-a', originNodeId: 'node-a',
  mode: 'reference', mime: 'image/png', size: DECLARED, kind: 'image',
};

beforeAll(async () => {
  const keys = await generateKeyPair();
  storage = { getNodeKey: async () => keys } as unknown as Storage;
});

beforeEach(() => {
  grantBody = () => JSON.stringify({ data: { download_url: 'https://node-a.example/v1/federation/storage/download/t1' } });
});

describe('copying an attachment from a peer', () => {
  it('copies nothing from a download past the declared size, stops reading there and cancels the rest', async () => {
    served = farStream(CHUNKS_TO_CROSS * 10);
    const bytes = await requestStorageGrant({ config, storage, peers }, message, att);
    // Until 2026-09-26 the whole stream was read and returned: 11 MB for a 1 MB attachment.
    expect(bytes).toBeNull();
    expect(served.state.pulled, `read ${served.state.pulled} of ${CHUNKS_TO_CROSS * 10} chunks`).toBeLessThanOrEqual(CHUNKS_TO_CROSS + 1);
    expect(served.state.cancelled).toBe(true);
  });

  it('copies a download of exactly the declared size whole', async () => {
    served = farStream(DECLARED / CHUNK);
    const bytes = await requestStorageGrant({ config, storage, peers }, message, att);
    expect(bytes?.length).toBe(DECLARED);
  });

  it('refuses a grant answer larger than a grant answer can be, without reading it whole', async () => {
    const grant = farStream(CHUNKS_TO_CROSS * 10);
    grantBody = () => grant.stream;
    served = farStream(1);
    expect(await requestStorageGrant({ config, storage, peers }, message, att)).toBeNull();
    expect(grant.state.cancelled).toBe(true);
    expect(grant.state.pulled).toBeLessThanOrEqual(2);
  });
});

describe('fetching an OAuth client\'s metadata document from the address it names', () => {
  it('refuses a document past 32 KB without reading it whole', async () => {
    served = farStream(CHUNKS_TO_CROSS * 10);
    expect(await resolveClientIdMetadata(`https://client.example/cimd-${Date.now()}.json`)).toBeNull();
    // Until 2026-09-26 all 11 MB were read into one string before the 32 KB cap was asked.
    expect(served.state.pulled, `read ${served.state.pulled} chunks`).toBeLessThanOrEqual(2);
    expect(served.state.cancelled).toBe(true);
  });
});
