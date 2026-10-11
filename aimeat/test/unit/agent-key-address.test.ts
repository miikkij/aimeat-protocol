/**
 * @file test/unit/agent-key-address.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address rule for a memory key under `agents.`: the segment after the prefix is
 *   the agent's name, and a key that carries an identity there is named for refusal.
 * @version-history
 *   v1.0.0 -- 2026-10-11 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { identityInAgentKey, agentKeyRefusal } from '../../src/utils/agent-key-address.js';

describe('identityInAgentKey', () => {
  it('names the agent in a key built from a full identity', () => {
    expect(identityInAgentKey('agents.tarjoama-testi#alice@aimeat-local-001-dev.offers')).toBe('tarjoama-testi');
    expect(identityInAgentKey('agents.joker#alice@node.tasks.t1.live')).toBe('joker');
  });

  it('holds when the node id contains dots, which split the identity over several segments', () => {
    expect(identityInAgentKey('agents.joker#alice@node.example.com.readme')).toBe('joker');
  });

  it('catches an "@" with no "#", and a key that is only the identity', () => {
    expect(identityInAgentKey('agents.alice@node.readme')).toBe('alice');
    expect(identityInAgentKey('agents.joker#alice@node')).toBe('joker');
  });

  it('passes a key addressed by name, and the node\'s own agents.* keys', () => {
    for (const key of [
      'agents.joker.offers', 'agents.joker.tasks.t1.live', 'agents.groups',
      'agents.proposals.2e4cbd80-5617-497e-b41e-80db1d269d37', 'agents.cancel.task.abc',
    ]) expect(identityInAgentKey(key)).toBeNull();
  });

  it('reads only the name segment: an identity deeper in the key is data', () => {
    expect(identityInAgentKey('agents.joker.seen.claude#alice@node')).toBeNull();
  });

  it('leaves every other prefix alone, an email address in a key included', () => {
    for (const key of ['contacts.alice@example.com', 'crews.joker.latest_output', 'agentsX.a#b@c.d', 'agents'])
      expect(identityInAgentKey(key)).toBeNull();
  });

  it('is null for a value that is not a string', () => {
    expect(identityInAgentKey(undefined)).toBeNull();
    expect(identityInAgentKey(42)).toBeNull();
  });
});

describe('agentKeyRefusal', () => {
  it('answers with the code and the address that would have worked', () => {
    const refusal = agentKeyRefusal('agents.joker#alice@node.offers');
    expect(refusal?.code).toBe('AGENT_KEY_NOT_A_NAME');
    expect(refusal?.message).toContain('"agents.joker."');
  });

  it('still answers when nothing stands before the "#"', () => {
    expect(agentKeyRefusal('agents.#alice@node.offers')?.message).toContain('agents.<agent name>.');
  });

  it('is null for a correctly addressed key', () => {
    expect(agentKeyRefusal('agents.joker.offers')).toBeNull();
  });
});
