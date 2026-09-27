/**
 * @file serve-secretless-caller-follows-the-release.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A caller of the serve daemon that sends no secret, held to the release it ships in.
 *
 *   A daemon older than SECRETLESS_CALLER_REFUSED_FROM lets such a caller in and names it in its log,
 *   once per caller per start, so that a runtime which does not send the secret yet keeps working
 *   while it updates. From that release the daemon refuses it. The daemon reads its own version, so
 *   the refusal needs no code change when the release comes. The grace itself is dead code from that
 *   release on, so the last describe here reads the version the package reports and fails once it
 *   reaches that release while the grace is still written in. When that release is the first one on
 *   npm with the serve secret, no published release had the grace, and the failure says to move the
 *   refusing release one release later instead.
 *
 *   The admission middleware runs here in a small Express app on 127.0.0.1, given a version and a
 *   log of its own. serve-loopback-admission.test.ts runs the real daemon at the real version. Raw
 *   `node:http`, because fetch does not send a Host header of the caller's choosing.
 * @structure the grace release · the refusing release · a version it cannot read · the tripwire
 * @usage cd aimeat && pnpm exec vitest run test/unit/serve-secretless-caller-follows-the-release.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  admitLoopbackCaller, LOOPBACK_REFUSAL, SECRETLESS_CALLER_REFUSED_FROM, LEGACY_PLACEHOLDER_BEARER,
  MAX_SECRETLESS_CALLERS_NAMED,
} from '../../src/cli/connect/mcp/local-admission.js';
import { CONNECT_HELP_TEXT } from '../../src/index-help.js';
import { compareVersions } from '../../src/services/federation-overview.js';
import { getSoftwareVersion } from '../../src/utils/version.js';

const SECRET = 'this-start-secret-0123456789abcdefghijklmnop';
/** The release that brought the secret. It lets a caller without it in. */
const GRACE_RELEASE = '3.19.0';
const VERSION = getSoftwareVersion();
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** Where a person reads which release refuses a caller without the secret. */
const DOCS = [
  join(REPO, 'docs', 'connector-forward-tunnel.md'),
  join(REPO, 'docs', 'integrations', 'crewai.md'),
  join(REPO, 'python', 'aimeat-crewai', 'README.md'),
];

interface Daemon { port: number; log: string[]; close: () => Promise<void> }

/** The admission in front of a route that answers 200, the way the daemon mounts it, at `version`. */
async function daemonAt(version: string): Promise<Daemon> {
  const log: string[] = [];
  const app = express();
  app.use(admitLoopbackCaller(SECRET, { version, warn: line => { log.push(line); } }));
  app.use((_req, res) => { res.json({ ok: true }); });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { port, log, close: () => new Promise((resolve) => { server.close(() => resolve()); }) };
}

interface Answer { status: number; code?: string }

/** One request with exactly these headers. Node sends the Host header it is given. */
function call(port: number, method: string, path: string, headers: Record<string, string>): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { connection: 'close', ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => {
        let code: string | undefined;
        try { code = (JSON.parse(text) as { error?: { code?: string } }).error?.code; } catch { code = undefined; }
        resolve({ status: res.statusCode ?? 0, code });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** What a crew runtime that does not send the secret yet sends: the agent it acts as, and its program. */
const crew = (port: number) => ({
  host: `127.0.0.1:${port}`, 'x-aimeat-agent': 'loopbot', 'user-agent': 'python-requests/2.32.3',
});

describe(`a caller without the secret, at ${GRACE_RELEASE}`, () => {
  let d: Daemon;
  beforeAll(async () => { d = await daemonAt(GRACE_RELEASE); });
  afterAll(async () => { await d.close(); });

  it('is let in, and the log names it once: the agent, the program and the first request', async () => {
    expect((await call(d.port, 'GET', '/local/status', crew(d.port))).status).toBe(200);
    expect(d.log).toHaveLength(1);
    expect(d.log[0]).toContain('"loopbot"');
    expect(d.log[0]).toContain('"python-requests/2.32.3"');
    expect(d.log[0]).toContain('GET /local/status');
    expect(d.log[0]).toContain(SECRETLESS_CALLER_REFUSED_FROM);
  });

  it('is not named again when the same caller calls again, at any endpoint', async () => {
    const before = d.log.length;
    expect((await call(d.port, 'GET', '/v1/memory', crew(d.port))).status).toBe(200);
    expect((await call(d.port, 'POST', '/local/call/aimeat_memory_list', crew(d.port))).status).toBe(200);
    expect((await call(d.port, 'GET', '/local/status', crew(d.port))).status).toBe(200);
    expect(d.log.length).toBe(before);
  });

  it('names each other caller once: another agent, or another program for the same agent', async () => {
    const before = d.log.length;
    const other = { ...crew(d.port), 'x-aimeat-agent': 'otherbot' };
    const probe = { ...crew(d.port), 'user-agent': 'Python-urllib/3.12' };
    for (const headers of [other, probe, other, probe]) {
      expect((await call(d.port, 'GET', '/local/status', headers)).status).toBe(200);
    }
    expect(d.log.length - before).toBe(2);
  });

  it(`takes the placeholder bearer aimeat-crewai sent before 0.29.0 for no secret`, async () => {
    const before = d.log.length;
    const session = {
      ...crew(d.port), 'user-agent': 'python-httpx/0.28.1', authorization: `Bearer ${LEGACY_PLACEHOLDER_BEARER}`,
    };
    expect((await call(d.port, 'POST', '/v1/mcp', session)).status).toBe(200);
    expect(d.log.length - before).toBe(1);
    expect(d.log.at(-1)).toContain(LEGACY_PLACEHOLDER_BEARER);
  });

  it('refuses a wrong secret with 401 and names nobody', async () => {
    const before = d.log.length;
    for (const [method, path] of [['GET', '/local/status'], ['POST', '/local/shutdown']]) {
      const r = await call(d.port, method, path, { ...crew(d.port), authorization: 'Bearer not-the-secret' });
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.code).toBe(LOOPBACK_REFUSAL.secret);
    }
    const noScheme = await call(d.port, 'GET', '/local/status', { ...crew(d.port), authorization: SECRET });
    expect(noScheme.status).toBe(401);
    expect(d.log.length).toBe(before);
  });

  it('refuses a foreign Host and a request with an Origin with 403, and names nobody', async () => {
    const before = d.log.length;
    const rebound = await call(d.port, 'GET', '/local/status', { ...crew(d.port), host: `rebind.attacker.example:${d.port}` });
    expect(rebound.status).toBe(403);
    expect(rebound.code).toBe(LOOPBACK_REFUSAL.host);
    const otherPort = await call(d.port, 'GET', '/local/status', { ...crew(d.port), host: `127.0.0.1:${d.port + 1}` });
    expect(otherPort.status).toBe(403);
    const page = await call(d.port, 'POST', '/local/shutdown', { ...crew(d.port), origin: 'https://evil.example' });
    expect(page.status).toBe(403);
    expect(page.code).toBe(LOOPBACK_REFUSAL.origin);
    expect(d.log.length).toBe(before);
  });

  it('answers a caller that sends the secret, and names nobody', async () => {
    const before = d.log.length;
    const r = await call(d.port, 'GET', '/local/status', { ...crew(d.port), authorization: `Bearer ${SECRET}` });
    expect(r.status).toBe(200);
    expect(d.log.length).toBe(before);
  });

  it('keeps what a caller typed on one line of the log', async () => {
    const before = d.log.length;
    // With no header naming an agent the daemon reads `?agent=`, and a query string can carry a line break.
    const path = '/local/tasks/next?agent=forged%0A%5Bserve%5D%20all%20is%20well';
    expect((await call(d.port, 'GET', path, { host: `127.0.0.1:${d.port}`, 'user-agent': 'one-line' })).status).toBe(200);
    expect(d.log.length - before).toBe(1);
    const line = d.log.at(-1) ?? '';
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain('"forged?[serve] all is well"');
    expect(line).toContain('GET /local/tasks/next');
    expect(line).not.toContain('?agent=');
  });

  it(`names at most ${MAX_SECRETLESS_CALLERS_NAMED} callers in one start, then says once that it names no more`, async () => {
    const fresh = await daemonAt(GRACE_RELEASE);
    try {
      for (let i = 0; i < MAX_SECRETLESS_CALLERS_NAMED + 5; i++) {
        const r = await call(fresh.port, 'GET', '/local/status', { host: `127.0.0.1:${fresh.port}`, 'user-agent': `caller-${i}` });
        expect(r.status).toBe(200);
      }
      expect(fresh.log).toHaveLength(MAX_SECRETLESS_CALLERS_NAMED + 1);
      expect(fresh.log.at(-1)).not.toContain('caller-');
    } finally {
      await fresh.close();
    }
  });
});

describe(`a caller without the secret, from ${SECRETLESS_CALLER_REFUSED_FROM}`, () => {
  let d: Daemon;
  beforeAll(async () => { d = await daemonAt(SECRETLESS_CALLER_REFUSED_FROM); });
  afterAll(async () => { await d.close(); });

  it('is refused with 401 at every endpoint, the placeholder bearer too, and the log names nobody', async () => {
    const endpoints: Array<[string, string]> = [
      ['GET', '/local/status'], ['GET', '/v1/memory'], ['POST', '/local/call/aimeat_memory_list'],
      ['POST', '/v1/mcp'], ['POST', '/local/shutdown'],
    ];
    for (const [method, path] of endpoints) {
      const r = await call(d.port, method, path, crew(d.port));
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.code).toBe(LOOPBACK_REFUSAL.secret);
    }
    const placeholder = await call(d.port, 'POST', '/v1/mcp', { ...crew(d.port), authorization: `Bearer ${LEGACY_PLACEHOLDER_BEARER}` });
    expect(placeholder.status).toBe(401);
    expect(d.log).toHaveLength(0);
  });

  it('refuses a wrong secret and answers the right one', async () => {
    expect((await call(d.port, 'GET', '/local/status', { ...crew(d.port), authorization: 'Bearer not-the-secret' })).status).toBe(401);
    expect((await call(d.port, 'GET', '/local/status', { ...crew(d.port), authorization: `Bearer ${SECRET}` })).status).toBe(200);
  });
});

describe('a daemon that cannot read its own version', () => {
  it('lets no caller in without the secret', async () => {
    const d = await daemonAt('unknown');
    try {
      const r = await call(d.port, 'GET', '/local/status', crew(d.port));
      expect(r.status).toBe(401);
      expect(d.log).toHaveLength(0);
    } finally {
      await d.close();
    }
  });
});

describe(`the grace at the version this package reports (${VERSION})`, () => {
  it(`is written in only below ${SECRETLESS_CALLER_REFUSED_FROM}`, () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(
      compareVersions(VERSION, SECRETLESS_CALLER_REFUSED_FROM),
      `package.json is ${VERSION}, and from ${SECRETLESS_CALLER_REFUSED_FROM} the daemon refuses a caller without `
      + 'the secret. '
      + `If npm has no release with the serve secret yet (\`npm view aimeat version\` prints a version below ${GRACE_RELEASE}), `
      + 'this release is the first one with it and no published release has let such a caller in: move '
      + 'SECRETLESS_CALLER_REFUSED_FROM in src/cli/connect/mcp/local-admission.ts to the release after this one, '
      + 'with the release numbers where the grace is described (the help text, the docs this file names, '
      + 'security/field-reach-exemptions.json), and keep the relay-claim versions in src/services/relay-claim-policy.ts, '
      + 'because the relay claim has been on npm since 3.12.0. '
      + 'Otherwise the grace is dead code. Remove it: in src/cli/connect/mcp/local-admission.ts '
      + 'the release constant, the placeholder bearer, the caller log and the branch that lets such a caller in; '
      + 'this file; the version check in serve-loopback-admission.test.ts and e2e-connect-serve-loopback.ts; '
      + 'its entry in security/field-reach-exemptions.json; and the sentences about the grace in the docs '
      + 'this file names.',
    ).toBe(-1);
  });

  it('names the refusing release where a person reads about the secret', () => {
    expect(CONNECT_HELP_TEXT).toContain(SECRETLESS_CALLER_REFUSED_FROM);
    for (const file of DOCS) expect(readFileSync(file, 'utf8'), file).toContain(SECRETLESS_CALLER_REFUSED_FROM);
  });
});
