/**
 * @file existing-install-seeds.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Existing-install fixtures for the schema/template/job seeds: an edit survives a boot,
 *   and (since 2026-11-21, services/seed/stamped-seed.ts) a record nobody edited follows this build.
 *   Each case of the second block puts the store in the state an older build or an operator left it
 *   in, then boots the seed again; every case resets what it reads first, because the PostgreSQL
 *   database outlives the run.
 * @version-history
 *   2026-11-21 — Seeds deliver a fix: profile schemas, core jobs, CSM templates, template bundles and
 *     the anonymous identity's scopes each bring an older build's copy up to this build and keep an edit.
 *   2026-11-07 — seedCsmTemplates is imported from services/csm/seed.ts, where it moved unchanged.
 *   2026-10-16 — A run that asks for PostgreSQL and has no DATABASE_URL fails here instead of passing on SQLite alone (QA audit P4-02).
 *   1.0.0 2026-09-27 Preserve edits and add missing defaults on both providers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { seedProfileSchemas } from '../../src/services/profile-schemas.js';
import { seedCsmTemplates } from '../../src/services/csm/seed.js';
import { seedTemplateBundles, loadBundle } from '../../src/services/template-bundles.js';
import { seedCoreScheduledJobs } from '../../src/services/job-seeding.js';
import { loadConfig } from '../../src/config.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedFingerprint, seedStampKey, SEED_STAMP_OWNER } from '../../src/services/seed/stamped-seed.js';
import { setupAnonymousIdentity } from '../../src/server-bootstrap/anonymous-identity.js';
import { ANONYMOUS_SCOPES } from '../../src/auth/anonymous-scopes.js';
import { parseCsm } from '../../src/services/csm-parser.js';

requirePostgresWhenAsked('existing-install-seeds');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const storage of providers.values()) await storage.close(); });
describe.each(names)('%s existing installation', name => {
  it('preserves a customized profile schema and fills missing profile schemas after node rename', async () => {
    const storage = providers.get(name)!;
    const keyPattern = 'profile.*.bio';
    const now = new Date().toISOString();
    const custom = { type: 'string', maxLength: 117, description: 'Operator choice' };
    await storage.setSchema({ keyPattern, applyTo: 'prefix', schemaJson: custom, schemaMode: 'open',
      lockedBy: 'operator@old-node', setAt: now, updatedAt: now });
    await seedProfileSchemas(storage, 'system@new-node');
    expect((await storage.getSchema(keyPattern, 'prefix'))?.schemaJson).toEqual(custom);
    expect(await storage.getSchema('profile.*.languages', 'prefix')).not.toBeNull();
    expect(await seedProfileSchemas(storage, 'system@new-node')).toBe(0);
  });

  it('keeps an operator cron and disabled state, and installs a newly shipped job', async () => {
    const storage = providers.get(name)!;
    const config = { ...loadConfig().config, nodeId: 'new-node' };
    const now = new Date().toISOString();
    await storage.deleteScheduledJob('core:usage-visit-retention');
    await storage.deleteScheduledJob('core:daily-allowance');
    await storage.createScheduledJob({ id: 'core:daily-allowance', name: 'My allowance job', type: 'core',
      coreHandler: 'daily-allowance', cron: '15 7 * * *', enabled: false, createdBy: 'system@old-node',
      createdAt: now, updatedAt: now });
    await seedCoreScheduledJobs(config, storage);
    expect(await storage.getScheduledJob('core:daily-allowance')).toMatchObject({ cron: '15 7 * * *', enabled: false });
    expect(await storage.getScheduledJob('core:usage-visit-retention')).toMatchObject({
      cron: '40 3 * * *', createdBy: 'system@new-node', coreHandler: 'usage-visit-retention',
    });
  });

  it('rebooting CSM and bundle seeders leaves existing definitions byte-equivalent', async () => {
    const storage = providers.get(name)!;
    await seedCsmTemplates(storage, 'system@old-node');
    await seedTemplateBundles(storage, 'system@old-node');
    const before = await storage.listCsms();
    expect(before.length).toBeGreaterThan(0);
    expect(await seedCsmTemplates(storage, 'system@new-node')).toBe(0);
    expect(await seedTemplateBundles(storage, 'system@new-node')).toBe(0);
    expect(await storage.listCsms()).toEqual(before);
  });
});

/** Write the stamp an older build would have written for `content`, or remove it. */
async function stamp(storage: Storage, store: string, name: string, content: unknown | null): Promise<void> {
  const key = seedStampKey(store, name);
  if (content === null) { await storage.deleteMemory(SEED_STAMP_OWNER, key); return; }
  const now = new Date().toISOString();
  await storage.setMemory({ key, ownerGaii: SEED_STAMP_OWNER, value: { fingerprint: seedFingerprint(content), at: now, action: 'create' },
    visibility: 'private', tags: ['seed-stamp'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
}

const STALE_SCHEMA = { type: 'string', maxLength: 12, $comment: 'an older build' };

describe.each(names)('%s seeds deliver a fix and keep an edit', name => {
  const config = { ...loadConfig().config, nodeId: 'new-node', anonymousMode: true };

  it('profile schema: an older build\'s copy is brought up to this build, with or without its stamp', async () => {
    const storage = providers.get(name)!;
    const keyPattern = 'profile.*.availability';
    await storage.deleteSchema(keyPattern, 'prefix');
    await stamp(storage, 'profile-schema', keyPattern, null);
    await seedProfileSchemas(storage, 'system@old-node');
    const shipped = (await storage.getSchema(keyPattern, 'prefix'))!;
    for (const withStamp of [true, false]) {
      await storage.setSchema({ ...shipped, schemaJson: STALE_SCHEMA, schemaMode: 'open', lockedBy: 'system@old-node', updatedAt: new Date().toISOString() });
      await stamp(storage, 'profile-schema', keyPattern, withStamp ? { schemaJson: STALE_SCHEMA, schemaMode: 'open' } : null);
      expect(await seedProfileSchemas(storage, 'system@new-node')).toBe(1);
      const after = (await storage.getSchema(keyPattern, 'prefix'))!;
      expect(after.schemaJson).toEqual(shipped.schemaJson);
      expect(after.lockedBy).toBe('system@new-node');
    }
    expect(await seedProfileSchemas(storage, 'system@new-node')).toBe(0);
  });

  it('profile schema: a copy changed after the seed wrote it, or locked by a person, is kept', async () => {
    const storage = providers.get(name)!;
    const keyPattern = 'profile.*.seeking';
    await storage.deleteSchema(keyPattern, 'prefix');
    await stamp(storage, 'profile-schema', keyPattern, null);
    await seedProfileSchemas(storage, 'system@new-node');
    const shipped = (await storage.getSchema(keyPattern, 'prefix'))!;
    // Changed under the seeder's own lock after the stamp was written: kept.
    await storage.setSchema({ ...shipped, schemaJson: STALE_SCHEMA, updatedAt: new Date().toISOString() });
    expect(await seedProfileSchemas(storage, 'system@new-node')).toBe(0);
    expect((await storage.getSchema(keyPattern, 'prefix'))!.schemaJson).toEqual(STALE_SCHEMA);
    // A person's lock whose content still matches the stamp: theirs all the same.
    await stamp(storage, 'profile-schema', keyPattern, { schemaJson: STALE_SCHEMA, schemaMode: shipped.schemaMode });
    await storage.setSchema({ ...shipped, schemaJson: STALE_SCHEMA, lockedBy: 'alice@new-node', updatedAt: new Date().toISOString() });
    expect(await seedProfileSchemas(storage, 'system@new-node')).toBe(0);
    expect((await storage.getSchema(keyPattern, 'prefix'))!.lockedBy).toBe('alice@new-node');
  });

  it('core job: an older build\'s cron is brought up to this build; an operator\'s cron is kept', async () => {
    const storage = providers.get(name)!;
    const id = 'core:value-fold';
    await storage.deleteScheduledJob(id);
    await stamp(storage, 'core-job', id, null);
    await seedCoreScheduledJobs(config, storage);
    const shipped = (await storage.getScheduledJob(id))!;
    const content = (cron: string, enabled = true) => ({ name: shipped.name, coreHandler: shipped.coreHandler, cron, enabled });

    // An older build shipped another cron and stamped it; nobody changed it since.
    await storage.updateScheduledJob(id, { cron: '1 1 * * *' });
    await stamp(storage, 'core-job', id, content('1 1 * * *'));
    await seedCoreScheduledJobs(config, storage);
    expect(await storage.getScheduledJob(id)).toMatchObject({ cron: shipped.cron, enabled: true });

    // The operator moved it and switched it off after the seed wrote it: kept.
    await storage.updateScheduledJob(id, { cron: '15 7 * * *', enabled: false });
    await seedCoreScheduledJobs(config, storage);
    expect(await storage.getScheduledJob(id)).toMatchObject({ cron: '15 7 * * *', enabled: false });
  });

  it('CSM template: a version-1 copy from before stamps is brought up; a replaced one is kept', async () => {
    const storage = providers.get(name)!;
    const csmName = parseCsm(readFileSync(join(process.cwd(), 'docs', 'csm-examples', 'auction.csm.yaml'), 'utf-8')).service.name;
    await storage.deleteCsm(csmName);
    await stamp(storage, 'csm-template', csmName, null);
    await seedCsmTemplates(storage, 'system@old-node');
    const shipped = (await storage.getCsm(csmName))!;
    const stale = { ...shipped.definition, description: 'an older build' };

    // Seeded by an older build before stamps: still version 1, so nobody replaced it.
    await storage.deleteCsm(csmName);
    await storage.createCsm({ ...shipped, definition: stale, version: 1 });
    await stamp(storage, 'csm-template', csmName, null);
    expect(await seedCsmTemplates(storage, 'system@new-node')).toBe(1);
    const after = (await storage.getCsm(csmName))!;
    expect(after.definition).toEqual(shipped.definition);
    expect(after.version).toBe(2);
    expect((await storage.listCsmVersions(csmName)).map(v => v.definition)).toEqual([stale]);

    // Replaced on this node (version 3 now) after the stamp: kept.
    const changed = { ...shipped.definition, description: 'the operator\'s words' };
    await storage.replaceCsmVersion(csmName, 2, { definition: changed, serviceType: shipped.serviceType, updatedAt: new Date().toISOString() },
      { name: csmName, version: 2, definition: shipped.definition, jsonSchema: {}, registeredBy: shipped.registeredBy, createdAt: shipped.updatedAt });
    expect(await seedCsmTemplates(storage, 'system@new-node')).toBe(0);
    expect((await storage.getCsm(csmName))!.definition).toEqual(changed);
  });

  it('template bundle: an older build\'s copy with its stamp is brought up; a second boot writes nothing', async () => {
    const storage = providers.get(name)!;
    const csmName = Object.values(loadBundle('project').objects)[0].csmName;
    await storage.deleteCsm(csmName);
    await stamp(storage, 'template-bundle', csmName, null);
    await seedTemplateBundles(storage, 'system@old-node');
    const bundle = (await storage.getCsm(csmName))!;
    // An older build seeded another definition and stamped it; nobody changed it since.
    const stale = { ...bundle.definition, description: 'an older build' };
    await storage.deleteCsm(csmName);
    await storage.createCsm({ ...bundle, definition: stale, version: 1 });
    await stamp(storage, 'template-bundle', csmName, stale);
    expect(await seedTemplateBundles(storage, 'system@new-node')).toBe(1);
    expect((await storage.getCsm(csmName))!.definition).toEqual(bundle.definition);
    expect(await seedTemplateBundles(storage, 'system@new-node')).toBe(0);
  });

  it('anonymous identity: an older build\'s scopes are brought up; scopes changed after the seed are kept', async () => {
    const storage = providers.get(name)!;
    const gaii = 'shared#anonymous@new-node';
    const scopes = async () => (await storage.getAgent(gaii))!.defaultScopes!;
    await setupAnonymousIdentity(config, storage);
    // What the seed writes, whatever an earlier run left: this build's list and its stamp.
    await storage.setAgentScopesIf(gaii, await scopes(), [...ANONYMOUS_SCOPES]);
    await stamp(storage, 'anonymous-scopes', gaii, [...ANONYMOUS_SCOPES].sort());

    // An older build shipped one word and stamped it; nobody changed it since.
    await storage.setAgentScopesIf(gaii, await scopes(), ['memory:read']);
    await stamp(storage, 'anonymous-scopes', gaii, ['memory:read']);
    await setupAnonymousIdentity(config, storage);
    expect([...await scopes()].sort()).toEqual([...ANONYMOUS_SCOPES].sort());

    // Changed on this node after the seed wrote it: kept.
    await storage.setAgentScopesIf(gaii, await scopes(), ['memory:read', 'catalogue:read']);
    await setupAnonymousIdentity(config, storage);
    expect(await scopes()).toEqual(['memory:read', 'catalogue:read']);
  });
});
