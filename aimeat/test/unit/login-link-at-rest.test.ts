/**
 * @file test/unit/login-link-at-rest.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The emailed sign-in link's token is stored as its SHA-256, never as itself
 *   (services/login-link.ts). Secrets audit 2026-10-09, auth S3: the token was the row id, so anyone
 *   who read the EmailVerification table or a backup of it could sign in as every person with a
 *   link outstanding. A row written the old way (the raw token as id) is still redeemed for one
 *   release, because a welcome link lasts seven days.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { provisionOwner } from '../../src/services/owner-provisioning.js';
import { issueLoginLink, redeemLoginLink, LOGIN_LINK_TTL_MS } from '../../src/services/login-link.js';

const NODE_ID = 'aimeat-local-001-dev';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('the sign-in link token at rest', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;

  async function person(name: string) {
    const email = `${name}@example.test`;
    const { ghii } = await provisionOwner(storage, config, { via: 'direct', username: name, displayName: name, verifiedEmail: email });
    await storage.updateGHII(ghii.ghii, { notificationEmail: email, magicLinkEnabled: true });
    return { ghii: (await storage.getGHII(ghii.ghii))!, email };
  }

  beforeAll(() => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE_ID };
  });

  it('is stored as its hash, and the hash alone does not redeem it', async () => {
    const { ghii, email } = await person('hashed');
    const url = await issueLoginLink(storage, config, ghii, email, LOGIN_LINK_TTL_MS);
    const token = new URL(url).searchParams.get('token')!;
    expect(await storage.getEmailVerification(token)).toBeNull();
    const row = await storage.getEmailVerification(sha256(token));
    expect(row?.purpose).toBe('login');
    // What a reader of the table holds is the hash: sent as the token, it is refused.
    expect((await redeemLoginLink(storage, config, sha256(token))).ok).toBe(false);
    // The token from the mail signs in, once.
    expect((await redeemLoginLink(storage, config, token)).ok).toBe(true);
    expect((await redeemLoginLink(storage, config, token)).ok).toBe(false);
  });

  it('a row written before the change (the raw token as its id) is still redeemed, once', async () => {
    const { ghii, email } = await person('legacy');
    const token = randomBytes(32).toString('hex');
    await storage.createEmailVerification({
      id: token, ownerName: ghii.ownerName, emailHash: sha256(email.toLowerCase()), code: sha256(token),
      purpose: 'login', status: 'pending', attempts: 0,
      expiresAt: new Date(Date.now() + LOGIN_LINK_TTL_MS).toISOString(), createdAt: new Date().toISOString(), verifiedAt: null,
    });
    expect((await redeemLoginLink(storage, config, token)).ok).toBe(true);
    expect((await redeemLoginLink(storage, config, token)).ok).toBe(false);
  });
});
