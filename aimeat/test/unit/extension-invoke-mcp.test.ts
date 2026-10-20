/**
 * @file test/unit/extension-invoke-mcp.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP tool aimeat_extension_invoke runs the sequence POST /v1/ext/:extName/:actionId
 *   runs (services/extension-invoke.ts). Proven on the parts the tool used to skip and the E2E suite
 *   cannot see: a delivered call records its duration under the provider, the failure text is redacted
 *   of credential-shaped text, and a version pin resolves.
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-16 — Initial (QA audit D2-05).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerExtensionsTools } from '../../src/mcp/extensions.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { agentSessionCaller } from '../../src/services/caller-context.js';
import { readCallTiming } from '../../src/services/call-timing.js';

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

/** Records every registration and keeps the handler, which is the last argument in every form. */
function capturingMcp(): { mcp: McpServer; handlers: Map<string, Handler> } {
    const handlers = new Map<string, Handler>();
    const mcp = {
        tool: (name: string, ...rest: unknown[]) => { handlers.set(name, rest[rest.length - 1] as Handler); },
        registerTool: (name: string, ...rest: unknown[]) => { handlers.set(name, rest[rest.length - 1] as Handler); },
        registerResource: () => undefined,
    } as unknown as McpServer;
    return { mcp, handlers };
}

const NODE = 'test-node';
const OWNER = 'alice';
const AGENT = `claude#${OWNER}@${NODE}`;
const EXT = 'parity-probe';
const SECRET = 's3cretValue9988';

function extension(): ExtensionRecord {
    const action = (id: string, scriptContent: string) => ({
        id, method: 'POST', path: `/${id}`, inputSchema: {}, outputSchema: {}, scriptContent,
    });
    return {
        name: EXT, version: '1.0.0', description: 'probe', author: OWNER, status: 'active', requiredApis: [],
        actions: [
            action('fine', 'export default async function(ctx, input) { return { ok: true }; }'),
            action('leaky', `export default async function(ctx, input) { throw new Error('upstream refused: api_key=${SECRET} was rejected'); }`),
        ],
        config: {}, limits: { memoryMb: 64, timeoutMs: 5000, maxApiCalls: 10 },
        federation: { advertise: false, capabilities: [] },
        installedBy: OWNER, installedAt: new Date().toISOString(),
    } as unknown as ExtensionRecord;
}

describe('node MCP aimeat_extension_invoke runs the REST sequence', () => {
    let storage: Storage;
    let invoke: Handler;
    let config: AimeatConfig;

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:') as unknown as Storage;
        config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test' };
        await storage.createExtension(extension());
        const { mcp, handlers } = capturingMcp();
        registerExtensionsTools(mcp, storage, config, () => AGENT, () => undefined, () => undefined, [],
            () => agentSessionCaller(AGENT, OWNER, ['ext:invoke'], NODE, storage));
        invoke = handlers.get('aimeat_extension_invoke')!;
    });

    it('a delivered call records its duration under the provider', async () => {
        const out = await invoke({ extension_name: EXT, action_id: 'fine', input: {} });
        expect(out.isError, out.content[0].text).toBeFalsy();
        const timing = await readCallTiming(storage, `${OWNER}@${NODE}`, EXT, 'fine');
        expect(timing?.count, 'the MCP call was timed').toBe(1);
    });

    it('a failed call names EXTENSION_ERROR and never shows the credential-shaped text', async () => {
        const out = await invoke({ extension_name: EXT, action_id: 'leaky', input: {} });
        expect(out.isError).toBe(true);
        expect(out.content[0].text).toContain('EXTENSION_ERROR');
        expect(out.content[0].text).toContain('api_key=[redacted]');
        expect(out.content[0].text).not.toContain(SECRET);
    });

    it('a version pin resolves, and an unknown version is NOT_FOUND', async () => {
        const pinned = await invoke({ extension_name: `${EXT}@1.0.0`, action_id: 'fine', input: {} });
        expect(pinned.isError, pinned.content[0].text).toBeFalsy();
        const unknown = await invoke({ extension_name: `${EXT}@9.9.9`, action_id: 'fine', input: {} });
        expect(unknown.isError).toBe(true);
        expect(unknown.content[0].text).toContain('NOT_FOUND');
    });
});
