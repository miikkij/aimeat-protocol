/**
 * @file ai-voice.ts
 * @description Shared voice tool metadata for node MCP, connector MCP and CLI.
 * @version-history v1.0.0 - 2026-09-19 - Agent voice stage contract.
 */
import { type AimeatToolDefinition, agentEverywhere } from './types.js';

export const voiceTools: AimeatToolDefinition[] = [
  {
    name: 'aimeat_voice_reply', caller: 'agent', visibility: agentEverywhere,
    description: 'Generate a conversational text reply with the owner\'s AI key, app quota, usage and provenance. Returns final text; browser apps use the streaming AIMEAT.voice adapter for early playback. Model messages contain text only. No token cap unless explicitly supplied.',
    input: {
      app_id: { type: 'string', required: true, description: 'App attribution for the owner\'s allowlist and daily quota.' },
      messages: { type: 'array', required: true, description: '1-201 {role: system|user|assistant, content: string} messages; at most 200k characters combined.' },
      model: { type: 'string', description: 'Model override; otherwise the owner\'s configured chat model.' },
      temperature: { type: 'number', description: 'Sampling temperature, 0-2.' },
      top_p: { type: 'number', description: 'Nucleus sampling, 0-1.' },
      max_tokens: { type: 'number', description: 'Optional explicit output cap, 1-32768. Omitted by default.' },
      reasoning: { type: 'object', description: 'Optional {enabled, effort: low|medium|high, max_tokens, exclude}; provider-dependent.' },
    },
  },
  {
    name: 'aimeat_voice_speak', caller: 'agent', visibility: agentEverywhere,
    description: 'Synthesize speech using the owner\'s configured provider and AI budget. Returns a PRIVATE storage_key, fetch_url, usage and provenance, never audio bytes in model context. Download using authenticated storage access; delete the file when no longer needed. Select a model and voice supported by the provider.',
    input: {
      app_id: { type: 'string', required: true, description: 'App attribution for the owner\'s allowlist and daily quota.' },
      input: { type: 'string', required: true, description: 'Text to speak, 1-4000 characters.' },
      model: { type: 'string', required: true, description: 'Explicit speech model id.' },
      voice: { type: 'string', required: true, description: 'Provider voice id.' },
      response_format: { type: 'string', enum: ['pcm', 'mp3'], description: 'Audio format, default pcm. PCM rate and channel count follow the provider.' },
      speed: { type: 'number', description: 'Speech speed, 0.25-4, default 1.' },
      instructions: { type: 'string', description: 'Optional provider-specific speaking instructions, at most 2000 characters.' },
    },
  },
];
