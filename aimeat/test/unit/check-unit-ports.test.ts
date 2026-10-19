/**
 * @file test/unit/check-unit-ports.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Proof that `pnpm check:unit-ports` finds a unit test that listens on, connects to or
 *   names as dead a fixed port, on the texts that turned CI red (mcp-node-registry.test.ts before
 *   1b53ec165, mcp-client-invoke.test.ts before 4deb4c3a5), and stays quiet for port 0, a port read
 *   back from the system, a config URL that connects nowhere, a policy refusal and a string fixture.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-unit-ports.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial, with the gate (wish-a-gate-refuses-a-fixed-listen-port-in-a-unit-test).
 */
import { describe, it, expect } from 'vitest';
import { unitPortFindings, compareWithAllowed, allowedKey } from '../../scripts/check-unit-ports.js';

const shapes = (source: string): string[] => unitPortFindings('test/unit/x.test.ts', source).map(f => f.shape);

describe('check:unit-ports findings', () => {
  it('finds the fixed listen port mcp-node-registry.test.ts had before 1b53ec165', () => {
    const old = [
      'const PORT = 40686;',
      'beforeAll(async () => {',
      "  await new Promise<void>((r) => upstream.listen(PORT, '127.0.0.1', () => r()));",
      '});',
    ].join('\n');
    const found = unitPortFindings('test/unit/mcp-node-registry.test.ts', old);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ shape: 'listen-fixed', line: 3 });
  });

  it('finds the dead port mcp-client-invoke.test.ts had before 4deb4c3a5', () => {
    const old = [
      "  it('parks an unreachable server rather than throwing', async () => {",
      "    const storage = new SqliteStorage(':memory:');",
      '    // A port nothing listens on. Loopback is permitted here, so this is a genuine refused',
      '    // connection and not the SSRF guard answering.',
      "    const row = makeRow({ transport: { kind: 'http', url: 'http://127.0.0.1:40693/mcp' } });",
      '  });',
    ].join('\n');
    expect(unitPortFindings('test/unit/mcp-client-invoke.test.ts', old)).toMatchObject([{ shape: 'dead-port', line: 5, text: 'http://127.0.0.1:40693' }]);
  });

  it('finds every other fixed form: a literal, an object port, an unknown expression and a fixed connect', () => {
    expect(shapes('server.listen(40681);')).toEqual(['listen-fixed']);
    expect(shapes("server.listen({ port: 40682, host: '127.0.0.1' });")).toEqual(['listen-fixed']);
    expect(shapes('server.listen(Number(process.env.PORT));')).toEqual(['listen-fixed']);
    expect(shapes('const port = 40683; server.listen({ port });')).toEqual(['listen-fixed']);
    expect(shapes("net.connect(40684, '127.0.0.1');")).toEqual(['connect-fixed']);
    expect(shapes("socket.connect({ port: 40685, host: 'localhost' });")).toEqual(['connect-fixed']);
    expect(shapes("it('the node does not answer', async () => { await probe('http://localhost:40686/x'); });")).toEqual(['dead-port']);
  });

  it('stays quiet for port 0, a port the system picked, a config URL, a policy refusal and a fixture string', () => {
    const fine = [
      "await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));",
      'let PORT = 0;',
      'server.listen(PORT);',
      'server.listen({ host: "127.0.0.1" });',
      'server.listen(() => ready());',
      'server.listen();',
      'const deadPort = (closed.address() as AddressInfo).port;',
      "const row = makeRow({ url: `http://127.0.0.1:${deadPort}/mcp` });",
      "const config = { baseUrl: 'http://localhost:40050' };",
      "it('a remote address is refused', () => { owner({ baseUrl: 'http://127.0.0.1:1234/v1' }); });",
      "it('the forms list says Ctrl+C when copying is refused', () => { expect(t).toBe('http://localhost:40050/?form=x'); });",
      "const fixture = 'server.listen(40686)';",
      '// upstream.listen(40686) was the old code',
      "it('is unreachable on a privileged port', () => { probe('http://127.0.0.1:1/x'); });",
      'client.connect(transport);',
    ].join('\n');
    expect(unitPortFindings('test/unit/x.test.ts', fine)).toEqual([]);
  });

  it('ALLOWED covers a finding by file, shape and port, and an entry no finding uses is stale', () => {
    const found = unitPortFindings('test/unit/x.test.ts', 'server.listen(40681);');
    expect(allowedKey(found[0])).toBe('test/unit/x.test.ts:listen-fixed:40681');
    expect(compareWithAllowed(found, { 'test/unit/x.test.ts:listen-fixed:40681': 'a reason' }).fresh).toEqual([]);
    expect(compareWithAllowed([], { 'test/unit/x.test.ts:listen-fixed:40681': 'a reason' }).stale).toEqual(['test/unit/x.test.ts:listen-fixed:40681']);
  });
});
