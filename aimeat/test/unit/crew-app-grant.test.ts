/**
 * @file crew-app-grant.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 81: the crew operations refuse an app grant on draft, discard,
 *   publish, seed and restore, and did not on a trial or a validation. An app holding memory:write
 *   started a trial of a definition it wrote on the owner's connected runtime. Both now answer 403
 *   ACCESS_DENIED to an app grant, before anything is asked of the runtime.
 * @usage cd aimeat && pnpm exec vitest run test/unit/crew-app-grant.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 81).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { crewValidate, crewTryStart, type CrewCaller } from '../../src/services/crew-ops.js';

const NODE = 'aimeat-unit-crew-001';
let deps: { storage: Storage; config: AimeatConfig };

beforeAll(async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const config = { ...loadConfig().config, nodeId: NODE } as AimeatConfig;
    const now = new Date().toISOString();
    await storage.createAgent({
        name: 'crewbot', owner: 'alice', gaii: `crewbot#alice@${NODE}`, capabilities: [], publicKey: 'pk',
        trustScore: 50, morselBalance: 0, createdAt: now, lastSeen: now,
    } as never);
    deps = { storage, config };
});

const app: CrewCaller = { principal: `eco:tool#alice@${NODE}`, owner: 'alice', scopes: ['memory:write'], roles: ['owner', 'app'], pipeline: 'test' };
const doc = { agents: [], tasks: [] } as never;

describe('crew trial and validation refuse an app grant', () => {
    it('validation answers 403 ACCESS_DENIED', async () => {
        const out = await crewValidate(deps, app, 'crewbot', doc);
        expect(out).toMatchObject({ ok: false, status: 403, code: 'ACCESS_DENIED' });
    });

    it('a trial answers 403 ACCESS_DENIED and starts nothing', async () => {
        const out = await crewTryStart(deps, app, 'crewbot', doc, 'do something');
        expect(out).toMatchObject({ ok: false, status: 403, code: 'ACCESS_DENIED' });
    });
});
