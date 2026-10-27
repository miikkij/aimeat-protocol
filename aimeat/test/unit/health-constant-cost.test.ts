/**
 * @file test/unit/health-constant-cost.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/health takes no sign-in, so what one call costs must not grow with the number
 *   of accounts or with what the mailboxes hold: the storage probe is one keyed read, not a list of
 *   every account, the personal nodes are listed once, and each mailbox gives its oldest item with a
 *   limit of one. The answer is what it was: status, the storage, tunnel and mailbox subsystems with
 *   the same numbers, and the build (secaudit2026oct26, bootstrap/health:per-call-owner-and-mailbox-scan).
 * @usage cd aimeat && pnpm exec vitest run test/unit/health-constant-cost.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { bootstrapRouter } from '../../src/routes/bootstrap.js';
import type { TunnelManager } from '../../src/services/personal-tunnel.js';

const NODE_ID = 'aimeat-test-health-cost';
const calls: Array<{ name: string; args: unknown[] }> = [];
let server: http.Server;
let url = '';

/** The storage with every method call recorded, so the test reads what one health call asked. */
function spied(inner: Storage): Storage {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => { calls.push({ name: String(prop), args }); return v.apply(target, args); };
    },
  });
}

beforeAll(async () => {
  const inner = new SqliteStorage(':memory:') as unknown as Storage;
  const now = Date.now();
  for (const n of [1, 2]) {
    const nodeId = `personal-health-${n}`;
    await inner.createPersonalNode({
      nodeId, ownerName: `healthowner${n}`, anchorNodeId: NODE_ID, publicKey: `pk-${n}`, status: 'offline', agentGaiis: [],
      lastSeen: new Date(now - n * 1000).toISOString(), mailboxQuotaBytes: 1_000_000, mailboxUsedBytes: 0, visibility: 'private',
      createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    });
    for (const i of [0, 1, 2]) {
      await inner.createMailboxItem({
        id: `mb-${n}-${i}`, personalNodeId: nodeId, type: 'board_notification', fromGaii: 'a#b@c', toGaii: 'd#e@f',
        payload: 'x'.repeat(10), sizeBytes: 10, retentionDays: 3,
        expiresAt: new Date(now + 86_400_000).toISOString(),
        // The oldest item of node 2 is 120 s old, so the answer has a number to compare.
        createdAt: new Date(now - (i + 1) * n * 20_000).toISOString(),
      });
    }
  }
  const config: AimeatConfig = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test', personalNodesEnabled: true };
  const tunnel = { getOnlineCount: () => 0 } as unknown as TunnelManager;
  const app = express();
  app.use(bootstrapRouter(config, spied(inner), tunnel));
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

describe('GET /v1/health', () => {
  it('answers as before: healthy, the three subsystems with their numbers, and the build', async () => {
    const res = await fetch(`${url}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: Record<string, any> };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('healthy');
    expect(body.data.subsystems.storage).toEqual({ healthy: true });
    expect(body.data.subsystems.tunnel.healthy).toBe(true);
    expect(typeof body.data.subsystems.tunnel.last_connection_at).toBe('string');
    expect(body.data.subsystems.mailbox.healthy).toBe(true);
    expect(body.data.subsystems.mailbox.items_total).toBe(6);
    expect(body.data.subsystems.mailbox.bytes_total).toBe(60);
    expect(body.data.subsystems.mailbox.oldest_item_age_seconds).toBeGreaterThanOrEqual(119);
    expect(body.data.subsystems.mailbox.oldest_item_age_seconds).toBeLessThan(200);
    expect(typeof body.data.build.version).toBe('string');
  });

  it('reads no list of accounts, lists the personal nodes once, and asks each mailbox for one item', async () => {
    calls.length = 0;
    await (await fetch(`${url}/v1/health`)).json();
    const names = calls.map(c => c.name);
    expect(names).not.toContain('listOwners');
    expect(names.filter(n => n === 'listPersonalNodes')).toHaveLength(1);
    const mailboxReads = calls.filter(c => c.name === 'listMailboxItems');
    expect(mailboxReads).toHaveLength(2);
    for (const c of mailboxReads) expect((c.args[1] as { limit?: number } | undefined)?.limit).toBe(1);
  });
});
