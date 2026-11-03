/**
 * @file test/unit/app-version-summaries.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description listAppVersionSummaries reads the version line of one app without the content
 *   (codebase analysis 2026-11-03, item A1): version number, size, created-at, the manifest's version
 *   and the provenance id, newest first, one app's bucket only.
 * @usage cd aimeat && pnpm vitest run test/unit/app-version-summaries.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item A1).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AppRecord } from '../../src/storage/interface.js';

function appRow(ownerGaii: string, filename: string, version: number, semver: string | undefined, content: string, aiProvenanceId?: string): AppRecord {
  return {
    ownerGaii,
    ownerName: ownerGaii.split('@')[0],
    filename,
    versionNumber: version,
    manifest: { name: filename, description: '', ...(semver !== undefined ? { version: semver } : {}), category: 'utility', tags: [], authorDisplay: 'alice', usesCortex: [] } as AppRecord['manifest'],
    mimeType: 'text/html',
    size: content.length,
    data: Buffer.from(content),
    ...(aiProvenanceId ? { aiProvenanceId } : {}),
    createdAt: `2026-11-0${version}T10:00:00.000Z`,
  };
}

describe('listAppVersionSummaries (SqliteStorage)', () => {
  it('answers the summary fields of every version, newest first, and no content', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createApp(appRow('alice@node-x', 'a.html', 1, '1.0.0', '<h1>one</h1>'));
    await storage.createApp(appRow('alice@node-x', 'a.html', 2, undefined, '<h1>two, longer</h1>', 'prov-2'));
    await storage.createApp(appRow('alice@node-x', 'b.html', 1, '9.9.9', '<h1>other app</h1>'));
    await storage.createApp(appRow('bob@node-x', 'a.html', 1, '5.0.0', '<h1>other owner</h1>'));

    const rows = await storage.listAppVersionSummaries('alice@node-x', 'a.html');
    expect(rows).toEqual([
      { versionNumber: 2, size: '<h1>two, longer</h1>'.length, createdAt: '2026-11-02T10:00:00.000Z', version: undefined, aiProvenanceId: 'prov-2' },
      { versionNumber: 1, size: '<h1>one</h1>'.length, createdAt: '2026-11-01T10:00:00.000Z', version: '1.0.0', aiProvenanceId: undefined },
    ]);
    for (const r of rows) {
      expect(r).not.toHaveProperty('data');
      expect(r).not.toHaveProperty('manifest');
    }
    expect(await storage.listAppVersionSummaries('alice@node-x', 'none.html')).toEqual([]);
    storage.close();
  });

  it('answers the same version line listAppVersions answers, field for field', async () => {
    const storage = new SqliteStorage(':memory:');
    for (let v = 1; v <= 3; v++) await storage.createApp(appRow('carol@node-x', 'c.html', v, `1.0.${v}`, `<p>${'x'.repeat(v * 10)}</p>`, v === 3 ? 'prov-3' : undefined));
    const whole = await storage.listAppVersions('carol@node-x', 'c.html');
    const summaries = await storage.listAppVersionSummaries('carol@node-x', 'c.html');
    expect(summaries).toEqual(whole.map(v => ({
      versionNumber: v.versionNumber, size: v.size, createdAt: v.createdAt, version: v.manifest.version, aiProvenanceId: v.aiProvenanceId,
    })));
    storage.close();
  });
});
