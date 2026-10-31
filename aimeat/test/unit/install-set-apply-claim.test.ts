/**
 * @file test/unit/install-set-apply-claim.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A real install set apply claims the set's record (install-set-run.ts claimRun) before
 *   its first write. The repository link, the pulled package copy and the owner account are writes,
 *   so an apply that meets another run's claim answers APPLY_IN_PROGRESS with none of them made
 *   (secaudit 2026-10-31 inv-22). Usage kept: an apply with no other run links the repository, pulls,
 *   creates the owner and records the run; an apply refused after its claim leaves no record and no
 *   claim behind, so the next apply is not refused.
 * @usage cd aimeat && pnpm exec vitest run test/unit/install-set-apply-claim.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit 2026-10-31 inv-22).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord, PackageRecord } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';

const BUNDLE_COMPONENTS = [{
    id: 'bundle', type: 'memory', label: 'Bundle', dependencies: [],
    content: JSON.stringify({ spec: 'aimeat.install-bundle/1', name: 'Shop bundle', packages: [], organisms: [], agents: [] }),
}];

const people = vi.hoisted(() => ({
    checkOwner: vi.fn(),
    ensureOwner: vi.fn(),
}));
vi.mock('../../src/services/install-set-people.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/install-set-people.js')>();
    return {
        ...actual,
        checkOwner: people.checkOwner,
        ensureOwner: people.ensureOwner,
        ownerToWelcome: vi.fn(async () => false),
        welcomeCreated: vi.fn(async () => []),
    };
});
const pullPackage = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/packages/peer/package-pull.js', () => ({ pullPackage }));
vi.mock('../../src/services/packages/compose/package-read.js', () => ({
    getPackageFor: vi.fn(async () => ({
        id: 'local-bundle', packageGroupId: 'shopbundle::newowner', name: 'shopbundle', author: 'newowner',
        version: 'v1', components: BUNDLE_COMPONENTS,
    }) as unknown as PackageRecord),
}));
vi.mock('../../src/services/packages/peer/package-peer-register.js', () => ({ proveNodeCard: vi.fn(async () => ({ kind: 'proven' })) }));
vi.mock('../../src/services/peer-origin.js', () => ({ recordPeerOrigin: vi.fn(async () => undefined) }));
vi.mock('../../src/services/install-set-grants.js', () => ({
    grantInstalledApps: vi.fn(async () => undefined),
    landingPath: vi.fn(async () => null),
}));

const { applyInstallSet, appliedRecordKey, newAppliedRecord } = await import('../../src/services/install-set-apply.js');
const { NS_INSTALL_SETS } = await import('../../src/services/install-set-trust.js');

const config = { nodeId: 'customer-node', baseUrl: 'https://customer.example', federationTimeoutMs: 1000 } as unknown as AimeatConfig;
const KEY = appliedRecordKey('newowner', 'shopbundle::newowner');
const SET = {
    spec: 'aimeat.install-set/1',
    bundle: { group_id: 'shopbundle::seller', node_id: 'repo-node' },
    repository: { node_id: 'repo-node', url: 'https://repo.example', public_key: 'cmVwby1rZXk=' },
    owner: { name: 'newowner', email: 'newowner@example.com' },
};

/** A memory store with the compare-and-swap writes install-set-run.ts uses, and a peer table. */
function memoryStorage() {
    const rows = new Map<string, MemoryRecord>();
    const id = (o: string, k: string) => `${o}\u0000${k}`;
    const saveFederationPeer = vi.fn(async () => undefined);
    const storage = {
        getMemory: async (o: string, k: string) => rows.get(id(o, k)) ?? null,
        setMemory: async (r: MemoryRecord) => { rows.set(id(r.ownerGaii, r.key), r); return r; },
        createMemoryIfAbsent: async (r: MemoryRecord) => {
            if (rows.has(id(r.ownerGaii, r.key))) return null;
            rows.set(id(r.ownerGaii, r.key), r); return r;
        },
        setMemoryIfVersion: async (r: MemoryRecord, v: number) => {
            const cur = rows.get(id(r.ownerGaii, r.key));
            if (!cur || cur.version !== v) return null;
            rows.set(id(r.ownerGaii, r.key), r); return r;
        },
        deleteMemory: async (o: string, k: string) => rows.delete(id(o, k)),
        listMemory: async () => [...rows.values()],
        listInstances: async () => ({ instances: [], total: 0 }),
        saveFederationPeer,
    } as unknown as Storage;
    return { storage, rows, saveFederationPeer };
}

/** Another run of the same set holds the record now. */
function heldByAnotherRun(rows: Map<string, MemoryRecord>): void {
    const now = new Date().toISOString();
    const value = {
        ...newAppliedRecord('newowner', { group_id: 'shopbundle::seller', local_group_id: 'shopbundle::newowner', node_id: 'repo-node', version: 'v1', name: 'Shop bundle' }, 'op@customer-node'),
        running: { id: 'the-other-run', since: now },
    };
    rows.set(`${NS_INSTALL_SETS}\u0000${KEY}`, {
        key: KEY, ownerGaii: NS_INSTALL_SETS, value, visibility: 'private', tags: ['install-set'], ttlHours: null,
        version: 1, createdAt: now, updatedAt: now,
    } as unknown as MemoryRecord);
}

const realPulls = () => pullPackage.mock.calls.filter(c => (c[2] as { preview?: boolean }).preview !== true);

beforeEach(() => {
    vi.clearAllMocks();
    people.checkOwner.mockResolvedValue({ ok: true, exists: false });
    people.ensureOwner.mockResolvedValue({ ok: true, created: true });
    pullPackage.mockImplementation(async (_d: unknown, _c: unknown, input: { preview?: boolean }) => (input.preview
        ? { ok: true, applied: false, reason: 'preview', upstream: { version: 'v1' }, parsed: { components: BUNDLE_COMPONENTS } }
        : { ok: true, applied: true, package: {}, upstream: { version: 'v1' } }));
});

describe('a real install set apply claims the set before it writes', () => {
    it('an apply that meets another run\'s claim links no repository, pulls nothing and creates no account', async () => {
        const { storage, rows, saveFederationPeer } = memoryStorage();
        heldByAnotherRun(rows);
        const peers = new Map<string, PeerInfo>();
        const out = await applyInstallSet({ storage, config, peers }, { installSet: SET, appliedBy: 'op@customer-node' });
        expect(out.ok).toBe(false);
        expect((out as { code: string }).code).toBe('APPLY_IN_PROGRESS');
        expect(saveFederationPeer).not.toHaveBeenCalled();
        expect(peers.has('repo-node')).toBe(false);
        expect(realPulls()).toEqual([]);
        expect(people.ensureOwner).not.toHaveBeenCalled();
        // The other run's claim is untouched.
        expect((rows.get(`${NS_INSTALL_SETS}\u0000${KEY}`)!.value as { running?: { id: string } }).running?.id).toBe('the-other-run');
    });

    it('an apply with no other run links the repository, pulls, creates the owner and records the run', async () => {
        const { storage, rows, saveFederationPeer } = memoryStorage();
        const peers = new Map<string, PeerInfo>();
        const out = await applyInstallSet({ storage, config, peers }, { installSet: SET, appliedBy: 'op@customer-node' });
        expect(out.ok, JSON.stringify(out)).toBe(true);
        expect(saveFederationPeer).toHaveBeenCalledTimes(1);
        expect(realPulls().length).toBe(1);
        expect(people.ensureOwner).toHaveBeenCalledTimes(1);
        const stored = rows.get(`${NS_INSTALL_SETS}\u0000${KEY}`)!.value as { running?: unknown; runs: number; bundle: { version: string } };
        expect(stored.running).toBeUndefined();
        expect(stored.runs).toBe(1);
        expect(stored.bundle.version).toBe('v1');
    });

    it('an apply refused after its claim leaves no record and no claim, so the next apply goes on', async () => {
        const { storage, rows } = memoryStorage();
        people.ensureOwner.mockResolvedValueOnce({ ok: false, status: 403, code: 'REGISTRATION_CLOSED', message: 'Registration is closed on this node.' });
        const first = await applyInstallSet({ storage, config, peers: new Map() }, { installSet: SET, appliedBy: 'op@customer-node' });
        expect((first as { code?: string }).code).toBe('REGISTRATION_CLOSED');
        expect(rows.has(`${NS_INSTALL_SETS}\u0000${KEY}`)).toBe(false);
        const second = await applyInstallSet({ storage, config, peers: new Map() }, { installSet: SET, appliedBy: 'op@customer-node' });
        expect(second.ok, JSON.stringify(second)).toBe(true);
    });

    it('an apply refused after its claim on a set applied before keeps that record, without the claim', async () => {
        const { storage, rows } = memoryStorage();
        const done = await applyInstallSet({ storage, config, peers: new Map() }, { installSet: SET, appliedBy: 'op@customer-node' });
        expect(done.ok, JSON.stringify(done)).toBe(true);
        people.ensureOwner.mockResolvedValueOnce({ ok: false, status: 403, code: 'REGISTRATION_CLOSED', message: 'Registration is closed on this node.' });
        const refused = await applyInstallSet({ storage, config, peers: new Map() }, { installSet: SET, appliedBy: 'op@customer-node' });
        expect((refused as { code?: string }).code).toBe('REGISTRATION_CLOSED');
        const stored = rows.get(`${NS_INSTALL_SETS}\u0000${KEY}`)!.value as { running?: unknown; runs: number };
        expect(stored.running).toBeUndefined();
        expect(stored.runs).toBe(1);
    });
});
