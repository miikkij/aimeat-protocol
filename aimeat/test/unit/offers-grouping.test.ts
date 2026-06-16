import { describe, it, expect } from 'vitest';
// Pure, dependency-free frontend module — importable straight into vitest.
import {
  classifyNeed, matchesFacets, availableFacetValues, standingScore, sortOffers,
  groupByAxis, buildMermaid, isAuto,
} from '../../public/js/services/offers-grouping.js';

const offer = (o: any) => o;
const item = (o: any, agent = 'a') => ({ entry: { agent }, agent, offer: o });

describe('classifyNeed', () => {
  const cases: Array<[string, string]> = [
    ['Build a new agent from a description', 'build'],
    ['Show which crews are running', 'inspect'],
    ["Rate an idea's feasibility", 'analyze'],
    ['Turn one question into an estimate spectrum', 'analyze'],
    ['Stress-test an idea from multiple angles', 'analyze'],
    ['Write a jingle or short creative copy', 'create'],
    ['Write a tagline or translate a short text', 'communicate'],
    ["Map the fleet's deliverables and reuse", 'inspect'],
    ['Fan a goal out to the fleet and synthesize', 'build'],
    ['Four comedians riff on your topic', 'create'],
  ];
  for (const [title, bucket] of cases) {
    it(`"${title}" → ${bucket}`, () => {
      expect(classifyNeed(offer({ title, ask: '' }))).toBe(bucket);
    });
  }

  it('word-boundary: "Generate an image" is create, not analyze (rate ⊂ geneRATE)', () => {
    expect(classifyNeed(offer({ title: 'Generate an image', ask: 'make a picture' }))).toBe('create');
  });

  it('falls back to format, then other', () => {
    expect(classifyNeed(offer({ title: 'Zzz', ask: 'qqq', deliverable: { format: 'image' } }))).toBe('create');
    expect(classifyNeed(offer({ title: 'Zzz', ask: 'qqq' }))).toBe('other');
  });
});

describe('facets', () => {
  const items = [
    item(offer({ cost: 'free', latency: 'seconds', deliverable: { format: 'json' } })),
    item(offer({ cost: 'cheap', latency: 'minutes', deliverable: { format: 'document' } })),
    item(offer({ cost: 'cheap', latency: 'minutes', deliverable: { format: 'image' } })),
  ];

  it('availableFacetValues lists only present values', () => {
    const av = availableFacetValues(items);
    expect(av.cost).toEqual(['free', 'cheap']);
    expect(av.format).toEqual(['json', 'document', 'image']);
    expect(av.verification).toBeUndefined();
  });

  it('matchesFacets: AND across facets, OR within', () => {
    const active = { cost: new Set(['cheap']), format: new Set(['document', 'image']) };
    expect(matchesFacets(items[0].offer, active)).toBe(false); // free
    expect(matchesFacets(items[1].offer, active)).toBe(true);  // cheap + document
    expect(matchesFacets(items[2].offer, active)).toBe(true);  // cheap + image
  });

  it('empty active set = no constraint', () => {
    expect(matchesFacets(items[0].offer, { cost: new Set() })).toBe(true);
    expect(matchesFacets(items[0].offer, {})).toBe(true);
  });
});

describe('standing (value, not activity)', () => {
  it('auto/scheduled outranks a richly-verified manual offer', () => {
    const auto = offer({ auto: true, verification: 'ungated' });
    const manual = offer({ verification: 'deterministic', price: { morsels: 5 }, deliverable: { location: { key: 'k' } } });
    expect(standingScore(auto)).toBeGreaterThan(standingScore(manual));
    expect(isAuto(auto)).toBe(true);
  });

  it('sortOffers standing puts auto first, then verification', () => {
    const items = [
      item(offer({ title: 'plain' })),
      item(offer({ title: 'verified', verification: 'deterministic' })),
      item(offer({ title: 'auto', auto: true })),
    ];
    const sorted = sortOffers(items, 'standing').map(i => i.offer.title);
    expect(sorted[0]).toBe('auto');
    expect(sorted[1]).toBe('verified');
  });

  it('sortOffers cost/speed/name order', () => {
    const items = [
      item(offer({ title: 'b', cost: 'expensive', latency: 'long-running' })),
      item(offer({ title: 'a', cost: 'free', latency: 'seconds' })),
    ];
    expect(sortOffers(items, 'cost')[0].offer.title).toBe('a');
    expect(sortOffers(items, 'speed')[0].offer.title).toBe('a');
    expect(sortOffers(items, 'name')[0].offer.title).toBe('a');
  });
});

describe('groupByAxis', () => {
  const items = [
    item(offer({ title: 'Write a jingle' }), 'jingle-writer'),
    item(offer({ title: 'Rate feasibility' }), 'rater'),
    item(offer({ title: 'Show running crews' }), 'crew-forge'),
  ];

  it('need axis uses display order', () => {
    const groups = groupByAxis(items, 'need');
    expect(groups.map(g => g.key)).toEqual(['create', 'analyze', 'inspect']);
  });

  it('agent axis groups by agent (alpha, ∅ last)', () => {
    const withBlank = [...items, item(offer({ title: 'x' }), '')];
    const groups = groupByAxis(withBlank, 'agent');
    expect(groups[groups.length - 1].key).toBe('∅');
  });

  it('auto axis: auto group first', () => {
    const groups = groupByAxis([item(offer({ title: 'm' })), item(offer({ title: 'a', auto: true }))], 'auto');
    expect(groups[0].key).toBe('auto');
  });
});

describe('buildMermaid', () => {
  it('emits a flowchart with root → group → leaves and sanitizes labels', () => {
    const groups = [
      { label: 'Create', items: [item(offer({ title: 'Write a "jingle"' }))] },
      { label: 'Analyze', items: [item(offer({ title: 'Rate it' }))] },
    ];
    const src = buildMermaid('What can I do?', groups);
    expect(src.startsWith('flowchart LR')).toBe(true);
    expect(src).toContain('root["What can I do?"]');
    expect(src).toContain('Create (1)');
    expect(src).not.toContain('"jingle"');     // inner quotes stripped
    expect(src).toContain('Write a  jingle');  // sanitized label
  });

  it('caps leaves per group with a +N node', () => {
    const many = Array.from({ length: 15 }, (_, i) => item(offer({ title: 'o' + i })));
    const src = buildMermaid('root', [{ label: 'G', items: many }], { maxPerGroup: 5 });
    expect(src).toContain('+10…');
  });
});
