/**
 * @file src/routes/mail-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompt the Email page hands to a person's own AI, served with the caller's name
 *   and node substituted in (prompt-defaults/email.ts holds the text; the same mechanism as the
 *   contacts, workflow and knowledge templates).
 * @structure
 *   - GET /v1/templates/email-mcp   search, read and send mail from a chat connected over MCP
 * @usage app.use(mailTemplatesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';

export function mailTemplatesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const nodeUrlOf = () => config.baseUrl || `http://localhost:${config.port}`;

  // GET /v1/templates/email-mcp
  router.get('/v1/templates/email-mcp', requireAuth(), async (req: Request, res: Response) => {
    const record = await storage.getSystemPrompt('email-mcp');
    if (!record || !record.active) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available'));
      return;
    }
    const content = resolvePromptContent(record, req.headers['accept-language'] as string);
    const owner = req.auth!.owner as string;
    const text = substituteVariables(content, { owner_name: owner, node_url: nodeUrlOf(), node_id: config.nodeId });
    res.json(success(config.nodeId, { prompt: text, ghii: owner, node_url: nodeUrlOf(), node_id: config.nodeId }));
  });

  return router;
}
