/**
 * @file package-pull-binding.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A pulled package is written only into the group it was requested and verified for
 *   (secaudit2026oct22). The signature covers descriptor.name, descriptor.author and each component's
 *   type, but the group a pull lands in came from manifest.yaml, which no signature covers, and the
 *   component type that decides how a part is installed came from the manifest too. Here the source
 *   serves a correctly signed package "y" whose manifest names "x" (or changes one component's type),
 *   and the test asks whether the pull reaches the write.
 * @structure the requested group and the signed name differ · the manifest name differs from the
 *   signed one · a component type differs from the signed type · an honest pull still writes
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-pull-binding.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, PackageRecord } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { buildDescriptor, signAttestation } from '../../src/services/packages/peer/package-attestation.js';
import { buildZip } from '../../src/services/packages/compose/package-zip.js';

let served: Buffer = Buffer.alloc(0);
const written: Array<{ name: string; types: string[] }> = [];

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return { ...actual, safeFetch: vi.fn(async () => new Response(new Uint8Array(served), { status: 200 })) };
});
vi.mock('../../src/services/packages/compose/package-import.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/packages/compose/package-import.js')>();
    return {
        ...actual,
        importParsedPackage: vi.fn(async (_deps: unknown, _caller: unknown, input: { parsed: { name: string; components: Array<{ type: string }> } }) => {
            written.push({ name: input.parsed.name, types: input.parsed.components.map(c => c.type) });
            return { ok: true, package: { packageGroupId: `${input.parsed.name}::alice` } };
        }),
    };
});

const { pullPackage } = await import('../../src/services/packages/peer/package-pull.js');

const config = { packageFederationEnabled: true, packageMaxSizeMb: 5, packageMaxComponents: 50, federationTimeoutMs: 5000 } as unknown as AimeatConfig;
const storage = { getLatestPublished: async () => null, getNodeKey: async () => null } as unknown as Storage;
let peers: Map<string, PeerInfo>;
let privateKey = '';
const NODE = { nodeId: 'peer-node', baseUrl: 'https://peer.example' };

function pkg(name: string, type: 'csm' | 'extension' = 'csm'): PackageRecord {
    return {
        id: 'p1', packageGroupId: `${name}::bob`, name, author: 'bob', authorGhii: 'bob@peer-node',
        version: 'v2026-10-25-0800', changelog: '', description: 'A package', category: 'utility', tags: [],
        visibility: 'public', status: 'published',
        components: [{ id: 'part', type, label: 'part', content: 'kind: thing\n', contentHash: 'unused', dependencies: [] }],
        manifest: '', createdAt: '2026-10-25T08:00:00.000Z', updatedAt: '2026-10-25T08:00:00.000Z',
    };
}

/** A ZIP whose bytes come from `zipped` and whose signature was made over `signed`. */
async function serve(signed: PackageRecord, zipped: PackageRecord): Promise<void> {
    const attestation = await signAttestation(privateKey, buildDescriptor(signed, NODE));
    served = await buildZip(zipped, attestation);
}

const pull = (groupId: string) => pullPackage({ storage, config, peers }, { owner: 'alice', isOperator: false }, { groupId, nodeId: 'peer-node' });

beforeAll(async () => {
    const key = await generateKeyPair();
    privateKey = key.privateKey;
    peers = new Map<string, PeerInfo>([['peer', { nodeId: 'peer-node', url: 'https://peer.example', publicKey: key.publicKey, status: 'active' } as unknown as PeerInfo]]);
});
beforeEach(() => { written.length = 0; });

describe('a pull is bound to the group it was verified for', () => {
    it('refuses a signed package whose manifest names another package, and writes nothing', async () => {
        await serve(pkg('y'), pkg('x'));
        const out = await pull('y::bob');
        expect(written).toEqual([]);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('INVALID_SIGNATURE');
    });

    it('refuses a package signed for another group than the one requested', async () => {
        await serve(pkg('x'), pkg('x'));
        const out = await pull('y::bob');
        expect(written).toEqual([]);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('INVALID_SIGNATURE');
    });

    it('refuses a component whose type in the manifest is not the signed type', async () => {
        await serve(pkg('y', 'csm'), pkg('y', 'extension'));
        const out = await pull('y::bob');
        expect(written).toEqual([]);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('DIGEST_MISMATCH');
    });

    it('writes an honest pull, the same package signed and served', async () => {
        await serve(pkg('y'), pkg('y'));
        const out = await pull('y::bob');
        expect(out.ok).toBe(true);
        expect(written).toEqual([{ name: 'y', types: ['csm'] }]);
    });
});
