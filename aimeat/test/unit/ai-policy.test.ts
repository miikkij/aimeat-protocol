/**
 * @file test/unit/ai-policy.test.ts
 * @description The model policy's decision, apart from any storage: a layer only tightens, the
 *   intersection is what is allowed, a capability the operator recommended nothing for is not
 *   restricted by the recommended layer, the owner's four switches decide whose calls a policy
 *   covers, a self-declared app never gets the owner's per-app list, and a reference is
 *   `<type>:<model id>` without mistaking a model id's own colon for a type.
 * @usage pnpm test -- ai-policy
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V2 of the System 2 plan).
 */
import { describe, it, expect } from 'vitest';
import {
  parseModelRef, isModelRef, normaliseOwnerPolicy, readOwnerPolicy, parseRecommendedModels,
  effectivePolicy, isAllowed, blockingLayer, firstAllowed, OPEN_POLICY, type OwnerAiPolicy,
} from '../../src/services/ai/policy.js';

const OPUS = 'openrouter:anthropic/claude-opus-5.5';
const FABLE = 'openrouter:anthropic/claude-fable-5.1';
const DEEPSEEK = 'openrouter:deepseek/deepseek-v4-pro-0813';
const FLUX = 'openrouter:black-forest-labs/flux.2-pro';
const RECOMMENDED = { text: [OPUS, FABLE, DEEPSEEK], vision: [OPUS, FABLE], image: [FLUX] };

const policy = (over: Partial<OwnerAiPolicy>): OwnerAiPolicy => ({ ...OPEN_POLICY, ...over });

describe('a model reference', () => {
  it('reads a known type before the first colon', () => {
    expect(parseModelRef('anthropic:claude-opus-5-5')).toEqual({ type: 'anthropic', id: 'claude-opus-5-5' });
    expect(parseModelRef(OPUS)).toEqual({ type: 'openrouter', id: 'anthropic/claude-opus-5.5' });
  });

  it('leaves a model id\'s own colon alone', () => {
    expect(parseModelRef('deepseek/deepseek-v4-pro:free')).toEqual({ id: 'deepseek/deepseek-v4-pro:free' });
    expect(parseModelRef('qwen3:8b')).toEqual({ id: 'qwen3:8b' });
    expect(parseModelRef('openrouter:deepseek/deepseek-v4-pro:free')).toEqual({ type: 'openrouter', id: 'deepseek/deepseek-v4-pro:free' });
  });

  it('is well formed only with a type and an id', () => {
    expect(isModelRef(OPUS)).toBe(true);
    expect(isModelRef('anthropic/claude-opus-5.5')).toBe(false);
    expect(isModelRef('anthropic:')).toBe(false);
    expect(isModelRef('nosuchtype:model')).toBe(false);
  });
});

describe('the owner\'s policy input', () => {
  it('names every problem at once', () => {
    const r = normaliseOwnerPolicy({ mode: 'custom', allow: ['claude-opus', OPUS, 7], appliesTo: { apps: 'yes' } });
    expect('problems' in r && r.problems.map(p => p.field)).toEqual(['allow[0]', 'allow[2]', 'appliesTo.apps']);
  });

  it('refuses a custom policy with an empty list', () => {
    const r = normaliseOwnerPolicy({ mode: 'custom', allow: [] });
    expect('problems' in r && r.problems[0].field).toBe('allow');
  });

  it('turns every switch on unless the owner turned one off', () => {
    const r = normaliseOwnerPolicy({ mode: 'recommended', appliesTo: { owner: false } });
    expect('policy' in r && r.policy.appliesTo).toEqual({ owner: false, chat: true, agents: true, apps: true });
  });

  it('reads an unreadable stored record as the open policy, never as an error', () => {
    expect(readOwnerPolicy({ mode: 'strict' }).mode).toBe('open');
    expect(readOwnerPolicy(undefined).mode).toBe('open');
  });
});

describe('the operator\'s recommendations', () => {
  it('keeps the good entries and reports the rest', () => {
    const r = parseRecommendedModels(JSON.stringify({ text: [OPUS, 'opus'], poetry: [OPUS] }));
    expect(r.models).toEqual({ text: [OPUS] });
    expect(r.problems).toHaveLength(2);
  });

  it('is empty on a fresh node, and not JSON is a problem rather than a crash', () => {
    expect(parseRecommendedModels(undefined)).toEqual({ models: {}, problems: [] });
    expect(parseRecommendedModels('{text:').problems).toHaveLength(1);
  });
});

describe('the decision', () => {
  it('open: anything', () => {
    expect(effectivePolicy(RECOMMENDED, OPEN_POLICY, { capability: 'text', caller: 'app' }).allowed).toBe('any');
  });

  it('recommended: only the node\'s list for the capability', () => {
    const d = effectivePolicy(RECOMMENDED, policy({ mode: 'recommended' }), { capability: 'text', caller: 'app' });
    expect(isAllowed(d, OPUS)).toBe(true);
    expect(isAllowed(d, 'OPENROUTER:Anthropic/Claude-Opus-5.5')).toBe(true);
    expect(isAllowed(d, 'openrouter:openai/gpt-4o-mini')).toBe(false);
    expect(blockingLayer(d, 'openrouter:openai/gpt-4o-mini')).toMatchObject({ layer: 'owner', source: 'recommended' });
  });

  it('recommended: a capability with no recommendation is not restricted by that layer', () => {
    const d = effectivePolicy(RECOMMENDED, policy({ mode: 'recommended' }), { capability: 'transcription', caller: 'owner' });
    expect(d.allowed).toBe('any');
  });

  it('a switch turned off leaves that caller outside the owner\'s policy', () => {
    const p = policy({ mode: 'recommended', appliesTo: { owner: false, chat: true, agents: true, apps: true } });
    expect(effectivePolicy(RECOMMENDED, p, { capability: 'text', caller: 'owner' }).allowed).toBe('any');
    expect(effectivePolicy(RECOMMENDED, p, { capability: 'text', caller: 'app' }).allowed).not.toBe('any');
  });

  it('every layer only tightens: the app\'s own list intersects the owner\'s', () => {
    const d = effectivePolicy(RECOMMENDED, policy({ mode: 'recommended' }), { capability: 'text', caller: 'app', appModels: [FABLE, 'anthropic:claude-fable-5-1'] });
    expect(d.allowed).toEqual([FABLE]);
    expect(blockingLayer(d, OPUS)).toMatchObject({ layer: 'app', source: 'app-meta' });
  });

  it('lists with nothing in common leave nothing', () => {
    const d = effectivePolicy(RECOMMENDED, policy({ mode: 'custom', allow: [DEEPSEEK] }), { capability: 'text', caller: 'app', appModels: [OPUS] });
    expect(d.allowed).toEqual([]);
  });

  it('the owner\'s per-app list binds only an app the node identified from its grant', () => {
    const p = policy({ apps: { 'alice/paja.html': { allow: [OPUS] } } });
    expect(effectivePolicy(RECOMMENDED, p, { capability: 'text', caller: 'app', verifiedApp: 'alice/paja.html' }).allowed).toEqual([OPUS]);
    expect(effectivePolicy(RECOMMENDED, p, { capability: 'text', caller: 'app' }).allowed).toBe('any');
  });

  it('the owner\'s per-agent list binds that agent', () => {
    const p = policy({ agents: { scout: { allow: [DEEPSEEK] } } });
    expect(effectivePolicy(RECOMMENDED, p, { capability: 'text', caller: 'agent', agent: 'scout' }).allowed).toEqual([DEEPSEEK]);
    expect(effectivePolicy(RECOMMENDED, p, { capability: 'text', caller: 'agent', agent: 'other' }).allowed).toBe('any');
  });
});

describe('the model the node picks instead', () => {
  const d = effectivePolicy(RECOMMENDED, policy({ mode: 'recommended' }), { capability: 'text', caller: 'app' });

  it('is the first recommended, allowed model the caller\'s provider reaches', () => {
    expect(firstAllowed(d, 'text', RECOMMENDED, ['openrouter'])).toBe(OPUS);
  });

  it('is none when the caller\'s provider reaches none of them', () => {
    expect(firstAllowed(d, 'text', RECOMMENDED, ['openai-compatible'])).toBeNull();
  });

  it('for an image, only a model recommended for images', () => {
    const di = effectivePolicy(RECOMMENDED, policy({ mode: 'custom', allow: [OPUS, FLUX] }), { capability: 'image', caller: 'owner' });
    expect(firstAllowed(di, 'image', RECOMMENDED, ['openrouter'])).toBe(FLUX);
    const dx = effectivePolicy(RECOMMENDED, policy({ mode: 'custom', allow: [OPUS] }), { capability: 'image', caller: 'owner' });
    expect(firstAllowed(dx, 'image', RECOMMENDED, ['openrouter'])).toBeNull();
  });

  it('from the catalogue, a model of the custom list that serves the capability (V4)', () => {
    const MINE = 'openrouter:acme/pixel-2';
    const dc = effectivePolicy(RECOMMENDED, policy({ mode: 'custom', allow: [OPUS, MINE] }), { capability: 'image', caller: 'owner' });
    const serves = (ref: string) => ref === MINE ? true : ref === OPUS ? false : undefined;
    expect(firstAllowed(dc, 'image', RECOMMENDED, ['openrouter'], serves)).toBe(MINE);
    // For text, a model the catalogue says does not write text is passed over; an unknown one is not.
    const dt = effectivePolicy(RECOMMENDED, policy({ mode: 'custom', allow: [MINE, 'openrouter:acme/unknown'] }), { capability: 'text', caller: 'owner' });
    expect(firstAllowed(dt, 'text', {}, ['openrouter'], ref => ref === MINE ? false : undefined)).toBe('openrouter:acme/unknown');
  });
});
