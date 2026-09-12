/**
 * @file src/services/prompt-ownership.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who owns a managed system prompt: the operator, the code, or nobody any more.
 *
 *   THE RULE EXISTED AND WAS INVISIBLE. The seeder has always divided prompts in two — a few
 *   groups and ids are rewritten from source on EVERY boot, and everything else keeps whatever the
 *   operator typed — but the division lived in two local consts inside seedSystemPrompts(), so the
 *   admin page could not say which kind an operator was looking at. An operator editing a prompt in
 *   a synced group watched their work disappear at the next deploy with nothing on screen to
 *   explain it. The rule moves here so the seeder and the page read the same one.
 *
 *   THREE KINDS, AND THE THIRD IS NOT A BUG IN THE RULE. A node keeps prompts a later version of
 *   the software no longer ships: the seeder only inserts and updates, it never deletes, so a
 *   prompt whose seed was removed is served forever exactly as stored. It cannot be reset (there is
 *   no factory text to reset to) and it never follows an update. The page needs to say that rather
 *   than offer a button that answers 404.
 * @structure PROMPT_SYNC_GROUPS · PROMPT_SYNC_IDS · promptSourceKind · promptDiffersFromDefault
 * @usage
 *   import { promptSourceKind, promptDiffersFromDefault } from './prompt-ownership.js';
 *   const kind = promptSourceKind(record.id, record.group);   // 'code' | 'yours' | 'orphan'
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the System Prompts page in the poster face.
 */
import { PROMPT_SEEDS } from './prompt-defaults.js';
import type { SystemPromptRecord } from '../storage/interface.js';

/**
 * Groups whose content is written from source on every boot. These describe what the software can
 * do — the agent handbook, the app builders, the generator — so a node serving last month's text
 * hands an AI names and flows it no longer has.
 */
export const PROMPT_SYNC_GROUPS: readonly string[] = ['generator', 'builders', 'tiers'];

/** Individual prompts synced for the same reason, in groups that are otherwise the operator's. */
export const PROMPT_SYNC_IDS: readonly string[] = ['site-portal', 'bootstrap-anon', 'surface-layout'];

/** What an update does to this prompt, which is the fact an operator needs before they type. */
export type PromptSourceKind =
    /** Written from source on every boot: an operator's edit survives only in the version history. */
    | 'code'
    /** The operator's. No update ever writes over it; taking the current version is the only way in. */
    | 'yours'
    /** The software no longer ships it. Served as stored, for good; there is no current version. */
    | 'orphan';

const SEED_BY_ID = new Map(PROMPT_SEEDS.map(s => [s.id, s]));

/** Which of the three kinds this prompt is. The id decides it, with the group as the second test. */
export function promptSourceKind(id: string, group: string): PromptSourceKind {
    if (!SEED_BY_ID.has(id)) return 'orphan';
    if (PROMPT_SYNC_GROUPS.includes(group) || PROMPT_SYNC_IDS.includes(id)) return 'code';
    return 'yours';
}

/**
 * Whether the stored text is different from the one the software ships.
 *
 * The VERSION NUMBER CANNOT ANSWER THIS, which is why the page asks here: taking the current
 * version raises the number too, so an untouched prompt can read v3. A prompt the software no
 * longer ships has nothing to compare against and is never "different".
 *
 * The language overrides count: a Finnish text written where the seed has none is a difference an
 * operator made, and taking the current version would drop it.
 */
export function promptDiffersFromDefault(record: Pick<SystemPromptRecord, 'id' | 'content' | 'locales'>): boolean {
    const seed = SEED_BY_ID.get(record.id);
    if (!seed) return false;
    if (record.content !== seed.content) return true;
    const stored = Object.entries(record.locales ?? {}).filter(([, v]) => typeof v === 'string' && v.length > 0);
    const shipped = Object.entries(seed.locales ?? {}).filter(([, v]) => typeof v === 'string' && v.length > 0);
    if (stored.length !== shipped.length) return true;
    const shippedMap = new Map(shipped);
    return stored.some(([tag, text]) => shippedMap.get(tag) !== text);
}
