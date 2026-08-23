/**
 * @file compliance-draft.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node writing its own first draft of the register.
 *
 *   THE GROUPING IS THE WHOLE CLAIM. Twelve models on a real installation are not twelve uses of AI;
 *   they are however many things called them. A draft that grouped by model would hand somebody
 *   fifteen entries and a hundred and eighty dropdowns, which is the version this replaced and the
 *   version the operator refused — correctly.
 *
 *   AND THE OTHER HALF: it fills in only what it can point at. Two questions come from the record
 *   and are marked `evidence`; everything else is left empty. A test that only checked the grouping
 *   would pass while the draft quietly guessed, and a guessed answer that reads as considered is the
 *   failure the whole feature exists to prevent.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-draft.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02.
 */
import { describe, it, expect } from 'vitest';
import { draftRegisterFromActivity } from '../../src/services/compliance-draft.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const CONFIG = { nodeId: 'test-node', consentAuditRetentionDays: 90, aiProvenance: true } as unknown as AimeatConfig;

function storageWith(opts: {
  usage?: Array<{ agentGaii: string; model: string; owner?: string }>;
  agents?: Array<{ gaii: string; name: string; displayName?: string; description?: string; capabilities?: string[] }>;
  provenance?: Array<{ principal: string; humanInvolvement: string }>;
  appsWithGap?: Array<{ ownerName: string; filename: string }>;
}): Storage {
  return {
    queryUsageDailyAllOwners: async () => (opts.usage ?? []).map(u => ({
      date: '2026-08-01', agentGaii: u.agentGaii, ownerGhii: u.owner ?? 'alice@test-node',
      apiKeyScope: 'owner', model: u.model, provider: 'x', organismId: '', workspaceId: '',
      promptTokens: 1, completionTokens: 1, costUsd: 0, calls: 1, unpricedCalls: 0,
    })),
    listAgents: async () => (opts.agents ?? []).map(a => ({
      ...a, owner: 'alice', publicKey: '', trustScore: 0, morselBalance: 0,
      createdAt: '', lastSeen: '', capabilities: a.capabilities ?? [],
    })),
    listAiProvenance: async () => ({
      items: (opts.provenance ?? []).map((p, i) => ({
        id: `p${i}`, ownerGhii: 'alice@test-node', principal: p.principal, contentHash: null,
        generatedAt: '2026-08-01T00:00:00Z', createdAt: '2026-08-01T00:00:00Z',
        record: { humanInvolvement: p.humanInvolvement },
      })),
      total: (opts.provenance ?? []).length,
    }),
    listApps: async () => ({
      apps: (opts.appsWithGap ?? []).map(a => ({
        ownerName: a.ownerName, filename: a.filename,
        manifest: { aiPosture: { gap: { code: 'AI_DISCLOSURE_MISSING' }, usesAi: true, generates: ['text'] } },
      })),
    }),
    getMemory: async () => null,   // no stored question set: the shipped default is used
  } as unknown as Storage;
}

describe('the draft groups by what called the model, not by the model', () => {
  it('turns four models used by one agent into ONE entry', async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      usage: [
        { agentGaii: 'sanomat#alice@test-node', model: 'a/one' },
        { agentGaii: 'sanomat#alice@test-node', model: 'b/two' },
        { agentGaii: 'sanomat#alice@test-node', model: 'c/three' },
        { agentGaii: 'sanomat#alice@test-node', model: 'd/four' },
      ],
      agents: [{ gaii: 'sanomat#alice@test-node', name: 'sanomat', displayName: 'Sanomat', description: 'Writes the news' }],
    }), CONFIG);

    expect(draft.usecases).toHaveLength(1);
    expect(draft.usecases[0].title).toBe('Sanomat');
    // The description is the one its owner wrote when they created the agent. Nothing invented.
    expect(draft.usecases[0].description).toBe('Writes the news');
    expect(draft.usecases[0].models).toEqual(['a/one', 'b/two', 'c/three', 'd/four']);
  });

  it('keeps two agents apart even when they share a model', async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      usage: [
        { agentGaii: 'one#alice@test-node', model: 'shared/model' },
        { agentGaii: 'two#alice@test-node', model: 'shared/model' },
      ],
      agents: [
        { gaii: 'one#alice@test-node', name: 'one', displayName: 'First' },
        { gaii: 'two#alice@test-node', name: 'two', displayName: 'Second' },
      ],
    }), CONFIG);
    expect(draft.usecases.map(u => u.title).sort()).toEqual(['First', 'Second']);
  });

  it('gives unattributed activity an entry rather than dropping it', async () => {
    // Silently omitting it would make the register look complete while a real call went unmentioned.
    const draft = await draftRegisterFromActivity(storageWith({
      usage: [{ agentGaii: '', model: 'x/y' }],
    }), CONFIG);
    expect(draft.usecases).toHaveLength(1);
    expect(draft.usecases[0].title).toMatch(/no agent recorded/i);
    expect(draft.usecases[0].models).toEqual(['x/y']);
  });

  it('gives an app that declares it generates its own entry', async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      appsWithGap: [{ ownerName: 'alice', filename: 'newsroom.html' }],
    }), CONFIG);
    expect(draft.usecases).toHaveLength(1);
    expect(draft.usecases[0].apps).toEqual(['alice/newsroom.html']);
    expect(draft.usecases[0].ownerGhii).toBe('alice@test-node');
  });
});

describe('the draft answers only what it can point at', () => {
  it('marks a derived answer as evidence and leaves the judgement ones empty', async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      usage: [{ agentGaii: 'a#alice@test-node', model: 'm/one' }],
      agents: [{ gaii: 'a#alice@test-node', name: 'a' }],
      provenance: [{ principal: 'a#alice@test-node', humanInvolvement: 'none' }],
    }), CONFIG);

    const uc = draft.usecases[0];
    expect(uc.answers?.['q-publishes-publicly']).toBe(true);
    expect(uc.answers?.['q-human-reviews-before-publish']).toBe(false);
    expect(uc.answerSources?.['q-publishes-publicly']).toBe('evidence');
    expect(uc.answerSources?.['q-human-reviews-before-publish']).toBe('evidence');
    // The nine judgement questions are untouched. Guessing any of them is the failure this prevents.
    expect(Object.keys(uc.answers ?? {})).toHaveLength(2);
    expect(draft.counts.answeredFromEvidence).toBe(2);
    expect(draft.counts.leftToAnswer).toBeGreaterThan(0);
  });

  it('records a review when one actually happened', async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      usage: [{ agentGaii: 'a#alice@test-node', model: 'm/one' }],
      agents: [{ gaii: 'a#alice@test-node', name: 'a' }],
      provenance: [
        { principal: 'a#alice@test-node', humanInvolvement: 'none' },
        { principal: 'a#alice@test-node', humanInvolvement: 'editorial-control' },
      ],
    }), CONFIG);
    expect(draft.usecases[0].answers?.['q-human-reviews-before-publish']).toBe(true);
  });

  it('answers nothing when the principal has no record at all', async () => {
    // No provenance means nothing is known, and nothing known must produce no answer — not a false.
    const draft = await draftRegisterFromActivity(storageWith({
      usage: [{ agentGaii: 'a#alice@test-node', model: 'm/one' }],
      agents: [{ gaii: 'a#alice@test-node', name: 'a' }],
    }), CONFIG);
    expect(draft.usecases[0].answers).toEqual({});
    expect(draft.counts.answeredFromEvidence).toBe(0);
  });

  it('says what it could not work out', async () => {
    const draft = await draftRegisterFromActivity(storageWith({}), CONFIG);
    expect(draft.notes.length).toBeGreaterThanOrEqual(3);
    expect(draft.notes.join(' ')).toMatch(/nothing is stored/i);
  });
});
