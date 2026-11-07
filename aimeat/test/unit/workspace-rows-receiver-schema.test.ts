/**
 * @file workspace-rows-receiver-schema.test.ts
 * @description The row service against real in-memory SQLite, for the two rules that reach every
 *   row writer and that no REST route can show yet:
 *     - a row space's JSON Schema is checked on appendRows before anything is written, and
 *       rowSpaceSchema reads it compiled (developer ruling 2026-11-07);
 *     - a RECEIVER caller decides as its owner signed in as themselves, never more: a non-member's
 *       receiver, a member's receiver without the workspace grant and a receiver on an admin-only
 *       space are refused as the owner would be, a fenced space refuses it where the owner in person
 *       passes, it never takes the extension path, and its own principal is what is stored.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-rows-receiver-schema.test.ts
 * @version-history
 *   2026-11-07 — Initial (developer ruling 2026-11-07; wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  appendRows, readRows, rowSpaceSchema, WorkspaceRowError, type RowCaller,
} from '../../src/services/workspace-rows/row-service.js';
import { systemReader } from '../../src/services/classification/reader.js';

const N = 'node-1';
const ORG = 'org-1';
const WS = 'ws1';
const stamp = '2026-11-07T08:00:00.000Z';
const ALICE = `alice@${N}`;

const config = {
  nodeId: N, wsRowsMaxRowKb: 256, wsRowsMaxPerWorkspace: 50_000, wsRowsQuotaMb: 100, classificationMode: 'off',
} as unknown as AimeatConfig;

let sqlite: SqliteStorage;
let storage: Storage;
const deps = () => ({ storage, config });

const put = (ownerGaii: string, key: string, value: unknown) => storage.setMemory({
  key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
});

const LEDGER_SCHEMA = {
  type: 'object', required: ['account', 'amount'],
  properties: { account: { type: 'string' }, amount: { type: 'number' } },
};

/** alice creates the organism and the workspace; bob is a member, dave an admin, carol nobody. */
async function seed(): Promise<void> {
  for (const name of ['alice', 'bob', 'carol', 'dave']) {
    await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
  }
  await storage.createOrganism({
    id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
    admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
    moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
    memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
  } as OrganismRecord);
  const roles: Array<[string, string]> = [['alice', 'creator'], ['bob', 'member'], ['dave', 'admin']];
  for (const [name, role] of roles) {
    await storage.createMembership({ id: `m-${name}`, organismId: ORG, ghii: name, role, status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
  }
  await put(ALICE, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Books', createdAt: stamp, createdBy: 'alice' }] });
  await put(ALICE, `organism.${ORG}.w.${WS}.meta.manifest`, {
    manifestVersion: '1', id: ORG, name: 'Books', kind: 'project', status: 'active',
    objectTypes: [
      { name: 'ledger', namespace: 'books.ledger', backing: 'rows', writeRole: 'member' },
      { name: 'free', namespace: 'books.free', backing: 'rows', writeRole: 'member' },
      { name: 'audit', namespace: 'books.audit', backing: 'rows', writeRole: 'admin' },
      // A record space that names an extension, and a row space under its namespace: the fence.
      { name: 'alerts', namespace: 'soc', backing: 'memory', mode: 'records', writeRole: 'member', extensions: ['alice/ingest'] },
      { name: 'alertrows', namespace: 'soc.rows', backing: 'rows', writeRole: 'member' },
    ],
  });
  await storage.setSchema({
    keyPattern: `organism.${ORG}.w.${WS}.books.ledger`, applyTo: 'prefix', schemaJson: LEDGER_SCHEMA,
    schemaMode: 'strict', lockedBy: ALICE, setAt: stamp, updatedAt: stamp,
  });
}

const inPerson = (name: string): RowCaller => ({ principal: name, identity: `${name}@${N}`, owner: name, roles: ['owner'], scopes: [] });
const receiverOf = (owner: string, name = 'ruuvi'): RowCaller => {
  const p = `receiver:${owner}/${name}@${N}`;
  return { principal: p, identity: p, owner, roles: ['receiver'], scopes: [], receiver: true };
};

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof WorkspaceRowError ? `${e.code}/${e.statusCode}` : String(e); }
}
const appendTo = (caller: RowCaller, space: string, rows: Array<{ rowId?: string; body: Record<string, unknown> }>) =>
  appendRows(deps(), caller, { organismId: ORG, wsId: WS, space, rows });

beforeEach(async () => { sqlite = new SqliteStorage(':memory:'); storage = sqlite as unknown as Storage; await seed(); });
afterEach(() => { sqlite.close(); });

describe('a row space\'s schema binds the writer, before anything is written', () => {
  it('rowSpaceSchema answers the compiled schema (strict adds additionalProperties:false), or null', async () => {
    expect(await rowSpaceSchema(deps(), ORG, WS, 'ledger')).toEqual({ ...LEDGER_SCHEMA, additionalProperties: false });
    expect(await rowSpaceSchema(deps(), ORG, WS, 'books.ledger')).toEqual({ ...LEDGER_SCHEMA, additionalProperties: false });
    expect(await rowSpaceSchema(deps(), ORG, WS, 'free')).toBeNull();
    expect(await codeOf(rowSpaceSchema(deps(), ORG, WS, 'alerts'))).toBe('NOT_A_ROW_SPACE/400');
  });

  it('a batch with one bad row is refused whole, naming the row and the field, and nothing is stored', async () => {
    let err: WorkspaceRowError | null = null;
    try {
      await appendTo(inPerson('alice'), 'ledger', [
        { rowId: 'r0', body: { account: 'a', amount: 1 } },
        { rowId: 'r1', body: { account: 'a', amount: 'one' } },
        { rowId: 'r2', body: { account: 'a', amount: 2, extra: 1 } },
      ]);
    } catch (e) { err = e as WorkspaceRowError; }
    expect(err?.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(err?.statusCode).toBe(422);
    expect(err?.message).toContain('rows[1]: /amount');
    expect(err?.message).toContain('rows[2]: /extra');
    expect((err?.details?.rows as Array<{ row: number }>).map(r => r.row)).toEqual([1, 2]);
    for (const id of ['r0', 'r1', 'r2']) expect(await storage.getWorkspaceRow(ORG, WS, 'books.ledger', id)).toBeNull();
  });

  it('a matching row is written, and a space with no schema takes any body', async () => {
    expect((await appendTo(inPerson('alice'), 'ledger', [{ rowId: 'ok', body: { account: 'a', amount: 1 } }])).written).toBe(1);
    expect((await appendTo(inPerson('alice'), 'free', [{ body: { whatever: [1, { x: 'y' }] } }])).written).toBe(1);
  });

  it('a receiver meets the same schema', async () => {
    expect(await codeOf(appendTo(receiverOf('alice'), 'ledger', [{ body: { account: 3, amount: 1 } }]))).toBe('SCHEMA_VALIDATION_FAILED/422');
  });
});

describe('a receiver decides as its owner in person, never more', () => {
  it('the creator\'s receiver writes and reads, and its own principal is what is stored', async () => {
    const r = receiverOf('alice');
    await appendTo(r, 'free', [{ rowId: 'x1', body: { t: 21.5 } }]);
    const row = await storage.getWorkspaceRow(ORG, WS, 'books.free', 'x1');
    expect(row?.createdBy).toBe('receiver:alice/ruuvi@node-1');
    const page = await readRows(deps(), r, { organismId: ORG, wsId: WS, space: 'free', reader: systemReader(deps(), r.identity) });
    expect(page.rows.map(x => x.rowId)).toEqual(['x1']);
  });

  it('a non-member\'s receiver is refused both ways, as the non-member is', async () => {
    expect(await codeOf(appendTo(inPerson('carol'), 'free', [{ body: { t: 1 } }]))).toBe('ACCESS_DENIED/403');
    expect(await codeOf(appendTo(receiverOf('carol'), 'free', [{ body: { t: 1 } }]))).toBe('ACCESS_DENIED/403');
    expect(await codeOf(readRows(deps(), receiverOf('carol'), { organismId: ORG, wsId: WS, space: 'free', reader: systemReader(deps(), 'x') })))
      .toBe('ACCESS_DENIED/403');
  });

  it('a plain member\'s receiver without the workspace grant is refused the write, as the member in person is', async () => {
    const inPersonCode = await codeOf(appendTo(inPerson('bob'), 'free', [{ body: { t: 1 } }]));
    expect(inPersonCode).toBe('CONSENT_REQUIRED/403');
    expect(await codeOf(appendTo(receiverOf('bob'), 'free', [{ body: { t: 1 } }]))).toBe(inPersonCode);
  });

  it('the space\'s writeRole is the owner\'s: an admin\'s receiver writes an admin space', async () => {
    expect((await appendTo(receiverOf('dave'), 'audit', [{ body: { e: 'x' } }])).written).toBe(1);
  });

  it('a fenced space refuses the receiver where its owner in person passes', async () => {
    expect((await appendTo(inPerson('alice'), 'alertrows', [{ body: { a: 1 } }])).written).toBe(1);
    expect(await codeOf(appendTo(receiverOf('alice'), 'alertrows', [{ body: { a: 1 } }]))).toBe('ACCESS_DENIED/403');
  });

  it('a receiver that also claims an extension, an app, or another owner is refused', async () => {
    expect(await codeOf(appendTo({ ...receiverOf('alice'), extension: 'ingest' }, 'free', [{ body: { a: 1 } }]))).toBe('ACCESS_DENIED/403');
    expect(await codeOf(appendTo({ ...receiverOf('alice'), roles: ['receiver', 'app'], app: 'alice/x.html' }, 'free', [{ body: { a: 1 } }]))).toBe('ACCESS_DENIED/403');
    expect(await codeOf(appendTo({ ...receiverOf('bob'), owner: 'alice' }, 'free', [{ body: { a: 1 } }]))).toBe('ACCESS_DENIED/403');
  });
});
