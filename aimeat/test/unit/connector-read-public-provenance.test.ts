/**
 * @file test/unit/connector-read-public-provenance.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector's aimeat_memory_read_public (src/cli/connect/mcp/tools/memory-ext.ts)
 *   hands on the provenance record the public read serves on the envelope (meta.provenance), as
 *   aimeat_memory_read does. The plain unwrap kept the id in the body and dropped the statement.
 * @version-history
 *   v1.0.0 — 2026-09-30 — TARGET-082 review. Initial.
 */
import { describe, it, expect } from 'vitest';
import { registerMemoryExtTools } from '../../src/cli/connect/mcp/tools/memory-ext.js';
import type { AgentRegistry } from '../../src/cli/connect/agent-registry.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: true }>;

function capture(resp: unknown): { handler: Handler; asked: string[] } {
  const asked: string[] = [];
  let handler: Handler | null = null;
  const mcp = { tool: (...args: unknown[]) => { handler = args[args.length - 1] as Handler; } };
  const client = { get: async (path: string) => { asked.push(path); return resp; } };
  const registry = { resolve: () => ({ client }) } as unknown as AgentRegistry;
  registerMemoryExtTools(mcp as never, registry);
  return { handler: handler!, asked };
}

describe('connector aimeat_memory_read_public', () => {
  it('folds meta.provenance onto the payload', async () => {
    const record = { level: 'ai-assisted', statement: 'Drafted with an AI, checked by alice.' };
    const { handler, asked } = capture({
      ok: true,
      data: { key: 'notes.public', value: 'hello', ai_provenance_id: 'prov-1' },
      meta: { provenance: { id: 'prov-1', record, recordUrl: '/v1/ai-provenance/prov-1' } },
    });
    const out = await handler({ gaii: 'alice@test-node', key: 'notes.public' });
    expect(asked).toEqual(['/v1/memory/alice%40test-node/notes.public']);
    const payload = JSON.parse(out.content[0]!.text);
    expect(payload).toMatchObject({ key: 'notes.public', value: 'hello' });
    expect(payload.ai_provenance).toEqual({ id: 'prov-1', record, record_url: '/v1/ai-provenance/prov-1' });
    expect(out.isError).toBeUndefined();
  });

  it('passes a refusal through, flagged as an error', async () => {
    const { handler } = capture({ ok: false, error: { code: 'NOT_FOUND', message: 'No such record.' } });
    const out = await handler({ gaii: 'alice@test-node', key: 'notes.gone' });
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0]!.text)).toMatchObject({ ok: false });
  });
});
