/**
 * @file src/cli/connect/acp/agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An AIMEAT agent, presented to a code editor over the Agent Client Protocol.
 *
 *   WHAT AN EDITOR GETS. Zed and the editors following it spawn a process and speak ACP to it over
 *   stdio. This is that process: an editor's prompt becomes work assigned to one of the owner's
 *   AIMEAT agents, and what that agent reports comes back as session updates the editor renders in
 *   its own chat. The editor never learns anything about AIMEAT.
 *
 *   IT IS THE V5 TASK, NOT A SECOND ONE. `session/prompt` creates a task through the node's own
 *   door and then WATCHES it: the same row the fleet page shows, the same row A2A reads, settled by
 *   whichever runtime the owner has running. There is no model call here and no agent loop — this
 *   file is a translator between an editor's expectations and work somebody else does.
 *
 *   WHICH MEANS THE PROMPT BLOCKS. An editor sends text, images, audio and resource links. Text and
 *   resource links map onto the parts a v2 message carries; an image or an audio block does not,
 *   because a part on this node carries a pointer rather than bytes, and it is named in the answer
 *   rather than dropped — an editor that silently loses an attachment is worse than one that is
 *   told the attachment did not travel.
 *
 *   POLLING, AND SAYING SO. The node tells a CONNECTED principal about a task move over the tunnel;
 *   this process is not that principal, so it polls. The interval is the task's own
 *   `pollIntervalMs` when it has one, which is the field MCP put there for exactly this.
 *
 * @structure buildAimeatAcpAgent(deps) — initialize · session/new · session/prompt · session/cancel
 * @usage const app = buildAimeatAcpAgent({ client, agentGaii, nodeLabel }); app.connect(stream);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6b).
 */
import { randomUUID } from 'node:crypto';
import {
  agent, PROTOCOL_VERSION,
  type AgentApp, type ContentBlock, type InitializeResponse, type NewSessionResponse,
  type PromptResponse, type StopReason,
} from '@agentclientprotocol/sdk';
import type { AimeatClient } from '../api-client.js';

/** What this ACP process needs to do its job. */
export interface AcpAgentDeps {
  /** An authenticated client for the node, from the connector's own registry. */
  client: AimeatClient;
  /** The AIMEAT agent an editor's work is assigned to. */
  agentGaii: string;
  /** What to call this in an editor's UI. */
  agentLabel: string;
  /** The node, for the one line an editor shows about where the work went. */
  nodeLabel: string;
}

/** One editor session: an AIMEAT exchange, and whatever task is currently running in it. */
interface AcpSession {
  contextId: string;
  cwd: string;
  /** The task `session/prompt` is watching, so `session/cancel` knows what to stop. */
  activeTaskId: string | null;
  /** Set by `session/cancel`; the poll loop reads it and stops. */
  cancelled: boolean;
}

/** How often to look at a task that did not say how often to look at it. */
const DEFAULT_POLL_MS = 2000;
/** The longest one prompt will wait before handing the editor back its turn. */
const MAX_WAIT_MS = 30 * 60 * 1000;

/**
 * An editor's prompt as v2 message parts, plus the blocks that could not travel.
 *
 * An image or audio block is REPORTED rather than dropped: a part on this node carries a pointer,
 * and an editor whose attachment vanished with a successful-looking answer has been lied to.
 */
export function partsFromPrompt(prompt: ContentBlock[]): {
  parts: Array<Record<string, unknown>>;
  skipped: string[];
} {
  const parts: Array<Record<string, unknown>> = [];
  const skipped: string[] = [];
  for (const block of prompt) {
    if (block.type === 'text') {
      parts.push({ kind: 'text', text: block.text });
    } else if (block.type === 'resource_link') {
      parts.push({ kind: 'file', file: { uri: block.uri, name: block.name, mimeType: block.mimeType } });
    } else if (block.type === 'resource') {
      const resource = block.resource as { uri?: string; text?: string; mimeType?: string };
      if (typeof resource?.text === 'string') {
        // An embedded text resource IS text as far as the work is concerned; keeping its address
        // in the part's metadata is what lets the answer refer to the file it came from.
        parts.push({ kind: 'text', text: resource.text, metadata: { uri: resource.uri } });
      } else if (resource?.uri) {
        parts.push({ kind: 'file', file: { uri: resource.uri, mimeType: resource.mimeType } });
      } else {
        skipped.push('an embedded resource with neither text nor an address');
      }
    } else {
      skipped.push(`${block.type} content`);
    }
  }
  return { parts, skipped };
}

/** What the editor should be told a task's state means, in one line. */
function lineFor(task: { status: string; statusMessage?: string | null; error?: { message?: string } | null }): string {
  if (task.statusMessage) return task.statusMessage;
  switch (task.status) {
    case 'working': return 'Working on it.';
    case 'input_required': return 'It needs something from you before it can go on.';
    case 'completed': return 'Done.';
    case 'failed': return task.error?.message ?? 'It could not finish.';
    case 'cancelled': return 'Stopped.';
    default: return task.status;
  }
}

/** A terminal task hands the editor its turn back, and the reason it gets is the state. */
function stopReasonFor(status: string): StopReason {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'refusal';
  return 'end_turn';
}

export function buildAimeatAcpAgent(deps: AcpAgentDeps): AgentApp {
  const sessions = new Map<string, AcpSession>();

  return agent({ name: `aimeat:${deps.agentLabel}` })
    .onRequest('initialize', (): InitializeResponse => ({
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: `AIMEAT ${deps.agentLabel}`, version: '1.0.0' },
      agentCapabilities: {
        // A session here is an AIMEAT exchange and it outlives this process, but loading one back
        // needs a `session/load` that replays its turns, and that is not written. Saying false is
        // what stops an editor from asking.
        loadSession: false,
        promptCapabilities: {
          // Text and links travel; bytes do not, for the reason in the file header.
          image: false,
          audio: false,
          embeddedContext: true,
        },
      },
      // The connector is already holding a credential for this agent — that is how this process
      // reached the node at all — so there is nothing for the editor to authenticate.
      authMethods: [],
    }))

    .onRequest('authenticate', () => ({}))

    .onRequest('session/new', (ctx): NewSessionResponse => {
      const sessionId = randomUUID();
      sessions.set(sessionId, {
        // The ACP session and the AIMEAT exchange are the same thing, so they share an id: every
        // turn and every task from this editor session reads back under one contextId.
        contextId: sessionId,
        cwd: ctx.params.cwd,
        activeTaskId: null,
        cancelled: false,
      });
      return { sessionId };
    })

    /**
     * The editor's turn. Creates the work, then watches it and narrates.
     *
     * It does NOT answer as soon as the task is created. An editor's prompt is a turn in a
     * conversation and it ends when there is something to read, so this holds the turn open until
     * the task settles or the editor cancels — narrating each move as a session update so the
     * person is not looking at a spinner with nothing behind it.
     */
    .onRequest('session/prompt', async (ctx): Promise<PromptResponse> => {
      const session = sessions.get(ctx.params.sessionId);
      if (!session) {
        await ctx.client.notify('session/update', {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'That session is not one this process knows. Start a new one.' },
          },
        });
        return { stopReason: 'refusal' };
      }
      session.cancelled = false;

      const { parts, skipped } = partsFromPrompt(ctx.params.prompt);
      if (parts.length === 0) {
        await say(ctx, session, 'There was nothing in that prompt this agent can act on.');
        return { stopReason: 'refusal' };
      }
      if (skipped.length > 0) {
        // Named, not dropped: an editor whose attachment vanished behind a successful answer has
        // been lied to.
        await say(ctx, session, `Sent without ${skipped.join(' and ')}: this node carries a file as a link rather than as bytes.`);
      }

      const created = await deps.client.post('/v1/agents/v2/tasks', {
        assignedTo: deps.agentGaii,
        contextId: session.contextId,
        input: parts,
        statusMessage: `From an editor, in ${session.cwd}`,
        metadata: { source: 'acp', cwd: session.cwd },
      });
      if (created.ok === false) {
        await say(ctx, session, `The node would not take the work: ${describeFailure(created)}`);
        return { stopReason: 'refusal' };
      }
      const task = (created.data as { task?: { taskId?: string; pollIntervalMs?: number | null } })?.task;
      const taskId = task?.taskId;
      if (!taskId) {
        await say(ctx, session, 'The node accepted the work but did not say what to call it.');
        return { stopReason: 'refusal' };
      }
      session.activeTaskId = taskId;
      await say(ctx, session, `Handed to ${deps.agentLabel} on ${deps.nodeLabel}. Task ${taskId}.`);

      const stop = await watchTask(ctx, session, taskId, task?.pollIntervalMs ?? null);
      session.activeTaskId = null;
      return { stopReason: stop };
    })

    /**
     * The editor asked to stop. The work is the node's, so the cancel is too: the same door a
     * caller uses, which refuses if the task has already settled — and a task that settled a moment
     * before the cancel is not an error, it is the answer arriving first.
     */
    .onNotification('session/cancel', async (ctx) => {
      const session = sessions.get(ctx.params.sessionId);
      if (!session) return;
      session.cancelled = true;
      if (!session.activeTaskId) return;
      await deps.client.post(`/v1/agents/v2/tasks/${encodeURIComponent(session.activeTaskId)}/cancel`, {
        reason: 'The editor stopped this turn.',
      });
    });

  /** One line into the editor's chat, as the agent. */
  async function say(
    ctx: { client: { notify: (m: string, p: unknown) => Promise<void> } },
    session: AcpSession, text: string,
  ): Promise<void> {
    await ctx.client.notify('session/update', {
      sessionId: [...sessions.entries()].find(([, s]) => s === session)?.[0],
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    });
  }

  /** Whatever the node said went wrong, in one line. */
  function describeFailure(resp: { data?: unknown; error?: { message?: string } }): string {
    return resp.error?.message
      ?? (typeof resp.data === 'object' && resp.data && 'error' in resp.data
        ? String((resp.data as { error?: { message?: string } }).error?.message ?? 'no reason given')
        : 'no reason given');
  }

  /**
   * Watch one task to its end, narrating each change.
   *
   * Polling rather than a socket: the node pushes task news to the CONNECTED principal, and this
   * process is not it — the connector daemon is. The task's own `pollIntervalMs` is the interval
   * when it has one, which is what MCP put that field there for.
   */
  async function watchTask(
    ctx: { client: { notify: (m: string, p: unknown) => Promise<void> }; signal: AbortSignal },
    session: AcpSession, taskId: string, pollMs: number | null,
  ): Promise<StopReason> {
    const started = Date.now();
    let lastLine = '';
    let interval = pollMs && pollMs > 0 ? Math.max(500, pollMs) : DEFAULT_POLL_MS;

    for (;;) {
      if (session.cancelled || ctx.signal.aborted) {
        await say(ctx, session, 'Stopped.');
        return 'cancelled';
      }
      if (Date.now() - started > MAX_WAIT_MS) {
        // The turn ends; the TASK does not. Saying where it is beats leaving the editor to believe
        // the work evaporated.
        await say(ctx, session, `Still running after thirty minutes, so I am handing your turn back. It is task ${taskId} and it keeps going.`);
        return 'max_turn_requests';
      }

      const read = await deps.client.get(`/v1/agents/v2/tasks/${encodeURIComponent(taskId)}`);
      const task = (read.data as { task?: Record<string, unknown> })?.task as
        | { status: string; statusMessage?: string | null; terminal?: boolean; error?: { message?: string } | null; result?: Array<{ text?: string }> | null; pollIntervalMs?: number | null }
        | undefined;
      if (!task) {
        await say(ctx, session, 'The node stopped answering about that task.');
        return 'refusal';
      }
      if (task.pollIntervalMs && task.pollIntervalMs > 0) interval = Math.max(500, task.pollIntervalMs);

      const line = lineFor(task);
      if (line !== lastLine) {
        await say(ctx, session, line);
        lastLine = line;
      }

      if (task.terminal) {
        for (const part of task.result ?? []) {
          if (part?.text) await say(ctx, session, part.text);
        }
        return stopReasonFor(task.status);
      }
      // `input_required` ends the turn rather than waiting: the thing it is waiting for is the
      // person, and the person cannot answer while their editor is still showing a running turn.
      if (task.status === 'input_required') return 'end_turn';

      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
}
