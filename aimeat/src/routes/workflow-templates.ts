/**
 * @file src/routes/workflow-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three prompts the Workflows page hands to a person's own AI, served with the
 *   caller's name, node and workflow substituted in (prompt-defaults/workflows.ts holds the text;
 *   the same mechanism as the knowledge packager templates). The chat variant, for a chat with no
 *   MCP, carries the owner's agents and their workflow-compatible offers written into the prompt,
 *   because that chat cannot read them.
 * @structure
 *   - GET /v1/templates/workflow-improve-mcp?id=   improve one workflow over MCP
 *   - GET /v1/templates/workflow-create-mcp        make a new one over MCP
 *   - GET /v1/templates/workflow-create-chat       make a new one in a chat without MCP
 * @usage app.use(workflowTemplatesRouter(config, storage));
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
import { getWorkflow, readAgentOffers } from '../services/workflow/store.js';
import { loc } from '../services/workflow/engine-util.js';

/** The offers that can be a step, one line each, for the chat that cannot read them itself. */
async function agentsAndOffers(storage: Storage, config: AimeatConfig, ownerName: string): Promise<string> {
  const agents = (await storage.listAgents()).filter(a => a.owner === ownerName);
  const lines: string[] = [];
  for (const a of agents) {
    const offers = (await readAgentOffers(storage, config, ownerName, a.name))
      .filter(o => o.success_signal && o.required_to_function && o.deliverable?.location);
    for (const o of offers) {
      const key = (o.deliverable?.location as { key?: string } | undefined)?.key;
      const title = typeof o.title === 'string' ? o.title : loc(o.title as Parameters<typeof loc>[0]);
      lines.push(`- ${a.name} · ${o.id}: ${title || o.id}${key ? ` — writes ${key}` : ''}`);
    }
  }
  return lines.length ? lines.join('\n') : '(no agent of yours publishes a workflow-compatible offer yet: an offer needs a success_signal, a required_to_function and a deliverable location)';
}

export function workflowTemplatesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const nodeUrlOf = () => config.baseUrl || `http://localhost:${config.port}`;

  const serve = async (req: Request, res: Response, id: string, extra: Record<string, string>) => {
    const record = await storage.getSystemPrompt(id);
    if (!record || !record.active) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available'));
      return;
    }
    const content = resolvePromptContent(record, req.headers['accept-language'] as string);
    const owner = req.auth!.owner as string;
    const text = substituteVariables(content, { owner_name: owner, node_url: nodeUrlOf(), node_id: config.nodeId, ...extra });
    res.json(success(config.nodeId, { prompt: text, ghii: owner, node_url: nodeUrlOf(), node_id: config.nodeId }));
  };

  // GET /v1/templates/workflow-improve-mcp?id=<workflow id>
  router.get('/v1/templates/workflow-improve-mcp', requireAuth(), async (req: Request, res: Response) => {
    const id = String(req.query.id ?? '').trim();
    if (!id) { res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Say which workflow: pass its id as ?id=')); return; }
    const def = await getWorkflow(storage, `${req.auth!.owner}@${config.nodeId}`, id);
    if (!def) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Workflow "${id}" not found`)); return; }
    await serve(req, res, 'workflow-improve-mcp', { workflow_id: id, workflow_title: loc(def.title) || id });
  });

  // GET /v1/templates/workflow-create-mcp
  router.get('/v1/templates/workflow-create-mcp', requireAuth(), async (req: Request, res: Response) => {
    await serve(req, res, 'workflow-create-mcp', {});
  });

  // GET /v1/templates/workflow-create-chat — the agents and offers ride inside the prompt
  router.get('/v1/templates/workflow-create-chat', requireAuth(), async (req: Request, res: Response) => {
    await serve(req, res, 'workflow-create-chat', { agents_and_offers: await agentsAndOffers(storage, config, req.auth!.owner as string) });
  });

  return router;
}
