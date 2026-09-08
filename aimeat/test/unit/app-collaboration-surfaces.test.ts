/**
 * @file app-collaboration-surfaces.test.ts
 * @description Invoke connector handlers and inspect what reaches the REST boundary.
 * @version-history v1.0.0 - 2026-09-08 - Retain the target, roadmap and provenance on draft publication.
 */
import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppsTools } from '../../src/cli/connect/mcp/tools/apps.js';

describe('shared app connector requests', () => {
  it('forwards a draft publication to the invited owner with its complete note', async () => {
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
    const requests: unknown[][] = [];
    const mcp = { tool: (name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as (input: Record<string, unknown>) => Promise<unknown>) } as unknown as McpServer;
    const connection = {
      resolve: () => ({ owner: 'builder', client: {
        post: async (...args: unknown[]) => { requests.push(args); return { ok: false, error: { message: 'Captured at the boundary' } }; },
      } }),
    } as Parameters<typeof registerAppsTools>[1];
    registerAppsTools(mcp, connection);
    const declared = { level: 'assisted', method: 'generated', human_involvement: 'reviewed' };
    await handlers.get('aimeat_app_draft_publish')!({
      owner: 'app-owner', filename: 'app.html', roadmap: 'A release note.',
      ai_provenance: declared, ai_provenance_id: 'existing-record', spec_token: 'spec-digest', spec_ack: 'skipped-by-owner',
    });
    expect(requests[0]).toEqual(['/v1/apps/app-owner/app.html/publish-draft', {
      roadmap: 'A release note.', ai_provenance: declared, ai_provenance_id: 'existing-record',
      spec_token: 'spec-digest', spec_ack: 'skipped-by-owner',
    }]);
    await handlers.get('aimeat_app_screenshot')!({ owner: 'app-owner', filename: 'app.html' });
    expect(requests[1]?.[0]).toBe('/v1/apps/app-owner/app.html/screenshot/capture');
  });
});
