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
 *   v1.0.0 — 2026-09-06 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { listOwnerSecrets, putOwnerSecret, deleteOwnerSecret } from '../services/owner-secrets.js';

export function registerSecretTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    // The vault belongs to the HUMAN behind this session. An agent asking about "my secrets" is
    // asking about the account it acts within, exactly as aimeat_access_list does.
    const vaultOf = (): string => ownerGhiiOf(getAgentGaii());

    mcp.tool('aimeat_secret_list', descriptionFor('aimeat_secret_list'), {}, annotationsFor('aimeat_secret_list'), async () => {
        const secrets = await listOwnerSecrets(storage, vaultOf());
        return { content: [{ type: 'text' as const, text: JSON.stringify({ secrets, count: secrets.length }, null, 2) }] };
    });

    mcp.tool('aimeat_secret_set', descriptionFor('aimeat_secret_set'), {
        name: z.string().describe('What to call it: letters, digits, underscore and hyphen, 1 to 64 characters. This is the name written into a header as {{secret:NAME}}, so it is case-exact.'),
        value: z.string().describe('The key or password itself, up to 4 kB. Encrypted at rest, and returned by nothing.'),
    }, annotationsFor('aimeat_secret_set'), async ({ name, value }) => {
        const ownerGhii = vaultOf();
        const r = await putOwnerSecret(storage, config, ownerGhii, name, value);
        if (!r.ok) {
            return { content: [{ type: 'text' as const, text: `${r.code}: ${r.message}` }], isError: true };
        }
        emitChange('secrets', ownerGhii);
        return { content: [{ type: 'text' as const, text: JSON.stringify(r.data, null, 2) }] };
    });

    mcp.tool('aimeat_secret_delete', descriptionFor('aimeat_secret_delete'), {
        name: z.string().describe('The secret to remove, exactly as it was stored.'),
    }, annotationsFor('aimeat_secret_delete'), async ({ name }) => {
        const ownerGhii = vaultOf();
        const r = await deleteOwnerSecret(storage, ownerGhii, name);
        if (!r.ok) {
            return { content: [{ type: 'text' as const, text: `${r.code}: ${r.message}` }], isError: true };
        }
        emitChange('secrets', ownerGhii);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ name, deleted: true }, null, 2) }] };
    });
}
