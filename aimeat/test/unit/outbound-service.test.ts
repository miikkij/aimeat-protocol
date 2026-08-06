/**
 * @file test/unit/outbound-service.test.ts
 * @description Unit tests for the outbound door's contact registry mechanics that the
 *   HTTP E2E cannot reach: the unsubscribe token round-trip (token → contact → opt-out;
 *   the token is deliberately never exposed over the owner API), email dedupe by
 *   lower-cased address, and the three-bounce suppression rule.
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { ensureContact, setOptOut, recordBounce } from '../../src/services/outbound/outbound-service.js';

function mem(): Storage {
  return new SqliteStorage(':memory:') as unknown as Storage;
}

describe('outbound contact registry', () => {
  it('dedupes by lower-cased email (one entry per owner per address)', async () => {
    const s = mem();
    const a = await ensureContact(s, 'o@n', { name: 'Asiakas', email: 'Mikko@Example.com' });
    const b = await ensureContact(s, 'o@n', { name: 'Sama Asiakas', email: 'mikko@example.com' });
    expect(b.id).toBe(a.id);
    // A different owner gets their own entry for the same address.
    const c = await ensureContact(s, 'other@n', { name: 'Asiakas', email: 'mikko@example.com' });
    expect(c.id).not.toBe(a.id);
  });

  it('unsubscribe token resolves the contact and opt-out sticks', async () => {
    const s = mem();
    const contact = await ensureContact(s, 'o@n', { name: 'Asiakas', email: 'liisa@example.com' });
    expect(contact.optOutToken.length).toBeGreaterThanOrEqual(20);
    const found = await s.findOutboundContactByToken(contact.optOutToken);
    expect(found?.id).toBe(contact.id);
    await setOptOut(s, found!, true);
    const after = await s.getOutboundContact(contact.id);
    expect(after?.optedOut).toBe(true);
    expect(after?.optOutAt).toBeTruthy();
    // Unknown token resolves nothing (the public endpoint answers identically either way).
    expect(await s.findOutboundContactByToken('not-a-real-token')).toBeUndefined();
  });

  it('the third bounce suppresses the address', async () => {
    const s = mem();
    let contact = await ensureContact(s, 'o@n', { name: 'Pomppu', email: 'bounce@example.com' });
    contact = await recordBounce(s, contact);
    contact = await recordBounce(s, contact);
    expect(contact.suppressedAt).toBeNull();
    contact = await recordBounce(s, contact);
    expect(contact.suppressedAt).toBeTruthy();
    expect(contact.bounceCount).toBe(3);
  });
});
