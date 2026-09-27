/**
 * @file existing-install-seeds.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Existing-install fixtures for create-only schema/template/job seeds.
 * @version-history 1.0.0 2026-09-27 Preserve edits and add missing defaults on both providers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { seedProfileSchemas } from '../../src/services/profile-schemas.js';
import { seedCsmTemplates } from '../../src/services/csm-seed.js';
import { seedTemplateBundles } from '../../src/services/template-bundles.js';
import { seedCoreScheduledJobs } from '../../src/services/job-seeding.js';
import { loadConfig } from '../../src/config.js';

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
