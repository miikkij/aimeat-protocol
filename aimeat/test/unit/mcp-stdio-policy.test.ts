/**
 * @file test/unit/mcp-stdio-policy.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Running a LOCAL MCP server process: the three conditions, and the ways round them
 *   that must not work.
 *
 *   Every other transport in this feature is a request to an address, where the far side decides
 *   what happens. This one starts a PROGRAM on this host. So the assertions worth having are the
 *   near misses: a command that merely BEGINS with an allowed one, one that ends with it, one whose
 *   basename matches, and a switch turned on with nothing named. Each of those is a plausible
 *   implementation of "check the command" and each would run something nobody allowed.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 7 of the MCP proxy.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { checkStdioPolicy } from '../../src/services/mcp-client/stdio-policy.js';
import { buildTransport } from '../../src/services/mcp-client/transport.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';

const on = { mcpStdioEnabled: true, mcpStdioAllowedCommands: ['npx', 'uvx'] };
const npx = { command: 'npx', args: ['some-server'] };

function stdioServer(command: string, args: string[] = []): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'local', title: 'A local one', description: '',
    ownership: 'node', ownerGhii: null, organismId: null, ws: null, createdBy: 'op@n',
    transport: { kind: 'stdio', command, args },
    auth: 'none', credential: null, credentialShape: null,
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: 'all-owners', allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now,
  };
}

describe('the switch', () => {
  it('is off by default, and says which setting turns it on', () => {
    const v = checkStdioPolicy({ mcpStdioEnabled: false, mcpStdioAllowedCommands: ['npx'] }, npx);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('STDIO_DISABLED');
    // A refusal an operator can act on names the thing that decides.
    expect(v.message).toContain('AIMEAT_MCP_STDIO_ENABLED');
  });

  it('being on is not the whole permission: an empty list runs nothing', () => {
    const v = checkStdioPolicy({ mcpStdioEnabled: true, mcpStdioAllowedCommands: [] }, npx);
    // Turning the feature on says this node MAY run local servers, not which. Reading silence as
    // "any" would make one boolean the whole of the decision.
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('STDIO_NOT_ALLOWED');
    expect(v.message).toContain('AIMEAT_MCP_STDIO_ALLOWED_COMMANDS');
  });

  it('lets an allowed command through when both are set', () => {
    expect(checkStdioPolicy(on, npx).ok).toBe(true);
    expect(checkStdioPolicy(on, { command: 'uvx', args: [] }).ok).toBe(true);
  });
});

describe('the near misses, each of which is a plausible wrong implementation', () => {
  const refused = (command: string) => {
    const v = checkStdioPolicy(on, { command, args: [] });
    expect(v.ok, `"${command}" was allowed`).toBe(false);
  };

  it('refuses a command that merely BEGINS with an allowed one', () => {
    // What a startsWith check would admit.
    refused('npx-evil');
    refused('npxx');
  });

  it('refuses a command that merely ENDS with one', () => {
    // What an endsWith or a "contains" check would admit.
    refused('evil-npx');
    refused('/tmp/notnpx');
  });

  it('refuses a path whose BASENAME matches', () => {
    // What a basename check would admit: any npx anywhere on the disk, including one the
    // arguments of an earlier call just wrote.
    refused('/tmp/npx');
    refused('C:\\Users\\Public\\npx');
  });

  it('is case sensitive, because the filesystem may not be', () => {
    refused('NPX');
  });

  it('refuses the empty command rather than treating it as absent', () => {
    refused('');
  });

  it('does not care what the arguments say', () => {
    // The process starts without a shell and takes an argument ARRAY, so a semicolon in an
    // argument is a semicolon. If this ever failed, the command would have stopped being the
    // only thing that decides what runs.
    expect(checkStdioPolicy(on, { command: 'npx', args: ['; rm -rf /', '&& curl evil'] }).ok).toBe(true);
  });
});

describe('the line that actually spawns', () => {
  it('refuses when nobody passed the config, rather than defaulting to yes', () => {
    // An unanswered question about running a program is a no.
    expect(() => buildTransport(stdioServer('npx'), null)).toThrow(/cannot run a local MCP server/);
  });

  it('refuses a command the policy refuses, at the spawn and not only earlier', () => {
    // checkStdioPolicy could be called at a door for a nicer message. This is the call that
    // matters, because a second code path reaching this line without asking would spawn.
    expect(() => buildTransport(stdioServer('npx-evil'), null, on))
      .toThrow(/not a command this node is allowed to run/);
  });

  it('carries the code on the error, so the two mistakes stay apart', () => {
    try {
      buildTransport(stdioServer('npx-evil'), null, on);
      expect.unreachable('it should have refused');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('STDIO_NOT_ALLOWED');
    }
    try {
      buildTransport(stdioServer('npx'), null, { mcpStdioEnabled: false, mcpStdioAllowedCommands: [] });
      expect.unreachable('it should have refused');
    } catch (err) {
      // "this node does not run local processes" and "nobody allowlisted that command" are fixed
      // in two different places, so they must not arrive as one word.
      expect((err as { code?: string }).code).toBe('STDIO_DISABLED');
    }
  });
});
