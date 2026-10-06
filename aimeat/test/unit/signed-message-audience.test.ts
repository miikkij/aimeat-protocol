/**
 * @file test/unit/signed-message-audience.test.ts
 * @description audienceProof and audienceRefusal (services/signed-node-request.ts): an older-format
 *   federation message names the node it is for with a second signature. It passes on the node it
 *   names, is refused on any other, and a message that names none passes only while the node does not
 *   require an audience (secaudit 2026-10 follow-up, A7).
 * @usage pnpm test -- signed-message-audience
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 follow-up, A7).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { audienceProof, audienceRefusal } from '../../src/services/signed-node-request.js';

describe('an older-format message names the node it is for', () => {
    let keys: { publicKey: string; privateKey: string };
    let other: { publicKey: string; privateKey: string };
    const signed = JSON.stringify({ source_node: 'node-a', message: { body: 'hi' }, timestamp: '2026-10-06T12:00:00.000Z' });
    const check = (audience: unknown, audienceSignature: unknown, required = false, publicKey = keys.publicKey) =>
        audienceRefusal({ signed, audience, audienceSignature, publicKey, thisNodeId: 'node-b', required });

    beforeAll(async () => { keys = await generateKeyPair(); other = await generateKeyPair(); });

    it('passes on the node it names', async () => {
        const p = await audienceProof(keys.privateKey, signed, 'node-b');
        expect(await check(p.audience, p.audience_signature)).toBeNull();
    });

    it('is refused on a node it does not name, whatever the setting', async () => {
        const p = await audienceProof(keys.privateKey, signed, 'node-c');
        expect((await check(p.audience, p.audience_signature))?.code).toBe('WRONG_AUDIENCE');
        expect((await check(p.audience, p.audience_signature, true))?.code).toBe('WRONG_AUDIENCE');
    });

    it('is refused when the audience is not signed by the sending node, or covers another message', async () => {
        const byOther = await audienceProof(other.privateKey, signed, 'node-b');
        expect((await check(byOther.audience, byOther.audience_signature))?.code).toBe('UNAUTHORIZED');
        const forAnother = await audienceProof(keys.privateKey, `${signed} `, 'node-b');
        expect((await check(forAnother.audience, forAnother.audience_signature))?.code).toBe('UNAUTHORIZED');
        expect((await check('node-b', undefined))?.code).toBe('UNAUTHORIZED');
    });

    it('a message that names none passes while not required, and is AUDIENCE_REQUIRED when required', async () => {
        expect(await check(undefined, undefined)).toBeNull();
        expect((await check(undefined, undefined, true))?.code).toBe('AUDIENCE_REQUIRED');
    });
});
