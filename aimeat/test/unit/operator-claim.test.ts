/**
 * @file test/unit/operator-claim.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator claim of services/owner-provisioning.ts: claimOperatorSetupCode asks for
 *   the setup code while a public node has no OPERATOR (an owner without the role does not end it),
 *   and rolesAtWrite drops a stale operator role unless the request took the code, reading with the
 *   claim form of operatorAccountState.
 * @version-history
 *   2026-10-16 — Initial (Jouni, 2026-10-16: the no-operator self-heal needs the setup code too).
 */
import { describe, it, expect } from 'vitest';
import { claimOperatorSetupCode, rolesAtWrite, SetupCodeRefusedError, type OperatorClaim } from '../../src/services/owner-provisioning.js';
import { setupCodeGateFor } from '../../src/services/setup-code.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

function stubStorage(state: { anyOwner: boolean; anyOperator: boolean }, calls: Array<{ claim?: boolean } | undefined> = []): Storage {
    return { operatorAccountState: async (opts?: { claim?: boolean }) => { calls.push(opts); return state; } } as unknown as Storage;
}
const publicConfig = (): AimeatConfig => ({ baseUrl: 'https://node.example' } as AimeatConfig);
const NOT_TAKEN: OperatorClaim = { tookCode: false, commit: () => {}, release: () => {} };

describe('claimOperatorSetupCode', () => {
    it('asks for the code on a public node that has owners but no operator', async () => {
        const config = publicConfig();
        setupCodeGateFor(config).issue();
        await expect(claimOperatorSetupCode(stubStorage({ anyOwner: true, anyOperator: false }), config, ['owner', 'operator'], undefined))
            .rejects.toBeInstanceOf(SetupCodeRefusedError);
    });
    it('takes the right code once, and the claim says so', async () => {
        const config = publicConfig();
        const code = setupCodeGateFor(config).issue();
        const storage = stubStorage({ anyOwner: true, anyOperator: false });
        const claim = await claimOperatorSetupCode(storage, config, ['owner', 'operator'], code);
        expect(claim.tookCode).toBe(true);
        await expect(claimOperatorSetupCode(storage, config, ['owner', 'operator'], code)).rejects.toBeInstanceOf(SetupCodeRefusedError);
    });
    it('asks nothing once an operator exists, for a role list without the operator, or on a loopback node', async () => {
        const config = publicConfig();
        expect((await claimOperatorSetupCode(stubStorage({ anyOwner: true, anyOperator: true }), config, ['owner', 'operator'], undefined)).tookCode).toBe(false);
        expect((await claimOperatorSetupCode(stubStorage({ anyOwner: true, anyOperator: false }), config, ['owner'], undefined)).tookCode).toBe(false);
        const local = { baseUrl: 'http://localhost:40050' } as AimeatConfig;
        expect((await claimOperatorSetupCode(stubStorage({ anyOwner: false, anyOperator: false }), local, ['owner', 'operator'], undefined)).tookCode).toBe(false);
    });
});

describe('rolesAtWrite', () => {
    it('drops the operator role when an operator exists by now, reading with the claim', async () => {
        const calls: Array<{ claim?: boolean } | undefined> = [];
        expect(await rolesAtWrite(stubStorage({ anyOwner: true, anyOperator: true }, calls), ['owner', 'operator'], NOT_TAKEN)).toEqual(['owner']);
        expect(calls).toEqual([{ claim: true }]);
    });
    it('keeps it when no operator exists, and always for the request that took the code', async () => {
        expect(await rolesAtWrite(stubStorage({ anyOwner: true, anyOperator: false }), ['owner', 'operator'], NOT_TAKEN)).toEqual(['owner', 'operator']);
        expect(await rolesAtWrite(stubStorage({ anyOwner: true, anyOperator: true }), ['owner', 'operator'], { ...NOT_TAKEN, tookCode: true })).toEqual(['owner', 'operator']);
    });
});
