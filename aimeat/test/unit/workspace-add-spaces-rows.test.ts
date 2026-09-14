/**
 * @file workspace-add-spaces-rows.test.ts
 * @description `add_spaces` is the safe additive way to provision a space, and it fills the
 *   defaults a caller did not send. Those defaults were a memory space's for every backing, so a
 *   row space was handed `versioned: true` — which the row rule refuses — and the call died on a
 *   field the caller never set. A caller who worked that out and passed `versioned: false` got the
 *   space, carrying `mode: 'records'`: the storage mode of a memory space, stamped on one that
 *   stores neither records nor documents. Reported 2026-09-14 by a node building a diary on rows.
 * @structure
 *   - a row space adds with nothing but name, namespace and backing
 *   - it carries no mode, and is not versioned
 *   - its own vocabulary (indexOn, retention) survives the defaults
 *   - a memory space still gets exactly the defaults it always got
 *   - an explicit value still wins over every default
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-add-spaces-rows.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-14 — Initial.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { provisionWorkspace } from '../../src/services/workspace-provision.js';
import { updateWorkspaceMeta, readWorkspaceManifest } from '../../src/services/workspace-meta.js';
import { loadConfig } from '../../src/config.js';

const ORG = 'org-rows';
const OWNER = 'alice';
const OWNER_GHII = 'alice@aimeat-local-001-dev';

type ObjType = Record<string, unknown>;

/** A workspace with one ordinary memory space, ready to be extended. */
async function aWorkspace(storage: SqliteStorage): Promise<string> {
  const { ws } = await provisionWorkspace(storage as never, loadConfig().config, {
    orgId: ORG,
    ownerName: OWNER,
    ownerGhii: OWNER_GHII,
    name: 'Diary',
    manifest: {
      manifestVersion: '1.0', id: ORG, name: 'Diary', kind: 'project', status: 'active',
      objectTypes: [
        { name: 'form', namespace: 'diary.forms', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'diary.forms' },
      ],
    },
  });
  return ws;
}

async function addSpaces(storage: SqliteStorage, ws: string, spaces: ObjType[]) {
  return updateWorkspaceMeta(storage as never, loadConfig().config, {
    orgId: ORG, ws, callerOwner: OWNER, isAdmin: false, addObjectTypes: spaces,
  });
}

async function spaceNamed(storage: SqliteStorage, ws: string, name: string): Promise<ObjType> {
  const man = await readWorkspaceManifest(storage as never, ORG, ws);
  const ot = (man?.objectTypes as ObjType[] | undefined)?.find(o => o.name === name);
  expect(ot, `space "${name}" is in the manifest`).toBeTruthy();
  return ot!;
}

describe('add_spaces defaults follow the backing being added', () => {
  let storage: SqliteStorage;
  let ws: string;

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    ws = await aWorkspace(storage);
  });

  it('adds a row space from name, namespace and backing alone', async () => {
    const res = await addSpaces(storage, ws, [{ name: 'entry', namespace: 'diary.entries', backing: 'rows' }]);
    expect(res.added).toEqual(['entry']);
  });

  it('gives the row space no mode and no version history', async () => {
    await addSpaces(storage, ws, [{ name: 'entry', namespace: 'diary.entries', backing: 'rows' }]);
    const ot = await spaceNamed(storage, ws, 'entry');
    expect(ot.backing).toBe('rows');
    expect(ot.mode).toBeUndefined();
    expect(ot.versioned).toBe(false);
  });

  it('keeps the row space vocabulary the caller sent', async () => {
    await addSpaces(storage, ws, [{
      name: 'entry', namespace: 'diary.entries', backing: 'rows',
      indexOn: ['subjectId', 'formId'], retention: { maxDays: 3650 },
    }]);
    const ot = await spaceNamed(storage, ws, 'entry');
    expect(ot.indexOn).toEqual(['subjectId', 'formId']);
    expect(ot.retention).toEqual({ maxDays: 3650 });
  });

  it('still fills a memory space the way it always did', async () => {
    await addSpaces(storage, ws, [{ name: 'note', namespace: 'diary.notes' }]);
    const ot = await spaceNamed(storage, ws, 'note');
    expect(ot).toMatchObject({
      backing: 'memory', mode: 'records', writeRole: 'member', cardinality: 'many', versioned: true,
      schemaRef: 'schema:note@1',
    });
  });

  it('still reads kind:document as a document space', async () => {
    await addSpaces(storage, ws, [{ name: 'page', namespace: 'diary.pages', kind: 'document' }]);
    expect((await spaceNamed(storage, ws, 'page')).mode).toBe('document');
  });

  it('lets an explicit value win over the backing default', async () => {
    await addSpaces(storage, ws, [{ name: 'entry', namespace: 'diary.entries', backing: 'rows', writeRole: 'admin' }]);
    expect((await spaceNamed(storage, ws, 'entry')).writeRole).toBe('admin');
  });
});
