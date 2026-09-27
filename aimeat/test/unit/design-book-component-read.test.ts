/**
 * @file test/unit/design-book-component-read.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A stored component that no longer passes the bench, as each reader meets it: get
 *   answers the bench's result and gives the markup and the stylesheet only to the proposer, search
 *   and the map leave it out, the node's own renderers still read it whole, and the proposer is told
 *   once, the first time the node finds it failing.
 * @usage cd aimeat && pnpm exec vitest run test/unit/design-book-component-read.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { DesignBookService, partKey } from '../../src/services/design-book/service.js';
import { runDesignBookAgingJob } from '../../src/services/design-book/lifecycle.js';

const config = { nodeId: 'aimeat-test-001-dev', baseUrl: 'http://localhost', aiProvenance: false } as unknown as AimeatConfig;
const SYSTEM = `system@${config.nodeId}`;
const ALICE = `alice@${config.nodeId}`;
const ALICES_AGENT = `claude#alice@${config.nodeId}`;
const BOB = `bob@${config.nodeId}`;
const BOBS_AGENT = `claude#bob@${config.nodeId}`;

const BODY = {
  prefix: 'wkgrid',
  html: '<div class="wkgrid" role="grid"><button class="wkgrid-cell" type="button" aria-pressed="false" data-day="mon"></button></div>',
  css: '.wkgrid { display: grid; color: var(--ak-ink); }\n.wkgrid-cell { min-height: 40px; background: var(--ak-surface); }',
  use: 'One .wkgrid-cell button per day with data-day. The app toggles aria-pressed on click and saves.',
  judgement: { reach: 'general', why: 'Any app where a person ticks days against rows uses it: habits, chores.' },
};
// Stored when it passed. The bench has learned since: `.wkgrid ~ p` reaches the page beside the component.
const STALE = { ...BODY, css: `${BODY.css}\n.wkgrid ~ p { color: var(--ak-accent); }` };

const DAY = 24 * 60 * 60 * 1000;

/** A component part as the store holds it: what a proposal wrote, with whatever body passed then. */
async function plant(storage: Storage, id: string, body: Record<string, unknown>, opts: { status?: string; publishedAt?: string; owner?: string } = {}): Promise<void> {
  const now = new Date().toISOString();
  const status = opts.status ?? 'published';
  const prior = await storage.getMemory(SYSTEM, partKey(id));
  await storage.setMemory({
    key: partKey(id),
    ownerGaii: SYSTEM,
    value: JSON.stringify({
      spec: 'aimeat.designbook.part/v1', id, kind: 'component', title: 'A week you tick', summary: 'Rows against seven days, every cell a button.',
      body, tags: [], status, proposed_by: ALICES_AGENT, proposed_by_owner: opts.owner ?? ALICE,
      bench: { checks: ['markup-allowlist', 'styles-scoped'], passed_at: now }, created_at: opts.publishedAt ?? now, updated_at: now,
      published_at: opts.publishedAt ?? now,
    }),
    visibility: 'public', tags: ['designbook', 'kind:component', `status:${status}`], ttlHours: null,
    version: prior ? prior.version + 1 : 1, createdAt: prior?.createdAt ?? now, updatedAt: now, trackable: true,
  });
}

async function shelf(): Promise<{ storage: Storage; book: DesignBookService }> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  await plant(storage, 'comp-week', BODY);
  await plant(storage, 'comp-stale', STALE);
  return { storage, book: new DesignBookService(storage, config) };
}

type Read = { part: { body: Record<string, unknown> }; bench?: { passes: boolean; why?: string; note?: string } };

describe('a stored component that no longer passes the bench', () => {
  it('get answers the bench\'s result, and gives the markup and the stylesheet only to its proposer', async () => {
    const { book } = await shelf();
    const passing = await book.get('comp-week') as Read;
    expect(passing.bench).toEqual({ passes: true });
    expect(passing.part.body.html).toBe(BODY.html);

    for (const reader of [null, BOB, BOBS_AGENT, SYSTEM]) {
      const out = await book.get('comp-stale', reader) as Read;
      expect(out.bench, String(reader)).toMatchObject({ passes: false, why: expect.stringMatching(/"\.wkgrid ~ p" reaches from the component to an element beside it/) });
      expect(out.bench?.note, String(reader)).toMatch(/only its proposer/);
      expect(out.part.body.html, String(reader)).toBeUndefined();
      expect(out.part.body.css, String(reader)).toBeUndefined();
      expect(out.part.body.use, String(reader)).toBe(STALE.use);
    }
    // The proposer, and any agent acting for them, gets them back to fix.
    for (const reader of [ALICE, ALICES_AGENT]) {
      const out = await book.get('comp-stale', reader) as Read;
      expect(out.bench?.passes, reader).toBe(false);
      expect(out.bench?.note, reader).toMatch(/propose it again/);
      expect(out.part.body.html, reader).toBe(STALE.html);
      expect(out.part.body.css, reader).toBe(STALE.css);
    }
    // The node's own renderers read it as stored: they bench it again before they show anything.
    expect((await book.storedPart('comp-stale')).body.css).toBe(STALE.css);
  });

  it('is left out of search and of the map every builder reads', async () => {
    const { book } = await shelf();
    const ids = (rows: Array<{ id: string }>) => rows.map(r => r.id);
    expect(ids(await book.list())).toContain('comp-week');
    expect(ids(await book.list())).not.toContain('comp-stale');
    expect(ids(await book.list({ kind: 'component' }))).toEqual(['comp-week']);
    expect(ids(await book.list({ q: 'comp-stale' }))).toEqual([]);
    expect(ids(await book.list({ status: 'published', kind: 'component' }))).toEqual(['comp-week']);
    const { map } = await book.map();
    expect(map).toContain('`comp-week`');
    expect(map).not.toContain('comp-stale');
  });

  it('fades like any part nobody takes', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await plant(storage, 'comp-stale', STALE, { publishedAt: new Date(Date.now() - 61 * DAY).toISOString() });
    await runDesignBookAgingJob(storage, config);
    expect((await new DesignBookService(storage, config).storedPart('comp-stale')).status).toBe('aging');
  });

  it('tells its proposer once, the first time the node finds it failing', async () => {
    const { noticeFailingComponents } = await import('../../src/services/design-book/component-notice.js');
    const { storage, book } = await shelf();
    const bell = async (owner: string) => (await storage.listMemory(owner, { prefix: 'notif.' }))
      .map(r => (typeof r.value === 'string' ? JSON.parse(r.value) : r.value) as { type: string; title: string; body: string; link: string });

    expect(await noticeFailingComponents(storage, config)).toEqual({ failing: 1, noticed: 1 });
    const [notice, ...more] = await bell(ALICE);
    expect(more).toEqual([]);
    expect(notice.title).toMatch(/"comp-stale" no longer passes the bench/);
    expect(notice.body).toMatch(/"\.wkgrid ~ p" reaches from the component to an element beside it/);
    expect(notice.body).toMatch(/propose it again under the same id/);
    expect(notice.link).toBe('/v1/designbook/comp-stale/preview');
    expect(await bell(BOB)).toEqual([]);

    // Not repeated: the next round, the next boot and the nightly job find it again and say nothing.
    expect(await noticeFailingComponents(storage, config)).toEqual({ failing: 1, noticed: 0 });
    await runDesignBookAgingJob(storage, config);
    expect(await bell(ALICE)).toHaveLength(1);

    // A different stored body that fails is a new thing to say, and the nightly job says it.
    await plant(storage, 'comp-stale', { ...STALE, css: `${STALE.css}\n.wkgrid-x { color: var(--ak-ink); }` });
    await runDesignBookAgingJob(storage, config);
    expect(await bell(ALICE)).toHaveLength(2);

    // Nobody is told about a retired part, or a part the node itself holds.
    await plant(storage, 'comp-gone', { ...STALE, prefix: 'gone', html: '<div class="gone"></div>', css: '.gone { color: var(--ak-ink); }\n.gone ~ p { color: var(--ak-ink); }' }, { status: 'retired' });
    await plant(storage, 'comp-node', { ...STALE, prefix: 'node', html: '<div class="node"></div>', css: '.node { color: var(--ak-ink); }\n.node ~ p { color: var(--ak-ink); }' }, { owner: SYSTEM });
    expect(await noticeFailingComponents(storage, config)).toEqual({ failing: 2, noticed: 0 });

    // Deleting the part takes what the node remembers about telling its proposer with it.
    await book.delete(ALICE, false, 'comp-stale');
    expect(await storage.listMemory(SYSTEM, { prefix: 'atelier.book.notice.' })).toEqual([]);
  });
});
