import { PROMPT_SEEDS } from './prompt-defaults.js';
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
      const metaUpdate: Record<string, unknown> = {
        ...existing,
        group: seed.group,
        name: seed.name,
        description: seed.description,
        variables: seed.variables,
        usedIn: seed.usedIn,
      };

      // For generator prompts at version 1 (never edited by admin): also update content.
      // This allows fixing seed content bugs without requiring manual "Reset to factory default".
      if (seed.group === 'generator' && existing.version === 1 && existing.content !== seed.content) {
        (metaUpdate as { content: string }).content = seed.content;
        logger.info(`Generator prompt "${seed.id}" content updated (was version 1, never edited)`);
      }

      await storage.upsertSystemPrompt(metaUpdate as typeof existing);
      updated++;
    }
  }

  if (inserted > 0 || updated > 0) {
    logger.info(`System prompts: ${inserted} seeded, ${updated} metadata-updated`);
  }
}
