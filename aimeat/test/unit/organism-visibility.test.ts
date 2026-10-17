/**
 * @file organism-visibility.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `organism:<id>` visibility on memory records and stored files
 *   (services/organism-visibility.ts, utils/visibility-words.ts): which words the schemas take, the
 *   refusal a writer outside the organism gets, and the read decision for each kind of reader, with
 *   the reader named by its resolved identity as the access guard names it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-visibility.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.2 + V3.3).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { organismVisibilityRefusal, organismVisibilityAdmits, isStoredVisibility } from '../../src/services/organism-visibility.js';
import { memoryWriteVisibilitySchema, storedVisibilitySchema, isOrganismVisibilityWord } from '../../src/utils/visibility-words.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import type { Storage } from '../../src/storage/interface.js';

const ORG = 'org-1';
const NODE = 'n';

function stubStorage(agentAccess: 'all' | 'listed' = 'all', agentGaiis: string[] = []): Storage {
  const rows: Record<string, { status: string }> = { maija: { status: 'active' }, left: { status: 'left' } };
  return {
    getOrganism: async (id: string) => (id === ORG ? { id: ORG, name: 'Innokas', agentAccess, agentGaiis } : null),
    getMembership: async (id: string, owner: string) => (id === ORG ? rows[owner] ?? null : null),
  } as unknown as Storage;
}

beforeAll(() => setThisNodeId(NODE));
afterAll(() => setThisNodeId(null));

describe('the visibility words', () => {
  it('a memory write takes the five plain words and organism:<id>, not workspace or junk', () => {
    for (const ok of ['private', 'owner', 'group', 'members', 'public', 'organism:org-1']) {
      expect(memoryWriteVisibilitySchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['workspace', 'organism:', 'organism:-x', 'organism:a b', 'everyone', 7]) {
      expect(memoryWriteVisibilitySchema.safeParse(bad).success).toBe(false);
    }
  });
  it('a stored file takes workspace too', () => {
    expect(storedVisibilitySchema.safeParse('workspace').success).toBe(true);
    expect(isStoredVisibility('organism:org-1')).toBe(true);
    expect(isStoredVisibility('organism')).toBe(false);
    expect(isOrganismVisibilityWord('organism:org-1')).toBe(true);
    expect(isOrganismVisibilityWord('members')).toBe(false);
  });
});

describe('organismVisibilityRefusal (the write)', () => {
  const s = stubStorage();
  it('passes every value that is not organism:<id>', async () => {
    expect(await organismVisibilityRefusal(s, 'public', { identity: 'pekka@n' })).toBeNull();
    expect(await organismVisibilityRefusal(s, undefined, { identity: 'pekka@n' })).toBeNull();
  });
  it('passes an active member, as the person and as their agent', async () => {
    expect(await organismVisibilityRefusal(s, `organism:${ORG}`, { identity: 'maija@n' })).toBeNull();
    expect(await organismVisibilityRefusal(s, `organism:${ORG}`, { identity: 'claude#maija@n' })).toBeNull();
  });
  it('refuses a non-member, a departed member, an unknown organism and a malformed id with 400', async () => {
    const outsider = await organismVisibilityRefusal(s, `organism:${ORG}`, { identity: 'pekka@n' });
    expect(outsider).toMatchObject({ status: 400, code: 'NOT_ORGANISM_MEMBER' });
    expect(await organismVisibilityRefusal(s, `organism:${ORG}`, { identity: 'left@n' })).toMatchObject({ code: 'NOT_ORGANISM_MEMBER' });
    expect(await organismVisibilityRefusal(s, 'organism:nope', { identity: 'maija@n' })).toMatchObject({ code: 'NOT_ORGANISM_MEMBER' });
    expect(await organismVisibilityRefusal(s, 'organism:', { identity: 'maija@n' })).toMatchObject({ status: 400, code: 'INVALID_INPUT' });
  });
  it('refuses a visitor from another node, whose home identity shares a member\'s name', async () => {
    expect(await organismVisibilityRefusal(s, `organism:${ORG}`, { identity: 'maija@other-node' })).toMatchObject({ code: 'NOT_ORGANISM_MEMBER' });
    expect(await organismVisibilityRefusal(s, `organism:${ORG}`, { identity: 'maija@n', federated: true })).toMatchObject({ code: 'NOT_ORGANISM_MEMBER' });
  });
  it('decides for the account, so an agent the organism does not list may still write for its member owner', async () => {
    const listed = stubStorage('listed', []);
    expect(await organismVisibilityRefusal(listed, `organism:${ORG}`, { identity: 'claude#maija@n' })).toBeNull();
  });
});

describe('organismVisibilityAdmits (the read)', () => {
  const v = `organism:${ORG}`;
  it('admits a member and a member\'s agent', async () => {
    const s = stubStorage();
    expect(await organismVisibilityAdmits(s, v, { identity: 'maija@n' })).toBe(true);
    expect(await organismVisibilityAdmits(s, v, { identity: 'claude#maija@n' })).toBe(true);
  });
  it('refuses the anonymous identity, an outsider, a departed member and a visitor', async () => {
    const s = stubStorage();
    expect(await organismVisibilityAdmits(s, v, { identity: 'anonymous' })).toBe(false);
    expect(await organismVisibilityAdmits(s, v, { identity: 'shared#anonymous@n' })).toBe(false);
    expect(await organismVisibilityAdmits(s, v, { identity: 'pekka@n' })).toBe(false);
    expect(await organismVisibilityAdmits(s, v, { identity: 'left@n' })).toBe(false);
    expect(await organismVisibilityAdmits(s, v, { identity: 'maija@other-node' })).toBe(false);
    expect(await organismVisibilityAdmits(s, v, { identity: 'maija@n', federated: true })).toBe(false);
  });
  it('refuses a member\'s agent the organism does not list, and admits a listed one', async () => {
    expect(await organismVisibilityAdmits(stubStorage('listed', []), v, { identity: 'claude#maija@n' })).toBe(false);
    expect(await organismVisibilityAdmits(stubStorage('listed', ['claude#maija@n']), v, { identity: 'claude#maija@n' })).toBe(true);
  });
  it('answers false for anything that is not organism:<id>', async () => {
    expect(await organismVisibilityAdmits(stubStorage(), 'members', { identity: 'maija@n' })).toBe(false);
  });
});
