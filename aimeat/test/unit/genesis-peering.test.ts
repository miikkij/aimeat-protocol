import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGenesisPeeringService } from '../../src/services/genesis-peering.js';
import type { GenesisPeeringService } from '../../src/services/genesis-peering.js';
import type { AimeatConfig } from '../../src/config.js';
import type {
    Storage,
    GenesisPeerRecord,
    CsmRecord,
    OrganismRecord,
    OwnerRecord,
    AgentRecord,
} from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node-001',
        maxGenesisPeers: 10,
        ...overrides,
    } as AimeatConfig;
}

function makeMockStorage() {
    const peers = new Map<string, GenesisPeerRecord>();
    const peersByNodeId = new Map<string, GenesisPeerRecord>();
    const csms: CsmRecord[] = [];
    const organisms: OrganismRecord[] = [];
    const owners: OwnerRecord[] = [];
    const agents: AgentRecord[] = [];

    return {
        _peers: peers,
        _peersByNodeId: peersByNodeId,
        createGenesisPeer: vi.fn(async (record: GenesisPeerRecord) => {
            peers.set(record.id, record);
            peersByNodeId.set(record.genesisNodeId, record);
            return record;
        }),
        getGenesisPeer: vi.fn(async (id: string) => peers.get(id) ?? null),
        getGenesisPeerByNodeId: vi.fn(async (nodeId: string) => peersByNodeId.get(nodeId) ?? null),
        listGenesisPeers: vi.fn(async (opts?: { status?: string }) => {
            const all = [...peers.values()];
            if (opts?.status) return all.filter(p => p.status === opts.status);
            return all;
        }),
        updateGenesisPeer: vi.fn(async (id: string, updates: Partial<GenesisPeerRecord>) => {
            const existing = peers.get(id);
            if (!existing) return null;
            const updated = { ...existing, ...updates };
            peers.set(id, updated);
            peersByNodeId.set(updated.genesisNodeId, updated);
            return updated;
        }),
        deleteGenesisPeer: vi.fn(async (id: string) => {
            const existing = peers.get(id);
            if (!existing) return false;
            peers.delete(id);
            peersByNodeId.delete(existing.genesisNodeId);
            return true;
        }),
        listCsms: vi.fn(async () => csms),
        listOrganisms: vi.fn(async () => organisms),
        listOwners: vi.fn(async () => owners),
        listAgents: vi.fn(async () => agents),
    } as unknown as Storage & {
        _peers: Map<string, GenesisPeerRecord>;
        _peersByNodeId: Map<string, GenesisPeerRecord>;
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('Genesis Peering Service', () => {
    let storage: ReturnType<typeof makeMockStorage>;
    let service: GenesisPeeringService;

    beforeEach(() => {
        storage = makeMockStorage();
        service = createGenesisPeeringService(makeConfig(), storage);
    });

    describe('requestPeering', () => {
        it('creates a new genesis peer with pending status', async () => {
            const peer = await service.requestPeering('remote-node-001', 'https://remote.example.com', 'pubkey-123');
            expect(peer.genesisNodeId).toBe('remote-node-001');
            expect(peer.genesisUrl).toBe('https://remote.example.com');
            expect(peer.publicKey).toBe('pubkey-123');
            expect(peer.status).toBe('pending');
            expect(peer.id).toBeTruthy();
            expect(peer.createdAt).toBeTruthy();
        });

        it('rejects duplicate peering for same node', async () => {
            await service.requestPeering('remote-node-001', 'https://remote.example.com', 'pubkey-123');
            await expect(
                service.requestPeering('remote-node-001', 'https://remote.example.com', 'pubkey-456'),
            ).rejects.toThrow('Peering already exists with this node');
        });

        it('rejects when max peers reached', async () => {
            const config = makeConfig({ maxGenesisPeers: 2 });
            service = createGenesisPeeringService(config, storage);
            await service.requestPeering('node-1', 'https://n1.example.com', 'pk1');
            await service.requestPeering('node-2', 'https://n2.example.com', 'pk2');
            await expect(
                service.requestPeering('node-3', 'https://n3.example.com', 'pk3'),
            ).rejects.toThrow('Maximum genesis peers reached');
        });
    });

    describe('approvePeering', () => {
        it('sets status to active', async () => {
            const peer = await service.requestPeering('remote-node-001', 'https://remote.example.com', 'pubkey-123');
            const approved = await service.approvePeering(peer.id);
            expect(approved).not.toBeNull();
            expect(approved!.status).toBe('active');
            expect(approved!.updatedAt).toBeTruthy();
        });
    });

    describe('suspendPeering', () => {
        it('sets status to suspended', async () => {
            const peer = await service.requestPeering('remote-node-001', 'https://remote.example.com', 'pubkey-123');
            await service.approvePeering(peer.id);
            const suspended = await service.suspendPeering(peer.id);
            expect(suspended).not.toBeNull();
            expect(suspended!.status).toBe('suspended');
        });
    });

    describe('removePeering', () => {
        it('deletes the peer', async () => {
            const peer = await service.requestPeering('remote-node-001', 'https://remote.example.com', 'pubkey-123');
            const result = await service.removePeering(peer.id);
            expect(result).toBe(true);
            expect(storage.deleteGenesisPeer).toHaveBeenCalledWith(peer.id);
        });
    });

    describe('getCrossCatalogue', () => {
        it('returns catalogue entries from local CSMs and active peers', async () => {
            // Add a peer and approve it
            const peer = await service.requestPeering('remote-node-001', 'https://remote.example.com', 'pubkey-123');
            await service.approvePeering(peer.id);

            const catalogue = await service.getCrossCatalogue();
            // Should include the active peer entry
            const peerEntries = catalogue.filter(e => e.type === 'genesis_peer');
            expect(peerEntries.length).toBeGreaterThanOrEqual(1);
            expect(peerEntries[0].nodeId).toBe('remote-node-001');
            expect(peerEntries[0].status).toBe('active');
        });
    });

    describe('getNetworkStats', () => {
        it('returns correct statistics', async () => {
            await service.requestPeering('node-1', 'https://n1.example.com', 'pk1');
            await service.requestPeering('node-2', 'https://n2.example.com', 'pk2');
            // Approve only one
            const peers = [...storage._peers.values()];
            await service.approvePeering(peers[0].id);

            const stats = await service.getNetworkStats();
            expect(stats.localNode).toBe('test-node-001');
            expect(stats.totalGenesisPeers).toBe(2);
            expect(stats.activeGenesisPeers).toBe(1);
            expect(stats.networkReach).toBe(2); // 1 active + 1 self
            expect(stats.lastUpdated).toBeTruthy();
        });
    });
});
