/**
 * @file test/unit/search-text-credentials.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A credential record's value is not in the full-text search text (secaudit2026oct26,
 *   search-text.ts:searchableValue:secret-record-values-indexed). Search matches a word at its start,
 *   so a hit or a miss on a chosen prefix recovered the value every read door masks a character at a
 *   time. The record stays findable by its key and the key's segments; every other record's value is
 *   indexed as before, and the credential keys are the ones services/secret-records.ts masks.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { buildSearchBlob, isIndexedCredentialKey } from '../../src/storage/search-text.js';
import { isSecretRecordKey, SECRET_RECORD_KEYS, AGENT_KEY_PREFIXES } from '../../src/services/secret-records.js';
import type { MemoryRecord } from '../../src/storage/interface.js';

const rec = (key: string, value: unknown): MemoryRecord => ({
  key, value, ownerGaii: 'alice@n', visibility: 'private', tags: [], version: 1,
  createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z',
} as unknown as MemoryRecord);

const CIPHER = '3f9a1c:7b2e44:d00dfeedc0ffee';

describe('the search text of a credential record', () => {
  it.each([
    ['openrouter.apikey', { encrypted: CIPHER }],
    ['openrouter.apikey.agent.bot', { encrypted: CIPHER }],
    ['decide.apikey', { encrypted: CIPHER }],
    ['decide.apikey.provider.p1', { encrypted: CIPHER }],
    ['ai.apikey.provider.openai', { encrypted: CIPHER }],
    ['ai.apikey.agent.bot.openai', { encrypted: CIPHER }],
    ['commerce.psp', { provider: 'stripe', secretKey: 'sk_test_SECRETVALUE', webhookSecret: 'whsec_ANOTHER' }],
  ])('holds the key %s and none of its value', (key, value) => {
    const blob = buildSearchBlob(rec(key, value));
    expect(blob.startsWith(key)).toBe(true);
    for (const seg of key.split('.')) expect(blob).toContain(seg);
    expect(blob).not.toContain('d00dfeedc0ffee');
    expect(blob).not.toContain('SECRETVALUE');
    expect(blob).not.toContain('whsec_ANOTHER');
    expect(blob).not.toContain('stripe');
  });

  it('names exactly the keys the read doors mask', () => {
    for (const key of SECRET_RECORD_KEYS) expect(isIndexedCredentialKey(key), key).toBe(true);
    for (const prefix of AGENT_KEY_PREFIXES) expect(isIndexedCredentialKey(`${prefix}x`), prefix).toBe(true);
    for (const key of ['openrouter.apikeys', 'ai.apikeyx', 'commerce.psp.history', 'decide.apikeyx', 'notes.ai.apikey.x']) {
      expect(isIndexedCredentialKey(key), key).toBe(isSecretRecordKey(key));
    }
  });
});

describe('every other record', () => {
  it('keeps its value in the search text', () => {
    const blob = buildSearchBlob(rec('notes.today', { text: 'buy oat milk', nested: { word: 'findme' } }));
    expect(blob).toContain('buy oat milk');
    expect(blob).toContain('findme');
  });
});
