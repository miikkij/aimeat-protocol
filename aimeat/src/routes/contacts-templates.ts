/**
 * @file src/routes/contacts-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompt the Contacts page hands to a person's own AI, served with the caller's
 *   name and node substituted in (prompt-defaults/contacts.ts holds the text; the same mechanism
 *   as the knowledge packager and workflow templates).
 * @structure
 *   - GET /v1/templates/contacts-mcp   keep the address book from a chat connected over MCP
 * @usage app.use(contactsTemplatesRouter(config, storage));
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

export function contactsTemplatesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const nodeUrlOf = () => config.baseUrl || `http://localhost:${config.port}`;

  // GET /v1/templates/contacts-mcp
  router.get('/v1/templates/contacts-mcp', requireAuth(), async (req: Request, res: Response) => {
    const record = await storage.getSystemPrompt('contacts-mcp');
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
