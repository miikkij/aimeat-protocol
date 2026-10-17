/**
 * @file audience.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The levels between private and public, decided once (services/audience.ts). Each
 *   caller kind that reaches a content read is asked at each level: the anonymous identity, a visitor
 *   signed in on another node, an account of this node outside the organism, a member, a member's
 *   agent, a member's agent the organism does not admit, an app acting for a member, and an operator
 *   who is not a member (no pass here).
 * @usage cd aimeat && pnpm exec vitest run test/unit/audience.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.0).
 */
import { describe, it, expect } from 'vitest';
import { parseAudience, formatAudience, isNodeAccount, isOrganismMember, audienceAllows, type AudienceAuth } from '../../src/services/audience.js';
import type { Storage } from '../../src/storage/interface.js';

const ORG = 'org-1';
const organism = (agentAccess: 'all' | 'listed', agentGaiis: string[] = []) => ({
  id: ORG, name: 'Innokas', agentAccess, agentGaiis, members: ['maija', 'teemu'], owners: ['maija'], admins: [],
});

function stubStorage(agentAccess: 'all' | 'listed' = 'all', agentGaiis: string[] = []): Storage {
  const rows: Record<string, { status: string }> = { maija: { status: 'active' }, teemu: { status: 'active' }, left: { status: 'left' } };
  return {
    getOrganism: async (id: string) => (id === ORG ? organism(agentAccess, agentGaiis) : null),
    getMembership: async (id: string, owner: string) => (id === ORG ? rows[owner] ?? null : null),
  } as unknown as Storage;
}

const anon: AudienceAuth = { sub: 'anonymous', owner: 'anonymous', anonymous: true };
const visitor: AudienceAuth = { sub: 'maija@other-node', owner: 'maija@other-node', federated: true };
const outsider: AudienceAuth = { sub: 'pekka@n', owner: 'pekka' };
const member: AudienceAuth = { sub: 'maija@n', owner: 'maija' };
const memberAgent: AudienceAuth = { sub: 'claude#maija@n', owner: 'maija' };
const appOfMember: AudienceAuth = { sub: 'maija@n', owner: 'maija' };
const departed: AudienceAuth = { sub: 'left@n', owner: 'left' };

describe('parseAudience and formatAudience', () => {
  it('reads the four forms and nothing else', () => {
    expect(parseAudience('private')).toEqual({ level: 'private' });
    expect(parseAudience('members')).toEqual({ level: 'members' });
    expect(parseAudience('public')).toEqual({ level: 'public' });
    expect(parseAudience(`organism:${ORG}`)).toEqual({ level: 'organism', organismId: ORG });
    for (const bad of ['', 'organism:', 'organism:../x', 'everyone', 'account', 42, null, undefined, ['public']]) {
      expect(parseAudience(bad)).toBeNull();
    }
  });
  it('writes back the string it read', () => {
    for (const s of ['private', 'members', 'public', `organism:${ORG}`]) expect(formatAudience(parseAudience(s)!)).toBe(s);
  });
});

describe('who is an account of this node', () => {
  it('refuses the anonymous identity and a visitor from another node', () => {
    expect(isNodeAccount(anon)).toBe(false);
    expect(isNodeAccount(visitor)).toBe(false);
    expect(isNodeAccount(null)).toBe(false);
    expect(isNodeAccount(undefined)).toBe(false);
  });
  it('admits an account, its agent and its app', () => {
    expect(isNodeAccount(outsider)).toBe(true);
    expect(isNodeAccount(memberAgent)).toBe(true);
    expect(isNodeAccount(appOfMember)).toBe(true);
  });
});

describe('the organism level', () => {
  const a = parseAudience(`organism:${ORG}`);
  it('admits an active member, the member\'s agent and an app acting for the member', async () => {
    const s = stubStorage();
    expect(await audienceAllows(s, a, member)).toBe(true);
    expect(await audienceAllows(s, a, memberAgent)).toBe(true);
    expect(await audienceAllows(s, a, appOfMember)).toBe(true);
  });
  it('refuses an outsider, someone who left, the anonymous identity and a visitor who shares a member\'s name', async () => {
    const s = stubStorage();
    expect(await audienceAllows(s, a, outsider)).toBe(false);
    expect(await audienceAllows(s, a, departed)).toBe(false);
    expect(await audienceAllows(s, a, anon)).toBe(false);
    expect(await audienceAllows(s, a, visitor)).toBe(false);
  });
  it('refuses a member\'s agent the organism does not admit, and admits a listed one', async () => {
    expect(await audienceAllows(stubStorage('listed', []), a, memberAgent)).toBe(false);
    expect(await audienceAllows(stubStorage('listed', ['claude#maija@n']), a, memberAgent)).toBe(true);
    // The person themself is not an agent: the listing never shuts them out.
    expect(await audienceAllows(stubStorage('listed', []), a, member)).toBe(true);
  });
  it('refuses an organism that does not exist', async () => {
    expect(await audienceAllows(stubStorage(), parseAudience('organism:no-such'), member)).toBe(false);
    expect(await isOrganismMember(stubStorage(), 'no-such', member)).toBe(false);
  });
});

describe('the other levels', () => {
  it('members admits any account of this node and nobody else', async () => {
    const s = stubStorage();
    const m = parseAudience('members');
    expect(await audienceAllows(s, m, outsider)).toBe(true);
    expect(await audienceAllows(s, m, anon)).toBe(false);
    expect(await audienceAllows(s, m, visitor)).toBe(false);
  });
  it('public admits everyone, private only the owner it names', async () => {
    const s = stubStorage();
    expect(await audienceAllows(s, parseAudience('public'), anon)).toBe(true);
    expect(await audienceAllows(s, parseAudience('private'), member, { ownerName: 'maija' })).toBe(true);
    expect(await audienceAllows(s, parseAudience('private'), outsider, { ownerName: 'maija' })).toBe(false);
    expect(await audienceAllows(s, parseAudience('private'), visitor, { ownerName: 'maija@other-node' })).toBe(false);
  });
  it('an unreadable audience admits nobody', async () => {
    expect(await audienceAllows(stubStorage(), null, member)).toBe(false);
  });
});
