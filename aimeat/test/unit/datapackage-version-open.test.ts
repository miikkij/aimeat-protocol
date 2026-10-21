/**
 * @file test/unit/datapackage-version-open.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who opens an earlier data package version (services/datapackage/audience.ts
 *   versionOpenTo, secaudit 2026-10 v42 and its capability-loss review). A version with its audience
 *   recorded answers on that audience. A version written before the audience was recorded answers on
 *   its file tier: refused when narrower than the pointer's tier, except that a members tier admits an
 *   account of the node. The owner in person, and the owner's principal with storage:read, open every
 *   version; the version the pointer names is open to whoever passed the pointer's audience.
 * @usage cd aimeat && pnpm exec vitest run test/unit/datapackage-version-open.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import { versionOpenTo, withAudienceTag, recordedAudienceOf } from '../../src/services/datapackage/audience.js';

const OWNER = 'alice@node-x';
const storage = {} as Storage;   // public, members and private never reach storage
const H1 = 'sha256:' + '1'.repeat(64), H2 = 'sha256:' + '2'.repeat(64);
const publicPointer = { contentHash: H2, visibility: 'public' };
const anonymous = { sub: 'anonymous', owner: 'anonymous', anonymous: true };
const account = { sub: 'bob@node-x', owner: 'bob', roles: ['owner'], scopes: [] };
const ownerInPerson = { sub: OWNER, owner: 'alice', roles: ['owner'], scopes: [] };
const agentWithRead = { sub: 'bot#alice@node-x', owner: 'alice', roles: ['agent'], scopes: ['storage:read'] };
const agentWithout = { sub: 'bot#alice@node-x', owner: 'alice', roles: ['agent'], scopes: ['memory:write'] };

describe('the recorded audience tag', () => {
    it('replaces an earlier one and keeps other tags', () => {
        const tags = withAudienceTag(withAudienceTag(['x'], 'private'), 'members');
        expect(tags).toEqual(['x', 'datapackage-audience:members']);
        expect(recordedAudienceOf(tags)).toBe('members');
        expect(recordedAudienceOf(['x'])).toBeUndefined();
    });
});

describe('an earlier version with its audience recorded', () => {
    const recorded = (v: string) => ({ visibility: 'private', tags: withAudienceTag([], v) });
    it('private: closed to everyone but the owner and the owner\'s principal with storage:read', async () => {
        for (const r of [anonymous, account, agentWithout]) expect(await versionOpenTo(storage, OWNER, r, publicPointer, H1, recorded('private'))).toBe(false);
        for (const r of [ownerInPerson, agentWithRead]) expect(await versionOpenTo(storage, OWNER, r, publicPointer, H1, recorded('private'))).toBe(true);
    });
    it('members: open to an account of the node and the owner\'s agent, closed to anonymous', async () => {
        const file = { visibility: 'members', tags: withAudienceTag([], 'members') };
        expect(await versionOpenTo(storage, OWNER, account, publicPointer, H1, file)).toBe(true);
        expect(await versionOpenTo(storage, OWNER, agentWithout, publicPointer, H1, file)).toBe(true);
        expect(await versionOpenTo(storage, OWNER, anonymous, publicPointer, H1, file)).toBe(false);
    });
    it('the version the pointer names is open whatever its tag', async () => {
        expect(await versionOpenTo(storage, OWNER, anonymous, { contentHash: H1, visibility: 'public' }, H1, recorded('private'))).toBe(true);
    });
});

describe('an earlier version written before the audience was recorded', () => {
    it('a private tier under a public pointer is closed to anonymous and to another account', async () => {
        for (const r of [anonymous, account]) expect(await versionOpenTo(storage, OWNER, r, publicPointer, H1, { visibility: 'private' })).toBe(false);
    });
    it('a members tier under a public pointer admits an account of the node, not anonymous', async () => {
        expect(await versionOpenTo(storage, OWNER, account, publicPointer, H1, { visibility: 'members' })).toBe(true);
        expect(await versionOpenTo(storage, OWNER, anonymous, publicPointer, H1, { visibility: 'members' })).toBe(false);
    });
    it('a tier as wide as the pointer\'s is open, as before', async () => {
        expect(await versionOpenTo(storage, OWNER, anonymous, publicPointer, H1, { visibility: 'public' })).toBe(true);
        expect(await versionOpenTo(storage, OWNER, account, { contentHash: H2, visibility: 'organism:org-1' }, H1, { visibility: 'private' })).toBe(true);
    });
});
