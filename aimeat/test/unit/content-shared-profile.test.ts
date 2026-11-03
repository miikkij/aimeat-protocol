/**
 * @file test/unit/content-shared-profile.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workspace document's shared fingerprint (src/services/content/shared-profile.ts) and
 *   a person's correction (profile.ts correctSections, keepCorrections). The end-to-end path is
 *   test/e2e-content-class.ts test 13; this file proves what the node can no longer produce for a
 *   suite to read: a reader's OWN fingerprint of a workspace document, kept in their facts before
 *   2026-11-03, becomes the shared one on their next read and leaves their facts.
 * @structure correctSections · keepCorrections · sharedViewFor (the move of an earlier own one)
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-shared-profile.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-03 — Initial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, unknown>();
const ownFacts = new Map<string, any>();
const detail = new Map<string, unknown>();
const UNCHANGED = Symbol('unchanged');

vi.mock('../../src/services/record-cas.js', () => ({
  UNCHANGED,
  updateRecord: async (_s: unknown, owner: string, key: string, parse: (v: unknown) => unknown, mutate: (c: unknown) => unknown) => {
    const cur = parse(rows.get(`${owner}|${key}`));
    const next = await mutate(cur);
    if (next === UNCHANGED) return cur;
    rows.set(`${owner}|${key}`, next);
    return next;
  },
}));
vi.mock('../../src/services/workspace-access.js', () => ({
  decideWorkspaceRead: async () => ({ member: true, manager: false, canRead: true,
    manRec: { value: { objectTypes: [{ namespace: 'shared.pages' }] } } }),
}));
vi.mock('../../src/services/workspace-write.js', () => ({
  findWorkspaceRecord: async (_s: unknown, key: string) => ({ key, ownerGaii: 'w@n', value: { title: 'Sivu', markdown: TEXT }, version: 3, updatedAt: '2026-11-03T00:00:00Z' }),
}));
vi.mock('../../src/services/workspace-content.js', () => ({ loadWorkspaceContent: vi.fn() }));
vi.mock('../../src/services/organism-namespace-access.js', () => ({ checkOrganismNamespaceAccess: async () => null }));
vi.mock('../../src/services/classification/reader.js', () => ({
  readerFor: () => ({ show: async <T>(items: T[]) => items, useForAi: async () => undefined }),
  systemReader: () => ({ show: async <T>(items: T[]) => items, useForAi: async () => undefined }),
}));
vi.mock('../../src/services/event-bus.js', () => ({ emitWorkspaceChange: () => undefined, emitChange: () => undefined }));
vi.mock('../../src/services/content/facts-store.js', async (orig) => {
  const real = await orig<typeof import('../../src/services/content/facts-store.js')>();
  return {
    ...real,
    getFacts: async (_s: unknown, _o: string, id: string) => ownFacts.get(id) ?? null,
    putFacts: async (_d: unknown, _w: unknown, f: any) => { ownFacts.set(f.sourceId, f); return f; },
    getProfileDetail: async (_s: unknown, _o: string, key: string) => (detail.get(key) as never) ?? null,
    deleteProfileDetail: async (_d: unknown, _o: string, key: string) => detail.delete(key),
  };
});

const TEXT = '# Sivu\n\n## Yksi\nensimmäinen osio';
const { sharedViewFor } = await import('../../src/services/content/shared-profile.js');
const { correctSections, keepCorrections } = await import('../../src/services/content/profile.js');
const { sourceIdOf } = await import('../../src/services/content/facts-store.js');

const axes = { fakta: 0.5, konkr: 0.5, aika: 0, toim: 0, yks: 0.5, varm: 0.5 };
const sections = [1, 2, 3].map((n) => ({ n, heading: `H${n}`, claim: `C${n}`, words: 100, genre: 'F' as const, mark: '?' as const, certainty: 0.5, topic: n === 3 ? 1 : 0, axes }));
const profile = {
  v: 1 as const, prompt: 'profile-4', model: 'm', labels: 'model' as const, at: '2026-11-02T10:00:00Z', kind: 'raportti',
  topics: [{ name: 'A', share: 0.67, genre: 'F' as const, mark: '?' as const, axes }, { name: 'B', share: 0.33, genre: 'F' as const, mark: '?' as const, axes }],
  sections: sections.map((s) => [s.genre, s.words, s.certainty, s.mark, s.topic] as ['F', number, number, '?', number]),
  axes,
};

describe('correctSections and keepCorrections', () => {
  it('takes a person\'s mark, names them, and rebuilds the topics', () => {
    const c = correctSections(profile, sections, [{ n: 3, mark: '+' }], 'w@n', '2026-11-03T01:00:00Z');
    expect(c.sections[2].mark).toBe('+');
    expect(c.profile.sections[2][3]).toBe('+');
    expect(c.profile.topics[1].mark).toBe('+');
    expect(c.profile.corrected).toEqual({ by: 'w@n', at: '2026-11-03T01:00:00Z', sections: [3] });
  });
  it('refuses a section that is not there, and one that changes nothing', () => {
    expect(() => correctSections(profile, sections, [{ n: 7, mark: '+' }], 'w@n')).toThrow(/sections\[0\]\.n/);
    expect(() => correctSections(profile, sections, [{ n: 1 }], 'w@n')).toThrow(/changes nothing/);
    expect(() => correctSections(profile, sections, [{ n: 1, genre: 'Q' }], 'w@n')).toThrow(/genre/);
  });
  it('keeps the correction on a new run of the same words', () => {
    const prev = correctSections(profile, sections, [{ n: 2, genre: 'P', mark: '~' }], 'w@n');
    const next = keepCorrections(prev, { profile, sections });
    expect(next.sections[1]).toMatchObject({ genre: 'P', mark: '~' });
    expect(next.profile.corrected?.sections).toEqual([2]);
  });
});

describe('sharedViewFor', () => {
  beforeEach(() => { rows.clear(); ownFacts.clear(); detail.clear(); });

  it('moves the reader\'s own earlier fingerprint into the shared one and out of their facts', async () => {
    const key = 'organism.o1.w.ws1.shared.pages.p1.latest';
    const caller = { principal: 'v@n', owner: 'v', ownerGhii: 'v@n', inPerson: true, roles: ['owner'], scopes: [], auth: { sub: 'v', owner: 'v', roles: ['owner'], scopes: [] } } as never;
    const source = { kind: 'memory' as const, owner: 'v@n', key };
    const sid = sourceIdOf(source);
    ownFacts.set(sid, { source, sourceId: sid, technical: {}, stages: { technical: { at: 'x', ok: true }, profile: { at: 'x', ok: true } },
      readFrom: 'sha256:old', updatedAt: 'x', profile: { ...profile, detailKey: 'contentclass-profile/abc.json' } });
    detail.set('contentclass-profile/abc.json', sections);
    const deps = { storage: { getOrganism: async () => ({ id: 'o1' }), getMemory: async () => null }, config: { nodeId: 'n' } } as never;

    const view = await sharedViewFor(deps, caller, key, true);
    expect(view.shared).toMatchObject({ made_by: 'v@n', stale: true, doc_version: 0 });
    expect(view.profile_sections).toHaveLength(3);
    expect(view.facts.profile?.at).toBe(profile.at);
    expect([...rows.keys()]).toEqual(['system@n|organism.o1.w.ws1.meta.fingerprint.shared.pages~p1']);
    const left = ownFacts.get(sid);
    expect(left.profile).toBeUndefined();
    expect(left.stages.profile).toBeUndefined();
    expect(detail.size).toBe(0);
  });
});
