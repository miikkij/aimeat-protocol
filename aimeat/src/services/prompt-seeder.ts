/**
 * @file src/services/prompt-seeder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Seeds managed system prompts into storage on startup from the factory
 *   defaults (PROMPT_SEEDS). New prompts are inserted at version 1; existing prompts get
 *   metadata refreshed. Content follows three rules:
 *
 *     code-owned (generator/builders/tiers and a few ids) → always re-synced from source
 *     nobody changed it on this node                      → takes this build's text, as a new version
 *     an operator changed it                              → kept exactly as they left it
 *
 *   WHAT WENT WRONG WITH KEEP-EVERYTHING. The middle rule used to be "keep": every prompt that was
 *   not code-owned kept its first seed forever, so a fix to its text reached no node that already had
 *   it. On 2026-08-23 micro-memory was removed from the code, and `bootstrap-auth` and
 *   `anonymous-share` went on telling agents to use it on every node seeded before that day.
 *
 *   HOW "NOBODY CHANGED IT" IS KNOWN. Every write of a prompt's text leaves a version entry, and the
 *   entry says who wrote it. The newest entry is a factory write when the seeder wrote it
 *   (`changedBy: 'system'`) or an operator pressed reset to factory default (admin-prompts.ts, whose
 *   notes begin "Reset"); if the stored text is still that entry's text, nobody has changed it
 *   since. An edit, a language override or a restore of an old version writes a newer entry by the
 *   operator, and from then on the prompt is theirs. A prompt from before version entries existed
 *   follows only if its record still says the system wrote it. `decidePromptContent` is the pure
 *   decision.
 *
 *   A SHIPPED TEXT IS EVIDENCE TOO (Jouni, 2026-10-16). A stored text that is exactly one of the
 *   texts the prompt has shipped with (prompt-defaults/shipped-hashes.ts) is a text nobody wrote on
 *   this node. That answers where the version history cannot: after a restore from a backup, after
 *   the history was pruned, or for a record that names an operator and has no version entry. Such a
 *   prompt follows, unless its newest version entry is the operator writing this very text (a
 *   restore of an old version), which is a choice they made. A text that matches no shipped text
 *   and no factory version is the operator's, and a stored prompt the software does not ship is
 *   never read here. The start log names each prompt that takes the new text.
 *
 * @structure
 *   - decidePromptContent(existing, seed, newest, kind, shipped): 'keep' | 'code-sync' | 'follow'
 *   - seedSystemPrompts(storage, opts): upsert seeds, insert-or-update, and version what changes
 *
 * @version-history
 *   v1.3.0 — 2026-10-16 — A stored text that is one of the prompt's shipped default texts (by hash,
 *     prompt-defaults/shipped-hashes.ts) follows the current default unless the operator's own newest
 *     version entry wrote that text, and the start log names every prompt that took the new text (Jouni, decision 2026-10-16).
 *   v1.2.0 — 2026-09-15 — A prompt nobody changed on this node follows this build's text, with a
 *     version entry, instead of keeping its first seed for good.
 *   v1.1.0 — 2026-09-12 — The two lists that decide whether a prompt is rewritten from source move
 *     to prompt-ownership.ts, unchanged. The admin page reads the same rule, so it can tell an
 *     operator whose prompt they are editing before they spend an hour on one the next deploy
 *     overwrites.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { PROMPT_SEEDS } from './prompt-defaults.js';
import { promptSourceKind, type PromptSourceKind } from './prompt-ownership.js';
import { isShippedDefaultText, SHIPPED_PROMPT_HASHES } from './prompt-defaults/shipped-hashes.js';
import type { Storage, SystemPromptRecord, SystemPromptVersionRecord } from '../storage/interface.js';
import { stableStringify } from '../utils/stable-json.js';
import { logger } from '../utils/logger.js';

/** What happens to one existing prompt's text this startup. */
export type PromptContentAction = 'keep' | 'code-sync' | 'follow';

type SeedText = { content: string; locales?: Record<string, string> };

/** A version entry the software wrote: the seeder itself, or an operator's reset to factory default. */
function isFactoryWrite(entry: Pick<SystemPromptVersionRecord, 'changedBy' | 'changeNote'>): boolean {
  return entry.changedBy === 'system' || (entry.changeNote ?? '').startsWith('Reset');
}

/**
 * Decide what happens to one existing prompt's text, from what is stored, what ships, the newest
 * version entry (null when the prompt has none), and whether the stored text is one of the texts
 * the prompt has shipped with (`shipped`).
 */
export function decidePromptContent(
  existing: Pick<SystemPromptRecord, 'content' | 'locales' | 'updatedBy'>,
  seed: SeedText,
  newest: Pick<SystemPromptVersionRecord, 'content' | 'changedBy' | 'changeNote'> | null,
  kind: PromptSourceKind,
  shipped = false,
): PromptContentAction {
  const sameText = existing.content === seed.content
    && stableStringify(existing.locales ?? {}) === stableStringify(seed.locales ?? {});
  if (kind === 'code') return existing.content !== seed.content ? 'code-sync' : 'keep';
  if (sameText) return 'keep';
  // A shipped text follows, unless the newest version entry is the operator writing this very text
  // (a restore of an old version, or a save they made on purpose): that is a choice, not a leftover.
  const operatorChoseIt = !!newest && !isFactoryWrite(newest) && newest.content === existing.content;
  if (shipped && !operatorChoseIt) return 'follow';
  const untouched = newest
    ? isFactoryWrite(newest) && newest.content === existing.content
    : existing.updatedBy === 'system';
  return untouched ? 'follow' : 'keep';
}

/**
 * Seed system prompts on startup.
 * - New prompts (not in storage) are inserted with version 1.
 * - Existing prompts get their metadata refreshed, and their text by decidePromptContent.
 * `opts.shippedHashes` replaces the list of shipped default texts, for a test.
 */
export async function seedSystemPrompts(
  storage: Storage, opts: { shippedHashes?: Readonly<Record<string, readonly string[]>> } = {},
): Promise<void> {
  const shippedHashes = opts.shippedHashes ?? SHIPPED_PROMPT_HASHES;
  let inserted = 0;
  let updated = 0;
  const followedIds: string[] = [];

  for (const seed of PROMPT_SEEDS) {
    const existing = await storage.getSystemPrompt(seed.id);
    if (!existing) {
      // First-time seed
      const now = new Date().toISOString();
      await storage.upsertSystemPrompt({
        id: seed.id,
        group: seed.group,
        name: seed.name,
        description: seed.description,
        content: seed.content,
        active: true,
        variables: seed.variables,
        usedIn: seed.usedIn,
        // Factory translations travel with the first insert only. On every later boot the branch
        // below runs instead, and it does not carry `locales` — so an operator's Finnish edit is
        // never reverted by a deploy, exactly as their English edit is not.
        locales: seed.locales,
        version: 1,
        updatedAt: now,
        updatedBy: 'system',
      });
      await storage.createSystemPromptVersion({
        promptId: seed.id,
        version: 1,
        content: seed.content,
        changedBy: 'system',
        changedAt: now,
        changeNote: 'Initial seed from factory defaults',
      });
      inserted++;
    } else {
      // Update metadata (usedIn, variables, name, description, group)
      const metaUpdate = {
        ...existing,
        group: seed.group,
        name: seed.name,
        description: seed.description,
        variables: seed.variables,
        usedIn: seed.usedIn,
      };

      // Always update generator and builder prompt content from seeds.
      // These prompts are code — they must match the source code version.
      // Admin edits are preserved in version history and can be restored.
      // The two lists moved to prompt-ownership.ts on 2026-09-12, unchanged: the admin page has to
      // tell an operator which kind of prompt they are editing, and a second copy of this rule
      // there would drift from this one the day a group is added.
      const kind = promptSourceKind(seed.id, seed.group);
      // The version history is read only when it can decide something: a code prompt or an
      // unchanged text never needs it, and this runs for every prompt at every boot.
      const needsHistory = kind !== 'code'
        && (existing.content !== seed.content || stableStringify(existing.locales ?? {}) !== stableStringify(seed.locales ?? {}));
      const shipped = needsHistory && isShippedDefaultText(seed.id, existing, shippedHashes);
      const newest = needsHistory ? (await storage.getSystemPromptVersions(seed.id))[0] ?? null : null;
      const action = decidePromptContent(existing, seed, newest, kind, shipped);

      if (action === 'code-sync') {
        metaUpdate.content = seed.content;
        metaUpdate.updatedAt = new Date().toISOString();
        logger.info(`System prompt "${seed.id}" content synced from seed (${seed.content.length} chars)`);
      }

      let followedVersion: number | null = null;
      if (action === 'follow') {
        const now = new Date().toISOString();
        followedVersion = existing.version + 1;
        Object.assign(metaUpdate, {
          content: seed.content, locales: seed.locales, version: followedVersion, updatedAt: now, updatedBy: 'system',
        });
        logger.info(`System prompt "${seed.id}" was not changed on this node${shipped ? ' (its text is a shipped default)' : ''}: took this build's text as v${followedVersion}`);
      }

      await storage.upsertSystemPrompt(metaUpdate as unknown as SystemPromptRecord);
      if (followedVersion !== null) {
        await storage.createSystemPromptVersion({
          promptId: seed.id,
          version: followedVersion,
          content: seed.content,
          locales: seed.locales,
          changedBy: 'system',
          changedAt: metaUpdate.updatedAt,
          changeNote: 'Updated to the factory default of this build',
        });
        await storage.pruneSystemPromptVersions(seed.id, 50);
        followedIds.push(seed.id);
      }
      updated++;
    }
  }

  if (inserted > 0 || updated > 0) {
    logger.info(`System prompts: ${inserted} seeded, ${updated} metadata-updated, ${followedIds.length} took this build's text${followedIds.length ? `: ${followedIds.join(', ')}` : ''}`);
  }
}
