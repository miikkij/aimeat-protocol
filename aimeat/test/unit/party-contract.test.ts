/**
 * @file party-contract.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of outside parties (plan doc-mvwxcas3dom3, D2, D3; lead decisions L1, L2):
 *   the identity string and the Basic user parse; a key matches only its own hash; the endpoints that
 *   take a party token; a party recipient matches only that exact party and a party accessor matches no
 *   other recipient; a party reader is never a node account and opens only the package its share names.
 * @usage cd aimeat && pnpm exec vitest run test/unit/party-contract.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2, D3).
 */
import { describe, it, expect } from 'vitest';
import { parsePartyRef, parsePartyUser, partyRefOf, takesPartyToken, validatePartyName } from '../../src/services/parties/contract.js';
import { newPartyKey, partyKeyMatches } from '../../src/services/parties/keys.js';
import { matchesRecipient } from '../../src/storage/consent-recipient.js';
import { VALID_RECIPIENT_PATTERNS } from '../../src/services/consent-write.js';
import { isNodeAccount, audienceAllows } from '../../src/services/audience.js';
import { datapackageReadable, versionOpenTo, readsAsPackageOwner } from '../../src/services/datapackage/audience.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const party = { sub: partyRefOf('alice', 'matti', NODE), party: { ownerGhii: OWNER, packageName: 'budget', shareId: 's1' } };
const storage = { getOrganism: async () => null, getMembership: async () => null } as unknown as Storage;

describe('the party identity', () => {
    it('reads party:<owner>/<name>@<node> and nothing an agent or owner parser would', () => {
        expect(parsePartyRef('party:alice/matti@aimeat.io')).toEqual({ owner: 'alice', name: 'matti', node: 'aimeat.io' });
        for (const bad of ['party:matti#alice@node', 'party:alice@node', 'party:/m@node', 'party:alice/m/x@node', 'party:alice/Matti@node', 'alice/matti@node', 'party:alice/matti']) {
            expect(parsePartyRef(bad), bad).toBeNull();
        }
        expect(parsePartyUser('alice/matti')).toEqual({ owner: 'alice', name: 'matti' });
        for (const bad of ['alicematti', 'alice/', '/matti', 'alice/matti/x', 'alice:matti']) expect(parsePartyUser(bad), bad).toBeNull();
        expect(validatePartyName('me')).not.toBeNull();
        expect(validatePartyName('matti-2')).toBeNull();
    });

    it('a party recipient is one of the shapes a consent takes, and the agent shape is not read as one', () => {
        expect(VALID_RECIPIENT_PATTERNS.some(p => p.test('party:alice/matti@aimeat-local-001-dev'))).toBe(true);
        expect(VALID_RECIPIENT_PATTERNS.some(p => p.test('party:alice/Bad Name@node'))).toBe(false);
    });
});

describe('a party key', () => {
    it('matches its own hash only', () => {
        const a = newPartyKey(), b = newPartyKey();
        expect(partyKeyMatches(a.key, a.hash)).toBe(true);
        expect(partyKeyMatches(b.key, a.hash)).toBe(false);
        expect(partyKeyMatches(`${a.key}x`, a.hash)).toBe(false);
        expect(partyKeyMatches(a.key, 'short')).toBe(false);
    });
});

describe('the endpoints that take a party token', () => {
    it('are the package reads, OData, the package files and /v1/parties/me, by method', () => {
        expect(takesPartyToken('GET', '/v1/datapackages/alice/budget')).toBe(true);
        expect(takesPartyToken('GET', '/v1/datapackages/alice/budget/rows/items')).toBe(true);
        expect(takesPartyToken('GET', '/v1/odata/alice/budget/$metadata')).toBe(true);
        expect(takesPartyToken('GET', '/v1/pub/alice@node/datapkg/budget/latest.json')).toBe(true);
        expect(takesPartyToken('POST', '/v1/parties/me/shares/x/accept')).toBe(true);
        expect(takesPartyToken('DELETE', '/v1/datapackages/alice/budget')).toBe(false);
        expect(takesPartyToken('POST', '/v1/datapackages')).toBe(false);
        expect(takesPartyToken('GET', '/v1/datapackages')).toBe(false);
        expect(takesPartyToken('GET', '/v1/memory')).toBe(false);
        expect(takesPartyToken('GET', '/v1/pub/alice@node/notes/a.txt')).toBe(false);
        expect(takesPartyToken('GET', '/v1/parties')).toBe(false);
    });
});

describe('a party in the consent matcher', () => {
    const ref = 'party:alice/matti@node';
    it('a party recipient admits only that exact party', () => {
        expect(matchesRecipient(ref, ref, '', '')).toBe(true);
        expect(matchesRecipient(ref, 'party:alice/other@node', '', '')).toBe(false);
        expect(matchesRecipient(ref, 'alice@node', 'alice', 'node')).toBe(false);
        expect(matchesRecipient(ref, 'claude#alice@node', 'alice', 'node')).toBe(false);
    });
    it('a party accessor is admitted by no wildcard, ghii:, node: or domain: recipient', () => {
        for (const r of ['*', 'ghii:alice@node', 'node:node', 'domain:*', 'alice@node']) {
            expect(matchesRecipient(r, ref, 'alice', 'node'), r).toBe(false);
        }
    });
});

describe('a party reader', () => {
    it('is never a node account, so members and organism refuse it', async () => {
        expect(isNodeAccount(party)).toBe(false);
        expect(isNodeAccount({ ...party, owner: 'alice' })).toBe(false);
        expect(await audienceAllows(storage, { level: 'members' }, { ...party, owner: 'alice' })).toBe(false);
        expect(await audienceAllows(storage, { level: 'organism', organismId: 'org-1' }, { ...party, owner: 'alice' })).toBe(false);
        expect(readsAsPackageOwner(OWNER, { ...party, owner: 'alice', roles: ['owner'] })).toBe(false);
    });
    it('opens exactly the shared package of its owner, and admits nothing where no name is given', async () => {
        expect(await datapackageReadable(storage, OWNER, 'private', party, 'budget')).toBe(true);
        expect(await datapackageReadable(storage, OWNER, 'members', party, 'other')).toBe(false);
        expect(await datapackageReadable(storage, `bob@${NODE}`, 'public', party, 'budget')).toBe(false);
        expect(await datapackageReadable(storage, OWNER, 'public', party)).toBe(false);
    });
    it('opens every version, or only the pinned one', async () => {
        const h1 = `sha256:${'1'.repeat(64)}`, h2 = `sha256:${'2'.repeat(64)}`;
        expect(await versionOpenTo(storage, OWNER, party, undefined, h2, {})).toBe(true);
        const pinned = { ...party, party: { ...party.party, pinnedVersion: h1 } };
        expect(await versionOpenTo(storage, OWNER, pinned, undefined, h1.slice(7), {})).toBe(true);
        expect(await versionOpenTo(storage, OWNER, pinned, { contentHash: h2 }, h2, {})).toBe(false);
    });
});
