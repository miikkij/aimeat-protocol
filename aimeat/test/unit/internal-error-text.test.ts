/**
 * @file test/unit/internal-error-text.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A 500 answer whose code means the node failed carries a sentence and the request id,
 *   never the exception text, and the fault report the operator receives carries what the caller saw.
 *   Secrets audit 2026-10-09, 07-side-channels d4: 76 route handlers answered a 500 with
 *   err.message or String(err), and the fault report forwarded the same text to the operator's inbox.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit, finding d4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<{ body: string }> = [];
vi.mock('../../src/services/message-send.js', () => ({
  sendDirectMessage: vi.fn(async (_deps: unknown, msg: { body: string }) => { sent.push(msg); return {}; }),
}));
vi.mock('../../src/services/operators.js', () => ({
  findOperatorGhii: vi.fn(async () => 'operator@unit-node'),
}));

const { reportSystemFault } = await import('../../src/services/system-fault-report.js');
const { systemFaultReporter } = await import('../../src/middleware/system-fault.js');
const { hideInternalErrorText, keepErrorMessage } = await import('../../src/middleware/internal-error-text.js');

const CANARY = 'CANARYq8Zt4Lm1';

/** Mount both wrappers in the order server.ts mounts them and answer what reached the wire. */
function answer(status: number, envelope: object): unknown {
  const wire = vi.fn((b: unknown) => b);
  const res = { statusCode: status, json: wire } as unknown as { statusCode: number; json: (b: unknown) => unknown };
  const req = { method: 'GET', path: `/v1/thing/${status}`, route: { path: `/v1/thing/${status}-${Math.random()}` } } as never;
  const deps = { config: { nodeId: 'unit-node' } as never, storage: {} as never };
  systemFaultReporter(deps.config, deps.storage)(req, res as never, () => { /* next */ });
  hideInternalErrorText()(req, res as never, () => { /* next */ });
  res.json(envelope);
  return wire.mock.calls[0][0];
}

const raw = (code: string) => ({ ok: false, request_id: 'req-77', error: { code, message: `TypeError: keyword.toLowerCase is not a function at ${CANARY}` } });

describe('a 500 that means the node failed', () => {
  beforeEach(() => { sent.length = 0; });

  it('answers a sentence with the request id, keeps the code, and leaves the exception text out', () => {
    const out = answer(500, raw('INTERNAL_ERROR')) as { error: { code: string; message: string } };
    expect(out.error.code).toBe('INTERNAL_ERROR');
    expect(out.error.message).not.toContain(CANARY);
    expect(out.error.message).not.toMatch(/TypeError/);
    expect(out.error.message).toContain('req-77');
  });

  it('covers the _FAILED and _ERROR families as well', () => {
    for (const code of ['INTERNAL', 'UPDATE_FAILED', 'ZIP_ERROR', 'COMMERCE_ERROR']) {
      const out = answer(500, raw(code)) as { error: { message: string } };
      expect(out.error.message, code).not.toContain(CANARY);
    }
  });

  it('sends the operator the sentence the caller saw, not the exception text', async () => {
    answer(500, raw('INTERNAL_ERROR'));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent.length).toBe(1);
    expect(sent[0].body).not.toContain(CANARY);
    expect(sent[0].body).toContain('req-77');
  });
});

describe('what the filter leaves alone', () => {
  it('a 500 the route wrote for the caller, marked keepErrorMessage', () => {
    const env = keepErrorMessage({ ok: false, request_id: 'r', error: { code: 'SETTLEMENT_FAILED', message: 'you were not charged' } });
    expect((answer(500, env) as { error: { message: string } }).error.message).toBe('you were not charged');
  });

  it('a 500 with a code a person acts on', () => {
    const env = { ok: false, error: { code: 'API_LIMIT_EXCEEDED', message: 'Action "x" exceeded API call limit' } };
    expect(answer(500, env)).toEqual(env);
  });

  it('a 502 or 503 with an authored answer', () => {
    const e502 = { ok: false, error: { code: 'PROVIDER_ERROR', message: 'The provider answered HTTP 500.' } };
    const e503 = { ok: false, error: { code: 'ENCRYPTION_NOT_CONFIGURED', message: 'Set AIMEAT_ENCRYPTION_KEY.' } };
    expect(answer(502, e502)).toEqual(e502);
    expect(answer(503, e503)).toEqual(e503);
  });

  it('a success and a 4xx', () => {
    expect(answer(200, { ok: true, data: { x: 1 } })).toEqual({ ok: true, data: { x: 1 } });
    const e400 = { ok: false, error: { code: 'INVALID_INPUT', message: 'field `a` is required' } };
    expect(answer(400, e400)).toEqual(e400);
  });
});

describe('the fault report itself', () => {
  beforeEach(() => { sent.length = 0; });

  it('redacts credential-shaped text in the message it forwards', async () => {
    await reportSystemFault({ storage: {} as never, config: { nodeId: 'unit-node' } as never }, {
      code: 'INTERNAL_ERROR', route: `/v1/report-${Math.random()}`, method: 'POST', requestId: 'req-9',
      shown: `upstream said Bearer ${CANARY}`,
    });
    expect(sent.length).toBe(1);
    expect(sent[0].body).not.toContain(CANARY);
  });
});
