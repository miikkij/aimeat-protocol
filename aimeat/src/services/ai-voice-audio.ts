/**
 * @file ai-voice-audio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a speech answer is, said to the caller, and the voice checked before a paid call.
 *
 *   THE AUDIO BLOCK. POST /v1/ai/speak streams the provider's bytes as they come, and raw PCM carries
 *   no header, so a player that guesses the sample rate plays the speech at the wrong speed. Until
 *   2026-10-08 nothing said it: the start and done frames named the format only, and a partner had to
 *   infer 24 kHz, 16-bit, mono (aiprov plan, A4). `audio: { mime, sample_rate, channels,
 *   sample_format }` now rides on the start frame, the done frame and the ?json=1 result. The bytes
 *   stay as the provider sent them: no WAV header is added.
 *
 *   WHERE THE NUMBERS COME FROM, first that answers: the provider's content type when it names them
 *   (`audio/L16; rate=24000; channels=1`), an extension's ai.speak answer (`sampleRate`, `channels`,
 *   `sampleFormat`), the provider record's speech capability (the owner or the operator states it for
 *   a local or OpenAI-compatible server), and for OpenAI and OpenRouter the PCM both send (24000 Hz,
 *   mono, signed 16-bit little-endian). Unknown is null, never a guess. MP3 carries its own header,
 *   so its block has the mime type from the real content type and nulls.
 *
 *   THE VOICE. A catalogue model that lists its voices (services/ai/catalog, `caps.voices`) refuses
 *   any other one, and the provider charged nothing to say so only because the node asked first: a
 *   call naming a voice the model does not have is 400 INVALID_VOICE with the valid ones, before the
 *   provider is called (A6). A model the catalogue lists no voices for passes as it is.
 * @structure SpeechAudio · speechAudioOf · checkSpeechVoice · speechFormatHint
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (aiprov plan, A4, A6).
 */
import { AiCompletionError } from './ai/errors.js';
import { catalogModel } from './ai/catalog/store.js';
import type { AiCandidate } from './ai/route-plan.js';

/** What the caller needs to play the bytes: their type and, for PCM, the sample layout. */
export interface SpeechAudio {
  mime: string;
  sample_rate: number | null;
  channels: number | null;
  sample_format: 's16le' | 's16be' | 'f32le' | null;
}

const SAMPLE_FORMATS = ['s16le', 's16be', 'f32le'] as const;
type SampleFormat = typeof SAMPLE_FORMATS[number];

/** The PCM OpenAI's /audio/speech sends, and OpenRouter's for both OpenAI and Gemini TTS models. */
const OPENAI_PCM = { rate: 24000, channels: 1, format: 's16le' as const };

function positiveInt(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 384000 ? n : undefined;
}

function sampleFormatOf(v: unknown): SampleFormat | undefined {
  return typeof v === 'string' && (SAMPLE_FORMATS as readonly string[]).includes(v) ? v as SampleFormat : undefined;
}

/**
 * The audio block for one speech answer.
 * @param c the candidate that answered
 * @param format what the call asked for
 * @param contentType the provider's Content-Type, as it came
 * @param extension the extension's ai.speak answer, for an extension provider
 */
export function speechAudioOf(
  c: Pick<AiCandidate, 'provider'>, format: 'pcm' | 'mp3', contentType: string, extension?: Record<string, unknown>,
): SpeechAudio {
  const [rawBase = '', ...rawParams] = contentType.split(';').map(s => s.trim());
  const base = rawBase.toLowerCase();
  const param = (name: string) => rawParams.find(p => p.toLowerCase().startsWith(name + '='))?.slice(name.length + 1);
  const mime = base.startsWith('audio/') ? base : format === 'mp3' ? 'audio/mpeg' : 'audio/pcm';
  if (format === 'mp3') return { mime, sample_rate: null, channels: null, sample_format: null };
  const stated = c.provider.capabilities.speech;
  const typed = c.provider.type === 'openai' || c.provider.type === 'openrouter' ? OPENAI_PCM : undefined;
  // RFC 2586: audio/L16 is big-endian.
  const fromType = base === 'audio/l16' ? 's16be' as const : undefined;
  return {
    mime,
    sample_rate: positiveInt(param('rate')) ?? positiveInt(extension?.sampleRate) ?? stated?.sampleRate ?? typed?.rate ?? null,
    channels: positiveInt(param('channels')) ?? positiveInt(extension?.channels) ?? stated?.channels ?? typed?.channels ?? null,
    sample_format: fromType ?? sampleFormatOf(extension?.sampleFormat) ?? stated?.sampleFormat ?? typed?.format ?? null,
  };
}

/** How many valid voices a refusal names in its message; `details.voices` carries them all. */
const VOICES_IN_MESSAGE = 30;

/** Refuse a voice the catalogue says this model does not have, before anything is paid for. */
export function checkSpeechVoice(c: Pick<AiCandidate, 'provider' | 'model'>, voice: string): void {
  const voices = catalogModel(c.provider.type, c.model)?.caps.voices;
  if (!voices || voices.length === 0) return;
  const wanted = voice.toLowerCase();
  if (voices.some(v => v.toLowerCase() === wanted)) return;
  const shown = voices.slice(0, VOICES_IN_MESSAGE).join(', ') + (voices.length > VOICES_IN_MESSAGE ? ', …' : '');
  throw new AiCompletionError('INVALID_VOICE', 400,
    `${c.model} has no voice '${voice}'. Its voices: ${shown}.`, { voice, model: c.model, voices });
}

/** The sentence a refused mp3 call carries: pcm is the format every speech model here makes. */
export function speechFormatHint(format: 'pcm' | 'mp3'): string | undefined {
  return format === 'mp3' ? 'Ask for response_format pcm: not every speech model makes mp3.' : undefined;
}
