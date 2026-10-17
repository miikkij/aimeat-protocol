/**
 * @file connections-mcp-surface.test.ts
 * @description Which connection tools appear on an agent's MCP surface, and which do not.
 *
 *   The generic filter maps ONE scope word to a tool, and sending mail through somebody's own
 *   mailbox needs TWO: `outbound:send` is permission to send in the owner's name, and
 *   `connections:use` is permission to spend their connected account. So `aimeat_mail_send` carries
 *   a hand-written condition on top of the generic one, and a hand-written condition is exactly the
 *   kind that rots quietly — it fails open, the tool appears, and the only sign is a refusal at the
 *   moment somebody tries to use it.
 *
 *   ABSENT RATHER THAN PRESENT-AND-REFUSING is the property under test. A control whose only
 *   possible answer is a refusal is the "advertised but unusable" mistake LinkedIn's deliberately
 *   missing read-metrics capability exists to avoid, and a person who presses it repeatedly
 *   concludes the product is broken.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connections-mcp-surface.test.ts
 * @version-history
 *   2026-10-17 — aimeat_mail_send has no condition of its own any more: the generic gate applies both
 *     catalog words, and an agent's person can allow it with one press. Asserted on the catalog and
 *     scopeAllowsTool instead of on this function's registrations.
 *   2026-10-15 — aimeat_connection_history and aimeat_connection_replies join the set; one scope word
 *     each, so the generic filter gates them like the other read tools.
 *   v1.0.0 — 2026-08-26 — Initial.
 */

import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerConnectionTools } from '../../src/mcp/connections.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { requiredScopesForTool, scopeAllowsTool } from '../../src/tool-catalog/scopes.js';

/** A stand-in that records the tool NAMES it was asked to register, and nothing else. */
function recordingMcp(): { mcp: McpServer; names: string[] } {
    const names: string[] = [];
    const mcp = {
        tool: (name: string) => { names.push(name); },
    } as unknown as McpServer;
    return { mcp, names };
}

function cfg(over: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node',
        connectionsEnabled: true,
        connectGoogleClientId: 'g', connectGoogleClientSecret: 's',
        connectMicrosoftClientId: '', connectMicrosoftClientSecret: '', connectMicrosoftTenant: 'common',
        connectLinkedinClientId: '', connectLinkedinClientSecret: '',
        connectXClientId: '', connectXClientSecret: '',
        connectRedirectUri: '', connectFakeBaseUrl: '',
        ...over,
    } as unknown as AimeatConfig;
}

function surfaceFor(scopes: string[]): string[] {
    const { mcp, names } = recordingMcp();
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    registerConnectionTools(mcp, storage, cfg(), () => 'claude#alice@test-node', scopes);
    return names;
}

describe('the nine tools', () => {
    it('registers all of them for a session holding both words', () => {
        const names = surfaceFor(['connections:read', 'connections:write', 'connections:use', 'outbound:send']);
        expect(names.sort()).toEqual([
            'aimeat_connection_history',
            'aimeat_connection_list',
            'aimeat_connection_providers',
            'aimeat_connection_replies',
            'aimeat_connection_start',
            'aimeat_mail_aliases',
            'aimeat_mail_read',
            'aimeat_mail_search',
            'aimeat_mail_send',
        ]);
    });
});

describe('sending needs both words, and the generic gate holds them', () => {
    // Until 2026-10-17 aimeat_mail_send had a condition of its own here. Its catalog entry names both
    // words, so the registration gate in mcp/index.ts applies both, as it does for every tool: allowed,
    // listed for the agent's person to allow with one press (the call is refused with the allow
    // address, mcp/permission-ask-gate.ts), or absent. A second gate here kept the tool off the list
    // while the person could have allowed it (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
    it('the catalog names both words, so the generic gate refuses a session holding only one', () => {
        expect([...requiredScopesForTool('aimeat_mail_send')].sort()).toEqual(['connections:use', 'outbound:send']);
        expect(scopeAllowsTool(['outbound:send'], 'aimeat_mail_send')).toBe(false);
        expect(scopeAllowsTool(['connections:use'], 'aimeat_mail_send')).toBe(false);
        expect(scopeAllowsTool(['outbound:send', 'connections:use'], 'aimeat_mail_send')).toBe(true);
        expect(scopeAllowsTool(['*'], 'aimeat_mail_send')).toBe(true);
    });
});

describe('all nine register regardless of scopes', () => {
    it('because the generic filter is what gates them', () => {
        // The surface filter applies each tool's words above this function. Registering them here
        // unconditionally is correct; duplicating the filter would be a second gate to keep in step
        // with the first.
        const bare = surfaceFor([]);
        for (const name of [
            'aimeat_connection_providers', 'aimeat_connection_list', 'aimeat_connection_start',
            'aimeat_connection_history', 'aimeat_connection_replies',
            'aimeat_mail_search', 'aimeat_mail_read', 'aimeat_mail_aliases', 'aimeat_mail_send',
        ]) {
            expect(bare).toContain(name);
        }
    });
});
