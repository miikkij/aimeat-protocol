/**
 * @file src/routes/prompts-agent-handbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/agents/me/handbook: an agent's operating handbook in one answer. The tier-1
 *   system prompt with the caller's own values filled in, its directives, its task queue with the
 *   task endpoints, where to report capabilities, and where its messages are.
 *
 *   THE TASK QUEUE IS THE CALLER'S OWN, AND A STOPPED AGENT'S HAS NOTHING THAT WAITS. The handbook
 *   is an agent's first read, so it is one of the reads a stopped agent is held on
 *   (services/agent-stop-rules.ts): the queued list is empty and `agent_stopped: true` says why.
 *   The tasks it is already doing are listed.
 * @structure registerAgentHandbook(router, config, storage)
 * @usage registerAgentHandbook(router, config, storage);   // AFTER /v1/agents/me/handbook/:module
 * @version-history
 *   v1.0.0 — 2026-10-11 — Moved out of prompts.ts (max-file-lines), with two changes: the task queue
 *     names no `wait` endpoint, because the long poll is removed, and a stopped agent's queue
 *     lists no queued task and says `agent_stopped`.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { isStopped } from '../services/agent-stop-rules.js';

export function registerAgentHandbook(router: Router, config: AimeatConfig, storage: Storage): void {
  // GET /v1/agents/me/handbook -- Agent operating handbook
  router.get('/v1/agents/me/handbook', async (req, res) => {
    const gaii = req.auth?.sub ?? 'unknown';
    const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
    const record = await storage.getSystemPrompt('tier-1');
    if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Handbook not available')); return; }
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const parsedSelf = parseGaiiLoose(gaii);
    const selfAgentName = parsedSelf.agent || 'unknown';
    const system_prompt = substituteVariables(promptContent, {
      node_url: config.baseUrl,
      node_id: config.nodeId,
      gaii,
      agent_name: selfAgentName,
      owner_name: req.auth?.owner ?? 'unknown',
      trust_score: agent?.trustScore ?? 50,
      morsel_balance: agent?.morselBalance ?? 0,
      daily_allowance: config.dailyAllowance,
    });
    const directives = gaii !== 'unknown' ? await storage.getAgentDirectives(gaii) : null;
    const ownerGhii = req.auth?.owner ? `${req.auth.owner}@${config.nodeId}` : '';
    const ownerDefaults = ownerGhii ? await storage.getOwnerAgentDefaults(ownerGhii) : null;
    // One the owner has stopped is told about the work it is doing and about nothing that waits.
    const stopped = isStopped(agent);
    const queuedTasks = gaii !== 'unknown' && !stopped ? await storage.listAgentTasks(gaii, { status: 'queued' }) : { tasks: [], total: 0 };
    const activeTasks = gaii !== 'unknown' ? await storage.listAgentTasks(gaii, { status: 'active' }) : { tasks: [], total: 0 };
    const parsed = parseGaiiLoose(gaii);
    const agentName = parsed.agent || '{name}';

    res.json(success(config.nodeId, {
      tier: '1',
      agent_name: selfAgentName,
      system_prompt,
      available_operations: ['memory_crud', 'action_publish', 'action_execute', 'work_queue', 'wallet', 'boards', 'catalogue', 'task_lifecycle', 'directives', 'capabilities_report', 'message_handling'],
      economics: {
        note: 'Agents share the owner\'s wallet. This balance belongs to your owner, not you individually.',
        daily_allowance: config.dailyAllowance,
        current_balance: ownerGhii ? (await storage.getGHIIByOwner(req.auth?.owner as string))?.morselBalance ?? 0 : 0,
      },
      directives: {
        purpose: directives?.purpose ?? '',
        system_rules: config.agentSystemPrinciples.map((desc, i) => ({ id: `system-${i + 1}`, description: desc })),
        owner_rules: (ownerDefaults?.rules ?? []).map(r => ({ id: r.id, description: r.description })),
        agent_rules: (directives?.rules ?? []).map(r => ({ id: r.id, description: r.description })),
        memory_areas: directives?.memoryAreas ?? [],
        resources: directives?.resources ?? [],
        max_tokens_per_task: config.agentMaxTokensPerTask,
        mandatory_logging: config.agentMandatoryLogging,
        aimeat_first: config.agentAimeatFirstEnabled,
      },
      task_queue: {
        queued: queuedTasks.tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
        active: activeTasks.tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
        endpoints: {
          inbox: `/v1/agents/${encodeURIComponent(agentName)}/inbox`,
          event: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/event`,
          complete: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/complete`,
          fail: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/fail`,
        },
        ...(stopped ? { agent_stopped: true } : {}),
      },
      capabilities: {
        report_endpoint: `/v1/agents/${encodeURIComponent(agentName)}/capabilities`,
        current: {
          technical: agent?.technicalCapabilities ?? [],
          domain: agent?.domainCapabilities ?? [],
        },
        instructions: 'Report your capabilities on first connect and when they change. PUT to the report_endpoint with: { technical: [{ name, type }], domain: [string], languages: [string] }',
      },
      messages: {
        inbox_endpoint: `GET ${config.baseUrl}/v1/agents/${encodeURIComponent(agentName)}/messages/inbox`,
        send_endpoint: `POST ${config.baseUrl}/v1/agents/${encodeURIComponent(agentName)}/messages`,
        instructions: 'Poll inbox for pending messages. For each: read content, process, send response as outbound message. If user asks you to do something, include proposedTask in metadata.',
      },
    }));
  });
}
