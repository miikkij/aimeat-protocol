/**
 * @file test/unit/connector-dispatch-response-format.test.ts
 * @description On the connector MCP, a tool that runs its dispatch definition (dispatch-tools.ts)
 *   reads `response_format` as the concise/detailed view only when its catalog entry supports one.
 *   aimeat_voice_speak names its AUDIO format so, and the view handling took it out before the
 *   handler ran, so an mp3 request came back as pcm (secaudit 2026-10 follow-up, Part B).
 * @usage pnpm test -- connector-dispatch-response-format
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 follow-up, Part B).
 */
import { describe, it, expect } from 'vitest';
import { registerAllTools } from '../../src/cli/connect/mcp/tools/index.js';

type Sent = { method: string; path: string; body?: unknown };

function connector(sent: Sent[]) {
    const tools = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const mcp = { tool: (...args: unknown[]) => { tools.set(args[0] as string, args[args.length - 1] as never); } };
    const answer = async () => ({ ok: true, data: { items: [{ id: 'a', title: 't', extra: 'x' }] } });
    const client = {
        get: async (path: string) => { sent.push({ method: 'GET', path }); return answer(); },
        post: async (path: string, body?: unknown) => { sent.push({ method: 'POST', path, body }); return answer(); },
        put: async (path: string, body?: unknown) => { sent.push({ method: 'PUT', path, body }); return answer(); },
        patch: async (path: string, body?: unknown) => { sent.push({ method: 'PATCH', path, body }); return answer(); },
        delete: async (path: string) => { sent.push({ method: 'DELETE', path }); return answer(); },
    };
    const agent = { client, agent: 'probe', owner: 'prober', config: { node_url: 'http://node.test' } };
    registerAllTools(mcp as never, { resolve: () => agent, list: () => [agent], size: () => 1 } as never);
    return tools;
}

describe('the connector dispatch path and response_format', () => {
    it('aimeat_voice_speak sends the audio format it was asked for', async () => {
        const sent: Sent[] = [];
        await connector(sent).get('aimeat_voice_speak')!({ input: 'hello', response_format: 'mp3' });
        expect((sent[0]?.body as { response_format?: string } | undefined)?.response_format).toBe('mp3');
    });

    // The same collision on `agent_name`, which the connector uses to pick its registered agent:
    // aimeat_offer_price_set declares its own (whose offer). Taken as the routing choice, the
    // handler never saw it and refused every call.
    it('aimeat_offer_price_set reads the offers of the agent it names', async () => {
        const sent: Sent[] = [];
        await connector(sent).get('aimeat_offer_price_set')!({ agent_name: 'seller', offer_id: 'o1', price_morsels: 3 });
        expect(sent[0]).toEqual({ method: 'GET', path: '/v1/agents/seller/offers' });
    });
});
