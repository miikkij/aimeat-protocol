/**
 * @file test/unit/ai-disclosure-medium.test.ts
 * @description The label's words follow the record's medium, and the disclosure a reader is served
 *   is decided for the item as it is served.
 *
 *   Reported by originalmiskate.com on 2026-10-08: a public speech clip's record read "This text was
 *   written by AI", because no record could say it was audio, and a record minted while its item
 *   was private kept "no label owed" after the item went public. buildDisclosure() picks the words
 *   by medium (services/ai-disclosure-served.ts disclosureWording) and servedDisclosure()
 *   (services/ai-provenance-marks.ts) decides again for the surface the item is served on.
 * @structure buildDisclosure per medium · servedDisclosure against the served visibility
 * @usage pnpm exec vitest run test/unit/ai-disclosure-medium.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildDisclosure } from '../../src/services/ai-provenance.js';
import { servedDisclosure } from '../../src/services/ai-provenance-marks.js';
import { createT } from '../../src/i18n.js';
import {
  AI_PROVENANCE_SPEC_V1, AiProvenanceSchema,
  type AiProvenance, type AiMediaKind, type AiProvenanceLevel, type AiHumanInvolvement,
} from '../../src/models/ai-provenance-schemas.js';
import type { SurfaceContext } from '../../src/services/ai-disclosure.js';

const en = createT('en');
const publicPage: SurfaceContext = { visibility: 'public', humanAudience: true };
const privatePage: SurfaceContext = { visibility: 'private', humanAudience: true };

function rec(
  level: AiProvenanceLevel, humanInvolvement: AiHumanInvolvement, extra: Partial<AiProvenance> = {},
): AiProvenance {
  return { spec: AI_PROVENANCE_SPEC_V1, level, humanInvolvement, generatedAt: '2026-10-08T10:00:00Z', ...extra };
}

/** The English long sentence a record minted on `ctx` carries. */
const longOf = (r: AiProvenance, ctx: SurfaceContext = publicPage, policy: 'strict' | 'light' = 'light') =>
  buildDisclosure(r, ctx, policy).long?.en;

describe('buildDisclosure words a model-made item by its medium', () => {
  const cases: Array<[AiMediaKind | undefined, string]> = [
    ['text', 'aiLabel.publicText'],
    ['image', 'aiLabel.syntheticImageLong'],
    ['audio', 'aiLabel.syntheticAudioLong'],
    ['video', 'aiLabel.syntheticVideoLong'],
    ['code', 'aiLabel.generatedAppLong'],
    ['data', 'aiLabel.generatedDataLong'],
    [undefined, 'aiLabel.generatedContentLong'],
  ];
  for (const [mediaKind, key] of cases) {
    it(`${mediaKind ?? 'unstated'} → ${key}`, () => {
      const r = rec('ai-generated', 'none', mediaKind ? { mediaKind } : {});
      expect(longOf(r)).toBe(en(key));
      expect(buildDisclosure(r, publicPage).short.en).toBe(en('aiLabel.short'));
    });
  }

  it('the reported case: a public speech clip no longer says "This text"', () => {
    const d = buildDisclosure(rec('ai-generated', 'none', { mediaKind: 'audio' }), publicPage, 'strict');
    expect(d.required).toBe(true);
    expect(d.long?.en).not.toMatch(/text/i);
    expect(d.long?.fi).toBe(createT('fi')('aiLabel.syntheticAudioLong'));
    expect(d.long?.es).toBe(createT('es')('aiLabel.syntheticAudioLong'));
  });

  it('a transcript says a model turned speech into it', () => {
    expect(longOf(rec('ai-generated', 'none', { mediaKind: 'text', method: 'transcribed' })))
      .toBe(en('aiLabel.transcriptLong'));
  });

  it('a reviewed image keeps the synthetic-media sentence: review does not lift the deep-fake duty', () => {
    const r = rec('ai-generated', 'editorial-control', { mediaKind: 'image' });
    const d = buildDisclosure(r, publicPage);
    expect(d.required).toBe(true);
    expect(d.long?.en).toBe(en('aiLabel.syntheticImageLong'));
  });

  it('reviewed text keeps its words; reviewed data gets the medium-neutral reviewed sentence', () => {
    expect(longOf(rec('ai-generated', 'editorial-control', { mediaKind: 'text' }), privatePage))
      .toBe(en('aiLabel.reviewedGeneric'));
    expect(longOf(rec('ai-generated', 'editorial-control', { mediaKind: 'data' }), privatePage))
      .toBe(en('aiLabel.reviewedMediaLong'));
  });

  it('assisted and original non-text items get their own words', () => {
    expect(longOf(rec('assisted', 'none', { mediaKind: 'audio' }), privatePage)).toBe(en('aiLabel.assistedMediaLong'));
    const original = buildDisclosure(rec('original', 'full-human', { mediaKind: 'image' }), privatePage);
    expect(original.short.en).toBe(en('aiLabel.originalMedia'));
    expect(original.long?.en).toBe(en('aiLabel.originalMediaLong'));
    expect(longOf(rec('original', 'full-human', { mediaKind: 'text' }), privatePage)).toBe(en('aiLabel.originalLong'));
  });

  it('a strict-policy label on reviewed code names the review without saying "drafted"', () => {
    const d = buildDisclosure(rec('ai-generated', 'editorial-control', { mediaKind: 'code' }), publicPage, 'strict');
    expect(d.reason).toBe('policy');
    expect(d.short.en).toBe(en('aiLabel.reviewedMadeShort'));
    const named = buildDisclosure(rec('ai-generated', 'none', { mediaKind: 'code' }),
      { ...publicPage, editorialResponsibility: true }, 'strict', { reviewer: 'Ada' });
    expect(named.short.en).toBe(en('aiLabel.reviewedMade', { name: 'Ada' }));
  });

  it('the medium travels in the record and validates', () => {
    const r = rec('ai-generated', 'none', { mediaKind: 'audio', mediaType: 'audio/mpeg', resemblesReal: 'no' });
    expect(AiProvenanceSchema.safeParse(r).success).toBe(true);
    expect(AiProvenanceSchema.safeParse({ ...r, mediaKind: 'hologram' }).success).toBe(false);
    expect(AiProvenanceSchema.safeParse({ ...r, mediaType: 'not a type' }).success).toBe(false);
  });
});

describe('servedDisclosure decides for the item as it is served', () => {
  /** A record as the node mints it: the block decided against the surface the item had then. */
  const minted = (r: AiProvenance, ctx: SurfaceContext, policy: 'strict' | 'light' = 'strict'): AiProvenance =>
    ({ ...r, disclosure: buildDisclosure(r, ctx, policy) });

  it('a memory record minted private and made public owes the label when served', () => {
    const r = minted(rec('ai-generated', 'none', { mediaKind: 'text' }), privatePage);
    expect(r.disclosure?.required).toBe(false);
    const d = servedDisclosure(r, { visibility: 'public' }, 'strict');
    expect(d.required).toBe(true);
    expect(d.reason).toBe('art50_4_precautionary');
    expect(d.long?.en).toBe(en('aiLabel.publicText'));
  });

  it('a speech clip minted private and published owes the audio label', () => {
    const r = minted(rec('ai-generated', 'none', { mediaKind: 'audio', mediaType: 'audio/mpeg' }), privatePage);
    const d = servedDisclosure(r, { visibility: 'public' }, 'strict');
    expect(d.required).toBe(true);
    expect(d.long?.en).toBe(en('aiLabel.syntheticAudioLong'));
  });

  it('an item made private again owes nothing', () => {
    const r = minted(rec('ai-generated', 'none', { mediaKind: 'text' }), publicPage);
    expect(r.disclosure?.required).toBe(true);
    expect(servedDisclosure(r, { visibility: 'private' }, 'strict').required).toBe(false);
  });

  it('an unchanged decision keeps the words the record was minted with', () => {
    // An old record: no medium, minted public with the text wording. Served public, the decision is
    // the same, so the old words stay rather than turning into the medium-neutral sentence.
    const r = minted(rec('ai-generated', 'none'), publicPage);
    const old = { ...r, disclosure: { ...r.disclosure!, long: { en: 'This text was written by AI without human editorial review.' } } };
    expect(servedDisclosure(old, { visibility: 'public' }, 'strict')).toBe(old.disclosure);
  });

  it('a publisher who declared no public interest keeps the exemption when served', () => {
    const r = minted(rec('ai-generated', 'none', { mediaKind: 'text' }), { ...publicPage, publicInterest: 'no' });
    expect(r.disclosure?.reason).toBe('policy');
    const d = servedDisclosure(r, { visibility: 'public' }, 'light');
    expect(d.required).toBe(false);
  });

  it('a record with no medium takes the medium the serving item states', () => {
    const r = minted(rec('ai-generated', 'none'), privatePage);
    const d = servedDisclosure(r, { visibility: 'public', mediaKind: 'image' }, 'strict');
    expect(d.long?.en).toBe(en('aiLabel.syntheticImageLong'));
  });
});
