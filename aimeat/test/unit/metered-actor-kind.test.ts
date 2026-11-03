/**
 * @file test/unit/metered-actor-kind.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The metered chokepoint (services/metered-access.ts authoriseMeteredCall) records each
 *   decision in the usage stream with the kind of principal that called. An ecosystem app's session
 *   carries the role `ecosystem` (auth/middleware.ts), and the recorder tested a role `eco` that no
 *   token carries, so an ecosystem app's metered call was recorded as the owner's (codebase analysis
 *   2026-11-03, item A3). Usage kept: the owner, an agent and an app grant are recorded as before.
 *   Real in-memory SQLite.
 * @usage cd aimeat && pnpm exec vitest run test/unit/metered-actor-kind.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item A3).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { authoriseMeteredCall } from '../../src/services/metered-access.js';
import { resetUsageBuffer, pendingUsageCalls } from '../../src/services/usage/usage-buffer.js';

const NODE = 'meter-kind-node';
const config = {
  nodeId: NODE, burnRate: 0, marketplaceFeeMode: 'burn', pacingTollDefault: 0, extensionMaxDebitPerCall: 1000,
  commerceFeePercent: 0,
} as unknown as AimeatConfig;

let storage: Storage;
beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  resetUsageBuffer();
});

/** One metered call nobody holds a contract for: the gate answers no_right and records it. */
async function recordedKind(caller: string, roles: string[]): Promise<string | undefined> {
  resetUsageBuffer();
  const out = await authoriseMeteredCall({
    config, storage, caller, session: { roles, scopes: [] },
    product: { ext: 'paidext', action: 'run', label: 'paidext/run', providerOwner: 'sally' },
  });
  expect(out.kind).toBe('no_right');
  const rows = pendingUsageCalls({ actorGaii: caller });
  expect(rows).toHaveLength(1);
  return rows[0]!.actorKind;
}

describe('the usage record of a metered call names the kind of caller', () => {
  it('an ecosystem app is recorded as an ecosystem app, not as its owner', async () => {
    expect(await recordedKind(`eco:drum-news#bob@${NODE}`, ['ecosystem'])).toBe('eco');
  });

  it('usage kept: the owner, an agent and an app grant are recorded as before', async () => {
    expect(await recordedKind(`bob@${NODE}`, ['owner'])).toBe('owner');
    expect(await recordedKind(`claude#bob@${NODE}`, ['agent'])).toBe('agent');
    expect(await recordedKind(`bob@${NODE}`, ['app'])).toBe('app');
  });
});
