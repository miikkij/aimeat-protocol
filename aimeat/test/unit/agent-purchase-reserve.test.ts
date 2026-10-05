/**
 * @file test/unit/agent-purchase-reserve.test.ts
 * @description An agent's daily purchase limit holds when two completions run at the same instant
 *   (secaudit 2026-10, PKG-6). The interleave is written out: both reservations read today's record
 *   before either writes, which is the order a race produces and a burst of requests often does not
 *   (see memory-cas-primitives.test.ts for why).
 * @usage pnpm test -- agent-purchase-reserve
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, PKG-6).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  setPurchaseLimit, spentToday, reserveAgentPurchase, releaseAgentPurchase, SPEND_KEY,
} from '../../src/commerce/agent-purchase-limit.js';

const OWNER = 'alice@test-node';
const AGENT = 'claude#alice@test-node';
const caller = { sub: AGENT, roles: ['agent'] };
const config = { baseUrl: 'http://localhost', nodeId: 'test-node' } as AimeatConfig;
const spend = (total: number) => ({ buyerGhii: OWNER, currency: 'EUR', total });

/** A storage whose first `n` reads of the spend record wait until all `n` have read. */
function readsTogether(inner: Storage, n: number): Storage {
  let waiting = 0;
  let open!: () => void;
  const allRead = new Promise<void>(r => { open = r; });
  return new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'getMemory') {
        return async (owner: string, key: string) => {
          const rec = await target.getMemory(owner, key);
          if (key === SPEND_KEY && waiting < n) {
            waiting++;
            if (waiting === n) open();
            await allRead;
          }
          return rec;
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

let storage: SqliteStorage;

beforeEach(async () => {
  storage = new SqliteStorage(':memory:');
  await storage.init?.();
  await setPurchaseLimit(storage, OWNER, AGENT, 'EUR', 10_000_000);
});

describe('reserveAgentPurchase', () => {
  it('lets only one of two simultaneous purchases through when both together pass the limit', async () => {
    const racing = readsTogether(storage, 2);
    const [a, b] = await Promise.all([
      reserveAgentPurchase(racing, config, spend(6_000_000), caller),
      reserveAgentPurchase(racing, config, spend(6_000_000), caller),
    ]);
    const refused = [a, b].filter(Boolean);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.code).toBe('PURCHASE_LIMIT_REACHED');
    expect((await spentToday(storage, OWNER))[AGENT]?.EUR).toBe(6_000_000);
  });

  it('counts both when together they stay within the limit', async () => {
    const racing = readsTogether(storage, 2);
    const out = await Promise.all([
      reserveAgentPurchase(racing, config, spend(4_000_000), caller),
      reserveAgentPurchase(racing, config, spend(4_000_000), caller),
    ]);
    expect(out).toEqual([null, null]);
    expect((await spentToday(storage, OWNER))[AGENT]?.EUR).toBe(8_000_000);
  });

  it('refuses an agent with no limit and counts nothing', async () => {
    const out = await reserveAgentPurchase(storage, config, { ...spend(1_000_000), currency: 'USD' }, caller);
    expect(out?.code).toBe('PURCHASE_LIMIT_NOT_SET');
    expect((await spentToday(storage, OWNER))[AGENT]?.USD).toBeUndefined();
  });

  it('gives the amount back when the money did not move', async () => {
    expect(await reserveAgentPurchase(storage, config, spend(7_000_000), caller)).toBeNull();
    await releaseAgentPurchase(storage, spend(7_000_000), caller);
    expect((await spentToday(storage, OWNER))[AGENT]?.EUR).toBe(0);
    expect(await reserveAgentPurchase(storage, config, spend(9_000_000), caller)).toBeNull();
  });

  it('does not limit the owner in person', async () => {
    expect(await reserveAgentPurchase(storage, config, spend(50_000_000), { sub: OWNER, roles: ['owner'] })).toBeNull();
    expect(await spentToday(storage, OWNER)).toEqual({});
  });
});
