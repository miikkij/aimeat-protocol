/**
 * @file test/unit/adult-assurance.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The verified-adult record (services/adult-assurance.ts): which attested claims make an
 *   adult, that only a positive answer is written, that nothing personal is kept, and that the memory
 *   routes cannot write it (it is a service-owned key).
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-3, A-4).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { ADULT_KEY, birthdateFromHetu, isAdultByClaims, readAdult, recordAdult } from '../../src/services/adult-assurance.js';
import { isServerWrittenKey, isServiceOwnedKey } from '../../src/utils/reserved-keys.js';

const ALICE = 'alice@node';
const NOW = new Date('2026-10-18T12:00:00Z');
let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

describe('isAdultByClaims', () => {
  it('counts whole years: 18 on the birthday is an adult, the day before is not', () => {
    expect(isAdultByClaims({ birthdate: '2008-10-18' }, NOW)).toBe(true);
    expect(isAdultByClaims({ birthdate: '2008-10-19' }, NOW)).toBe(false);
    expect(isAdultByClaims({ birthdate: '1970-01-01' }, NOW)).toBe(true);
  });
  it('takes the issuer\'s own age_over_18 before any date', () => {
    expect(isAdultByClaims({ age_over_18: true }, NOW)).toBe(true);
    expect(isAdultByClaims({ age_over_18: false, birthdate: '1970-01-01' }, NOW)).toBe(false);
  });
  it('reads the birth date from a Finnish identity code when the bank sent no birthdate', () => {
    expect(isAdultByClaims({ pid: '010170-123F' }, NOW)).toBe(true);
    expect(isAdultByClaims({ pid: '191010A123B' }, NOW)).toBe(false);
  });
  it('is false with nothing to read, which records nothing', () => {
    expect(isAdultByClaims(undefined, NOW)).toBe(false);
    expect(isAdultByClaims({ given_name: 'Alice' }, NOW)).toBe(false);
    expect(isAdultByClaims({ birthdate: 'not a date' }, NOW)).toBe(false);
  });
});

describe('birthdateFromHetu', () => {
  it('reads the century from the sign', () => {
    expect(birthdateFromHetu('131052-308T')).toBe('1952-10-13');
    expect(birthdateFromHetu('010105A1230')).toBe('2005-01-01');
    expect(birthdateFromHetu('010199Y1230')).toBe('1999-01-01');
    expect(birthdateFromHetu('010150+1230')).toBe('1850-01-01');
  });
  it('is null for anything that is not a code', () => {
    expect(birthdateFromHetu('alice')).toBeNull();
    expect(birthdateFromHetu(12345)).toBeNull();
  });
});

describe('recordAdult and readAdult', () => {
  it('answers not verified when nothing was recorded', async () => {
    expect(await readAdult(storage, ALICE)).toEqual({ verified: false, method: null, at: null });
  });
  it('answers yes, the method and the time, and keeps nothing personal', async () => {
    await recordAdult(storage, ALICE, 'ftn');
    const status = await readAdult(storage, ALICE);
    expect(status.verified).toBe(true);
    expect(status.method).toBe('ftn');
    expect(typeof status.at).toBe('string');
    const stored = await storage.getMemory(ALICE, ADULT_KEY);
    expect(stored?.visibility).toBe('private');
    expect(Object.keys(stored?.value as object).sort()).toEqual(['adult', 'method', 'methods', 'verifiedAt']);
  });
  it('a later card payment keeps the earlier method in methods and answers the latest', async () => {
    await recordAdult(storage, ALICE, 'ftn');
    await recordAdult(storage, ALICE, 'credit-card');
    expect((await readAdult(storage, ALICE)).method).toBe('credit-card');
    const v = (await storage.getMemory(ALICE, ADULT_KEY))?.value as { methods: Record<string, string> };
    expect(Object.keys(v.methods).sort()).toEqual(['credit-card', 'ftn']);
  });
  it('a record written in another shape is not taken as an adult', async () => {
    await storage.setMemory({ key: ADULT_KEY, ownerGaii: ALICE, value: { adult: 'yes' }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect((await readAdult(storage, ALICE)).verified).toBe(false);
  });
});

describe('the key', () => {
  it('is service-owned, so no memory route writes it for anyone', () => {
    expect(isServiceOwnedKey(ADULT_KEY)).toBe(true);
    expect(isServerWrittenKey(ADULT_KEY)).toBe(true);
  });
});
