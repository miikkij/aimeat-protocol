/**
 * @file test/unit/mcp-resource-gate.test.ts
 * @description The node MCP's resources answer under the tools' rules (mcp/resource-gate.ts,
 *   secaudit 2026-10, AUTH-2): without the permission of the tool that reads the same thing, a read
 *   is refused and a template lists nothing; a resource with no entry is refused at registration.
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withResourceGate } from '../../src/mcp/resource-gate.js';

type Read = (...args: unknown[]) => Promise<{ contents: Array<{ text: string }> }>;

function capture() {
    const seen: { args: unknown[] }[] = [];
    const register = (...args: unknown[]) => { seen.push({ args }); return undefined; };
    return { seen, register };
}

describe('withResourceGate', () => {
    it('refuses a read and lists nothing without the permission of the resource\'s read tool', async () => {
        let allowed = true;
        const { seen, register } = capture();
        const gated = withResourceGate(register, { allows: () => allowed, agentGaii: () => 'bot#alice@n', storage: { getOrganism: async () => null } as never });
        gated('agent-memory', new ResourceTemplate('aimeat://memory/{key}', { list: async () => ({ resources: [{ uri: 'aimeat://memory/a', name: 'a' }] }) }),
            {}, async () => ({ contents: [{ uri: 'aimeat://memory/a', text: 'the value' }] }));
        const [, template, , read] = seen[0]!.args as [string, ResourceTemplate, unknown, Read];
        expect((await read(new URL('aimeat://memory/a'), { key: 'a' })).contents[0]!.text).toBe('the value');
        allowed = false;
        expect((await read(new URL('aimeat://memory/a'), { key: 'a' })).contents[0]!.text).toMatch(/Access denied/);
        expect(await template.listCallback!({} as never)).toEqual({ resources: [] });
    });

    it('refuses to register a resource that names no read tool', () => {
        const { register } = capture();
        const gated = withResourceGate(register, { allows: () => true, agentGaii: () => 'bot#alice@n', storage: { getOrganism: async () => null } as never });
        expect(() => gated('new-unlisted-resource', 'aimeat://x', {}, async () => ({ contents: [] }))).toThrow(/RESOURCE_READ_TOOL/);
    });
});
