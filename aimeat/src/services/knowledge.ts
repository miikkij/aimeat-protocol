import type { Storage } from '../storage/interface.js';

/**
 * Knowledge template seeding — REMOVED.
 *
 * Previously seeded knowledge packager prompt templates into memory.
 * Now the system prompt storage is authoritative (see prompt-defaults.ts
 * for 'knowledge-packager-human' and 'knowledge-packager-agent' entries).
 *
 * This function is kept as a no-op for backward compatibility with server.ts
 * startup sequence. It can be removed once all callers are updated.
 */
export async function seedKnowledgeTemplates(_storage: Storage, _systemGaii: string): Promise<void> {
  // No-op: knowledge packager templates are now managed via system prompt storage
  // (seeded by prompt-seeder.ts from prompt-defaults.ts)
}
