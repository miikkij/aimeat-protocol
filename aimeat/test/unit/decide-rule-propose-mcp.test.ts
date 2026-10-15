/**
 * @file decide-rule-propose-mcp.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 95: POST /v1/ai/decide/rule-proposals refuses an app or an
 *   ecosystem app, and aimeat_decide_rule_propose did not. The tool is called directly on a session
 *   whose principal is an ecosystem app, and on one whose principal is an agent.
 * @usage cd aimeat && pnpm exec vitest run test/unit/decide-rule-propose-mcp.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 95).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerDecideTools } from '../../src/mcp/decide.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function toolsFor(principal: string): Map<string, Handler> {
    const tools = new Map<string, Handler>();
    const mcp = { tool: (name: string, ...rest: unknown[]) => { tools.set(name, rest[rest.length - 1] as Handler); } };
    const config = { ...loadConfig().config, nodeId: 'aimeat-unit-decide-001' } as AimeatConfig;
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    registerDecideTools(mcp as never, storage, config, () => principal);
    return tools;
}

const rule = { id: 'r1', title: 'A rule', questions: [{ id: 'q', text: 'Is it?' }], bands: [] };

describe('aimeat_decide_rule_propose refuses whoever the REST route refuses', () => {
    it('refuses an ecosystem app', async () => {
        const out = await toolsFor('eco:helper#alice@aimeat-unit-decide-001').get('aimeat_decide_rule_propose')!({ rule, reason: 'probe' });
        expect(out.isError).toBe(true);
        expect(out.content[0].text).toMatch(/^ACCESS_DENIED/);
    });

    it('does not refuse an agent on that ground', async () => {
        const out = await toolsFor('helper#alice@aimeat-unit-decide-001').get('aimeat_decide_rule_propose')!({ rule, reason: 'probe' });
        expect(out.content[0].text).not.toMatch(/^ACCESS_DENIED/);
    });
});
