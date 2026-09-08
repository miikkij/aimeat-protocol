/**
 * @file app-publish-atomic.test.ts
 * @description A required roadmap note and app version either both commit or neither does.
 * @version-history v1.0.0 - 2026-09-08 - Exercise failures against real SQLite transactions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { publishApp, type PublishAppInput } from '../../src/services/app-publish.js';
import { readAppRoadmap } from '../../src/services/app-roadmap.js';
import { putDevGrant } from '../../src/services/app-dev-grant.js';

const stores: SqliteStorage[] = [];
const config = { nodeId: 'node-test', baseUrl: 'http://localhost:40319', aiProvenance: false, maxAppsPerAgent: 0 } as AimeatConfig;
function setup() {
  const storage = new SqliteStorage(':memory:');
  stores.push(storage);
  const input: PublishAppInput = {
    ownerName: 'alice', ownerGhii: 'alice@node-test', callerGaii: 'alice@node-test',
    filename: 'app.bin', data: Buffer.from('new version'), mimeType: 'application/octet-stream',
    requested: { name: 'App', description: 'An atomic publication.' }, source: 'inline',
    accessCode: { mode: 'carry' }, roadmap: 'A new version.',
  };
  return { storage, input };
}
afterEach(() => { vi.restoreAllMocks(); for (const s of stores.splice(0)) s.close(); });

describe('atomic app publication', () => {
  it('does not create an app when its roadmap cannot be written', async () => {
    const { storage, input } = setup();
    await putDevGrant(storage, { appId: 'alice/app.bin', account: 'bob', level: 10, grantedBy: input.callerGaii });
    vi.spyOn(storage, 'createMemoryIfAbsent').mockRejectedValueOnce(new Error('Roadmap disk failure'));
    await expect(publishApp(storage, config, input)).rejects.toThrow('Roadmap disk failure');
    expect(await storage.getLatestVersionNumber(input.ownerGhii, input.filename)).toBe(0);
  });
  it('rolls the roadmap back when storing the version fails', async () => {
    const { storage, input } = setup();
    vi.spyOn(storage, 'createApp').mockRejectedValueOnce(new Error('App disk failure'));
    await expect(publishApp(storage, config, input)).rejects.toThrow('App disk failure');
    expect(await readAppRoadmap(storage, 'alice/app.bin')).toBeNull();
  });
});
