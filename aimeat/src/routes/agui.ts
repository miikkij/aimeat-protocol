/**
 * @file src/routes/agui.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AG-UI door: a web front end watches one of this owner's agents work.
 *
 *     POST /v1/agui/:owner/:agent      run: create the work and stream it as AG-UI events
 *     GET  /v1/agui/:owner/:agent/:taskId   watch: stream a task that already exists
 *
 *   THE THIRD DOOR ONTO THE SAME WORK. A2A is another agent talking to ours, ACP is an editor, this
 *   is a browser. All three land in the same V5 ops and read the same row. Nothing here stores
 *   anything, and a task created at this door is in the fleet listing like any other.
 *
 *   SSE, WHICH THIS NODE ALREADY DOES. AG-UI is a stream of events over server-sent events, and the
 *   headers below are the same ones /v1/events uses. The one addition is `X-Accel-Buffering: no`,
 *   because a proxy that buffers an event stream turns a live view into a long pause followed by
 *   everything at once.
 *
 *   AUTHENTICATED, AND FENCED TO THE ACCOUNT, exactly as the A2A door is: the caller must be a
 *   principal of the agent's own owner. A browser reaches this with the session it already has.
 *
 * @structure aguiRouter(config, storage)
 * @usage app.use(aguiRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6d).
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { error } from '../middleware/envelope.js';
import { buildGAII } from '../utils/gaii.js';
import { createTask } from '../services/agent-v2-tasks-ops.js';
import { streamTaskAsAgui } from '../services/agui-run.js';
import type { Principal } from '../services/agent-v2-messaging-ops.js';
import { logger } from '../utils/logger.js';

/** The message parts of an AG-UI run input, as parts this node stores. */
function partsFromMessages(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) return [];
  const parts: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    const msg = m as { role?: string; content?: unknown };
    // Only the user's turns become the ask. An assistant turn in the input is the front end
    // replaying its own history, and filing that as new work would ask the agent to redo it.
    if (msg?.role !== 'user') continue;
    if (typeof msg.content === 'string' && msg.content.trim() !== '') {
      parts.push({ kind: 'text', text: msg.content });
    }
  }
  return parts;
}

export function aguiRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  async function findAgent(req: Request): Promise<AgentRecord | null> {
    const owner = req.params.owner as string;
    const name = req.params.agent as string;
    if (!owner || !name) return null;
    return storage.getAgent(buildGAII(name, owner, config.nodeId));
  }

  /** The SSE headers, and the flush that makes a browser start reading before the first event. */
  function openStream(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // A proxy that buffers an event stream turns a live view into one long pause.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
  }

  /** Pump a run to the client until it ends or the client leaves. */
  async function pump(
    res: Response, req: Request, auth: Principal, taskId: string, threadId: string, runId: string,
  ): Promise<void> {
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    try {
      for await (const event of streamTaskAsAgui({ storage, auth, taskId, threadId, runId, signal: controller.signal })) {
        if (controller.signal.aborted) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      logger.warn('agui: the run ended badly', { taskId, error: String(err) });
      // The stream is already open, so the only way to say anything is in the stream itself.
      if (!controller.signal.aborted) {
        res.write(`data: ${JSON.stringify({ type: 'RUN_ERROR', message: 'The run stopped unexpectedly.', code: 'INTERNAL' })}\n\n`);
      }
    } finally {
      res.end();
    }
  }

  // ── POST — ask, and watch what happens ──
  router.post('/v1/agui/:owner/:agent', requireAuth(), requireScope('task:write'), async (req, res) => {
    const agent = await findAgent(req);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent of that name on this node.'));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This stream answers to principals of the agent\'s own account.'));
      return;
    }

    const auth: Principal = { sub: req.auth!.sub, owner: req.auth!.owner, roles: req.auth!.roles ?? [] };
    const body = (req.body ?? {}) as { threadId?: string; runId?: string; messages?: unknown };
    const parts = partsFromMessages(body.messages);
    if (parts.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_RUN',
        'A run needs at least one user message with text in it.'));
      return;
    }

    // AG-UI's thread is a conversation, which is what a contextId is; the front end names it, and
    // one that does not gets a fresh conversation rather than everybody sharing one.
    const threadId = body.threadId && body.threadId.trim() !== '' ? body.threadId : randomUUID();
    const runId = body.runId && body.runId.trim() !== '' ? body.runId : randomUUID();

    const created = await createTask(storage, config, auth, {
      assignedTo: agent.gaii,
      contextId: threadId,
      input: parts,
      metadata: { source: 'ag-ui', threadId, runId },
    });
    if (!created.ok) {
      res.status(created.status).json(error(config.nodeId, created.code, created.message, undefined, created.details));
      return;
    }

    openStream(res);
    await pump(res, req, auth, created.value.taskId, threadId, runId);
  });

  // ── GET — watch work that already exists ──
  //
  // A browser that reloaded, or a second screen. No scope: it is a read, and the task reads beside
  // it on /v1/agents/v2/tasks are ungated for the same reason — the owner is not a parameter.
  router.get('/v1/agui/:owner/:agent/:taskId', requireAuth(), async (req, res) => {
    const agent = await findAgent(req);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent of that name on this node.'));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This stream answers to principals of the agent\'s own account.'));
      return;
    }
    const auth: Principal = { sub: req.auth!.sub, owner: req.auth!.owner, roles: req.auth!.roles ?? [] };
    const taskId = req.params.taskId as string;
    const task = await storage.getAgentV2Task(auth.owner, taskId);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such task on this account.'));
      return;
    }

    openStream(res);
    await pump(res, req, auth, taskId, task.contextId, randomUUID());
  });

  return router;
}
