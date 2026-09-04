/**
 * @file test/unit/consent-audit-groups.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The audit trail grouped the way a person reads it. The fixture is the shape aimeat.io
 *   had on 2026-09-04: one member's app asking three workspaces' manifests over and over, an anonymous
 *   visitor probing one hidden key, and a grant row; the groups must say who × what × how many, list
 *   the distinct keys newest first, and never merge an allowed row with a denied one.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { groupConsentAudit, targetOf, organismIdsIn } from '../../src/services/consent-audit-groups.js';

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

describe('organismIdsIn', () => {
  it('collects every organism id a pattern, a recipient or a key points at, once', () => {
    const other = '1e3bb9cd-3d72-40c7-a2e9-68e761dd9ec6';
    expect(organismIdsIn([`organism.${ORG}.w.ws-x.**`, `organism.${other}`, 'portfolio/contact*'], [`organism.${ORG}.w.ws-y.meta.manifest`])).toEqual([ORG, other]);
  });
});
