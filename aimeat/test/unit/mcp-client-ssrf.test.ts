/**
 * @file test/unit/mcp-client-ssrf.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SSRF guard on the proxy's outbound path.
 *
 *   This is the test that justifies the whole design. An MCP proxy is, by construction, this node
 *   making an HTTP request to an address somebody else chose, which is the exact shape of a
 *   server-side request forgery. The defence is that the SDK transports accept a `fetch` and we
 *   give them safeFetch, so the DNS-level check and the manual redirect loop apply to every hop.
 *
 *   EVERY ASSERTION HERE IS FLAG-INDEPENDENT. RFC1918 and link-local are blocked whether or not
 *   AIMEAT_ALLOW_PRIVATE_EGRESS is set, which is what makes these safe to assert in a suite that
 *   shares a process with tests that turn loopback egress on.
 *
 *   The redirect case is the one worth keeping: a public host the owner legitimately attached can
 *   answer 302 and point at cloud metadata, and a guard that validated only the first URL would
 *   follow it. Measured 2026-09-16: refused at the hop with "Link-local / cloud-metadata address".
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { describe, it, expect } from 'vitest';
import { guardedFetch } from '../../src/services/mcp-client/transport.js';

/** Addresses that must be refused however this node is configured. */
const ALWAYS_BLOCKED: Array<{ what: string; url: string; because: RegExp }> = [
  { what: 'cloud metadata', url: 'http://169.254.169.254/latest/meta-data/', because: /link-local|metadata/i },
  { what: 'RFC1918 10/8', url: 'http://10.0.0.5/mcp', because: /private/i },
  { what: 'RFC1918 192.168/16', url: 'http://192.168.1.1/mcp', because: /private/i },
  { what: 'RFC1918 172.16/12', url: 'http://172.16.0.1/mcp', because: /private/i },
  { what: 'carrier-grade NAT', url: 'http://100.64.0.1/mcp', because: /carrier|private/i },
  { what: 'IPv4-mapped IPv6 loopback', url: 'http://[::ffff:127.0.0.1]/mcp', because: /loopback/i },
];

describe('the proxy\'s outbound fetch', () => {
  for (const c of ALWAYS_BLOCKED) {
    it(`refuses ${c.what}, whatever the egress profile says`, async () => {
      await expect(guardedFetch(c.url)).rejects.toThrow(/Fetch blocked/);
      await expect(guardedFetch(c.url)).rejects.toThrow(c.because);
    });
  }

  it('refuses a redirect that leaves for an internal address', async () => {
    const http = await import('node:http');
    // A server that looks ordinary and answers 302 to cloud metadata. This is the case a
    // first-URL-only check would follow.
    const redirector = http.createServer((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    await new Promise<void>((r) => redirector.listen(40692, '127.0.0.1', () => r()));
    // Loopback has to be permitted for the FIRST hop to be reached at all; the point of the test
    // is what happens at the SECOND. Restored afterwards so no other suite inherits it.
    const before = process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
    try {
      await expect(guardedFetch('http://127.0.0.1:40692/mcp'))
        .rejects.toThrow(/Fetch blocked.*(link-local|metadata)/i);
    } finally {
      if (before === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
      else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = before;
      await new Promise<void>((r) => redirector.close(() => r()));
    }
  });
});
