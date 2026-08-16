/**
 * @file chat-session.test.ts
 * @description Unit tests for one turn of the chat, on a node where the agent is configured but
 *   cannot run.
 *
 *   This is the case CI cannot reach over HTTP: the E2E node has no agent at all and refuses before
 *   anything happens, which proves the refusal but not the ordering behind it. Here the node believes
 *   it has an agent and the process fails to start, which is what a wrong path in an operator's
 *   configuration actually looks like. Three things have to hold: the person's words are already
 *   written down, the turn ends with a reason rather than a hang, and the node stays up.
 * @usage cd aimeat && pnpm vitest run test/unit/chat-session.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-16 — initial: write-before-prompt, named failure, no unhandled spawn error.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { chatEnabled, runChatTurn } from '../../src/services/chat-session.js';
import { createThread, readThread } from '../../src/services/chat-threads.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { generateKeyPair } from '../../src/auth/keypair.js';

const NODE = 'aimeat-local-001-dev';
const OWNER = 'alice';
const GAII = `${OWNER}@${NODE}`;

/** A binary that is not on any PATH, so the spawn fails the way a mistyped setting does. */
const MISSING_BINARY = 'aimeat-no-such-agent-binary';

const cfg = (over: Record<string, unknown> = {}): AimeatConfig => ({
  nodeId: NODE,
  baseUrl: 'http://localhost:40050',
  chatMaxLiveThreads: 50,
  maxAgentScopes: [],
  agentJwtTtlSeconds: 3600,
  gooseBin: MISSING_BINARY,
  goosePathRoot: '',
  gooseProviderApiKey: '',
  ...over,
} as unknown as AimeatConfig);

/**
 * The node's signing keys, once for the file.
 *
 * A turn mints an MCP token before it starts the agent, so without these the turn fails on the mint
 * and never reaches the process at all. That is how the first draft of this file passed while
 * proving nothing: every assertion below was measuring an uninitialised key store.
 */
let keysReady: Promise<void> | null = null;
function withNodeKeys(): Promise<void> {
  keysReady ??= generateKeyPair().then((kp) => initNodeKeys(kp.publicKey, kp.privateKey));
  return keysReady;
}

async function freshStorage(): Promise<Storage> {
  await withNodeKeys();
  const storage = new SqliteStorage(':memory:');
  const now = new Date().toISOString();
  const ghii: GHIIRecord = {
    username: OWNER, nodeId: NODE, ghii: GAII, displayName: OWNER,
    verificationLevel: 0, ownerName: OWNER, createdAt: now, updatedAt: now, totpEnabled: false,
  };
  await storage.createGHII(ghii);
  return storage as unknown as Storage;
}

async function collect(gen: AsyncGenerator<unknown>): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for await (const u of gen) out.push(u as Record<string, unknown>);
  return out;
}

describe('whether this node has a chat agent', () => {
  it('is decided by the configuration alone, and an empty setting means no', () => {
    expect(chatEnabled(cfg({ gooseBin: '' }))).toBe(false);
    expect(chatEnabled(cfg({ gooseBin: '   ' }))).toBe(false);
    expect(chatEnabled(cfg())).toBe(true);
  });
});

describe('a turn on a node with no agent configured', () => {
  it('says so, and writes nothing', async () => {
    const storage = await freshStorage();
    const config = cfg({ gooseBin: '' });
    const t = await createThread(storage, config, GAII);

    const events = await collect(runChatTurn({ storage, config }, OWNER, t.id, 'hello'));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('error');
    expect(String(events[0]?.message)).toMatch(/no chat agent/i);

    const read = await readThread(storage, GAII, t.id);
    expect(read?.turns).toHaveLength(0);

    storage.close?.();
  });
});

describe('a turn on a node whose agent will not start', () => {
  it('keeps the person\'s words, and ends with the reason', async () => {
    // The ordering is the point. The words are written BEFORE the agent is asked anything, so a
    // turn that dies halfway leaves the conversation showing what was said rather than a gap.
    const storage = await freshStorage();
    const config = cfg();
    const t = await createThread(storage, config, GAII);

    const events = await collect(runChatTurn({ storage, config }, OWNER, t.id, 'build me pong'));

    const last = events.at(-1);
    expect(last?.kind).toBe('error');
    expect(String(last?.message).length).toBeGreaterThan(0);

    const read = await readThread(storage, GAII, t.id);
    expect(read?.turns[0]?.role).toBe('user');
    expect(read?.turns[0]?.text).toBe('build me pong');
    expect(read?.title).toBe('build me pong');

    storage.close?.();
  }, 40_000);

  it('does not take the node down', async () => {
    // A child process that cannot be spawned emits `error`, and an `error` nobody listens for is
    // thrown out of the event loop. One wrong character in an operator's path would then end the
    // process on the first person who says hello.
    const storage = await freshStorage();
    const config = cfg();
    const t = await createThread(storage, config, GAII);

    const uncaught: Error[] = [];
    const onUncaught = (err: Error) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      await collect(runChatTurn({ storage, config }, OWNER, t.id, 'hello'));
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      process.off('uncaughtException', onUncaught);
    }

    expect(uncaught.map((e) => e.message)).toEqual([]);

    storage.close?.();
  }, 40_000);
});
