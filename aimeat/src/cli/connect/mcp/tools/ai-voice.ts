/**
 * @file ai-voice.ts
 * @description Connector voice tools share the node's schemas and JSON delivery routes.
 * @version-history
 *   v1.1.0 - 2026-10-05 - The input schemas are the catalog's: zodShapeFor(name), whose fields take their
 *     exact schemas from models/ai-voice-contract.ts (secaudit 2026-10, M3).
 *   v1.0.0 - 2026-09-19 - Reply and private speech artifact delivery.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';
import { voiceReplySchema, voiceSpeechSchema } from '../../../../models/ai-voice-contract.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';

export function registerAiVoiceTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (response: { data?: unknown; ok?: boolean }) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(response.data ?? response) }],
    ...(response.ok === false ? { isError: true } : {}),
  });
  mcp.tool('aimeat_voice_reply', descriptionFor('aimeat_voice_reply'), zodShapeFor('aimeat_voice_reply'),
    annotationsFor('aimeat_voice_reply'), async input => out(await client.post('/v1/ai/stream?json=1', voiceReplySchema.parse(input))));
  mcp.tool('aimeat_voice_speak', descriptionFor('aimeat_voice_speak'), zodShapeFor('aimeat_voice_speak'),
    annotationsFor('aimeat_voice_speak'), async input => out(await client.post('/v1/ai/speak?json=1', voiceSpeechSchema.parse(input))));
}
