/**
 * @file mcp/core-work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP's three work tools for a provider agent: its inbox, accepting a work
 *   item, delivering one. Accept and deliver run the one implementation in services/work-lifecycle.ts.
 *   PURE EXTRACTION from core.ts (max-file-lines), the road core-boards.ts and core-storage.ts took:
 *   converting every tool to registerTool (MCP SDK v2 migration, plan doc-mvguy322f9se step 3) took
 *   core.ts past 800 lines, and these three are a self-contained group that needs only storage,
 *   config, the agent's identity and the resource-update signal.
 * @structure registerCoreWorkTools(mcp, deps)
 * @usage registerCoreWorkTools(mcp, { storage, config, agentGaii, emitResourceUpdated });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Extracted from core.ts. No behaviour change.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { descriptionFor, structuredResult } from '../tool-catalog/shape.js';
import { annotationsFor } from './annotations.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { genericListOutput } from '../tool-catalog/output-schemas.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { acceptWork, deliverWork } from '../services/work-lifecycle.js';

export interface CoreWorkToolDeps {
    storage: Storage;
    config: AimeatConfig;
    agentGaii: string;
    emitResourceUpdated: (agentGaii: string, uri: string) => void;
}

export function registerCoreWorkTools(mcp: McpServer, deps: CoreWorkToolDeps): void {
    const { storage, config, agentGaii, emitResourceUpdated } = deps;

    // ── Tool 7: aimeat_work_inbox ──
    mcp.registerTool(
        'aimeat_work_inbox',
        { description: descriptionFor('aimeat_work_inbox'), inputSchema: zodShapeFor('aimeat_work_inbox'), outputSchema: genericListOutput, annotations: annotationsFor('aimeat_work_inbox') },
        async ({ response_format }) => {
            const items = await storage.listWorkByProvider(agentGaii);
            const pending = items.filter(w => ['pending', 'accepted', 'in_progress'].includes(w.status));
            return structuredResult('aimeat_work_inbox', response_format, pending.map(w => ({
                tracking_code: w.trackingCode,
                status: w.status,
                action_id: w.actionId,
                requester_gaii: w.requesterGaii,
                cost: w.cost,
                created_at: w.createdAt,
            })));
        },
    );

    // ── Tool 8: aimeat_work_accept ──
    mcp.registerTool(
        'aimeat_work_accept',
        {
            description: descriptionFor('aimeat_work_accept'),
            inputSchema: zodShapeFor('aimeat_work_accept'),
            annotations: annotationsFor('aimeat_work_accept'),
        },
        async ({ tracking_code }) => {
            // ONE implementation (services/work-lifecycle.ts). This tool wrote the status itself and
            // skipped the work→task bridge the HTTP door runs, so an agent that accepted its work
            // over MCP, the door an agent actually uses, got no task to drive the job from.
            const accepted = await acceptWork({ storage, config }, agentGaii, tracking_code);
            if (!accepted.ok) {
                return { content: [{ type: 'text' as const, text: `${accepted.code}: ${accepted.message}` }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ tracking_code, status: accepted.work.status }, null, 2) }] };
        },
    );

    // ── Tool 9: aimeat_work_deliver ──
    mcp.registerTool(
        'aimeat_work_deliver',
        {
            description: descriptionFor('aimeat_work_deliver'),
            inputSchema: zodShapeFor('aimeat_work_deliver'),
            annotations: annotationsFor('aimeat_work_deliver'),
        },
        async ({ tracking_code, output }) => {
            // ONE implementation (services/work-lifecycle.ts). This tool settled and stored the
            // output by hand, and that was all it did: the requester's callback_url was never
            // called, so a delivery made over MCP left a requester who is not sitting on the node
            // waiting, and neither post_settlement nor post_work_delivery ran, so an installed
            // extension saw the HTTP deliveries and none of these.
            const delivered = await deliverWork({ storage, config }, agentGaii, tracking_code, output);
            if (!delivered.ok) {
                return { content: [{ type: 'text' as const, text: `${delivered.code}: ${delivered.message}` }], isError: true };
            }
            // Wallet balance changed for both parties
            emitResourceUpdated(agentGaii, `aimeat://wallet/${encodeURIComponent(agentGaii)}`);
            emitResourceUpdated(delivered.work.requesterGaii, `aimeat://wallet/${encodeURIComponent(delivered.work.requesterGaii)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ tracking_code, status: delivered.work.status,
                ...(await writeProvenanceEcho(storage, config, delivered.work.aiProvenanceId)) }, null, 2) }] };
        },
    );
}
