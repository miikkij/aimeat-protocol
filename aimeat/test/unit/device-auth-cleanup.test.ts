/**
 * @file device-auth-cleanup.test.ts
 * @description Expired RFC 8628 device-authorization rows leave storage whatever their status,
 *   driven against real in-memory SQLite.
 *
 *   An approved row carries the agent's Ed25519 private key and its 90-day JWT in plain text
 *   (`agentCredentials`), so it is the row that most needs to go when it expires. Until
 *   2026-10-09 cleanupExpiredDeviceAuth deleted only `pending` rows, and every approved, denied
 *   and expired row stayed for ever (secrets audit 2026-10-09, 1.3). The same audit found that
 *   updateDeviceAuth ignored `expiresAt`, so the 120 s retrieval grace window the device-token
 *   route sets after the first poll never reached storage and the credentials stayed readable for
 *   the whole original window.
 * @usage cd aimeat && pnpm exec vitest run test/unit/device-auth-cleanup.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, 1.3).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, DeviceAuthorizationRecord } from '../../src/storage/interface.js';

let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

const PAST = () => new Date(Date.now() - 60_000).toISOString();
const FUTURE = () => new Date(Date.now() + 3_600_000).toISOString();

function row(deviceCode: string, status: DeviceAuthorizationRecord['status'], expiresAt: string,
  withCredentials = false): DeviceAuthorizationRecord {
  return {
    deviceCode,
    userCode: deviceCode.slice(0, 8).toUpperCase(),
    ownerName: 'alice',
    agentName: `agent-${deviceCode}`,
    status,
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    expiresAt,
    pollInterval: 5,
    ...(withCredentials ? {
      approvedBy: 'alice',
      scopes: ['memory:*'],
      agentCredentials: {
        gaii: `agent-${deviceCode}#alice@node`,
        privateKey: 'PRIVATE-KEY-PLAINTEXT',
        publicKey: 'PUBLIC-KEY',
        token: 'eyJ.agent.jwt',
        expires_at: FUTURE(),
      },
    } : {}),
  };
}

describe('cleanupExpiredDeviceAuth', () => {
  it('deletes an expired APPROVED row and the private key with it', async () => {
    await storage.createDeviceAuth(row('approvedpast', 'approved', PAST(), true));
    const before = await storage.getDeviceAuthByDeviceCode('approvedpast');
    expect(before?.agentCredentials?.privateKey).toBe('PRIVATE-KEY-PLAINTEXT');

    await storage.cleanupExpiredDeviceAuth();

    expect(await storage.getDeviceAuthByDeviceCode('approvedpast')).toBeNull();
  });

  it('deletes expired rows of every status', async () => {
    await storage.createDeviceAuth(row('pendingpast', 'pending', PAST()));
    await storage.createDeviceAuth(row('deniedpast1', 'denied', PAST()));
    await storage.createDeviceAuth(row('expiredpast', 'expired', PAST()));

    const removed = await storage.cleanupExpiredDeviceAuth();

    expect(removed).toBe(3);
    expect(await storage.getDeviceAuthByDeviceCode('pendingpast')).toBeNull();
    expect(await storage.getDeviceAuthByDeviceCode('deniedpast1')).toBeNull();
    expect(await storage.getDeviceAuthByDeviceCode('expiredpast')).toBeNull();
  });

  it('keeps rows that have not expired, approved ones included', async () => {
    await storage.createDeviceAuth(row('pendinglive', 'pending', FUTURE()));
    await storage.createDeviceAuth(row('approvedlive', 'approved', FUTURE(), true));

    expect(await storage.cleanupExpiredDeviceAuth()).toBe(0);

    expect((await storage.getDeviceAuthByDeviceCode('pendinglive'))?.status).toBe('pending');
    expect((await storage.getDeviceAuthByDeviceCode('approvedlive'))?.agentCredentials?.privateKey)
      .toBe('PRIVATE-KEY-PLAINTEXT');
  });
});

describe('updateDeviceAuth expiresAt (the retrieval grace window)', () => {
  it('writes a shortened expiresAt, so the grace window reaches storage', async () => {
    await storage.createDeviceAuth(row('gracerow1', 'approved', FUTURE(), true));
    const grace = new Date(Date.now() + 120_000).toISOString();

    await storage.updateDeviceAuth('gracerow1', { expiresAt: grace });

    expect((await storage.getDeviceAuthByDeviceCode('gracerow1'))?.expiresAt).toBe(grace);
  });

  it('a row whose grace window has passed is removed by the cleanup', async () => {
    await storage.createDeviceAuth(row('gracerow2', 'approved', FUTURE(), true));
    await storage.updateDeviceAuth('gracerow2', { expiresAt: PAST() });

    await storage.cleanupExpiredDeviceAuth();

    expect(await storage.getDeviceAuthByDeviceCode('gracerow2')).toBeNull();
  });
});
