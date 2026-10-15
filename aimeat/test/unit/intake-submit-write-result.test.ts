/**
 * @file test/unit/intake-submit-write-result.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public intake submit (POST /v1/intake/:org/:ws/:formId) answers `ok: true` only
 *   when the published write stored the record, and a submission that was not stored gives its daily
 *   slot back. Until 2026-10-15 the route read only the batch's refusal, never the record's own
 *   result, so a record the write guard refused was answered `ok: true` with nothing stored, and the
 *   form's daily count had already been spent (feature-list audit #63). The publish is stubbed to
 *   refuse the one record; everything else runs against in-memory SQLite.
 * @usage cd aimeat && pnpm exec vitest run test/unit/intake-submit-write-result.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #63).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { createOrganismHelpers } from '../../src/routes/organisms/shared.js';
import { registerOrganismIntakeRoutes } from '../../src/routes/organisms/intake.js';
import { releaseDailySlot, takeDailySlot } from '../../src/services/intake-daily-count.js';
import type { AimeatConfig } from '../../src/config.js';
import type { OrganismRecord, OrganismMembershipRecord, GHIIRecord } from '../../src/storage/interface.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const ORG = 'org-intake';
const WS = 'ws1';
const FORM = 'contact';
const ROOT = `organism.${ORG}.w.${WS}`;
const config = { nodeId: NODE, classificationMode: 'off' } as AimeatConfig;
const at = new Date().toISOString();
const COUNT_KEY = `intake.count.${ORG}.${WS}.${FORM}`;

type Handler = (req: unknown, res: unknown) => Promise<void>;

describe('the public intake submit reads the write result', () => {
  let storage: InstanceType<typeof SqliteStorage>;
  let submit: Handler;
  let publishOk = true;

  const put = (key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: ALICE, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
  });

  beforeEach(async () => {
    publishOk = true;
    storage = new SqliteStorage(':memory:');
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: 'alice', admins: ['alice'],
      members: ['alice'], agentGaiis: [], boardId: 'b1', joinPolicy: 'open', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: at, updatedAt: at,
    } as OrganismRecord);
    await storage.createGHII({ username: 'alice', nodeId: NODE, ghii: ALICE, displayName: 'alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, createdAt: at, updatedAt: at } as GHIIRecord);
    await storage.createMembership({ id: 'm1', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: at } as OrganismMembershipRecord);
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Leads', createdBy: 'alice' }] });
    await put(`${ROOT}.meta.manifest`, { objectTypes: [{ name: 'lead', namespace: 'leads', mode: 'records' }] });
    await put(`${ROOT}.meta.intake.${FORM}`, {
      formId: FORM, orgId: ORG, ws: WS, namespace: 'leads', ownerGhii: ALICE, allowedFields: ['name'], requiredFields: [],
      defaults: {}, mode: 'publish', honeypotField: null, enabled: true, discoverable: true, maxPerDay: 5, title: 'Contact',
      fields: [{ key: 'name' }], successMessage: '', redirectUrl: null, createdAt: at, updatedAt: at,
    });

    const helpers = createOrganismHelpers(config, storage);
    const H = {
      ...helpers,
      // The one record's own result, as publishDraftsBatch answers a write guard refusal.
      publishDraftsBatch: (async (_o: string, _w: string, _n: string, ids: string[], ...rest: unknown[]) => {
        if (publishOk) return helpers.publishDraftsBatch(_o, _w, _n, ids, ...(rest as [string]));
        return { results: [{ instance: ids[0], ok: false, code: 'INVALID' }] };
      }) as typeof helpers.publishDraftsBatch,
    };
    const routes = new Map<string, Handler>();
    const reg = (method: string) => (path: string, ...fns: Handler[]) => { routes.set(`${method} ${path}`, fns[fns.length - 1]); };
    const router = { get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), put: reg('PUT'), delete: reg('DELETE') };
    registerOrganismIntakeRoutes(router as never, config, storage as never, H);
    submit = routes.get('POST /v1/intake/:org/:ws/:formId')!;
  });
  afterEach(() => { storage.close(); });

  async function call(): Promise<{ status: number; body: Record<string, unknown> }> {
    let status = 200;
    let body: Record<string, unknown> = {};
    const res = { status(s: number) { status = s; return res; }, json(b: Record<string, unknown>) { body = b; return res; } };
    await submit({ params: { org: ORG, ws: WS, formId: FORM }, body: { name: 'Visitor' } }, res);
    return { status, body };
  }
  const countToday = async () => ((await storage.getMemory(`system@${NODE}`, COUNT_KEY))?.value as { n?: number } | undefined)?.n ?? 0;

  it('a stored record is ok: true and spends one slot', async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect((r.body.data as { ok: boolean }).ok).toBe(true);
    expect(await countToday()).toBe(1);
  });

  it('a record the write refused is 422 INTAKE_NOT_STORED, and the slot is given back', async () => {
    publishOk = false;
    const r = await call();
    expect(r.status).toBe(422);
    expect((r.body.error as { code: string }).code).toBe('INTAKE_NOT_STORED');
    expect(await countToday()).toBe(0);
  });

  it('releaseDailySlot does not go below zero', async () => {
    await releaseDailySlot(storage as never, NODE, { org: ORG, ws: WS, formId: FORM });
    expect(await countToday()).toBe(0);
    await takeDailySlot(storage as never, NODE, { org: ORG, ws: WS, formId: FORM }, 5);
    await takeDailySlot(storage as never, NODE, { org: ORG, ws: WS, formId: FORM }, 5);
    await releaseDailySlot(storage as never, NODE, { org: ORG, ws: WS, formId: FORM });
    expect(await countToday()).toBe(1);
  });
});
