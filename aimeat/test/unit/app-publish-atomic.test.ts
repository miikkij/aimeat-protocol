/**
 * @file app-publish-atomic.test.ts
 * @description A required roadmap note and app version either both commit or neither does.
 * @version-history
 *   v1.2.0 - 2026-09-26 - A dry run refuses a provenance declaration the caller may not make, as the
 *     real publish does, and the real publish refuses it before storing anything (bbfbeca149de).
 *     Failed on the old code first.
 *   v1.1.0 - 2026-09-24 - A dry run refuses a new app with no description, as the real publish does
 *     (bbfbeca149de). Failed on the old code first.
 *   v1.0.0 - 2026-09-08 - Exercise failures against real SQLite transactions.
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
  // bbfbeca149de: a dry run is how package-migrate asks "would this register?" before it deletes the
  // installed copy, so it has to answer what the real publish answers. It returned before a new app's
  // description was required, and said "would pass" to a publish that then refused.
  it('a dry run refuses a new app with no description, as the real publish does', async () => {
    const { storage, input } = setup();
    const bare = { ...input, requested: { name: 'App' } };
    expect(await publishApp(storage, config, bare)).toMatchObject({ refusal: { status: 400, code: 'INVALID_INPUT' } });
    expect(await publishApp(storage, config, { ...bare, dryRun: true })).toMatchObject({ refusal: { status: 400, code: 'INVALID_INPUT' } });
    expect(await publishApp(storage, config, { ...input, dryRun: true })).toEqual({ dryRun: true });
    // An update carries its description forward, so silence passes there, dry or not.
    expect(await publishApp(storage, config, input)).not.toHaveProperty('refusal');
    expect(await publishApp(storage, config, { ...bare, dryRun: true })).toEqual({ dryRun: true });
  });
  // The same, for the last refusal a publish makes: an agent declaring how the bytes were made
  // without provenance:write. It was thrown by the provenance mint below the dry-run return, so a
  // dry run answered "would pass" to a publish that then refused (bbfbeca149de).
  it('a dry run refuses a provenance declaration the caller may not make, as the real publish does', async () => {
    const { storage, input } = setup();
    const minting = { ...config, aiProvenance: true } as AimeatConfig;
    const declaring = {
      ...input, callerGaii: 'bot#alice@node-test',
      declaredProvenance: { level: 'ai-generated' as const, model: 'test-model' },
    };
    expect(await publishApp(storage, minting, { ...declaring, dryRun: true })).toMatchObject({ refusal: { status: 403, code: 'SCOPE_DENIED' } });
    expect(await publishApp(storage, minting, declaring)).toMatchObject({ refusal: { status: 403, code: 'SCOPE_DENIED' } });
    expect(await storage.getLatestVersionNumber(input.ownerGhii, input.filename)).toBe(0);
    // Without the declaration the node stamps the agent's write itself, which needs no word.
    expect(await publishApp(storage, minting, { ...input, callerGaii: 'bot#alice@node-test', dryRun: true })).toEqual({ dryRun: true });
  });
});
