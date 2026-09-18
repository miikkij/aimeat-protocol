/**
 * @file tool-call-defs-ai-voice.ts
 * @description CLI voice dispatch forwards every declared field; server validates the shared contract.
 * @version-history v1.0.0 - 2026-09-19 - Third voice tool surface.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { voiceTools as catalog } from '../../mcp/catalog/definitions/ai-voice.js';

export const voiceTools: ConnectCliToolDefinition[] = [
  { ...catalog[0], handler: ({ client }, input) => client.post('/v1/ai/stream?json=1', input) },
  { ...catalog[1], handler: ({ client }, input) => client.post('/v1/ai/speak?json=1', input) },
];
