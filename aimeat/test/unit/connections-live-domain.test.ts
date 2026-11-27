/**
 * @file test/unit/connections-live-domain.test.ts
 * @description A change to a person's connected accounts is announced on the `connections` live
 *   domain to that account's owner only (services/connections/live.ts): the Email and Access pages
 *   wait on it for a connect round to finish instead of polling GET /v1/connections. Held here: the
 *   event names the domain and the connection's principal (the SSE transport forwards it to that
 *   owner's streams alone), a needs-a-new-sign-in mark is written before it is announced, a removal
 *   is announced after the row is gone, and a refused removal announces nothing.
 * @usage cd aimeat && pnpm vitest run test/unit/connections-live-domain.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { onChangeEvent, offChangeEvent, type ChangeEvent } from '../../src/services/event-bus.js';
import { announceConnectionChange, markNeedsReauth, CONNECTIONS_DOMAIN } from '../../src/services/connections/live.js';
import { revokeConnection } from '../../src/services/connections/refresh.js';
import type { ConnectContext } from '../../src/services/connections/oauth.js';
import type { ConnectionRecord } from '../../src/models/connection-schemas.js';

const GHII = 'alice@node-test';
const GAII = 'bot#alice@node-test';

const seen: ChangeEvent[] = [];
const handler = (evt: ChangeEvent): void => { seen.push(evt); };
afterEach(() => { offChangeEvent(handler); seen.length = 0; });

const connections = () => seen.filter((e) => e.domain === CONNECTIONS_DOMAIN);

describe('announceConnectionChange', () => {
  it('names the connections domain and the principal, so only that owner hears it', () => {
    onChangeEvent(handler);
    announceConnectionChange(GHII);
    expect(connections()).toHaveLength(1);
    expect(connections()[0]).toMatchObject({ domain: 'connections', ownerGaii: GHII });
  });

  it("carries an agent's GAII as it is: the transport compares its owner segment", () => {
    onChangeEvent(handler);
    announceConnectionChange(GAII);
    expect(connections()[0]?.ownerGaii).toBe(GAII);
  });
});

describe('markNeedsReauth', () => {
  it('writes the status first, then announces it', async () => {
    const order: string[] = [];
    onChangeEvent((evt) => { if (evt.domain === CONNECTIONS_DOMAIN) order.push('announced'); });
    onChangeEvent(handler);
    const storage = {
      setConnectionStatus: async (id: string, status: string, why: string) => { order.push(`status:${id}:${status}:${why}`); },
    };
    await markNeedsReauth(storage as never, { id: 'c1', principal: GHII }, 'token refused');
    expect(order[0]).toBe('status:c1:needs_reauth:token refused');
    expect(order).toContain('announced');
    expect(connections()[0]?.ownerGaii).toBe(GHII);
  });
});

describe('revokeConnection', () => {
  const row = { id: 'c2', principal: GHII, provider: 'no-such-provider', instance: null, credential: 'not-a-sealed-credential' } as unknown as ConnectionRecord;
  const ctxWith = (stored: ConnectionRecord | null, deleted: string[]): ConnectContext => ({
    config: {} as never,
    providers: [],
    key: Buffer.alloc(32),
    storage: {
      getConnection: async () => stored,
      deleteConnection: async (id: string) => { deleted.push(id); return true; },
    } as never,
  });

  it('announces a removed connection to its owner after the row is gone', async () => {
    onChangeEvent(handler);
    const deleted: string[] = [];
    const out = await revokeConnection(ctxWith(row, deleted), 'c2');
    expect(out.ok).toBe(true);
    expect(deleted).toEqual(['c2']);
    expect(connections()).toHaveLength(1);
    expect(connections()[0]?.ownerGaii).toBe(GHII);
  });

  it('announces nothing when there was no such connection', async () => {
    onChangeEvent(handler);
    const out = await revokeConnection(ctxWith(null, []), 'missing');
    expect(out.ok).toBe(false);
    expect(connections()).toHaveLength(0);
  });
});
