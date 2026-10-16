/**
 * @file test/unit/request-id-log-context.test.ts
 * @description One request id for the X-Request-Id header, the envelope's request_id and the log
 *   lines; the caller on every log line written after authentication; a client id of an unsafe shape
 *   replaced (QA audit E1-05, F5-09, E3-07). And the response recorder: a 401 or 403 a route answers
 *   itself reaches the refusal log once, a refusal auth/deny.ts wrote is not written twice, a 200
 *   writes nothing (QA audit S1-02, E2-07).
 * @usage cd aimeat && pnpm exec vitest run test/unit/request-id-log-context.test.ts
 * @version-history
 *   2026-10-16 — Initial (QA audit E1-05, F5-09, E3-07, S1-02, E2-07).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import winston from 'winston';
import { logger } from '../../src/utils/logger.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { refusalRecorder } from '../../src/middleware/refusal-recorder.js';
import { error, success } from '../../src/middleware/envelope.js';
import { deny401 } from '../../src/auth/deny.js';
import { configureAuthAuditForTest } from '../../src/services/auth-audit.js';

const lines: string[] = [];
const sink = new PassThrough();
sink.on('data', (chunk: Buffer) => { for (const l of chunk.toString('utf8').split('\n')) if (l) lines.push(l); });
const transport = new winston.transports.Stream({ stream: sink, format: winston.format.json() });

const dir = mkdtempSync(join(tmpdir(), 'aimeat-refusal-'));
const LOG = join(dir, 'auth-failures.log');
let server: http.Server;
let levelBefore = 'info';
let base = '';

beforeAll(async () => {
  // The lines asserted here are warn and error; a run with a quieter AIMEAT_LOG_LEVEL must not hide them.
  levelBefore = logger.level;
  logger.level = 'info';
  logger.add(transport);
  configureAuthAuditForTest(LOG, 1_000_000);
  const app = express();
  app.use(requestIdMiddleware());
  app.use(refusalRecorder());
  // Stands in for optionalAuth/requireAuth: req.auth is set AFTER the log context opened.
  app.use((req, _res, next) => {
    if (req.headers.authorization === 'Bearer agent') {
      req.auth = { sub: 'claude#alice@node-t', owner: 'alice', node: 'node-t', roles: ['agent'], scopes: [] } as never;
    }
    next();
  });
  app.get('/refuse', (_req, res) => {
    logger.warn('probe: ownership refused in the handler');
    res.status(403).json(error('node-t', 'FORBIDDEN', 'That record belongs to someone else.'));
  });
  app.get('/deny', (req, res) => { deny401(req, res, 'probe: no credential'); });
  app.get('/ok', (_req, res) => { res.json(success('node-t', { fine: true })); });
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  logger.remove(transport);
  logger.level = levelBefore;
  configureAuthAuditForTest('', 0);
  server?.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
  rmSync(dir, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setTimeout(r, 30));
const refusalLines = (): Array<Record<string, unknown>> =>
  existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];

describe('one request id, and the caller on the log line', () => {
  it('header, envelope and log line carry the same id, and the line names the caller', async () => {
    lines.length = 0;
    const res = await fetch(`${base}/refuse`, { headers: { Authorization: 'Bearer agent' } });
    const body = await res.json() as { request_id: string };
    await tick();
    const header = res.headers.get('x-request-id');
    expect(header).toMatch(/^req-/);
    expect(body.request_id).toBe(header);
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => String(l.message).startsWith('probe: ownership'));
    expect(line?.requestId).toBe(header);
    expect(line?.gaii).toBe('claude#alice@node-t');
  });

  it('a client id of a safe shape is used everywhere', async () => {
    const res = await fetch(`${base}/refuse`, { headers: { 'X-Request-Id': 'trace-abc_123:1' } });
    const body = await res.json() as { request_id: string };
    expect(res.headers.get('x-request-id')).toBe('trace-abc_123:1');
    expect(body.request_id).toBe('trace-abc_123:1');
  });

  it('an empty or unsafe client id is replaced with a node-made one', async () => {
    for (const sent of ['', 'two words', 'x'.repeat(200)]) {
      const res = await fetch(`${base}/ok`, { headers: { 'X-Request-Id': sent } });
      const body = await res.json() as { request_id: string };
      const header = res.headers.get('x-request-id');
      expect(header).toMatch(/^req-/);
      expect(body.request_id).toBe(header);
    }
  });
});

describe('the response recorder writes every refusal once', () => {
  it('a 403 answered inside a handler reaches the refusal log with its code and sentence', async () => {
    const before = refusalLines().length;
    await fetch(`${base}/refuse`, { headers: { Authorization: 'Bearer agent' } });
    await tick();
    const added = refusalLines().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe(403);
    expect(added[0].code).toBe('FORBIDDEN');
    expect(added[0].reason).toBe('That record belongs to someone else.');
    expect(added[0].path).toBe('/refuse');
  });

  it('a refusal auth/deny.ts wrote is not written a second time', async () => {
    const before = refusalLines().length;
    await fetch(`${base}/deny`);
    await tick();
    const added = refusalLines().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].code).toBe('AUTH_REQUIRED');
  });

  it('a 200 writes nothing', async () => {
    const before = refusalLines().length;
    await fetch(`${base}/ok`);
    await tick();
    expect(refusalLines().length).toBe(before);
  });
});
