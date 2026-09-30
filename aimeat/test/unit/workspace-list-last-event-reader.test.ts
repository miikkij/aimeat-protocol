/**
 * @file test/unit/workspace-list-last-event-reader.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspace list's lastEvent (GET /v1/organisms/:id/workspaces?include=enrichment)
 *   passes the caller's classification reader, as GET /workspace/activity does (TARGET-082 V4). A stub
 *   reader records the show() call and hides one item: the call carries each record's label address,
 *   and the last event comes from what show() kept, while the counts stay as they were.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-list-last-event-reader.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-30 — A published record's label address is its document's key without
 *     `.latest` (one label per document, decided 2026-09-30).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ContentLabelTarget } from '../../src/storage/interface.js';

const shown: Array<{ targets: Array<ContentLabelTarget | null> }> = [];
let hide = '';
vi.mock('../../src/services/classification/reader.js', async (orig) => ({
  ...(await orig<typeof import('../../src/services/classification/reader.js')>()),
  readerFor: () => ({
    kind: 'human', identity: 'alice@test-node', principal: 'alice@test-node', auth: null,
    async show<T>(items: readonly T[], targetOf: (item: T) => ContentLabelTarget | null) {
      const targets = items.map(targetOf);
      shown.push({ targets });
      return items.filter((_, i) => targets[i]?.key !== hide);
    },
    async useForAi() { /* not used here */ },
    async leave<T>(items: readonly T[]) { return { kept: [...items], left: [] }; },
  }),
}));

const { SqliteStorage } = await import('../../src/storage/providers/sqlite/index.js');
const { createOrganismHelpers } = await import('../../src/routes/organisms/shared.js');
const { registerOrganismWorkspaceAccessRoutes } = await import('../../src/routes/organisms/workspace-access.js');
import type { AimeatConfig } from '../../src/config.js';
import type { OrganismRecord, OrganismMembershipRecord, GHIIRecord } from '../../src/storage/interface.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const ORG = 'org-last';
const WS = 'ws1';
const ROOT = `organism.${ORG}.w.${WS}`;
const config = { nodeId: NODE, classificationMode: 'off' } as AimeatConfig;
const now = (m = 0) => new Date(Date.UTC(2026, 8, 29, 12, m)).toISOString();

type Handler = (req: unknown, res: unknown) => Promise<void>;

describe('the workspace list passes its last event through show()', () => {
  let storage: InstanceType<typeof SqliteStorage>;
  let list: Handler;

  const put = async (key: string, value: unknown, minute: number) => storage.setMemory({
    key, ownerGaii: ALICE, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
    createdAt: now(minute), updatedAt: now(minute),
  });

  beforeEach(async () => {
    shown.length = 0; hide = '';
    storage = new SqliteStorage(':memory:');
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, admins: [ALICE],
      members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'open', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: now(), updatedAt: now(),
    } as OrganismRecord);
    await storage.createGHII({ username: 'alice', nodeId: NODE, ghii: ALICE, displayName: 'alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, createdAt: now(), updatedAt: now() } as GHIIRecord);
    await storage.createMembership({ id: 'm1', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: now() } as OrganismMembershipRecord);
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Notes', createdBy: 'alice' }] }, 0);
    await put(`${ROOT}.meta.manifest`, { objectTypes: [{ name: 'note', namespace: 'notes', mode: 'records' }] }, 0);
    await put(`${ROOT}.notes.plan.latest`, { title: 'Plan' }, 1);
    await put(`${ROOT}.notes.layoffs.latest`, { title: 'Layoffs' }, 2);

    const routes = new Map<string, Handler>();
    const reg = (method: string) => (path: string, ...fns: Handler[]) => { routes.set(`${method} ${path}`, fns[fns.length - 1]); };
    const router = { get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), put: reg('PUT'), delete: reg('DELETE') };
    registerOrganismWorkspaceAccessRoutes(router as never, config, storage, createOrganismHelpers(config, storage));
    list = routes.get('GET /v1/organisms/:id/workspaces')!;
  });
  afterEach(() => { storage.close(); });

  async function call(): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    const res = { status() { return res; }, json(b: Record<string, unknown>) { body = b; return res; } };
    await list({ params: { id: ORG }, query: { include: 'enrichment' }, auth: { sub: 'alice', owner: 'alice', roles: ['owner'] } }, res);
    return ((body.data as { workspaces: Array<Record<string, unknown>> }).workspaces[0].enrichment) as Record<string, unknown>;
  }

  it('calls show with the memory label address of every readable record', async () => {
    const e = await call();
    expect(shown).toHaveLength(1);
    const keys = shown[0].targets.map(t => t?.key);
    // The label address of a published record is its document's (one label per document, 2026-09-30).
    expect(keys).toEqual(expect.arrayContaining([`${ROOT}.notes.plan`, `${ROOT}.notes.layoffs`]));
    expect(shown[0].targets.every(t => t?.kind === 'memory' && t.scope === `organism:${ORG}`)).toBe(true);
    expect(e.lastEvent).toMatchObject({ type: 'note', instance: 'layoffs' });
  });

  it('an item show() drops is not the last event; the counts are unchanged', async () => {
    hide = `${ROOT}.notes.layoffs`;
    const e = await call();
    expect(e.lastEvent).toMatchObject({ type: 'note', instance: 'plan' });
    expect(e.recs).toBe(2);
  });
});
