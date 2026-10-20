/**
 * @file test/unit/agent-message-prompt-mcp.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_message_send carries a choice prompt in its metadata, as its description and the
 *   agent handbook promise and as POST /v1/agents/:name/messages does. The catalog schema had no
 *   `prompt` key, so zod dropped it, and the tool handler did not pass it on either; the stored message
 *   had no question for the owner to answer (feature-list audit #126).
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-message-prompt-mcp.test.ts
 * @version-history
 *   2026-10-20 — The McpServer fake takes registerTool(name, config, handler), the form every tool registers with since the MCP SDK v2 migration step 3.
 *   2026-10-15 — Initial (feature-list audit #126).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { zodShapeFor } from '../../src/tool-catalog/zod-shape.js';
import { registerAgentMessageTools } from '../../src/mcp/agent-messages.js';

const NODE = 'prompt-mcp-node';
const AGENT = `helper#alice@${NODE}`;
const PROMPT = { prompt_id: 'p1', question: 'Which one?', options: ['Red', 'Blue'], allow_other: false };

describe('aimeat_message_send carries metadata.prompt (feature-list audit #126)', () => {
    it('the catalog schema keeps the prompt', () => {
        const parsed = z.object(zodShapeFor('aimeat_message_send')).parse({ content: 'Pick one', metadata: { prompt: PROMPT } });
        expect((parsed.metadata as { prompt?: unknown }).prompt).toEqual(PROMPT);
    });

    it('the stored message carries the prompt', async () => {
        const storage = new SqliteStorage(':memory:');
        const config = { nodeId: NODE, baseUrl: 'http://localhost', aiProvenance: false } as AimeatConfig;
        type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
        const tools = new Map<string, Handler>();
        const fakeMcp = { registerTool: (name: string, ...rest: unknown[]) => { tools.set(name, rest[rest.length - 1] as Handler); } };
        registerAgentMessageTools(fakeMcp as never, storage, config, () => AGENT, () => {}, () => {}, []);

        const args = z.object(zodShapeFor('aimeat_message_send')).parse({ content: 'Pick one', metadata: { prompt: PROMPT } });
        const out = await tools.get('aimeat_message_send')!(args);
        expect(out.isError).toBeFalsy();
        const { message_id } = JSON.parse(out.content[0].text) as { message_id: string };

        const { messages } = await storage.listMessages(AGENT, { page: 1, perPage: 10 });
        const stored = messages.find(m => m.id === message_id);
        expect(stored?.metadata?.prompt).toEqual({ promptId: 'p1', question: 'Which one?', options: ['Red', 'Blue'], allowOther: false });
    });
});
