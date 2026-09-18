/**
 * @file ai-voice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Validated app-attributed text and speech streaming, under the existing AI permission.
 * @structure registerVoiceRoutes; voiceAppId binds app tokens to their signed identity
 * @usage registerVoiceRoutes(router, config, storage)
 * @version-history v1.0.0 - 2026-09-19 - NDJSON voice stages with backpressure and disconnect cancellation.
 */
import type { Router, Request, Response } from 'express';
import { once } from 'node:events';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { AiCompletionError } from '../services/ai-completion.js';
import { streamReply, streamSpeech } from '../services/ai-voice.js';
import { logger } from '../utils/logger.js';

const attribution = { app_id: z.string().min(1).max(200) };
const reply = z.object({ ...attribution,
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(100000) }).strict()).min(1).max(201),
  model: z.string().max(200).optional(), temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(), max_tokens: z.number().int().min(1).max(32768).optional(),
  reasoning: z.object({ enabled: z.boolean().optional(), effort: z.enum(['low', 'medium', 'high']).optional(),
    max_tokens: z.number().int().positive().max(32768).optional(), exclude: z.boolean().optional() }).strict().nullable().optional(),
}).strict().refine(value => value.messages.reduce((sum, message) => sum + message.content.length, 0) <= 200000, 'messages exceed 200k characters');
const speech = z.object({ ...attribution, input: z.string().trim().min(1).max(4000), model: z.string().min(1).max(200),
  voice: z.string().min(1).max(200), response_format: z.enum(['pcm', 'mp3']).default('pcm'),
  speed: z.number().min(0.25).max(4).default(1), instructions: z.string().max(2000).optional(),
}).strict();

/** App tokens may not charge another app's quota by changing a body field. */
export function voiceAppId(req: Request, requested?: string): string | undefined {
  if (req.auth?.roles.includes('app')) {
    const trusted = req.auth.app;
    if (!trusted) throw new AiCompletionError('APP_ID_REQUIRED', 403, 'The app token has no application identity.');
    if (requested && requested !== trusted) throw new AiCompletionError('APP_ID_MISMATCH', 403, 'app_id must match the signed app identity.');
    return trusted;
  }
  return requested;
}

export function registerVoiceRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const limit = rateLimit(config.rateLimits.openrouter);
  async function run(req: Request, res: Response, kind: 'reply' | 'speech') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Voice request timed out')), 180000);
    const closed = () => { if (!res.writableEnded) controller.abort(new Error('Voice client disconnected')); };
    res.on('close', closed);
    try {
      const body = { ...req.body, app_id: voiceAppId(req, req.body?.app_id) };
      const emit = async (event: Record<string, unknown>) => {
        controller.signal.throwIfAborted();
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('Cache-Control', 'no-store, no-transform');
          res.setHeader('X-Accel-Buffering', 'no'); res.setHeader('AI-Disclosure', 'ai-generated');
        }
        if (!res.write(JSON.stringify(event) + '\n')) await once(res, 'drain', { signal: controller.signal });
        res.flush?.();
      };
      const principal = resolveIdentity(req.auth!, config.nodeId);
      if (kind === 'reply') await streamReply(storage, config, principal, reply.parse(body), controller.signal, emit);
      else await streamSpeech(storage, config, principal, speech.parse(body), controller.signal, emit);
      res.end();
    } catch (failure) {
      if (res.destroyed) { logger.debug('[voice] disconnected request settled', { error: String(failure) }); return; }
      const typed = failure instanceof AiCompletionError;
      const code = typed ? failure.code : failure instanceof z.ZodError ? 'INVALID_BODY' : 'PROVIDER_ERROR';
      const message = failure instanceof z.ZodError ? failure.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; ') : (failure as Error).message;
      if (res.headersSent) res.end(JSON.stringify({ type: 'error', code, message }) + '\n');
      else res.status(typed ? failure.status : code === 'INVALID_BODY' ? 400 : 502).json(error(config.nodeId, code, message));
    } finally { clearTimeout(timeout); res.off('close', closed); }
  }
  router.post('/v1/ai/stream', requireAuth(), requireScope('ai:use'), limit, (req, res) => run(req, res, 'reply'));
  router.post('/v1/ai/speak', requireAuth(), requireScope('ai:use'), limit, (req, res) => run(req, res, 'speech'));
}
