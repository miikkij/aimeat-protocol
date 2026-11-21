/**
 * @file test/unit/ai-gateway-warnings.test.ts
 * @description The gateway's text() reads the AI SDK's call warnings (docs/pitfalls.md §98).
 *
 *   An AI SDK provider package changes a call it does not fully support and says so only in the
 *   result's `warnings`, which the SDK prints to the console: @ai-sdk/anthropic caps the output of a
 *   model id it does not know at 4096 tokens, and the call answers 200. text() now logs them and
 *   carries them on the result as `warnings`, one sentence each.
 *
 *   generateText is replaced here so the result can carry a warning a real provider package would
 *   give; the gateway code around it is the real one. Seen red first: before the change the result
 *   had no `warnings` and logger.warn was not called.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-gateway-warnings.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generated = vi.hoisted(() => ({ warnings: undefined as unknown }));
vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('ai')>();
  return {
    ...real,
    generateText: vi.fn(async () => ({
      text: 'an answer cut at the cap',
      finishReason: 'length',
      rawFinishReason: 'max_tokens',
      response: { modelId: 'claude-compatible-x', body: {} },
      usage: { inputTokens: 5, outputTokens: 4096, totalTokens: 4101 },
      providerMetadata: undefined,
      warnings: generated.warnings,
    })),
  };
});
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { text, warningLines } = await import('../../src/services/ai/gateway.js');
const { logger } = await import('../../src/utils/logger.js');
import type { AiTarget } from '../../src/services/ai/types.js';

const target: AiTarget = { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:9', key: undefined };

beforeEach(() => { vi.mocked(logger.warn).mockClear(); });

describe('the AI SDK call warnings reach the caller', () => {
  it('carries each warning on the result and logs them once', async () => {
    generated.warnings = [
      { type: 'compatibility', feature: 'maxOutputTokens', details: 'Unknown model: defaulting to 4096 output tokens.' },
      { type: 'unsupported', feature: 'temperature' },
    ];
    const r = await text({ target, model: 'claude-compatible-x', prompt: 'x' });
    expect(r.warnings).toEqual([
      'compatibility: maxOutputTokens. Unknown model: defaulting to 4096 output tokens.',
      'unsupported: temperature',
    ]);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
    expect((vi.mocked(logger.warn).mock.calls[0] as unknown[])[1]).toMatchObject({ warnings: r.warnings });
  });

  it('leaves `warnings` out and logs nothing when the package said nothing', async () => {
    generated.warnings = [];
    const r = await text({ target, model: 'claude-compatible-x', prompt: 'x' });
    expect(r).not.toHaveProperty('warnings');
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('writes the deprecated and other kinds in words too, and an absent list as none', () => {
    expect(warningLines([
      { type: 'deprecated', setting: "providerOptions key 'openai-compatible'", message: "Use 'openaiCompatible' instead." },
      { type: 'other', message: 'the provider ignored seed' },
    ])).toEqual([
      "deprecated: providerOptions key 'openai-compatible'. Use 'openaiCompatible' instead.",
      'other: the provider ignored seed',
    ]);
    expect(warningLines(undefined)).toEqual([]);
  });
});
