/**
 * @file test/unit/federation-signin-permission-step.test.ts
 * @description The once-per-node step that names the peers whose sign-in checks stopped under Core
 *   FED-16 (src/services/federation/signin-permission-step.ts): it names only live member or genesis
 *   peers without the operator's permission, grants nothing, opens no incident when there is none,
 *   and runs once.
 * @version-history
 *   v1.0.0 — 2026-11-24 — Initial (Core FED-16).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { FederationPeerRecord } from '../../src/storage/interface.js';
import { nameClosedSignInPeersOnce, FED16_SIGNIN_STEP_KEY } from '../../src/services/federation/signin-permission-step.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';

const NODE = 'home-node-001';
const config = { nodeId: NODE } as AimeatConfig;
const peer = (nodeId: string, over: Partial<FederationPeerRecord> = {}) =>
    ({ nodeId, status: 'active', tier: 'member', allowFederatedAuth: false, ...over }) as FederationPeerRecord;

describe('nameClosedSignInPeersOnce', () => {
    let s: SqliteStorage;
    beforeEach(() => { s = new SqliteStorage(':memory:'); });

    it('names the live member and genesis peers without the permission, grants nothing, and runs once', async () => {
        const rows = [
            peer('closed-a'), peer('closed-b', { tier: 'genesis' }), peer('allowed', { allowFederatedAuth: true }),
            peer('visiting', { tier: 'visiting' }), peer('gone', { status: 'suspended' }), peer(NODE),
        ];
        const out = await nameClosedSignInPeersOnce(s, config, rows);
        expect(out).toEqual({ ran: true, peers: ['closed-a', 'closed-b'] });
        const { items } = await listSecurityIncidents(s, config);
        const inc = items.find(i => i.type === 'federated_signin_closed');
        expect(inc?.params).toEqual({ count: '2', nodes: 'closed-a, closed-b' });
        expect((await s.getMemory(`system@${NODE}`, FED16_SIGNIN_STEP_KEY))?.value).toMatchObject({ peers: 2 });
        expect(await nameClosedSignInPeersOnce(s, config, rows)).toEqual({ ran: false });
    });

    it('opens no incident on a node whose peers all have the permission', async () => {
        expect(await nameClosedSignInPeersOnce(s, config, [peer('allowed', { allowFederatedAuth: true })])).toEqual({ ran: true, peers: [] });
        expect((await listSecurityIncidents(s, config)).items.filter(i => i.type === 'federated_signin_closed')).toEqual([]);
    });
});
