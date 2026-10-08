/**
 * @file ai-voice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Validated app-attributed text and speech streaming, under the existing AI permission.
 * @structure registerVoiceRoutes; voiceAppId binds app tokens to their signed identity
 * @usage registerVoiceRoutes(router, config, storage)
 * @version-history
 *   v1.3.0 - 2026-10-08 - ?json=1 sends the record's AI-Disclosure and Link headers and meta.provenance, the
 *     stream sends the IETF `mode=` field instead of a bare `ai-generated`, the done frame and the
 *     result carry record_url, and an agent's call is the agent's (its key, its cap, its name on the record).
 *   v1.3.0 - 2026-10-08 - A failure that is not a typed refusal is 500 INTERNAL_ERROR, not 502
 *     PROVIDER_ERROR; the error frame after the first byte carries the refusal's details; a provider's
 *     Retry-After reaches the header (aiprov plan, A3, A8, A12).
 *   v1.2.0 - 2026-10-05 - The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *   v1.1.0 - 2026-09-28 - Passes who is calling to the owner's model policy and returns a refusal's details.
 *   v1.0.0 - 2026-09-19 - NDJSON voice stages with backpressure and disconnect cancellation.
 */
import type { Router, Request, Response } from 'express';
import { once } from 'node:events';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { ownerGhiiOf, resolveIdentity } from '../utils/gaii.js';
import { error, success } from '../middleware/envelope.js';
import { AiCompletionError } from '../services/ai/completion.js';
import { nodeFailureOf } from '../services/ai/errors.js';
import { retryAfterOf } from '../services/account-limits.js';
import { streamReply, streamSpeech } from '../services/ai-voice.js';
import { logger } from '../utils/logger.js';
import { voiceReplySchema as reply, voiceSpeechSchema as speech } from '../models/ai-voice-contract.js';
import { createVoiceResult } from '../services/ai-voice-result.js';
import { aiCallerOf } from './ai-policy.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { setProvenanceHeaders, envelopeMeta, type ServedProvenance } from '../services/ai-provenance-marks.js';
import { toIetfHeader } from '../services/ai-provenance-adapters.js';
import { AI_PROVENANCE_SPEC_V1 } from '../models/ai-provenance-schemas.js';

/**
 * The `AI-Disclosure` value a stream sends before its record exists: the IETF structured field for a
 * model generating, from the adapter that writes every other one (`mode=machine-generated; model=…`).
 * It replaced a bare `ai-generated`, which is not that field's syntax.
 */
function streamingDisclosure(model: unknown): string | undefined {
  return toIetfHeader({
    spec: AI_PROVENANCE_SPEC_V1, level: 'ai-generated', humanInvolvement: 'none', generatedAt: new Date().toISOString(),
    ...(typeof model === 'string' && model ? { generator: { model } } : {}),
  });
}

/** A frame or a result with `record_url` beside its `provenance`, where the record resolves. */
function withRecordUrl(event: Record<string, unknown>): Record<string, unknown> {
  const url = (event.provenance as ServedProvenance | undefined)?.recordUrl;
  return url ? { ...event, record_url: url } : event;
}

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
  async function run(req: Request, res: Response, kind: 'reply' | 'speech') {
    const controller = new AbortController();
    // The reason is a typed refusal, so a call cut by the clock answers as the provider's slowness
    // (502) wherever it was cut, not as the node's own failure.
    const timeout = setTimeout(() => controller.abort(new AiCompletionError('PROVIDER_ERROR', 502, 'The voice call took longer than 180 seconds.')), 180000);
    const closed = () => { if (!res.writableEnded) controller.abort(new Error('Voice client disconnected')); };
    res.on('close', closed);
    try {
      const body = { ...req.body, app_id: voiceAppId(req, req.body?.app_id) };
      const buffered = req.query.json === '1' ? createVoiceResult() : null;
      const emit = async (event: Record<string, unknown>) => {
        controller.signal.throwIfAborted();
        if (buffered) { await buffered.emit(event); return; }
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('Cache-Control', 'no-store, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          // The record exists only once the stream has ended, so the header is the structured field
          // for what the node is watching: a model generating, named by the start frame.
          const disclosure = streamingDisclosure(event.model);
          if (disclosure) res.setHeader('AI-Disclosure', disclosure);
        }
        // The done frame names where its record resolves, beside the record itself.
        if (event.type === 'done') event = withRecordUrl(event);
        if (!res.write(JSON.stringify(event) + '\n')) await once(res, 'drain', { signal: controller.signal });
        res.flush?.();
      };
      const principal = resolveIdentity(req.auth!, config.nodeId);
      const payer = ownerGhiiOf(principal);
      // Who asked: an agent's own key pays first, its cap applies, and the record names it (B11).
      const { agent } = aiPayerOf(principal);
      const who = { ...aiCallerOf(req, config.nodeId), ...(agent ? { agent } : {}) };
      if (kind === 'reply') await streamReply(storage, config, payer, { ...reply.parse(body), ...who }, controller.signal, emit);
      else await streamSpeech(storage, config, payer, { ...speech.parse(body), ...who }, controller.signal, emit);
      if (buffered) {
        controller.signal.throwIfAborted();
        const result = withRecordUrl(kind === 'reply' ? buffered.reply() : await buffered.speech(storage, config, principal, speech.parse(body).response_format, controller.signal));
        // The record minted for these bytes, on the header and on the envelope, as /v1/ai/complete does.
        const prov = result.provenance as ServedProvenance | undefined;
        setProvenanceHeaders(res, prov); res.setHeader('Cache-Control', 'no-store');
        res.json(success(config.nodeId, result, undefined, envelopeMeta(prov)));
      } else res.end();
    } catch (failure) {
      if (res.destroyed) { logger.debug('[voice] disconnected request settled', { error: String(failure) }); return; }
      // A body that does not parse is the caller's; a typed refusal keeps its own code and status (a
      // provider's 4xx is 422 PROVIDER_REJECTED, services/ai/errors.ts); anything else is the node's
      // 500 (nodeFailureOf). It was 502 PROVIDER_ERROR, which blamed the provider (aiprov plan, A8).
      const f = failure instanceof z.ZodError
        ? new AiCompletionError('INVALID_BODY', 400, failure.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; '))
        : nodeFailureOf(failure, kind === 'reply' ? 'POST /v1/ai/stream' : 'POST /v1/ai/speak');
      // After the first frame the status is already 200: the refusal is an error frame with the same
      // code, message and details (and the provider's status in them) as the envelope would carry.
      if (res.headersSent) {
        res.end(JSON.stringify({ type: 'error', code: f.code, message: f.message, ...(f.details ? { details: f.details } : {}) }) + '\n');
        return;
      }
      // The account's AI call limit, or the provider's own Retry-After, says when to come back.
      const retryAfter = retryAfterOf(f);
      if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter));
      res.status(f.status).json(error(config.nodeId, f.code, f.message, f.status, f.details));
    } finally { clearTimeout(timeout); res.off('close', closed); }
  }
  // No path limiter: streamReply and streamSpeech count the account's AI call limit, which
  // aimeat_voice_reply and aimeat_voice_speak share.
  router.post('/v1/ai/stream', requireAuth(), requireScope('ai:use'), (req, res) => run(req, res, 'reply'));
  router.post('/v1/ai/speak', requireAuth(), requireScope('ai:use'), (req, res) => run(req, res, 'speech'));
}
