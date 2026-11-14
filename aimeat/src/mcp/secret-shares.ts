/**
 * @file src/mcp/secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Secret shares on the node MCP: aimeat_secret_share_create, _list, _get, _deposit,
 *   _pickup and _revoke. Each tool calls the same services/secret-shares/ function the REST route in
 *   routes/secret-shares.ts calls, with the session's caller, so the scope check (secrets:share), the
 *   maker's terms, the protection rule, the pickup count and the change events happen there once.
 *   Nothing is decided in this file.
 *
 *   ONLY THE DECLARED FIELDS ARE SENT ON. The body handed to a service is built from the catalog's
 *   field lists (tool-catalog/definitions/secret-shares.ts), so the end-to-end fields and a deposit
 *   token, which these tools do not take, cannot reach the service from an MCP session.
 *
 *   A pickup over MCP has no client address, so a wrong code is counted per share only; the REST
 *   route counts it per address as well.
 * @structure registerSecretShareTools(mcp, storage, config, caller)
 * @usage registerSecretShareTools(mcp, storage, config, caller);   // mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import {
    SECRET_SHARE_CREATE_FIELDS, SECRET_SHARE_DEPOSIT_FIELDS, SECRET_SHARE_PICKUP_FIELDS,
} from '../tool-catalog/definitions/secret-shares.js';
import { createShare, depositShare, listShares, getShare, revokeShare } from '../services/secret-shares/service.js';
import { pickupShare } from '../services/secret-shares/pickup.js';
import type { ShareResult } from '../services/secret-shares/rules.js';

/** The named fields of `args` that were given, as the body the REST route would receive. */
function bodyOf(args: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(fields.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
}

export function registerSecretShareTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
    const deps = { storage, config };
    const answer = <T>(r: ShareResult<T>): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } => (r.ok
        ? { content: [{ type: 'text' as const, text: JSON.stringify(r.data, null, 2) }] }
        : toolError(r.code, r.message));

    mcp.registerTool('aimeat_secret_share_create', { description: descriptionFor('aimeat_secret_share_create'), inputSchema: zodShapeFor('aimeat_secret_share_create'), annotations: annotationsFor('aimeat_secret_share_create') },
        async (args) => answer(await createShare(deps, caller(), bodyOf(args as Record<string, unknown>, SECRET_SHARE_CREATE_FIELDS))));

    mcp.registerTool('aimeat_secret_share_list', { description: descriptionFor('aimeat_secret_share_list'), inputSchema: zodShapeFor('aimeat_secret_share_list'), annotations: annotationsFor('aimeat_secret_share_list') },
        async () => answer(await listShares(deps, caller())));

    mcp.registerTool('aimeat_secret_share_get', { description: descriptionFor('aimeat_secret_share_get'), inputSchema: zodShapeFor('aimeat_secret_share_get'), annotations: annotationsFor('aimeat_secret_share_get') },
        async ({ id }) => answer(await getShare(deps, caller(), id)));

    mcp.registerTool('aimeat_secret_share_deposit', { description: descriptionFor('aimeat_secret_share_deposit'), inputSchema: zodShapeFor('aimeat_secret_share_deposit'), annotations: annotationsFor('aimeat_secret_share_deposit') },
        async (args) => answer(await depositShare(deps, caller(), args.id, bodyOf(args as Record<string, unknown>, SECRET_SHARE_DEPOSIT_FIELDS))));

    mcp.registerTool('aimeat_secret_share_pickup', { description: descriptionFor('aimeat_secret_share_pickup'), inputSchema: zodShapeFor('aimeat_secret_share_pickup'), annotations: annotationsFor('aimeat_secret_share_pickup') },
        async (args) => answer(await pickupShare(deps, caller(), args.id, bodyOf(args as Record<string, unknown>, SECRET_SHARE_PICKUP_FIELDS), '')));

    mcp.registerTool('aimeat_secret_share_revoke', { description: descriptionFor('aimeat_secret_share_revoke'), inputSchema: zodShapeFor('aimeat_secret_share_revoke'), annotations: annotationsFor('aimeat_secret_share_revoke') },
        async ({ id }) => answer(await revokeShare(deps, caller(), id)));
}
