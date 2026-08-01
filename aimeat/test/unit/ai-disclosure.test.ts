/**
 * @file test/unit/ai-disclosure.test.ts
 * @description The disclosure decision, exhaustively. disclosureFor() is the ONE place that decides
 *   whether a visible label is owed, so it gets the full cross-product: every `level` × every
 *   `humanInvolvement` × every `visibility`, plus the rows that carry the legal weight — the
 *   editorial-control row that must NOT be force-labelled, the private row where nobody is being
 *   informed of anything, the machine-to-machine row where the record IS the disclosure, and the
 *   unstated row where we know nothing and must not invent an obligation.
 * @structure
 *   - LEVELS × INVOLVEMENT × VISIBILITY cross-product
 *   - one describe per rule from 06-platform-design.md §4
 * @usage pnpm exec vitest run test/unit/ai-disclosure.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import { describe, it, expect } from 'vitest';
import { disclosureFor, type SurfaceContext } from '../../src/services/ai-disclosure.js';
import {
  AI_PROVENANCE_SPEC_V1, AI_PROVENANCE_LEVELS, AI_HUMAN_INVOLVEMENT,
  type AiProvenance, type AiProvenanceLevel, type AiHumanInvolvement,
} from '../../src/models/ai-provenance-schemas.js';

const VISIBILITIES: SurfaceContext['visibility'][] =
  ['private', 'owner', 'group', 'workspace', 'members', 'public'];

function rec(level: AiProvenanceLevel, humanInvolvement: AiHumanInvolvement): AiProvenance {
  return { spec: AI_PROVENANCE_SPEC_V1, level, humanInvolvement, generatedAt: '2026-08-01T18:42:00Z' };
}

/** A person reading a public page. The default surface everything else is measured against. */
const publicPage: SurfaceContext = { visibility: 'public', humanAudience: true };

/** True when this combination owes a full 50(4) label on an anonymously readable page. */
function owesFullLabel(level: AiProvenanceLevel, human: AiHumanInvolvement): boolean {
  const unreviewed = human === 'none' || human === 'light-review';
  return unreviewed && (level === 'ai-generated' || level === 'synthesized');
}

describe('the cross-product: level × humanInvolvement × visibility', () => {
  for (const level of AI_PROVENANCE_LEVELS) {
    for (const human of AI_HUMAN_INVOLVEMENT) {
      for (const visibility of VISIBILITIES) {
        const expected = visibility === 'public' && owesFullLabel(level, human);
        it(`${level} × ${human} × ${visibility} → ${expected ? 'full label' : 'no label'}`, () => {
          const d = disclosureFor(rec(level, human), { ...publicPage, visibility });
          expect(d.required).toBe(expected);
          expect(d.strength).toBe(expected ? 'full' : 'none');
          expect(d.reason).toBe(expected ? 'art50_4_public_interest' : 'none');
        });
      }
    }
  }
});

describe('editorial control is not force-labelled', () => {
  for (const level of AI_PROVENANCE_LEVELS) {
    for (const human of ['editorial-control', 'full-human'] as AiHumanInvolvement[]) {
      it(`${level} × ${human} on a public page owes no 50(4) label`, () => {
        const d = disclosureFor(rec(level, human), publicPage);
        expect(d.required).toBe(false);
        expect(d.reason).toBe('none');
      });
    }
  }

  it('a person examining the substance is what upgrades it — publishing is not that step', () => {
    // light-review is a skim. It stays on the labelled side of the line.
    expect(disclosureFor(rec('ai-generated', 'light-review'), publicPage).required).toBe(true);
    expect(disclosureFor(rec('ai-generated', 'editorial-control'), publicPage).required).toBe(false);
  });
});

describe('the publisher declares editorial control; the node never infers it', () => {
  it('a declaration at publication lifts the 50(4) text duty, like the record field does', () => {
    const d = disclosureFor(rec('ai-generated', 'none'), { ...publicPage, editorialResponsibility: true });
    expect(d).toEqual({ required: false, reason: 'none', strength: 'none' });
  });

  it('but a declared editor does not make a deep fake unlabelled', () => {
    const d = disclosureFor(rec('ai-generated', 'none'),
      { ...publicPage, editorialResponsibility: true, mediaKind: 'image' });
    expect(d.required).toBe(true);
    expect(d.reason).toBe('art50_4_deepfake');
  });

  it('and it does not silence the 50(1) interaction notice', () => {
    const d = disclosureFor(rec('ai-generated', 'none'),
      { ...publicPage, editorialResponsibility: true, interactive: true });
    expect(d.reason).toBe('art50_1_interaction');
  });

  it('absent or false changes nothing — silence is not a declaration', () => {
    expect(disclosureFor(rec('ai-generated', 'none'), publicPage).required).toBe(true);
    expect(disclosureFor(rec('ai-generated', 'none'), { ...publicPage, editorialResponsibility: false }).required).toBe(true);
  });
});

describe('private content: nobody is being informed of anything', () => {
  for (const visibility of ['private', 'owner', 'group', 'workspace', 'members'] as const) {
    it(`${visibility} owes no visible label even for fully generated text`, () => {
      const d = disclosureFor(rec('ai-generated', 'none'), { ...publicPage, visibility });
      expect(d).toEqual({ required: false, reason: 'none', strength: 'none' });
    });
  }
});

describe('machine-to-machine: the record is the disclosure', () => {
  it('no visible disclosure is owed when no natural person is the audience', () => {
    const d = disclosureFor(rec('ai-generated', 'none'), { visibility: 'public', humanAudience: false });
    expect(d).toEqual({ required: false, reason: 'none', strength: 'none' });
  });

  it('not even for an interactive exchange, which by definition has no person in it', () => {
    const d = disclosureFor(rec('ai-generated', 'none'),
      { visibility: 'public', humanAudience: false, interactive: true });
    expect(d.required).toBe(false);
  });
});

describe('Article 50(1): a person in a two-way exchange with a model', () => {
  it('is told, whatever the content level says', () => {
    const d = disclosureFor(rec('original', 'full-human'), { ...publicPage, interactive: true });
    expect(d).toEqual({ required: true, reason: 'art50_1_interaction', strength: 'full' });
  });

  it('is told even with no provenance record at all', () => {
    const d = disclosureFor(undefined, { ...publicPage, interactive: true });
    expect(d.required).toBe(true);
    expect(d.reason).toBe('art50_1_interaction');
  });

  it('is told on a private surface too — the duty is about the exchange, not the audience size', () => {
    const d = disclosureFor(rec('ai-generated', 'none'),
      { visibility: 'private', humanAudience: true, interactive: true });
    expect(d.required).toBe(true);
    expect(d.reason).toBe('art50_1_interaction');
  });
});

describe('Article 50(4) first subparagraph: deepfakes', () => {
  for (const mediaKind of ['image', 'audio', 'video'] as const) {
    it(`${mediaKind} is labelled regardless of subject matter`, () => {
      const d = disclosureFor(rec('ai-generated', 'none'),
        { ...publicPage, mediaKind, publicInterest: 'no' });
      expect(d).toEqual({ required: true, reason: 'art50_4_deepfake', strength: 'full' });
    });
  }

  it('text with the publisher declaring no public interest owes no 50(4) text label', () => {
    const d = disclosureFor(rec('ai-generated', 'none'),
      { ...publicPage, mediaKind: 'text', publicInterest: 'no' });
    expect(d.required).toBe(false);
  });

  it('a reviewed deepfake still carries the duty — 50(4) 1st subpara has no review exemption', () => {
    const d = disclosureFor(rec('ai-generated', 'editorial-control'),
      { ...publicPage, mediaKind: 'image' });
    expect(d.reason).toBe('art50_4_deepfake');
    expect(d.required).toBe(true);
  });
});

describe('over-labelling by default (D4)', () => {
  it('unknown public-interest on anonymously readable text is treated as public-interest', () => {
    expect(disclosureFor(rec('ai-generated', 'none'), { ...publicPage, publicInterest: 'unknown' }).required).toBe(true);
    expect(disclosureFor(rec('ai-generated', 'none'), publicPage).required).toBe(true);
  });

  it('the publisher can declare otherwise, and that declaration is theirs to carry', () => {
    expect(disclosureFor(rec('ai-generated', 'none'), { ...publicPage, publicInterest: 'no' }).required).toBe(false);
  });
});

describe('creative work: present, but not intrusive', () => {
  it('artistic / satirical / fictional surfaces get a light disclosure, not silence', () => {
    const d = disclosureFor(rec('ai-generated', 'none'), { ...publicPage, creativeWork: true });
    expect(d).toEqual({ required: true, reason: 'art50_4_public_interest', strength: 'light' });
  });

  it('a creative deepfake is still disclosed, lightly', () => {
    const d = disclosureFor(rec('ai-generated', 'none'),
      { ...publicPage, creativeWork: true, mediaKind: 'video' });
    expect(d).toEqual({ required: true, reason: 'art50_4_deepfake', strength: 'light' });
  });
});

describe('unstated provenance creates no obligation, and no denial either', () => {
  const unstated: unknown[] = [
    undefined, null, {},
    { spec: 'aimeat.provenance/v99', level: 'ai-generated', humanInvolvement: 'none', generatedAt: '2026-08-01T18:42:00Z' },
    'ai-generated',
  ];
  for (const [i, input] of unstated.entries()) {
    it(`input #${i} on a public page → no label required`, () => {
      const d = disclosureFor(input, publicPage);
      expect(d).toEqual({ required: false, reason: 'none', strength: 'none' });
    });
  }
});
