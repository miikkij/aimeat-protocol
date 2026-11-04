/**
 * @file test/unit/service-records.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-owner service namespace (services/service-records.ts, codebase analysis
 *   2026-11-03 item B6), on a real SQLite store:
 *   - the helper reads and writes `svc:<owner>@<node>` only, always private, on the version read;
 *   - the once-only move step copies, verifies, removes the old row only after the copy holds the same
 *     value, runs once when two starts race, and a legacy helper reads the old row until it has run;
 *   - DENIAL: no memory route reads or writes the service namespace, the account holder's own
 *     included: the list, the key read, the by-identity read, the copy, the search, the export and the
 *     operator's ?owner= on REST, and aimeat_memory_read, aimeat_memory_read_public and
 *     aimeat_memory_search on MCP;
 *   - OWNERSHIP: the GDPR export carries the account's service records and the account erasure
 *     removes them;
 *   - USAGE (the same before and after): a service-owned key the account keeps in its own namespace
 *     today is still listed, read and exported by the memory routes, which is why no prefix of
 *     SERVICE_OWNED_KEY_PREFIXES moved in item B6.
 * @usage cd aimeat && pnpm exec vitest run test/unit/service-records.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B6).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord, Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { memoryRouter } from '../../src/routes/memory.js';
import { registerOwnerExportRoute } from '../../src/routes/owners/export.js';
import { registerMemoryExtendedTools } from '../../src/mcp/memory-extended.js';
import { registerCoreTools } from '../../src/mcp/core.js';
import { agentSessionCaller } from '../../src/services/caller-context.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import {
  serviceRecords, moveServicePrefixOnce, serviceMoveStepKey, serviceNamespaceOf, isServiceNamespace, ownerOfServiceNamespace,
} from '../../src/services/service-records.js';

const N = 'aimeat-svc-test-001';
const ALICE = `alice@${N}`;
const BOB = `bob@${N}`;
const AGENT = `claude#alice@${N}`;
const SVC = `svc:${ALICE}`;
const PREFIX = 'example-holds.';
const stamp = '2026-11-04T12:00:00.000Z';

const auths: Record<string, unknown> = {
  alice: { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] },
  agent: { sub: AGENT, owner: 'alice', roles: ['agent'], scopes: ['memory:read', 'memory:write', 'memory:delete', 'memory:read-as-owner'] },
  opal: { sub: 'opal', owner: 'opal', roles: ['owner', 'operator'], scopes: [] },
};

function mem(ownerGaii: string, key: string, value: unknown, visibility: MemoryRecord['visibility'] = 'private'): MemoryRecord {
  return { key, ownerGaii, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp };
}

describe('the service namespace (codebase analysis 2026-11-03, item B6)', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  const s = (): Storage => storage as unknown as Storage;

  beforeEach(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: N };
    for (const [name, roles] of [['alice', ['owner']], ['bob', ['owner']], ['opal', ['owner', 'operator']]] as const) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: [...roles], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    await storage.createAgent({ name: 'claude', owner: 'alice', gaii: AGENT, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0, createdAt: stamp, lastSeen: stamp } as never);
  });
  afterEach(() => { storage.close(); });

  describe('the names', () => {
    it('an account identity has a service namespace; an agent, an ecosystem app and a bare name do not', () => {
      expect(serviceNamespaceOf(ALICE)).toBe(SVC);
      expect(isServiceNamespace(SVC)).toBe(true);
      expect(ownerOfServiceNamespace(SVC)).toBe(ALICE);
      expect(isServiceNamespace(ALICE)).toBe(false);
      for (const bad of [AGENT, `eco:app#alice@${N}`, 'alice', '']) expect(() => serviceNamespaceOf(bad)).toThrow();
    });
  });

  describe('serviceRecords<T>()', () => {
    it('writes private records in the service namespace and reads, lists and removes them there', async () => {
      const holds = serviceRecords<{ amount: number }>(s(), PREFIX);
      await holds.put(ALICE, 'h1', { amount: 5 });
      await holds.put(ALICE, 'h1', { amount: 7 });
      await holds.put(ALICE, 'h2', { amount: 1 });
      const row = await storage.getMemory(SVC, `${PREFIX}h1`);
      expect(row).toMatchObject({ ownerGaii: SVC, visibility: 'private', version: 2, value: { amount: 7 } });
      expect(await storage.getMemory(ALICE, `${PREFIX}h1`)).toBeNull();
      expect(await holds.get(ALICE, 'h1')).toEqual({ amount: 7 });
      expect(await holds.get(BOB, 'h1')).toBeNull();
      expect(await holds.list(ALICE)).toEqual([{ key: 'h1', value: { amount: 7 } }, { key: 'h2', value: { amount: 1 } }]);
      expect(await holds.delete(ALICE, 'h1')).toBe(true);
      expect(await holds.get(ALICE, 'h1')).toBeNull();
    });

    it('never reads the owner\'s own namespace unless the prefix is still moving', async () => {
      await storage.setMemory(mem(ALICE, `${PREFIX}old`, { amount: 3 }));
      expect(await serviceRecords(s(), PREFIX).get(ALICE, 'old')).toBeNull();
      expect(await serviceRecords(s(), PREFIX, { legacyOwnerNamespace: true }).get(ALICE, 'old')).toEqual({ amount: 3 });
    });

    it('refuses a prefix that does not end in a dot and an empty key', async () => {
      expect(() => serviceRecords(s(), 'example-holds')).toThrow();
      await expect(serviceRecords(s(), PREFIX).put(ALICE, '', 1)).rejects.toThrow();
    });
  });

  describe('moveServicePrefixOnce()', () => {
    beforeEach(async () => {
      await storage.setMemory(mem(ALICE, `${PREFIX}a`, { amount: 1 }, 'owner'));
      await storage.setMemory(mem(BOB, `${PREFIX}b`, { amount: 2 }));
      await storage.setMemory(mem(AGENT, `${PREFIX}c`, { amount: 3 }));
      await storage.setMemory(mem(`carol@other-node-001`, `${PREFIX}d`, { amount: 4 }));
    });

    it('copies, verifies, then removes the old row; an agent\'s and another node\'s row stay; runs once', async () => {
      const legacy = serviceRecords<{ amount: number }>(s(), PREFIX, { legacyOwnerNamespace: true });
      expect(await legacy.get(ALICE, 'a')).toEqual({ amount: 1 });
      expect(await moveServicePrefixOnce(s(), config, PREFIX)).toEqual({ ran: true, moved: 2, kept: 2 });
      expect(await storage.getMemory(ALICE, `${PREFIX}a`)).toBeNull();
      expect(await storage.getMemory(SVC, `${PREFIX}a`)).toMatchObject({ value: { amount: 1 }, visibility: 'private' });
      expect(await storage.getMemory(AGENT, `${PREFIX}c`)).not.toBeNull();
      expect(await storage.getMemory('carol@other-node-001', `${PREFIX}d`)).not.toBeNull();
      expect(await legacy.get(ALICE, 'a')).toEqual({ amount: 1 });
      expect(await moveServicePrefixOnce(s(), config, PREFIX)).toEqual({ ran: false, moved: 0, kept: 0 });
      const done = await storage.getMemory(`system@${N}`, serviceMoveStepKey(PREFIX));
      expect(done?.value).toMatchObject({ prefix: PREFIX, moved: 2, kept: 2 });
    });

    it('keeps the old row when the service namespace already holds a different value, and never overwrites it', async () => {
      await serviceRecords(s(), PREFIX).put(ALICE, 'a', { amount: 99 });
      expect((await moveServicePrefixOnce(s(), config, PREFIX)).kept).toBe(3);
      expect((await storage.getMemory(ALICE, `${PREFIX}a`))?.value).toEqual({ amount: 1 });
      expect((await storage.getMemory(SVC, `${PREFIX}a`))?.value).toEqual({ amount: 99 });
    });

    it('two starts at once: exactly one runs the step', async () => {
      const both = await Promise.all([moveServicePrefixOnce(s(), config, PREFIX), moveServicePrefixOnce(s(), config, PREFIX)]);
      expect(both.filter(r => r.ran)).toHaveLength(1);
      expect(await storage.getMemory(SVC, `${PREFIX}a`)).not.toBeNull();
    });

    it('a legacy helper stops reading the owner\'s namespace once the step has run', async () => {
      await moveServicePrefixOnce(s(), config, PREFIX);
      await storage.setMemory(mem(ALICE, `${PREFIX}late`, { amount: 8 }));
      expect(await serviceRecords(s(), PREFIX, { legacyOwnerNamespace: true }).get(ALICE, 'late')).toBeNull();
    });
  });

  describe('denial: no memory route reads or writes the service namespace, the owner\'s own included', () => {
    let server: http.Server;
    let base: string;
    const KEY = `${PREFIX}secret`;
    beforeEach(async () => {
      await serviceRecords(s(), PREFIX).put(ALICE, 'secret', { amount: 42 });
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const who = req.headers['x-test-as'];
        if (typeof who === 'string' && auths[who]) req.auth = auths[who] as never;
        next();
      });
      app.use(memoryRouter(config, s()));
      const owners = Router();
      registerOwnerExportRoute(owners, config, s());
      app.use(owners);
      server = http.createServer(app);
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(async () => { await new Promise<void>(r => server.close(() => r())); });
    const call = async (method: string, path: string, as: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method, headers: { 'x-test-as': as, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      return { status: res.status, text, body: JSON.parse(text) as { data?: any; error?: { code: string; message: string } } };
    };
    const untouched = async () => expect(await storage.getMemory(SVC, KEY)).toMatchObject({ value: { amount: 42 }, version: 1 });

    it('REST reads: the list, the key read, the search and the export leave it out; the by-identity read and ?agent= refuse it', async () => {
      for (const path of ['/v1/memory', '/v1/memory?include=meta', `/v1/memory?prefix=${PREFIX}`, '/v1/memory/search?q=amount', '/v1/memory/export']) {
        const res = await call('GET', path, 'alice');
        expect(res.status, path).toBe(200);
        expect(res.text, path).not.toContain('secret');
        expect(res.text, path).not.toContain(SVC);
      }
      expect((await call('GET', `/v1/memory/${encodeURIComponent(KEY)}`, 'alice')).status).toBe(404);
      for (const as of ['alice', 'agent']) {
        const direct = await call('GET', `/v1/memory/${encodeURIComponent(SVC)}/${encodeURIComponent(KEY)}`, as);
        expect(direct.status, as).toBe(403);
        expect(direct.body.error?.code, as).toBe('SERVICE_RECORD');
        expect(direct.body.error?.message, as).toContain('/v1/owners/alice/export');
      }
      expect((await call('GET', `/v1/memory?agent=${encodeURIComponent(SVC)}`, 'alice')).status).toBe(403);
      expect((await call('GET', `/v1/memory/export?agent=${encodeURIComponent(SVC)}`, 'alice')).status).toBe(403);
    });

    it('REST writes: the copy and the operator\'s ?owner= delete refuse it; a write or delete of the same key lands in the caller\'s own namespace', async () => {
      const copy = await call('POST', '/v1/memory/copy', 'agent', { source_gaii: SVC, key: KEY });
      expect(copy.status).toBe(403);
      expect(copy.body.error?.code).toBe('SERVICE_RECORD');
      const op = await call('DELETE', `/v1/memory/${encodeURIComponent(KEY)}?owner=${encodeURIComponent(SVC)}`, 'opal');
      expect(op.status).toBe(403);
      expect(op.body.error?.code).toBe('SERVICE_RECORD');
      const restore = await call('POST', `/v1/memory/${encodeURIComponent(KEY)}/restore?owner=${encodeURIComponent(SVC)}`, 'opal');
      expect(restore.status).not.toBe(200);
      expect((await call('DELETE', `/v1/memory/${encodeURIComponent(KEY)}`, 'alice')).status).toBe(404);
      const put = await call('POST', '/v1/memory', 'alice', { key: KEY, value: { amount: 1 } });
      expect(put.status, put.text).toBeLessThan(300);
      expect((await storage.getMemory(ALICE, KEY))?.value).toEqual({ amount: 1 });
      await untouched();
    });

    it('MCP: aimeat_memory_read_public refuses it; aimeat_memory_read and aimeat_memory_search do not find it; aimeat_memory_write lands elsewhere', async () => {
      type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
      const tools = new Map<string, Handler>();
      const fakeMcp = {
        registerTool: (name: string, ...rest: unknown[]) => { tools.set(name, rest[rest.length - 1] as Handler); },
        registerResource: () => undefined,
        registerPrompt: () => undefined,
        server: {},
      };
      const scopes = ['memory:read', 'memory:write', 'memory:read-as-owner'];
      registerMemoryExtendedTools(fakeMcp as never, s(), config, () => AGENT, () => undefined, () => undefined);
      registerCoreTools(fakeMcp as never, s(), config, () => AGENT, () => undefined, () => undefined, scopes, new Map(),
        () => agentSessionCaller(AGENT, 'alice', scopes, N, s()));
      const pub = await tools.get('aimeat_memory_read_public')!({ gaii: SVC, key: KEY });
      expect(pub.isError).toBe(true);
      expect(pub.content[0]!.text).toMatch(/^SERVICE_RECORD/);
      const read = await tools.get('aimeat_memory_read')!({ key: KEY, owner_scope: true });
      expect(read.isError).toBe(true);
      expect(read.content[0]!.text).not.toContain('42');
      const search = await tools.get('aimeat_memory_search')!({ query: 'amount', owner_scope: true });
      expect(JSON.stringify(search)).not.toContain(SVC);
      await tools.get('aimeat_memory_write')!({ key: KEY, value: { amount: 2 } });
      await untouched();
    });

    it('OWNERSHIP: the GDPR export carries the service record, and the account erasure removes it', async () => {
      const exp = await call('GET', '/v1/owners/alice/export', 'alice');
      expect(exp.status).toBe(200);
      const memories = exp.body.data.memories as Array<{ key: string; value: unknown }>;
      expect(memories.find(m => m.key === KEY)?.value).toEqual({ amount: 42 });
      const result = await eraseOwner(s(), N, 'alice');
      expect(await storage.getMemory(SVC, KEY)).toBeNull();
      expect(JSON.stringify(result)).toContain('service_records:1');
    });
  });

  describe('usage: a service-owned key in the account\'s own namespace answers as before', () => {
    let server: http.Server;
    let base: string;
    const HOLD = 'commerce.hold.h-1';
    beforeEach(async () => {
      await storage.setMemory(mem(ALICE, HOLD, { amount: 5 }, 'owner'));
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.auth = auths.alice as never; next(); });
      app.use(memoryRouter(config, s()));
      const owners = Router();
      registerOwnerExportRoute(owners, config, s());
      app.use(owners);
      server = http.createServer(app);
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(async () => { await new Promise<void>(r => server.close(() => r())); });
    const get = async (path: string) => (await (await fetch(`${base}${path}`)).json()) as { data: any };

    it('GET /v1/memory lists it and counts it in the quota, GET /v1/memory/:key reads it, both exports carry it', async () => {
      const list = await get('/v1/memory');
      expect(list.data.items.map((i: { key: string }) => i.key)).toEqual([HOLD]);
      expect(list.data.quota.used_keys).toBe(1);
      expect((await get(`/v1/memory/${encodeURIComponent(HOLD)}`)).data.value).toEqual({ amount: 5 });
      expect((await get('/v1/memory/export')).data.entries.map((e: { key: string }) => e.key)).toEqual([HOLD]);
      expect((await get('/v1/owners/alice/export')).data.memories.map((m: { key: string }) => m.key)).toEqual([HOLD]);
    });

    it('an account erasure with no service records logs no service_records entry', async () => {
      expect(JSON.stringify(await eraseOwner(s(), N, 'alice'))).not.toContain('service_records');
    });
  });
});
