/**
 * @file compliance-app-reach.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who can see an app's personal data, read from its data map (services/compliance-app-
 *   reach.ts): the four groups Jouni ruled on 2026-10-29, the widest row deciding the app, the other
 *   spellings measured on aimeat.io's 152 maps, an unsaid row that matters only when others can read
 *   it, and a word the node does not know, which is never guessed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-app-reach.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { appReach } from '../../src/services/compliance-app-reach.js';
import type { DataMap, DataMapRow } from '../../src/services/data-map/data-map-types.js';

const row = (what: string, where: string, readers: string, personalData: unknown = 'yes'): DataMapRow => ({
  what, holds: what, kind: 'user-written', usedFor: 'user-returns-to-read', where, owner: 'person', readers,
  writers: ['the-app-for-the-person'], shape: 'one-record', keptFor: 'until-deleted', lossRisk: 'only-copy',
  personalData, why: '',
} as unknown as DataMapRow);

const map = (...held: DataMapRow[]): DataMap => ({
  spec: 'aimeat.datamap/2', what: 'an app', usedFor: 'things', form: 'one-person', arrangement: '',
  machinery: [], leaves: [], held, elsewhere: [], source: 'declared',
} as unknown as DataMap);

describe('appReach', () => {
  it('reads an app whose personal data sits only in its user\'s own memory as self', () => {
    const r = appReach(map(row('notes.v1', 'owner-memory-private', 'owner-and-their-agents')));
    expect(r.reach).toBe('self');
    expect(r.personal).toBe(true);
  });

  it('reads an app with no personal row, or only browser data, as none', () => {
    expect(appReach(map(row('prefs', 'owner-memory-private', 'owner-only', 'no'))).reach).toBe('none');
    expect(appReach(map(row('save', 'browser-only', 'the-app-itself'))).reach).toBe('none');
  });

  it('takes the widest row: a public leaderboard beside a private save is exposed', () => {
    const r = appReach(map(
      row('game.save', 'owner-memory-private', 'owner-only'),
      row('game.leaderboard', 'owner-memory-public', 'anyone'),
    ));
    expect(r.reach).toBe('exposed');
    expect(r.rows.map(x => x.what)).toContain('game.leaderboard');
  });

  it('reads an organism workspace or named readers as shared', () => {
    expect(appReach(map(row('crm.leads', 'organism-workspace', 'organism-members'))).reach).toBe('shared');
    expect(appReach(map(row('files', 'file-storage', 'named-people'))).reach).toBe('shared');
  });

  it('reads the other spellings aimeat.io\'s maps use as the words they spell', () => {
    expect(appReach(map(row('tetris3d.crew', 'own-memory', 'anyone'))).reach).toBe('exposed');
    expect(appReach(map(row('diary', 'own-memory', 'only-me'))).reach).toBe('self');
    expect(appReach(map(row('local', 'browser-local', 'owner-only'))).reach).toBe('none');
  });

  it('asks nothing of an unsaid row only its owner sees, and names one others can read', () => {
    const own = appReach(map(row('cache', 'owner-memory-private', 'owner-only', 'maybe')));
    expect(own.reach).toBe('none');
    expect(own.personalUnstated).toEqual([]);
    const shared = appReach(map(row('team.notes', 'organism-workspace', 'organism-members', 'unstated')));
    expect(shared.reach).toBe('shared');
    expect(shared.personalUnstated).toEqual(['team.notes']);
  });

  it('never guesses a word it does not know: the row is unreadable and the app unknown', () => {
    const r = appReach(map(
      row('notes', 'owner-memory-private', 'owner-only'),
      row('campaign', 'ext:mainokset / queue', 'campaign owners, the DPO, sellers of the campaign'),
    ));
    expect(r.reach).toBe('unknown');
    expect(r.unreadable).toEqual([{ what: 'campaign', where: 'ext:mainokset / queue', readers: 'campaign owners, the DPO, sellers of the campaign' }]);
  });

  it('reads no map as unknown, with nothing to say', () => {
    const r = appReach(null);
    expect(r).toMatchObject({ reach: 'unknown', hasMap: false, personal: false, rows: [], unreadable: [] });
  });
});
