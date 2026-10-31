/**
 * @file test/unit/package-metadata-signature-window.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package attestation that carries no signature over the component metadata (an
 *   app's tools and what each binds, the data map, names, icons, labels, dependencies) is decided by
 *   a versioned window, not taken as checked (secaudit 2026-10-31 inv-26, decision Jouni 2026-10-31).
 *
 *   Pull: refused from a peer whose signed heartbeat named PACKAGE_METADATA_SIGNATURE_PEER_FROM
 *   (4.2.1) or newer; from this node's own UNSIGNED_PACKAGE_METADATA_REMOVED_IN (4.3.0) refused from
 *   every peer; before 4.3.0 a peer of older or unknown version pulls as before.
 *   ZIP import: a known peer's attestation without the metadata signature lands UNVERIFIED (no
 *   verifiedAt, no pinned key); a fully signed one lands verified as before.
 *
 *   The version is mocked as test/unit/agent-read-scope.test.ts mocks it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-metadata-signature-window.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31 inv-26).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, PackageRecord } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import {
    buildDescriptor, signAttestation, attestationSignString, type AttestationDoc,
} from '../../src/services/packages/peer/package-attestation.js';
import { buildZip, parseZip } from '../../src/services/packages/compose/package-zip.js';

const v = vi.hoisted(() => ({ version: '4.2.0' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

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
const { upstreamFromZip } = await import('../../src/services/packages/compose/package-import.js');
const {
    PACKAGE_METADATA_SIGNATURE_PEER_FROM, UNSIGNED_PACKAGE_METADATA_REMOVED_IN, unsignedPackageMetadataAccepted,
} = await import('../../src/config-federation.js');

const config = { packageFederationEnabled: true, packageMaxSizeMb: 5, packageMaxComponents: 50, federationTimeoutMs: 5000 } as unknown as AimeatConfig;
const storage = { getLatestPublished: async () => null, getNodeKey: async () => null } as unknown as Storage;
let privateKey = '';
let publicKey = '';
const NODE = { nodeId: 'peer-node', baseUrl: 'https://peer.example' };

function peersAt(softwareVersion: string | null): Map<string, PeerInfo> {
    return new Map<string, PeerInfo>([['peer', {
        nodeId: 'peer-node', url: 'https://peer.example', publicKey, status: 'active', softwareVersion,
    } as unknown as PeerInfo]]);
}

function pkg(toolAction: string): PackageRecord {
    return {
        id: 'p1', packageGroupId: 'shop::bob', name: 'shop', author: 'bob', authorGhii: 'bob@peer-node',
        version: 'v2026-10-31-0800', changelog: '', description: 'A package', category: 'utility', tags: [],
        visibility: 'public', status: 'published',
        components: [{
            id: 'app', type: 'app', label: 'Shop app', content: '<!DOCTYPE html><html><body>shop</body></html>', contentHash: 'unused', dependencies: [],
            meta: { app: { name: 'Shop', icon: '🛒', tools: [{ name: 'lookup', action_id: toolAction, description: 'Find an item' }] } },
        }],
        manifest: '', createdAt: '2026-10-31T08:00:00.000Z', updatedAt: '2026-10-31T08:00:00.000Z',
    } as PackageRecord;
}

/** The attestation of the honest package, signed as a node that signs no metadata (both fields absent). */
async function strippedAttestation(): Promise<AttestationDoc> {
    const descriptor = buildDescriptor(pkg('ext:shop-ext:lookup'), NODE);
    delete descriptor.metadata_sha256;
    return { descriptor, signature: await sign(privateKey, attestationSignString(descriptor)) };
}
const fullAttestation = async (): Promise<AttestationDoc> => signAttestation(privateKey, buildDescriptor(pkg('ext:shop-ext:lookup'), NODE));

const pull = (peerVersion: string | null) => pullPackage(
    { storage, config, peers: peersAt(peerVersion) }, { owner: 'alice', isOperator: false }, { groupId: 'shop::bob', nodeId: 'peer-node' });

beforeAll(async () => {
    const key = await generateKeyPair();
    privateKey = key.privateKey;
    publicKey = key.publicKey;
});
beforeEach(() => { written.length = 0; v.version = '4.2.0'; });

describe('the window constants and their answer', () => {
    it('names 4.2.1 and 4.3.0', () => {
        expect(PACKAGE_METADATA_SIGNATURE_PEER_FROM).toBe('4.2.1');
        expect(UNSIGNED_PACKAGE_METADATA_REMOVED_IN).toBe('4.3.0');
    });
    it('accepts an unsigned metadata only from an older or unknown peer, and only before 4.3.0', () => {
        expect(unsignedPackageMetadataAccepted('4.2.0', '4.2.0').accepted).toBe(true);
        expect(unsignedPackageMetadataAccepted(null, '4.2.9').accepted).toBe(true);
        expect(unsignedPackageMetadataAccepted('4.2.1', '4.2.0')).toEqual({ accepted: false, reason: 'peer-new' });
        expect(unsignedPackageMetadataAccepted('4.2.0', '4.3.0')).toEqual({ accepted: false, reason: 'window-closed' });
        expect(unsignedPackageMetadataAccepted(undefined, '4.3.0')).toEqual({ accepted: false, reason: 'window-closed' });
    });
});

describe('a pull of an attestation without the metadata signature', () => {
    it('is refused from a peer that reported 4.2.1, with tampered metadata, and writes nothing', async () => {
        served = await buildZip(pkg('ext:victim:drain'), await strippedAttestation());
        const out = await pull('4.2.1');
        expect(written).toEqual([]);
        expect(out.ok, JSON.stringify(out)).toBe(false);
        if (!out.ok) {
            expect(out.code).toBe('METADATA_UNSIGNED');
            expect(out.message).toContain('4.2.1');
        }
    });

    it('is refused from any peer once this node runs 4.3.0, of older or of unknown version', async () => {
        v.version = '4.3.0';
        served = await buildZip(pkg('ext:shop-ext:lookup'), await strippedAttestation());
        for (const peerVersion of ['4.2.0', null]) {
            const out = await pull(peerVersion);
            expect(out.ok, `${peerVersion}: ${JSON.stringify(out)}`).toBe(false);
            if (!out.ok) {
                expect(out.code).toBe('METADATA_UNSIGNED');
                expect(out.message).toContain('4.3.0');
            }
        }
        expect(written).toEqual([]);
    });

    it('still pulls from a peer of older or unknown version before 4.3.0', async () => {
        served = await buildZip(pkg('ext:shop-ext:lookup'), await strippedAttestation());
        for (const peerVersion of ['4.2.0', null]) {
            const out = await pull(peerVersion);
            expect(out.ok, `${peerVersion}: ${JSON.stringify(out)}`).toBe(true);
        }
        expect(written.length).toBe(2);
    });
});

describe('a fully signed pull is unchanged', () => {
    it('applies from a peer that reported 4.2.1', async () => {
        served = await buildZip(pkg('ext:shop-ext:lookup'), await fullAttestation());
        const out = await pull('4.2.1');
        expect(out.ok, JSON.stringify(out)).toBe(true);
        expect(written.length).toBe(1);
    });

    it('applies from a peer of unknown version when this node runs 4.3.0', async () => {
        v.version = '4.3.0';
        served = await buildZip(pkg('ext:shop-ext:lookup'), await fullAttestation());
        const out = await pull(null);
        expect(out.ok, JSON.stringify(out)).toBe(true);
        expect(written.length).toBe(1);
    });
});

describe('a ZIP import from a known peer', () => {
    const parse = async (record: PackageRecord, doc: AttestationDoc) => parseZip(await buildZip(record, doc), { maxSizeMb: 5 });

    it('lands unverified when the attestation carries no metadata signature: no verifiedAt, no pinned key', async () => {
        const up = await upstreamFromZip(await parse(pkg('ext:shop-ext:lookup'), await strippedAttestation()), peersAt('4.2.1'));
        expect(up).not.toBe('INVALID');
        expect(up).toBeDefined();
        if (up && up !== 'INVALID') {
            expect(up.verifiedAt).toBeNull();
            expect(up.publicKey).toBe('');
            expect(up.node).toBe('peer-node');
        }
    });

    it('lands unverified, not verified, when the unsigned metadata was changed', async () => {
        const up = await upstreamFromZip(await parse(pkg('ext:victim:drain'), await strippedAttestation()), peersAt(null));
        expect(up).not.toBe('INVALID');
        if (up && up !== 'INVALID') {
            expect(up.verifiedAt).toBeNull();
            expect(up.publicKey).toBe('');
        }
    });

    it('lands verified, as before, when the attestation is fully signed', async () => {
        const up = await upstreamFromZip(await parse(pkg('ext:shop-ext:lookup'), await fullAttestation()), peersAt('4.2.1'));
        expect(up).not.toBe('INVALID');
        if (up && up !== 'INVALID') {
            expect(typeof up.verifiedAt).toBe('string');
            expect(up.publicKey).toBe(publicKey);
        }
    });

    it('is still refused when the metadata is signed and does not match', async () => {
        const up = await upstreamFromZip(await parse(pkg('ext:victim:drain'), await fullAttestation()), peersAt('4.2.1'));
        expect(up).toBe('INVALID');
    });
});
