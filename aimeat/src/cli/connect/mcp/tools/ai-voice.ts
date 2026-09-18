/**
 * @file ai-voice.ts
 * @description Connector voice tools share the node's schemas and JSON delivery routes.
 * @version-history v1.0.0 - 2026-09-19 - Reply and private speech artifact delivery.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { voiceReplySchema, voiceSpeechSchema } from '../../../../services/ai-voice-contract.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAiVoiceTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (response: { data?: unknown; ok?: boolean }) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(response.data ?? response) }],
    ...(response.ok === false ? { isError: true } : {}),
  });
  mcp.tool('aimeat_voice_reply', descriptionFor('aimeat_voice_reply'), voiceReplySchema.shape,
    annotationsFor('aimeat_voice_reply'), async input => out(await client.post('/v1/ai/stream?json=1', voiceReplySchema.parse(input))));
  mcp.tool('aimeat_voice_speak', descriptionFor('aimeat_voice_speak'), voiceSpeechSchema.shape,
    annotationsFor('aimeat_voice_speak'), async input => out(await client.post('/v1/ai/speak?json=1', voiceSpeechSchema.parse(input))));
}
