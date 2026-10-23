/**
 * @file test/unit/federation-orphan-approvals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A removed peer's approvals stop being a way back in (Core FED-15; secaudit2026oct22):
 *   forgetPeer revokes the approved and auto-approved requests of that node and no other, and the
 *   once-only start step names the approvals a removal left standing before that day on the Security
 *   page, once, changing none of them.
 * @usage pnpm exec vitest run test/unit/federation-orphan-approvals.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (secaudit2026oct22).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { PeeringRequestRecord, FederationPeerRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { forgetPeer } from '../../src/services/peer-origin.js';
import { flagOrphanPeerApprovalsOnce } from '../../src/services/federation-orphan-approvals.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';

const config = { nodeId: 'test-node' } as AimeatConfig;
const OLD = new Date(Date.now() - 3 * 86_400_000).toISOString();
const NOW = new Date().toISOString();

function request(id: string, nodeId: string, status: PeeringRequestRecord['status'], at = OLD): PeeringRequestRecord {
    return { id, fromNodeId: nodeId, fromNodeUrl: `https://${nodeId}.example`, toNodeId: 'test-node', publicKey: 'a2V5', status, createdAt: at, updatedAt: at };
}

function peer(nodeId: string): FederationPeerRecord {
    return {
        nodeId, url: `https://${nodeId}.example`, publicKey: 'a2V5', status: 'active', addedAt: OLD, lastSeen: OLD,
        shareCatalogue: false, replicateMemory: false, allowRouting: false,
    } as FederationPeerRecord;
}

const statusOf = async (storage: SqliteStorage, id: string) => (await storage.getPeeringRequest(id))?.status;

describe('forgetPeer revokes the removed peer\'s approvals', () => {
    let storage: SqliteStorage;
    beforeEach(() => { storage = new SqliteStorage(':memory:'); });

    it('marks its approved and auto-approved requests revoked, and leaves other statuses and other nodes alone', async () => {
        await storage.createPeeringRequest(request('r1', 'gone', 'approved'));
        await storage.createPeeringRequest(request('r2', 'gone', 'auto_approved'));
        await storage.createPeeringRequest(request('r3', 'gone', 'rejected'));
        await storage.createPeeringRequest(request('r4', 'kept', 'approved'));
        await forgetPeer(storage, 'gone');
        expect(await statusOf(storage, 'r1')).toBe('revoked');
        expect(await statusOf(storage, 'r2')).toBe('revoked');
        expect(await statusOf(storage, 'r3')).toBe('rejected');
        expect(await statusOf(storage, 'r4')).toBe('approved');
    });
});

describe('flagOrphanPeerApprovalsOnce', () => {
    let storage: SqliteStorage;
    beforeEach(() => { storage = new SqliteStorage(':memory:'); });

    it('names an old approval with no peer, skips one with a peer and one made today, and changes none', async () => {
        await storage.createPeeringRequest(request('orphan', 'gone', 'approved'));
        await storage.createPeeringRequest(request('linked', 'here', 'auto_approved'));
        await storage.saveFederationPeer(peer('here'));
        await storage.createPeeringRequest(request('fresh', 'joining', 'auto_approved', NOW));
        const named = await flagOrphanPeerApprovalsOnce(storage, config);
        expect(named?.map(r => r.id)).toEqual(['orphan']);
        expect(await statusOf(storage, 'orphan')).toBe('approved');
        const { items } = await listSecurityIncidents(storage, config);
        expect(items.filter(i => i.type === 'federation_orphan_approvals')).toHaveLength(1);
        expect(items[0].detail).toContain('gone');
        expect(items[0].detail).not.toContain('joining');
    });

    it('runs once per node', async () => {
        await storage.createPeeringRequest(request('orphan', 'gone', 'approved'));
        expect(await flagOrphanPeerApprovalsOnce(storage, config)).not.toBeNull();
        expect(await flagOrphanPeerApprovalsOnce(storage, config)).toBeNull();
        const { items } = await listSecurityIncidents(storage, config);
        expect(items.filter(i => i.type === 'federation_orphan_approvals')).toHaveLength(1);
    });

    it('records no incident when every approval has its peer', async () => {
        await storage.createPeeringRequest(request('linked', 'here', 'approved'));
        await storage.saveFederationPeer(peer('here'));
        expect(await flagOrphanPeerApprovalsOnce(storage, config)).toEqual([]);
        expect((await listSecurityIncidents(storage, config)).items).toHaveLength(0);
    });
});
