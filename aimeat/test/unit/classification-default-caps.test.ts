/**
 * @file test/unit/classification-default-caps.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The default audience caps (plan doc-mvdipuyqraas, L5.1) on a real SQLite store: the
 *   start step tells a new node from one that ran before on evidence (a stored node policy, or an
 *   account), runs once, offers only the caps a stored policy does not have, and a decision writes the
 *   node policy and nothing else. The three starts of one database are e2e-classification-defaults.ts.
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L5.1).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { DEFAULT_LABELS, defaultPolicy } from '../../src/services/classification/defaults.js';
import { readDefaultCapsState } from '../../src/services/classification/default-caps-state.js';
import { DEFAULT_CAPS_INCIDENT_TYPE, decideDefaultCap, settleDefaultCapsAtStart } from '../../src/services/classification/default-caps.js';
import { NODE_POLICY_KEY, readNodePolicy } from '../../src/services/classification/policy.js';
import { listSecurityIncidents, resolveSecurityIncident } from '../../src/services/security-incident.js';
import type { AimeatConfig } from '../../src/config.js';

const N = 'n';
const SYSTEM = `system@${N}`;
const config = { nodeId: N } as AimeatConfig;
const AT = '2026-10-18T00:00:00.000Z';
const OP = { principal: `op@${N}`, kind: 'human' as const };

const capOf = async (storage: SqliteStorage, id: string) => (await readNodePolicy(storage, N)).labels.find(l => l.id === id)?.maxAudience ?? null;
const offers = async (storage: SqliteStorage) => (await listSecurityIncidents(storage, config)).items.filter(i => i.type === DEFAULT_CAPS_INCIDENT_TYPE);

async function storePolicy(storage: SqliteStorage, policy: Record<string, unknown>): Promise<void> {
  await storage.setMemory({
    key: NODE_POLICY_KEY, ownerGaii: SYSTEM, value: { policy, history: [], proposal: null },
    visibility: 'private', tags: ['classification-policy'], ttlHours: null, version: 1, createdAt: AT, updatedAt: AT,
  });
}

describe('the default audience caps', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => storage.close());

  it('without a record of the start step, a node takes no cap: the defaults carry none', async () => {
    expect(defaultPolicy().labels.every(l => !l.maxAudience)).toBe(true);
    expect(await capOf(storage, 'sisainen')).toBeNull();
  });

  it('a node with no stored policy and no account is new: the caps apply, no offer, and the step runs once', async () => {
    await settleDefaultCapsAtStart(config, storage);
    expect((await readDefaultCapsState(storage, N))?.node).toBe('new');
    expect(await capOf(storage, 'julkinen')).toBeNull();
    expect(await capOf(storage, 'sisainen')).toBe('signed-in');
    expect(await capOf(storage, 'luottamuksellinen')).toBe('organism');
    expect(await capOf(storage, 'erittain-luottamuksellinen')).toBe('organism');
    expect(await offers(storage)).toHaveLength(0);
    // An account made afterwards changes nothing: the step does not run again.
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: AT } as never);
    await settleDefaultCapsAtStart(config, storage);
    expect((await readDefaultCapsState(storage, N))?.node).toBe('new');
  });

  it('a node with an account and no stored policy ran before: no cap applies, all three are offered', async () => {
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: AT } as never);
    await settleDefaultCapsAtStart(config, storage);
    const state = await readDefaultCapsState(storage, N);
    expect(state?.node).toBe('running');
    expect(state?.offered).toEqual(['sisainen', 'luottamuksellinen', 'erittain-luottamuksellinen']);
    expect(await capOf(storage, 'sisainen')).toBeNull();
    const [incident] = await offers(storage);
    expect(incident?.caps?.map(c => c.status)).toEqual(['open', 'open', 'open']);
    expect(await resolveSecurityIncident(storage, config, incident!.id)).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('a stored policy is evidence too, and a label the operator capped already is not offered', async () => {
    const labels = DEFAULT_LABELS.map(l => (l.id === 'luottamuksellinen' ? { ...l, maxAudience: 'signed-in' } : { ...l }));
    await storePolicy(storage, { labels });
    await settleDefaultCapsAtStart(config, storage);
    expect((await readDefaultCapsState(storage, N))?.offered).toEqual(['sisainen', 'erittain-luottamuksellinen']);
    expect(await capOf(storage, 'luottamuksellinen')).toBe('signed-in');
  });

  it('"apply" writes the cap into the node policy with a history line; "keep" writes nothing; the last closes the incident', async () => {
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: AT } as never);
    await settleDefaultCapsAtStart(config, storage);
    const id = (await offers(storage))[0]!.id;
    const bad = await decideDefaultCap(config, storage, { incidentId: id, name: 'sisainen', resolution: 'holder', by: OP });
    expect(bad).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    const none = await decideDefaultCap(config, storage, { incidentId: id, name: 'julkinen', resolution: 'apply', by: OP });
    expect(none).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await decideDefaultCap(config, storage, { incidentId: id, name: 'sisainen', resolution: 'apply', by: OP }))
      .toMatchObject({ ok: true, outcome: 'applied', incident_status: 'open' });
    expect(await capOf(storage, 'sisainen')).toBe('signed-in');
    // The rest of the policy keeps following the code's defaults: only the labels are stored.
    const stored = (await storage.getMemory(SYSTEM, NODE_POLICY_KEY))?.value as { policy: Record<string, unknown>; history: unknown[] };
    expect(Object.keys(stored.policy)).toEqual(['labels']);
    expect(stored.history).toHaveLength(1);
    expect(await decideDefaultCap(config, storage, { incidentId: id, name: 'luottamuksellinen', resolution: 'keep', by: OP }))
      .toMatchObject({ ok: true, outcome: 'kept' });
    expect(await capOf(storage, 'luottamuksellinen')).toBeNull();
    expect(await decideDefaultCap(config, storage, { incidentId: id, name: 'sisainen', resolution: 'keep', by: OP }))
      .toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await decideDefaultCap(config, storage, { incidentId: id, name: 'erittain-luottamuksellinen', resolution: 'apply', by: OP }))
      .toMatchObject({ ok: true, outcome: 'applied', incident_status: 'resolved' });
    expect((await offers(storage))[0]?.status).toBe('resolved');
  });

  it('a label that got a cap of its own before the decision keeps it', async () => {
    await storePolicy(storage, { labels: DEFAULT_LABELS.map(l => ({ ...l })) });
    await settleDefaultCapsAtStart(config, storage);
    await storePolicy(storage, { labels: DEFAULT_LABELS.map(l => (l.id === 'sisainen' ? { ...l, maxAudience: 'organism' } : { ...l })) });
    const id = (await offers(storage))[0]!.id;
    expect(await decideDefaultCap(config, storage, { incidentId: id, name: 'sisainen', resolution: 'apply', by: OP }))
      .toMatchObject({ ok: true, outcome: 'own-cap' });
    expect(await capOf(storage, 'sisainen')).toBe('organism');
  });
});
