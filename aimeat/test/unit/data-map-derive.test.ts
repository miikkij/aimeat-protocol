/**
 * @file test/unit/data-map-derive.test.ts
 * @description The data map's head declaration and the draft the node works out from it.
 *
 *   Two properties carry most of the value and are asserted directly rather than through a happy
 *   path. PURITY: the derivation takes its clock as an argument and touches no storage, so the same
 *   input yields the same map twice — which is what lets a publish and a one-off backfill over 169
 *   apps call the same function and get the same answer. And WHAT IT REFUSES TO INVENT: every `why`
 *   comes back empty, because a plausible sentence nobody wrote is worse than a visible blank.
 * @usage pnpm test -- data-map-derive
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 steps 3-4.
 */
import { describe, it, expect } from 'vitest';
import { parseDataMapMeta, formatDataMapMeta } from '../../src/services/data-map/data-map-meta.js';
import { deriveDataMap } from '../../src/services/data-map/data-map-derive.js';
import { DATA_MAP_SPEC, type DataMap } from '../../src/services/data-map/data-map-types.js';

const AT = '2026-08-24T12:00:00.000Z';
const head = (content: string) => `<html><head><meta name="aimeat-datamap" content="${content}"></head><body></body></html>`;

describe('parseDataMapMeta', () => {
  it('reads the form, the areas and the document pointer', () => {
    const d = parseDataMapMeta(head('form=shared; areas=uutiset.*:rw:personal, prefs.*:r; doc=apps.uutiset.datamap'));
    expect(d).not.toBeNull();
    expect(d!.form).toBe('shared');
    expect(d!.doc).toBe('apps.uutiset.datamap');
    expect(d!.areas).toEqual([
      { pattern: 'uutiset.*', rights: ['read', 'write'], personalData: 'yes', area: 'memory' },
      { pattern: 'prefs.*', rights: ['read'], personalData: 'unstated', area: 'memory' },
    ]);
  });

  it('reads a leading store name', () => {
    const d = parseDataMapMeta(head('form=private; areas=storage:reports/*:rw'));
    expect(d!.areas[0]).toMatchObject({ area: 'storage', pattern: 'reports/*' });
  });

  it('treats an unknown form as mixed rather than refusing', () => {
    expect(parseDataMapMeta(head('form=wat; areas=a.*:r'))!.form).toBe('mixed');
  });

  it('returns null when the app declares nothing', () => {
    expect(parseDataMapMeta('<html><head></head></html>')).toBeNull();
  });

  it('never throws on a malformed declaration — a typo must not be able to stop a publish', () => {
    for (const bad of ['', 'form=; areas=', 'areas=:::', 'form=shared; areas=,,,', 'garbage']) {
      expect(() => parseDataMapMeta(head(bad))).not.toThrow();
    }
  });

  it('round-trips, so a hint can hand the builder the exact line to paste', () => {
    const original = 'form=group; areas=crm.*:rw:personal; doc=apps.cadence.datamap';
    const reparsed = parseDataMapMeta(head(formatDataMapMeta(parseDataMapMeta(head(original))!).replace(/^<meta[^>]*content="/, '').replace(/">$/, '')));
    expect(reparsed!.form).toBe('group');
  });
});

describe('deriveDataMap: purity', () => {
  const input = { programKind: 'app' as const, programId: 'cadence', ownerName: 'alice', at: AT, scopes: ['memory:read', 'memory:write'] };

  it('gives the same map twice', () => {
    expect(deriveDataMap(input)).toEqual(deriveDataMap(input));
  });

  it('stamps the time it was given rather than reading a clock', () => {
    expect(deriveDataMap(input).at).toBe(AT);
    expect(deriveDataMap({ ...input, at: '2020-01-01T00:00:00.000Z' }).at).toBe('2020-01-01T00:00:00.000Z');
  });

  it('carries its own spec, so an older map stays readable', () => {
    expect(deriveDataMap(input).spec).toBe(DATA_MAP_SPEC);
  });
});

describe('deriveDataMap: what it fills in', () => {
  it('turns memory scope words into a row', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'cadence', ownerName: 'alice', at: AT,
      scopes: ['memory:read', 'memory:write', 'memory:delete'],
    });
    const row = map.held.find(r => r.grant.area === 'memory');
    expect(row!.grant).toEqual({ area: 'memory', pattern: 'cadence.*', rights: ['read', 'write'] });
    expect(row!.deletion.effect).toBe('gone');
  });

  it('always says the write tally survives a delete, because it does', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'cadence', ownerName: 'alice', at: AT,
      scopes: ['memory:write', 'memory:delete'],
    });
    const row = map.held.find(r => r.grant.area === 'memory')!;
    expect(row.deletion.survives!.join(' ')).toMatch(/who wrote/i);
  });

  it('reads storage and knowledge words too', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'turbo', ownerName: 'alice', at: AT,
      scopes: ['storage:read', 'storage:write', 'knowledge:read'],
    });
    expect(map.held.map(r => r.grant.area).sort()).toEqual(['knowledge', 'storage']);
    expect(map.held.find(r => r.grant.area === 'storage')!.grant.pattern).toBe('turbo/*');
  });

  it('makes a workspace space the strongest row, and answers what happens to its versions', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'cadence', ownerName: 'alice', at: AT,
      scopes: ['organism:read', 'organism:write'],
      workspaceSpaces: [{ organismId: 'org-1', workspaceId: 'ws-abc', space: 'campaigns', schemaKey: 'campaigns' }],
    });
    const row = map.held.find(r => r.grant.area === 'organisms')!;
    expect(row.basis.tier).toBe('schema-locked');
    expect(row.ownership).toBe('organism');
    expect(row.deletion.survives!.join(' ')).toMatch(/version/i);
    expect(map.form).toBe('organism-workspace');
  });

  it('puts somebody ELSE\'s extension in the second table, with who to ask', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'cadence', ownerName: 'alice', at: AT,
      installedExtensions: [{ name: 'mine', ownerName: 'alice' }, { name: 'theirs', ownerName: 'bob' }],
    });
    expect(map.held.some(r => r.grant.pattern === 'ext:mine.*')).toBe(true);
    const foreign = map.elsewhere.find(r => r.grant.pattern === 'ext:theirs.*')!;
    expect(foreign.status).toBe('copy-of-anothers-record');
    expect(foreign.deletion.effect).toBe('not-ours-to-delete');
    expect(foreign.controller).toBe('bob');
  });
});

describe('deriveDataMap: what it refuses to invent', () => {
  it('leaves every why empty', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'cadence', ownerName: 'alice', at: AT,
      scopes: ['memory:write', 'storage:write', 'organism:write'],
      workspaceSpaces: [{ organismId: 'o', workspaceId: 'ws-x', space: 's' }],
    });
    expect(map.held.length).toBeGreaterThan(0);
    for (const row of map.held) expect(row.why).toBe('');
  });

  it('leaves personal data unstated rather than guessing no', () => {
    const map = deriveDataMap({ programKind: 'app', programId: 'x', ownerName: 'a', at: AT, scopes: ['memory:write'] });
    expect(map.held[0].personalData).toBe('unstated');
  });

  it('claims a retention only where something enforces one', () => {
    const map = deriveDataMap({ programKind: 'app', programId: 'x', ownerName: 'a', at: AT, scopes: ['memory:write'] });
    expect(map.held[0].retention.kind).toBe('until-deleted');
  });
});

describe('deriveDataMap: precedence', () => {
  const declaredDoc: DataMap = {
    spec: DATA_MAP_SPEC, form: 'group', source: 'declared', at: AT, elsewhere: [],
    held: [{
      grant: { area: 'memory', pattern: 'cadence.*', rights: ['read', 'write'] },
      basis: { tier: 'declared-space', by: 'app:cadence' },
      why: 'Campaigns belong to the customer, not to whoever sent them.',
      ownership: 'organism', readers: { visibility: 'workspace' },
      deletion: { effect: 'gone', says: 'It goes.' }, retention: { kind: 'until-deleted' },
      personalData: 'yes', source: 'declared',
    }],
  };

  it('a published document wins over anything the node would have guessed', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'cadence', ownerName: 'alice', at: AT,
      scopes: ['memory:read', 'memory:write'], declaredDoc,
    });
    const row = map.held.find(r => r.grant.pattern === 'cadence.*')!;
    expect(row.why).toContain('belong to the customer');
    expect(row.personalData).toBe('yes');
    expect(map.form).toBe('group');
  });

  it('a version that declares nothing inherits the last one, so a fork does not silently reset it', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'cadence', ownerName: 'alice', at: AT,
      scopes: ['memory:write'], previous: declaredDoc,
    });
    expect(map.held.find(r => r.grant.pattern === 'cadence.*')!.why).toContain('belong to the customer');
  });

  it('but a version that DOES declare is not topped up from the old one', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'cadence', ownerName: 'alice', at: AT,
      scopes: ['memory:write'], previous: declaredDoc,
      declaredMeta: { form: 'single-person', areas: [{ pattern: 'other.*', rights: ['write'], personalData: 'unstated', area: 'memory' }] },
    });
    expect(map.held.some(r => r.why.includes('belong to the customer'))).toBe(false);
    expect(map.form).toBe('single-person');
  });
});

describe('deriveDataMap: what it has actually been seen writing', () => {
  const trace = { writers: ['claude#alice@node'], writeCount: 300, keyCount: 41, firstAt: AT, lastAt: AT };

  it('attaches the trace to a row that already covers the family', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'uutiset', ownerName: 'alice', at: AT, scopes: ['memory:write'],
      observedFamilies: [{ family: 'uutiset.elokuu.*', tier: 'none', by: '', area: 'memory', trace }],
    });
    const row = map.held.find(r => r.grant.pattern === 'uutiset.*')!;
    expect(row.observed!.writeCount).toBe(300);
    expect(map.held).toHaveLength(1);
  });

  it('adds a row for a family no declaration covers — an undeclared area is a finding', () => {
    const map = deriveDataMap({
      programKind: 'app', programId: 'uutiset', ownerName: 'alice', at: AT, scopes: ['memory:write'],
      observedFamilies: [{ family: 'somewhere.else.*', tier: 'none', by: '', area: 'memory', trace }],
    });
    const row = map.held.find(r => r.grant.pattern === 'somewhere.else.*')!;
    expect(row.source).toBe('observed');
    expect(row.basis.tier).toBe('none');
  });
});

describe('deriveDataMap: the form it settles on', () => {
  it('single-person only when nothing reaches further', () => {
    expect(deriveDataMap({ programKind: 'app', programId: 'x', ownerName: 'a', at: AT, scopes: ['memory:write'] }).form)
      .toBe('single-person');
  });

  it('organism-workspace when it works in a workspace', () => {
    expect(deriveDataMap({
      programKind: 'app', programId: 'x', ownerName: 'a', at: AT, scopes: ['organism:write'],
      workspaceSpaces: [{ organismId: 'o', workspaceId: 'ws-x', space: 's' }],
    }).form).toBe('organism-workspace');
  });
});
