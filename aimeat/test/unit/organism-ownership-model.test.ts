/**
 * @file organism-ownership-model.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic behind the admin Organism ownership page, held to the numbers the
 *   page prints. The one that matters is "stuck": an organism whose every owner is deactivated or
 *   has no account on this node. A fold that got this wrong would either send an operator into a
 *   cross-account repair nobody needed, or answer "nothing is stuck" about the organism nobody
 *   inside can reach, which is the exact failure this page exists to prevent.
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-ownership-model.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Organism ownership page in the poster face).
 */
import { describe, it, expect } from 'vitest';
import {
  decorate, summarise, counts, search, candidates, FILTERS, PAGE,
} from '../../public/views/admin/organism-ownership-tab.model.js';

const OWNERS = [
  { name: 'jouni', roles: ['owner', 'operator'], agents: [], created_at: '2026-03-13T00:00:00.000Z', disabled_at: null },
  { name: 'kanderss', roles: ['owner'], agents: [], created_at: '2026-04-30T00:00:00.000Z', disabled_at: null },
  { name: 'zenmaisteri', roles: ['owner'], agents: [], created_at: '2026-05-04T00:00:00.000Z', disabled_at: null },
  { name: 't25', roles: ['owner'], agents: [], created_at: '2026-04-28T00:00:00.000Z', disabled_at: '2026-08-02T00:00:00.000Z' },
  { name: 'happy2', roles: ['owner'], agents: [], created_at: '2026-03-14T00:00:00.000Z', disabled_at: null },
];

const ORGANISMS = [
  { id: 'org-alive', name: 'Experience Center', owners: ['jouni'], created_by: 'jouni', members: 2, created_at: '2026-07-17T00:00:00.000Z', archived_at: null },
  { id: 'org-stuck', name: 'Lakisivudemo', owners: ['t25'], created_by: 't25', members: 3, created_at: '2026-08-29T00:00:00.000Z', archived_at: null },
  { id: 'org-half', name: 'HeroPlay', owners: ['t25', 'kanderss'], created_by: 't25', members: 4, created_at: '2026-06-16T00:00:00.000Z', archived_at: null },
  { id: 'org-gone', name: 'Vanha projekti', owners: ['someone-who-left'], created_by: 'someone-who-left', members: 1, created_at: '2026-05-01T00:00:00.000Z', archived_at: null },
  { id: 'org-old', name: 'Arkistoitu', owners: ['jouni'], created_by: 'jouni', members: 1, created_at: '2026-02-01T00:00:00.000Z', archived_at: '2026-08-20T00:00:00.000Z' },
];

describe('which organisms nobody inside can repair', () => {
  const rows = decorate(ORGANISMS, OWNERS);
  const row = (id: string) => rows.find(r => r.id === id)!;

  it('calls an organism stuck when its only owner is deactivated', () => {
    expect(row('org-stuck')).toMatchObject({ stuck: true, reachable: 0 });
    expect(row('org-stuck').ownerStates).toEqual([{ name: 't25', state: 'off' }]);
  });

  it('calls one stuck when its owner has no account on this node at all', () => {
    expect(row('org-gone')).toMatchObject({ stuck: true, reachable: 0 });
    expect(row('org-gone').ownerStates).toEqual([{ name: 'someone-who-left', state: 'gone' }]);
  });

  it('does NOT call one stuck when a single reachable owner is left beside a dead one', () => {
    expect(row('org-half')).toMatchObject({ stuck: false, reachable: 1 });
    expect(row('org-half').ownerStates.map(o => o.state)).toEqual(['off', 'ok']);
  });

  it('reads an organism with no owners at all as stuck, not as fine', () => {
    expect(decorate([{ id: 'x', name: 'Orpo', owners: [], members: 0 }], OWNERS)[0].stuck).toBe(true);
  });

  it('puts the stuck ones first, then the newest registration', () => {
    expect(rows.map(r => r.id)).toEqual(['org-stuck', 'org-gone', 'org-alive', 'org-half', 'org-old']);
  });

  it('survives a list served without the optional fields', () => {
    expect(decorate([{ id: 'bare', name: 'Bare', owners: ['jouni'] }], OWNERS)[0])
      .toMatchObject({ members: 0, archivedAt: null, createdBy: null, stuck: false });
    expect(decorate(undefined, undefined)).toEqual([]);
  });
});

describe('the figures and the filters', () => {
  const rows = decorate(ORGANISMS, OWNERS);

  it('counts what the strip prints', () => {
    const s = summarise(rows);
    expect(s).toMatchObject({ total: 5, stuck: 2, seats: 6, single: 2, archived: 1 });
    expect(s.stuckRows.map(r => r.id)).toEqual(['org-stuck', 'org-gone']);
  });

  it('counts "held by one" as the ones a single deactivation away, not the ones already there', () => {
    // org-stuck and org-gone also have exactly one owner; counting them here would make the figure
    // disagree with the words under it, which say one account away from stuck.
    expect(summarise(rows).single).toBe(2);
    expect(search(rows, 'single', '').map(r => r.id)).toEqual(['org-alive', 'org-old']);
  });

  it('counts every chip in the order the page draws them', () => {
    expect(counts(rows)).toEqual({ all: 5, stuck: 2, single: 2, archived: 1 });
    expect(FILTERS).toEqual(['all', 'stuck', 'single', 'archived']);
    expect(PAGE).toBe(20);
  });

  it('leaves the rows each chip names', () => {
    expect(search(rows, 'stuck', '').map(r => r.id)).toEqual(['org-stuck', 'org-gone']);
    expect(search(rows, 'archived', '').map(r => r.id)).toEqual(['org-old']);
    expect(search(rows, 'all', '').length).toBe(5);
  });

  it('finds an organism by its name, by its id, and by the name of anybody holding it', () => {
    expect(search(rows, 'all', 'laki').map(r => r.id)).toEqual(['org-stuck']);
    expect(search(rows, 'all', 'org-half').map(r => r.id)).toEqual(['org-half']);
    expect(search(rows, 'all', 'kanderss').map(r => r.id)).toEqual(['org-half']);
    expect(search(rows, 'all', 'nobody')).toEqual([]);
  });
});

describe('who may be offered the organism', () => {
  const ownership = {
    owners: ['t25'],
    members: [
      { ghii: 't25', role: 'creator', status: 'active' },
      { ghii: 'kanderss', role: 'admin', status: 'active' },
      { ghii: 'happy2', role: 'member', status: 'banned' },
    ],
  };
  const list = candidates(OWNERS, ownership);
  const c = (name: string) => list.find(x => x.name === name)!;

  it('says why each name cannot take it, so nothing has to be pressed to be refused', () => {
    expect(c('t25')).toMatchObject({ state: 'already' });
    expect(c('happy2')).toMatchObject({ state: 'blocked' });
    expect(c('kanderss')).toMatchObject({ state: 'ok', member: true });
    expect(c('zenmaisteri')).toMatchObject({ state: 'ok', member: false });
  });

  it('refuses a deactivated account by arithmetic, because handing it over repairs nothing', () => {
    const off = candidates([{ name: 'gone', disabled_at: '2026-08-02T00:00:00.000Z' }], ownership);
    expect(off[0].state).toBe('off');
  });

  it('offers the ones who can act first, and inside those the people already in the organism', () => {
    expect(list.map(x => x.name)).toEqual(['kanderss', 'jouni', 'zenmaisteri', 'happy2', 't25']);
  });

  it('is empty rather than throwing when nothing has been read yet', () => {
    expect(candidates(undefined, null)).toEqual([]);
    expect(candidates(OWNERS, null).every(x => x.state !== 'already')).toBe(true);
  });
});
