/**
 * @file test/unit/ai-call-limit.test.ts
 * @description The account's AI call limit (services/account-limits.ts takeAiCall and
 *   requireAiCallTurn): the limit from config.rateLimits.openrouter, counted per ACCOUNT, so the
 *   owner and every agent acting for them share one allowance, and the AI services refuse with
 *   RATE_LIMITED before they read or spend anything. A REST route and an MCP tool call the same
 *   service function, so this is the count both draw on.
 *
 *   secaudit 2026-10, C5. The limit sat on the REST routes only, keyed by the principal: the MCP
 *   tools called AI without one, and an owner with N agents had N allowances.
 * @version-history
 *   v1.0.0 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import { takeAiCall, requireAiCallTurn, retryAfterOf } from '../../src/services/account-limits.js';
import { AiCompletionError } from '../../src/services/ai/errors.js';
import { embedForOwner } from '../../src/services/ai-embed.js';
import { generateForOwner } from '../../src/services/ai-image.js';
import { transcribeForOwner } from '../../src/services/ai-transcription.js';

const NODE = 'aimeat-local-001-dev';
let n = 0;
/** A fresh account for each case: the buckets live as long as the module does. */
const account = (): string => `ailimit${Date.now().toString(36)}${n++}@${NODE}`;
const limitOf = (max: number) => ({ rateLimits: { openrouter: { windowMs: 60_000, max } } });

describe('one AI call allowance per account', () => {
  it('the 31st call in the window is refused with RATE_LIMITED at the default 30', () => {
    const cfg = limitOf(30);
    const owner = account();
    for (let i = 0; i < 30; i++) expect(takeAiCall(cfg, owner).ok).toBe(true);
    const refused = takeAiCall(cfg, owner);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('RATE_LIMITED');
    expect(refused.retryAfterSec).toBeGreaterThan(0);
    expect(refused.message).toBe(
      `This account has started 30 AI calls in the last minute, which is the most one account may start. Try again in ${refused.retryAfterSec} seconds.`);
  });

  it('the owner GHII and an agent of the owner share one allowance', () => {
    const cfg = limitOf(3);
    const owner = account();
    const agent = `claude#${owner}`;
    expect(takeAiCall(cfg, owner).ok).toBe(true);
    expect(takeAiCall(cfg, agent).ok).toBe(true);
    expect(takeAiCall(cfg, `other#${owner}`).ok).toBe(true);
    const fourth = takeAiCall(cfg, agent);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.code).toBe('RATE_LIMITED');
    expect(takeAiCall(cfg, owner).ok).toBe(false);
  });

  it('another account has its own allowance', () => {
    const cfg = limitOf(2);
    const a = account();
    const b = account();
    expect(takeAiCall(cfg, a).ok).toBe(true);
    expect(takeAiCall(cfg, `claude#${a}`).ok).toBe(true);
    expect(takeAiCall(cfg, a).ok).toBe(false);
    expect(takeAiCall(cfg, b).ok).toBe(true);
    expect(takeAiCall(cfg, `claude#${b}`).ok).toBe(true);
  });

  it('the configured number is the limit: a new number starts a new count', () => {
    const owner = account();
    expect(takeAiCall(limitOf(1), owner).ok).toBe(true);
    expect(takeAiCall(limitOf(1), owner).ok).toBe(false);
    expect(takeAiCall(limitOf(5), owner).ok).toBe(true);
  });
});

describe('requireAiCallTurn, the AI services\' own question', () => {
  it('throws AiCompletionError RATE_LIMITED 429 with the seconds for Retry-After', () => {
    const cfg = limitOf(1);
    const owner = account();
    requireAiCallTurn(cfg, owner, undefined);
    let thrown: unknown;
    try { requireAiCallTurn(cfg, `claude#${owner}`, undefined); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(AiCompletionError);
    const e = thrown as AiCompletionError;
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.status).toBe(429);
    expect(retryAfterOf(e)).toBeGreaterThan(0);
  });

  it("'exempt' (node-internal work) neither counts nor is refused", () => {
    const cfg = limitOf(1);
    const owner = account();
    for (let i = 0; i < 10; i++) requireAiCallTurn(cfg, owner, 'exempt');
    expect(takeAiCall(cfg, owner).ok).toBe(true);
    expect(() => requireAiCallTurn(cfg, owner, 'exempt')).not.toThrow();
  });

  it('retryAfterOf answers only for the account limit refusal', () => {
    expect(retryAfterOf(new AiCompletionError('RATE_LIMITED', 429, 'Provider rate limit hit. Try again later.'))).toBeUndefined();
    expect(retryAfterOf(new Error('x'))).toBeUndefined();
  });
});

describe('the AI services count before they read or spend', () => {
  // A storage that fails the test if it is touched: the refusal comes first.
  const untouched = new Proxy({}, { get: () => { throw new Error('storage was read before the limit'); } }) as Storage;
  const exhausted = (): { config: AimeatConfig; owner: string } => {
    const cfg = limitOf(1);
    const owner = account();
    expect(takeAiCall(cfg, owner).ok).toBe(true);
    return { config: { ...cfg, sttMaxMb: 25 } as unknown as AimeatConfig, owner };
  };
  const refusedCode = async (p: Promise<unknown>): Promise<string> => {
    try { await p; return 'resolved'; } catch (e) { return (e as { code?: string }).code ?? String(e); }
  };

  it('embedForOwner (POST /v1/ai/embed and aimeat_ai_embed)', async () => {
    const { config, owner } = exhausted();
    expect(await refusedCode(embedForOwner(untouched, config, owner, { input: ['ok'], caller: 'agent', agent: 'claude' })))
      .toBe('RATE_LIMITED');
  });

  it('generateForOwner (POST /v1/ai/image and aimeat_image_generate)', async () => {
    const { config, owner } = exhausted();
    expect(await refusedCode(generateForOwner(untouched, config, owner, { prompt: 'a square', caller: 'agent' })))
      .toBe('RATE_LIMITED');
  });

  it('transcribeForOwner (POST /v1/ai/transcribe and aimeat_ai_transcribe)', async () => {
    const { config, owner } = exhausted();
    const audio = { data: Buffer.from([1, 2, 3]), mime: 'audio/wav', filename: 'a.wav' };
    expect(await refusedCode(transcribeForOwner(untouched, config, owner, { audio, caller: 'owner' })))
      .toBe('RATE_LIMITED');
  });
});
