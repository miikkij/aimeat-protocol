/**
 * @file app-parties-contract.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of an app's own users as outside parties (plan doc-mvwxcas3dom3, D4): the
 *   record read defensively, the node's setting as it stands for an app (a closed node is off), when
 *   the signup is open (apps-ask needs the operator's approval), the reserved `ap-` name, the app
 *   party's token routes, and the data map's DATAMAP_REGISTERS_UNSTATED.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-parties-contract.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4).
 */
import { describe, it, expect } from 'vitest';
import { parseAppPartiesValue, emailHashOf, partyDataKey, sharedDataKey } from '../../src/services/app-parties/contract.js';
import { registrationMode, signupOpen } from '../../src/services/app-parties/store.js';
import { validatePartyName, takesPartyToken } from '../../src/services/parties/contract.js';
import { parsePartySelfRegistration } from '../../src/config-data-access.js';
import { checkMap, statesRegisters } from '../../src/services/data-map/data-map-check.js';
import type { DataMap } from '../../src/services/data-map/data-map-types.js';

const reg = (state: 'closed' | 'requested' | 'open' | 'refused', decidedBy?: string) => ({ state, role: 'member', updatedAt: '', ...(decidedBy ? { decidedBy } : {}) });

describe('the setting', () => {
    it('reads off for anything unknown', () => {
        expect(parsePartySelfRegistration(undefined)).toBe('off');
        expect(parsePartySelfRegistration('yes')).toBe('off');
        expect(parsePartySelfRegistration('apps-ask')).toBe('apps-ask');
    });
    it('a node that shows its content to signed-in accounts only is off', () => {
        expect(registrationMode({ partySelfRegistration: 'on', contentAccess: 'signed-in' })).toBe('off');
        expect(registrationMode({ partySelfRegistration: 'on', contentAccess: 'open' })).toBe('on');
    });
    it('the signup is open when the node allows it and the app opened it; apps-ask needs the operator', () => {
        const on = { partySelfRegistration: 'on' as const, contentAccess: 'open' as const };
        const ask = { partySelfRegistration: 'apps-ask' as const, contentAccess: 'open' as const };
        expect(signupOpen(on, reg('open'))).toBe(true);
        expect(signupOpen(on, reg('requested'))).toBe(false);
        expect(signupOpen(ask, reg('open'))).toBe(false);
        expect(signupOpen(ask, reg('open', 'op@node'))).toBe(true);
        expect(signupOpen({ partySelfRegistration: 'off', contentAccess: 'open' }, reg('open', 'op@node'))).toBe(false);
    });
});

describe('the record and the keys', () => {
    it('a missing or malformed record is a closed app with no parties', () => {
        expect(parseAppPartiesValue(null)).toMatchObject({ registration: { state: 'closed' }, parties: [] });
        expect(parseAppPartiesValue({ parties: [{ name: 'x' }], registration: 'open' }).parties).toEqual([]);
    });
    it('an e-mail hash ignores case and spaces', () => {
        expect(emailHashOf(' Matti@Example.org ')).toBe(emailHashOf('matti@example.org'));
    });
    it('each party has its own data keys, apart from the shared ones', () => {
        expect(partyDataKey('alice/m.html', 'u1', 'cart')).not.toBe(partyDataKey('alice/m.html', 'u2', 'cart'));
        expect(sharedDataKey('alice/m.html', 'cart')).toContain('._shared.');
    });
    it('the ap- prefix is kept for app parties', () => {
        expect(validatePartyName('ap-123')).toMatch(/kept for the people/);
        expect(validatePartyName('apple')).toBeNull();
    });
    it('an app party token is taken by the app party endpoints only', () => {
        expect(takesPartyToken('GET', '/v1/apps/alice/m.html/parties/me')).toBe(true);
        expect(takesPartyToken('PUT', '/v1/apps/alice/m.html/party-data/cart')).toBe(true);
        expect(takesPartyToken('GET', '/v1/apps/alice/m.html/parties')).toBe(false);
        expect(takesPartyToken('PUT', '/v1/apps/alice/m.html/parties/registration')).toBe(false);
    });
});

describe('the data map (D4.4)', () => {
    const map = (over: Partial<DataMap> = {}): DataMap => ({
        spec: 'aimeat.datamap/2', what: 'A market', usedFor: 'Trade', form: 'group', arrangement: 'rows',
        machinery: [], leaves: [], held: [], elsewhere: [], source: 'declared', ...over,
    } as DataMap);
    it('an open signup with no statement is a finding; registers-parties or a statement answers it', () => {
        expect(checkMap(map(), '', [], { registersParties: true }).findings.map(f => f.code)).toContain('DATAMAP_REGISTERS_UNSTATED');
        expect(checkMap(map(), '', [], {}).findings.map(f => f.code)).not.toContain('DATAMAP_REGISTERS_UNSTATED');
        expect(statesRegisters(map({ machinery: ['registers-parties'] }))).toBe(true);
        expect(statesRegisters(map({ registers: { who: 'buyers', keeps: [] } }))).toBe(true);
        expect(checkMap(null, '', [], { registersParties: true }).findings.map(f => f.code)).toEqual(['DATAMAP_MISSING', 'DATAMAP_REGISTERS_UNSTATED']);
    });
});
