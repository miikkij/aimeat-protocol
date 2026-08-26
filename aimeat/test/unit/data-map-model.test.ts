/**
 * @file test/unit/data-map-model.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map's vocabulary: the two copies say the same thing, and the one check that
 *   pays for the whole feature actually fires.
 *
 *   THE CONTRADICTION TEST IS THE POINT. An app that says several people share it, whose every row
 *   lands in one person's own memory, is the defect this exists to catch — four separate bugs in one
 *   CRM that were all the same bug. If that assertion ever goes green by accident, the map is
 *   decoration.
 * @version-history
 *   v2.0.0 — 2026-08-25 — Rewritten for aimeat.datamap/2.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  labelKeyFor, orderRows, contradictionOf, placesOf, stateOf, VALUES, DATA_MAP_SPEC,
} from '../../public/components/data-map/model.js';

const ROOT = join(import.meta.dirname, '../..');

describe('the two copies of the model are the same file', () => {
  it('the catalogue copy is byte-identical to the shared one', () => {
    const shared = readFileSync(join(ROOT, 'public/components/data-map/model.js'));
    const copy = readFileSync(join(ROOT, 'src/static/app-catalog/js/data-map-model.js'));
    // Byte-identical, not "equivalent": the catalogue is a separate bundle with no import path back
    // here, so a copy that drifts is two vocabularies telling a reader different things.
    expect(copy.equals(shared)).toBe(true);
  });
});

describe('labelKeyFor', () => {
  it('maps a known value to its key', () => {
    expect(labelKeyFor('where', 'organism-workspace')).toBe('dataMap.where.organism-workspace');
  });
  it('returns null for a word this build does not know, so the raw word can be printed', () => {
    expect(labelKeyFor('where', 'somewhere-a-newer-node-invented')).toBeNull();
  });
  it('every axis value has a key', () => {
    for (const axis of Object.keys(VALUES)) {
      for (const value of VALUES[axis as keyof typeof VALUES]) {
        expect(labelKeyFor(axis, value)).toBe(`dataMap.${axis}.${value}`);
      }
    }
  });
});

/** The shape a real map has, trimmed to what these functions read. */
const row = (over: Record<string, unknown> = {}) => ({
  what: 'x.*', holds: 'things', kind: 'register', usedFor: 'shown-as-a-list',
  where: 'owner-memory-private', owner: 'person', readers: 'owner-only',
  writers: ['the-app-for-the-person'], shape: 'one-record', keptFor: 'until-deleted',
  lossRisk: 'only-copy', personalData: 'no', why: 'because.', ...over,
});
const map = (over: Record<string, unknown> = {}) => ({
  spec: 'aimeat.datamap/2', what: 'An app.', usedFor: 'Doing a thing.', form: 'one-person',
  arrangement: 'In your own memory.', machinery: [], leaves: [], held: [row()], elsewhere: [],
  source: 'declared', at: '2026-08-25T00:00:00.000Z', ...over,
});

describe('contradictionOf: the check the whole feature exists for', () => {
  it('catches a shared app whose every row is in one person own memory', () => {
    // This is CADENCE's original defect, in one assertion.
    expect(contradictionOf(map({ form: 'group' }))).toBe('dataMap.contradiction.sharedButPrivate');
  });

  it.each(['group', 'organism-workspace', 'shared-with-named'])(
    'fires for form %s', form => {
      expect(contradictionOf(map({ form }))).toBe('dataMap.contradiction.sharedButPrivate');
    });

  it('does not fire when a shared app really does write where the group can read', () => {
    const shared = map({ form: 'group', held: [row({ where: 'organism-workspace' })] });
    expect(contradictionOf(shared)).toBeNull();
  });

  it('does not fire when the only shared space is a ROW store', () => {
    // The row store is a separate `where` from the workspace it sits in, so a check that only knew
    // about 'organism-workspace' would accuse an app whose team data all lives in rows of keeping it
    // in one person's memory — which is the opposite of true.
    const shared = map({ form: 'group', held: [row({ where: 'organism-rows' })] });
    expect(contradictionOf(shared)).toBeNull();
  });

  it('catches a one-person app writing where more than one person reads', () => {
    const m = map({ form: 'one-person', held: [row({ where: 'organism-workspace' })] });
    expect(contradictionOf(m)).toBe('dataMap.contradiction.personalButShared');
  });

  it('catches a one-person app writing into a shared ROW store', () => {
    const m = map({ form: 'one-person', held: [row({ where: 'organism-rows' })] });
    expect(contradictionOf(m)).toBe('dataMap.contradiction.personalButShared');
  });

  it('catches a static page that lists things it stores', () => {
    expect(contradictionOf(map({ form: 'static' }))).toBe('dataMap.contradiction.staticButStores');
  });

  it('says nothing about a map with no rows', () => {
    expect(contradictionOf(map({ held: [] }))).toBeNull();
  });
});

describe('orderRows: what would cost the most comes first', () => {
  it('puts the only copy of something about a person above a replaceable cache', () => {
    const cache = row({ what: 'cache.*', lossRisk: 'may-vanish', personalData: 'no' });
    const people = row({ what: 'people.*', lossRisk: 'only-copy', personalData: 'yes' });
    expect(orderRows([cache, people])[0].what).toBe('people.*');
  });

  it('puts an unexplained row above an explained one of the same weight', () => {
    const explained = row({ what: 'a.*', why: 'because.' });
    const not = row({ what: 'b.*', why: '' });
    expect(orderRows([explained, not])[0].what).toBe('b.*');
  });
});

describe('placesOf', () => {
  it('counts rows per place, biggest first', () => {
    const m = map({ held: [
      row({ where: 'organism-workspace' }),
      row({ where: 'organism-workspace' }),
      row({ where: 'owner-memory-private' }),
    ] });
    expect(placesOf(m)).toEqual([
      { where: 'organism-workspace', n: 2 },
      { where: 'owner-memory-private', n: 1 },
    ]);
  });
});

describe('stateOf', () => {
  it('a map nobody wrote is missing, and that is never guessed away', () => {
    expect(stateOf(null)).toBe('missing');
    expect(stateOf(map({ source: 'none' }))).toBe('missing');
  });

  // Found on the production node: 110 apps still carried a stamp from the version that DERIVED a
  // map from permission words, and the list read those as written maps — the same lie, one layer up.
  it('a map from an older spec is missing, because that version guessed', () => {
    expect(stateOf(map({ spec: 'aimeat.datamap/1' }))).toBe('missing');
    expect(DATA_MAP_SPEC).toBe('aimeat.datamap/2');
  });
  it('a contradiction outranks an unfinished row', () => {
    expect(stateOf(map({ form: 'group', held: [row({ why: '' })] }))).toBe('contradicted');
  });
  it('a row with no why is unfinished', () => {
    expect(stateOf(map({ held: [row({ why: '' })] }))).toBe('unfinished');
  });
  it('a complete map is written', () => {
    expect(stateOf(map())).toBe('stated');
  });
});
