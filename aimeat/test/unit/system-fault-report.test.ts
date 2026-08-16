/**
 * @file test/unit/system-fault-report.test.ts
 * @description What counts as the node's own fault, and what must never be reported as one.
 *
 *   The channel only works if it stays readable. Report too little and the operators learn nothing;
 *   report a caller's mistake and the inbox fills with people getting calls wrong, which buries the
 *   one message that mattered. So the decision is tested directly rather than inferred from a
 *   route's behaviour.
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { describe, it, expect, vi } from 'vitest';
import { FAULT_CODES, SYSTEM_FAULT_REPLY } from '../../src/services/system-fault-report.js';
import { systemFaultReporter } from '../../src/middleware/system-fault.js';

/**
 * Drive the middleware the way express does and return the ORIGINAL res.json spy.
 *
 * The middleware replaces res.json with its own wrapper, so asserting on `res.json` afterwards
 * asserts on the wrapper and not on the spy. The reference has to be kept before it is swapped —
 * which is also the shape of the thing being tested: the caller's answer must come out the far side
 * unchanged.
 */
function runThrough(envelope: unknown) {
    const spy = vi.fn((b: unknown) => b);
    const storage = { listOwners: async () => ({ owners: [], total: 0 }) } as never;
    const config = { nodeId: 'unit-node' } as never;
    const res = { json: spy } as unknown as { json: (b: unknown) => unknown };
    const req = { method: 'GET', path: '/v1/thing', route: { path: '/v1/thing' } } as never;
    systemFaultReporter(config, storage)(req, res as never, () => { /* next */ });
    res.json(envelope);
    return spy;
}

describe('what the node reports as its own fault', () => {
    it('reports the codes that mean WE broke', () => {
        for (const code of ['INTERNAL_ERROR', 'INTERNAL', 'UPDATE_FAILED', 'IMPORT_FAILED']) {
            expect(FAULT_CODES.has(code), `${code} is the node failing and must be reported`).toBe(true);
        }
    });

    it('never reports a caller getting the call wrong', () => {
        // Every one of these is the system WORKING. A missing field, a refused permission and a name
        // already taken are answers, not failures, and 1600 of the 2107 user-visible messages are of
        // this kind — reporting them would drown the ~120 that are ours.
        for (const code of [
            'NOT_FOUND', 'INVALID_INPUT', 'VALIDATION_ERROR', 'BAD_REQUEST', 'INVALID_BODY',
            'FORBIDDEN', 'ACCESS_DENIED', 'UNAUTHORIZED', 'AUTH_REQUIRED', 'SCOPE_DENIED',
            'QUOTA_EXCEEDED', 'NAME_TAKEN', 'CONFLICT', 'INVALID_STATE', 'EXPIRED',
        ]) {
            expect(FAULT_CODES.has(code), `${code} is the caller's business, not an operator's`).toBe(false);
        }
    });

    it('stays short — a long list is how this stops being read', () => {
        expect(FAULT_CODES.size).toBeLessThanOrEqual(10);
    });
});

describe('the one place that notices — it must not change what the caller gets', () => {
    it('passes the response through untouched', async () => {
        const envelope = { ok: false, request_id: 'req-1', error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } };
        const originalJson = runThrough(envelope);
        // The user's answer is the point. Reporting rides alongside it and never alters or delays it.
        expect(originalJson).toHaveBeenCalledWith(envelope);
        await new Promise(r => setTimeout(r, 0));
    });

    it('leaves a successful response alone', async () => {
        const ok = { ok: true, data: { fine: true } };
        const originalJson = runThrough(ok);
        expect(originalJson).toHaveBeenCalledWith(ok);
        await new Promise(r => setTimeout(r, 0));
    });
});

describe('what an operator says back, when they answer at all', () => {
    it('says the three things and none of them is a request for more information', () => {
        expect(SYSTEM_FAULT_REPLY).toMatch(/not caused by anything you did/i);
        expect(SYSTEM_FAULT_REPLY).toMatch(/being corrected/i);
        expect(SYSTEM_FAULT_REPLY).toMatch(/thank you/i);
        // The person already gave us everything by hitting it. Asking them to reproduce it, describe
        // it or check something is the work this whole path exists to take off them.
        expect(SYSTEM_FAULT_REPLY).not.toMatch(/could you|please (try|send|describe|check)|steps to reproduce/i);
    });
});
