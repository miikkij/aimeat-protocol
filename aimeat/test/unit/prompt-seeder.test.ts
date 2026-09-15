/**
 * @file prompt-seeder.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Server-less tests for how the boot seeder treats the text of a prompt that is not
 *   code-owned. A prompt nobody changed on this node takes the newer shipped text; a prompt an
 *   operator changed is left exactly as they left it.
 *
 *   The state the first case builds is the one found on 2026-09-15: bootstrap-auth was seeded before
 *   micro-memory was removed, and it went on telling agents to use micro-memory on that node.
 * @usage cd aimeat && pnpm vitest run test/unit/prompt-seeder.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-15 — initial: follow an untouched prompt, keep an edit, follow after a reset,
 *     leave a code prompt to its own rule.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { PROMPT_SEEDS } from '../../src/services/prompt-defaults.js';
import { seedSystemPrompts, decidePromptContent } from '../../src/services/prompt-seeder.js';

const ID = 'bootstrap-auth';
const OLD = 'Use /v1/mm for micro-memory. (the text before 2026-08-23)';

async function seededStorage(): Promise<Storage> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  await seedSystemPrompts(storage);
  return storage;
}

/** Put the prompt back to what an earlier build seeded: its first version, written by the system. */
async function rewindToOldSeed(storage: Storage): Promise<void> {
  const record = (await storage.getSystemPrompt(ID))!;
  await storage.deleteAllSystemPrompts();
  await storage.upsertSystemPrompt({ ...record, content: OLD, locales: undefined, version: 1, updatedBy: 'system' });
  await storage.createSystemPromptVersion({
    promptId: ID, version: 1, content: OLD, changedBy: 'system', changedAt: record.updatedAt,
    changeNote: 'Initial seed from factory defaults',
  });
}

const seedText = () => PROMPT_SEEDS.find(s => s.id === ID)!;

describe('a prompt nobody changed on this node', () => {
  it('takes this build\'s text at the next boot, as a new version', async () => {
    const storage = await seededStorage();
    await rewindToOldSeed(storage);

    await seedSystemPrompts(storage);

    const after = (await storage.getSystemPrompt(ID))!;
    expect(after.content).toBe(seedText().content);
    expect(after.version).toBe(2);
    const versions = await storage.getSystemPromptVersions(ID);
    expect(versions[0]).toMatchObject({ version: 2, changedBy: 'system', content: seedText().content });
    expect(versions.some(v => v.content === OLD)).toBe(true);
  });

  it('makes no new version on a later boot when the text already matches', async () => {
    const storage = await seededStorage();
    await rewindToOldSeed(storage);
    await seedSystemPrompts(storage);
    await seedSystemPrompts(storage);
    expect((await storage.getSystemPrompt(ID))!.version).toBe(2);
  });
});

describe('a prompt an operator changed', () => {
  it('is kept exactly as they left it', async () => {
    const storage = await seededStorage();
    await rewindToOldSeed(storage);
    const edited = 'Our own wording, written on this node.';
    const record = (await storage.getSystemPrompt(ID))!;
    await storage.upsertSystemPrompt({ ...record, content: edited, version: 2, updatedBy: 'operator-alice' });
    await storage.createSystemPromptVersion({
      promptId: ID, version: 2, content: edited, changedBy: 'operator-alice', changedAt: record.updatedAt, changeNote: 'tone',
    });

    await seedSystemPrompts(storage);

    const after = (await storage.getSystemPrompt(ID))!;
    expect(after.content).toBe(edited);
    expect(after.version).toBe(2);
  });
});

describe('decidePromptContent', () => {
  const seed = { content: 'new', locales: { fi: 'uusi' } };

  it('follows after an operator reset to factory default, because the text is still the shipped one', () => {
    const existing = { content: 'old', locales: undefined, updatedBy: 'alice' };
    expect(decidePromptContent(existing, seed, { content: 'old', changedBy: 'alice', changeNote: 'Reset to factory default' }, 'yours')).toBe('follow');
  });

  it('keeps a language override the operator added, even with the English untouched', () => {
    const existing = { content: 'new', locales: { fi: 'oma' }, updatedBy: 'alice' };
    expect(decidePromptContent(existing, seed, { content: 'new', changedBy: 'alice', changeNote: undefined }, 'yours')).toBe('keep');
  });

  it('keeps a restored old version', () => {
    const existing = { content: 'old', locales: undefined, updatedBy: 'alice' };
    expect(decidePromptContent(existing, seed, { content: 'old', changedBy: 'alice', changeNote: 'Restored from version 1' }, 'yours')).toBe('keep');
  });

  it('follows a prompt from before version entries only when the system wrote it last', () => {
    expect(decidePromptContent({ content: 'old', updatedBy: 'system' }, seed, null, 'yours')).toBe('follow');
    expect(decidePromptContent({ content: 'old', updatedBy: 'alice' }, seed, null, 'yours')).toBe('keep');
  });

  it('leaves a code prompt to its own rule', () => {
    expect(decidePromptContent({ content: 'old', updatedBy: 'alice' }, seed, null, 'code')).toBe('code-sync');
    expect(decidePromptContent({ content: 'new', updatedBy: 'alice' }, seed, null, 'code')).toBe('keep');
  });
});
