/**
 * @file test/unit/classification-owner-loaders.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The loaders that hand an owner's stored content to a caller pass it through the
 *   classification check (TARGET-082 V4), on a real SQLite store with the switch on: chat threads,
 *   the open-items list, workspace comments, the organism README, the skills registry (manifests and
 *   file bodies, and the reader made from an accessor that did not bring one), a package component
 *   read for a model prompt, the Notebook inbox and the Calibrator detail. An AI reader does not see
 *   what is hidden from AI; the owner in their own session does.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-owner-loaders.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { ContentLabelTarget } from '../../src/storage/interface.js';
import { readerFor, type ReaderAuth } from '../../src/services/classification/reader.js';
import { memoryTarget } from '../../src/services/classification/labels.js';
import { createThread, showThread, showThreads, readThread } from '../../src/services/chat-threads.js';
import { addItem, showItems, listItems } from '../../src/services/open-items.js';
import { addComment, listComments } from '../../src/services/organism-comments.js';
import { setOrganismReadme, showOrganismReadme, getOrganismReadme } from '../../src/services/organism-readme.js';
import { publishSkill, resolveSkillRef, listSkills } from '../../src/services/skills.js';
import { manifestKey, fileKey } from '../../src/services/skill-refs.js';
import { fetchComponentContent, fetchComponentContentForAi } from '../../src/services/component-content.js';
import { createNotebookService } from '../../src/services/db/notebook-db-service.js';
import { createCalibratorDetailService } from '../../src/services/db/calibrator-detail-db-service.js';

const N = 'n';
const ALICE = `alice@${N}`;
const HIDDEN = 'erittain-luottamuksellinen';   // hidden from AI
const WARNING = 'luottamuksellinen';            // shown to AI with a warning
const config = { nodeId: N, classificationMode: 'all', chatMaxLiveThreads: 50 } as unknown as AimeatConfig;
const ownerAuth: ReaderAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };
// The owner's credential made from a personal access token: a program reading, so an AI reader
// acting in alice's own data space.
const patAuth = { sub: 'alice', owner: 'alice', roles: ['owner'], via: 'pat' } as ReaderAuth;

describe('owner-content loaders pass the classification check', () => {
  let storage: SqliteStorage;
  const deps = () => ({ storage, config });
  const person = () => readerFor(deps(), ownerAuth);
  const ai = () => readerFor(deps(), patAuth);

  async function label(target: ContentLabelTarget, id: string): Promise<void> {
    await storage.putContentLabel({
      kind: target.kind, scope: target.scope, key: target.key, id: `${target.scope}|${target.key}`, ownerGaii: null,
      label: id, source: 'human', locked: true, suggestion: null, justification: null, humanSaid: null,
      history: [], setBy: ALICE, updatedAt: '2026-09-29T00:00:00Z',
    });
  }
  async function put(key: string, value: unknown, owner = ALICE): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({ key, ownerGaii: owner, value: value as Record<string, unknown>, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  }

  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => storage.close());

  it('chat threads: a hidden conversation is not listed or read for an AI, and stays for the node', async () => {
    const t = await createThread(storage, config, ALICE, 'Secret plan');
    await label(memoryTarget(ALICE, `chat.thread.${t.id}`), HIDDEN);
    expect((await showThreads(storage, person())).map(x => x.id)).toEqual([t.id]);
    expect(await showThreads(storage, ai())).toEqual([]);
    expect(await showThread(storage, ai(), t.id)).toBeNull();
    expect((await showThread(storage, person(), t.id))?.title).toBe('Secret plan');
    expect((await readThread(storage, ALICE, t.id))?.id).toBe(t.id);
  });

  it('open items: a hidden list reads as empty for an AI', async () => {
    await addItem(storage, ALICE, { title: 'Call the bank' });
    await label(memoryTarget(ALICE, 'open-items.list'), HIDDEN);
    expect((await showItems(storage, config, person(), 'alice')).map(i => i.title)).toEqual(['Call the bank']);
    expect(await showItems(storage, config, ai(), 'alice')).toEqual([]);
    expect((await listItems(storage, config, ALICE, 'alice')).length).toBe(1);
  });

  it('comments: a hidden comment is left out and a warning comment carries its warning', async () => {
    const input = { ws: 'ws1', space: 'docs', instanceId: 'd1' };
    const secret = await addComment(storage, 'o1', ALICE, { ...input, body: 'salary numbers' });
    const conf = await addComment(storage, 'o1', ALICE, { ...input, body: 'draft wording' });
    const prefix = 'organism.o1.w.ws1.meta.comments.docs~d1.';
    await label(memoryTarget(ALICE, `${prefix}${secret.id}`), HIDDEN);
    await label(memoryTarget(ALICE, `${prefix}${conf.id}`), WARNING);
    const seen = await listComments(storage, ai(), 'o1', 'ws1', 'docs', 'd1');
    expect(seen.map(c => c.id)).toEqual([conf.id]);
    expect(seen[0]!.classificationWarning?.label).toBe(WARNING);
    expect((await listComments(storage, person(), 'o1', 'ws1', 'docs', 'd1')).length).toBe(2);
  });

  it('organism README: hidden reads as empty for an AI, the node still reads it', async () => {
    await setOrganismReadme(storage, config, 'o1', '# Board only', 'alice');
    await label(memoryTarget(ALICE, 'organism.o1.meta.readme'), HIDDEN);
    expect(await showOrganismReadme(storage, ai(), 'o1')).toBe('');
    expect(await showOrganismReadme(storage, person(), 'o1')).toBe('# Board only');
    expect(await getOrganismReadme(storage, 'o1')).toBe('# Board only');
  });

  it('skills: a hidden file body is left out, a hidden manifest reads as not found, and a reader is made when none is given', async () => {
    const md = '---\nname: demo\ndescription: A demo skill for the classification test.\n---\n\nThe body.\n';
    await publishSkill(storage, config, { scope: 'user', owner: 'alice', publisher: ALICE, files: new Map([['SKILL.md', md]]) });
    await label(memoryTarget(ALICE, fileKey('demo', 'SKILL.md')), HIDDEN);

    const asAi = await resolveSkillRef(storage, config, 'user:alice/demo', { ownerName: 'alice', reader: ai() });
    expect(asAi.fileContents).toEqual({});
    const asPerson = await resolveSkillRef(storage, config, 'user:alice/demo', { ownerName: 'alice', reader: person() });
    expect(asPerson.fileContents['SKILL.md']).toBe(md);
    // No reader on the accessor: an agent identity is read as an AI.
    const fallback = await resolveSkillRef(storage, config, 'user:alice/demo', { ownerName: 'alice', gaii: `claude#${ALICE}` });
    expect(fallback.fileContents).toEqual({});

    await label(memoryTarget(ALICE, manifestKey('demo')), HIDDEN);
    await expect(resolveSkillRef(storage, config, 'user:alice/demo', { ownerName: 'alice', reader: ai() }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await listSkills(storage, config, 'user', { ownerName: 'alice', reader: ai() }, 'alice')).toEqual([]);
    expect((await listSkills(storage, config, 'user', { ownerName: 'alice', reader: person() }, 'alice')).map(s => s.name)).toEqual(['demo']);
  });

  it('package component: content for a model prompt is refused when a part is hidden from AI; the hash read is unchanged', async () => {
    await put('_pkg:demo', ['demo.a', 'demo.b']);
    await put('demo.a', { x: 1 });
    await put('demo.b', { y: 2 });
    await label(memoryTarget(ALICE, 'demo.b'), HIDDEN);
    await expect(fetchComponentContentForAi(storage, person(), 'memory', 'demo', ALICE, { capability: 'migration-prompt' }))
      .rejects.toMatchObject({ code: 'CLASSIFIED', status: 403 });
    expect(await fetchComponentContent(storage, 'memory', 'demo', ALICE)).toContain('"demo.b"');
    await put('_pkg:open', ['demo.a']);
    expect(await fetchComponentContentForAi(storage, person(), 'memory', 'open', ALICE, { capability: 'migration-prompt' })).toContain('"demo.a"');
  });

  it('Notebook and Calibrator composites leave out what the reader may not see', async () => {
    await put('notebook.inbox.1', { text: 'public note' });
    await put('notebook.inbox.2', { text: 'secret note' });
    await label(memoryTarget(ALICE, 'notebook.inbox.2'), HIDDEN);
    const nb = await createNotebookService(storage).overview(ai(), 'alice', ALICE);
    expect(nb.inbox.map(r => r.key)).toEqual(['notebook.inbox.1']);
    expect((await createNotebookService(storage).overview(person(), 'alice', ALICE)).inbox.length).toBe(2);

    await put('calibrator.c1.project', { projectId: 'c1', currentVersion: 0 });
    await put('calibrator.c1.batch.b1', { batchId: 'b1', createdAt: '2026-09-29T00:00:00Z', models: [] });
    await label(memoryTarget(ALICE, 'calibrator.c1.batch.b1'), HIDDEN);
    expect((await createCalibratorDetailService(storage).overview(ai(), 'c1'))?.batches).toEqual([]);
    expect((await createCalibratorDetailService(storage).overview(person(), 'c1'))?.batches.length).toBe(1);
    await label(memoryTarget(ALICE, 'calibrator.c1.project'), HIDDEN);
    expect(await createCalibratorDetailService(storage).overview(ai(), 'c1')).toBeNull();
  });
});
