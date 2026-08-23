/**
 * @file compliance-gaps.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The difference between what the node recorded and what the operator wrote down —
 *   the one number BR-02 exists to produce.
 *
 *   WHY A UNIT TEST AND NOT E2E. Producing a usage row from outside the server means a second process
 *   on one SQLite file, and the two connections do not see each other's WAL frames reliably; the
 *   attempt to verify this in a browser measured the harness rather than the feature. The gap
 *   computation is a pure fold over three inputs, so it is tested where it can be tested exactly, by
 *   handing buildComplianceReport a storage that returns the rows a real one would.
 *
 *   THE MATCH IS EXACT, AND THAT IS THE POINT. A model in the ledger counts as documented only when
 *   a use case names the same string. Loosening that would let a near-miss satisfy an entry silently,
 *   and a gap list that under-reports hides work — which is worse than one that asks about something
 *   already covered.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-gaps.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02. Closes the hole the browser pass exposed: no test drove the
 *     undocumented-model path, which is the headline half of the report.
 */
import { describe, it, expect } from 'vitest';
import { buildComplianceReport } from '../../src/services/compliance-report.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const CONFIG = {
  nodeId: 'test-node',
  consentAuditRetentionDays: 90,
  aiProvenance: true,
} as unknown as AimeatConfig;

/** The three reads buildComplianceReport makes, and nothing else. */
function storageWith(opts: {
  models?: string[];
  usecases?: unknown[];
  questionnaire?: unknown;
  appsWithGap?: Array<{ ownerName: string; filename: string; gap: string }>;
}): Storage {
  const usageRows = (opts.models ?? []).map(model => ({
    date: '2026-08-01', agentGaii: `a#o@test-node`, ownerGhii: 'o@test-node',
    apiKeyScope: 'owner', model, provider: 'x', organismId: '', workspaceId: '',
    promptTokens: 10, completionTokens: 5, costUsd: 0.001, calls: 1, unpricedCalls: 0,
  }));
  const memory: Record<string, unknown> = {};
  if (opts.usecases) memory['compliance.usecases'] = { usecases: opts.usecases };
  if (opts.questionnaire) memory['compliance.questionnaire'] = opts.questionnaire;

  return {
    queryUsageDailyAllOwners: async () => usageRows,
    consentFacets: async () => [],
    aiProvenanceFacets: async () => [],
    listAiProvenance: async () => ({ items: [], total: 0 }),
    listApps: async () => ({
      apps: (opts.appsWithGap ?? []).map(a => ({
        ownerName: a.ownerName, filename: a.filename,
        manifest: { aiPosture: { gap: { code: a.gap }, usesAi: true, generates: ['text'] } },
      })),
    }),
    getMemory: async (_owner: string, key: string) =>
      (key in memory ? { value: memory[key], version: 1, createdAt: '', updatedAt: '' } : null),
  } as unknown as Storage;
}

describe('a model the node ran that no use case names', () => {
  it('is reported as a gap, with the model as its evidence', async () => {
    const report = await buildComplianceReport(storageWith({ models: ['anthropic/claude-opus-5'] }), CONFIG);
    const gaps = report.gaps.filter(g => g.kind === 'undocumented-ai-activity');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].evidence).toEqual({ model: 'anthropic/claude-opus-5' });
    expect(gaps[0].detail).toContain('anthropic/claude-opus-5');
    // And the model reaches the derived half, which is what the tab lists and the CSV exports.
    expect(report.derived.ai_usage.models).toEqual(['anthropic/claude-opus-5']);
    expect(report.derived.ai_usage.calls).toBe(1);
  });

  it('stops being a gap once a use case names it exactly', async () => {
    const storage = storageWith({
      models: ['anthropic/claude-opus-5'],
      usecases: [{ id: 'uc', title: 'Drafting', models: ['anthropic/claude-opus-5'], answers: {} }],
    });
    const report = await buildComplianceReport(storage, CONFIG);
    expect(report.gaps.filter(g => g.kind === 'undocumented-ai-activity')).toHaveLength(0);
  });

  it('is still a gap when the use case names a NEARLY matching model', async () => {
    // The failure this guards is silent: a register entry that looks right, a model that is not the
    // one that ran, and a report that says everything is written down.
    const storage = storageWith({
      models: ['anthropic/claude-opus-5'],
      usecases: [{ id: 'uc', title: 'Drafting', models: ['anthropic/claude-opus-4'], answers: {} }],
    });
    const report = await buildComplianceReport(storage, CONFIG);
    expect(report.gaps.filter(g => g.kind === 'undocumented-ai-activity')).toHaveLength(1);
  });

  it('reports every distinct model, not only the first', async () => {
    const storage = storageWith({ models: ['a/one', 'b/two', 'a/one'] });
    const report = await buildComplianceReport(storage, CONFIG);
    expect(report.gaps.filter(g => g.kind === 'undocumented-ai-activity')).toHaveLength(2);
    expect(report.derived.ai_usage.models).toEqual(['a/one', 'b/two']);
  });
});

describe('an app that says it generates content while the publish check found a gap', () => {
  it('is reported, and says whether it is in the register at all', async () => {
    const storage = storageWith({
      appsWithGap: [{ ownerName: 'alice', filename: 'news.html', gap: 'no-disclosure' }],
    });
    const report = await buildComplianceReport(storage, CONFIG);
    const gaps = report.gaps.filter(g => g.kind === 'app-declares-generation-with-gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].evidence).toMatchObject({ app: 'alice/news.html', in_register: false });
  });
});

describe('what the report says it does not cover', () => {
  it('is never empty, and names the absent-record rule and the retention window', async () => {
    const report = await buildComplianceReport(storageWith({}), CONFIG);
    expect(report.not_covered.length).toBeGreaterThanOrEqual(5);
    const joined = report.not_covered.join(' ').toLowerCase();
    expect(joined).toMatch(/unstated|no record/);
    expect(joined).toContain('90 days');
  });

  it('says so plainly when provenance recording is off, rather than showing a clean zero', async () => {
    const off = { ...CONFIG, aiProvenance: false } as AimeatConfig;
    const report = await buildComplianceReport(storageWith({}), off);
    expect(report.not_covered.join(' ')).toContain('OFF');
  });
});
