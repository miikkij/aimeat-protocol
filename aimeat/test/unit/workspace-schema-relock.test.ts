/**
 * @file test/unit/workspace-schema-relock.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The start step that re-opens workspace spaces the strict lock had closed.
 *
 *   AIMEAT.organism.createWorkspace filled `{ type: 'object', additionalProperties: true }` for a
 *   records space without a schema, and a workspace locks every schema strict, which closes such an
 *   object to every property. Production held 8 such locks on 2026-10-01.
 *   A lock exactly equal to that object is positive evidence and is re-locked open; a lock that says
 *   open and admits nothing in another shape stays as it is and is reported once on the Security
 *   page. Real in-memory SQLite, and the write validator every surface uses.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-schema-relock.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { validateMemoryWrite } from '../../src/services/schema-validator.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';
import {
  settleWorkspaceSchemasAtStart, OPEN_RECORDS_SCHEMA, RELOCK_INCIDENT_TYPE,
} from '../../src/services/workspace-schema-relock.js';

const config = { nodeId: 'node-test', baseUrl: 'http://node.test' } as never;
const OLD = { type: 'object', additionalProperties: true };
const WS = 'organism.org-1.w.ws-aaa';
let storage: Storage;

async function lock(keyPattern: string, schemaJson: Record<string, unknown>, schemaMode: 'strict' | 'open' = 'strict') {
  const now = '2026-07-17T15:28:21.182Z';
  await storage.setSchema({ keyPattern, applyTo: 'prefix', schemaJson, schemaMode, lockedBy: 'alice@node-test', setAt: now, updatedAt: now });
}
const writes = async (key: string) => (await validateMemoryWrite(key, { id: 'r1', title: 'A row' }, storage)).valid;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

describe('settleWorkspaceSchemasAtStart', () => {
  it('re-opens a workspace space locked with the old filled schema', async () => {
    await lock(WS + '.shared.deals', OLD);
    expect(await writes(WS + '.shared.deals.r1')).toBe(false);

    const r = await settleWorkspaceSchemasAtStart(config, storage);

    expect(r.relocked).toEqual([WS + '.shared.deals']);
    expect(await writes(WS + '.shared.deals.r1')).toBe(true);
    const after = await storage.getSchema(WS + '.shared.deals', 'prefix');
    expect(after?.schemaJson).toEqual(OPEN_RECORDS_SCHEMA);
    expect(after?.schemaMode).toBe('strict');
    expect(after?.lockedBy).toBe('alice@node-test');
  });

  it('leaves a listed schema, an open-mode lock and a lock outside workspaces as they are', async () => {
    const listed = { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: true };
    await lock(WS + '.shared.listed', listed);
    await lock(WS + '.shared.openmode', OLD, 'open');
    await lock('csm.something', OLD);

    const r = await settleWorkspaceSchemasAtStart(config, storage);

    expect(r.relocked).toEqual([]);
    expect((await storage.getSchema(WS + '.shared.listed', 'prefix'))?.schemaJson).toEqual(listed);
    expect((await storage.getSchema(WS + '.shared.openmode', 'prefix'))?.schemaJson).toEqual(OLD);
    expect((await storage.getSchema('csm.something', 'prefix'))?.schemaJson).toEqual(OLD);
  });

  it('reports a lock that says open and admits nothing in another shape, once, and changes nothing', async () => {
    const other = { type: 'object', additionalProperties: true, required: ['id'] };
    await lock(WS + '.shared.odd', other);

    const first = await settleWorkspaceSchemasAtStart(config, storage);
    const second = await settleWorkspaceSchemasAtStart(config, storage);

    expect(first.reported).toEqual([WS + '.shared.odd']);
    expect(second.reported).toEqual([]);
    expect((await storage.getSchema(WS + '.shared.odd', 'prefix'))?.schemaJson).toEqual(other);
    const incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === RELOCK_INCIDENT_TYPE);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].detail).toContain(WS + '.shared.odd');
  });

  it('runs again without changing anything', async () => {
    await lock(WS + '.config', OLD);
    await settleWorkspaceSchemasAtStart(config, storage);
    const again = await settleWorkspaceSchemasAtStart(config, storage);
    expect(again.relocked).toEqual([]);
    expect(again.reported).toEqual([]);
  });
});
