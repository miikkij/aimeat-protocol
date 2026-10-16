/**
 * @file test/unit/prompt-shipped-hashes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A managed prompt whose stored text is one of its shipped default texts takes the
 *   current default at start; a text the operator changed is kept; a stored prompt the software does
 *   not ship is not touched. And the rule that keeps the list of shipped texts true: every operator
 *   prompt's current text has its hash in prompt-defaults/shipped-hashes.ts, so a default text cannot
 *   change without its hash (Jouni, decision 2026-10-16).
 *
 *   Fail-first: before the seeder read the hash list, the first case below kept the old text,
 *   because its record names an operator and has no version entry, and the version rule alone keeps
 *   that.
 * @usage cd aimeat && pnpm exec vitest run test/unit/prompt-shipped-hashes.test.ts
 * @version-history
 *   2026-10-16 — Initial (Jouni, decision 2026-10-16).
 */
import { describe, it, expect, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { PROMPT_SEEDS } from '../../src/services/prompt-defaults.js';
import { promptSourceKind } from '../../src/services/prompt-ownership.js';
import { decidePromptContent, seedSystemPrompts } from '../../src/services/prompt-seeder.js';
import { logger } from '../../src/utils/logger.js';
import { SHIPPED_PROMPT_HASHES, isShippedDefaultText, promptTextHash } from '../../src/services/prompt-defaults/shipped-hashes.js';

const ID = 'email-mcp';
const OLD = 'The Email prompt as an earlier release shipped it.';
const current = () => PROMPT_SEEDS.find(s => s.id === ID)!;
/** The real list, with OLD added as one more shipped text of the Email prompt. */
const withOld = { ...SHIPPED_PROMPT_HASHES, [ID]: [promptTextHash({ content: OLD }), ...SHIPPED_PROMPT_HASHES[ID]] };

async function seededStorage(): Promise<Storage> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  await seedSystemPrompts(storage);
  return storage;
}

/**
 * Store `content` as the prompt, the way a node restored from a backup holds it: the record names an
 * operator, and there is no version entry to say who wrote the text.
 */
async function storeWithoutHistory(storage: Storage, content: string): Promise<void> {
  const record = (await storage.getSystemPrompt(ID))!;
  await storage.deleteAllSystemPrompts();
  await storage.upsertSystemPrompt({ ...record, content, locales: undefined, version: 3, updatedBy: 'operator-alice' });
}

describe('the seeder and the shipped default texts', () => {
  it('replaces a stored text that is a shipped default with the current default, and names it in the log', async () => {
    const storage = await seededStorage();
    await storeWithoutHistory(storage, OLD);

    const info = vi.spyOn(logger, 'info');
    let lines: string[];
    try {
      await seedSystemPrompts(storage, { shippedHashes: withOld });
      lines = info.mock.calls.map(c => String(c[0]));
    } finally { info.mockRestore(); }

    expect(lines).toContain(`System prompt "${ID}" was not changed on this node (its text is a shipped default): took this build's text as v4`);
    expect(lines.some(l => l.endsWith(`took this build's text: ${ID}`))).toBe(true);
    const after = (await storage.getSystemPrompt(ID))!;
    expect(after.content).toBe(current().content);
    expect(after.version).toBe(4);
    expect(after.updatedBy).toBe('system');
    expect((await storage.getSystemPromptVersions(ID))[0]).toMatchObject({ version: 4, changedBy: 'system', content: current().content });
  });

  it('keeps the same text when its hash is not on the list, as before', async () => {
    const storage = await seededStorage();
    await storeWithoutHistory(storage, OLD);
    await seedSystemPrompts(storage);
    expect((await storage.getSystemPrompt(ID))!.content).toBe(OLD);
  });

  it('keeps a text the operator changed', async () => {
    const storage = await seededStorage();
    const edited = `${OLD} With our own last sentence.`;
    await storeWithoutHistory(storage, edited);
    await seedSystemPrompts(storage, { shippedHashes: withOld });
    expect((await storage.getSystemPrompt(ID))!.content).toBe(edited);
  });

  it('keeps a shipped text the operator restored on purpose', async () => {
    const storage = await seededStorage();
    await storeWithoutHistory(storage, OLD);
    await storage.createSystemPromptVersion({
      promptId: ID, version: 3, content: OLD, changedBy: 'operator-alice', changedAt: new Date().toISOString(), changeNote: 'Restored from version 1',
    });
    await seedSystemPrompts(storage, { shippedHashes: withOld });
    expect((await storage.getSystemPrompt(ID))!.content).toBe(OLD);
  });

  it('does not touch a stored prompt the software does not ship', async () => {
    const storage = await seededStorage();
    const record = (await storage.getSystemPrompt(ID))!;
    const orphan = { ...record, id: 'retired-prompt', group: 'email', name: 'Retired', content: OLD, version: 2, updatedBy: 'system' };
    await storage.upsertSystemPrompt(orphan);
    await seedSystemPrompts(storage, { shippedHashes: { ...withOld, 'retired-prompt': [promptTextHash({ content: OLD })] } });
    expect(await storage.getSystemPrompt('retired-prompt')).toMatchObject({ content: OLD, version: 2 });
  });

  it('decidePromptContent: a shipped text follows, a code prompt keeps its own rule', () => {
    const seed = { content: 'new' };
    expect(decidePromptContent({ content: 'old', updatedBy: 'alice' }, seed, null, 'yours', true)).toBe('follow');
    expect(decidePromptContent({ content: 'old', updatedBy: 'alice' }, seed, null, 'yours', false)).toBe('keep');
    expect(decidePromptContent({ content: 'new', updatedBy: 'alice' }, seed, null, 'code', true)).toBe('keep');
  });
});

describe('the list of shipped default texts', () => {
  const yours = PROMPT_SEEDS.filter(s => promptSourceKind(s.id, s.group) === 'yours');

  it('holds the current text of every prompt the operator owns, so a text change needs its hash', () => {
    const missing = yours
      .filter(s => !isShippedDefaultText(s.id, s))
      .map(s => `'${s.id}': add '${promptTextHash(s)}' at the end of its list in src/services/prompt-defaults/shipped-hashes.ts`);
    expect(missing, 'a default prompt text changed without its hash').toEqual([]);
  });

  it('names only prompts the operator owns and the software ships', () => {
    const ids = new Set(yours.map(s => s.id));
    expect(Object.keys(SHIPPED_PROMPT_HASHES).filter(id => !ids.has(id))).toEqual([]);
  });

  it('holds 32-character hashes, each once', () => {
    for (const [id, list] of Object.entries(SHIPPED_PROMPT_HASHES)) {
      for (const h of list) expect(h, id).toMatch(/^[0-9a-f]{32}$/);
      expect(new Set(list).size, id).toBe(list.length);
    }
  });

  it('a language text the operator added is a change', () => {
    const seed = current();
    expect(isShippedDefaultText(ID, { content: seed.content })).toBe(true);
    expect(isShippedDefaultText(ID, { content: seed.content, locales: { fi: 'Oma suomenkielinen teksti.' } })).toBe(false);
  });
});
