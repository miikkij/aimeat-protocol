/**
 * @file test/unit/mcp-session-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An erased account's open MCP sessions close on every process of the node
 *   (mcp/session-registry.ts closeMcpSessionsForAccount and the accountErased event;
 *   secaudit2026nov08b round 15, owner-erasure.ts:eraseOwner/mcp-sessions-not-closed). The event is
 *   told here as the erasing process tells it and as another process's relay tells it (emitRemote).
 *   Only that account's agents close: another account, a name that merely ends the same way and the
 *   same name on another node keep their sessions. test/e2e-connect-tunnel.ts case 21 runs the
 *   erasure end to end.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-session-erasure.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { noteMcpSession, forgetMcpSession, closeMcpSessionsForAccount } from '../../src/mcp/session-registry.js';
import { emitAccountErased, emitRemote } from '../../src/services/event-bus.js';

const closed: string[] = [];
const ids: string[] = [];
function open(id: string, principal: string): void {
  ids.push(id);
  noteMcpSession(id, principal, () => { closed.push(id); });
}
afterEach(() => { for (const id of ids.splice(0)) forgetMcpSession(id); closed.length = 0; });

function sessions(): void {
  open('s-helper', 'helper#alice@node');
  open('s-scout', 'scout#alice@node');
  open('s-bob', 'helper#bob@node');
  open('s-malice', 'helper#malice@node');
  open('s-other-node', 'helper#alice@other-node');
}

describe('an erased account\'s MCP sessions', () => {
  it('close when the erasing process tells it, and nobody else\'s do', () => {
    sessions();
    emitAccountErased('node', 'alice');
    expect(closed.sort()).toEqual(['s-helper', 's-scout']);
  });

  it('close when another process of the node told it', () => {
    sessions();
    emitRemote('accountErased', { nodeId: 'node', owner: 'alice', timestamp: Date.now() });
    expect(closed.sort()).toEqual(['s-helper', 's-scout']);
  });

  it('closeMcpSessionsForAccount answers how many it closed, once', () => {
    sessions();
    expect(closeMcpSessionsForAccount('alice@node')).toBe(2);
    expect(closeMcpSessionsForAccount('alice@node')).toBe(0);
  });
});
