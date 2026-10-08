/**
 * @file ai-voice.ts
 * @description Agent access to the same metered voice stages as browser streaming.
 * @version-history
 *   2026-10-08 — The reply and the speech pass the agent that asked (aiPayerOf), as completions do.
 *   v1.2.0 - 2026-10-08 - Every failure is `CODE: message`: INVALID_BODY for input that does not parse,
 *     INTERNAL_ERROR for the node's own failure, where both were `{"error": …}` without a code (aiprov
 *     plan, A11). The speech result carries `audio` (sample rate, channels, sample format) (A4).
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
import { nodeFailureOf } from '../services/ai/errors.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { z } from 'zod';

export function registerAiVoiceTools(mcp: McpServer, storage: Storage, config: AimeatConfig, getAgentGaii: () => string): void {
  // The agent that asked, by bare name: its own key pays first, its cap applies, the record names it.
  const agentOf = (): { agent?: string } => { const { agent } = aiPayerOf(getAgentGaii()); return agent ? { agent } : {}; };
  const out = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
  // Every failure reads `CODE: message` with the code POST /v1/ai/stream and /speak answer: a typed
  // refusal its own (RATE_LIMITED, PROVIDER_REJECTED…), an input that does not parse INVALID_BODY,
  // anything else the node's INTERNAL_ERROR. The last two were `{"error": …}` with no code (aiprov plan, A11).
  const failed = (error: unknown) => {
    if (error instanceof z.ZodError) return toolError('INVALID_BODY', error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '));
    const f = nodeFailureOf(error, 'aimeat_voice tool');
    return toolError(f.code, f.message);
  };
  mcp.tool('aimeat_voice_reply', descriptionFor('aimeat_voice_reply'), zodShapeFor('aimeat_voice_reply'),
    annotationsFor('aimeat_voice_reply'), async (input, extra) => {
      try {
        const result = createVoiceResult();
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(180000)]);
        await streamReply(storage, config, ownerGhiiOf(getAgentGaii()),
          { ...voiceReplySchema.parse(input), caller: aiCallerOfPrincipal(getAgentGaii()).caller, ...agentOf() }, signal, result.emit);
        return out(result.reply());
      } catch (error) { return failed(error); }
    });
  mcp.tool('aimeat_voice_speak', descriptionFor('aimeat_voice_speak'), zodShapeFor('aimeat_voice_speak'),
    annotationsFor('aimeat_voice_speak'), async (input, extra) => {
      try {
        const options = { ...voiceSpeechSchema.parse(input), caller: aiCallerOfPrincipal(getAgentGaii()).caller, ...agentOf() }, result = createVoiceResult();
        const owner = ownerGhiiOf(getAgentGaii());
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(180000)]);
        await streamSpeech(storage, config, owner, options, signal, result.emit);
        return out(await result.speech(storage, config, getAgentGaii(), options.response_format, signal));
      } catch (error) { return failed(error); }
    });
}
