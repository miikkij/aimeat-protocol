/**
 * @file storage-owner-relations.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification gate sees actual columns and rejects missing or unsupported claims.
 * @version-history 1.0.0 2026-09-27 Schema drift and negative controls.
 *   1.0.1 2026-10-14 The pending-decision state is shown on a copy of a real entry: the inventory has
 *     no open decision since the account erasure decided the last 28 (QA audit K3), and the test read
 *     "some entry is still required" off the backlog, which was red in CI on 262f3697e.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { identityRelations, validateRelationReviews, type RelationReview } from '../../scripts/lib/storage-owner-relations.js';
const source = readFileSync('src/storage/providers/postgres-kysely/db-types.ts', 'utf8');
const reviews = JSON.parse(readFileSync('security/storage-owner-relations.json', 'utf8')).relations as Record<string, RelationReview>;
describe('identity relation inventory', () => {
  it('classifies every additional identity column and distinguishes policy decisions from proof', () => {
    expect(validateRelationReviews(identityRelations(source), reviews, existsSync)).toEqual([]);
    // A pending policy decision stays a valid state beside a proven contract. The inventory had open
    // ones until 2026-10-14, when the account erasure decided the last 28 (QA audit K3), so the
    // distinction is shown on a copy of a real entry rather than read off the current backlog.
    const proven = reviews['AiProvenance.ownerGhii'];
    expect(validateRelationReviews(['T.ownerGhii'], { 'T.ownerGhii': { ...proven, decision: 'required', verification: 'source-reviewed' } }, existsSync)).toEqual([]);
    expect(proven.decision).toBe('existing-contract');
  });
  it('fails for a newly added ownerGhii column even if the old cascade gate cannot see it', () => {
    expect(validateRelationReviews([...identityRelations(source), 'NewCredential.ownerGhii'], reviews, existsSync))
      .toContain('NewCredential.ownerGhii: missing classification');
  });
  it('ignores comments and non-table interfaces, but sees quoted columns', () => {
    expect(identityRelations(`// ownerGhii: string;
      interface NotATable { ownerGhii: string }
      interface Actual { "createdBy": string; other: number }
      interface DB { Actual: Actual }`)).toEqual(['Actual.createdBy']);
  });
  it('refuses empty evidence, absent tests and stale entries', () => {
    expect(validateRelationReviews(['T.ownerGhii'], { 'T.ownerGhii': {
      role: 'ownership', current: '', reason: '', evidence: [], test: '',
      verification: 'source-reviewed', decision: 'required',
    } }, () => false)).toHaveLength(3);
    expect(validateRelationReviews([], { stale: reviews['AiProvenance.ownerGhii'] }, existsSync))
      .toContain('stale: stale classification');
  });
});
