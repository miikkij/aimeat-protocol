/**
 * @file test/unit/secret-records.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which memory records hold a credential, and what a generic door shows of them
 *   (services/secret-records.ts). Written with the per-agent AI keys, and for the hole found on the
 *   way: `decide.apikey` was not on the list, so the generic memory doors returned its ciphertext.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { isSecretRecordKey, shownMemoryValue, secretRecordWriteRefusal } from '../../src/services/secret-records.js';
import { agentKeyRecord } from '../../src/services/agent-ai-keys.js';

describe('secret records', () => {
  it('the owner\'s two AI keys and the payment record are credentials', () => {
    for (const k of ['openrouter.apikey', 'decide.apikey', 'commerce.psp']) expect(isSecretRecordKey(k)).toBe(true);
  });

  it('an agent\'s key for either model is a credential, under the name the writer uses', () => {
    expect(agentKeyRecord('decide', 'deciderbot')).toBe('decide.apikey.agent.deciderbot');
    expect(agentKeyRecord('openrouter', 'deciderbot')).toBe('openrouter.apikey.agent.deciderbot');
    expect(isSecretRecordKey(agentKeyRecord('decide', 'deciderbot'))).toBe(true);
    expect(isSecretRecordKey(agentKeyRecord('openrouter', 'deciderbot'))).toBe(true);
  });

  it('a neighbour that holds no credential is left alone', () => {
    for (const k of ['decide.policy', 'decide.rules.send-reply', 'decide.agents', 'openrouter.settings', 'decide.apikeys', 'notes.decide.apikey']) {
      expect(isSecretRecordKey(k), k).toBe(false);
    }
    expect(isSecretRecordKey(undefined)).toBe(false);
  });

  it('a generic door shows that a key is set, never its ciphertext or the variable name beside it', () => {
    const stored = { encrypted: 'iv:tag:ciphertext', env: 'TYPESAFE_API_KEY', set_at: '2026-09-20T10:00:00.000Z' };
    for (const k of ['decide.apikey', 'decide.apikey.agent.deciderbot', 'openrouter.apikey.agent.deciderbot']) {
      expect(shownMemoryValue(k, stored)).toEqual({ configured: true });
    }
    expect(shownMemoryValue('decide.policy', { allow: [] })).toEqual({ allow: [] });
  });

  it('the write refusal names the door that does write it', () => {
    expect(secretRecordWriteRefusal('decide.apikey').message).toMatch(/\/v1\/ai\/decide\/settings/);
    expect(secretRecordWriteRefusal('decide.apikey.agent.bot').message).toMatch(/\/v1\/agents\/\{name\}\/ai-keys/);
    expect(secretRecordWriteRefusal('openrouter.apikey').message).toMatch(/\/v1\/openrouter\/settings/);
  });
});
