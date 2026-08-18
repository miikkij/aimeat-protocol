/**
 * @file workspace-write-items.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared normalisation for workspace draft writes — the part `aimeat_workspace_write`
 *   does identically on all three MCP surfaces (the node-hosted server, the `aimeat connect` CLI
 *   server, and the tool-call definition table). One call may carry ONE item (space + value) or a
 *   BATCH (`items: [...]`), and a batch matters for more than round trips: an MCP client asks the
 *   human to approve every tool CALL, so migrating twenty documents one call at a time is twenty
 *   approval prompts — and one unanswered prompt ends the migration half-done.
 *
 *   The batch is all-or-nothing at the RESOLVE stage: every item is checked (space exists, is
 *   memory-backed, has an id where one is required) before anything is written. Documents get an
 *   auto-generated id when the caller gives none, so a half-written batch that the caller retries
 *   would otherwise duplicate the documents that already landed.
 * @structure MAX_BATCH_ITEMS · genDocId() · normalizeWriteItems() · resolveWriteItem()
 * @usage const norm = normalizeWriteItems({ space, value, id, section, items });
 *   if ('error' in norm) return fail(norm.error);
 *   const resolved = norm.items.map(it => resolveWriteItem(it, objectTypes));
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial: batch normalisation shared by the three workspace_write surfaces.
 */

import { isMemoryBackedSpace } from './workspace-meta.js';

/** One tool call may carry this many items. Past this the caller should split the migration. */
export const MAX_BATCH_ITEMS = 50;

/** An objectType as the manifest declares it (only the fields a write needs). */
export interface WriteObjectType {
    name?: string;
    namespace?: string;
    mode?: string;
    kind?: string;
    backing?: string;
}

/** One requested write, after the top-level defaults have been folded in. */
export interface WriteItemInput {
    space: string;
    value: unknown;
    id?: string;
    section?: string;
}

/** A write the caller may perform: the space is real, memory-backed, and the id is settled. */
export interface ResolvedWriteItem {
    space: string;
    namespace: string;
    instanceId: string;
    isDoc: boolean;
    value: unknown;
    section?: string;
}

/** Document ids are generated when the caller gives none — unique per item within a batch. */
export function genDocId(): string {
    return 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Fold a call's arguments into a list of items. Single-item and batch calls come out the same shape,
 * so every surface has one code path below this line.
 *
 * `items` entries inherit `space` and `section` from the top level, which is what a migration into
 * one space actually looks like — the caller repeats only what differs.
 */
export function normalizeWriteItems(args: {
    space?: unknown;
    value?: unknown;
    id?: unknown;
    section?: unknown;
    items?: unknown;
}): { items: WriteItemInput[] } | { error: string } {
    const topSpace = typeof args.space === 'string' ? args.space.trim() : '';
    const topSection = typeof args.section === 'string' ? args.section.trim() : '';

    if (args.items !== undefined && args.items !== null) {
        // Some clients JSON-stringify an array param; accept that rather than failing on a string.
        let raw = args.items;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch { return { error: '`items` must be an array of objects (it arrived as a string that is not JSON).' }; }
        }
        if (!Array.isArray(raw)) return { error: '`items` must be an ARRAY of { space?, id?, value, section? } objects.' };
        if (raw.length === 0) return { error: '`items` is empty — pass at least one item, or use `value` for a single write.' };
        if (raw.length > MAX_BATCH_ITEMS) {
            return { error: `\`items\` holds ${raw.length} entries; the cap is ${MAX_BATCH_ITEMS} per call. Split the migration into batches of ${MAX_BATCH_ITEMS}.` };
        }
        const items: WriteItemInput[] = [];
        for (let i = 0; i < raw.length; i++) {
            const it = raw[i] as Record<string, unknown> | null;
            if (!it || typeof it !== 'object' || Array.isArray(it)) return { error: `items[${i}] must be an object with a \`value\`.` };
            const space = typeof it.space === 'string' && it.space.trim() ? it.space.trim() : topSpace;
            if (!space) return { error: `items[${i}] has no \`space\`, and no top-level \`space\` was given to fall back on.` };
            if (it.value === undefined || it.value === null) return { error: `items[${i}] has no \`value\`.` };
            const section = typeof it.section === 'string' && it.section.trim() ? it.section.trim() : topSection;
            items.push({
                space,
                value: it.value,
                ...(typeof it.id === 'string' && it.id.trim() ? { id: it.id.trim() } : {}),
                ...(section ? { section } : {}),
            });
        }
        return { items };
    }

    if (!topSpace) return { error: 'Pass `space` + `value` for one write, or `items: [...]` for several.' };
    if (args.value === undefined || args.value === null) return { error: 'Pass `value` for one write, or `items: [...]` for several.' };
    return {
        items: [{
            space: topSpace,
            value: args.value,
            ...(typeof args.id === 'string' && args.id.trim() ? { id: args.id.trim() } : {}),
            ...(topSection ? { section: topSection } : {}),
        }],
    };
}

/**
 * Check one item against the workspace manifest and settle its id. Returns the resolved write or a
 * message written for the agent that has to fix the call. `at` names the item in a batch, so the
 * caller learns WHICH of twenty documents was wrong instead of that "the batch" failed.
 */
export function resolveWriteItem(
    item: WriteItemInput,
    objectTypes: WriteObjectType[],
    at?: string,
): ResolvedWriteItem | { error: string } {
    const where = at ? `${at}: ` : '';
    const ot = objectTypes.find(o => o.name === item.space || o.namespace === item.space);
    if (!ot || !ot.namespace) {
        const names = objectTypes.map(o => o.name).filter(Boolean).join(', ');
        return { error: `${where}No space named "${item.space}" in this workspace. Available spaces: ${names || '(none)'}. Pass the space NAME, not its namespace.` };
    }
    // A non-memory space's data does NOT live in workspace records — writing it here would store
    // memory keys that no read surface ever lists. That silent black hole is how 16 published
    // documents once went invisible, so it is refused loudly instead.
    if (!isMemoryBackedSpace(ot)) {
        return {
            error: ot.backing === 'tasks'
                ? `${where}Space "${ot.name}" is backed by the task system (backing:'tasks') — create tasks with the task tools, not workspace writes.`
                : `${where}Space "${ot.name}" has backing '${ot.backing}', which workspace writes do not support. Update the space to backing:'memory' (aimeat_workspace_update); files and knowledge packages attach via workspace Sources or embedded document images.`,
        };
    }
    // Old manifests declared documents as kind:'document' without a mode — honour the intent.
    const isDoc = ot.mode === 'document' || (!ot.mode && ot.kind === 'document');
    const fromValue = item.value && typeof item.value === 'object' && !Array.isArray(item.value)
        ? String((item.value as Record<string, unknown>).id ?? '').trim()
        : '';
    let instanceId = item.id || fromValue;
    if (!instanceId && isDoc) instanceId = genDocId();
    if (!instanceId) return { error: `${where}A records write needs an id (pass \`id\`, or include \`id\` in \`value\`).` };
    return {
        space: ot.name || item.space,
        namespace: ot.namespace,
        instanceId,
        isDoc,
        value: item.value,
        ...(item.section ? { section: item.section } : {}),
    };
}
