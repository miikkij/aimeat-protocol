/**
 * @file mcp-grant-cap-count.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 13: a grant's call cap counted a list of at most 200 usage rows,
 *   so a cap over 200 was never reached; it missed the calls still in the usage buffer (flushed every
 *   15 s); and an end date that was not a date never ran out. The cap now counts with
 *   countUsageCalls plus the buffer, and an unparsable end date counts as passed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-grant-cap-count.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 13).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { putMcpGrant, resolveMcpAccess, type McpGrant } from '../../src/services/mcp-client/grants.js';
import { recordUsageCall, resetUsageBuffer } from '../../src/services/usage/usage-buffer.js';

const OWNER = 'alice@test-node';
const AGENT = 'claude#alice@test-node';
let storage: Storage;
const server = { slug: 'tracker', ownerGhii: OWNER } as unknown as McpServerRecord;

function grant(over: Partial<McpGrant>): McpGrant {
  return {
    type: 'aimeat:McpGrant', ownerGhii: OWNER, server: 'tracker', grantee: AGENT, tools: '*',
    expires: null, grantedBy: OWNER, grantedAt: new Date().toISOString(), ...over,
  };
}

async function storeCalls(n: number, coordinate = 'tracker/create_issue'): Promise<void> {
  const ts = new Date(Date.now() - 60_000).toISOString();
  await storage.appendUsageCall(Array.from({ length: n }, () => ({
    id: randomUUID(), ts, ownerGhii: OWNER, actorGaii: AGENT, actorKind: 'agent', surface: 'mcp-remote',
    coordinate, appId: '', counterpartyGhii: '', outcome: 'ok', reason: '', durationMs: 1, chargedUnits: 0,
    unit: '', currency: '', entitlementId: '', runId: '', meta: {},
  })) as never);
}

const access = () => resolveMcpAccess({ storage, server, grantee: AGENT, tool: 'create_issue', scopes: ['mcp:use'] });

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  resetUsageBuffer();
});

describe('the call cap', () => {
  it('is reached above 200 calls', async () => {
    await putMcpGrant(storage, grant({ callCap: { count: 250, windowHours: 1 } }));
    await storeCalls(250);
    await storeCalls(30, 'other/create_issue');
    expect(await storage.countUsageCalls({ actorGaii: AGENT, surface: 'mcp-remote' }, 'tracker/')).toBe(250);
    expect(await access()).toMatchObject({ allowed: false, code: 'CAP_REACHED' });
  });

  it('counts the calls still in the usage buffer', async () => {
    await putMcpGrant(storage, grant({ callCap: { count: 3, windowHours: 1 } }));
    await storeCalls(2);
    expect((await access()).allowed).toBe(true);
    recordUsageCall({ ownerGhii: OWNER, actorGaii: AGENT, actorKind: 'agent', surface: 'mcp-remote', coordinate: 'tracker/create_issue' });
    expect(await access()).toMatchObject({ allowed: false, code: 'CAP_REACHED' });
  });
});

describe('the end date', () => {
  it('counts an end date that is not a date as passed', async () => {
    await putMcpGrant(storage, grant({ expires: 'next tuesday' }));
    expect(await access()).toMatchObject({ allowed: false, code: 'GRANT_EXPIRED' });
  });
});
