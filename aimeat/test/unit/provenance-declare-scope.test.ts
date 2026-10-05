/**
 * @file test/unit/provenance-declare-scope.test.ts
 * @description Declaring how content was made needs provenance:write, asked as requireScope asks it
 *   (scopeIsCovered) and of the session's own words when the caller has them (secaudit 2026-10, C3):
 *   the stored grant alone let a session narrower than its grant declare.
 * @usage pnpm test -- provenance-declare-scope
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C3).
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import { provenanceDeclarationRefusal } from '../../src/services/ai-provenance.js';

const AGENT = 'claude#alice@test-node';
const storageWith = (defaultScopes: string[]) => ({
  getAgent: async () => ({ gaii: AGENT, defaultScopes }),
}) as unknown as Storage;
const declared = { model: 'm', level: 'generated' } as never;

describe('provenanceDeclarationRefusal', () => {
  it('refuses a session narrower than its grant', async () => {
    const out = await provenanceDeclarationRefusal(storageWith(['provenance:write', 'memory:write']),
      { principal: AGENT, declared, scopes: ['memory:write'] });
    expect(out?.code).toBe('SCOPE_DENIED');
  });

  it('admits the word in the session and the grant, the domain wildcard included', async () => {
    expect(await provenanceDeclarationRefusal(storageWith(['provenance:write']), { principal: AGENT, declared, scopes: ['provenance:write'] })).toBeNull();
    expect(await provenanceDeclarationRefusal(storageWith(['provenance:*']), { principal: AGENT, declared, scopes: ['provenance:*'] })).toBeNull();
  });

  it('refuses a grant that lost the word, whatever the session says', async () => {
    const out = await provenanceDeclarationRefusal(storageWith(['memory:write']), { principal: AGENT, declared, scopes: ['provenance:write'] });
    expect(out?.code).toBe('SCOPE_DENIED');
  });

  it('reads the grant alone when the caller has no session words', async () => {
    expect(await provenanceDeclarationRefusal(storageWith(['provenance:write']), { principal: AGENT, declared })).toBeNull();
  });
});
