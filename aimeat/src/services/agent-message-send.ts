/**
 * @file agent-message-send.ts
 * @description THE write path for one agent-dashboard message — the agent↔owner chat the Messages
 *   subtab renders. Two doors reach it: POST /v1/agents/:name/messages and the MCP tool
 *   aimeat_message_send. Until this file existed each door built the record for itself, and the two
 *   copies had drifted in four ways:
 *     - the tool stamped `processedAt` at creation, the route left it unset (it is set by the status
 *       PATCH, which is what the field means);
 *     - the tool broadcast its live-update event to every connected owner, the route scoped it to
 *       the writer, so an agent sending over MCP woke every other owner's UI;
 *     - the tool notified the MCP resource URI `aimeat://messages/{thread}`, which no resource
 *       template serves, while the route and the task-lifecycle path both use
 *       `aimeat://agents/{name}/messages`;
 *     - the tool's metadata mapping never grew the option-prompt fields the route has carried since
 *       May, so a record written through MCP could not answer a question the UI had asked.
 *   That is what a second copy costs: a fix lands on one door and the other keeps the old behaviour.
 *   The same defect was fixed three separate times inside aimeat_memory_write before anyone noticed
 *   the two surfaces were different programs.
 *
 *   WHAT STAYS AT THE DOOR. Identity resolution, the access check and the "does this agent exist"
 *   404 belong to the surface — each has its own answer to give and its own way of saying it. So
 *   does rendering: this returns a refusal or the stored record and never touches an Express
 *   response.
 * @structure
 *   - AgentMessageSendDeps   — storage + config, plus the two push transports (webhook, MCP resource)
 *   - AgentMessageSendInput  — who is writing, into whose log, and the wire body
 *   - AgentMessageSendResult — a refusal or the stored record
 *   - sendAgentMessage()     — validate → build → mint provenance → store → side effects
 * @usage
 *   import { sendAgentMessage } from '../services/agent-message-send.js';
 *   const result = await sendAgentMessage(
 *     { storage, config, webhooks: webhookDispatcher, emitResourceUpdated },
 *     { agentGaii, senderGaii, body: req.body, pipeline: 'rest.agent_message_send' });
 *   if (!result.ok) { res.status(result.status).json(error(config.nodeId, result.code, result.message)); return; }
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from routes/agent-messages.ts and mcp/agent-messages.ts (August
 *     2026 MCP audit, step 8). Where the two copies disagreed the route's behaviour is the one kept:
 *     it is the copy with tests and users.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentMessageRecord } from '../storage/interface.js';
import { AgentMessageCreateSchema } from '../models/agent-message-schemas.js';
import { provenanceForWrite, type DeclaredProvenance } from './ai-provenance.js';
import { emitChange } from './event-bus.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import type { createWebhookDispatcher } from './webhook-dispatcher.js';
import { logger } from '../utils/logger.js';

export interface AgentMessageSendDeps {
  storage: Storage;
  config: AimeatConfig;
  /** Webhook fan-out for `message.inbound`. Absent on a door that has no dispatcher wired. */
  webhooks?: ReturnType<typeof createWebhookDispatcher>;
  /**
   * The MCP resource-updated transport (`emitResourceUpdated` from mcp/index.ts). Injected rather
   * than imported because mcp/index.ts imports the tool file that calls this service, and a service
   * that imports back into that module puts the two in a cycle. WHICH uri and WHEN are decided here,
   * so the transport is the only part a caller supplies.
   */
  emitResourceUpdated?: (agentGaii: string, uri: string) => void;
}

export interface AgentMessageSendInput {
  /** Whose message log this lands in. The surface has already checked the caller may write to it. */
  agentGaii: string;
  /**
   * The RESOLVED identity of the writer: the owner's GHII for an owner session, the agent's own GAII
   * for an agent one. Never a client-supplied id, and never a raw `req.auth!.sub` for an owner.
   */
  senderGaii: string;
  /** The wire body (snake_case), validated here against AgentMessageCreateSchema. */
  body: unknown;
  /** Which door the write came through, recorded as the provenance record's `generator.pipeline`. */
  pipeline: string;
  /** A provenance record the caller asked to attach. Checked against the caller's own account. */
  declaredProvenanceId?: string;
  /** What the caller stated about how the content was made. */
  declaredProvenance?: DeclaredProvenance;
}

export type AgentMessageSendResult =
  | { ok: true; message: AgentMessageRecord }
  | { ok: false; status: 400; code: 'INVALID_INPUT'; message: string };

/**
 * Create one agent message and fire what follows from it.
 *
 * Throws only what the provenance layer throws: a ProvenanceScopeError when a caller declares
 * provenance without holding `provenance:write`. That refusal is deliberate — a caller told its
 * declaration was accepted while the node recorded something else has been lied to by its own call.
 */
export async function sendAgentMessage(
  deps: AgentMessageSendDeps,
  input: AgentMessageSendInput,
): Promise<AgentMessageSendResult> {
  const { storage, config } = deps;

  const parsed = AgentMessageCreateSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  const body = parsed.data;
  const now = new Date().toISOString();

  // Thread = task: a message linked to a task with no explicit thread joins the task's thread, so a
  // task's whole conversation (the agent's clarifications, the owner's answers) stays in ONE thread
  // instead of spawning a fresh random one per message. A random thread is for ad-hoc, task-less chat.
  const threadId = body.thread_id ?? body.linked_task_id ?? randomUUID();

  const record: AgentMessageRecord = {
    id: randomUUID(),
    agentGaii: input.agentGaii,
    threadId,
    direction: body.direction,
    senderGaii: input.senderGaii,
    content: body.content,
    // The owner writes inbound (user → agent), which waits in the agent's inbox until it is picked
    // up; the agent writes outbound (agent → user), which is already in front of its reader.
    status: body.direction === 'inbound' ? 'pending' : 'delivered',
    linkedTaskId: body.linked_task_id,
    metadata: body.metadata ? {
      tokensUsed: body.metadata.tokens_used,
      processingMs: body.metadata.processing_ms,
      proposedTask: body.metadata.proposed_task,
      prompt: body.metadata.prompt ? {
        promptId: body.metadata.prompt.prompt_id,
        question: body.metadata.prompt.question,
        options: body.metadata.prompt.options,
        allowOther: body.metadata.prompt.allow_other,
      } : undefined,
      promptAnswer: body.metadata.prompt_answer ? {
        promptId: body.metadata.prompt_answer.prompt_id,
        choice: body.metadata.prompt_answer.choice,
        isOther: body.metadata.prompt_answer.is_other,
      } : undefined,
    } : undefined,
    createdAt: now,
    // TARGET-058. This message is delivered to a named person, which is what decides whether a label
    // is owed — not whether the world can read it. The record describes `content`; `metadata` is
    // machine plumbing (token counts, a proposed task) and stays outside the hash. An OWNER writing
    // here is not stamped as model-written: provenanceForWrite decides that from the principal, which
    // is why the call is unconditional and carries no direction test.
    aiProvenanceId: await provenanceForWrite(storage, {
      principal: input.senderGaii,
      content: body.content,
      declaredId: input.declaredProvenanceId,
      declared: input.declaredProvenance,
      pipeline: input.pipeline,
      surface: { visibility: 'private', humanAudience: true },
      labelPolicy: config.aiLabelPublic,
      nodeId: config.nodeId,
      baseUrl: config.baseUrl,
      enabled: config.aiProvenance,
    }),
  };

  const created = await storage.createMessage(record);

  // Push, for the direction that has someone waiting: an inbound message is one the agent has not
  // seen yet. An agent's own outbound message needs no wake-up — it is holding the pen.
  if (created.direction === 'inbound') {
    deps.webhooks?.dispatchWebhookEvent(created.agentGaii, 'message.inbound', {
      message_id: created.id,
      thread_id: created.threadId,
      linked_task_id: created.linkedTaskId ?? null,
      preview: created.content.substring(0, 200),
      has_proposed_task: !!(created.metadata?.proposedTask),
      has_prompt_answer: !!(created.metadata?.promptAnswer),
      created_at: created.createdAt,
    });
    const agentName = parseGaiiLoose(created.agentGaii).agent;
    try {
      deps.emitResourceUpdated?.(created.agentGaii, `aimeat://agents/${agentName}/messages`);
    } catch (err) {
      logger.warn('sendAgentMessage: MCP not connected', { error: String(err) });
    }
  }

  // Owner-scoped: the SSE transport compares the owner segment, so this reaches the writer's own UI
  // and no one else's. An unscoped emit here used to wake every connected owner on the node.
  emitChange('agent-messages', created.agentGaii);

  return { ok: true, message: created };
}
