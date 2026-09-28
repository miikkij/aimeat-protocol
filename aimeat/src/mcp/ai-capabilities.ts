/**
 * @file ai-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tools for what an AI can do on this node (System 2 plan, V5):
 *   aimeat_ai_capabilities, aimeat_ai_models, aimeat_ai_transcribe and aimeat_ai_embed.
 *
 *   They do no work of their own: aiCapabilitiesView(), queryModels(), transcribeForOwner() and
 *   embedForOwner() are the functions GET /v1/ai/capabilities, GET /v1/ai/models, POST
 *   /v1/ai/transcribe and POST /v1/ai/embed call. The audio file is looked up in the caller's own
 *   storage and the call is paid by the owner, in the agent's name, as the REST route does.
 * @structure registerAiCapabilityTools(mcp, storage, config, getAgentGaii)
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V5).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { aiCapabilitiesView } from '../services/ai/capabilities.js';
import { queryModels } from '../services/ai/catalog/query.js';
import { transcribeForOwner } from '../services/ai-transcription.js';
import { embedForOwner } from '../services/ai-embed.js';
import { readCallerAudio } from '../services/ai-call-files.js';

export function registerAiCapabilityTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const refusal = (e: unknown) => {
    if (e instanceof AiCompletionError) return toolError(e.code, e.message);
    throw e;
  };
  /** The payer, the agent when the principal is one, and the caller as the owner's policy names it. */
  const who = () => {
    const { payer, agent } = aiPayerOf(getAgentGaii());
    return { payer, ...(agent ? { agent } : {}), caller: (agent ? 'agent' : 'owner') as 'agent' | 'owner' };
  };

  mcp.tool('aimeat_ai_capabilities', descriptionFor('aimeat_ai_capabilities'), {
    app_id: z.string().optional().describe('The app you act for, when you do: its own model list and preferences count.'),
  }, annotationsFor('aimeat_ai_capabilities'), async ({ app_id }) => {
    const w = who();
    try {
      return text(await aiCapabilitiesView(storage, config, w.payer, {
        caller: w.caller, ...(w.agent ? { agent: w.agent } : {}), ...(app_id ? { appId: app_id } : {}),
      }));
    } catch (e) { return refusal(e); }
  });

  mcp.tool('aimeat_ai_models', descriptionFor('aimeat_ai_models'), {
    capability: z.string().optional().describe('text | vision | files | image | speech | transcription | embed.'),
    type: z.string().optional().describe('openrouter | openai | anthropic | xai | mistral | deepseek.'),
    status: z.string().optional().describe('Comma-separated: active, retiring, retired; or all. Default active,retiring.'),
    allowed: z.boolean().optional().describe('true: only the models you can use now.'),
  }, annotationsFor('aimeat_ai_models'), async ({ capability, type, status, allowed }) => {
    try {
      return text(await queryModels(storage, config, who(), {
        ...(capability ? { capability } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}), allowed: allowed === true,
      }));
    } catch (e) { return refusal(e); }
  });

  mcp.tool('aimeat_ai_transcribe', descriptionFor('aimeat_ai_transcribe'), {
    storage_key: z.string().describe('The audio file\'s key in your storage.'),
    filename: z.string().optional().describe('The file name the provider sees; its extension names the format. Defaults to the key\'s last part.'),
    language: z.string().optional().describe('ISO-639-1 hint (fi, en). Omit to let the model detect it.'),
    model: z.string().optional().describe('A model reference; omit to let the owner\'s providers choose.'),
    provider: z.string().optional().describe('A provider id or type to use, with no fallback.'),
    app_id: z.string().optional().describe('The app this is for, so its spend is attributed.'),
  }, annotationsFor('aimeat_ai_transcribe'), async ({ storage_key, filename, language, model, provider, app_id }) => {
    const w = who();
    try {
      // The caller's own storage, never another namespace: the lookup /v1/ai/transcribe makes.
      const audio = await readCallerAudio(storage, getAgentGaii(), storage_key, { ...(filename ? { filename } : {}) });
      if (!audio) return toolError('NOT_FOUND', 'No such file in your storage.');
      const r = await transcribeForOwner(storage, config, w.payer, {
        audio,
        ...(language ? { language } : {}), ...(model ? { model } : {}), ...(provider ? { provider } : {}),
        ...(app_id ? { appId: app_id } : {}), caller: w.caller, ...(w.agent ? { agent: w.agent } : {}),
      });
      return text({
        text: r.text, model: r.model, language: r.language ?? null, seconds: r.seconds, route: r.route,
        usage: { cost_usd: r.usage.costUsd, cost_exact: r.usage.costExact },
      });
    } catch (e) { return refusal(e); }
  });

  mcp.tool('aimeat_ai_embed', descriptionFor('aimeat_ai_embed'), {
    input: z.array(z.string()).min(1).describe('The texts, one vector each.'),
    model: z.string().optional().describe('A model reference; omit to let the owner\'s providers choose.'),
    provider: z.string().optional().describe('A provider id or type to use, with no fallback.'),
    app_id: z.string().optional().describe('The app this is for, so its spend is attributed.'),
  }, annotationsFor('aimeat_ai_embed'), async ({ input, model, provider, app_id }) => {
    const w = who();
    try {
      const r = await embedForOwner(storage, config, w.payer, {
        input, ...(model ? { model } : {}), ...(provider ? { provider } : {}), ...(app_id ? { appId: app_id } : {}),
        caller: w.caller, ...(w.agent ? { agent: w.agent } : {}),
      });
      return text({
        embeddings: r.embeddings, model: r.model, dimensions: r.dimensions, route: r.route,
        usage: { prompt_tokens: r.usage.promptTokens, cost_usd: r.usage.costUsd, cost_exact: r.usage.costExact },
      });
    } catch (e) { return refusal(e); }
  });
}
