/**
 * @file test/unit/x402-facilitator.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two x402 facilitator clients without a network. The real client (httpFacilitator)
 *   was run by nothing automatic: the E2E sweep pins the off-chain double, and the suite that uses
 *   the real one skips itself there (QA audit 2026-10-16, F14a-03). Here its requests and its refusal
 *   of a non-200 answer are pinned with safeFetch replaced, and the double is held to the checks a
 *   real facilitator makes: the amount, the recipient and the single-use nonce.
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit F14a-03).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeFetch = vi.fn();
vi.mock('../../src/utils/url-validator.js', () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));

const { httpFacilitator, testFacilitator } = await import('../../src/commerce/x402-facilitator.js');
type Requirements = Parameters<ReturnType<typeof testFacilitator>['verify']>[1];
type Payload = Parameters<ReturnType<typeof testFacilitator>['verify']>[0];

const requirements: Requirements = {
    scheme: 'exact', network: 'base-sepolia', maxAmountRequired: '1500000', resource: 'https://node.example/x',
    description: 'a service', mimeType: 'application/json', payTo: '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb',
    maxTimeoutSeconds: 60, asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', extra: { name: 'USDC', version: '2' },
};
const proof = (over: Partial<Payload['payload']['authorization']> = {}): Payload => ({
    x402Version: 1, scheme: 'exact', network: 'base-sepolia',
    payload: {
        signature: '0xsig',
        authorization: { from: '0x' + 'a'.repeat(40), to: '0x' + 'b'.repeat(40), value: '1500000', validAfter: '0', validBefore: '9999999999', nonce: '0x01', ...over },
    },
});

describe('httpFacilitator', () => {
    beforeEach(() => safeFetch.mockReset());

    it('posts the x402 v1 envelope to /verify and /settle through safeFetch, and returns the answer', async () => {
        safeFetch.mockResolvedValue(new Response(JSON.stringify({ isValid: true, payer: '0xa' }), { status: 200 }));
        const f = httpFacilitator('https://facilitator.example/');
        const verified = await f.verify(proof(), requirements);
        expect(verified).toEqual({ isValid: true, payer: '0xa' });
        const [url, init] = safeFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://facilitator.example/verify');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ x402Version: 1, paymentPayload: proof(), paymentRequirements: requirements });

        safeFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, transaction: '0xt' }), { status: 200 }));
        await f.settle(proof(), requirements);
        expect((safeFetch.mock.calls[1] as [string])[0]).toBe('https://facilitator.example/settle');
    });

    it('refuses a non-200 answer instead of reading it as a result', async () => {
        safeFetch.mockResolvedValue(new Response('down', { status: 503 }));
        await expect(httpFacilitator('https://facilitator.example').verify(proof(), requirements)).rejects.toThrow(/responded 503/);
    });
});

describe('testFacilitator holds the checks a real facilitator makes', () => {
    it('accepts the exact amount to the seller, once per nonce', async () => {
        const f = testFacilitator();
        expect((await f.verify(proof(), requirements)).isValid).toBe(true);
        expect((await f.settle(proof(), requirements)).success).toBe(true);
        expect((await f.verify(proof(), requirements)).invalidReason).toBe('nonce_already_used');
    });

    it('refuses less than the price', async () => {
        expect(await testFacilitator().verify(proof({ value: '1499999' }), requirements)).toMatchObject({ isValid: false, invalidReason: 'insufficient_value' });
    });

    it('refuses a proof that pays another address (the double checked no recipient before)', async () => {
        const r = await testFacilitator().verify(proof({ to: '0x' + 'c'.repeat(40) }), requirements);
        expect(r.isValid).toBe(false);
        expect(r.invalidReason).toMatch(/recipient/);
    });
});
