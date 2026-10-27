/**
 * @file test/unit/storage-conformance-lifecycle.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How rows that nobody uses any more go away, on both providers: an MCP client
 *   registration that no sign-in finished (secaudit2026oct22, dcr-unbounded-client-records), and the
 *   held address of a removed app (app-label-recycled-after-delete). Each case
 *   runs on every configured provider and, where both run, requires the same answer.
 *
 *   A run without DATABASE_URL checks SQLite only, and a configured Postgres that does not connect
 *   fails the suite.
 * @structure provs · onEach / same · cases
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/storage-conformance-lifecycle.test.ts
 * @version-history
 *   2026-10-27 — An account erasure holds the account's app addresses, and the next account under the
 *     name gets another (secaudit2026oct26, ensureAppSubdomain:origin-handed-to-next-name-holder).
 *   2026-10-25 — The held address of a removed app: a package removal keeps the row, another owner
 *     gets another label, the owner gets it back, and the daily sweep releases by age and by the
 *     per-owner cap (secaudit2026oct22, app-label-recycled-after-delete).
 *   2026-10-25 — Initial (secaudit2026oct22): deleteUnusedOAuthClients and the daily MCP client cleanup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { runMcpClientCleanup } from '../../src/services/mcp-client-cleanup.js';
import { deleteComponent } from '../../src/services/component-registrar.js';
import { ensureAppSubdomain } from '../../src/routes/subdomains.js';
import { sweepHeldAppLabels } from '../../src/services/held-app-labels.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';

const SQLITE_PATH = `./test/.conformance-lifecycle-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
const RUN = randomUUID().slice(0, 8);

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  console.info(`[conformance-lifecycle] providers checked: ${provs.map(p => p.name).join(', ')}`);
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

/** Run `fn` on every provider and return the results keyed by provider name. */
async function onEach<T>(fn: (s: Storage, p: string) => Promise<T>): Promise<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const { name, storage } of provs) out[name] = await fn(storage, `${RUN}${name.slice(0, 2)}`);
  return out;
}

/** Where both providers ran, they must agree. */
function same<T>(results: Record<string, T>): T {
  const values = Object.values(results);
  for (const v of values.slice(1)) expect(v).toEqual(values[0]);
  return values[0]!;
}

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const cfg = (mcpUnusedClientDays: number) => ({ mcpUnusedClientDays }) as unknown as AimeatConfig;

describe('MCP client registrations nobody uses (secaudit2026oct22, dcr-unbounded-client-records)', () => {
  it('the daily cleanup deletes an old registration with no refresh token and no approval, and keeps the rest', async () => {
    const r = await onEach(async (s, p) => {
      const id = (n: string) => `mcp_${p}_${n}`;
      const client = (n: string, createdAt: string) => s.createOAuthClient({
        clientId: id(n), clientSecret: '', clientName: `client ${n}`, redirectUris: ['http://127.0.0.1:1/cb'], createdAt,
      });
      await client('oldunused', ago(40));
      await client('oldtoken', ago(40));
      await client('oldapproved', ago(40));
      await client('newunused', ago(5));
      await s.createOAuthRefreshToken({ tokenHash: `h_${p}`, clientId: id('oldtoken'), gaii: `a@${p}`, owner: `a${p}`, roles: ['owner'], createdAt: ago(39) });
      await s.createOAuthApproval({ clientId: id('oldapproved'), gaii: `a@${p}`, owner: `a${p}`, scope: 'aimeat:full', approvedAt: ago(39) });

      const off = await runMcpClientCleanup(s, cfg(0));
      const afterOff = await Promise.all(['oldunused', 'oldtoken', 'oldapproved', 'newunused'].map(async n => !!(await s.getOAuthClient(id(n)))));
      const removed = await runMcpClientCleanup(s, cfg(30));
      const kept = await Promise.all(['oldunused', 'oldtoken', 'oldapproved', 'newunused'].map(async n => !!(await s.getOAuthClient(id(n)))));
      // The storage method on its own: a cutoff in the future reaches the new registration too.
      const direct = await s.deleteUnusedOAuthClients(new Date(Date.now() + DAY).toISOString());
      const left = await Promise.all(['oldtoken', 'oldapproved', 'newunused'].map(async n => !!(await s.getOAuthClient(id(n)))));
      await s.deleteOAuthRefreshToken(`h_${p}`);
      return { off, afterOff, removed: removed >= 1, kept, direct: direct >= 1, left };
    });
    const v = same(r);
    expect(v.off).toBe(0);
    expect(v.afterOff).toEqual([true, true, true, true]);
    expect(v.removed).toBe(true);
    expect(v.kept).toEqual([false, true, true, true]);
    expect(v.direct).toBe(true);
    expect(v.left).toEqual([true, true, false]);
  });
});

describe('the address of a removed app is held (secaudit2026oct22, app-label-recycled-after-delete)', () => {
  const site = (s: Storage, subdomain: string, target: string, heldSince: string | null = null) => {
    const now = new Date().toISOString();
    return s.createSubdomainSite({ subdomain, kind: 'app', target, enabled: true, createdBy: 'x@node', createdAt: now, updatedAt: now, origin: 'publisher', heldSince });
  };
  const labelsCfg = (over: Record<string, unknown> = {}) => ({ appHost: 'apps.example.test', appHeldLabelDays: 90, appHeldLabelsPerOwner: 2, nodeId: 'node', ...over }) as unknown as AimeatConfig;

  it('a package removal keeps the row as a held name, and the next publisher of the same file name gets another address', async () => {
    const r = await onEach(async (s, p) => {
      const owner = `own${p}`;
      const label = `notes${p}`;
      await site(s, label, `${owner}/${label}.html`);
      await deleteComponent(s, 'app', `${label}.html`, `${owner}@node`);
      const held = await s.getSubdomainSite(label);
      const other = await ensureAppSubdomain(s, labelsCfg(), `third${p}`, `${label}.html`);
      // The first owner publishes the same app again: the held address is theirs, and no longer held.
      const back = await ensureAppSubdomain(s, labelsCfg(), owner, `${label}.html`);
      const after = await s.getSubdomainSite(label);
      return { kept: !!held, heldSet: !!held?.heldSince, other: other !== label, back: back === label, cleared: after?.heldSince ?? null };
    });
    expect(same(r)).toEqual({ kept: true, heldSet: true, other: true, back: true, cleared: null });
  });

  it('an account erasure holds the account\'s addresses; the next holder of the name gets another, and a living owner\'s republish gets its own back (secaudit2026oct26)', async () => {
    const r = await onEach(async (s, p) => {
      const owner = `era${p}`;
      const label = `diary${p}`;
      const now = new Date().toISOString();
      await s.createOwner({ name: owner, displayName: owner, publicKey: 'pk', roles: ['owner'], createdAt: now } as never);
      await site(s, label, `${owner}/${label}.html`);
      await eraseOwner(s, 'node', owner);
      const held = await s.getSubdomainSite(label);
      // The name is released for reuse: a new account under it publishes the same file name.
      await s.createOwner({ name: owner, displayName: owner, publicKey: 'pk2', roles: ['owner'], createdAt: new Date().toISOString() } as never);
      const next = await ensureAppSubdomain(s, labelsCfg(), owner, `${label}.html`);
      // A living owner's delete and republish still gets its address back.
      const living = `liv${p}`;
      await site(s, `keep${p}`, `${living}/keep${p}.html`);
      await deleteComponent(s, 'app', `keep${p}.html`, `${living}@node`);
      const back = await ensureAppSubdomain(s, labelsCfg(), living, `keep${p}.html`);
      return {
        held: !!held?.heldSince, renamed: !!held && held.target.startsWith('erased:') && !held.target.includes(owner),
        nextIsAnother: next !== label, livingBack: back === `keep${p}`,
      };
    });
    expect(same(r)).toEqual({ held: true, renamed: true, nextIsAnother: true, livingBack: true });
  });

  it('the daily sweep releases a held address past the days, starts the clock on an old unmarked one, and keeps an owner to the most held addresses', async () => {
    const r = await onEach(async (s, run) => {
      // A suffix of this case's own: the case above leaves labels that end in `run` too.
      const p = `${run}z`;
      const owner = `cap${p}`;
      await site(s, `old${p}`, `${owner}/old.html`, ago(100));
      await site(s, `fresh${p}`, `${owner}/fresh.html`, ago(10));
      await site(s, `older${p}`, `${owner}/older.html`, ago(50));
      await site(s, `newest${p}`, `${owner}/newest.html`, ago(1));
      await site(s, `unmarked${p}`, `nobody${p}/gone.html`);
      const off = await sweepHeldAppLabels(s, labelsCfg({ appHeldLabelDays: 0, appHeldLabelsPerOwner: 0 }));
      const offLeft = (await s.listSubdomainSites()).filter(x => x.subdomain.endsWith(p)).length;
      const out = await sweepHeldAppLabels(s, labelsCfg());
      const bare = (labels: string[]) => labels.filter(l => l.endsWith(p)).map(l => l.slice(0, -p.length)).sort();
      const left = bare((await s.listSubdomainSites()).map(x => x.subdomain));
      const unmarked = await s.getSubdomainSite(`unmarked${p}`);
      return { offReleased: bare(off.released).length, offLeft, released: bare(out.released), left, unmarkedHeld: !!unmarked?.heldSince };
    });
    const v = same(r);
    expect(v.offReleased).toBe(0);
    expect(v.offLeft).toBe(5);
    // old is past 90 days; of the three left the cap of 2 releases the one held longest (older).
    expect(v.released).toEqual(['old', 'older']);
    expect(v.left).toEqual(['fresh', 'newest', 'unmarked']);
    expect(v.unmarkedHeld).toBe(true);
  });
});
