/**
 * @file created-account-operator.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 19: who becomes the node's operator is one rule for every
 *   account-creating route. createdAccountIsOperator says yes for the first real owner and for a node
 *   with no operator, and no once an operator exists. register-web and POST /v1/owners asked "first
 *   owner only" while POST /v1/ghii and provisionOwner also self-healed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/created-account-operator.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 19).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { createdAccountIsOperator } from '../../src/services/owner-provisioning.js';

const owner = (name: string, roles: string[]) => ({ name, displayName: name, publicKey: 'pk', roles, createdAt: new Date().toISOString() }) as never;

describe('createdAccountIsOperator', () => {
    it('is yes on an empty node, the anonymous system owner not counted', async () => {
        const s = new SqliteStorage(':memory:') as unknown as Storage;
        await s.createOwner(owner('anonymous', ['owner']));
        expect(await createdAccountIsOperator(s)).toBe(true);
    });

    it('is yes when owners exist but none is an operator', async () => {
        const s = new SqliteStorage(':memory:') as unknown as Storage;
        await s.createOwner(owner('alice', ['owner']));
        expect(await createdAccountIsOperator(s)).toBe(true);
    });

    it('is no once an operator exists', async () => {
        const s = new SqliteStorage(':memory:') as unknown as Storage;
        await s.createOwner(owner('op', ['owner', 'operator']));
        expect(await createdAccountIsOperator(s)).toBe(false);
    });
});
