/**
 * @file test/unit/ai-provenance-adapters.test.ts
 * @description The C2 truth table from docs/internal/EUAct/22-frozen-vocabulary.md, executed. Every
 *   row of that table — including the absent/unknown-spec row that must read as `unstated` and never
 *   as "a human wrote it" — is one case here, across all five adapters. This file is the reason the
 *   mapping is a tested artefact instead of a set of conditionals scattered through the render path:
 *   when the IETF draft expires or the W3C vocabulary settles, ONE function and ONE row change here.
 * @structure
 *   - ROWS: the truth table, transcribed field-for-field from doc 22 C2
 *   - one describe() per adapter, driven by ROWS
 *   - separate describes for the emitted IETF header form and the C2PA projection
 * @usage pnpm exec vitest run test/unit/ai-provenance-adapters.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import { describe, it, expect } from 'vitest';
import {
  toIptc, toW3cHtml, toIetfHeader, toEuIcon, toC2paAssertion,
  type W3cAiDisclosure,
} from '../../src/services/ai-provenance-adapters.js';
import {
  AI_PROVENANCE_SPEC_V1,
  type AiProvenance, type AiProvenanceLevel, type AiHumanInvolvement,
} from '../../src/models/ai-provenance-schemas.js';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';
const GENERATED_AT = '2026-08-01T18:42:00Z';

function rec(level: AiProvenanceLevel, humanInvolvement: AiHumanInvolvement): AiProvenance {
  return { spec: AI_PROVENANCE_SPEC_V1, level, humanInvolvement, generatedAt: GENERATED_AT };
}

interface Row {
  level: AiProvenanceLevel;
  human: AiHumanInvolvement;
  iptc: string | undefined;
  w3c: W3cAiDisclosure | undefined;
  ietfMode: string | undefined;
  icon: string | undefined;
}

const ANY_INVOLVEMENT: AiHumanInvolvement[] = ['none', 'light-review', 'editorial-control', 'full-human'];
const UNREVIEWED: AiHumanInvolvement[] = ['none', 'light-review'];
const REVIEWED: AiHumanInvolvement[] = ['editorial-control', 'full-human'];

/** Doc 22 Part C2, transcribed. Rows that say "any" are expanded so every combination is covered. */
const ROWS: Row[] = [
  ...ANY_INVOLVEMENT.map((human): Row => ({
    level: 'original', human,
    iptc: undefined, w3c: 'none', ietfMode: 'none', icon: undefined,
  })),
  ...ANY_INVOLVEMENT.map((human): Row => ({
    level: 'assisted', human,
    iptc: `${IPTC}compositeWithTrainedAlgorithmicMedia`, w3c: 'ai-assisted',
    ietfMode: 'ai-modified', icon: 'ai-modified',
  })),
  ...UNREVIEWED.map((human): Row => ({
    level: 'synthesized', human,
    iptc: `${IPTC}trainedAlgorithmicMedia`, w3c: 'autonomous',
    ietfMode: 'machine-generated', icon: 'ai-generated',
  })),
  ...REVIEWED.map((human): Row => ({
    level: 'synthesized', human,
    iptc: `${IPTC}trainedAlgorithmicMedia`, w3c: 'ai-generated',
    ietfMode: 'ai-originated', icon: 'ai-basic',
  })),
  ...UNREVIEWED.map((human): Row => ({
    level: 'ai-generated', human,
    iptc: `${IPTC}trainedAlgorithmicMedia`, w3c: 'autonomous',
    ietfMode: 'machine-generated', icon: 'ai-generated',
  })),
  ...REVIEWED.map((human): Row => ({
    level: 'ai-generated', human,
    iptc: `${IPTC}trainedAlgorithmicMedia`, w3c: 'ai-generated',
    ietfMode: 'ai-originated', icon: 'ai-basic',
  })),
];

const label = (r: Row) => `${r.level} × ${r.human}`;

/** The last row of C2: absent, unknown spec, or malformed. All of these read as `unstated`. */
const UNSTATED_INPUTS: Array<[string, unknown]> = [
  ['undefined', undefined],
  ['null', null],
  ['an unknown spec', { spec: 'aimeat.provenance/v99', level: 'original', humanInvolvement: 'full-human', generatedAt: GENERATED_AT }],
  ['a record with no spec', { level: 'original', humanInvolvement: 'full-human', generatedAt: GENERATED_AT }],
  ['a malformed record', { spec: AI_PROVENANCE_SPEC_V1, level: 'not-a-level', humanInvolvement: 'none', generatedAt: GENERATED_AT }],
  ['a string', 'ai-generated'],
  ['an array', []],
];

describe('toIptc — IPTC digitalSourceType URI', () => {
  for (const r of ROWS) {
    it(`${label(r)} → ${r.iptc ?? '(omit)'}`, () => {
      expect(toIptc(rec(r.level, r.human))).toBe(r.iptc);
    });
  }
  for (const [name, input] of UNSTATED_INPUTS) {
    it(`${name} → omit (unstated is not "human wrote it")`, () => {
      expect(toIptc(input)).toBeUndefined();
    });
  }
});

describe('toW3cHtml — W3C ai-disclosure attribute value', () => {
  for (const r of ROWS) {
    it(`${label(r)} → ${r.w3c ?? '(omit)'}`, () => {
      expect(toW3cHtml(rec(r.level, r.human))).toBe(r.w3c);
    });
  }
  for (const [name, input] of UNSTATED_INPUTS) {
    it(`${name} → omit the attribute`, () => {
      expect(toW3cHtml(input)).toBeUndefined();
    });
  }
});

describe('toIetfHeader — RFC 9651 structured field value', () => {
  for (const r of ROWS) {
    it(`${label(r)} → mode=${r.ietfMode ?? '(omit)'}`, () => {
      const h = toIetfHeader(rec(r.level, r.human));
      if (r.ietfMode === undefined) {
        expect(h).toBeUndefined();
      } else {
        expect(h).toBeDefined();
        expect(h!.startsWith(`mode=${r.ietfMode}`)).toBe(true);
      }
    });
  }
  for (const [name, input] of UNSTATED_INPUTS) {
    it(`${name} → omit the header`, () => {
      expect(toIetfHeader(input)).toBeUndefined();
    });
  }
});

describe('toEuIcon — official EU icon reference', () => {
  for (const r of ROWS) {
    it(`${label(r)} → ${r.icon ?? '(none)'}`, () => {
      const icon = toEuIcon(rec(r.level, r.human));
      if (r.icon === undefined) {
        expect(icon).toBeUndefined();
      } else {
        expect(icon?.file).toBe(r.icon);
        expect(typeof icon?.alt).toBe('string');
        expect(icon!.alt.length).toBeGreaterThan(0);
      }
    });
  }
  for (const [name, input] of UNSTATED_INPUTS) {
    it(`${name} → ai-basic + "origin unstated"`, () => {
      const icon = toEuIcon(input);
      expect(icon?.file).toBe('ai-basic');
      // The unstated case is the one row where the icon alone is ambiguous, so it must carry
      // its own alt key rather than reusing the "AI-generated" one.
      expect(icon?.alt).toBe('aiLabel.iconAlt.unstated');
    });
  }
});

describe('toIetfHeader — the emitted form', () => {
  it('carries model, provider and an RFC 9651 date parameter when they are known', () => {
    const h = toIetfHeader({
      spec: AI_PROVENANCE_SPEC_V1, level: 'ai-generated', humanInvolvement: 'none',
      generatedAt: GENERATED_AT,
      generator: { model: 'anthropic/claude-opus-5', provider: 'openrouter' },
    });
    expect(h).toBe(
      'mode=machine-generated; model="anthropic/claude-opus-5"; provider="openrouter"; '
      + `date=@${Math.floor(Date.parse(GENERATED_AT) / 1000)}`,
    );
  });

  it('omits parameters it does not know rather than emitting empty ones', () => {
    expect(toIetfHeader(rec('ai-generated', 'none')))
      .toBe(`mode=machine-generated; date=@${Math.floor(Date.parse(GENERATED_AT) / 1000)}`);
  });

  it('escapes quotes and backslashes so a hostile model id cannot break the field', () => {
    const h = toIetfHeader({
      spec: AI_PROVENANCE_SPEC_V1, level: 'ai-generated', humanInvolvement: 'none',
      generatedAt: GENERATED_AT,
      generator: { model: 'evil"; injected=1; x="\\bad' },
    });
    expect(h).toContain('model="evil\\"; injected=1; x=\\"\\\\bad"');
  });

  it('drops a parameter whose value is not ASCII (RFC 9651 strings are ASCII-only)', () => {
    const h = toIetfHeader({
      spec: AI_PROVENANCE_SPEC_V1, level: 'ai-generated', humanInvolvement: 'none',
      generatedAt: GENERATED_AT,
      generator: { model: 'malli-ä', provider: 'openrouter' },
    });
    expect(h).not.toContain('malli');
    expect(h).toContain('provider="openrouter"');
  });
});

describe('toC2paAssertion — C2PA action assertion', () => {
  it('projects the SAME digitalSourceType the IPTC adapter produces', () => {
    for (const r of ROWS) {
      const a = toC2paAssertion(rec(r.level, r.human));
      expect(a?.digitalSourceType).toBe(r.iptc);
    }
  });

  it('is absent exactly when there is no IPTC value to assert', () => {
    for (const r of ROWS) {
      const a = toC2paAssertion(rec(r.level, r.human));
      expect(a === undefined).toBe(r.iptc === undefined);
    }
    for (const [, input] of UNSTATED_INPUTS) {
      expect(toC2paAssertion(input)).toBeUndefined();
    }
  });

  it('calls an edit an edit and a generation a creation', () => {
    expect(toC2paAssertion(rec('assisted', 'none'))?.action).toBe('c2pa.edited');
    expect(toC2paAssertion(rec('ai-generated', 'none'))?.action).toBe('c2pa.created');
    expect(toC2paAssertion(rec('synthesized', 'editorial-control'))?.action).toBe('c2pa.created');
  });

  it('carries the model as softwareAgent and the generation time as `when`', () => {
    const a = toC2paAssertion({
      spec: AI_PROVENANCE_SPEC_V1, level: 'ai-generated', humanInvolvement: 'none',
      generatedAt: GENERATED_AT, generator: { model: 'anthropic/claude-opus-5' },
    });
    expect(a?.softwareAgent).toBe('anthropic/claude-opus-5');
    expect(a?.when).toBe(GENERATED_AT);
  });
});

describe('no external vocabulary leaks into the canonical record', () => {
  it('the record type has no digitalSourceType / mode / icon field', () => {
    const r = rec('ai-generated', 'none') as Record<string, unknown>;
    expect(r.digitalSourceType).toBeUndefined();
    expect(r.mode).toBeUndefined();
    expect(r.icon).toBeUndefined();
  });
});
