/**
 * @file test/unit/stray-agent-faces.test.ts
 * @description The detection of services/app/stray-agent-faces.ts against an in-memory fake of the two
 *   listings it reads: which public copies of an app's agent face count as stray, how they group by
 *   app, and that both listings are read past their first page.
 * @version-history
 *   v1.0.0 -- 2026-11-26 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { strayAgentFaces } from '../../src/services/app/stray-agent-faces.js';

const NODE = 'node-test';

interface FakeApp { ownerName: string; filename: string }
interface FakeRow { key: string; ownerGaii: string; visibility: string; archived?: boolean }

/** listApps and listAllMemoryMeta over two arrays, with the filters and the page the detection asks. */
function fakeStorage(apps: FakeApp[], rows: FakeRow[]) {
  const calls = { apps: 0, memory: 0 };
  return {
    calls,
    async listApps(opts: { adminView?: boolean; limit?: number; offset?: number } = {}) {
      calls.apps++;
      if (!opts.adminView) throw new Error('the detection must ask the admin view');
      const offset = opts.offset ?? 0;
      const page = apps.slice(offset, offset + (opts.limit ?? apps.length));
      return { apps: page.map(a => ({ ...a, ownerGaii: `${a.ownerName}@${NODE}` })), total: apps.length };
    },
    async listAllMemoryMeta(opts: { prefix?: string; visibility?: string; limit?: number; offset?: number; archived?: string } = {}) {
      calls.memory++;
      const match = rows
        .filter(r => !opts.prefix || r.key.startsWith(opts.prefix))
        .filter(r => !opts.visibility || r.visibility === opts.visibility)
        .filter(r => opts.archived === 'include' || !r.archived)
        .sort((a, b) => (a.key + a.ownerGaii).localeCompare(b.key + b.ownerGaii));
      const offset = opts.offset ?? 0;
      const page = match.slice(offset, offset + (opts.limit ?? match.length));
      return { items: page.map(r => ({ ...r, tags: [], version: 1, flagCount: 0, byteSize: 1, createdAt: '', updatedAt: '' })), total: match.length };
    },
  };
}

const face = (filename: string) => `apps.${filename}.agentface`;
const pub = (filename: string, ownerGaii: string, extra: Partial<FakeRow> = {}): FakeRow => ({ key: face(filename), ownerGaii, visibility: 'public', ...extra });

describe('strayAgentFaces', () => {
  const apps: FakeApp[] = [{ ownerName: 'alice', filename: 'shop.html' }, { ownerName: 'alice', filename: 'notes.html' }];

  it('names a second account\'s copy and a foreign holder\'s copy, never the owner\'s or the owner\'s agent\'s', async () => {
    const s = fakeStorage(apps, [
      pub('shop.html', `alice@${NODE}`),
      pub('shop.html', `claude#alice@${NODE}`),
      pub('shop.html', `eco:drum#alice@${NODE}`),
      pub('shop.html', `bob@${NODE}`),
      pub('shop.html', 'carol@other-node'),
      // The foreign account shares the owner's local name: it is still not the owner.
      pub('shop.html', 'alice@other-node'),
    ]);
    const groups = await strayAgentFaces(s as never, NODE);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ filename: 'shop.html', key: face('shop.html'), apps: ['alice/shop.html'], copies: 3 });
    expect(groups[0].holders.sort()).toEqual([`bob@${NODE}`, 'alice@other-node', 'carol@other-node'].sort());
  });

  it('leaves a face no app of that name has, a private record, a version row and a non-identity owner alone', async () => {
    const s = fakeStorage(apps, [
      pub('ghost.html', `bob@${NODE}`),
      pub('shop.html', `bob@${NODE}`, { visibility: 'private' }),
      { key: 'apps.shop.html.agentface.version.1', ownerGaii: `carol@${NODE}`, visibility: 'public' },
      pub('shop.html', 'ext:some-extension'),
    ]);
    expect(await strayAgentFaces(s as never, NODE)).toEqual([]);
  });

  it('counts an archived copy, which is still in the account\'s memory', async () => {
    const s = fakeStorage(apps, [pub('shop.html', `bob@${NODE}`, { archived: true })]);
    const [g] = await strayAgentFaces(s as never, NODE);
    expect(g?.copies).toBe(1);
  });

  it('makes one group per app with its own count', async () => {
    const s = fakeStorage(apps, [
      pub('shop.html', `bob@${NODE}`), pub('shop.html', `carol@${NODE}`),
      pub('notes.html', `dave@${NODE}`),
    ]);
    const groups = await strayAgentFaces(s as never, NODE);
    expect(groups.map(g => [g.filename, g.copies])).toEqual([['notes.html', 1], ['shop.html', 2]]);
  });

  it('names both owners when two accounts have an app of that filename, and neither owner\'s copy is stray', async () => {
    const s = fakeStorage([...apps, { ownerName: 'dave', filename: 'shop.html' }], [
      pub('shop.html', `alice@${NODE}`), pub('shop.html', `dave@${NODE}`), pub('shop.html', `bob@${NODE}`),
    ]);
    const [g] = await strayAgentFaces(s as never, NODE);
    expect(g).toMatchObject({ apps: ['alice/shop.html', 'dave/shop.html'], copies: 1, holders: [`bob@${NODE}`] });
  });

  it('reads both listings past their first page', async () => {
    const manyApps: FakeApp[] = Array.from({ length: 7 }, (_, i) => ({ ownerName: 'alice', filename: `app${i}.html` }));
    const rows = Array.from({ length: 9 }, (_, i) => pub('app6.html', `visitor${i}@${NODE}`));
    const s = fakeStorage(manyApps, rows);
    const groups = await strayAgentFaces(s as never, NODE, { pageSize: 2 });
    // app6.html is on the last page of apps, and its nine copies span five pages of rows.
    expect(groups).toHaveLength(1);
    expect(groups[0].copies).toBe(9);
    expect(s.calls.apps).toBe(4);
    expect(s.calls.memory).toBe(5);
  });

  it('looks at one app\'s key when asked for its filename', async () => {
    const s = fakeStorage(apps, [pub('shop.html', `bob@${NODE}`), pub('notes.html', `bob@${NODE}`)]);
    const groups = await strayAgentFaces(s as never, NODE, { filename: 'notes.html' });
    expect(groups.map(g => g.filename)).toEqual(['notes.html']);
  });
});
