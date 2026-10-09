/**
 * @file test/unit/perf-trace-log.test.ts
 * @description The perf-trace log line names the request path and never its query string, which can
 *   carry a credential (?ticket=, ?code=, the deprecated ?token=). Secrets audit 2026-10-09, d3/d8:
 *   perf-trace.ts logged req.originalUrl.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

const info = vi.fn();
vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: (...a: unknown[]) => info(...a), error: vi.fn(), debug: vi.fn() },
}));

import { perfTraceMiddleware } from '../../src/services/perf-trace.js';

describe('perfTraceMiddleware log line', () => {
  it('logs the path without the query string', () => {
    const secret = 'eyJ-canary-session-token-7f3a';
    const req = {
      method: 'GET',
      path: '/v1/memory',
      originalUrl: `/v1/memory?trace=1&token=${secret}`,
      query: { trace: '1', token: secret },
      headers: {},
    } as unknown as Request;
    const res = Object.assign(new EventEmitter(), {
      headersSent: false,
      writeHead: () => res,
      setHeader: () => undefined,
    }) as unknown as Response & EventEmitter;

    perfTraceMiddleware(true)(req, res, () => undefined);
    res.emit('finish');

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain('GET /v1/memory');
    expect(line).not.toContain(secret);
    expect(line).not.toContain('?');
  });
});
