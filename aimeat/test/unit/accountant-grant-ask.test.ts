/**
 * @file test/unit/accountant-grant-ask.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-only step over the accountant grants from before grant times were kept
 *   (services/finance/accountant-grant-ask.ts): an entry whose holder registered after the list began
 *   and no later than its last write is asked of the client with one press; the entries the estimate
 *   decides with certainty (a holder from before the list, or one registered after its last write) are
 *   not touched. Until the client answers the grant works as before; Allow keeps it and records it as
 *   confirmed, Don't allow removes it. The step runs once.
 * @usage cd aimeat && pnpm exec vitest run test/unit/accountant-grant-ask.test.ts
 * @version-history
 *   2026-10-29 -- Initial (secaudit2026oct26 round 8c, finance/accountant-access:grant-survives-erasure-rebinds-on-name-reuse).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Request } from 'express';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { resolveFinanceOwner, listAccountants } from '../../src/services/finance/accountant-access.js';
import { askUncertainAccountantGrantsOnce } from '../../src/services/finance/accountant-grant-ask.js';
import { listPublishRequests } from '../../src/services/publish-requests/store.js';
import { decidePublishRequest } from '../../src/services/publish-requests/decide.js';
import { callerFromAuth } from '../../src/services/caller-context.js';

const NODE = 'grant-ask-node';
const config = { nodeId: NODE, baseUrl: 'https://node.test' } as unknown as AimeatConfig;
const g = (name: string) => `${name}@${NODE}`;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const CLIENT = g('client');

const asReader = (reader: string) => ({ auth: { owner: reader }, query: { owner: 'client' } }) as unknown as Request;
const reads = (s: Storage, reader: string) => resolveFinanceOwner(config, s, asReader(reader)).then(() => true, () => false);

describe('older accountant grants the estimate cannot place', () => {
  let storage: Storage;
  const client = () => callerFromAuth({ sub: 'client', owner: 'client', roles: ['owner'], scopes: ['*'] }, NODE, storage);
  const ctx = () => ({ storage, config });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    for (const [name, days] of [['client', 100], ['carol', 60], ['bobby', 20], ['dave', 5]] as const) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: ago(days) } as never);
    }
    // A list from before grant times were kept: begun 30 days ago, last written 10 days ago.
    await storage.setMemory({
      key: 'finance.accountants', ownerGaii: CLIENT, value: { list: [g('carol'), g('bobby'), g('dave')] },
      visibility: 'private', tags: ['finance'], ttlHours: null, version: 3, createdAt: ago(30), updatedAt: ago(10),
    } as never);
  });

  it('asks about the one it cannot place, and it reads as before until the client answers', async () => {
    // Usage before the step: carol and bobby read, dave (registered after the last write) does not.
    expect([await reads(storage, 'carol'), await reads(storage, 'bobby'), await reads(storage, 'dave')]).toEqual([true, true, false]);
    const asked = await askUncertainAccountantGrantsOnce(storage, config);
    expect(asked).toEqual([`${CLIENT} ${g('bobby')}`]);
    const waiting = (await listPublishRequests(storage, CLIENT)).filter(r => r.kind === 'accountant-grant');
    expect(waiting.map(r => [r.state, r.target.accountant])).toEqual([['awaiting_owner', g('bobby')]]);
    const notes = await storage.listMemory(CLIENT, { prefix: 'notif.' });
    expect(notes.some(n => JSON.stringify(n.value).includes('approval_accountant_grant'))).toBe(true);
    // Unchanged until the answer.
    expect([await reads(storage, 'carol'), await reads(storage, 'bobby'), await reads(storage, 'dave')]).toEqual([true, true, false]);
    expect(await askUncertainAccountantGrantsOnce(storage, config)).toBeNull();
  });

  it('Allow keeps the grant and records it as confirmed', async () => {
    await askUncertainAccountantGrantsOnce(storage, config);
    const id = (await listPublishRequests(storage, CLIENT)).find(r => r.kind === 'accountant-grant')!.id;
    expect(await decidePublishRequest(ctx(), { caller: client() }, id, 'approve')).toMatchObject({ ok: true });
    expect(await reads(storage, 'bobby')).toBe(true);
    const v = (await storage.getMemory(CLIENT, 'finance.accountants'))!.value as { confirmedAt?: Record<string, string>; grantedAt?: Record<string, string> };
    expect(typeof v.confirmedAt?.[g('bobby')]).toBe('string');
    expect(typeof v.grantedAt?.[g('bobby')]).toBe('string');
    expect(await listAccountants(storage, CLIENT)).toEqual([g('carol'), g('bobby'), g('dave')]);
  });

  it('Don\'t allow removes the grant, and nothing else', async () => {
    await askUncertainAccountantGrantsOnce(storage, config);
    const id = (await listPublishRequests(storage, CLIENT)).find(r => r.kind === 'accountant-grant')!.id;
    expect(await decidePublishRequest(ctx(), { caller: client() }, id, 'decline')).toMatchObject({ ok: true });
    expect(await reads(storage, 'bobby')).toBe(false);
    expect(await reads(storage, 'carol')).toBe(true);
    expect(await listAccountants(storage, CLIENT)).toEqual([g('carol'), g('dave')]);
  });
});
