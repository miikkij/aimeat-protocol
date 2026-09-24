/**
 * @file serve-loopback-admission.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may use the serve daemon (secaudit 2026-09, A9-1). It starts the REAL daemon
 *   (`runServeDaemon`) with an empty registry on 127.0.0.1 and sends the requests a stranger would
 *   send: a web page reached through DNS rebinding (a foreign Host), a web page posting across sites
 *   (an Origin header), and any other process on the machine (no secret). Each one must be refused,
 *   and a refusal must not stop the daemon. A caller that read the secret from serve.json, which is
 *   what the CLI, the terminal UI and the Python liaison do, gets through.
 *
 *   Raw `node:http` rather than fetch, because fetch will not send a Host header of the caller's
 *   choosing, and the foreign Host is the one request here that a browser really does make.
 * @usage cd aimeat && pnpm exec vitest run test/unit/serve-loopback-admission.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (secaudit 2026-09, A9-1).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

// THE HOME IS SET BEFORE THE CONNECTOR IS LOADED: config.ts reads AIMEAT_HOME into a module-level
// constant on first import, so the daemon's serve.json lands here and not in the developer's own home.
const home = mkdtempSync(join(tmpdir(), 'aimeat-admission-'));
process.env.AIMEAT_HOME = home;
process.env.AIMEAT_LOG_TIMESTAMPS = '0';

const { runServeDaemon } = await import('../../src/cli/connect/mcp/local-server.js');
const { AgentRegistry } = await import('../../src/cli/connect/agent-registry.js');

interface Answer { status: number; body: { ok?: boolean; data?: { pid?: number }; error?: { code?: string } } | null }

/** One request with exactly these headers. Node sends the Host header it is given. */
function call(port: number, method: string, path: string, headers: Record<string, string>): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { connection: 'close', ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => {
        const parse = (): Answer['body'] => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
        resolve({ status: res.statusCode ?? 0, body: parse() });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const settle = (ms: number) => new Promise(r => setTimeout(r, ms));

// `/local/shutdown` ends in process.exit. Held here, so a shutdown that should not happen shows up
// as a call and not as the test runner disappearing.
const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

let port = 0;
let secret = '';
const own = () => ({ host: `127.0.0.1:${port}`, authorization: `Bearer ${secret}` });

beforeAll(async () => {
  await runServeDaemon({
    registry: new AgentRegistry(),
    buildMcp: () => { throw new Error('no MCP session is opened in this test'); },
  });
  const doc = JSON.parse(readFileSync(join(home, 'serve.json'), 'utf8')) as { port: number; secret?: string };
  port = doc.port;
  secret = String(doc.secret);
});

afterAll(async () => {
  // Stopped the way a client stops it: with the secret. process.exit is held, so the server closes
  // and the test process stays.
  try { await call(port, 'POST', '/local/shutdown', own()); } catch { /* already gone */ }
  await settle(300);
  exit.mockRestore();
  delete process.env.AIMEAT_HOME;
  delete process.env.AIMEAT_LOG_TIMESTAMPS;
  try { rmSync(home, { recursive: true, force: true }); } catch { /* the temp dir outlives the run at worst */ }
});

describe('the serve daemon admits only its own callers (A9-1)', () => {
  it('writes a secret into serve.json at start', () => {
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('refuses a foreign Host with 403, even when the secret is right (DNS rebinding)', async () => {
    const r = await call(port, 'GET', '/local/status', { ...own(), host: `rebind.attacker.example:${port}` });
    expect(r.status).toBe(403);
    expect(r.body?.data).toBeUndefined();
  });

  it('refuses a loopback name for a different port with 403', async () => {
    const r = await call(port, 'GET', '/local/status', { ...own(), host: `127.0.0.1:${port + 1}` });
    expect(r.status).toBe(403);
  });

  it('refuses POST /local/shutdown that carries an Origin with 403, and the daemon stays up', async () => {
    const r = await call(port, 'POST', '/local/shutdown', { ...own(), origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    // The handler stops the daemon 50 ms after it answers; wait past that before asking.
    await settle(200);
    expect(exit).not.toHaveBeenCalled();
    const still = await call(port, 'GET', '/local/status', own());
    expect(still.status).toBe(200);
  });

  it('refuses every door with 401 when the secret is missing or wrong', async () => {
    const doors: Array<[string, string]> = [
      ['GET', '/local/status'],
      ['GET', '/local/stats'],
      ['GET', '/local/tasks/next?wait=0'],
      ['POST', '/local/call/aimeat_memory_list'],
      ['GET', '/v1/memory'],
      ['POST', '/v1/mcp'],
      ['POST', '/local/shutdown'],
    ];
    for (const [method, path] of doors) {
      const none = await call(port, method, path, { host: `127.0.0.1:${port}` });
      expect(none.status, `${method} ${path} with no secret`).toBe(401);
      const wrong = await call(port, method, path, { host: `127.0.0.1:${port}`, authorization: 'Bearer not-the-secret' });
      expect(wrong.status, `${method} ${path} with a wrong secret`).toBe(401);
    }
    await settle(200);
    expect(exit).not.toHaveBeenCalled();
  });

  it('answers a caller that sends the secret from serve.json, by either loopback name', async () => {
    const r = await call(port, 'GET', '/local/status', own());
    expect(r.status).toBe(200);
    expect(r.body?.data?.pid).toBe(process.pid);
    const byName = await call(port, 'GET', '/local/status', { ...own(), host: `localhost:${port}` });
    expect(byName.status).toBe(200);
  });

  it.skipIf(process.platform === 'win32')('keeps serve.json readable by its owner only', () => {
    expect(statSync(join(home, 'serve.json')).mode & 0o077).toBe(0);
  });
});
