/**
 * @file provider-test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The smallest real call that proves one provider serves one capability
 *   (docs/internal/llmproviderintegrations/11, section 4: "tested and working" is status `ok`, from
 *   this test or from a real call). It runs the same gate every call runs, with the provider named and
 *   no fallback, so what it proves is what a real call will do, and it is metered and budgeted like
 *   one. POST /v1/ai/providers/:id/test and aimeat_ai_provider_test both call testProvider().
 *
 *   - text, vision, files: one short completion, with no token cap (a reasoning model would spend a
 *     small one on hidden thinking and answer with nothing).
 *   - transcription: one second of silence, made here, so no file is carried in the repo.
 *   - image: the smallest picture. It costs money, so the caller says it accepts that
 *     (`acceptCost`); the settings page shows the price first.
 *   - speech: the word "ok", spoken (V5).
 *   - embeddings: the vector of "ok" (V5).
 *
 *   A test clears what the process knew about the provider first, so a provider skipped for a refused
 *   key can be tested again; a pass marks it `ok` and records when it was tested.
 * @structure testProvider · silentWav
 * @version-history
 *   v1.2.0 — 2026-10-05 — `caller` is required: every call says who asks (secaudit 2026-10, AI-3).
 *   v1.1.0 — 2026-09-28 — Speech and embeddings are testable (V5 of the System 2 plan).
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { completeForOwner } from '../ai-completion.js';
import { generateForOwner } from '../ai-image.js';
import { transcribeForOwner } from '../ai-transcription.js';
import { embedForOwner } from '../ai-embed.js';
import { streamSpeech } from '../ai-voice.js';
import { AiCompletionError } from './errors.js';
import { clearHealth } from './health.js';
import { persistHealth } from './provider-store.js';
import { providerIdOf } from '../ai-provider-common.js';
import type { CallerClass } from './policy.js';
import type { AiCapability } from './types.js';

const TESTABLE: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'transcription', 'speech', 'embed'];
const APP_ID = 'ai-provider-test';

/** One second of 16 kHz mono 16-bit silence as a WAV file. */
export function silentWav(seconds = 1): Buffer {
  const rate = 16_000;
  const data = rate * 2 * seconds;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

export interface ProviderTestInput {
  provider: string;
  capability?: AiCapability;
  /** An image test makes a picture, which costs money. */
  acceptCost?: boolean;
  agent?: string;
  caller: CallerClass;
  verifiedApp?: string;
}

export interface ProviderTestResult {
  ok: true;
  provider: string;
  capability: AiCapability;
  model: string;
  latency_ms: number;
  cost_usd: number;
  key_source: 'agent' | 'own' | 'node';
}

export async function testProvider(
  storage: Storage, config: AimeatConfig, gaii: string, input: ProviderTestInput,
): Promise<ProviderTestResult> {
  const id = providerIdOf(input.provider);
  if (!id) throw new AiCompletionError('INVALID_BODY', 400, 'provider: the id of one of your providers.');
  const capability = input.capability ?? 'text';
  if (!TESTABLE.includes(capability)) {
    throw new AiCompletionError('AI_CAPABILITY_TEST_UNAVAILABLE', 400,
      `A ${capability} test is not available yet; ${TESTABLE.join(', ')} are. A real call marks the capability working when it succeeds.`);
  }
  if (capability === 'image' && input.acceptCost !== true) {
    throw new AiCompletionError('AI_TEST_COSTS_MONEY', 400,
      'An image test makes one small picture, which the provider charges for. Send accept_cost: true to run it.');
  }
  // What the process knew no longer holds: the owner is testing, maybe after a new key.
  clearHealth(gaii, id);
  const who = {
    appId: APP_ID, provider: id, fallback: false,
    ...(input.agent ? { agent: input.agent } : {}),
    caller: input.caller,
    ...(input.verifiedApp ? { verifiedApp: input.verifiedApp } : {}),
  };
  const started = Date.now();
  let model: string; let cost: number; let keySource: ProviderTestResult['key_source'];
  if (capability === 'image') {
    const r = await generateForOwner(storage, config, gaii, { ...who, prompt: 'A small plain blue square.', size: '256x256' });
    model = r.model; cost = r.usage.costUsd; keySource = r.keySource;
  } else if (capability === 'transcription') {
    const r = await transcribeForOwner(storage, config, gaii, { ...who, audio: { data: silentWav(), mime: 'audio/wav', filename: 'silence.wav' } });
    model = r.model; cost = r.usage.costUsd; keySource = r.keySource;
  } else if (capability === 'embed') {
    const r = await embedForOwner(storage, config, gaii, { ...who, input: ['ok'] });
    model = r.model; cost = r.usage.costUsd; keySource = r.keySource;
  } else if (capability === 'speech') {
    // One word, spoken. The audio is read and dropped; the `done` event carries the model and cost.
    let done: Record<string, unknown> | undefined;
    await streamSpeech(storage, config, gaii, {
      input: 'ok', app_id: APP_ID, provider: id, response_format: 'mp3', speed: 1,
      caller: input.caller, ...(input.verifiedApp ? { verifiedApp: input.verifiedApp } : {}),
    }, AbortSignal.timeout(60_000), async (e) => { if (e.type === 'done') done = e; });
    model = String(done?.model ?? ''); cost = typeof done?.cost_usd === 'number' ? done.cost_usd : 0;
    keySource = (done?.key_source as ProviderTestResult['key_source'] | undefined) ?? 'own';
  } else {
    // No token cap: a reasoning model spends a small cap on hidden thinking and answers with nothing,
    // which would fail a provider that works. The answer asked for is one word.
    const r = await completeForOwner(storage, config, gaii, { ...who, capability, prompt: 'Reply with the single word: ok', retries: 0 });
    model = r.model; cost = r.usage.costUsd; keySource = r.keySource;
  }
  const at = new Date().toISOString();
  await persistHealth(storage, gaii, id, capability, { status: 'ok', lastOkAt: at, lastTestAt: at });
  return { ok: true, provider: id, capability, model, latency_ms: Date.now() - started, cost_usd: cost, key_source: keySource };
}
