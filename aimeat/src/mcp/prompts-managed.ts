/**
 * @file prompts-managed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's managed prompts registered as MCP prompts — the primitive a client shows
 *   the PERSON to pick (Claude Code renders them as slash commands), rather than something the model
 *   decides to call. The node has served these from the DB since long before this file; the only way
 *   into them over MCP was aimeat_handbook_get, which the model has to think of. Now the person picks.
 * @structure
 *   - personPickable() — the seed's own `usedIn` decides which prompts a person gets to choose from
 *   - NODE_FILLED — the variables a session already knows, so the person is never asked for them
 *   - registerManagedPrompts() — one MCP prompt per active record a person may pick
 * @usage
 *   import { registerManagedPrompts } from './prompts-managed.js';
 *   await registerManagedPrompts(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial. The prompts primitive had never been used on this node: mcp.prompt
 *     appeared nowhere in src/mcp/, so the server declared tools and resources only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, SystemPromptRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';

/**
 * A managed prompt is offered to a person when its own `usedIn` says the portal's prompt-package
 * picker serves it. That field is the node's record of who consumes each prompt, so this reads a
 * decision the seeds already made instead of inventing a second list beside them.
 *
 * The group is the wrong signal here, and expensively so: `builders` holds both the eleven packages
 * the portal offers a person AND four templates the librarian and living-document services feed to
 * an LLM (`notebook-classify`, `notebook-plan`, `notebook-distribute`, `living-author`, each with
 * `usedIn: ['/v1/librarian/…']`). Those take a `structure` and a `note` from a service and mean
 * nothing as a slash command. `tiers` is excluded by the same rule and belongs excluded: those are
 * agent operating handbooks, which aimeat_handbook_get already serves to the model.
 */
const PICKER_ROUTE = '/v1/portal/prompts/';

/** True when the node's own seed says this prompt is one a person picks from the portal. */
function personPickable(p: SystemPromptRecord): boolean {
    return (p.usedIn ?? []).some(u => u.startsWith(PICKER_ROUTE));
}

/**
 * Variables a session can answer by itself. Anything a prompt declares beyond these becomes an
 * optional argument on the MCP prompt, so a client can offer the person a field for it.
 * `cortex_extensions` costs a query, so it is resolved only for a prompt that asks for it.
 */
const NODE_FILLED = new Set(['node_url', 'node_id', 'gaii', 'owner_name', 'agent_name', 'cortex_extensions']);

/** The active records a person may pick, in a stable order so a client can cache the list. */
async function pickableRecords(storage: Storage): Promise<SystemPromptRecord[]> {
    const all = await storage.listSystemPrompts();
    return all
        .filter(p => p.active && personPickable(p))
        .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Register one MCP prompt per managed prompt a person may pick. Returns how many were registered.
 *
 * Each record's `variables` list splits in two: the ones this session already knows are filled in
 * before the text reaches the person, and the rest become optional arguments. `language` is added on
 * top so a Finnish speaker gets the Finnish body of a prompt that has one, the same way the REST
 * doors resolve it from Accept-Language, which MCP has no equivalent of.
 */
export async function registerManagedPrompts(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): Promise<number> {
    let records: SystemPromptRecord[];
    try {
        records = await pickableRecords(storage);
    } catch (err) {
        // A prompt list the node cannot read costs the person a picker, and costs the session
        // nothing else: the tools are registered either way.
        logger.warn('registerManagedPrompts: serving no prompts this session', { error: String(err) });
        return 0;
    }

    for (const record of records) {
        const asked = (record.variables ?? []).filter(v => !NODE_FILLED.has(v));
        // Every argument is an optional string, so the handler's inferred args stay
        // Record<string, string | undefined> and substituteVariables can take them as they come.
        const argsSchema: Record<string, z.ZodOptional<z.ZodString>> = {
            language: z.string().optional().describe('Language tag for the prompt body, e.g. "fi". Defaults to English.'),
        };
        for (const name of asked) {
            argsSchema[name] = z.string().optional().describe(`Value for {{${name}}} in this prompt.`);
        }

        mcp.registerPrompt(
            record.id,
            {
                title: record.name,
                description: record.description,
                argsSchema,
            },
            async (args: Record<string, string | undefined>) => {
                const { language, ...supplied } = args ?? {};
                const gaii = getAgentGaii();
                // An agent session gives `claude#alice@node`; an owner session gives the GHII
                // `alice@node`, which parseGAII rejects on purpose. Both carry the owner name
                // before the "@", so the prompt is addressed to the right person either way.
                const parsed = parseGAII(gaii);
                const ownerName = parsed?.owner ?? gaii.split('@')[0];

                const known: Record<string, string | undefined> = {
                    node_url: config.baseUrl,
                    node_id: config.nodeId,
                    gaii,
                    owner_name: ownerName,
                    agent_name: parsed?.agent ?? ownerName,
                };

                if ((record.variables ?? []).includes('cortex_extensions')) {
                    try {
                        const extensions = await storage.listCortexExtensions({ status: 'active' });
                        known.cortex_extensions = (extensions ?? []).map(e => `- ${e.name}: ${e.description}`).join('\n');
                    } catch (err) {
                        logger.warn('registerManagedPrompts: cortex list unavailable', { error: String(err) });
                        known.cortex_extensions = '';
                    }
                }

                const body = resolvePromptContent(record, language);
                const text = substituteVariables(body, { ...known, ...supplied });

                return {
                    messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
                };
            },
        );
    }

    return records.length;
}
