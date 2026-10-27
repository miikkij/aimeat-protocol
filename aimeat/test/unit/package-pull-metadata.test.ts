/**
 * @file test/unit/package-pull-metadata.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A pulled package's manifest.yaml metadata (each component's label, dependencies and
 *   meta: an app's tool bindings, data map, name and icon) is installed, and the signature covered
 *   only the components' ids, types and bytes. The serving node now signs that metadata too, with a
 *   second signature so a node that verifies only the first is unchanged, and a pull stops before
 *   any write when it does not match (secaudit2026oct26,
 *   packages/peer/package-pull:pullPackage:unsigned-manifest-metadata-installed).
 *
 *   Usage kept: the same package signed and served pulls; an attestation from a node that signs no
 *   metadata yet pulls as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-pull-metadata.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, PackageRecord } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { buildDescriptor, signAttestation, attestationSignString } from '../../src/services/packages/peer/package-attestation.js';
import { buildZip } from '../../src/services/packages/compose/package-zip.js';

let served: Buffer = Buffer.alloc(0);
const written: Array<{ name: string; meta: unknown[] }> = [];

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return { ...actual, safeFetch: vi.fn(async () => new Response(new Uint8Array(served), { status: 200 })) };
});
vi.mock('../../src/services/packages/compose/package-import.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/packages/compose/package-import.js')>();
    return {
        ...actual,
        importParsedPackage: vi.fn(async (_deps: unknown, _caller: unknown, input: { parsed: { name: string; components: Array<{ meta?: unknown }> } }) => {
            written.push({ name: input.parsed.name, meta: input.parsed.components.map(c => c.meta ?? null) });
            return { ok: true, package: { packageGroupId: `${input.parsed.name}::bob` } };
        }),
    };
});

const { pullPackage } = await import('../../src/services/packages/peer/package-pull.js');

const config = { packageFederationEnabled: true, packageMaxSizeMb: 5, packageMaxComponents: 50, federationTimeoutMs: 5000 } as unknown as AimeatConfig;
const storage = { getLatestPublished: async () => null, getNodeKey: async () => null } as unknown as Storage;
let peers: Map<string, PeerInfo>;
let privateKey = '';
const NODE = { nodeId: 'peer-node', baseUrl: 'https://peer.example' };

function pkg(toolAction: string, appName = 'Shop'): PackageRecord {
    return {
        id: 'p1', packageGroupId: 'shop::bob', name: 'shop', author: 'bob', authorGhii: 'bob@peer-node',
        version: 'v2026-10-27-0800', changelog: '', description: 'A package', category: 'utility', tags: [],
        visibility: 'public', status: 'published',
        components: [{
            id: 'app', type: 'app', label: 'Shop app', content: '<!DOCTYPE html><html><body>shop</body></html>', contentHash: 'unused', dependencies: [],
            meta: { app: { name: appName, icon: '🛒', tools: [{ name: 'lookup', action_id: toolAction, description: 'Find an item\nby name' }] } },
        }],
        manifest: '', createdAt: '2026-10-27T08:00:00.000Z', updatedAt: '2026-10-27T08:00:00.000Z',
    } as PackageRecord;
}

const pull = () => pullPackage({ storage, config, peers }, { owner: 'alice', isOperator: false }, { groupId: 'shop::bob', nodeId: 'peer-node' });

beforeAll(async () => {
    const key = await generateKeyPair();
    privateKey = key.privateKey;
    peers = new Map<string, PeerInfo>([['peer', { nodeId: 'peer-node', url: 'https://peer.example', publicKey: key.publicKey, status: 'active' } as unknown as PeerInfo]]);
});
beforeEach(() => { written.length = 0; });

describe('a pull checks the signed component metadata', () => {
    it('refuses a package whose manifest.yaml binds an app tool to another action than was signed, and writes nothing', async () => {
        const attestation = await signAttestation(privateKey, buildDescriptor(pkg('ext:shop-ext:lookup'), NODE));
        served = await buildZip(pkg('ext:victim:drain'), attestation);
        const out = await pull();
        expect(written).toEqual([]);
        expect(out.ok).toBe(false);
    });

    it('refuses a changed app name in manifest.yaml too', async () => {
        const attestation = await signAttestation(privateKey, buildDescriptor(pkg('ext:shop-ext:lookup'), NODE));
        served = await buildZip(pkg('ext:shop-ext:lookup', 'Your Bank'), attestation);
        expect((await pull()).ok).toBe(false);
        expect(written).toEqual([]);
    });

    it('writes an honest pull, the same package signed and served', async () => {
        const honest = pkg('ext:shop-ext:lookup');
        served = await buildZip(honest, await signAttestation(privateKey, buildDescriptor(honest, NODE)));
        const out = await pull();
        expect(out.ok, JSON.stringify(out)).toBe(true);
        expect(written.length).toBe(1);
    });

    it('pulls as before from a node that signs no metadata yet', async () => {
        const honest = pkg('ext:shop-ext:lookup');
        const descriptor = buildDescriptor(honest, NODE);
        delete descriptor.metadata_sha256;
        served = await buildZip(honest, { descriptor, signature: await sign(privateKey, attestationSignString(descriptor)) });
        const out = await pull();
        expect(out.ok, JSON.stringify(out)).toBe(true);
    });
});
