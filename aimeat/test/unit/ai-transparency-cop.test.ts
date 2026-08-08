/**
 * @file test/unit/ai-transparency-cop.test.ts
 * @description The Code of Practice block of /v1/ai-transparency, both branches.
 *
 *   WHY A UNIT TEST AND NOT ONLY E2E. The signature is read from the environment, so a running test
 *   node exercises exactly ONE branch — whichever the machine happens to be configured for. The
 *   branch that is not exercised is the dangerous one: a bug in the `signatory: true` path is a
 *   false compliance claim published in the artefact a regulator reads first, and it would sit there
 *   unnoticed on every node that never signed. Here both branches run on every commit.
 *
 *   The block shipped as a literal `{ signatory: false, sections: [] }` from Phase 2 until the AI
 *   Office confirmed Overscale Solutions Oy's signature on 2026-08-05. That literal is what these
 *   tests replace: not "does it say false", but "does it say exactly what the operator configured,
 *   and does it say what was NOT signed".
 */
import { describe, it, expect } from 'vitest';
import { buildAiTransparency } from '../../src/routes/ai-transparency.js';
import type { AimeatConfig } from '../../src/config.js';

type Cop = {
  signatory: boolean;
  sections: string[];
  section_titles?: Record<string, string>;
  signed_on?: string | null;
  role?: string;
  not_signed?: { section: string; reason: string }[];
};

const cfg = (over: Partial<AimeatConfig>): AimeatConfig => ({
  baseUrl: 'https://aimeat.io',
  nodeId: 'aimeat-test-001',
  operator: {},
  aiProvenance: true,
  aiProvenanceDetail: 'full',
  aiLabelPublic: 'strict',
  aiSupervisoryName: '',
  aiSupervisoryUrl: '',
  aiCopSections: [],
  aiCopSignedOn: '',
  ...over,
} as unknown as AimeatConfig);

const cop = (over: Partial<AimeatConfig>) =>
  buildAiTransparency(cfg(over)).code_of_practice as Cop;

describe('code_of_practice', () => {
  it('answers no when the operator configured no sections', () => {
    const c = cop({});
    expect(c.signatory).toBe(false);
    expect(c.sections).toEqual([]);
    // No date, no role, no titles on a non-signatory: fields that exist only in the yes branch are
    // fields a reader cannot mistake for a partial yes.
    expect(c.signed_on).toBeUndefined();
    expect(c.role).toBeUndefined();
  });

  it('answers yes for exactly the sections configured, with the date', () => {
    const c = cop({ aiCopSections: ['2'], aiCopSignedOn: '2026-08-01' });
    expect(c.signatory).toBe(true);
    expect(c.sections).toEqual(['2']);
    expect(c.signed_on).toBe('2026-08-01');
    expect(c.role).toBe('deployer');
    expect(c.section_titles?.['2']).toContain('deep fakes');
  });

  it('states which section was NOT signed, with a reason a person can read', () => {
    const c = cop({ aiCopSections: ['2'], aiCopSignedOn: '2026-08-01' });
    expect(c.not_signed).toHaveLength(1);
    expect(c.not_signed?.[0].section).toBe('1');
    expect(c.not_signed?.[0].reason.length).toBeGreaterThan(40);
  });

  it('says nothing is unsigned when both sections are', () => {
    const c = cop({ aiCopSections: ['1', '2'], aiCopSignedOn: '2026-08-01' });
    expect(c.not_signed).toEqual([]);
    expect(c.role).toBe('provider-and-deployer');
  });

  it('reports the provider role for a Section 1 only signature', () => {
    expect(cop({ aiCopSections: ['1'] }).role).toBe('provider');
  });

  it('omits the date rather than inventing one', () => {
    expect(cop({ aiCopSections: ['2'] }).signed_on).toBeNull();
  });

  it('never claims a section the operator did not configure', () => {
    const c = cop({ aiCopSections: ['2'] });
    expect(c.sections).not.toContain('1');
    expect(Object.keys(c.section_titles ?? {})).toEqual(['2']);
  });
});
