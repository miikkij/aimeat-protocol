/**
 * @file consent.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unit tests for the consent pattern matcher and the read decision (checkConsentForRead),
 *   including the Federation switch of a knowledge package: a consent to everyone opens no entry
 *   that is not public, and the public entries stay eligible to travel to peers.
 * @version-history
 *   2026-11-08 — The Federation switch of a knowledge package (guide audit 2026-11-08, k1-federation).
 */
import { describe, it, expect } from 'vitest';
import { consentMatchPattern } from '../../src/storage/pattern-utils.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { checkConsentForRead } from '../../src/services/consent.js';
import { isEligibleForReplication } from '../../src/services/memory-replication.js';

describe('consentMatchPattern', () => {
  it('matches exact keys', () => {
    expect(consentMatchPattern('profile.alice.interests', 'profile.alice.interests')).toBe(true);
    expect(consentMatchPattern('profile.alice.interests', 'profile.bob.interests')).toBe(false);
  });

  it('matches single-segment wildcard *', () => {
    expect(consentMatchPattern('profile.*.interests', 'profile.alice.interests')).toBe(true);
    expect(consentMatchPattern('profile.*.interests', 'profile.bob.interests')).toBe(true);
    expect(consentMatchPattern('profile.*', 'profile.alice')).toBe(true);
    expect(consentMatchPattern('profile.*', 'profile.alice.interests')).toBe(false);
  });

  it('matches multi-segment wildcard **', () => {
    expect(consentMatchPattern('iot.**', 'iot.temp.bedroom')).toBe(true);
    expect(consentMatchPattern('iot.**', 'iot.humidity')).toBe(true);
    expect(consentMatchPattern('iot.**', 'other.data')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(consentMatchPattern('*', 'anything')).toBe(true);
    expect(consentMatchPattern('a.b.c', 'a.b.c')).toBe(true);
    expect(consentMatchPattern('a.b.c', 'a.b.d')).toBe(false);
  });
});

// G13: consentMatchPattern is slash-aware — '.' AND '/' are literal structural
// separators (never interchangeable); '*' is one segment that spans neither.
describe('consentMatchPattern — slash-aware (G13)', () => {
  it('matches slash-keyed wildcard grants (the previously-broken case)', () => {
    expect(consentMatchPattern('packages/abc-123/*', 'packages/abc-123/manifest')).toBe(true);
    expect(consentMatchPattern('storage:images/*', 'storage:images/photo')).toBe(true);
  });

  it('** spans separators (slashes and dots), * does not', () => {
    expect(consentMatchPattern('packages/abc/**', 'packages/abc/a/b.png')).toBe(true);
    expect(consentMatchPattern('storage:images/**', 'storage:images/a.png')).toBe(true);
    // single * is one segment: a dotted filename under a path needs ** (not *)
    expect(consentMatchPattern('storage:images/*', 'storage:images/a.png')).toBe(false);
    // * never spans a slash
    expect(consentMatchPattern('packages/abc/*', 'packages/abc/a/b')).toBe(false);
  });

  it('UNCHANGED for dot-keyed patterns (byte-identical to the prior matcher)', () => {
    expect(consentMatchPattern('a.*', 'a.b')).toBe(true);
    expect(consentMatchPattern('a.*', 'a.b.c')).toBe(false);
    expect(consentMatchPattern('a.**', 'a.b.c')).toBe(true);
    expect(consentMatchPattern('i18n.fi', 'i18n.fi')).toBe(true);
  });

  it('NON-WIDENING: dot and slash are not interchangeable, * cannot span /', () => {
    expect(consentMatchPattern('a.*', 'a/b')).toBe(false);   // dot pattern must not match slash key
    expect(consentMatchPattern('a/*', 'a.b')).toBe(false);   // slash pattern must not match dot key
    expect(consentMatchPattern('a.*', 'a.b/c')).toBe(false); // * no longer spans '/'
    expect(consentMatchPattern('a.b.c', 'a/b/c')).toBe(false);
  });

  it('escapes regex specials in literal tokens', () => {
    expect(consentMatchPattern('a.b+c', 'a.b+c')).toBe(true);
    expect(consentMatchPattern('a.b+c', 'a.bXc')).toBe(false);
  });
});

describe('checkConsentForRead', () => {
  it('allows public data without consent', async () => {
    const storage = new SqliteStorage(':memory:');
    const result = await checkConsentForRead(storage, 'key', 'owner#app@node', 'reader#app@node', 'public');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('public_data');
  });

  it('allows owner to read own data', async () => {
    const storage = new SqliteStorage(':memory:');
    const result = await checkConsentForRead(storage, 'key', 'alice#app@node', 'alice#app@node', 'private');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('owner_access');
  });

  it('denies private data without consent', async () => {
    const storage = new SqliteStorage(':memory:');
    const result = await checkConsentForRead(storage, 'key', 'alice#app@node', 'bob#app@node', 'private');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_matching_consent');
  });

  it('allows with matching consent', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createConsent({
      id: 'c1', ownerGaii: 'agent1#alice@node', dataPattern: 'profile.*',
      recipient: '*', purpose: 'test', scope: 'federation',
      expires: null, status: 'active', grantedAt: new Date().toISOString(), revokedAt: null,
    });
    const result = await checkConsentForRead(storage, 'profile.bio', 'agent1#alice@node', 'agent2#bob@node', 'owner');
    expect(result.allowed).toBe(true);
    expect(result.consentId).toBe('c1');
  });

  it('denies with expired consent', async () => {
    const storage = new SqliteStorage(':memory:');
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    await storage.createConsent({
      id: 'c2', ownerGaii: 'agent1#alice@node', dataPattern: 'profile.*',
      recipient: '*', purpose: 'test', scope: 'federation',
      expires: pastDate, status: 'active', grantedAt: new Date().toISOString(), revokedAt: null,
    });
    const result = await checkConsentForRead(storage, 'profile.bio', 'agent1#alice@node', 'agent2#bob@node', 'owner');
    expect(result.allowed).toBe(false);
  });

  it('denies with wrong recipient', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createConsent({
      id: 'c3', ownerGaii: 'agent1#alice@node', dataPattern: 'profile.*',
      recipient: 'agent3#charlie@node', purpose: 'test', scope: 'federation',
      expires: null, status: 'active', grantedAt: new Date().toISOString(), revokedAt: null,
    });
    const result = await checkConsentForRead(storage, 'profile.bio', 'agent1#alice@node', 'agent2#bob@node', 'owner');
    expect(result.allowed).toBe(false);
  });
});

// The knowledge package page's Federation switch grants packages/<id>/* to '*' with the reach
// federation (public/views/profile/knowledge-tab.js). Its job is to send the public entries to peers
// and list the owner in the directory; it opened every private entry to every reader (k1-federation).
describe('checkConsentForRead — the Federation switch of a knowledge package', () => {
  const OWNER = 'alice@node';
  const PKG = 'packages/pkg-1';
  const now = new Date().toISOString();
  async function switchedOn(): Promise<SqliteStorage> {
    const storage = new SqliteStorage(':memory:');
    await storage.createConsent({
      id: 'fed1', ownerGaii: OWNER, dataPattern: `${PKG}/*`, recipient: '*', purpose: 'knowledge_sharing',
      scope: 'federation', expires: null, status: 'active', grantedAt: now, revokedAt: null,
    });
    return storage;
  }

  it('an unrelated signed-in account, a visitor from another node and the anonymous reader cannot read a private entry', async () => {
    const storage = await switchedOn();
    for (const reader of ['bob@node', 'agent2#bob@node', 'carol@other-node', 'anonymous']) {
      const r = await checkConsentForRead(storage, `${PKG}/private-notes`, OWNER, reader, 'private');
      expect(r, reader).toEqual({ allowed: false, reason: 'no_matching_consent' });
    }
  });

  it('nor an owner-only entry, an unlisted manifest, or a members entry for a visitor', async () => {
    const storage = await switchedOn();
    expect((await checkConsentForRead(storage, `${PKG}/draft`, OWNER, 'bob@node', 'owner')).allowed).toBe(false);
    expect((await checkConsentForRead(storage, `${PKG}/manifest`, OWNER, 'bob@node', 'owner')).allowed).toBe(false);
    expect((await checkConsentForRead(storage, `${PKG}/team`, OWNER, 'carol@other-node', 'members')).allowed).toBe(false);
  });

  it('a public entry stays readable, and stays eligible to travel to peers under the switch', async () => {
    const storage = await switchedOn();
    expect((await checkConsentForRead(storage, `${PKG}/findings`, OWNER, 'anonymous', 'public')).allowed).toBe(true);
    for (const [key, visibility] of [['findings', 'public'], ['private-notes', 'private']] as const) {
      await storage.setMemory({
        key: `${PKG}/${key}`, ownerGaii: OWNER, value: { key }, visibility,
        tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      });
    }
    expect(await isEligibleForReplication(storage, OWNER, `${PKG}/findings`)).toEqual({ eligible: true, consentId: 'fed1' });
    expect((await isEligibleForReplication(storage, OWNER, `${PKG}/private-notes`)).eligible).toBe(false);
  });

  it('a consent naming the reader still opens a private entry of the package', async () => {
    const storage = await switchedOn();
    await storage.createConsent({
      id: 'named1', ownerGaii: OWNER, dataPattern: `${PKG}/*`, recipient: 'ghii:bob@node', purpose: 'test',
      scope: 'local', expires: null, status: 'active', grantedAt: now, revokedAt: null,
    });
    const bob = await checkConsentForRead(storage, `${PKG}/private-notes`, OWNER, 'agent2#bob@node', 'private');
    expect(bob).toEqual({ allowed: true, consentId: 'named1', reason: 'consent_granted' });
    const carol = await checkConsentForRead(storage, `${PKG}/private-notes`, OWNER, 'carol@node', 'private');
    expect(carol.allowed).toBe(false);
  });
});
