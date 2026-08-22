/**
 * @file src/services/proactive-mode.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Proactive guidance: whether the AIs connected to this account are equipped to offer
 *   what this node makes possible, or stay silent until asked. One owner memory key,
 *   `settings.proactive`, and the text that goes into an agent's context when it is on.
 *
 *   THE NODE EQUIPS, IT DOES NOT TRIGGER. Two earlier designs computed a situation snapshot, matched
 *   rules against it and attached a suggestion to a tool result. Both fail on the same thing: the
 *   node sees that a workspace holds 47 documents, and cannot see that the person is mid-task, in a
 *   hurry, fixing a mistake, or has already turned this down. The chat sees all of that for free.
 *   So the guidance carries the repertoire and the timing discipline, and the chat picks the moment.
 *   Nothing here decides when anything is said.
 *
 *   ABSENT MEANS ON. A new account is equipped without anything being written for it, and no
 *   migration is needed for accounts that already exist. Switching it off writes the key; switching
 *   it back on rewrites it rather than deleting, so `by` and `at` survive as a record of the choice.
 *
 *   `by` IS NOT GUESSED. A person flipping the switch in settings goes through the route, which
 *   stamps 'person'. An AI flipping it for them writes the key directly and is told to include
 *   `"by":"ai"` — the surface shows who acted. When the field is absent it stays null and the
 *   surface says nothing, because inventing an answer to "who did this" is worse than not having it.
 * @structure PROACTIVE_KEY · ProactiveMode · readProactiveMode · writeProactiveMode ·
 *   proactiveGuidance
 * @usage
 *   import { readProactiveMode, proactiveGuidance } from '../services/proactive-mode.js';
 *   const guidance = await proactiveGuidance(storage, config, owner);
 * @version-history
 *   v1.0.0 — 2026-08-22 — Initial: the mode, its key, and the guidance an equipped agent reads.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { PROACTIVE_GUIDANCE_ID, PROACTIVE_GUIDANCE_TEXT } from './prompt-defaults/proactive.js';

/** The one key. Named for what a person calls it, because their AI reads this name aloud. */
export const PROACTIVE_KEY = 'settings.proactive';

/** Who flipped the switch. Null when the record does not say, which is not the same as 'person'. */
export type ProactiveSetBy = 'person' | 'ai' | null;

export interface ProactiveMode {
    /** What actually happens: the owner's choice, unless this node's operator turned it off. */
    enabled: boolean;
    /** True when nothing has been chosen and this is the default. */
    defaulted: boolean;
    /** The owner's own choice, ignoring the operator switch. Lets a surface explain a forced off. */
    ownerChoice: boolean;
    /** False when the operator switched this off node-wide; no owner can turn it back on. */
    availableHere: boolean;
    setBy: ProactiveSetBy;
    setAt: string | null;
}

function ghiiOf(config: AimeatConfig, owner: string): string {
    return `${owner}@${config.nodeId}`;
}

function setByOf(value: unknown): ProactiveSetBy {
    return value === 'person' || value === 'ai' ? value : null;
}

/**
 * This account's proactive-guidance setting.
 *
 * Never throws: a storage failure reads as the default rather than taking down whatever asked. The
 * safe direction here is ON, because the failure mode of a missed read is an agent that offers
 * nothing — the state this feature exists to end.
 */
export async function readProactiveMode(
    storage: Storage, config: AimeatConfig, owner: string,
): Promise<ProactiveMode> {
    const availableHere = config.proactiveGuidanceEnabled !== false;
    let row: Awaited<ReturnType<Storage['getMemory']>> = null;
    try {
        row = await storage.getMemory(ghiiOf(config, owner), PROACTIVE_KEY);
    } catch (err) {
        logger.warn('proactive-mode: setting unreadable, using the default', {
            owner, error: String(err),
        });
    }

    const value = (row?.value ?? null) as { enabled?: unknown; by?: unknown; at?: unknown } | null;
    const chosen = typeof value?.enabled === 'boolean' ? value.enabled : null;
    const ownerChoice = chosen ?? true;

    return {
        enabled: availableHere && ownerChoice,
        defaulted: chosen === null,
        ownerChoice,
        availableHere,
        setBy: setByOf(value?.by),
        setAt: typeof value?.at === 'string' ? value.at : null,
    };
}

/**
 * Write the owner's choice. `by` is what the caller knows, not what it assumes: the settings route
 * knows a person clicked it, and passes 'person'.
 */
export async function writeProactiveMode(
    storage: Storage, config: AimeatConfig, owner: string,
    enabled: boolean, by: Exclude<ProactiveSetBy, null>,
): Promise<ProactiveMode> {
    const gaii = ghiiOf(config, owner);
    const now = new Date().toISOString();
    const existing = await storage.getMemory(gaii, PROACTIVE_KEY);
    await storage.setMemory({
        key: PROACTIVE_KEY,
        ownerGaii: gaii,
        value: { enabled, by, at: now },
        visibility: 'owner',
        tags: ['settings'],
        ttlHours: null,                     // the TTL job would otherwise restore the default
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
    return readProactiveMode(storage, config, owner);
}

/**
 * The guidance text for this account, or null when the mode is off.
 *
 * The text is a managed prompt so an operator can correct the wording without a deploy, and the
 * seeded constant is the fallback for a node whose prompt row is missing or switched off. One text,
 * read by both the MCP handshake and the handbook, so the two never drift apart.
 *
 * Never throws, and never blocks a connection: anything unexpected here means no guidance, which
 * costs an offer rather than a session.
 */
export async function proactiveGuidance(
    storage: Storage, config: AimeatConfig, owner: string | undefined,
): Promise<string | null> {
    if (!owner) return null;
    try {
        const mode = await readProactiveMode(storage, config, owner);
        if (!mode.enabled) return null;
        const record = await storage.getSystemPrompt(PROACTIVE_GUIDANCE_ID);
        if (record?.active && record.content.trim()) return record.content;
        return PROACTIVE_GUIDANCE_TEXT;
    } catch (err) {
        logger.warn('proactive-mode: guidance unavailable, continuing without it', {
            owner, error: String(err),
        });
        return null;
    }
}
