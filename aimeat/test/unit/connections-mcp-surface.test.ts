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
 *   v1.0.0 — 2026-08-26 — Initial.
 */

import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerConnectionTools } from '../../src/mcp/connections.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

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

describe('the seven tools', () => {
    it('registers all of them for a session holding both words', () => {
        const names = surfaceFor(['connections:read', 'connections:write', 'connections:use', 'outbound:send']);
        expect(names.sort()).toEqual([
            'aimeat_connection_list',
            'aimeat_connection_providers',
            'aimeat_connection_start',
            'aimeat_mail_aliases',
            'aimeat_mail_read',
            'aimeat_mail_search',
            'aimeat_mail_send',
        ]);
    });
});

describe('sending needs both words, and is absent without them', () => {
    it('is absent with outbound:send alone', () => {
        // This is the shape that would fail open: a session that may send in the owner's name but
        // was never granted the mailbox. The tool must not be offered.
        expect(surfaceFor(['outbound:send'])).not.toContain('aimeat_mail_send');
    });

    it('is absent with connections:use alone', () => {
        expect(surfaceFor(['connections:use'])).not.toContain('aimeat_mail_send');
    });

    it('is absent with neither', () => {
        expect(surfaceFor([])).not.toContain('aimeat_mail_send');
    });

    it('appears with both', () => {
        expect(surfaceFor(['outbound:send', 'connections:use'])).toContain('aimeat_mail_send');
    });

    it('appears for a session holding a word that covers them', () => {
        // Scope coverage understands families, and a hand-rolled includes() would refuse a caller
        // holding a broader grant. Using the shared predicate is what makes this work.
        expect(surfaceFor(['*'])).toContain('aimeat_mail_send');
    });
});

describe('the other six do not depend on that condition', () => {
    it('registers regardless of scopes, because the generic filter is what gates them', () => {
        // They carry ONE word each in the scope map, and the surface filter applies it above this
        // function. Registering them here unconditionally is correct; duplicating the filter would
        // be a second gate to keep in step with the first.
        const bare = surfaceFor([]);
        for (const name of [
            'aimeat_connection_providers', 'aimeat_connection_list', 'aimeat_connection_start',
            'aimeat_mail_search', 'aimeat_mail_read', 'aimeat_mail_aliases',
        ]) {
            expect(bare).toContain(name);
        }
    });
});
