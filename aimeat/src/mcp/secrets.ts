/**
 * @file src/mcp/secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's secrets vault on the chat path: store a key, see what is stored, remove
 *   one. AI chat is the primary interface here, and a vault reachable only by clicking would mean
 *   the person has to leave the conversation where the integration is being set up, find a page,
 *   and paste a credential into a form — which is the moment they paste it into the chat instead.
 *
 *   ONE IMPLEMENTATION. These call the same services/owner-secrets.ts functions the three REST
 *   routes call, so the name rule, the 4 kB ceiling, the encryption and the refusal words are
 *   written once. A tool reaching `storage.setSecret` itself would be a second credential store.
 *
 *   NOTHING HERE RETURNS A VALUE, and that is not an oversight to be fixed later: an agent that
 *   could read a secret back would be a credential exfiltration path with a chat window attached to
 *   it. The list answers names and dates; the set answers what it stored, by name.
 *
 *   BEHIND secrets:manage, the same word the routes use, so the tool surface and the HTTP door
 *   answer alike — and out of every wildcard, so "Full access" does not carry it.
 * @structure registerSecretTools(mcp, storage, config, getAgentGaii)
 * @usage registerSecretTools(mcp, storage, config, agentGaii) — from mcp/register-all.ts
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-09 — aimeat_secret_set takes an optional `host`, the same as PUT /v1/secrets/:name (secrets
 *     audit 2026-10-09, item 10).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-06 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { listOwnerSecrets, putOwnerSecret, deleteOwnerSecret } from '../services/owner-secrets.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

export function registerSecretTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    // The vault belongs to the HUMAN behind this session. An agent asking about "my secrets" is
    // asking about the account it acts within, exactly as aimeat_access_list does.
    const vaultOf = (): string => ownerGhiiOf(getAgentGaii());

    mcp.registerTool('aimeat_secret_list', { description: descriptionFor('aimeat_secret_list'), inputSchema: zodShapeFor('aimeat_secret_list'), annotations: annotationsFor('aimeat_secret_list') }, async () => {
        const secrets = await listOwnerSecrets(storage, vaultOf());
        return { content: [{ type: 'text' as const, text: JSON.stringify({ secrets, count: secrets.length }, null, 2) }] };
    });

    mcp.registerTool('aimeat_secret_set', { description: descriptionFor('aimeat_secret_set'), inputSchema: zodShapeFor('aimeat_secret_set'), annotations: annotationsFor('aimeat_secret_set') }, async ({ name, value, host }) => {
        const ownerGhii = vaultOf();
        // `host` binds the secret now; the session's principal is recorded as the one who set it.
        const r = await putOwnerSecret(storage, config, ownerGhii, name, value, { host, by: getAgentGaii() });
        if (!r.ok) {
            return { content: [{ type: 'text' as const, text: `${r.code}: ${r.message}` }], isError: true };
        }
        emitChange('secrets', ownerGhii);
        return { content: [{ type: 'text' as const, text: JSON.stringify(r.data, null, 2) }] };
    });

    mcp.registerTool('aimeat_secret_delete', { description: descriptionFor('aimeat_secret_delete'), inputSchema: zodShapeFor('aimeat_secret_delete'), annotations: annotationsFor('aimeat_secret_delete') }, async ({ name }) => {
        const ownerGhii = vaultOf();
        const r = await deleteOwnerSecret(storage, ownerGhii, name);
        if (!r.ok) {
            return { content: [{ type: 'text' as const, text: `${r.code}: ${r.message}` }], isError: true };
        }
        emitChange('secrets', ownerGhii);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ name, deleted: true }, null, 2) }] };
    });
}
