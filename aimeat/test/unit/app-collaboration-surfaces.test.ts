/**
 * @file app-collaboration-surfaces.test.ts
 * @description Invoke connector handlers and inspect what reaches the REST boundary.
 * @version-history
 *   v1.1.1 - 2026-10-05 - The handlers come from the whole connector (registerAllTools): aimeat_app_draft_publish
 *     runs its CLI dispatch definition now (secaudit 2026-10, M3).
 *   v1.1.0 - 2026-09-27 - The screenshot is action "screenshot" of aimeat_app_manage.
 *   v1.0.0 - 2026-09-08 - Retain the target, roadmap and provenance on draft publication.
 */
import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from '../../src/cli/connect/mcp/tools/index.js';

describe('shared app connector requests', () => {
  it('forwards a draft publication to the invited owner with its complete note', async () => {
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
    const requests: unknown[][] = [];
    const mcp = { tool: (name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as (input: Record<string, unknown>) => Promise<unknown>) } as unknown as McpServer;
    const agent = { owner: 'builder', agent: 'probe', config: { node_url: 'http://node.test' }, client: {
      post: async (...args: unknown[]) => { requests.push(args); return { ok: false, error: { message: 'Captured at the boundary' } }; },
    } };
    const connection = { resolve: () => agent, list: () => [agent], size: () => 1 } as unknown as Parameters<typeof registerAllTools>[1];
    registerAllTools(mcp, connection);
    // Values the declaration schema takes: the dispatch path checks them before anything is sent.
    const declared = { level: 'assisted', method: 'rewritten', human_involvement: 'light-review' };
    await handlers.get('aimeat_app_draft_publish')!({
      owner: 'app-owner', filename: 'app.html', roadmap: 'A release note.',
      ai_provenance: declared, ai_provenance_id: 'existing-record', spec_token: 'spec-digest', spec_ack: 'skipped-by-owner',
    });
    expect(requests[0]).toEqual(['/v1/apps/app-owner/app.html/publish-draft', {
      roadmap: 'A release note.', ai_provenance: declared, ai_provenance_id: 'existing-record',
      spec_token: 'spec-digest', spec_ack: 'skipped-by-owner',
    }]);
    await handlers.get('aimeat_app_manage')!({ action: 'screenshot', owner: 'app-owner', filename: 'app.html' });
    expect(requests[1]?.[0]).toBe('/v1/apps/app-owner/app.html/screenshot/capture');
  });
});
