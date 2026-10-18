/**
 * @file test/unit/agent-invites.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent whose permissions cover organism:invite may invite people, and an invitation
 *   can create a new account. The node (services/agent-invites.ts) and the pages
 *   (public/js/consent-vocab.js) read the same permissions the same way, and the page shows the
 *   sentence from the real en.json.
 * @version-history
 *   v1.0.0 — 2026-10-18 — wish-datakarttaan-ja-agentin-kuvaukseen-tieto-kutsuista-ja-tilien.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { invitesPeople, withInvitesSentence, INVITES_SENTENCE } from '../../src/services/agent-invites.js';
import { invitesPeople as pageInvitesPeople, invitesSentence } from '../../public/js/consent-vocab.js';
import { proposalNextStep } from '../../src/services/agent-proposals.js';

const CASES: Array<[string, string[], boolean]> = [
  ['the word itself', ['memory:read', 'organism:invite'], true],
  ['the organism wildcard', ['organism:*'], true],
  ['the global wildcard', ['*'], true],
  ['other organism words', ['organism:read', 'organism:write'], false],
  ['no permissions', [], false],
];

describe('whether an agent may invite people', () => {
  it.each(CASES)('the node reads %s', (_label, scopes, may) => {
    expect(invitesPeople(scopes)).toBe(may);
  });

  it.each(CASES)('the page reads %s the same way', (_label, scopes, may) => {
    expect(pageInvitesPeople(scopes)).toBe(may);
  });

  it('a missing list is no permission', () => {
    expect(invitesPeople(undefined)).toBe(false);
    expect(pageInvitesPeople(undefined)).toBe(false);
  });

  it('the page shows the sentence from the real en.json', () => {
    const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../locales/en.json', import.meta.url)), 'utf-8'));
    const t = (key: string): string => key.split('.').reduce((o: any, k) => o?.[k], en) ?? key;
    const s = invitesSentence(t);
    expect(s).not.toBe('consent.preset.invitesPeople');
    expect(s).toBe(INVITES_SENTENCE);
  });

  it('the proposal answer says it only when the permissions cover the word', () => {
    expect(withInvitesSentence('Approve it.', ['organism:invite'])).toBe(`Approve it. ${INVITES_SENTENCE}`);
    expect(withInvitesSentence('Approve it.', ['memory:read'])).toBe('Approve it.');
    expect(proposalNextStep('Helper', 'https://x/approve', false, ['organism:invite'])).toContain(INVITES_SENTENCE);
    expect(proposalNextStep('Helper', 'https://x/approve', false, ['memory:read'])).not.toContain(INVITES_SENTENCE);
    expect(proposalNextStep('Helper', 'https://x/approve', false)).not.toContain(INVITES_SENTENCE);
  });
});
