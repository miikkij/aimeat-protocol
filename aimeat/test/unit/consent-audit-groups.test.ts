/**
 * @file test/unit/consent-audit-groups.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The audit trail grouped the way a person reads it. The fixture is the shape aimeat.io
 *   had on 2026-09-04: one member's app asking three workspaces' manifests over and over, an anonymous
 *   visitor probing one hidden key, and a grant row; the groups must say who × what × how many, list
 *   the distinct keys newest first, and never merge an allowed row with a denied one.
 * @version-history
 *   v1.1.0 — 2026-11-09 — The day buckets: the split at the reader's midnights, the grant rows left
 *     out, at most five accessors named, an empty bucket.
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { groupConsentAudit, targetOf, organismIdsIn, bucketConsentAudit, auditWithin } from '../../src/services/consent-audit-groups.js';

const ORG = 'd0d999ef-712b-408b-91e9-e074cfac3bae';
const row = (accessorGaii: string, memoryKey: string, timestamp: string, allowed = false, action = 'read') => ({ accessorGaii, memoryKey, timestamp, allowed, action });

describe('targetOf', () => {
  it('reads a workspace key, an organism key and a plain key', () => {
    expect(targetOf(`organism.${ORG}.w.ws-mrpvrnw8ma8.meta.manifest`)).toEqual({ kind: 'ws', organism_id: ORG, workspace_id: 'ws-mrpvrnw8ma8', rest: 'meta.manifest' });
    expect(targetOf(`organism.${ORG}.meta.workspaces`)).toEqual({ kind: 'org', organism_id: ORG, rest: 'meta.workspaces' });
    expect(targetOf('newspaper.admin.hidden')).toEqual({ kind: 'key', key: 'newspaper.admin.hidden' });
  });
});

describe('groupConsentAudit', () => {
  const rows = [
    row('kkk@node', `organism.${ORG}.w.ws-a.meta.manifest`, '2026-08-01T10:00:00.000Z'),
    row('kkk@node', `organism.${ORG}.w.ws-b.meta.manifest`, '2026-08-02T10:00:00.000Z'),
    row('kkk@node', `organism.${ORG}.w.ws-a.meta.manifest`, '2026-08-30T10:00:00.000Z'),
    row('kkk@node', `organism.${ORG}.w.ws-c.meta.manifest`, '2026-07-20T10:00:00.000Z'),
    row('anonymous', 'newspaper.admin.hidden', '2026-09-03T10:46:37.903Z'),
    row('anonymous', 'newspaper.admin.hidden', '2026-09-02T14:07:14.020Z'),
    row('ghii:me@node', 'probe.dw.**', '2026-08-25T05:30:53.911Z', true, 'grant'),
  ];

  it('groups by who × what family × outcome, biggest first, with first/last and the distinct keys newest first', () => {
    const groups = groupConsentAudit(rows);
    expect(groups.map(g => g.count)).toEqual([4, 2, 1]);
    const manifests = groups[0];
    expect(manifests.accessor_gaii).toBe('kkk@node');
    expect(manifests.target).toEqual({ kind: 'ws', organism_id: ORG, rest: 'meta.manifest' });
    expect(manifests.allowed).toBe(false);
    expect(manifests.first).toBe('2026-07-20T10:00:00.000Z');
    expect(manifests.last).toBe('2026-08-30T10:00:00.000Z');
    expect(manifests.key_count).toBe(3);
    expect(manifests.keys).toEqual([`organism.${ORG}.w.ws-a.meta.manifest`, `organism.${ORG}.w.ws-b.meta.manifest`, `organism.${ORG}.w.ws-c.meta.manifest`]);
    expect(groups[1].target).toEqual({ kind: 'key', key: 'newspaper.admin.hidden' });
    expect(groups[2]).toMatchObject({ action: 'grant', allowed: true, count: 1 });
  });

  it('keeps an allowed row apart from a denied one on the same key', () => {
    const groups = groupConsentAudit([row('a@node', 'k.1', '2026-08-01T00:00:00.000Z', true), row('a@node', 'k.1', '2026-08-01T00:00:00.000Z', false)]);
    expect(groups).toHaveLength(2);
  });

  it('an empty trail is an empty list', () => {
    expect(groupConsentAudit([])).toEqual([]);
  });
});

describe('bucketConsentAudit', () => {
  const TODAY = '2026-11-08T22:00:00.000Z';
  const YESTERDAY = '2026-11-07T22:00:00.000Z';
  const trail = [
    row('a@node', 'k.1', TODAY),
    row('a@node', 'k.1', '2026-11-09T08:00:00.000Z', true),
    row('b@node', 'k.2', '2026-11-08T21:59:59.999Z'),
    row('b@node', 'k.2', YESTERDAY),
    row('c@node', 'k.3', '2026-11-07T21:59:59.999Z'),
    row('c@node', 'k.3', '2026-11-01T10:00:00.000Z'),
    row('owner@node', 'k.4', '2026-11-09T09:00:00.000Z', true, 'grant'),
  ];

  it('splits at the given midnights: a row on a boundary belongs to the later day', () => {
    const [today, yesterday, earlier] = bucketConsentAudit(trail, TODAY, YESTERDAY);
    expect([today.id, yesterday.id, earlier.id]).toEqual(['today', 'yesterday', 'earlier']);
    expect([today.count, yesterday.count, earlier.count]).toEqual([2, 2, 2]);
    expect(today.who).toEqual([{ accessor_gaii: 'a@node', count: 2, denied: 1 }]);
    expect(yesterday.who).toEqual([{ accessor_gaii: 'b@node', count: 2, denied: 2 }]);
    expect(earlier.day_count).toBe(2);
    expect([today.from, today.to, earlier.from, earlier.to]).toEqual([TODAY, null, null, YESTERDAY]);
  });

  it('leaves the grant and revoke rows out, as the page does', () => {
    const [today] = bucketConsentAudit(trail, TODAY, YESTERDAY);
    expect(today.who.some((w) => w.accessor_gaii === 'owner@node')).toBe(false);
    expect(today.group_count).toBe(groupConsentAudit(auditWithin(trail, TODAY, null).filter((e) => e.action !== 'grant')).length);
  });

  it('names at most five accessors and counts all of them', () => {
    const many = Array.from({ length: 8 }, (_, i) => row(`p${i}@node`, 'k', '2026-11-09T01:00:00.000Z'));
    const [today] = bucketConsentAudit(many, TODAY, YESTERDAY);
    expect(today.who).toHaveLength(5);
    expect(today.accessor_total).toBe(8);
    expect(today.denied).toBe(8);
  });

  it('an empty bucket has no first, no last and nobody', () => {
    const [, , earlier] = bucketConsentAudit([row('a@node', 'k', '2026-11-09T01:00:00.000Z')], TODAY, YESTERDAY);
    expect(earlier).toMatchObject({ count: 0, denied: 0, first: null, last: null, day_count: 0, group_count: 0, who: [], accessor_total: 0 });
  });
});

describe('organismIdsIn', () => {
  it('collects every organism id a pattern, a recipient or a key points at, once', () => {
    const other = '1e3bb9cd-3d72-40c7-a2e9-68e761dd9ec6';
    expect(organismIdsIn([`organism.${ORG}.w.ws-x.**`, `organism.${other}`, 'portfolio/contact*'], [`organism.${ORG}.w.ws-y.meta.manifest`])).toEqual([ORG, other]);
  });
});
