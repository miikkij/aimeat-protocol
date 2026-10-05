/**
 * @file ai-voice.ts
 * @description Shared voice tool metadata for node MCP, connector MCP and CLI.
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.1.0 - 2026-09-28 - Reply and speech take `role`, the AI role the call runs as, and declare
 *     `provider`, which the shared schema took since V5 and the CLI dispatch refused as undeclared.
 *   v1.0.0 - 2026-09-19 - Agent voice stage contract.
 */
import { type AimeatToolDefinition, agentEverywhere } from './types.js';
import { AI_ROLE_PARAM } from './ai-models.js';
import { voiceReplySchema, voiceSpeechSchema } from '../../models/ai-voice-contract.js';

export const voiceTools = [
  {
    name: 'aimeat_voice_reply', caller: 'agent', visibility: agentEverywhere,
        annotations: { title: 'Generate Voice Reply', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'Generate a conversational text reply with the owner\'s AI key, app quota, usage and provenance. Returns final text; browser apps use the streaming AIMEAT.voice adapter for early playback. Model messages contain text only. No token cap unless explicitly supplied.',
    input: {
      app_id: { type: 'string', required: true, description: 'App attribution for the owner\'s allowlist and daily quota.', zod: voiceReplySchema.shape.app_id },
      messages: { type: 'array', required: true, description: '1-201 {role: system|user|assistant, content: string} messages; at most 200k characters combined.', zod: voiceReplySchema.shape.messages },
      model: { type: 'string', description: 'Model override; otherwise the owner\'s configured chat model.', zod: voiceReplySchema.shape.model },
      temperature: { type: 'number', description: 'Sampling temperature, 0-2.', zod: voiceReplySchema.shape.temperature },
      top_p: { type: 'number', description: 'Nucleus sampling, 0-1.', zod: voiceReplySchema.shape.top_p },
      max_tokens: { type: 'number', description: 'Optional explicit output cap, 1-32768. Omitted by default.', zod: voiceReplySchema.shape.max_tokens },
      reasoning: { type: 'object', description: 'Optional {enabled, effort: low|medium|high, max_tokens, exclude}; provider-dependent.', zod: voiceReplySchema.shape.reasoning },
      provider: { type: 'string', description: 'One of the owner\'s AI providers (aimeat_ai_providers), or a type. No fallback then.', zod: voiceReplySchema.shape.provider },
      role: { type: 'string', description: AI_ROLE_PARAM, zod: voiceReplySchema.shape.role },
    },
  },
  {
    name: 'aimeat_voice_speak', caller: 'agent', visibility: agentEverywhere,
        annotations: { title: 'Generate Speech', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'Synthesize speech using the owner\'s configured provider and AI budget. Returns a PRIVATE storage_key, fetch_url, usage and provenance, never audio bytes in model context. Download using authenticated storage access; delete the file when no longer needed. Select a model and voice supported by the provider.',
    input: {
      app_id: { type: 'string', required: true, description: 'App attribution for the owner\'s allowlist and daily quota.', zod: voiceSpeechSchema.shape.app_id },
      input: { type: 'string', required: true, description: 'Text to speak, 1-4000 characters.', zod: voiceSpeechSchema.shape.input },
      model: { type: 'string', description: 'Speech model id; the speech role gives one when it is left out.', zod: voiceSpeechSchema.shape.model },
      voice: { type: 'string', description: 'Provider voice id; the speech role gives one when it is left out.', zod: voiceSpeechSchema.shape.voice },
      response_format: { type: 'string', enum: ['pcm', 'mp3'], description: 'Audio format, default pcm. PCM rate and channel count follow the provider.', zod: voiceSpeechSchema.shape.response_format },
      speed: { type: 'number', description: 'Speech speed, 0.25-4, default 1.', zod: voiceSpeechSchema.shape.speed },
      instructions: { type: 'string', description: 'Optional provider-specific speaking instructions, at most 2000 characters.', zod: voiceSpeechSchema.shape.instructions },
      provider: { type: 'string', description: 'One of the owner\'s AI providers (aimeat_ai_providers), or a type. No fallback then.', zod: voiceSpeechSchema.shape.provider },
      role: { type: 'string', description: AI_ROLE_PARAM, zod: voiceSpeechSchema.shape.role },
    },
  },
] as const satisfies readonly AimeatToolDefinition[];
