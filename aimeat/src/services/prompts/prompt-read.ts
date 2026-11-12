/**
 * @file src/services/prompts/prompt-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The managed prompt reads the prompt routes and the MCP prompt surfaces share (CLAUDE.md,
 *   Backend: one capability, one implementation): one active prompt by its id, and the prompts a
 *   person may pick. Moved out of mcp/prompts.ts and mcp/prompts-managed.ts unchanged.
 * @structure activeSystemPrompt · personPickable · listPickablePrompts
 * @usage const record = await activeSystemPrompt(storage, 'tier-1');
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2): GET /v1/agents/me/handbook,
 *     aimeat_handbook_get and the MCP prompt registration.
 */
import type { Storage, SystemPromptRecord } from '../../storage/interface.js';

/** One prompt by its id, or null when there is none or it is not active. */
export async function activeSystemPrompt(storage: Storage, id: string): Promise<SystemPromptRecord | null> {
    const record = await storage.getSystemPrompt(id);
    return record && record.active ? record : null;
}

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
export function personPickable(p: SystemPromptRecord): boolean {
    return (p.usedIn ?? []).some(u => u.startsWith(PICKER_ROUTE));
}

/** The active records a person may pick, in a stable order so a client can cache the list. */
export async function listPickablePrompts(storage: Storage): Promise<SystemPromptRecord[]> {
    const all = await storage.listSystemPrompts();
    return all
        .filter(p => p.active && personPickable(p))
        .sort((a, b) => a.id.localeCompare(b.id));
}
