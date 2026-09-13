/**
 * @file test/unit/app-publish-served-copy.test.ts
 * @description publishApp against real SQLite, given a served copy of an app instead of its source.
 *
 *   THE DECISION (2026-09-13). The publish removes the node's own serve marks before storing, names
 *   what it removed, and does not refuse. Three things have to be computed on the stripped bytes
 *   for that to mean anything, and each has a case: the bytes stored, the content hash in the
 *   provenance record (a detection query asks about the bytes a person downloads), and the
 *   AI-disclosure decision. The last is not hypothetical: the node's own visible label carries
 *   `aimeat-ai-label`, which the posture check reads as the app disclosing its AI, so a served copy
 *   of an app that discloses nothing used to publish with its transparency gap hidden.
 * @usage pnpm exec vitest run test/unit/app-publish-served-copy.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial. All three publishing cases failed against the publish that stored
 *     the upload as sent (stored bytes carried the marks, the posture read `disclosureCallFound`
 *     true from the node's label, the result named no removals).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { publishApp, type PublishAppInput, type PublishAppResult } from '../../src/services/app-publish.js';
import { applyServeMarks } from '../../src/services/app-serve-marks.js';
import { contentHashOf } from '../../src/services/ai-provenance.js';
import { provFixture } from './serve-marks-fixtures.js';

const stores: SqliteStorage[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); });

const config = {
  nodeId: 'node-test', baseUrl: 'http://localhost:40319', port: 40319,
  aiProvenance: true, aiLabelPublic: 'strict', aiProvenanceDetail: 'full',
  maxAppsPerAgent: 0, appAssetProbe: false,
} as unknown as AimeatConfig;

/** An app that asks for ai:use and tells nobody a model is involved: the posture gap case. */
const SOURCE = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
  + '<meta name="aimeat-app" content="served.html"><meta name="aimeat-scopes" content="ai:use memory:read">'
  + '<meta name="aimeat-locales" content="en"><title>Served</title></head>'
  + '<body><main id="app">Tervetuloa, café</main>'
  + '<script>document.getElementById("app").dataset.ready = "1";</script></body></html>';

function servedCopy(): Buffer {
  return applyServeMarks(SOURCE, {
    isDocument: true,
    badge: true,
    provenance: provFixture('labelled'),
    visibleLabel: { config, locale: 'fi' },
    reviewedBy: 'Maija Meikäläinen',
    discovery: {
      owner: 'alice', filename: 'served.html', appName: 'Served', description: 'A served copy',
      baseUrl: 'http://localhost:40319', toolNames: [], webmcp: true,
    },
  });
}

function input(data: Buffer, callerGaii = 'builder#alice@node-test'): PublishAppInput {
  return {
    ownerName: 'alice', ownerGhii: 'alice@node-test', callerGaii,
    filename: 'served.html', data, mimeType: 'text/html',
    requested: { name: 'Served', description: 'An app published from a served copy.' },
    source: 'inline', accessCode: { mode: 'carry' },
  };
}

async function publish(data: Buffer): Promise<{ storage: SqliteStorage; out: PublishAppResult }> {
  const storage = new SqliteStorage(':memory:');
  stores.push(storage);
  const out = await publishApp(storage, config, input(data));
  if ('refusal' in out) throw new Error(`refused: ${JSON.stringify(out.refusal)}`);
  return { storage, out };
}

describe('publishApp: a served copy is stored as its source', () => {
  it('stores the source bytes, not the served copy, and names every mark it took out', async () => {
    const served = servedCopy();
    expect(served.toString('utf-8')).toContain('id="aimeat-app-badge"');
    const { storage, out } = await publish(served);

    const stored = await storage.getApp('alice@node-test', 'served.html');
    expect(Buffer.from(stored!.data).toString('utf-8')).toBe(SOURCE);
    expect(stored!.size).toBe(Buffer.byteLength(SOURCE));
    expect(out.size).toBe(Buffer.byteLength(SOURCE));
    expect((out.servedMarksRemoved ?? []).map(r => r.mark).sort())
      .toEqual(['agent-discovery', 'ai-disclosure', 'ai-label', 'app-ref', 'badge', 'chrome-reserve', 'reviewed-by']);
    // The notice replaced the warning: nothing in the hints talks about a served copy any more.
    expect(out.artifactWarnings.map(f => f.pitfall)).not.toContain('edit-published-app');
  });

  it('hashes the stripped bytes into the provenance record', async () => {
    const { storage, out } = await publish(servedCopy());
    expect(out.aiProvenanceId).toBeTruthy();
    const row = await storage.getAiProvenance(out.aiProvenanceId!);
    expect(row?.record.attestation?.contentHash).toBe(contentHashOf(Buffer.from(SOURCE, 'utf-8')));
  });

  it('decides the AI disclosure on the stripped bytes, so the node\'s own label cannot hide the gap', async () => {
    const { out } = await publish(servedCopy());
    expect(out.aiLint?.posture.disclosureCallFound).toBe(false);
    expect(out.aiLint?.posture.gap?.code).toBe('AI_DISCLOSURE_MISSING');
  });

  it('publishes the source itself exactly as before, with nothing named', async () => {
    const { storage, out } = await publish(Buffer.from(SOURCE, 'utf-8'));
    expect(out.servedMarksRemoved ?? []).toEqual([]);
    const stored = await storage.getApp('alice@node-test', 'served.html');
    expect(Buffer.from(stored!.data).toString('utf-8')).toBe(SOURCE);
  });

  it('leaves a non-HTML bundle alone even when its bytes contain a mark', async () => {
    const storage = new SqliteStorage(':memory:');
    stores.push(storage);
    const bytes = Buffer.from('<div id="aimeat-app-badge">x</div>', 'utf-8');
    const out = await publishApp(storage, config, { ...input(bytes), filename: 'blob.bin', mimeType: 'application/octet-stream' });
    if ('refusal' in out) throw new Error(out.refusal.message);
    const stored = await storage.getApp('alice@node-test', 'blob.bin');
    expect(Buffer.compare(Buffer.from(stored!.data), bytes)).toBe(0);
    expect(out.servedMarksRemoved ?? []).toEqual([]);
  });
});
