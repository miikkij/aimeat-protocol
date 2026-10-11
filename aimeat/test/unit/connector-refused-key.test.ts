/**
 * @file test/unit/connector-refused-key.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a connector does when the node refuses an agent's key as not pinned
 *   (cli/connect/agent-key.ts resolveToken).
 *
 *   The rules held here. The refusal is no credential (null), not a failed attempt. It is
 *   remembered for the life of the process, so a second resolve sends no request. A new key for the
 *   same agent is tried, because the memory is of one key, not of the agent. A refusal that is not
 *   about the key (a spent rate budget) stays a failed attempt: it throws, and the next resolve
 *   asks again.
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The connector home is read once, when cli/connect/config.ts loads, so it is set before the import.
const home = mkdtempSync(join(tmpdir(), 'aimeat-refused-key-'));
const savedHome = process.env.AIMEAT_HOME;
process.env.AIMEAT_HOME = home;

const { resolveToken, generateAgentKey, storeAgentKey, MintFailedError } = await import('../../src/cli/connect/agent-key.js');

const NODE = 'http://node.invalid';

async function layKey(agent: string, owner: string): Promise<void> {
  const key = await generateAgentKey();
  await storeAgentKey(agent, owner, { ...key, gaii: `${agent}#${owner}@test-node`, nodeId: 'test-node' });
}

/** A node that answers every token request the same way, counting the requests. */
function nodeAnswering(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const KEY_REFUSED = { ok: false, error: { code: 'INVALID_ASSERTION', message: 'The assertion is not signed by the key pinned for that agent.', details: { reason: 'key_not_pinned' } } };

afterEach(() => { vi.unstubAllGlobals(); });

afterAll(() => {
  if (savedHome === undefined) delete process.env.AIMEAT_HOME;
  else process.env.AIMEAT_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe('a key the node refuses as not pinned', () => {
  it('is no credential, and is asked about once however many times it is resolved', async () => {
    await layKey('moved', 'alice');
    const node = nodeAnswering(401, KEY_REFUSED);
    expect(await resolveToken('moved', 'alice', NODE)).toBeNull();
    expect(await resolveToken('moved', 'alice', NODE)).toBeNull();
    expect(await resolveToken('moved', 'alice', NODE)).toBeNull();
    expect(node).toHaveBeenCalledTimes(1);
  });

  it('does not hold back another agent, or a new key for the same agent', async () => {
    await layKey('moved', 'bob');
    const node = nodeAnswering(401, KEY_REFUSED);
    expect(await resolveToken('moved', 'bob', NODE)).toBeNull();
    await layKey('other', 'bob');
    expect(await resolveToken('other', 'bob', NODE)).toBeNull();
    expect(node).toHaveBeenCalledTimes(2);
    // Enrolled again on this connector: a new key file under the same name.
    await layKey('moved', 'bob');
    expect(await resolveToken('moved', 'bob', NODE)).toBeNull();
    expect(node).toHaveBeenCalledTimes(3);
  });

  it('is told apart from a refusal that is not about the key, which is asked again', async () => {
    await layKey('busy', 'alice');
    const node = nodeAnswering(429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests.' } });
    await expect(resolveToken('busy', 'alice', NODE)).rejects.toBeInstanceOf(MintFailedError);
    await expect(resolveToken('busy', 'alice', NODE)).rejects.toBeInstanceOf(MintFailedError);
    expect(node).toHaveBeenCalledTimes(2);
  });

  it('is told apart from the same 401 on a node that does not say why', async () => {
    await layKey('older-node', 'alice');
    const node = nodeAnswering(401, { ok: false, error: { code: 'INVALID_ASSERTION', message: 'The assertion is not signed by the key pinned for that agent.' } });
    await expect(resolveToken('older-node', 'alice', NODE)).rejects.toBeInstanceOf(MintFailedError);
    await expect(resolveToken('older-node', 'alice', NODE)).rejects.toBeInstanceOf(MintFailedError);
    expect(node).toHaveBeenCalledTimes(2);
  });
});
