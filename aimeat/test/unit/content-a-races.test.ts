/**
 * @file test/unit/content-a-races.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read-then-write sites listed by check:atomic-writes (group G5): the calibrator routes,
 *   the Design Book's reasons and usage records, the knowledge package manifest writers, the entry
 *   visibility change, contribution proofs and template proposals. Each test runs two operations at the
 *   same moment, on both real providers, and checks that both effects persist.
 *
 *   The interleaving is made deterministic by a storage wrapper: a key put on the barrier holds its
 *   first two reads until both have read, so the two operations each act on the copy they read before
 *   the other wrote. `afterRead` instead lands a second writer's change right after the first read of a
 *   key. Later reads (a retry on a fresh copy) pass straight through.
 *
 *   The routes are mounted on an express app with real tokens (calibrator, knowledge); the services
 *   are called directly.
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-a-races.test.ts
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/content-a-races.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (check:atomic-writes, group G5).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { calibratorRouter } from '../../src/routes/calibrator.js';
import { knowledgeRouter } from '../../src/routes/knowledge.js';
import { DesignBookReasons, REASONS_KEY_PREFIX, MADE_KEY, OWNER_NOTES_PREFIX } from '../../src/services/design-book/reasons.js';
import { DesignBookService, partKey, USAGE_KEY_PREFIX } from '../../src/services/design-book/service.js';
import { systemGhiiFor } from '../../src/services/compliance-register.js';
import { addKnowledgePackageEntry } from '../../src/services/knowledge-package-entry.js';
import { setKnowledgeEntryVisibility } from '../../src/services/knowledge-sharing.js';
import { attachContributionProof, packProofsKey } from '../../src/services/contribution-proofs.js';
import { proposeTemplate, templateProposalKey, type ProposeTemplateInput } from '../../src/services/app-template-proposals.js';
import type { BuildNotes } from '../../src/services/app-build-notes.js';

requirePostgresWhenAsked('content-a-races');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])] as const;
const RUN = randomUUID().slice(0, 8);
const NODE_ID = `content-a-${RUN}`;
const SYSTEM = systemGhiiFor(NODE_ID);

/** A storage whose reads of chosen keys can be held or followed by another writer. */
function controlled(inner: Storage) {
  let holds = new Map<string, { n: number; release: () => void; gate: Promise<void> }>();
  let after = new Map<string, (rec: MemoryRecord | null) => Promise<void>>();
  const proxy = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'getMemory') {
        return async (owner: string, key: string, ...rest: unknown[]) => {
          const rec = await (target.getMemory as (...a: unknown[]) => Promise<MemoryRecord | null>)(owner, key, ...rest);
          const hook = after.get(key);
          if (hook) { after.delete(key); await hook(rec); }
          const hold = holds.get(key);
          if (hold && hold.n < 2) {
            hold.n++;
            if (hold.n === 2) hold.release();
            await Promise.race([hold.gate, new Promise(r => setTimeout(r, 3000))]);
          }
          return rec;
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Storage;
  return {
    storage: proxy,
    /** The first two reads of each key wait for each other. */
    hold(...keys: string[]): void {
      holds = new Map(keys.map(k => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        return [k, { n: 0, release, gate }];
      }));
    },
    /** Run `fn` once, right after the next read of `key` and before the reader goes on. */
    afterRead(key: string, fn: (rec: MemoryRecord | null) => Promise<void>): void { after.set(key, fn); },
    clear(): void { holds = new Map(); after = new Map(); },
  };
}

const parsed = (rec: MemoryRecord | null): any => (rec ? (typeof rec.value === 'string' ? JSON.parse(rec.value) : rec.value) : null);

describe.each(names)('read-then-write sites of group G5 on %s', (provider) => {
  let inner: TestStorage;
  let ctl: ReturnType<typeof controlled>;
  let config: AimeatConfig;
  let server: http.Server;
  let base = '';
  let token = '';
  const OWNER = `ca${RUN}${provider === 'sqlite' ? 's' : 'p'}`;
  const GHII = `${OWNER}@${NODE_ID}`;

  const put = (owner: string, key: string, value: unknown, extra: Partial<MemoryRecord> = {}): Promise<unknown> => {
    const now = new Date().toISOString();
    return inner.setMemory({ key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now, ...extra });
  };
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsedBody: unknown = text;
    try { parsedBody = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsedBody };
  };

  beforeAll(async () => {
    inner = await createStorage({
      provider: provider === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage;
    ctl = controlled(inner);
    setThisNodeId(NODE_ID);
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' } as AimeatConfig;
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(inner, config);
    initRevocationStorage(inner, NODE_ID);
    await initStats();
    const ownerKeys = await generateKeyPair();
    await inner.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: new Date().toISOString() } as never);
    const now = new Date();
    const sessionId = `sess-${OWNER}`;
    await inner.createSession({ sessionId, gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    token = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 3600, sessionId);
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(calibratorRouter(config, ctl.storage));
    app.use(knowledgeRouter(config, ctl.storage));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    for (const owner of [GHII, SYSTEM]) {
      for (const rec of await inner.listMemory(owner, {})) await inner.deleteMemory(owner, rec.key, owner).catch(() => false);
    }
    await inner.deleteOwner(OWNER).catch(() => false);
    setThisNodeId(null);
    await inner.close();
  });

  // ── calibrator ──

  async function project(fields: Record<string, unknown> = {}): Promise<string> {
    const made = await call('POST', '/v1/calibrator', { name: 'Race' });
    const id = made.body.data.project.projectId as string;
    if (Object.keys(fields).length) {
      const key = `calibrator.${id}.project`;
      const rec = (await inner.getMemory(GHII, key))!;
      await inner.setMemory({ ...rec, value: { ...(rec.value as object), ...fields } });
    }
    return id;
  }
  const storedProject = async (id: string): Promise<any> => parsed(await inner.getMemory(GHII, `calibrator.${id}.project`));

  it('two concurrent project updates of different fields both persist', async () => {
    const id = await project();
    ctl.hold(`calibrator.${id}.project`);
    const [a, b] = await Promise.all([
      call('PUT', `/v1/calibrator/${id}`, { name: 'Renamed' }),
      call('PUT', `/v1/calibrator/${id}`, { status: 'paused' }),
    ]);
    ctl.clear();
    expect([a.status, b.status]).toEqual([200, 200]);
    const p = await storedProject(id);
    expect(p.name).toBe('Renamed');
    expect(p.status).toBe('paused');
  }, 30_000);

  it('a project read that fills in old templates keeps a concurrent update', async () => {
    const id = await project({ reflectionPromptTemplate: '' });
    ctl.hold(`calibrator.${id}.project`);
    const [g, u] = await Promise.all([
      call('GET', `/v1/calibrator/${id}`),
      call('PUT', `/v1/calibrator/${id}`, { name: 'Edited' }),
    ]);
    ctl.clear();
    expect([g.status, u.status]).toEqual([200, 200]);
    const p = await storedProject(id);
    expect(p.name).toBe('Edited');
    expect(p.reflectionPromptTemplate).toBeTruthy();
  }, 30_000);

  it('two concurrent version creations get two version numbers', async () => {
    const id = await project();
    ctl.hold(`calibrator.${id}.project`);
    const [a, b] = await Promise.all([
      call('POST', `/v1/calibrator/${id}/versions`, { prompt: 'first' }),
      call('POST', `/v1/calibrator/${id}/versions`, { prompt: 'second' }),
    ]);
    ctl.clear();
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.data.version.version, b.body.data.version.version].sort()).toEqual([1, 2]);
    expect((await storedProject(id)).currentVersion).toBe(2);
    const prompts = await Promise.all([1, 2].map(async v => parsed(await inner.getMemory(GHII, `calibrator.${id}.version.${v}`))?.prompt));
    expect(prompts.sort()).toEqual(['first', 'second']);
  }, 30_000);

  it('two concurrent batch updates of different fields both persist, and both batches add their dimensions', async () => {
    const id = await project();
    await call('POST', `/v1/calibrator/${id}/versions`, { prompt: 'p' });
    const b1 = (await call('POST', `/v1/calibrator/${id}/batches`, { promptVersion: 1 })).body.data.batch.batchId as string;
    const b2 = (await call('POST', `/v1/calibrator/${id}/batches`, { promptVersion: 1 })).body.data.batch.batchId as string;
    const models = (dim: string) => [{ modelId: 'm', step2_analysis: { overallScore: 1, dimensions: [{ name: dim, description: dim, category: 'structure' }] } }];

    ctl.hold(`calibrator.${id}.batch.${b1}`);
    const [x, y] = await Promise.all([
      call('PUT', `/v1/calibrator/${id}/batches/${b1}`, { status: 'analyzing' }),
      call('PUT', `/v1/calibrator/${id}/batches/${b1}`, { step4_synthesis: { status: 'done' } }),
    ]);
    ctl.clear();
    expect([x.status, y.status]).toEqual([200, 200]);
    const batch = parsed(await inner.getMemory(GHII, `calibrator.${id}.batch.${b1}`));
    expect(batch.status).toBe('analyzing');
    expect(batch.step4_synthesis.status).toBe('done');

    ctl.hold(`calibrator.${id}.dimensions`);
    const [m1, m2] = await Promise.all([
      call('PUT', `/v1/calibrator/${id}/batches/${b1}`, { models: models('alpha') }),
      call('PUT', `/v1/calibrator/${id}/batches/${b2}`, { models: models('beta') }),
    ]);
    ctl.clear();
    expect([m1.status, m2.status]).toEqual([200, 200]);
    const dims = parsed(await inner.getMemory(GHII, `calibrator.${id}.dimensions`)) as Array<{ name: string }>;
    expect(dims.map(d => d.name).sort()).toEqual(['alpha', 'beta']);
  }, 30_000);

  // ── Design Book reasons and usage ──

  const notes = (part: string, made: string): BuildNotes => ({
    took: [{ part, why: `took ${part}` }], passed: [], made: [{ name: made, what: made, why: made }],
  } as unknown as BuildNotes);
  const reasons = () => new DesignBookReasons(ctl.storage, { nodeId: NODE_ID });
  const recordInput = (owner: string, filename: string, version: number, part: string, made: string) => ({
    ownerGhii: `${owner}@${NODE_ID}`, ownerName: owner, filename, version, notes: notes(part, made),
    level: null, register: null, shareable: true,
  });

  it('two apps published at the same moment both keep their reason and made rows', async () => {
    const part = `p${RUN}a`;
    ctl.hold(REASONS_KEY_PREFIX + part, MADE_KEY);
    await Promise.all([
      reasons().record(recordInput(OWNER, 'one.html', 1, part, 'one-made')),
      reasons().record(recordInput(OWNER, 'two.html', 1, part, 'two-made')),
    ]);
    ctl.clear();
    const rec = parsed(await inner.getMemory(SYSTEM, REASONS_KEY_PREFIX + part));
    expect(rec.took.map((r: { app: string }) => r.app).sort()).toEqual([`${OWNER}/one.html`, `${OWNER}/two.html`]);
    const made = parsed(await inner.getMemory(SYSTEM, MADE_KEY));
    expect(made.rows.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(['one-made', 'two-made']));
  }, 30_000);

  it('a keep and a publish of the same app at the same moment keep the kept mark and the new version', async () => {
    const part = `p${RUN}b`;
    await reasons().record(recordInput(OWNER, 'keep.html', 1, part, 'keep-made'));
    ctl.hold(OWNER_NOTES_PREFIX + 'keep.html', REASONS_KEY_PREFIX + part, MADE_KEY);
    await Promise.all([
      reasons().keep({ ownerGhii: GHII, ownerName: OWNER, filename: 'keep.html', kept: true }),
      reasons().record(recordInput(OWNER, 'keep.html', 2, part, 'keep-made')),
    ]);
    ctl.clear();
    const mine = parsed(await inner.getMemory(GHII, OWNER_NOTES_PREFIX + 'keep.html'));
    // The keep marks the version that was live when it wrote: 1, or 2 when the publish landed first.
    expect([1, 2]).toContain(mine.kept_version);
    expect(mine.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
  }, 30_000);

  it('a keep beside another app\'s publish keeps both apps\' rows in the part and made records', async () => {
    const part = `p${RUN}c`;
    await reasons().record(recordInput(OWNER, 'kept.html', 1, part, 'kept-made'));
    ctl.hold(REASONS_KEY_PREFIX + part, MADE_KEY);
    await Promise.all([
      reasons().keep({ ownerGhii: GHII, ownerName: OWNER, filename: 'kept.html', kept: true }),
      reasons().record(recordInput(OWNER, 'other.html', 1, part, 'other-made')),
    ]);
    ctl.clear();
    const rec = parsed(await inner.getMemory(SYSTEM, REASONS_KEY_PREFIX + part));
    const kept = rec.took.find((r: { app: string }) => r.app === `${OWNER}/kept.html`);
    expect(kept?.kept).toBe(true);
    expect(rec.took.some((r: { app: string }) => r.app === `${OWNER}/other.html`)).toBe(true);
    const made = parsed(await inner.getMemory(SYSTEM, MADE_KEY));
    expect(made.rows.find((r: { name: string }) => r.name === 'kept-made')?.kept).toBe(true);
    expect(made.rows.some((r: { name: string }) => r.name === 'other-made')).toBe(true);
  }, 30_000);

  it('an app deletion beside another app\'s publish removes only the deleted app\'s rows', async () => {
    const part = `p${RUN}d`;
    await reasons().record(recordInput(OWNER, 'gone.html', 1, part, 'gone-made'));
    ctl.hold(REASONS_KEY_PREFIX + part, MADE_KEY);
    await Promise.all([
      reasons().forget(GHII, OWNER, 'gone.html'),
      reasons().record(recordInput(OWNER, 'stay.html', 1, part, 'stay-made')),
    ]);
    ctl.clear();
    const rec = parsed(await inner.getMemory(SYSTEM, REASONS_KEY_PREFIX + part));
    expect(rec.took.map((r: { app: string }) => r.app)).toEqual([`${OWNER}/stay.html`]);
    const made = parsed(await inner.getMemory(SYSTEM, MADE_KEY));
    expect(made.rows.some((r: { name: string }) => r.name === 'gone-made')).toBe(false);
    expect(made.rows.some((r: { name: string }) => r.name === 'stay-made')).toBe(true);
  }, 30_000);

  it('two apps naming one part at the same moment are both counted', async () => {
    const id = `race-part-${RUN}`;
    const now = new Date().toISOString();
    await put(SYSTEM, partKey(id), JSON.stringify({
      spec: 'aimeat.designbook.part/v1', id, kind: 'snippet', title: 'Part', summary: 'Part.', body: { code: 'x' }, tags: [], status: 'published',
      proposed_by: GHII, proposed_by_owner: GHII, created_at: now, updated_at: now, published_at: now,
    }), { visibility: 'public', tags: ['designbook', 'kind:snippet', 'status:published'] });
    const book = new DesignBookService(ctl.storage, config);
    ctl.hold(USAGE_KEY_PREFIX + id);
    const [a, b] = await Promise.all([book.recordUse(`${OWNER}/u1.html`, [id]), book.recordUse(`${OWNER}/u2.html`, [id])]);
    ctl.clear();
    expect([a.counted, b.counted]).toEqual([[id], [id]]);
    const usage = parsed(await inner.getMemory(SYSTEM, USAGE_KEY_PREFIX + id));
    expect(usage.count).toBe(2);
    expect(usage.apps.sort()).toEqual([`${OWNER}/u1.html`, `${OWNER}/u2.html`]);
  }, 30_000);

  // ── knowledge packages ──

  async function knowledgePackage(id: string): Promise<string> {
    const key = `packages/${id}/manifest`;
    await put(GHII, key, { name: id, entries: [], created: new Date().toISOString() }, { visibility: 'owner', tags: ['knowledge-package'] });
    return key;
  }
  const storedManifest = async (key: string): Promise<MemoryRecord> => (await inner.getMemory(GHII, key))!;

  it('a package contributed to two organisms at the same moment carries both organism tags', async () => {
    const pkg = `kp-${RUN}-org`;
    const key = await knowledgePackage(pkg);
    const now = new Date().toISOString();
    const orgs = [`o1-${RUN}-${provider}`, `o2-${RUN}-${provider}`];
    for (const org of orgs) {
      await inner.createOrganism({
        id: org, name: org, description: 'x', type: 'project', interests: [], creatorGhii: GHII, createdBy: GHII, owners: [GHII],
        admins: [GHII], members: [GHII], agentGaiis: [], boardId: `b-${org}`, joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
        moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false }, memoryNamespace: `organism.${org}`, createdAt: now, updatedAt: now,
      } as never);
      await inner.createMembership({ id: `m-${org}`, organismId: org, ghii: OWNER, role: 'creator', status: 'active', joinedAt: now } as never);
    }
    ctl.hold(key);
    const res = await Promise.all(orgs.map(org => call('POST', `/v1/knowledge/${pkg}/contribute`, { organism_id: org })));
    ctl.clear();
    expect(res.map(r => r.status)).toEqual([201, 201]);
    const tags = (await storedManifest(key)).tags;
    for (const org of orgs) expect(tags).toContain(`organism:${org}`);
  }, 30_000);

  it('two links added to one package at the same moment are both in its manifest', async () => {
    const pkg = `kp-${RUN}-link`;
    const key = await knowledgePackage(pkg);
    ctl.hold(key);
    const res = await Promise.all(['t1', 't2'].map(t => call('POST', `/v1/knowledge/${pkg}/link`, { target: `packages/${t}/manifest`, relation: 'references', description: t })));
    ctl.clear();
    expect(res.map(r => r.status)).toEqual([201, 201]);
    const links = (parsed(await storedManifest(key)).links ?? []) as Array<{ description: string }>;
    expect(links.map(l => l.description).sort()).toEqual(['t1', 't2']);
  }, 30_000);

  const writer = () => ({ principal: GHII, targetGaii: GHII, scopes: [] as string[], roles: ['owner'] });

  it('two entries added to one package at the same moment are both indexed', async () => {
    const pkg = `kp-${RUN}-entry`;
    const key = await knowledgePackage(pkg);
    ctl.hold(key);
    const out = await Promise.all(['e1', 'e2'].map(e => addKnowledgePackageEntry({ storage: ctl.storage, config }, writer(), {
      packageId: pkg, entryKey: e, content: `text ${e}`, pipeline: 'test.content-a',
    })));
    ctl.clear();
    expect(out.map(o => o.ok && o.manifestUpdated)).toEqual([true, true]);
    const entries = (parsed(await storedManifest(key)).entries ?? []) as Array<{ key: string }>;
    expect(entries.map(e => e.key).sort()).toEqual([`packages/${pkg}/e1`, `packages/${pkg}/e2`]);
  }, 30_000);

  it('an entry visibility change keeps an edit of the entry that lands after its read', async () => {
    const pkg = `kp-${RUN}-vis`;
    const key = `packages/${pkg}/manifest`;
    const entryKey = `packages/${pkg}/notes`;
    await put(GHII, key, { name: pkg, entries: [{ key: entryKey, title: 'notes', visibility: 'owner' }] }, { visibility: 'owner', tags: ['knowledge-package'] });
    await put(GHII, entryKey, 'old text', { visibility: 'owner', tags: ['knowledge-entry'] });
    const row = { record: await storedManifest(key), ownerGaii: GHII };
    ctl.afterRead(entryKey, async (rec) => { await inner.setMemory({ ...rec!, value: 'new text', version: rec!.version + 1, updatedAt: new Date().toISOString() }); });
    const ok = await setKnowledgeEntryVisibility({ storage: ctl.storage, config } as never, row, pkg, 'notes', 'members');
    ctl.clear();
    expect(ok).toBe(true);
    const entry = (await inner.getMemory(GHII, entryKey))!;
    expect(entry.value).toBe('new text');
    expect(entry.visibility).not.toBe('owner');
  }, 30_000);

  // ── contribution proofs and template proposals ──

  it('two proofs attached to one library pack at the same moment are both kept', async () => {
    const packId = `pack-${RUN}`;
    const store = new Proxy(ctl.storage, {
      get(target, prop) {
        if (prop === 'listCortexExtensions') return async () => [{ name: packId, visibility: 'public', components: [{ type: 'lib' }], installedBy: OWNER, status: 'active' }];
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as Storage;
    ctl.hold(packProofsKey(packId));
    const out = await Promise.all(['model-a', 'model-b'].map(model => attachContributionProof({ storage: store, config }, writer(), {
      subjectType: 'library_pack', subjectId: packId, model, verdict: 'pass', evidence: 'https://e.test/run', pipeline: 'test.content-a',
    })));
    ctl.clear();
    expect(out.map(o => o.ok)).toEqual([true, true]);
    const proofs = parsed(await inner.getMemory(GHII, packProofsKey(packId))).proofs as Array<{ model: string }>;
    expect(proofs.map(p => p.model).sort()).toEqual(['model-a', 'model-b']);
  }, 30_000);

  const withApp = (s: Storage): Storage => new Proxy(s, {
    get(target, prop) {
      if (prop === 'getApp') return async () => ({ versionNumber: 3 });
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Storage;
  const proposal = (id: string, title: string): ProposeTemplateInput => ({
    id, title, description: 'd', derived_from: { owner: OWNER, filename: 'src.html' }, tier: 'T1', reuse_notes: 'r', model: 'm',
  });

  it('a template re-proposed while a proof is attached keeps the proof and the new wording', async () => {
    const id = `tpl-${RUN}-a`;
    const store = withApp(ctl.storage);
    expect('manifest' in await proposeTemplate(store, config, GHII, proposal(id, 'First'))).toBe(true);
    ctl.hold(templateProposalKey(id));
    const [p, a] = await Promise.all([
      proposeTemplate(store, config, GHII, proposal(id, 'Second')),
      attachContributionProof({ storage: store, config }, writer(), {
        subjectType: 'app_template', subjectId: id, model: 'model-a', verdict: 'pass', evidence: 'https://e.test/run', pipeline: 'test.content-a',
      }),
    ]);
    ctl.clear();
    expect('manifest' in p).toBe(true);
    expect(a.ok).toBe(true);
    const stored = parsed(await inner.getMemory(GHII, templateProposalKey(id)));
    expect(stored.title).toBe('Second');
    expect((stored.proofs ?? []).map((x: { model: string }) => x.model)).toEqual(['model-a']);
  }, 30_000);

  it('two proofs attached to one template proposal at the same moment are both kept', async () => {
    const id = `tpl-${RUN}-b`;
    const store = withApp(ctl.storage);
    await proposeTemplate(store, config, GHII, proposal(id, 'Only'));
    ctl.hold(templateProposalKey(id));
    const out = await Promise.all(['model-a', 'model-b'].map(model => attachContributionProof({ storage: store, config }, writer(), {
      subjectType: 'app_template', subjectId: id, model, verdict: 'pass', evidence: 'https://e.test/run', pipeline: 'test.content-a',
    })));
    ctl.clear();
    expect(out.map(o => o.ok)).toEqual([true, true]);
    const stored = parsed(await inner.getMemory(GHII, templateProposalKey(id)));
    expect((stored.proofs ?? []).map((x: { model: string }) => x.model).sort()).toEqual(['model-a', 'model-b']);
  }, 30_000);
});
