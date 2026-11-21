/**
 * @file test/unit/ai-fix-requires-local.test.ts
 * @description An AI refusal whose every provider was left out for running off this machine tells
 *   the AI where the ask came from (appdev pitfall ai/local-capability-means-this-machine-only): an
 *   app that copied `local.transcription=yes` from the handbook's example had its owner's cloud
 *   provider turned off, and the refusal said only that no provider serves the capability.
 *
 *   FIRST FAIL: before the change the agentFix was the NO_PROVIDER_SUPPORTS sentence and no
 *   requiresLocal was set.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { AiCompletionError } from '../../src/services/ai/errors.js';
import { withPersonFix, reasonOf } from '../../src/services/ai/ai-fix-words.js';
import type { AimeatConfig } from '../../src/config.js';

const config = { baseUrl: 'https://node.test', siteLinks: {} } as unknown as AimeatConfig;
const refusal = (rejected: Array<{ provider: string; reason: string }>) =>
  new AiCompletionError('AI_CAPABILITY_UNAVAILABLE', 503, 'No provider can transcribe.', { rejected });

describe('a refusal left with only local-only rejections', () => {
  it('names local.<capability>=yes in the agentFix and sets requiresLocal', async () => {
    const e = await withPersonFix(refusal([{ provider: 'or', reason: 'requires-local' }, { provider: 'oa', reason: 'requires-local' }]),
      null as never, config, 'alice@n1', 'transcription', { chosen: 'en' });
    expect(reasonOf(e)).toBe('NO_PROVIDER_SUPPORTS');
    expect(e.details?.requiresLocal).toBe(true);
    expect(String(e.details?.agentFix)).toContain('local.transcription=yes');
  });

  it('keeps the old agentFix when another reason is among the rejections', async () => {
    const e = await withPersonFix(refusal([{ provider: 'or', reason: 'requires-local' }, { provider: 'oa', reason: 'capability-off' }]),
      null as never, config, 'alice@n1', 'transcription', { chosen: 'en' });
    expect(e.details?.requiresLocal).toBeUndefined();
    expect(String(e.details?.agentFix)).toMatch(/^None of the owner's providers serves transcription/);
  });

  it('keeps the old agentFix when nothing was rejected', async () => {
    const e = await withPersonFix(refusal([]), null as never, config, 'alice@n1', 'text', { chosen: 'en' });
    expect(e.details?.requiresLocal).toBeUndefined();
  });
});
