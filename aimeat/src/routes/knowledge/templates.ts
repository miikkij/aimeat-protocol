/**
 * @file src/routes/knowledge/templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Prompt-template routes served alongside knowledge packages —
 *   knowledge-packager (human/agent) and chat-session (human/quick). Extracted from
 *   src/routes/knowledge.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { substituteVariables, resolvePromptContent } from '../../services/prompt-variables.js';
import type { KnowledgeHelpers } from './helpers.js';

export function registerTemplateRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  helpers: KnowledgeHelpers,
): void {
  const { resolve } = helpers;

  /* ── GET /v1/templates/knowledge-packager-human — Get human prompt template ── */
  router.get('/v1/templates/knowledge-packager-human', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;

    const record = await storage.getSystemPrompt('knowledge-packager-human');
    if (!record || !record.active) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available'));
    }
    const content = resolvePromptContent(record, req.headers['accept-language'] as string);
    const text = substituteVariables(content, {
      owner_name: ghii,
      node_url: nodeUrl,
      node_id: config.nodeId,
      gaii: resolve(req),
    });

    res.json(success(config.nodeId, { prompt: text, ghii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  /* ── GET /v1/templates/knowledge-packager-agent — Get agent prompt template ── */
  router.get('/v1/templates/knowledge-packager-agent', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const gaii = resolve(req);
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;

    const record = await storage.getSystemPrompt('knowledge-packager-agent');
    if (!record || !record.active) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available'));
    }
    const content = resolvePromptContent(record, req.headers['accept-language'] as string);
    const text = substituteVariables(content, {
      owner_name: ghii,
      node_url: nodeUrl,
      node_id: config.nodeId,
      gaii,
    });

    res.json(success(config.nodeId, { prompt: text, ghii, gaii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  /* ── GET /v1/templates/chat-session-human — Get chat session human prompt ── */
  router.get('/v1/templates/chat-session-human', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;
    const record = await storage.getSystemPrompt('chat-session-human');
    if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const text = substituteVariables(promptContent, { node_url: nodeUrl, node_id: config.nodeId, owner_name: ghii });
    res.json(success(config.nodeId, { prompt: text, ghii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  /* ── GET /v1/templates/chat-session-quick — Get quick session prompt (paste into any AI) ── */
  router.get('/v1/templates/chat-session-quick', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;
    const record = await storage.getSystemPrompt('chat-session-quick');
    if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const text = substituteVariables(promptContent, { node_url: nodeUrl, node_id: config.nodeId, owner_name: ghii });
    res.json(success(config.nodeId, { prompt: text, ghii, node_url: nodeUrl, node_id: config.nodeId }));
  });
}
