/**
 * @file test/unit/credential-strategies.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The credential strategy registry (src/auth/credential-strategies.ts) and how the door
 *   inventory reads it (scripts/inventory/principals.ts): every listed kind has a strategy, a handler
 *   cannot read a principal its route did not declare, and a door's reach follows its kind (a kind that
 *   refuses a missing credential takes the door off the open-writes list, one that admits it does not).
 *   The answers each strategy gives are in credential-strategies-table.test.ts.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B8).
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { acceptCredential, credentialOf } from '../../src/auth/credential-strategies.js';
import { CREDENTIAL_KIND_NAMES, CREDENTIAL_KINDS } from '../../src/auth/credential-kinds.js';
import { principalsFor, isPublic, strategyAdmits } from '../../scripts/inventory/principals.js';

const options = { config: { baseUrl: 'https://node.example.com', nodeId: 'n' }, storage: {}, process: 'catalog' } as never;

describe('credential strategy registry', () => {
    it('every kind credential-kinds.ts lists has a strategy that builds', () => {
        expect(CREDENTIAL_KIND_NAMES.length).toBeGreaterThan(0);
        for (const kind of CREDENTIAL_KIND_NAMES) expect(typeof acceptCredential(kind, options), kind).toBe('function');
    });

    it('a handler reading a principal its route did not declare fails loudly', () => {
        expect(() => credentialOf({} as Request, 'party')).toThrow(/declares no acceptCredential\('party'\)/);
        const req = { credential: { kind: 'party', principal: { owner: 'alice' } } } as unknown as Request;
        expect(() => credentialOf(req, 'app-party')).toThrow(/app-party/);
        expect(credentialOf(req, 'party')).toEqual({ owner: 'alice' });
    });
});

describe('the door inventory reads a declared strategy', () => {
    it('a kind that refuses a missing credential admits only the outside credential, so the door is not open', () => {
        for (const kind of CREDENTIAL_KIND_NAMES.filter(k => !CREDENTIAL_KINDS[k].admitsNoCredential)) {
            const r = principalsFor([{ name: 'acceptCredential', args: [kind] }]);
            expect(r.principals, kind).toEqual(['outside-credential']);
            expect(isPublic(r.principals), kind).toBe(false);
        }
    });

    it('a kind that admits a request with no credential keeps the door open', () => {
        const open = CREDENTIAL_KIND_NAMES.filter(k => CREDENTIAL_KINDS[k].admitsNoCredential);
        expect(open).toContain('ucp-platform');
        for (const kind of open) expect(isPublic(principalsFor([{ name: 'acceptCredential', args: [kind] }]).principals), kind).toBe(true);
    });

    it('an unknown kind makes the row unknown, never open or shut', () => {
        expect(strategyAdmits('no-such-kind')).toBeNull();
        expect(strategyAdmits(undefined)).toBeNull();
        expect(strategyAdmits('toString')).toBeNull();
        const r = principalsFor([{ name: 'acceptCredential', args: ['no-such-kind'] }]);
        expect(r.unknown).toEqual(['acceptCredential(no-such-kind)']);
    });

    it('a node session cannot pass a strategy door: requireAuth after it leaves nobody', () => {
        const r = principalsFor([{ name: 'acceptCredential', args: ['party'] }, { name: 'requireAuth', args: [] }]);
        expect(r.principals).toEqual([]);
    });
});
