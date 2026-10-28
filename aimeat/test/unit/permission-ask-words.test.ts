/**
 * @file test/unit/permission-ask-words.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the owner is asked when an agent is refused (Jouni, 2026-10-28), against a real
 *   in-memory SQLite storage:
 *     - a refused provenance declaration names provenance:write alone, not the `Held: [...]` list
 *       its text carries (on aimeat.io the owner was asked for 49 permissions, 48 of them held);
 *     - a refusal keeps only the words the agent's record lacks, on the card and in the owner's
 *       bell and email, and a refusal of words it all holds asks nothing;
 *     - the notice for a permission given on the agent's page carries Don't allow, which declines
 *       exactly those words, and its question's ref, so the answer closes it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/permission-ask-words.test.ts
 * @version-history
 *   2026-10-28 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentRecord } from '../../src/storage/interface.js';
import { initAgentRefusals, noteAgentRefusal, flushAgentRefusals, readAgentAccess } from '../../src/services/agent-refusals.js';
import { scopeDeniedWords } from '../../src/mcp/tool-usage-wrap.js';
import { ProvenanceScopeError } from '../../src/services/ai-provenance.js';
import { permissionPageNotice, permissionQuestionRef } from '../../src/services/permission-ask-notice.js';

const NODE = 'aimeat-ask-words-test';
const OWNER_GHII = `alice@${NODE}`;
const HELD = ['memory:read', 'memory:write', 'agent:read'];

function agent(name: string, extra: Partial<AgentRecord> = {}): AgentRecord {
  const now = new Date().toISOString();
  return {
    gaii: `${name}#${OWNER_GHII}`, name, owner: 'alice', capabilities: [], publicKey: '', trustScore: 50, morselBalance: 0,
    createdAt: now, lastSeen: now, mode: 'interactive', defaultScopes: HELD, ...extra,
  } as AgentRecord;
}

let storage: Storage;
let asked: string[][];

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  asked = [];
  initAgentRefusals(storage, (_owner, _agent, words) => { asked.push(words); });
  await storage.createAgent(agent('helper'));
});

describe('the words a refusal asks for', () => {
  it('a refused provenance declaration names provenance:write, not what the agent holds', () => {
    const text = `SCOPE_DENIED: ${new ProvenanceScopeError(HELD).message}`;
    expect(text).toContain('memory:write');
    expect(scopeDeniedWords({ content: [{ type: 'text', text }] })).toEqual(['provenance:write']);
  });

  it('a refusal keeps only the words the agent lacks, and the owner is asked for those alone', async () => {
    noteAgentRefusal({ sub: `helper#${OWNER_GHII}`, roles: ['agent'] }, ['provenance:write', ...HELD], false, 'MCP aimeat_memory_write');
    await flushAgentRefusals();
    const { refusals } = await readAgentAccess(storage, OWNER_GHII, 'helper', HELD);
    expect(refusals.map((r) => r.needed)).toEqual([['provenance:write']]);
    expect(asked).toEqual([['provenance:write']]);
  });

  it('a refusal of words the agent all holds asks nothing', async () => {
    noteAgentRefusal({ sub: `helper#${OWNER_GHII}`, roles: ['agent'] }, ['memory:read'], false, 'MCP aimeat_memory_read');
    await flushAgentRefusals();
    const { refusals } = await readAgentAccess(storage, OWNER_GHII, 'helper', HELD);
    expect(refusals).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe('the notice for a permission given on the agent\'s page', () => {
  it('carries Don\'t allow for exactly those words, and the ref its answer closes', () => {
    const notice = permissionPageNotice(agent('helper'), ['ai:use'], 'https://node.test');
    const deny = notice.actions?.find((a) => a.id === 'deny');
    expect(deny).toMatchObject({ kind: 'api', method: 'POST', endpoint: '/v1/agents/helper/refusals/decline', body: { needed: ['ai:use'] } });
    expect(notice.actions?.find((a) => a.id === 'open')).toMatchObject({ kind: 'navigate' });
    expect(notice.ref).toBe(permissionQuestionRef('helper', ['ai:use']));
  });
});
