/**
 * @file contribution-proof.ts
 * @description Shared proof-of-acceleration record attached to community contributions
 *   (owner template proposals, community library packs). Structurally compatible with the
 *   curated registry's PackProof (src/data/library-packs.ts) so a proven contribution can be
 *   promoted into the curated registry as a copy. v1 proofs are SELF-REPORTED (selfReported
 *   is a literal true); a node-verified badge is a later additive field, not a change.
 * @structure ContributionProof + isValidContributionProof()
 * @usage import { type ContributionProof } from '../models/contribution-proof.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 6/8).
 */

export interface ContributionProof {
  /** Model the run was made with (e.g. 'claude-haiku-4.5'). Normalized lowercase. INDICATIVE. */
  model: string;
  verdict: 'pass' | 'fail';
  /** URL or node storage/memory ref pointing at the run evidence. */
  evidence: string;
  /** Test-set identifier, when a repeatable spec was used. */
  testSet?: string;
  /** Output tokens consumed by the run, when known. */
  tokens?: number;
  /** ISO date of the run. */
  date: string;
  /** v1 posture: every attached proof is self-reported (attribution, not audit). */
  selfReported: true;
}

export function isValidContributionProof(p: unknown): p is ContributionProof {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  return typeof v.model === 'string' && v.model.length > 0 && v.model.length <= 64
    && (v.verdict === 'pass' || v.verdict === 'fail')
    && typeof v.evidence === 'string' && v.evidence.length > 0
    && typeof v.date === 'string'
    && v.selfReported === true;
}
