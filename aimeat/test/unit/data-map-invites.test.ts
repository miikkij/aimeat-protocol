/**
 * @file test/unit/data-map-invites.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app that declares organism:invite may invite people into organisms, and an
 *   invitation can create a new account. That is allowed, and the app's data map says it: the
 *   machinery word `invites-people` or the app-level `invites` statement. An app that declares the
 *   scope and states neither gets the finding DATAMAP_INVITES_UNSTATED. A finding, never a refusal,
 *   and nothing about who may invite changes (Jouni, 2026-10-18).
 * @version-history
 *   v1.0.1 — 2026-10-28 — The roster row states `domains: []`, so the personal-row domain finding
 *     stays out of a test about invitations.
 *   v1.0.0 — 2026-10-18 — wish-datakarttaan-ja-agentin-kuvaukseen-tieto-kutsuista-ja-tilien.
 */
import { describe, it, expect } from 'vitest';
import { checkMap, stampFor, statesInvites, FINDING_CODES } from '../../src/services/data-map/data-map-check.js';
import { DATA_MAP_SPEC, type DataMap } from '../../src/services/data-map/data-map-types.js';

const AT = '2026-10-18T00:00:00.000Z';

const map = (over: Partial<DataMap> = {}): DataMap => ({
  spec: DATA_MAP_SPEC, what: 'A team roster.', usedFor: 'Bringing new people into the team.', form: 'group',
  arrangement: 'One workspace in the team organism.', machinery: [], leaves: [],
  held: [{
    what: 'roster.*', holds: 'the people', kind: 'register', usedFor: 'to-share-with-others',
    where: 'organism-workspace', owner: 'organism', readers: 'organism-members',
    writers: ['person-in-the-ui'], shape: 'one-record', keptFor: 'until-deleted',
    lossRisk: 'only-copy', personalData: 'yes', domains: [], why: 'The roster belongs to the team.',
  }],
  elsewhere: [], source: 'declared', at: AT, ...over,
});

const codes = (m: DataMap | null, scopes: string[]): string[] => checkMap(m, AT, scopes).findings.map(f => f.code);

describe('an app that invites people says so in its data map', () => {
  it('the spec version is unchanged, because the statement is optional', () => {
    expect(DATA_MAP_SPEC).toBe('aimeat.datamap/2');
    expect(FINDING_CODES).toContain('DATAMAP_INVITES_UNSTATED');
  });

  it('an app with organism:invite and no statement gets the finding', () => {
    const found = checkMap(map(), AT, ['memory:read', 'organism:invite']).findings
      .find(f => f.code === 'DATAMAP_INVITES_UNSTATED');
    expect(found).toBeDefined();
    expect(found!.message).toContain('organism:invite');
    expect(found!.message).toContain('invites-people');
  });

  it('the machinery word is a statement', () => {
    expect(codes(map({ machinery: ['invites-people'] }), ['organism:invite'])).toEqual([]);
  });

  it('the app-level statement is a statement', () => {
    const m = map({ invites: { does: ['sends-email-invitations', 'creates-accounts'], into: 'the team organism' } });
    expect(statesInvites(m)).toBe(true);
    expect(codes(m, ['organism:invite'])).toEqual([]);
  });

  it('an empty statement is not one', () => {
    expect(statesInvites(map({ invites: { does: [], into: '' } }))).toBe(false);
    expect(codes(map({ invites: { does: [], into: '' } }), ['organism:invite'])).toContain('DATAMAP_INVITES_UNSTATED');
  });

  it('a wildcard grant covers the word, the same way requireScope reads it', () => {
    expect(codes(map(), ['organism:*'])).toContain('DATAMAP_INVITES_UNSTATED');
    expect(codes(map(), ['*'])).toContain('DATAMAP_INVITES_UNSTATED');
  });

  it('an app without the scope needs no statement', () => {
    expect(codes(map(), ['memory:read', 'organism:read'])).toEqual([]);
    expect(codes(map(), [])).toEqual([]);
  });

  it('an app with no map at all and the scope gets both findings, the missing map first', () => {
    expect(codes(null, ['organism:invite'])).toEqual(['DATAMAP_MISSING', 'DATAMAP_INVITES_UNSTATED']);
    expect(codes(null, [])).toEqual(['DATAMAP_MISSING']);
  });

  it('the stamp carries the finding when it is the worst one', () => {
    const stamp = stampFor(map(), 'roster', AT, ['organism:invite']);
    expect(stamp.gap?.code).toBe('DATAMAP_INVITES_UNSTATED');
    expect(stampFor(map({ machinery: ['invites-people'] }), 'roster', AT, ['organism:invite']).gap).toBeUndefined();
  });

  it('a missing why stays the worse finding', () => {
    const m = map();
    m.held[0].why = '';
    const check = checkMap(m, AT, ['organism:invite']);
    expect(check.findings.map(f => f.code)).toEqual(['DATAMAP_ROW_NO_WHY', 'DATAMAP_INVITES_UNSTATED']);
    expect(check.gap?.code).toBe('DATAMAP_ROW_NO_WHY');
  });
});
