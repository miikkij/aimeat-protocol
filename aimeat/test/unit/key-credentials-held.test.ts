/**
 * @file test/unit/key-credentials-held.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/key-credentials.ts: the first sign-in's credentials mail of a code-key
 *   account is an owner mail. An address proven before the first sign-in gets nothing (ruling 1 of
 *   2026-11-08); an address nobody proved gets nothing then, the password waits sealed and the login
 *   answer says so, and the mail goes once the address is verified (sendHeldKeyCredentials). A password
 *   changed since, or a node with no data key, sends nothing later (codebase analysis 2026-11-03,
 *   decision 14a of 2026-11-05).
 * @usage pnpm exec vitest run test/unit/key-credentials-held.test.ts
 * @version-history
 *   v1.2.0 — 2026-11-08 — An address proven before the first sign-in gets no credentials mail; the
 *     developer approved changing this one assertion (secaudit2026nov08 round 14b).
 *   v1.1.0 — 2026-11-08 — A proof asked for before the first sign-in does not receive the held password
 *     (secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 14a of 2026-11-05).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { issueFirstLoginKeyCredentials, sendHeldKeyCredentials, NS_HELD, heldKey } from '../../src/services/key-credentials.js';
import { provideNodeService } from '../../src/services/node-context.js';
import type { EmailService } from '../../src/services/email.js';

const NODE = 'node-test';
const ADDRESS = 'bob@example.test';
const GHII = `bob@${NODE}`;
const KEY = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const hashOf = (a: string) => createHash('sha256').update(a.toLowerCase().trim()).digest('hex');

function mailer() {
  const sendKeyCredentials = vi.fn(async () => true);
  const svc = { enabled: true, sendKeyCredentials } as unknown as EmailService;
  return { svc, sendKeyCredentials };
}

/** The few storage methods the two functions call, over plain maps. */
function fakeStorage(proven: boolean) {
  const ghii: Record<string, unknown> = {
    ghii: GHII, username: 'bob', locale: 'en', passwordHash: 'code-hash', notificationEmail: ADDRESS,
    emailVerifiedAt: proven ? '2026-11-01T00:00:00.000Z' : null, emailHash: proven ? hashOf(ADDRESS) : null,
  };
  const inv: Record<string, unknown> = { id: 'inv-1', type: 'code', organismId: 'org-1', provisionedOwner: 'bob', email: ADDRESS, acceptedBy: null };
  const memory = new Map<string, Record<string, unknown>>();
  const storage = {
    ghii, inv, memory,
    getGHII: vi.fn(async (id: string) => (id === GHII ? { ...ghii } : null)),
    updateGHII: vi.fn(async (_id: string, u: Record<string, unknown>) => { Object.assign(ghii, u); return { ...ghii }; }),
    getCodeInvitationByProvisionedOwner: vi.fn(async (o: string) => (o === 'bob' ? { ...inv } : null)),
    updateInvitation: vi.fn(async (_id: string, u: Record<string, unknown>) => { Object.assign(inv, u); return { ...inv }; }),
    getOrganism: vi.fn(async () => ({ id: 'org-1', name: 'Carol Club' })),
    setMemory: vi.fn(async (r: Record<string, unknown>) => { memory.set(`${r.ownerGaii} ${r.key}`, r); }),
    getMemory: vi.fn(async (ns: string, key: string) => memory.get(`${ns} ${key}`) ?? null),
    deleteMemory: vi.fn(async (ns: string, key: string) => memory.delete(`${ns} ${key}`)),
  };
  return storage;
}

const config = (key: string | null = KEY) => ({ encryptionKey: key, totpSecretEncryptionKey: null, baseUrl: 'https://node.example' }) as never;
const prove = (s: ReturnType<typeof fakeStorage>) => Object.assign(s.ghii, { emailVerifiedAt: '2026-11-05T00:00:00.000Z', emailHash: hashOf(ADDRESS) });

let mail: ReturnType<typeof mailer>;
beforeEach(() => { mail = mailer(); provideNodeService('email', mail.svc); });
afterEach(() => { provideNodeService('email', null); });

describe('the first sign-in of a code-key account', () => {
  // The developer's ruling 1 of 2026-11-08 (secaudit2026nov08 round 14b): an address proven before the
  // holder's first sign-in may be one that whoever knew the key proved, so the credentials are shown to
  // the session that signed in and are not mailed.
  it('mails nothing to an address proven before the first sign-in, holds nothing, and answers the credentials', async () => {
    const s = fakeStorage(true);
    const cred = await issueFirstLoginKeyCredentials(s as never, config(), { ...s.ghii } as never);
    expect(cred?.username).toBe('bob');
    expect(typeof cred?.password).toBe('string');
    expect(cred?.email_sent).toBe(false);
    expect(cred?.email_held).toBeUndefined();
    expect(mail.sendKeyCredentials).not.toHaveBeenCalled();
    expect(s.memory.size).toBe(0);
  });

  it('sends nothing to an address nobody proved, and the answer says the mail waits', async () => {
    const s = fakeStorage(false);
    const cred = await issueFirstLoginKeyCredentials(s as never, config(), { ...s.ghii } as never);
    expect(mail.sendKeyCredentials).not.toHaveBeenCalled();
    expect(cred?.email_sent).toBe(false);
    expect(cred?.email_held).toBe(true);
    expect(cred?.email_note).toMatch(/not verified yet.*sent when you verify the address/);
    const held = s.memory.get(`${NS_HELD} ${heldKey(GHII)}`);
    expect(held, 'the password waits in the held namespace').toBeTruthy();
    expect(JSON.stringify(held!.value)).not.toContain(cred!.password);
  });

  it('a node with no data key holds nothing, and the answer says the mail will not follow', async () => {
    const s = fakeStorage(false);
    const cred = await issueFirstLoginKeyCredentials(s as never, config(null), { ...s.ghii } as never);
    expect(cred?.email_held).toBe(false);
    expect(cred?.email_note).toMatch(/cannot send it later/);
    expect(s.memory.size).toBe(0);
    expect(mail.sendKeyCredentials).not.toHaveBeenCalled();
  });
});

describe('the held mail, once the address is verified', () => {
  it('goes to the proven address with the password the first sign-in issued, once', async () => {
    const s = fakeStorage(false);
    const cred = await issueFirstLoginKeyCredentials(s as never, config(), { ...s.ghii } as never);
    expect(await sendHeldKeyCredentials(s as never, config(), GHII), 'nothing goes while the address is unproven').toBe(false);
    expect(s.memory.size, 'and the password keeps waiting').toBe(1);
    prove(s);
    expect(await sendHeldKeyCredentials(s as never, config(), GHII)).toBe(true);
    expect(mail.sendKeyCredentials).toHaveBeenCalledTimes(1);
    expect(mail.sendKeyCredentials).toHaveBeenCalledWith(ADDRESS, expect.objectContaining({ username: 'bob', password: cred!.password, orgName: 'Carol Club' }), 'en');
    expect(s.memory.size).toBe(0);
    expect(await sendHeldKeyCredentials(s as never, config(), GHII), 'a second verification sends nothing').toBe(false);
    expect(mail.sendKeyCredentials).toHaveBeenCalledTimes(1);
  });

  it('a password changed since the first sign-in is not mailed', async () => {
    const s = fakeStorage(false);
    await issueFirstLoginKeyCredentials(s as never, config(), { ...s.ghii } as never);
    prove(s);
    s.ghii.passwordHash = 'a-password-the-person-chose';
    expect(await sendHeldKeyCredentials(s as never, config(), GHII)).toBe(false);
    expect(mail.sendKeyCredentials).not.toHaveBeenCalled();
    expect(s.memory.size, 'the held record is gone either way').toBe(0);
  });

  // secaudit2026nov08 round 14 (attach-email:pending-code-key-accepts-any-address): a code asked for
  // before the first sign-in, by anyone who knew the key, and confirmed after it, proved an address
  // the held password then went to.
  it('a proof asked for before the first sign-in does not receive the held password; the holder\'s later proof does', async () => {
    const s = fakeStorage(false);
    const cred = await issueFirstLoginKeyCredentials(s as never, config(), { ...s.ghii } as never);
    const heldAt = Date.parse(String(s.memory.get(`${NS_HELD} ${heldKey(GHII)}`)!.createdAt));
    prove(s);
    expect(await sendHeldKeyCredentials(s as never, config(), GHII, new Date(heldAt - 60_000).toISOString())).toBe(false);
    expect(mail.sendKeyCredentials).not.toHaveBeenCalled();
    expect(s.memory.size, 'the password keeps waiting for the holder').toBe(1);
    expect(await sendHeldKeyCredentials(s as never, config(), GHII, new Date(heldAt + 1_000).toISOString())).toBe(true);
    expect(mail.sendKeyCredentials).toHaveBeenCalledWith(ADDRESS, expect.objectContaining({ password: cred!.password }), 'en');
  });

  it('an account with nothing held sends nothing', async () => {
    const s = fakeStorage(true);
    expect(await sendHeldKeyCredentials(s as never, config(), GHII)).toBe(false);
    expect(mail.sendKeyCredentials).not.toHaveBeenCalled();
  });
});
