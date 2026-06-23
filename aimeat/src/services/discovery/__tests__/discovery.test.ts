/**
 * @file discovery.test.ts
 * @description Unit tests for the Phase 0 discovery building blocks: normalizer (visibility/tags/
 *   owner/text), classifier (key patterns + kind: tags), registry, and facet/filter helpers.
 *   Pure-function coverage — no server, no storage. Run with `pnpm test` (vitest).
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 0 initial coverage (design doc 2026-06-23-master-directory-discovery).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeVisibility,
  parkedToVisibility,
  listedToVisibility,
  normalizeTags,
  toFullOwner,
  bestTitle,
  bestDescription,
} from '../normalize.js';
import { classifyMemoryKey, kindTagType } from '../classify.js';
import { createRegistry } from '../registry.js';
import { applyFilters, computeFacets } from '../facets.js';
import type { DiscoveryEntry, DiscoverySource } from '../types.js';

const NODE = 'aimeat-fi-001-genesis';

describe('normalizeVisibility', () => {
  it('maps each native enum to the canonical ladder', () => {
    expect(normalizeVisibility('public')).toBe('public');
    expect(normalizeVisibility('listed')).toBe('unlisted'); // organism
    expect(normalizeVisibility('unlisted')).toBe('unlisted'); // offer
    expect(normalizeVisibility('group')).toBe('shared'); // memory
    expect(normalizeVisibility('shared')).toBe('shared'); // board
    expect(normalizeVisibility('owner')).toBe('owner');
    expect(normalizeVisibility('private')).toBe('private');
  });

  it('defaults unknown / empty to the most restrictive (private)', () => {
    expect(normalizeVisibility('system')).toBe('private');
    expect(normalizeVisibility(undefined)).toBe('private');
    expect(normalizeVisibility('')).toBe('private');
  });

  it('derives visibility from parked / listed flags', () => {
    expect(parkedToVisibility(true)).toBe('owner');
    expect(parkedToVisibility(false)).toBe('public');
    expect(listedToVisibility(false)).toBe('owner');
    expect(listedToVisibility(true)).toBe('public');
    expect(listedToVisibility(undefined)).toBe('public'); // default listed
  });
});

describe('normalizeTags', () => {
  it('merges tags + interests, trims, drops empties, dedupes case-insensitively', () => {
    expect(normalizeTags({ tags: ['Finance', ' legal '], interests: ['finance', 'AI', ''] })).toEqual([
      'Finance',
      'legal',
      'AI',
    ]);
  });

  it('tolerates missing / non-array fields', () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags({})).toEqual([]);
    expect(normalizeTags({ tags: 'nope' as unknown as string[] })).toEqual([]);
  });
});

describe('toFullOwner', () => {
  it('expands a bare name to a GHII', () => {
    expect(toFullOwner('alice', NODE)).toBe(`alice@${NODE}`);
  });
  it('passes a GHII through', () => {
    expect(toFullOwner('alice@some-node', NODE)).toBe('alice@some-node');
  });
  it('drops the agent part of a GAII', () => {
    expect(toFullOwner('claude#alice@some-node', NODE)).toBe('alice@some-node');
  });
});

describe('bestTitle / bestDescription', () => {
  it('picks the first present title-ish / description-ish field', () => {
    expect(bestTitle({ name: 'Q3 plan' }, 'fallback')).toBe('Q3 plan');
    expect(bestTitle({ nothing: 1 }, 'fallback')).toBe('fallback');
    expect(bestDescription({ ask: 'do the thing' })).toBe('do the thing');
    expect(bestDescription('a string')).toBe('');
  });
});

describe('classifyMemoryKey', () => {
  it('classifies knowledge packages with content_type as segment', () => {
    expect(classifyMemoryKey('packages/abc-123/manifest', { contentType: 'research' })).toEqual({
      type: 'knowledge',
      segment: 'research',
    });
  });
  it('classifies workspace decision records', () => {
    expect(classifyMemoryKey('organism.org7.w.budget.decision.d1')).toEqual({
      type: 'decision',
      segment: 'budget',
    });
  });
  it('classifies other workspace docs by their space (objectType)', () => {
    expect(classifyMemoryKey('organism.org7.w.specs.feature.f9')).toEqual({
      type: 'document',
      segment: 'feature',
    });
  });
  it('classifies workflows, companies and offerings by key', () => {
    expect(classifyMemoryKey('workflows.def.wf1').type).toBe('workflow');
    expect(classifyMemoryKey('org.acme.meta').type).toBe('company');
    expect(classifyMemoryKey('org.acme.offerings').type).toBe('offering');
    expect(classifyMemoryKey('agents.bot.offers').type).toBe('offering');
  });
  it('falls back to the kind: tag, then to memory', () => {
    expect(classifyMemoryKey('notes.misc', { tags: ['kind:research'] }).type).toBe('research');
    expect(classifyMemoryKey('notes.misc', { tags: ['kind:deliverable'] }).type).toBe('material');
    expect(classifyMemoryKey('notes.misc', { tags: ['unrelated'] }).type).toBe('memory');
    expect(classifyMemoryKey('notes.misc').type).toBe('memory');
  });
});

describe('kindTagType', () => {
  it('recognizes research/material synonyms only', () => {
    expect(kindTagType(['kind:research'])).toBe('research');
    expect(kindTagType(['kind:material'])).toBe('material');
    expect(kindTagType(['kind:output'])).toBe('material');
    expect(kindTagType(['kind:unknown'])).toBeNull();
    expect(kindTagType(undefined)).toBeNull();
  });
});

describe('DiscoveryRegistry', () => {
  const stub = (id: string): DiscoverySource => ({
    id,
    gating: 'none',
    enumerate: async () => [],
    toEntry: r => r as unknown as DiscoveryEntry,
  });

  it('registers, retrieves, and lists in order', () => {
    const reg = createRegistry();
    reg.register(stub('a'));
    reg.register(stub('b'));
    expect(reg.size).toBe(2);
    expect(reg.has('a')).toBe(true);
    expect(reg.all().map(s => s.id)).toEqual(['a', 'b']);
  });

  it('throws on duplicate id and supports unregister', () => {
    const reg = createRegistry();
    reg.register(stub('a'));
    expect(() => reg.register(stub('a'))).toThrow(/already registered/);
    expect(reg.unregister('a')).toBe(true);
    expect(reg.unregister('a')).toBe(false);
  });
});

describe('applyFilters + computeFacets', () => {
  const entry = (over: Partial<DiscoveryEntry>): DiscoveryEntry => ({
    type: 'memory',
    segment: null,
    id: 'x',
    title: 't',
    description: '',
    tags: [],
    visibility: 'public',
    owner: `alice@${NODE}`,
    node: NODE,
    score: 0,
    updatedAt: '2026-06-23T00:00:00Z',
    href: '/v1/memory/x',
    ...over,
  });

  const entries: DiscoveryEntry[] = [
    entry({ type: 'knowledge', segment: 'research', tags: ['finance', 'ai'] }),
    entry({ type: 'knowledge', segment: 'research', tags: ['finance'] }),
    entry({ type: 'capability', segment: 'action', tags: ['ai'], owner: `bob@${NODE}` }),
    entry({ type: 'memory', segment: null, tags: [] }),
  ];

  it('filters by type', () => {
    expect(applyFilters(entries, { types: ['knowledge'] })).toHaveLength(2);
  });
  it('filters by segment', () => {
    expect(applyFilters(entries, { segments: ['research'] })).toHaveLength(2);
  });
  it('filters by owner', () => {
    expect(applyFilters(entries, { owner: `bob@${NODE}` })).toHaveLength(1);
  });
  it('ALL-matches tags case-insensitively', () => {
    expect(applyFilters(entries, { tags: ['Finance', 'AI'] })).toHaveLength(1);
    expect(applyFilters(entries, { tags: ['finance'] })).toHaveLength(2);
  });

  it('rolls up facets sorted by count', () => {
    const f = computeFacets(entries);
    expect(f.types[0]).toEqual({ value: 'knowledge', count: 2 });
    expect(f.segments[0]).toEqual({ type: 'knowledge', segment: 'research', count: 2 });
    expect(f.tags.find(t => t.value === 'finance')?.count).toBe(2);
    expect(f.tags.find(t => t.value === 'ai')?.count).toBe(2);
  });
});
