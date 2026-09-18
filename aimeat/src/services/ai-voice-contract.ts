/**
 * @file ai-voice-contract.ts
 * @description One validated input contract for REST, node MCP and connector voice tools.
 * @version-history v1.0.0 - 2026-09-19 - Share voice inputs across agent and browser transports.
 */
import { z } from 'zod';

const attribution = { app_id: z.string().min(1).max(200) };
export const voiceReplySchema = z.object({ ...attribution,
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(100000) }).strict()).min(1).max(201),
  model: z.string().max(200).optional(), temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(), max_tokens: z.number().int().min(1).max(32768).optional(),
  reasoning: z.object({ enabled: z.boolean().optional(), effort: z.enum(['low', 'medium', 'high']).optional(),
    max_tokens: z.number().int().positive().max(32768).optional(), exclude: z.boolean().optional() }).strict().nullable().optional(),
}).strict().refine(value => value.messages.reduce((sum, message) => sum + message.content.length, 0) <= 200000, 'messages exceed 200k characters');
export const voiceSpeechSchema = z.object({ ...attribution, input: z.string().trim().min(1).max(4000), model: z.string().min(1).max(200),
  voice: z.string().min(1).max(200), response_format: z.enum(['pcm', 'mp3']).default('pcm'),
  speed: z.number().min(0.25).max(4).default(1), instructions: z.string().max(2000).optional(),
}).strict();
