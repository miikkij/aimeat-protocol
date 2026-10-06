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
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 last items, D3).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { audienceProof, deliveryProof, deliveryRefusal } from '../../src/services/signed-node-request.js';

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
