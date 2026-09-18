/**
 * @file ai-voice.ts
 * @description Agent access to the same metered voice stages as browser streaming.
 * @version-history v1.0.0 - 2026-09-19 - Text replies and private speech artifacts.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { streamReply, streamSpeech } from '../services/ai-voice.js';
import { voiceReplySchema, voiceSpeechSchema } from '../services/ai-voice-contract.js';
import { createVoiceResult } from '../services/ai-voice-result.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerAiVoiceTools(mcp: McpServer, storage: Storage, config: AimeatConfig, getAgentGaii: () => string): void {
  const out = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
  const failed = (error: unknown) => ({ ...out({ error: (error as Error).message }), isError: true });
  mcp.tool('aimeat_voice_reply', descriptionFor('aimeat_voice_reply'), voiceReplySchema.shape,
    annotationsFor('aimeat_voice_reply'), async (input, extra) => {
      try {
        const result = createVoiceResult();
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(180000)]);
        await streamReply(storage, config, ownerGhiiOf(getAgentGaii()), voiceReplySchema.parse(input), signal, result.emit);
        return out(result.reply());
      } catch (error) { return failed(error); }
    });
  mcp.tool('aimeat_voice_speak', descriptionFor('aimeat_voice_speak'), voiceSpeechSchema.shape,
    annotationsFor('aimeat_voice_speak'), async (input, extra) => {
      try {
        const options = voiceSpeechSchema.parse(input), result = createVoiceResult();
        const owner = ownerGhiiOf(getAgentGaii());
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(180000)]);
        await streamSpeech(storage, config, owner, options, signal, result.emit);
        return out(await result.speech(storage, config, getAgentGaii(), options.response_format, signal));
      } catch (error) { return failed(error); }
    });
}
