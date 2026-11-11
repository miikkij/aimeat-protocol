/**
 * @file test/unit/storage-conformance-organism-delete.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deleting an organism, or one of its workspaces, removes what is stored under it
 *   outside the memory table, on both storage providers.
 *
 *   Found on an organisation node on 2026-11-10 and confirmed on main the next day: an organism
 *   delete removed the memory, the members, the board and the labels, but left the rows of its
 *   workspaces' row spaces, their kept revisions, its invitations (with the invitee's email) and its
 *   pending approvals in the database. Nothing could read or delete them afterwards, because every
 *   route that reaches a row needs the workspace manifest, which went with the memory. A workspace
 *   delete left its rows the same way (incident deleting-a-workspace-leaves-its-row-space-rows-
 *   behind, 2026-10-23), and a new workspace with the same id would have shown them again.
 *
 *   What it proves, per provider:
 *     - deleteOrganism removes the organism's rows, row revisions, invitations and pending approvals;
 *     - another organism's rows, revisions, invitations and approvals stay;
 *     - deleteWorkspaceRowsOf(org, ws) removes one workspace's rows and revisions and keeps the
 *       organism's other workspace;
 *     - deleteWorkspaceRowsOf(org) with no workspace removes every workspace's rows of that organism;
 *     - unlinkSsoConnectionsOfOrganism(org) clears the organism on the SSO connections that name it,
 *       keeps the connections, and leaves another organism's connection and an unlinked one alone.
 *
 *   Runs SQLite always and Postgres when DATABASE_URL is set (AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true
 *   makes a missing DATABASE_URL a failure).
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-conformance-organism-delete.test.ts
 * @version-history
 *   v1.1.0 — 2026-11-11 — The SSO unlink of an organism delete, on both providers.
 *   v1.0.0 — 2026-11-11 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type {
  Storage, OrganismRecord, WorkspaceRowRecord, WorkspaceRowRevision, PendingApprovalRecord, SsoConnectionRecord,
} from '../../src/storage/interface.js';
import type { InvitationRecord } from '../../src/storage/repositories/invitation.repository.js';

const SQLITE_PATH = `./test/.conformance-organism-delete-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';
const NODE = 'orgdel-node';
const NS = 'crm.mail';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
/** The organisms this run made, removed at the end so a shared Postgres database keeps nothing. */
const madeOrgs: string[] = [];
/** The SSO connections this run made, removed at the end for the same reason. */
const madeSso: string[] = [];

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  else console.warn('[conformance] DATABASE_URL not set — the Postgres half is skipped, sqlite still runs');
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    for (const id of madeOrgs) {
      await storage.deleteWorkspaceRowsOf(id).catch(() => undefined);
      await storage.deleteOrganism(id).catch(() => false);
    }
    for (const id of madeSso) await storage.deleteSsoConnection(id).catch(() => false);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

const now = () => new Date().toISOString();

async function makeOrganism(storage: Storage): Promise<string> {
  const id = randomUUID();
  madeOrgs.push(id);
  const t = now();
  await storage.createOrganism({
    id, name: `Org ${id.slice(0, 8)}`, description: '', type: 'project', interests: [],
    creatorGhii: `alice@${NODE}`, createdBy: `alice@${NODE}`, owners: [`alice@${NODE}`], admins: [], members: [],
    agentGaiis: [], boardId: '', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
    moderationConfig: { flagsEnabled: false, autoHideThreshold: 3, appealsEnabled: false },
    memoryNamespace: `organism.${id}`, createdAt: t, updatedAt: t,
  } as OrganismRecord);
  return id;
}

/** One row and one kept revision of it in (org, ws). */
async function seedRow(storage: Storage, organismId: string, wsId: string, rowId: string): Promise<void> {
  const t = now();
  const body = { subject: rowId, from: 'carol@example.com' };
  await storage.appendWorkspaceRows([{
    id: `sur-${randomUUID()}`, organismId, wsId, namespace: NS, rowId, k1: '', k2: '', k3: '',
    occurredAt: t, createdAt: t, updatedAt: t, createdBy: `alice@${NODE}`, updatedBy: `alice@${NODE}`,
    body, bytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
  } as WorkspaceRowRecord]);
  const revision: WorkspaceRowRevision = {
    revisionId: `rev-${randomUUID()}`, organismId, wsId, namespace: NS, rowId, id: `sur-old-${rowId}`,
    occurredAt: t, createdAt: t, updatedAt: t, createdBy: `alice@${NODE}`, updatedBy: `bob@${NODE}`,
    body: { subject: `${rowId} before` }, bytes: 20, replacedAt: t, replacedBy: `alice@${NODE}`,
  };
  await storage.appendWorkspaceRowRevisions([revision]);
}

async function seedInvitation(storage: Storage, organismId: string): Promise<string> {
  const id = `inv-${randomUUID()}`;
  const t = now();
  const rec: InvitationRecord = {
    id, tokenHash: `hash-${randomUUID()}`, organismId, orgRole: 'member', type: 'link', workspaces: [],
    email: 'carol@example.com', emailHash: `eh-${randomUUID()}`, invitedBy: 'alice', provisionedOwner: null,
    message: null, status: 'accepted', createdAt: t, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    acceptedAt: t, acceptedBy: 'carol', returnUrl: null, meta: null,
  };
  await storage.createInvitation(rec);
  return id;
}

async function seedApproval(storage: Storage, organismId: string): Promise<string> {
  const id = `pa-${randomUUID()}`;
  const t = now();
  await storage.createPendingApproval({
    id, organismId, actor: `bot#alice@${NODE}`, action: 'egress', arguments: { to: 'carol@example.com' },
    risk: 'medium', approverRole: 'owner', status: 'pending', createdAt: t, updatedAt: t,
  } as PendingApprovalRecord);
  return id;
}

async function seedSso(storage: Storage, organismId: string | null): Promise<string> {
  const id = `sso-${randomUUID()}`;
  madeSso.push(id);
  const t = now();
  const rec: SsoConnectionRecord = {
    id, name: 'Company sign-in', organismId, domains: ['example.com'], saml: null,
    allowIdpInitiated: false, loginVisibility: 'listed', createdBy: `alice@${NODE}`, createdAt: t, updatedAt: t,
  };
  await storage.createSsoConnection(rec);
  return id;
}

async function rowCount(storage: Storage, organismId: string, wsId: string): Promise<number> {
  const page = await storage.listWorkspaceRows({ organismId, wsId, namespace: NS, limit: 100 });
  return page.rows.length;
}

async function revisionCount(storage: Storage, organismId: string, wsId: string, rowId: string): Promise<number> {
  return (await storage.listWorkspaceRowRevisions(organismId, wsId, NS, rowId)).length;
}

describe.each([['sqlite'], ['postgres-kysely']])('organism and workspace delete on %s', (name) => {
  const p = () => provs.find(x => x.name === name);

  it('deleteOrganism removes its rows, row revisions, invitations and pending approvals, and keeps another organism\'s', async () => {
    if (!p()) return;
    const { storage } = p()!;
    const gone = await makeOrganism(storage);
    const kept = await makeOrganism(storage);
    await seedRow(storage, gone, 'ws-a', 'r1');
    await seedRow(storage, gone, 'ws-b', 'r2');
    await seedRow(storage, kept, 'ws-a', 'k1');
    const goneInv = await seedInvitation(storage, gone);
    const keptInv = await seedInvitation(storage, kept);
    const goneApproval = await seedApproval(storage, gone);
    const keptApproval = await seedApproval(storage, kept);

    expect(await storage.deleteOrganism(gone)).toBe(true);

    expect(await rowCount(storage, gone, 'ws-a')).toBe(0);
    expect(await rowCount(storage, gone, 'ws-b')).toBe(0);
    expect(await revisionCount(storage, gone, 'ws-a', 'r1')).toBe(0);
    expect(await revisionCount(storage, gone, 'ws-b', 'r2')).toBe(0);
    expect(await storage.getInvitation(goneInv)).toBeNull();
    expect(await storage.getPendingApproval(goneApproval)).toBeNull();

    expect(await rowCount(storage, kept, 'ws-a')).toBe(1);
    expect(await revisionCount(storage, kept, 'ws-a', 'k1')).toBe(1);
    expect(await storage.getInvitation(keptInv)).not.toBeNull();
    expect(await storage.getPendingApproval(keptApproval)).not.toBeNull();
  });

  it('deleteWorkspaceRowsOf(org, ws) removes one workspace\'s rows and revisions and keeps the other workspace', async () => {
    if (!p()) return;
    const { storage } = p()!;
    const org = await makeOrganism(storage);
    await seedRow(storage, org, 'ws-a', 'r1');
    await seedRow(storage, org, 'ws-b', 'r2');

    const out = await storage.deleteWorkspaceRowsOf(org, 'ws-a');
    expect(out).toEqual({ rows: 1, revisions: 1 });

    expect(await rowCount(storage, org, 'ws-a')).toBe(0);
    expect(await revisionCount(storage, org, 'ws-a', 'r1')).toBe(0);
    expect(await rowCount(storage, org, 'ws-b')).toBe(1);
    expect(await revisionCount(storage, org, 'ws-b', 'r2')).toBe(1);
  });

  it('deleteWorkspaceRowsOf(org) with no workspace removes every workspace\'s rows of that organism only', async () => {
    if (!p()) return;
    const { storage } = p()!;
    const org = await makeOrganism(storage);
    const other = await makeOrganism(storage);
    await seedRow(storage, org, 'ws-a', 'r1');
    await seedRow(storage, org, 'ws-b', 'r2');
    await seedRow(storage, other, 'ws-a', 'o1');

    const out = await storage.deleteWorkspaceRowsOf(org);
    expect(out).toEqual({ rows: 2, revisions: 2 });

    expect(await rowCount(storage, org, 'ws-a')).toBe(0);
    expect(await rowCount(storage, org, 'ws-b')).toBe(0);
    expect(await rowCount(storage, other, 'ws-a')).toBe(1);
    expect(await revisionCount(storage, other, 'ws-a', 'o1')).toBe(1);
  });

  it('unlinkSsoConnectionsOfOrganism clears the link on that organism\'s connections, keeps them, and leaves every other connection as it was', async () => {
    if (!p()) return;
    const { storage } = p()!;
    const gone = await makeOrganism(storage);
    const kept = await makeOrganism(storage);
    const first = await seedSso(storage, gone);
    const second = await seedSso(storage, gone);
    const other = await seedSso(storage, kept);
    const unlinked = await seedSso(storage, null);

    expect(await storage.unlinkSsoConnectionsOfOrganism(gone)).toBe(2);

    for (const id of [first, second]) {
      const after = await storage.getSsoConnection(id);
      expect(after).not.toBeNull();
      expect(after?.organismId ?? null).toBeNull();
      expect(after?.domains).toEqual(['example.com']);
    }
    expect((await storage.getSsoConnection(other))?.organismId).toBe(kept);
    expect((await storage.getSsoConnection(unlinked))?.organismId ?? null).toBeNull();
    // A second call finds nothing left to change.
    expect(await storage.unlinkSsoConnectionsOfOrganism(gone)).toBe(0);
  });
});
