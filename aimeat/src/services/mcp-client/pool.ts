/**
 * @file pool.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One live MCP client per remote server, reused across calls and closed when it goes
 *   idle.
 *
 *   WHY POOLED. Connecting costs a full MCP handshake — initialize, initialized, and an SSE stream
 *   opened and held. Paying that per tool call would make every proxied call two round trips slower
 *   than it needs to be, and would open and abandon a stream each time.
 *
 *   WHY SWEPT. A live client holds a socket and an open SSE stream against somebody else's server.
 *   This node already learned the other half of this lesson on its own MCP surface, where a session
 *   held a whole McpServer with hundreds of Zod graphs and production sat at about 1 GB of heap
 *   after four hours until an idle sweeper was added. The same shape, pointing the other way.
 *
 *   THE KEY IS (serverId, identity), NOT serverId. Under `per-user-oauth` two people reach the same
 *   server with two different tokens, and a pool keyed on the server alone would hand the second
 *   person the first person's session. That is not a performance bug; it is the whole ownership
 *   model failing quietly.
 *
 *   CLOSE, NEVER EXIT. Measured 2026-09-16: calling process.exit under a live SSE stream aborts on
 *   Windows with a libuv assertion, while ten open/list/close cycles run clean in 88 ms. Shutdown
 *   closes every entry and waits.
 * @structure McpClientPool — acquire · invalidate · closeAll · size
 * @usage const client = await pool.acquire(server, credential, identity);
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServerRecord, McpServerCredential } from '../../models/mcp-server-schemas.js';
import { buildTransport, MCP_CONNECT_TIMEOUT_MS } from './transport.js';
import { logger } from '../../utils/logger.js';

/** How long a client may sit unused before the sweeper closes it. */
const IDLE_MS = 5 * 60_000;
/** How often the sweeper looks. */
const SWEEP_MS = 30_000;

interface Entry {
  client: Client;
  lastUsed: number;
  /** Held so a second caller arriving mid-handshake waits rather than opening a second client. */
  connecting: Promise<Client> | null;
}

export class McpClientPool {
  private readonly entries = new Map<string, Entry>();
  private sweeper: NodeJS.Timeout | null = null;

  /**
   * `identity` is whose credential this client is holding: an owner's GHII under `per-user-oauth`,
   * or the fixed string `node` when everyone spends the same stored credential. It is part of the
   * key, never merely recorded — see the file header.
   */
  private key(serverId: string, identity: string): string {
    return `${serverId}::${identity}`;
  }

  async acquire(
    server: McpServerRecord,
    credential: McpServerCredential | null,
    identity: string,
  ): Promise<Client> {
    const key = this.key(server.id, identity);
    const existing = this.entries.get(key);
    if (existing) {
      // A handshake already in flight: wait for it. Without this, a burst of calls on a cold server
      // opens one client per call and abandons all but the last.
      if (existing.connecting) return existing.connecting;
      existing.lastUsed = Date.now();
      return existing.client;
    }

    const client = new Client(
      { name: 'aimeat', version: '1.0.0' },
      { capabilities: {} },
    );
    const connecting = (async () => {
      const transport = buildTransport(server, credential);
      await client.connect(transport, { timeout: MCP_CONNECT_TIMEOUT_MS });
      const entry = this.entries.get(key);
      if (entry) entry.connecting = null;
      return client;
    })();

    this.entries.set(key, { client, lastUsed: Date.now(), connecting });
    this.startSweeper();

    try {
      return await connecting;
    } catch (err) {
      // A failed handshake must not leave a dead entry behind, or every later call on this server
      // is handed a client that will never answer.
      this.entries.delete(key);
      throw err;
    }
  }

  /**
   * Drop a server's clients now: the credential was replaced, the record was edited, or the far
   * side answered 401 and the next call must re-handshake rather than reuse a session it has
   * already rejected.
   */
  async invalidate(serverId: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${serverId}::`)) continue;
      this.entries.delete(key);
      // eslint-disable-next-line aimeat/no-silent-catch -- A close that fails is a socket the far side already dropped, which is the state we were asking for. The entry is out of the map before this runs, so there is nothing left to fix and nothing an operator could act on.
      await entry.client.close().catch(() => {});
    }
  }

  private startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
    // Never hold the process open for a cache.
    this.sweeper.unref?.();
  }

  private async sweep(): Promise<void> {
    const cutoff = Date.now() - IDLE_MS;
    for (const [key, entry] of this.entries) {
      if (entry.connecting || entry.lastUsed > cutoff) continue;
      this.entries.delete(key);
      // eslint-disable-next-line aimeat/no-silent-catch -- Same as invalidate(): the entry is already out of the map, and a close that fails means the socket went first. Logging it would report a tidy-up of something that tidied itself.
      await entry.client.close().catch(() => {});
    }
    if (!this.entries.size && this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  /** Shutdown. Closes every client and waits, because exiting under a live stream aborts. */
  async closeAll(): Promise<void> {
    if (this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; }
    const all = [...this.entries.values()];
    this.entries.clear();
    // eslint-disable-next-line aimeat/no-silent-catch -- Shutdown. One unclosable socket must not stop the others from closing, and the process is going anyway; a throw here would abort the shutdown half-done.
    await Promise.all(all.map((e) => e.client.close().catch(() => {})));
    logger.debug('mcp-client: pool closed', { clients: all.length });
  }

  /** For the operator overview and the tests. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * The node's pool. One per process, because the point is reuse across requests and a per-request
 * pool would be a cache that never hits.
 */
export const mcpClientPool = new McpClientPool();
