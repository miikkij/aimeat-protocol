/**
 * @file test/unit/format-md-run-slots.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An anonymous ?format=md read runs the app owner's extension action
 *   (services/app-format-md.ts) through runExtensionActionAsSystem, which took no slot of the
 *   request-driven run pool, and readers who missed the cache at once each started a run, for any
 *   number of `?lang=` values (secaudit2026oct26,
 *   extension-system-run:request-driven-runs-outside-run-slot-pool). Now the run takes a slot on
 *   the owner's share, readers of one entry share one build, and a reader who finds no slot gets the
 *   stored face or the converted page, uncached. The usage half: once a slot is free the reader gets
 *   the action's markdown again, as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/format-md-run-slots.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const runs = { inFlight: 0, max: 0, total: 0, waiting: [] as Array<() => void> };
vi.mock('../../src/services/extension-system-run.js', () => ({
  runExtensionActionAsSystem: async () => {
    runs.inFlight++; runs.total++; runs.max = Math.max(runs.max, runs.inFlight);
    await new Promise<void>(r => runs.waiting.push(r));
    runs.inFlight--;
    return { result: { markdown: '# From the action' } };
  },
}));

const { buildAppAgentFace } = await import('../../src/services/agent-face.js');
const { SqliteStorage } = await import('../../src/storage/providers/sqlite/index.js');
import type { AimeatConfig } from '../../src/config.js';
import type { AppRecord } from '../../src/storage/interface.js';

const config = {
  nodeId: 'n', baseUrl: 'http://127.0.0.1:1', extensionRunSlots: 64, extensionRunSlotsPerAccount: 1, aiProvenance: false,
} as unknown as AimeatConfig;

let version = 100;
function app(): AppRecord {
  return {
    ownerGaii: 'fmowner@n', ownerName: 'fmowner', filename: 'face.html', versionNumber: ++version,
    manifest: { name: 'Face', description: '', version: '1.0.0', category: 'utility', tags: [], authorDisplay: 'fmowner', usesCortex: [], formatMd: { extension: 'fmext', action: 'md' } },
    mimeType: 'text/html', size: 20, data: Buffer.from('<h1>The page</h1>'), createdAt: new Date().toISOString(),
  } as AppRecord;
}

const settle = () => new Promise(r => setTimeout(r, 30));
function releaseAll() { const w = runs.waiting.splice(0); w.forEach(f => f()); }

describe('?format=md runs take the owner\'s run slots', () => {
  let storage: InstanceType<typeof SqliteStorage>;
  beforeAll(() => { storage = new SqliteStorage(':memory:'); });
  afterAll(() => { releaseAll(); storage.close(); });

  it('readers with different languages at once run the owner\'s action no more than the owner\'s share', async () => {
    runs.max = 0;
    const a = app();
    const out = ['en-A1', 'en-A2', 'en-A3'].map(lang => buildAppAgentFace(config, storage as never, a, { lang }));
    await settle();
    expect(runs.inFlight).toBeLessThanOrEqual(1);
    releaseAll();
    const faces = await Promise.all(out);
    expect(runs.max).toBeLessThanOrEqual(1);
    // The readers who found no slot got the converted page.
    expect(faces.filter(f => f && !f.fromFace && f.markdown.includes('The page')).length).toBe(2);
  });

  it('readers of the same entry at once share one run', async () => {
    const before = runs.total;
    const a = app();
    const out = [0, 1, 2].map(() => buildAppAgentFace(config, storage as never, a, { lang: 'fi' }));
    await settle();
    releaseAll();
    const faces = await Promise.all(out);
    expect(runs.total - before).toBe(1);
    expect(faces.every(f => f?.markdown.includes('From the action'))).toBe(true);
  });

  it('a reader who got the fallback because the slots were taken gets the action\'s markdown once one is free', async () => {
    const a = app();
    const first = buildAppAgentFace(config, storage as never, a, { lang: 'sv' });
    await settle();
    const busy = await buildAppAgentFace(config, storage as never, a, { lang: 'de' });
    expect(busy?.fromFace).toBe(false);
    releaseAll();
    await first;
    const again = buildAppAgentFace(config, storage as never, a, { lang: 'de' });
    await settle();
    releaseAll();
    expect((await again)?.markdown).toContain('From the action');
  });
});
