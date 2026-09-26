/**
 * @file test/unit/provenance-after-swap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A provenance record is stored only once the write it describes has landed, on the
 *   three doors whose write is a compare-and-swap: the in-place document edit, PUT /v1/memory/:key
 *   and PATCH /v1/memory/:key (secaudit 2026-09, N2). The provenance store is append-only, so a
 *   record about bytes that never landed cannot be taken back afterwards.
 *
 *   Each door loses its swap on purpose here: the storage's setMemoryIfVersion answers null, which
 *   is what it answers when another writer got there between the read and the write. Only a stub
 *   makes that happen every time; two real writers racing would prove it only now and then.
 * @structure
 *   - the document edit (appendToDocument): six lost swaps, then one that lands
 *   - PUT /v1/memory/:key through the real memory router: one lost swap, then one that lands
 *   - PATCH /v1/memory/:key through the real memory router: six lost swaps, then one that lands
 * @usage cd aimeat && pnpm exec vitest run test/unit/provenance-after-swap.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, N2). Failed on the old code first.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { appendToDocument, WorkspaceDocError } from '../../src/services/workspace-doc-edit.js';
import { memoryRouter } from '../../src/routes/memory.js';

const ORG = '7c2a1e4b-3d5f-4a6b-8c9d-0e1f2a3b4c5d';
const WS = 'ws-swapprov1';

let storage: Storage;
let config: AimeatConfig;
let NODE = '';
let OWNER = '';
let AGENT = '';

const root = () => `organism.${ORG}.w.${WS}`;

async function put(key: string, owner: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({ key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as MemoryRecord);
}

async function provenanceCount(): Promise<number> {
  return (await storage.listAiProvenance({ limit: 1000 })).total;
}

/** The real memory router, called by the owner's agent: the doors that stamp a non-human writer. */
function memoryApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { auth: unknown }).auth = {
      sub: AGENT, owner: 'alice', node: NODE, roles: ['agent'], scopes: ['memory:read', 'memory:write'], exp: 0,
    };
    next();
  });
  app.use(memoryRouter(config, storage));
  return app;
}

/** One request against the app, without pulling in a test-http library. */
function call(app: express.Express, method: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const payload = JSON.stringify(body);
      const req = http.request(
        { host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            server.close();
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} });
          });
        },
      );
      req.on('error', (e) => { server.close(); reject(e); });
      req.write(payload);
      req.end();
    });
  });
}

beforeAll(async () => {
  config = { ...loadConfig().config, aiProvenance: true };
  NODE = config.nodeId;
  OWNER = `alice@${NODE}`;
  AGENT = `claude#alice@${NODE}`;
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const now = new Date().toISOString();
  await storage.createGHII({ username: 'alice', nodeId: NODE, ghii: OWNER, displayName: 'Alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
  await storage.createOrganism({
    id: ORG, name: 'Specs', description: '', type: 'project', interests: [],
    creatorGhii: OWNER, createdBy: OWNER, owners: [OWNER], admins: [OWNER], members: [OWNER], agentGaiis: [],
    boardId: 'board-swap', joinPolicy: 'invite_only', maxMembers: 100, visibility: 'private',
    moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
    memoryNamespace: `organism.${ORG}`, createdAt: now, updatedAt: now,
  });
  await storage.createMembership({ id: 'm-swap', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: now });
  await put(`organism.${ORG}.meta.workspaces`, OWNER, { workspaces: [{ id: WS, name: 'Specs', createdAt: now, createdBy: 'alice' }] });
  await put(`${root()}.meta.manifest`, OWNER, {
    manifestVersion: '1', name: 'Specs', kind: 'project',
    objectTypes: [{ name: 'notes', namespace: 'specs.notes', mode: 'document', backing: 'memory' }],
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('the document edit stores its provenance record only once its swap lands', () => {
  it('six lost swaps answer 409 and store no record; the edit that lands stores one', async () => {
    await put(`${root()}.specs.notes.d1.draft`, OWNER, { id: 'd1', title: 'Spec', markdown: '# Spec\n' });
    const caller = { principal: AGENT, owner: 'alice', roles: ['agent'] };
    const target = { organismId: ORG, wsId: WS, space: 'notes', id: 'd1', markdown: '## Found\n\nA note.', pipeline: 'test' };
    const before = await provenanceCount();

    const swap = vi.spyOn(storage, 'setMemoryIfVersion').mockResolvedValue(null);
    let caught: unknown;
    try { await appendToDocument({ storage, config }, caller, target); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(WorkspaceDocError);
    expect((caught as WorkspaceDocError).code).toBe('VERSION_CONFLICT');
    expect(swap).toHaveBeenCalledTimes(6);
    // Until 2026-09-26 every lost attempt stored one: 0 → 6.
    expect(await provenanceCount()).toBe(before);

    swap.mockRestore();
    const landed = await appendToDocument({ storage, config }, caller, target);
    expect(landed.attempts).toBe(1);
    expect(await provenanceCount()).toBe(before + 1);
  });
});

describe('PUT /v1/memory/:key stores its provenance record only once its swap lands', () => {
  it('a write that loses the swap answers 409 and stores no record; the write that lands stores one', async () => {
    await put('swap.put', AGENT, { text: 'first' });
    const app = memoryApp();
    const before = await provenanceCount();

    vi.spyOn(storage, 'setMemoryIfVersion').mockResolvedValueOnce(null);
    const lost = await call(app, 'PUT', '/v1/memory/swap.put', { value: { text: 'lost' }, version: 1 });
    expect(lost.status).toBe(409);
    expect(lost.body.error?.code).toBe('VERSION_CONFLICT');
    expect(await provenanceCount()).toBe(before);

    const won = await call(app, 'PUT', '/v1/memory/swap.put', { value: { text: 'won' }, version: 1 });
    expect(won.status).toBe(200);
    expect(await provenanceCount()).toBe(before + 1);
  });
});

describe('PATCH /v1/memory/:key stores its provenance record only once its swap lands', () => {
  it('six lost swaps answer 409 and store no record; the patch that lands stores one', async () => {
    await put('swap.patch', AGENT, { a: 1 });
    const app = memoryApp();
    const before = await provenanceCount();

    const swap = vi.spyOn(storage, 'setMemoryIfVersion').mockResolvedValue(null);
    const lost = await call(app, 'PATCH', '/v1/memory/swap.patch', { patch: { b: 2 } });
    expect(lost.status).toBe(409);
    expect(lost.body.error?.code).toBe('VERSION_CONFLICT');
    expect(swap).toHaveBeenCalledTimes(6);
    expect(await provenanceCount()).toBe(before);

    swap.mockRestore();
    const won = await call(app, 'PATCH', '/v1/memory/swap.patch', { patch: { b: 2 } });
    expect(won.status).toBe(200);
    expect(await provenanceCount()).toBe(before + 1);
  });
});
