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
 *   2026-10-08 — aimeat_ai_transcribe names the transcript's provenance record: provenance_id and record_url.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.3.0 — 2026-09-30 — aimeat_ai_transcribe answers `classification_warnings` when the audio is
 *     warning-classified, as POST /v1/ai/transcribe does (TARGET-082 review, item 2); audio no model
 *     may read answers `CLASSIFIED: …` rather than a thrown error.
 *   v1.2.0 — 2026-09-29 — aimeat_ai_transcribe reads the audio with the agent's classification reader (TARGET-082).
 *   v1.1.0 — 2026-09-28 — aimeat_ai_transcribe and aimeat_ai_embed take `role`, the AI role the call runs as.
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V5).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { aiCapabilitiesView } from '../services/ai/capabilities.js';
import { queryModels } from '../services/ai/catalog/query.js';
import { transcribeForOwner } from '../services/ai-transcription.js';
import { embedForOwner } from '../services/ai-embed.js';
import { readCallerAudio } from '../services/ai/call-files.js';
import { readerForAgent, warningsNote } from '../services/classification/reader.js';
import { ClassificationError } from '../services/classification/labels.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { recordUrlFor } from '../services/ai-provenance-marks.js';

export function registerAiCapabilityTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const refusal = (e: unknown) => {
    if (e instanceof AiCompletionError || e instanceof ClassificationError) return toolError(e.code, e.message);
    throw e;
  };
  /** The payer, the agent when the principal is one, and the caller as the owner's policy names it. */
  const who = () => {
    const { payer, agent } = aiPayerOf(getAgentGaii());
    return { payer, ...(agent ? { agent } : {}), caller: (agent ? 'agent' : 'owner') as 'agent' | 'owner' };
  };

  mcp.tool('aimeat_ai_capabilities', descriptionFor('aimeat_ai_capabilities'), zodShapeFor('aimeat_ai_capabilities'), annotationsFor('aimeat_ai_capabilities'), async ({ app_id }) => {
    const w = who();
    try {
      return text(await aiCapabilitiesView(storage, config, w.payer, {
        caller: w.caller, ...(w.agent ? { agent: w.agent } : {}), ...(app_id ? { appId: app_id } : {}),
      }));
    } catch (e) { return refusal(e); }
  });

  mcp.tool('aimeat_ai_models', descriptionFor('aimeat_ai_models'), zodShapeFor('aimeat_ai_models'), annotationsFor('aimeat_ai_models'), async ({ capability, type, status, allowed }) => {
    try {
      return text(await queryModels(storage, config, who(), {
        ...(capability ? { capability } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}), allowed: allowed === true,
      }));
    } catch (e) { return refusal(e); }
  });

  mcp.tool('aimeat_ai_transcribe', descriptionFor('aimeat_ai_transcribe'), zodShapeFor('aimeat_ai_transcribe'), annotationsFor('aimeat_ai_transcribe'), async ({ storage_key, filename, language, model, provider, app_id, role }) => {
    const w = who();
    try {
      // The caller's own storage, never another namespace: the lookup /v1/ai/transcribe makes.
      const reader = readerForAgent({ storage, config }, getAgentGaii());
      const audio = await readCallerAudio(storage, reader, getAgentGaii(), storage_key, { ...(filename ? { filename } : {}) });
      if (!audio) return toolError('NOT_FOUND', 'No such file in your storage.');
      const r = await transcribeForOwner(storage, config, w.payer, {
        audio,
        ...(language ? { language } : {}), ...(model ? { model } : {}), ...(provider ? { provider } : {}),
        ...(role ? { role } : {}),
        ...(app_id ? { appId: app_id } : {}), caller: w.caller, ...(w.agent ? { agent: w.agent } : {}),
      });
      return text({
        text: r.text, model: r.model, language: r.language ?? null, seconds: r.seconds, route: r.route,
        usage: { cost_usd: r.usage.costUsd, cost_exact: r.usage.costExact },
        // The record minted for the transcript: attach it (ai_provenance_id) where the text is written.
        ...(r.provenance ? { provenance_id: r.provenance.id, record_url: recordUrlFor(config, r.provenance.id) } : {}),
        ...warningsNote(reader),
      });
    } catch (e) { return refusal(e); }
  });

  mcp.tool('aimeat_ai_embed', descriptionFor('aimeat_ai_embed'), zodShapeFor('aimeat_ai_embed'), annotationsFor('aimeat_ai_embed'), async ({ input, model, provider, app_id, role }) => {
    const w = who();
    try {
      const r = await embedForOwner(storage, config, w.payer, {
        input, ...(model ? { model } : {}), ...(provider ? { provider } : {}), ...(app_id ? { appId: app_id } : {}),
        ...(role ? { role } : {}),
        caller: w.caller, ...(w.agent ? { agent: w.agent } : {}),
      });
      return text({
        embeddings: r.embeddings, model: r.model, dimensions: r.dimensions, route: r.route,
        usage: { prompt_tokens: r.usage.promptTokens, cost_usd: r.usage.costUsd, cost_exact: r.usage.costExact },
      });
    } catch (e) { return refusal(e); }
  });
}
