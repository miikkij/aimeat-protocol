/**
 * @file test/unit/ai-app-name-notice.test.ts
 * @description An entry of the owner's AI app list saved as a bare file name (`notes`) keeps letting
 *   in the apps it did (the 2026-10-25 compatibility rule, test/unit/ai-app-id.test.ts), and the owner
 *   is told once when it lets in ANOTHER author's app of that name (secaudit2026oct26,
 *   ai-app-id.ts:entryNamesApp:bare-allowlist-entry-matches-any-author).
 * @usage pnpm exec vitest run test/unit/ai-app-name-notice.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

const sent: Array<{ to: string; input: any }> = [];
vi.mock('../../src/services/notify.js', () => ({
  notify: vi.fn(async (_s: unknown, to: string, input: unknown) => { sent.push({ to, input }); return { stored: true, pushed: false, held: false, muted: false }; }),
}));

const { bareNameOnlyEntry, appAllowlisted } = await import('../../src/services/ai-app-id.js');
const { noticeBareNameMatch, APP_NAME_NOTICES_KEY } = await import('../../src/services/ai/app-name-notice.js');

const OWNER = 'alice@aimeat-local-001-dev';

describe('bareNameOnlyEntry', () => {
  it('names the bare entry that lets another author\'s app in', () => {
    expect(bareNameOnlyEntry(['notes'], 'bob/notes.html', OWNER)).toBe('notes');
    expect(bareNameOnlyEntry(['notes.html'], 'bob/notes.html', OWNER)).toBe('notes.html');
    // The app is still let in: the compatibility match is unchanged.
    expect(appAllowlisted(['notes'], 'bob/notes.html', OWNER)).toBe(true);
  });
  it('is undefined for the owner\'s own app, an entry with the author, and an app no entry names', () => {
    expect(bareNameOnlyEntry(['notes'], 'alice/notes.html', OWNER)).toBeUndefined();
    expect(bareNameOnlyEntry(['notes', 'bob/notes'], 'bob/notes.html', OWNER)).toBeUndefined();
    expect(bareNameOnlyEntry(['other'], 'bob/notes.html', OWNER)).toBeUndefined();
    expect(bareNameOnlyEntry(['notes'], 'notes', OWNER)).toBeUndefined();
  });
});

function memoryStorage(): Storage {
  const rows = new Map<string, MemoryRecord>();
  return {
    getMemory: async (owner: string, key: string) => rows.get(`${owner}::${key}`) ?? null,
    setMemory: async (r: MemoryRecord) => { rows.set(`${r.ownerGaii}::${r.key}`, r); return r; },
  } as unknown as Storage;
}

describe('noticeBareNameMatch', () => {
  let storage: Storage;
  beforeEach(() => { sent.length = 0; storage = memoryStorage(); });

  it('tells the owner once per entry and app, naming both', async () => {
    const prefs = { app_allowlist: ['notes'] };
    await noticeBareNameMatch(storage, OWNER, prefs, 'bob/notes.html');
    await noticeBareNameMatch(storage, OWNER, prefs, 'bob/notes.html');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(OWNER);
    expect(sent[0].input).toMatchObject({ type: 'ai_app_name_match', i18n: { key: 'ai_app_name_match', vars: { app: 'bob/notes', entry: 'notes' } } });
    expect((await storage.getMemory(OWNER, APP_NAME_NOTICES_KEY))?.visibility).toBe('private');
    // Another author's app of the same name is a new pair, told once too.
    await noticeBareNameMatch(storage, OWNER, prefs, 'carol/notes.html');
    expect(sent).toHaveLength(2);
  });

  it('says nothing for the owner\'s own app, an exact entry, no list, or no app', async () => {
    await noticeBareNameMatch(storage, OWNER, { app_allowlist: ['notes'] }, 'alice/notes.html');
    await noticeBareNameMatch(storage, OWNER, { app_allowlist: ['bob/notes'] }, 'bob/notes.html');
    await noticeBareNameMatch(storage, OWNER, {}, 'bob/notes.html');
    await noticeBareNameMatch(storage, OWNER, { app_allowlist: ['notes'] }, undefined);
    expect(sent).toHaveLength(0);
  });
});
