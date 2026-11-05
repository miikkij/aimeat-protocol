/**
 * @file src/mcp/key-reencrypt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_admin_key_reencrypt on the node's MCP: the operator's view and start of the data
 *   key's re-encrypt job, through the functions GET and POST /v1/admin/encryption/reencrypt call
 *   (services/key-reencrypt/job.ts). The keys are never accepted or answered here.
 * @structure registerKeyReencryptTool
 * @usage registerKeyReencryptTool(mcp, config, storage, caller) from mcp/core-admin.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { reencryptStatus, startReencrypt } from '../services/key-reencrypt/job.js';
import { recordOperatorNodeAct } from '../services/operator-access-audit.js';
import { ownerGhiiOf } from '../utils/gaii.js';

export function registerKeyReencryptTool(mcp: McpServer, config: AimeatConfig, storage: Storage, caller: () => CallerContext): void {
    mcp.registerTool('aimeat_admin_key_reencrypt', {
        description: descriptionFor('aimeat_admin_key_reencrypt'), inputSchema: zodShapeFor('aimeat_admin_key_reencrypt'),
        annotations: annotationsFor('aimeat_admin_key_reencrypt'),
    }, async (args) => {
        const c = caller();
        if (!(await c.operator('operator:admin'))) return toolError('FORBIDDEN', 'The data key and its re-encrypt job are for the operator of this node, with operator:admin.');
        const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
        if ((args as { action?: unknown }).action !== 'start') return text(await reencryptStatus(storage, config));
        const out = await startReencrypt(storage, config, c.principal);
        if (!out.ok) return toolError(out.code, out.message);
        if (out.started) recordOperatorNodeAct({ operatorGhii: ownerGhiiOf(c.principal), actorGaii: c.principal, area: 'encryption', action: 'reencrypt', meta: { target_key: out.status.ring.current } });
        return text({ started: out.started, ...out.status });
    });
}
