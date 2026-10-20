/**
 * @file src/mcp/account-rights.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_adult_status, aimeat_subscription_list, aimeat_subscription_cancel and
 *   aimeat_provenance_embed on the node's MCP endpoint (Comicland v3 A-3, A-5, A-8). They do not do the
 *   work: readAdult (services/adult-assurance.ts), listSubscriptions and cancelSubscription
 *   (commerce/subscriptions.ts) and embedProvenance (services/provenance-embed/) are what the REST
 *   routes call. The scope words are applied where every tool is registered (TOOL_SCOPES, from the
 *   catalog entries).
 * @structure registerAccountRightsTools(mcp, storage, config, caller)
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-3, A-5, A-8).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { readAdult, NOT_VERIFIED } from '../services/adult-assurance.js';
import { listSubscriptions, cancelSubscription } from '../commerce/subscriptions.js';
import { embedProvenance, EmbedError } from '../services/provenance-embed/index.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerAccountRightsTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  mcp.registerTool('aimeat_adult_status', { description: descriptionFor('aimeat_adult_status'), inputSchema: zodShapeFor('aimeat_adult_status'), annotations: annotationsFor('aimeat_adult_status') },
    async () => {
      const c = caller();
      const s = c.visitor ? NOT_VERIFIED : await readAdult(storage, c.ownerGhii);
      return text({ verified: s.verified, method: s.method, verified_at: s.at });
    });

  mcp.registerTool('aimeat_subscription_list', { description: descriptionFor('aimeat_subscription_list'), inputSchema: zodShapeFor('aimeat_subscription_list'), annotations: annotationsFor('aimeat_subscription_list') },
    async () => text({ subscriptions: await listSubscriptions(storage, caller().ownerGhii) }));

  mcp.registerTool('aimeat_subscription_cancel', { description: descriptionFor('aimeat_subscription_cancel'), inputSchema: zodShapeFor('aimeat_subscription_cancel'), annotations: annotationsFor('aimeat_subscription_cancel') },
    async ({ ext, plan }) => {
      const out = await cancelSubscription(storage, caller().ownerGhii, ext, plan);
      return out ? text({ subscription: out }) : toolError('NOT_FOUND', 'Your owner has no such subscription.');
    });

  mcp.registerTool('aimeat_provenance_embed', { description: descriptionFor('aimeat_provenance_embed'), inputSchema: zodShapeFor('aimeat_provenance_embed'), annotations: annotationsFor('aimeat_provenance_embed') },
    async ({ storage_key, provenance_ids, output_key, composite }) => {
      try {
        const r = await embedProvenance({ storage, config }, {
          principal: caller().principal, storageKey: storage_key, provenanceIds: [...provenance_ids],
          ...(output_key ? { outputKey: output_key } : {}), ...(composite !== undefined ? { composite } : {}),
        });
        return text({ storage_key: r.storageKey, mime_type: r.mime, size: r.size, format: r.format, visibility: r.visibility,
          digital_source_type: r.digitalSourceType, records: r.records, ...(r.pages !== undefined ? { pages: r.pages } : {}) });
      } catch (e) {
        if (e instanceof EmbedError) return toolError(e.code, e.message);
        throw e;
      }
    });
}
