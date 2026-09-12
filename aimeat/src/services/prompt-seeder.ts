/**
 * @file src/services/prompt-seeder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Seeds managed system prompts into storage on startup from the factory
 *   defaults (PROMPT_SEEDS). New prompts are inserted at version 1; existing prompts get
 *   metadata refreshed but admin-edited content is preserved — except code-owned groups
 *   (generator/builders/tiers) and specific ids that are always re-synced from source.
 *
 * @structure
 *   - seedSystemPrompts(storage): upsert seeds, insert-or-update, and version new inserts
 *
 * @version-history
 *   v1.1.0 — 2026-09-12 — The two lists that decide whether a prompt is rewritten from source move
 *     to prompt-ownership.ts, unchanged. The admin page reads the same rule, so it can tell an
 *     operator whose prompt they are editing before they spend an hour on one the next deploy
 *     overwrites.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { PROMPT_SEEDS } from './prompt-defaults.js';
import { promptSourceKind } from './prompt-ownership.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/**
 * Seed system prompts on startup.
 * - New prompts (not in storage) are inserted with version 1.
 * - Existing prompts get their metadata (usedIn, variables) updated but content is NOT overwritten.
 */
export async function seedSystemPrompts(storage: Storage): Promise<void> {
  let inserted = 0;
  let updated = 0;

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
      if (promptSourceKind(seed.id, seed.group) === 'code' && existing.content !== seed.content) {
        metaUpdate.content = seed.content;
        metaUpdate.updatedAt = new Date().toISOString();
        logger.info(`System prompt "${seed.id}" content synced from seed (${seed.content.length} chars)`);
      }

      await storage.upsertSystemPrompt(metaUpdate as unknown as import('../storage/interface.js').SystemPromptRecord);
      updated++;
    }
  }

  if (inserted > 0 || updated > 0) {
    logger.info(`System prompts: ${inserted} seeded, ${updated} metadata-updated`);
  }
}
