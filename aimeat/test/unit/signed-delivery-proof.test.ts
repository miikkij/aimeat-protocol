/**
 * @file test/unit/signed-delivery-proof.test.ts
 * @description deliveryProof and deliveryRefusal (services/signed-node-request.ts): the four
 *   federation messages that carry no send time of their own (memory replicate, catalogue sync,
 *   genesis catalogue ingest, the read receipt) name the node they are for and the moment they were
 *   sent, under a second signature. A delivery passes on the node it names, inside five minutes of
 *   its send time, and once. One that carries none passes only while the node does not require an
 *   audience (secaudit 2026-10 last items, D3; Jouni 2026-10-06: all four).
 * @usage pnpm test -- signed-delivery-proof
 * @version-history
 *   v1.1.0 — 2026-10-10 — The pin (secaudit 2026-10-10 I21), the default that follows the version
 *     (I22), and nodeRequestSignedBy leaving the nonce (I7).
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 last items, D3).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import {
    audienceProof, audienceRefusal, deliveryProof, deliveryRefusal, pinnedRefusal, carriesProof, nodeRequestSignedBy,
    signNodeRequest, checkNodeRequest, type ProofPin,
} from '../../src/services/signed-node-request.js';
import {
    AUDIENCE_REQUIRED_BY_DEFAULT_IN, UNPROVEN_FORMAT_REMOVED_IN, audienceRequiredByDefault, federationDefaults,
} from '../../src/config-federation.js';

describe('a delivery names its node and its moment', () => {
    let keys: { publicKey: string; privateKey: string };
    let other: { publicKey: string; privateKey: string };
    // A replicate: its signed timestamp is the RECORD's update time, months old, so the window
    // cannot be asked of it. The send time travels in the proof.
    const signed = (n: number) => JSON.stringify({ source_node: 'node-a', key: `k${n}`, value: n, version: 1, timestamp: '2026-01-01T00:00:00.000Z' });
    const check = (sig: string, body: Record<string, unknown>, opts: { required?: boolean; publicKey?: string; now?: number } = {}) =>
        deliveryRefusal({
            sourceNode: 'node-a', signed: sig, body, publicKey: opts.publicKey ?? keys.publicKey,
            thisNodeId: 'node-b', required: opts.required ?? false, now: opts.now,
        });

    beforeAll(async () => { keys = await generateKeyPair(); other = await generateKeyPair(); });

    it('passes on the node it names, inside the window, once', async () => {
        const s = signed(1);
        const p = await deliveryProof(keys.privateKey, s, 'node-b');
        expect(typeof p.sent_at).toBe('string');
        expect(await check(s, p)).toBeNull();
        expect((await check(s, p))?.code).toBe('REPLAYED');
    });

    it('is refused when sent more than five minutes ago', async () => {
        const s = signed(2);
        const p = await deliveryProof(keys.privateKey, s, 'node-b', new Date(Date.now() - 10 * 60_000).toISOString());
        expect((await check(s, p))?.code).toBe('STALE_TIMESTAMP');
    });

    it('is refused on a node it does not name, whatever the setting', async () => {
        const s = signed(3);
        const p = await deliveryProof(keys.privateKey, s, 'node-c');
        expect((await check(s, p))?.code).toBe('WRONG_AUDIENCE');
        expect((await check(s, p, { required: true }))?.code).toBe('WRONG_AUDIENCE');
    });

    it('is refused when the proof is not the sending node\'s, covers another message, or moves the send time', async () => {
        const s = signed(4);
        expect((await check(s, await deliveryProof(other.privateKey, s, 'node-b')))?.code).toBe('UNAUTHORIZED');
        expect((await check(s, await deliveryProof(keys.privateKey, `${s} `, 'node-b')))?.code).toBe('UNAUTHORIZED');
        const p = await deliveryProof(keys.privateKey, s, 'node-b');
        expect((await check(s, { ...p, sent_at: new Date(Date.now() + 1000).toISOString() }))?.code).toBe('UNAUTHORIZED');
        expect((await check(s, { audience: 'node-b' }))?.code).toBe('UNAUTHORIZED');
    });

    it('an A7 audience proof does not pass as a delivery proof', async () => {
        const s = signed(5);
        const a7 = await audienceProof(keys.privateKey, s, 'node-b');
        expect((await check(s, { ...a7, sent_at: new Date().toISOString() }))?.code).toBe('UNAUTHORIZED');
    });

    it('a delivery that carries none passes while not required, and is AUDIENCE_REQUIRED when required', async () => {
        expect(await check(signed(6), {})).toBeNull();
        expect((await check(signed(6), {}, { required: true }))?.code).toBe('AUDIENCE_REQUIRED');
    });
});

// secaudit 2026-10-10 I21: the proof is a second signature beside the message's own, so stripping it
// left a message that still verified and passed while the setting was off. A peer that has once sent a
// verified proof is pinned, and from then on one without the proof is refused whatever the setting.
describe('the pin: a peer that has sent the proof is held to it', () => {
    let keys: { publicKey: string; privateKey: string };
    const signed = (n: number) => JSON.stringify({ source_node: 'node-p', key: `pin${n}`, value: n, version: 1, timestamp: '2026-01-01T00:00:00.000Z' });
    const memoryPin = (at: string | null = null): ProofPin & { writes: string[] } => {
        const pin = { at, writes: [] as string[], set: async (when: string) => { pin.at = when; pin.writes.push(when); } };
        return pin;
    };
    const run = (pin: ProofPin, s: string, body: Record<string, unknown>) =>
        pinnedRefusal(pin, body, provenSince => deliveryRefusal({
            sourceNode: 'node-p', signed: s, body, publicKey: keys.publicKey, thisNodeId: 'node-b', required: false, provenSince,
        }));

    beforeAll(async () => { keys = await generateKeyPair(); });

    it('a peer that never sent a proof is heard without one, and is not pinned', async () => {
        const pin = memoryPin();
        expect(await run(pin, signed(1), {})).toBeNull();
        expect(pin.at).toBeNull();
        expect(pin.writes).toHaveLength(0);
    });

    it('the first verified proof pins the peer, and a delivery without the proof is then refused', async () => {
        const pin = memoryPin();
        const s = signed(2);
        expect(await run(pin, s, await deliveryProof(keys.privateKey, s, 'node-b'))).toBeNull();
        expect(typeof pin.at).toBe('string');
        expect(pin.writes).toHaveLength(1);
        // The same message with the three proof fields stripped: its own signature still verifies.
        const stripped = await run(pin, signed(3), {});
        expect(stripped?.code).toBe('AUDIENCE_REQUIRED');
        expect(stripped?.status).toBe(401);
    });

    it('a refused proof does not pin', async () => {
        const pin = memoryPin();
        const s = signed(4);
        expect((await run(pin, s, await deliveryProof(keys.privateKey, s, 'node-c')))?.code).toBe('WRONG_AUDIENCE');
        expect(pin.at).toBeNull();
    });

    it('the pin holds for the A7 audience proof too', async () => {
        const s = signed(5);
        const refusal = await audienceRefusal({
            signed: s, audience: undefined, audienceSignature: undefined, publicKey: keys.publicKey,
            thisNodeId: 'node-b', required: false, provenSince: '2026-10-10T00:00:00.000Z',
        });
        expect(refusal?.code).toBe('AUDIENCE_REQUIRED');
        expect(await audienceRefusal({
            signed: s, audience: undefined, audienceSignature: undefined, publicKey: keys.publicKey, thisNodeId: 'node-b', required: false,
        })).toBeNull();
    });

    it('carriesProof sees any one of the three fields', () => {
        expect(carriesProof({})).toBe(false);
        expect(carriesProof({ audience: '' })).toBe(false);
        expect(carriesProof({ sent_at: 'x' })).toBe(true);
        expect(carriesProof({ audience_signature: 'x' })).toBe(true);
    });

    it('the refusal of an unproven message names both versions', async () => {
        const r = await deliveryRefusal({
            sourceNode: 'node-p', signed: signed(6), body: {}, publicKey: keys.publicKey, thisNodeId: 'node-b', required: true,
        });
        expect(r?.message).toContain(AUDIENCE_REQUIRED_BY_DEFAULT_IN);
        expect(r?.message).toContain(UNPROVEN_FORMAT_REMOVED_IN);
    });
});

// secaudit 2026-10-10 I22: the 3.27.0 default was a comment only.
describe('the audience default follows the version', () => {
    it('names 3.27.0 and 4.0.0', () => {
        expect(AUDIENCE_REQUIRED_BY_DEFAULT_IN).toBe('3.27.0');
        expect(UNPROVEN_FORMAT_REMOVED_IN).toBe('4.0.0');
    });

    it('is off before 3.27.0 and on from it', () => {
        expect(audienceRequiredByDefault('3.25.0')).toBe(false);
        expect(audienceRequiredByDefault('3.26.9')).toBe(false);
        expect(audienceRequiredByDefault('3.27.0')).toBe(true);
        expect(audienceRequiredByDefault('3.28.1')).toBe(true);
        expect(audienceRequiredByDefault('4.0.0')).toBe(true);
        expect(audienceRequiredByDefault('unknown')).toBe(false);
    });

    it('is off on the running version (3.25.0), and the environment wins either way', () => {
        const saved = process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED;
        try {
            delete process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED;
            expect(federationDefaults().federationAudienceRequired).toBe(audienceRequiredByDefault());
            expect(audienceRequiredByDefault()).toBe(false);
            process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED = 'true';
            expect(federationDefaults().federationAudienceRequired).toBe(true);
            process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED = 'false';
            expect(federationDefaults().federationAudienceRequired).toBe(false);
            // And loadConfig() carries it: config.ts no longer reads the variable itself.
            const noFile = join(tmpdir(), `aimeat-no-config-${process.pid}.ini`);
            delete process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED;
            expect(loadConfig({ configPath: noFile }).config.federationAudienceRequired).toBe(audienceRequiredByDefault());
            process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED = 'true';
            expect(loadConfig({ configPath: noFile }).config.federationAudienceRequired).toBe(true);
        } finally {
            if (saved === undefined) delete process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED;
            else process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED = saved;
        }
    });
});

// secaudit 2026-10-10 I7: the pending-peer adoption checks the signature before it writes, and must
// leave the nonce for the check that follows.
describe('nodeRequestSignedBy', () => {
    it('answers whether the headers are signed with the key, and does not take the nonce', async () => {
        const keys = await generateKeyPair();
        const fields = { purpose: 'package', group_id: '*' };
        const headers = await signNodeRequest(
            { getNodeKey: async () => keys } as unknown as Parameters<typeof signNodeRequest>[0],
            { nodeId: 'node-a' }, 'node-b', fields,
        );
        expect(await nodeRequestSignedBy(headers, { thisNodeId: 'node-b', fields, publicKey: keys.publicKey })).toBe(true);
        expect(await nodeRequestSignedBy(headers, { thisNodeId: 'node-b', fields, publicKey: (await generateKeyPair()).publicKey })).toBe(false);
        expect(await nodeRequestSignedBy(headers, { thisNodeId: 'node-c', fields, publicKey: keys.publicKey })).toBe(false);
        expect(await nodeRequestSignedBy({ 'x-source-node': 'node-a' }, { thisNodeId: 'node-b', fields, publicKey: keys.publicKey })).toBe(false);
        // The nonce is still unused: the full check passes once after it.
        const full = await checkNodeRequest(headers, {
            thisNodeId: 'node-b', fields, keyOf: () => ({ publicKey: keys.publicKey }), missingMessage: 'm', badSignatureMessage: 'b',
        });
        expect(full.ok).toBe(true);
    });
});
