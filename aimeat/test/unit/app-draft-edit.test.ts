/**
 * @file app-draft-edit.test.ts
 * @description Server-less unit tests for incremental app-draft editing: append/replace writes,
 *   targeted old→new replacement with its uniqueness rule, bounded line reads, and seeding the draft
 *   from a published version.
 *
 *   These four operations exist so an agent can author an app larger than one model response without
 *   a filesystem, so the cases worth pinning are the ones that would silently corrupt a file built
 *   across many calls: a chunk that lands twice, a replacement aimed at text that appears more than
 *   once, a multi-byte character cut at a boundary, and a size ceiling that truncates instead of
 *   refusing.
 * @usage cd aimeat && pnpm vitest run test/unit/app-draft-edit.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-16 — initial: write modes, lost-update guard, size ceiling, replace uniqueness,
 *     UTF-8 integrity, read bounds, seed from published (incl. a different filename).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AppRecord, GHIIRecord, Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  writeAppDraft, replaceInAppDraft, readAppDraft, seedAppDraft,
} from '../../src/services/app-draft-edit.js';

const NODE = 'node-test';
const OWNER = 'alice';
const GHII = `${OWNER}@${NODE}`;
const APP = 'pong.html';

const config = { appMaxSizeMb: 5, nodeId: NODE } as unknown as AimeatConfig;
/** A ceiling small enough to hit deliberately, in bytes-per-megabyte terms. */
const tinyConfig = { appMaxSizeMb: 1 / 1024, nodeId: NODE } as unknown as AimeatConfig; // 1 KB

function assert(cond: boolean, msg: string): void {
  expect(cond, msg).toBe(true);
}

async function freshStorage(): Promise<Storage> {
  const storage = new SqliteStorage(':memory:');
  const now = new Date().toISOString();
  const ghii: GHIIRecord = {
    username: OWNER, nodeId: NODE, ghii: GHII, displayName: OWNER,
    verificationLevel: 0, ownerName: OWNER, createdAt: now, updatedAt: now, totpEnabled: false,
  };
  await storage.createGHII(ghii);
  return storage as unknown as Storage;
}

function scope() {
  return { ownerName: OWNER, ownerGhii: GHII };
}

function publishedApp(filename: string, content: string, version = 1): AppRecord {
  return {
    ownerGaii: GHII, ownerName: OWNER, filename, versionNumber: version,
    manifest: {
      name: 'Pong', description: 'a game', version: '1.0.0', category: 'game',
      tags: ['arcade'], authorDisplay: OWNER, usesCortex: [],
    },
    mimeType: 'text/html',
    size: Buffer.byteLength(content, 'utf8'),
    data: Buffer.from(content, 'utf8'),
    createdAt: new Date().toISOString(),
  };
}

/** Unwrap a result that must not be a refusal, naming the refusal when it is. */
function must<T extends object>(out: T | { refusal: { code: string; message: string } }, what: string): T {
  if ('refusal' in out) {
    throw new Error(`${what} refused unexpectedly: ${out.refusal.code} ${out.refusal.message}`);
  }
  return out;
}

async function draftText(storage: Storage): Promise<string> {
  const row = await storage.getAppDraft(GHII, APP);
  return row ? row.data.toString('utf8') : '';
}

describe('writeAppDraft', () => {
  it('appends across calls, and the pieces join in order', async () => {
    const storage = await freshStorage();

    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: '<!doctype html>\n', mode: 'replace' }), 'first write');
    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: '<body>\n' }), 'second write');
    const third = must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: '</body>' }), 'third write');

    const text = await draftText(storage);
    assert(text === '<!doctype html>\n<body>\n</body>', `pieces joined in order (got ${JSON.stringify(text)})`);
    assert(third.size === Buffer.byteLength(text, 'utf8'), 'reported size matches the stored bytes');

    storage.close?.();
  });

  it('append is the default mode, and replace starts over', async () => {
    const storage = await freshStorage();

    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: 'one' }), 'implicit append onto empty');
    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: 'two' }), 'implicit append');
    assert(await draftText(storage) === 'onetwo', 'omitted mode appends');

    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: 'fresh', mode: 'replace' }), 'replace');
    assert(await draftText(storage) === 'fresh', 'replace discards what was there');

    storage.close?.();
  });

  it('carries the draft manifest forward, so a second chunk does not rename the app', async () => {
    const storage = await freshStorage();

    must(await writeAppDraft(storage, config, {
      ...scope(), filename: APP, content: 'a', mode: 'replace',
      requested: { name: 'Pong Deluxe', description: 'two paddles' },
    }), 'first write with a name');
    const second = must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: 'b' }), 'second write');

    assert(second.manifest.name === 'Pong Deluxe', `name survives the append (got "${second.manifest.name}")`);
    assert(second.manifest.description === 'two paddles', 'description survives the append');

    storage.close?.();
  });

  it('refuses on a size mismatch without writing', async () => {
    const storage = await freshStorage();
    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: 'abc', mode: 'replace' }), 'seed content');

    const out = await writeAppDraft(storage, config, {
      ...scope(), filename: APP, content: 'XXX', expectedSizeBytes: 999,
    });
    assert('refusal' in out && out.refusal.code === 'DRAFT_CHANGED', 'mismatched expected size is refused');
    assert(await draftText(storage) === 'abc', 'the draft is untouched after the refusal');

    const ok = await writeAppDraft(storage, config, {
      ...scope(), filename: APP, content: 'def', expectedSizeBytes: 3,
    });
    assert(!('refusal' in ok), 'the correct expected size goes through');
    assert(await draftText(storage) === 'abcdef', 'and appends');

    storage.close?.();
  });

  it('refuses over the size ceiling and leaves the previous content intact', async () => {
    const storage = await freshStorage();
    must(await writeAppDraft(storage, tinyConfig, { ...scope(), filename: APP, content: 'keep me', mode: 'replace' }), 'small write');

    const out = await writeAppDraft(storage, tinyConfig, { ...scope(), filename: APP, content: 'x'.repeat(2048) });
    assert('refusal' in out && out.refusal.code === 'TOO_LARGE', 'oversized append is refused');
    assert(await draftText(storage) === 'keep me', 'the refusal did not truncate the draft');

    storage.close?.();
  });

  it('keeps multi-byte characters and CRLF intact across chunk boundaries', async () => {
    const storage = await freshStorage();

    // The chunk boundary falls INSIDE what a naive byte split would break.
    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: '<p>ääkkö', mode: 'replace' }), 'first half');
    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content: 'set 🎮</p>\r\nrivi2' }), 'second half');

    const text = await draftText(storage);
    assert(text === '<p>ääkköset 🎮</p>\r\nrivi2', `text survives the join (got ${JSON.stringify(text)})`);

    storage.close?.();
  });
});

describe('replaceInAppDraft', () => {
  async function withDraft(content: string): Promise<Storage> {
    const storage = await freshStorage();
    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content, mode: 'replace' }), 'seed draft');
    return storage;
  }

  it('replaces a unique occurrence', async () => {
    const storage = await withDraft('<title>Old</title>\n<h1>Keep</h1>');

    const out = must(await replaceInAppDraft(storage, config, {
      ...scope(), filename: APP, oldString: '<title>Old</title>', newString: '<title>New</title>',
    }), 'replace');

    assert(out.replacements === 1, `reports one replacement (got ${out.replacements})`);
    assert(await draftText(storage) === '<title>New</title>\n<h1>Keep</h1>', 'only the target changed');

    storage.close?.();
  });

  it('refuses when the text is not there, and says so', async () => {
    const storage = await withDraft('<h1>Hello</h1>');

    const out = await replaceInAppDraft(storage, config, {
      ...scope(), filename: APP, oldString: '<h2>Missing</h2>', newString: 'x',
    });
    assert('refusal' in out && out.refusal.code === 'NOT_FOUND', 'a missing match is refused');
    assert(await draftText(storage) === '<h1>Hello</h1>', 'the draft is untouched');

    storage.close?.();
  });

  it('refuses an ambiguous match and names the count', async () => {
    const storage = await withDraft('<div>x</div>\n<div>x</div>\n<div>x</div>');

    const out = await replaceInAppDraft(storage, config, {
      ...scope(), filename: APP, oldString: '<div>x</div>', newString: '<div>y</div>',
    });
    assert('refusal' in out && out.refusal.code === 'NOT_UNIQUE', 'an ambiguous match is refused');
    assert('refusal' in out && out.refusal.message.includes('3'), `the refusal names the count (got "${'refusal' in out ? out.refusal.message : ''}")`);
    assert((await draftText(storage)).split('<div>y</div>').length === 1, 'nothing was replaced');

    storage.close?.();
  });

  it('replace_all replaces every occurrence and reports how many', async () => {
    const storage = await withDraft('a-a-a');

    const out = must(await replaceInAppDraft(storage, config, {
      ...scope(), filename: APP, oldString: 'a', newString: 'b', replaceAll: true,
    }), 'replace all');

    assert(out.replacements === 3, `reports three replacements (got ${out.replacements})`);
    assert(await draftText(storage) === 'b-b-b', 'every occurrence changed');

    storage.close?.();
  });

  it('refuses an empty match instead of matching everywhere', async () => {
    const storage = await withDraft('anything');

    const out = await replaceInAppDraft(storage, config, {
      ...scope(), filename: APP, oldString: '', newString: 'x',
    });
    assert('refusal' in out && out.refusal.code === 'INVALID_MATCH', 'an empty old_string is refused');

    storage.close?.();
  });

  it('refuses when there is no draft at all, and says how to start one', async () => {
    const storage = await freshStorage();

    const out = await replaceInAppDraft(storage, config, {
      ...scope(), filename: APP, oldString: 'a', newString: 'b',
    });
    assert('refusal' in out && out.refusal.code === 'NO_DRAFT', 'no draft is refused');

    storage.close?.();
  });
});

describe('readAppDraft', () => {
  async function withLines(count: number): Promise<Storage> {
    const storage = await freshStorage();
    const content = Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
    must(await writeAppDraft(storage, config, { ...scope(), filename: APP, content, mode: 'replace' }), 'seed draft');
    return storage;
  }

  it('returns the requested range and the totals around it', async () => {
    const storage = await withLines(50);

    const out = must(await readAppDraft(storage, { ...scope(), filename: APP, offset: 10, limit: 3 }), 'read');

    assert(out.totalLines === 50, `total line count is reported (got ${out.totalLines})`);
    assert(out.fromLine === 10 && out.toLine === 12, `range is 10..12 (got ${out.fromLine}..${out.toLine})`);
    assert(out.content === 'line 10\nline 11\nline 12', `slice is exact (got ${JSON.stringify(out.content)})`);
    assert(out.hasMore, 'more lines remain after the slice');

    storage.close?.();
  });

  it('reports the end of the file honestly', async () => {
    const storage = await withLines(5);

    const out = must(await readAppDraft(storage, { ...scope(), filename: APP, offset: 4, limit: 100 }), 'read tail');

    assert(out.toLine === 5, `stops at the last line (got ${out.toLine})`);
    assert(!out.hasMore, 'nothing remains after the last line');

    storage.close?.();
  });

  it('caps a limitless read instead of returning the whole file', async () => {
    const storage = await withLines(1000);

    const out = must(await readAppDraft(storage, { ...scope(), filename: APP }), 'read with no range');

    assert(out.toLine < out.totalLines, `the default read is bounded (returned up to ${out.toLine} of ${out.totalLines})`);
    assert(out.hasMore, 'and says that more remains');

    storage.close?.();
  });

  it('refuses a nonsense range rather than guessing', async () => {
    const storage = await withLines(5);

    const bad = await readAppDraft(storage, { ...scope(), filename: APP, offset: 0 });
    assert('refusal' in bad && bad.refusal.code === 'INVALID_RANGE', 'offset 0 is refused (lines are 1-based)');

    storage.close?.();
  });
});

describe('seedAppDraft', () => {
  it('copies the published source into the draft slot', async () => {
    const storage = await freshStorage();
    const live = '<!doctype html><h1>v1 live</h1>';
    await storage.createApp(publishedApp(APP, live));

    const out = must(await seedAppDraft(storage, config, { ...scope(), filename: APP }), 'seed');

    assert(out.seededFrom === APP, 'reports what it copied from');
    assert(out.seededVersion === 1, `reports the version (got ${out.seededVersion})`);
    assert(await draftText(storage) === live, 'the draft now holds the published bytes');

    storage.close?.();
  });

  it('makes a live app editable, which aimeat_app_get alone cannot', async () => {
    const storage = await freshStorage();
    await storage.createApp(publishedApp(APP, '<h1>Old title</h1>'));

    must(await seedAppDraft(storage, config, { ...scope(), filename: APP }), 'seed');
    must(await replaceInAppDraft(storage, config, {
      ...scope(), filename: APP, oldString: 'Old title', newString: 'New title',
    }), 'edit the seeded draft');

    assert(await draftText(storage) === '<h1>New title</h1>', 'the seeded draft took the edit');

    storage.close?.();
  });

  it('seeding under a different filename carries the source manifest', async () => {
    const storage = await freshStorage();
    await storage.createApp(publishedApp('original.html', '<h1>original</h1>'));

    const out = must(await seedAppDraft(storage, config, {
      ...scope(), filename: 'copy.html', fromFilename: 'original.html',
    }), 'seed under a new name');

    assert(out.manifest.name === 'Pong', `the source manifest came along (got "${out.manifest.name}")`);
    assert(out.manifest.category === 'game', 'category came along too');
    const copy = await storage.getAppDraft(GHII, 'copy.html');
    assert(copy?.data.toString('utf8') === '<h1>original</h1>', 'the bytes landed under the new name');

    storage.close?.();
  });

  it('refuses when there is nothing published to copy', async () => {
    const storage = await freshStorage();

    const out = await seedAppDraft(storage, config, { ...scope(), filename: APP });
    assert('refusal' in out && out.refusal.code === 'NOT_FOUND', 'seeding a nonexistent app is refused');

    storage.close?.();
  });
});
