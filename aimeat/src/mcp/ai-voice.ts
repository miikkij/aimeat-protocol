/**
 * @file ai-voice.ts
 * @description Agent access to the same metered voice stages as browser streaming.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.1.0 - 2026-10-05 - The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *     A typed refusal answers `CODE: message` (RATE_LIMITED among them).
 *   v1.0.0 - 2026-09-19 - Text replies and private speech artifacts.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { streamReply, streamSpeech } from '../services/ai-voice.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { voiceReplySchema, voiceSpeechSchema } from '../models/ai-voice-contract.js';
import { createVoiceResult } from '../services/ai-voice-result.js';
import { aiCallerOfPrincipal } from '../services/ai/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { AiCompletionError } from '../services/ai/errors.js';

export function registerAiVoiceTools(mcp: McpServer, storage: Storage, config: AimeatConfig, getAgentGaii: () => string): void {
  const out = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
  // A typed refusal reads `CODE: message`, so the account's AI call limit answers
  // `RATE_LIMITED: …` here as on every other AI tool; anything else keeps its old shape.
  const failed = (error: unknown) => error instanceof AiCompletionError
    ? toolError(error.code, error.message)
    : ({ ...out({ error: (error as Error).message }), isError: true });
  mcp.tool('aimeat_voice_reply', descriptionFor('aimeat_voice_reply'), zodShapeFor('aimeat_voice_reply'),
    annotationsFor('aimeat_voice_reply'), async (input, extra) => {
      try {
        const result = createVoiceResult();
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(180000)]);
        await streamReply(storage, config, ownerGhiiOf(getAgentGaii()),
          { ...voiceReplySchema.parse(input), caller: aiCallerOfPrincipal(getAgentGaii()).caller }, signal, result.emit);
        return out(result.reply());
      } catch (error) { return failed(error); }
    });
  mcp.tool('aimeat_voice_speak', descriptionFor('aimeat_voice_speak'), zodShapeFor('aimeat_voice_speak'),
    annotationsFor('aimeat_voice_speak'), async (input, extra) => {
      try {
        const options = { ...voiceSpeechSchema.parse(input), caller: aiCallerOfPrincipal(getAgentGaii()).caller }, result = createVoiceResult();
        const owner = ownerGhiiOf(getAgentGaii());
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(180000)]);
        await streamSpeech(storage, config, owner, options, signal, result.emit);
        return out(await result.speech(storage, config, getAgentGaii(), options.response_format, signal));
      } catch (error) { return failed(error); }
    });
}
