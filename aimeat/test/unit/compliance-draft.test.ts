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
 *   v1.1.0 — 2026-10-28 — Every app that uses AI is an entry (TalentGrid on innokas.aimeat.io had
 *     none), its Annex III area proposed from its data map, its models from its own calls; "publishes
 *     publicly" needs content a visitor can read, not a record existing.
 *   v1.0.0 — 2026-08-23 — BR-02.
 */
import { describe, it, expect } from 'vitest';
import { draftRegisterFromActivity } from '../../src/services/compliance-draft.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { DataMap } from '../../src/services/data-map/data-map-types.js';

const CONFIG = { nodeId: 'test-node', consentAuditRetentionDays: 90, aiProvenance: true } as unknown as AimeatConfig;

function storageWith(opts: {
  usage?: Array<{ agentGaii: string; model: string; owner?: string }>;
  agents?: Array<{ gaii: string; name: string; displayName?: string; description?: string; capabilities?: string[] }>;
  /** `public: false` is a record no visitor can read; absent counts as public, as before. */
  provenance?: Array<{ principal: string; humanInvolvement: string; public?: boolean; pipeline?: string; model?: string }>;
  appsWithGap?: Array<{ ownerName: string; filename: string }>;
  /** Apps as the listing gives them, with whatever posture and visibility the test needs. */
  apps?: Array<{ ownerName: string; filename: string; name?: string; parked?: boolean; aiPosture?: Record<string, unknown> }>;
  /** Data maps, by `owner/appId`. */
  maps?: Record<string, DataMap>;
  /** The stored register. */
  stored?: Array<{ id: string; title: string; apps?: string[] }>;
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
    listAiProvenance: async (q?: { publicOnly?: boolean; offset?: number }) => {
      // One page: the draft pages by offset, and a second page must come back empty.
      const rows = (q?.offset ?? 0) > 0 ? [] : (opts.provenance ?? []).filter(p => !q?.publicOnly || p.public !== false);
      return {
        items: rows.map((p, i) => ({
          id: `p${i}`, ownerGhii: 'alice@test-node', principal: p.principal, contentHash: null,
          generatedAt: '2026-08-01T00:00:00Z', createdAt: '2026-08-01T00:00:00Z',
          record: { humanInvolvement: p.humanInvolvement, generator: { pipeline: p.pipeline, model: p.model } },
        })),
        total: rows.length,
      };
    },
    listApps: async () => ({
      apps: [
        ...(opts.appsWithGap ?? []).map(a => ({
          ownerName: a.ownerName, filename: a.filename,
          manifest: { aiPosture: { gap: { code: 'AI_DISCLOSURE_MISSING' }, usesAi: true, generates: ['text'] } },
        })),
        ...(opts.apps ?? []).map(a => ({
          ownerName: a.ownerName, filename: a.filename, parked: a.parked,
          manifest: { name: a.name ?? a.filename, description: '', ...(a.aiPosture ? { aiPosture: a.aiPosture } : {}) },
        })),
      ],
    }),
    getMemory: async (owner: string, key: string) => {
      if (key === 'compliance.usecases' && opts.stored) return { value: { usecases: opts.stored } };
      const m = /^apps\.(.+)\.datamap$/.exec(key);
      const map = m ? opts.maps?.[`${owner.split('@')[0]}/${m[1]}`] : undefined;
      // No stored question set: the shipped default is used.
      return map ? { value: map } : null;
    },
  } as unknown as Storage;
}

/** TalentGrid's data map on innokas.aimeat.io (2026-10-28), abridged to the words that matter. */
const TALENTGRID_MAP: DataMap = {
  spec: 'aimeat.datamap/2', form: 'one-person', arrangement: 'four private records',
  what: 'TalentGrid is a competence and resourcing tool for a software organisation.',
  usedFor: "Answering 'who could we put on this' with evidence instead of memory.",
  machinery: ['ai-generation', 'login'], leaves: [], elsewhere: [], source: 'declared', at: '2026-08-31T08:23:10.633Z',
  held: [{
    what: 'talentgrid.people', holds: "each person's name, availability and allocation, their skill entries (level 1-5)",
    kind: 'register', usedFor: 'search-and-filter', where: 'owner-memory-private', owner: 'person', readers: 'owner-only',
    writers: ['person-in-the-ui'], shape: 'collection-under-one-key', keptFor: 'until-deleted', lossRisk: 'only-copy',
    personalData: 'yes', why: 'assessed competence about named colleagues',
  }],
};

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

  it('gives two agents sharing a display name two different ids', async () => {
    // Found by pressing the button on a node that had three agents called "ledgerbot": every one of
    // them slugged to uc-ledgerbot, the register refused the whole draft as duplicate ids, and the
    // button appeared to do nothing. The name is the person's, and it is not unique; the id must be.
    const draft = await draftRegisterFromActivity(storageWith({
      usage: [
        { agentGaii: 'one#alice@test-node', model: 'm/one' },
        { agentGaii: 'two#alice@test-node', model: 'm/two' },
        { agentGaii: 'three#alice@test-node', model: 'm/three' },
      ],
      agents: [
        { gaii: 'one#alice@test-node', name: 'one', displayName: 'Ledgerbot' },
        { gaii: 'two#alice@test-node', name: 'two', displayName: 'Ledgerbot' },
        { gaii: 'three#alice@test-node', name: 'three', displayName: 'Ledgerbot' },
      ],
    }), CONFIG);

    const ids = draft.usecases.map(u => u.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // The readable name survives on all three; only the id is disambiguated.
    expect(draft.usecases.every(u => u.title === 'Ledgerbot')).toBe(true);
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

  it('answers "does not publish" when everything it generated is private', async () => {
    // innokas.aimeat.io, 2026-10-28: every app parked, and the draft answered "publishes publicly:
    // yes" because a provenance record existed. A record says something was generated, not that
    // anyone outside can read it.
    const draft = await draftRegisterFromActivity(storageWith({
      usage: [{ agentGaii: 'teemu@test-node', model: 'm/one' }],
      provenance: [{ principal: 'teemu@test-node', humanInvolvement: 'none', public: false }],
    }), CONFIG);
    const uc = draft.usecases[0];
    expect(uc.answers?.['q-publishes-publicly']).toBe(false);
    expect(uc.answerSources?.['q-publishes-publicly']).toBe('evidence');
    // Review only matters for what is published; nothing is, so nothing is said about it.
    expect(uc.answers?.['q-human-reviews-before-publish']).toBeUndefined();
  });

  it('says what it could not work out', async () => {
    const draft = await draftRegisterFromActivity(storageWith({}), CONFIG);
    expect(draft.notes.length).toBeGreaterThanOrEqual(3);
    expect(draft.notes.join(' ')).toMatch(/nothing is stored/i);
  });
});

describe('every app that uses AI is in the draft, not only the ones with a gap', () => {
  const talentgrid = {
    apps: [{ ownerName: 'teemu', filename: 'talentgrid.html', name: 'TalentGrid', parked: true, aiPosture: { usesAi: true, generates: [] } }],
    maps: { 'teemu/talentgrid': TALENTGRID_MAP },
  };

  it('TalentGrid: an entry described by its data map, though its publish check found no gap', async () => {
    // innokas.aimeat.io, 2026-10-28: TalentGrid proposes who works on what from colleagues'
    // competence ratings with a model, and the draft did not list it at all.
    const draft = await draftRegisterFromActivity(storageWith(talentgrid), CONFIG);
    expect(draft.usecases).toHaveLength(1);
    const uc = draft.usecases[0];
    expect(uc.title).toBe('TalentGrid');
    expect(uc.apps).toEqual(['teemu/talentgrid.html']);
    expect(uc.description).toBe(TALENTGRID_MAP.what);
    expect(uc.purpose).toBe(TALENTGRID_MAP.usedFor);
    expect(uc.systems).toContain('the data map lists ai-generation in its machinery');
  });

  it('TalentGrid: the Annex III area is proposed as employment, marked proposed, with the reason', async () => {
    const draft = await draftRegisterFromActivity(storageWith(talentgrid), CONFIG);
    const uc = draft.usecases[0];
    expect(uc.answers?.['q-annex3-area']).toBe('employment');
    expect(uc.answerSources?.['q-annex3-area']).toBe('proposed');
    expect(draft.proposals).toEqual([expect.objectContaining({ usecase_id: uc.id, question: 'q-annex3-area', value: 'employment' })]);
    expect(draft.proposals[0].reason).toContain('talentgrid.people');
    expect(draft.counts.proposed).toBe(1);
  });

  it('a parked app publishes nothing to the public through itself: evidence', async () => {
    const draft = await draftRegisterFromActivity(storageWith(talentgrid), CONFIG);
    expect(draft.usecases[0].answers?.['q-publishes-publicly']).toBe(false);
    expect(draft.usecases[0].answerSources?.['q-publishes-publicly']).toBe('evidence');
  });

  it('a publicly served app leaves "does it publish" open: being served is not publishing AI output', async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      ...talentgrid, apps: [{ ...talentgrid.apps[0], parked: false }],
    }), CONFIG);
    expect(draft.usecases[0].answers?.['q-publishes-publicly']).toBeUndefined();
  });

  it("an app's models are the ones its own calls ran on, whoever made the call", async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      ...talentgrid,
      provenance: [
        { principal: 'teemu@test-node', humanInvolvement: 'none', public: false, pipeline: 'teemu/talentgrid.html', model: 'deepseek/v4' },
        { principal: 'mostafa@test-node', humanInvolvement: 'none', public: false, pipeline: 'teemu/talentgrid', model: 'liquid/lfm' },
        { principal: 'teemu@test-node', humanInvolvement: 'none', public: false, pipeline: 'teemu/other.html', model: 'other/model' },
      ],
    }), CONFIG);
    expect(draft.usecases[0].models).toEqual(['deepseek/v4', 'liquid/lfm']);
  });

  it('an app with no AI in its statements stays out, however much personal data it keeps', async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      apps: [{ ownerName: 'teemu', filename: 'roster.html' }],
      maps: { 'teemu/roster': { ...TALENTGRID_MAP, machinery: [] } },
    }), CONFIG);
    expect(draft.usecases).toEqual([]);
  });

  it('an app the stored register already names is not proposed again', async () => {
    const draft = await draftRegisterFromActivity(storageWith({
      ...talentgrid, stored: [{ id: 'uc-talentgrid', title: 'Staffing', apps: ['teemu/talentgrid.html'] }],
    }), CONFIG);
    expect(draft.usecases).toEqual([]);
  });
});
