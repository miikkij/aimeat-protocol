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
 *   v1.2.0 — 2026-11-15 — The record holds the registration only; the older shape for the boot move,
 *     the row a party becomes, the stale rule and the node's cap.
 *   v1.1.0 — 2026-11-01 — The app party token on members/me and a two-segment extension action (WP9d).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4).
 */
import { describe, it, expect } from 'vitest';
import {
    parseAppPartiesValue, parseLegacyParties, emailHashOf, partyDataKey, sharedDataKey, toPartyRow, fromPartyRow, liveRuleOf,
    appPartyMaxOf, DEFAULT_APP_PARTY_MAX, type AppPartyRecord,
} from '../../src/services/app-parties/contract.js';
import { registrationMode, signupOpen } from '../../src/services/app-parties/store.js';
import { validatePartyName, takesPartyToken } from '../../src/services/parties/contract.js';
import { parsePartySelfRegistration } from '../../src/config/data-access.js';
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
    it('a missing or malformed record is a closed app', () => {
        expect(parseAppPartiesValue(null)).toEqual({ registration: { state: 'closed', role: 'member', updatedAt: new Date(0).toISOString() } });
        expect(parseAppPartiesValue({ parties: [{ name: 'x' }], registration: 'open' }).registration.state).toBe('closed');
    });
    it('the older record shape still names its parties for the boot move, and only whole ones', () => {
        const whole = { uid: 'u1', name: 'ap-1', emailHash: 'h', app: 'alice/m.html' };
        expect(parseLegacyParties({ parties: [whole, { name: 'x' }] })).toEqual([whole]);
        expect(parseLegacyParties({ registration: {} })).toEqual([]);
    });
    it('a row carries the record and the columns the lookups and the cap read, and reads back the same', () => {
        const at = '2026-11-15T10:00:00.000Z';
        const p = {
            uid: 'u1', name: 'ap-1', displayName: 'Liisa', kind: 'person', contact: 'l@example.org', status: 'pending',
            createdAt: at, createdBy: 'app:alice/m.html', keys: [], failedAttempts: 0, lastSeenAt: null, app: 'alice/m.html',
            emailHash: 'h', verifiedAt: null, link: { hash: 'lh', purpose: 'verify', expiresAt: '2026-11-15T12:30:00.000Z' }, epoch: 2,
        } as AppPartyRecord;
        const row = toPartyRow(p, 'alice@node', 3);
        expect(row).toMatchObject({ uid: 'u1', ownerGhii: 'alice@node', appId: 'alice/m.html', linkHash: 'lh', epoch: 2, version: 3 });
        // The last link went out 30 minutes before it ends, after the signup: that is when the place counts from.
        expect(row.pendingSince).toBe('2026-11-15T12:00:00.000Z');
        expect(fromPartyRow(row)).toEqual(p);
    });
    it('the stale rule is stalePending as a time: 0 hours makes nothing stale', () => {
        const now = Date.parse('2026-11-15T12:00:00.000Z');
        expect(liveRuleOf(24, now)).toEqual({ now: '2026-11-15T12:00:00.000Z', staleBefore: '2026-11-14T12:00:00.000Z' });
        expect(liveRuleOf(0, now).staleBefore).toBeNull();
        expect(appPartyMaxOf({})).toBe(DEFAULT_APP_PARTY_MAX);
        expect(appPartyMaxOf({ appPartyMax: 25 })).toBe(25);
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
    it('an app party token reaches its roster standing and a two-segment extension action only (WP9d)', () => {
        expect(takesPartyToken('GET', '/v1/apps/alice/m.html/members/me')).toBe(true);
        expect(takesPartyToken('GET', '/v1/apps/alice/m.html/members')).toBe(false);
        expect(takesPartyToken('POST', '/v1/apps/alice/m.html/members')).toBe(false);
        expect(takesPartyToken('POST', '/v1/ext/market-iam/check')).toBe(true);
        expect(takesPartyToken('GET', '/v1/ext/market-iam/check')).toBe(false);
        expect(takesPartyToken('POST', '/v1/ext/market-iam/inst-1/check')).toBe(false);
        expect(takesPartyToken('POST', '/v1/apps/alice/m.html/parties/ap-x/stop')).toBe(false);
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
