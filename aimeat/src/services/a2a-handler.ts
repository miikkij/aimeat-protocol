/**
 * @file src/services/a2a-handler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description This node's agents, answering A2A. One `A2ARequestHandler` per (agent, caller),
 *   projecting the V4 turns and the V5 tasks rather than storing anything of its own.
 *
 *   WHY THE HANDLER AND NOT THE SDK'S DefaultRequestHandler. That class owns a task lifecycle: it
 *   drives an `AgentExecutor`, writes through its own `TaskStore` and decides when a task settles.
 *   We already have all three, in V5, with the fences and the race resolution written and tested. A
 *   second lifecycle beside it would be the "one capability, two implementations" this repository
 *   keeps paying for. So the SDK does what only it can do — the JSON-RPC framing, the error codes,
 *   the protobuf serialisation — and every method below lands in agent-v2-*-ops.ts.
 *
 *   WHAT sendMessage MEANS HERE. A2A lets a server answer a message with either a Message or a Task.
 *   This node always answers with a Task, because a turn addressed to one of these agents IS work
 *   somebody has to pick up: there is no synchronous execution behind this door, and pretending
 *   otherwise would mean answering with a Message the agent has not written yet.
 *
 *   ONE ACCOUNT, IN V6a. The caller must be a principal of the same owner as the agent it is talking
 *   to — the same fence V4 and V5 apply, reached through the same functions. Opening this to callers
 *   from other accounts or other nodes is a real trust boundary with its own consent story, and it
 *   is not a decision to make on the way past.
 *
 * @structure AimeatA2ARequestHandler
 * @usage const handler = new AimeatA2ARequestHandler(storage, config, agent, () => callerAuth);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a).
 */
import {
  Role,
  type AgentCard, type Message, type Task,
  type SendMessageRequest, type GetTaskRequest, type CancelTaskRequest,
  type TaskPushNotificationConfig, type GetTaskPushNotificationConfigRequest,
  type ListTaskPushNotificationConfigsRequest, type ListTaskPushNotificationConfigsResponse,
  type DeleteTaskPushNotificationConfigRequest, type ListTasksRequest, type ListTasksResponse,
  type GetExtendedAgentCardRequest, type StreamResponse, type SubscribeToTaskRequest,
} from '@a2a-js/sdk';
import type { A2ARequestHandler, ServerCallContext } from '@a2a-js/sdk/server';
import {
  JsonRpcTaskNotFoundError, JsonRpcTaskNotCancelableError, JsonRpcRequestMalformedError,
  JsonRpcPushNotificationNotSupportedError,
} from '@a2a-js/sdk/errors';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord, AgentV2TaskRecord, MessagePart } from '../storage/interface.js';
import { toA2ATask, toA2APushConfig, fromA2APart } from './a2a-projection.js';
import { statusesForA2AState, matchesA2AState } from './a2a-task-state.js';
import { a2aExtendedCardFrom } from './a2a-card.js';
import { streamTask } from './a2a-stream.js';
import { createTask, getTask, cancelTask, listTasks } from './agent-v2-tasks-ops.js';
import { sendTurn, setPushTarget, listPushTargets, deletePushTarget, type Principal, type OpResult } from './agent-v2-messaging-ops.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';

/**
 * A caller at this door: the principal, plus the scopes it holds.
 *
 * The SCOPES ARE THE POINT of this type existing rather than reusing `Principal`. On the REST
 * doors, `requireScope` middleware stands in front of every write; there is one HTTP door here and
 * a dozen JSON-RPC methods behind it, so a single middleware would have to name one scope and be
 * wrong for eleven of them. The scope is therefore checked per METHOD, below, with the same words
 * the REST twin takes and the same rule (`scopeIsCovered`) it asks. Getting this wrong would be
 * security DNA invariant 15 exactly: a permission enforced on one surface and not another.
 */
export interface A2ACaller extends Principal {
  scopes: string[];
}

/**
 * A refusal from an op, as the error the JSON-RPC layer will put on the wire.
 *
 * THE ERROR CLASSES ARE THE SDK'S, not a code of ours. A hand-rolled `err.code = -32001` is ignored
 * by the transport, which reads its own error type and answers -32603 for everything else — so a
 * "task not found" reached the client as an internal error, which is a different thing and sends a
 * client down a different path. Each spec-named refusal maps to the class the spec named it for.
 */
function asRpcError(out: Extract<OpResult<unknown>, { ok: false }>): Error {
  const options = { message: out.message, data: { aimeatCode: out.code, ...(out.details ?? {}) } };
  if (out.status === 404) return new JsonRpcTaskNotFoundError(options);
  if (out.status === 409) return new JsonRpcTaskNotCancelableError(options);
  if (out.status === 400) return new JsonRpcRequestMalformedError(options);
  // 403 included: A2A has no "forbidden" of its own, and the transport's fallback is an internal
  // error, so the code stays generic and the MESSAGE carries what a caller has to act on.
  return new Error(out.message);
}

// The state relation lives in services/a2a-task-state.ts. `statusesForA2AState` narrows the QUERY;
// `matchesA2AState` decides. This file used to hold its own BACKWARDS copy of the table, and it
// disagreed with the two forward ones: REJECTED narrowed to `failed` and stopped there, so a client
// asking for what was refused was handed everything that broke. → pitfalls §43

export class AimeatA2ARequestHandler implements A2ARequestHandler {
  constructor(
    private readonly storage: Storage,
    private readonly config: AimeatConfig,
    private readonly agent: AgentRecord,
    private readonly caller: A2ACaller,
    private readonly card: AgentCard,
  ) {}

  /**
   * The scope a REST caller would have had to hold for the same act, asked the same way.
   *
   * An owner session bypasses, exactly as `requireScope` lets it: the account holder acts for their
   * own principals. An agent or an ecosystem app is enforced, whatever its owner's roles are.
   */
  private requireScope(scope: string): void {
    const roles = this.caller.roles ?? [];
    const ownerSession = roles.includes('owner') && !roles.includes('agent') && !roles.includes('ecosystem');
    if (ownerSession) return;
    if (scopeIsCovered(this.caller.scopes ?? [], scope)) return;
    logger.warn('[scope-denied] a2a', { principal: this.caller.sub, needs: scope, has: this.caller.scopes });
    throw new JsonRpcRequestMalformedError({
      message: `Scope "${scope}" required for this method. Your credential does not carry it.`,
    });
  }

  async getAgentCard(): Promise<AgentCard> {
    return this.card;
  }

  /**
   * The extended card, for a caller that has authenticated as a principal of this account.
   *
   * It used to return the public card unchanged, which made the method honest and pointless: the
   * public card already carries the agent's own declared capabilities and everything published for
   * hire, so a stranger is held nothing back. What it cannot say is whether the work will actually
   * go through — that depends on the scopes the owner granted and what the agent has loaded, which
   * are facts about the ACCOUNT. Those ride in the AIMEAT extension now.
   *
   * THE FENCE IS THE ROUTE'S, and it is the same one every other method here trusts: an
   * unauthenticated caller never reaches this handler, and a stranger is served by
   * ForeignA2AHandler, which has no extended card at all.
   */
  async getAuthenticatedExtendedAgentCard(_params: GetExtendedAgentCardRequest, _context: ServerCallContext): Promise<AgentCard> {
    return a2aExtendedCardFrom(this.card, this.agent);
  }

  /** The turns of one task, oldest first, for a Task's `history`. */
  private async history(task: AgentV2TaskRecord, historyLength?: number): Promise<AgentV2TaskRecord extends never ? never : Awaited<ReturnType<Storage['listAgentV2Messages']>>> {
    if (historyLength === 0) return [];
    return this.storage.listAgentV2Messages(this.caller.owner, {
      taskId: task.taskId,
      limit: historyLength && historyLength > 0 ? historyLength : 200,
    });
  }

  private async taskOr404(taskId: string): Promise<AgentV2TaskRecord> {
    const out = await getTask(this.storage, this.caller, taskId);
    if (!out.ok) throw asRpcError(out);
    return out.value;
  }

  /**
   * A message to this agent.
   *
   * With no task, it is new work: a V5 task assigned to this agent, with the message's parts as its
   * input. With a task, it is another turn in the same exchange: a V4 message filed against it. The
   * answer is the Task either way, which is the handle the client polls.
   */
  async sendMessage(params: SendMessageRequest, _context: ServerCallContext): Promise<Message | Task> {
    // message/send either creates work or adds a turn. Both are `messages:send` on the REST twin,
    // and creating work is `task:write` there as well, so both words are required for the branch
    // that creates one. Checked before anything is read or written.
    this.requireScope('messages:send');

    const message = params.message;
    if (!message || message.parts.length === 0) {
      throw new JsonRpcRequestMalformedError({ message: 'A message with at least one part is required.' });
    }

    const parts: MessagePart[] = [];
    for (const p of message.parts) {
      const converted = fromA2APart(p);
      if (!converted) {
        // `raw` inline bytes are the case: a part on this node carries a pointer, and accepting one
        // by dropping its bytes would store an empty attachment and call it success.
        throw new JsonRpcRequestMalformedError({
          message: 'This node holds a file part as a URL, not as inline bytes. Store the file and send a url part.',
        });
      }
      parts.push(converted);
    }

    if (message.taskId) {
      const task = await this.taskOr404(message.taskId);
      const sent = await sendTurn(this.storage, this.config, this.caller, {
        to: this.agent.gaii,
        role: message.role === Role.ROLE_AGENT ? 'agent' : 'user',
        parts,
        contextId: task.contextId,
        taskId: task.taskId,
        metadata: message.metadata,
      });
      if (!sent.ok) throw asRpcError(sent);
      const after = await this.taskOr404(message.taskId);
      return toA2ATask(after, await this.history(after));
    }

    this.requireScope('task:write');
    const created = await createTask(this.storage, this.config, this.caller, {
      assignedTo: this.agent.gaii,
      input: parts,
      contextId: message.contextId || undefined,
      metadata: message.metadata,
    });
    if (!created.ok) throw asRpcError(created);

    // The message itself is filed against the new task, so the exchange reads back as one thing
    // rather than as a task whose first turn went missing.
    await sendTurn(this.storage, this.config, this.caller, {
      to: this.agent.gaii,
      role: message.role === Role.ROLE_AGENT ? 'agent' : 'user',
      parts,
      contextId: created.value.contextId,
      taskId: created.value.taskId,
      metadata: message.metadata,
    });

    const task = await this.taskOr404(created.value.taskId);
    return toA2ATask(task, await this.history(task));
  }

  /**
   * Send a message and watch the task it becomes.
   *
   * THE SAME WRITE AS `sendMessage`, and deliberately so: this method is the non-streaming one plus
   * a subscription, not a second way to create work. Anything else would be two lifecycles again.
   *
   * Streaming was declared off until 2026-09-04 and both methods refused, on the reasoning that a
   * one-shot stream is worse than an honest refusal — a client holding a connection open for
   * updates that never arrive. That reasoning was right about the pretence and wrong about the
   * remedy: what the node lacked was an event when a task moved, and the delivery bus only fired
   * for a principal holding a live connector tunnel, which an A2A client is not.
   */
  async *sendMessageStream(params: SendMessageRequest, _context: ServerCallContext): AsyncGenerator<StreamResponse, void, undefined> {
    const task = await this.sendMessage(params, _context);
    // sendMessage always answers with a Task here; the union is A2A's, not this node's.
    const id = (task as Task).id;
    if (!id) return;
    for await (const t of streamTask(this.storage, this.caller, id, task => this.history(task))) {
      yield { payload: { $case: 'task', value: t } };
    }
  }

  /**
   * Attach to a task already in flight.
   *
   * The first frame is the task AS IT STANDS, not the next change: a client that reconnects after a
   * dropped connection needs to know where the work got to, and a stream that only spoke on the
   * next move would leave it waiting on a task that had already finished.
   */
  async *resubscribe(params: SubscribeToTaskRequest, _context: ServerCallContext): AsyncGenerator<StreamResponse, void, undefined> {
    // Existence and access are settled here, so a subscription to somebody else's task is a refusal
    // rather than a stream that never speaks — which is what an unchecked loop would produce.
    await this.taskOr404(params.id);
    for await (const t of streamTask(this.storage, this.caller, params.id, task => this.history(task))) {
      yield { payload: { $case: 'task', value: t } };
    }
  }

  // The reads take no scope, matching their REST twins: the task reads on /v1/agents/v2/tasks are
  // ungated for the same reason, and the fence that matters is the owner, which is not a parameter.
  async getTask(params: GetTaskRequest, _context: ServerCallContext): Promise<Task> {
    const task = await this.taskOr404(params.id);
    return toA2ATask(task, await this.history(task, params.historyLength));
  }

  async cancelTask(params: CancelTaskRequest, _context: ServerCallContext): Promise<Task> {
    this.requireScope('task:write');
    const out = await cancelTask(this.storage, this.config, this.caller, params.id);
    if (!out.ok) throw asRpcError(out);
    return toA2ATask(out.value, await this.history(out.value));
  }

  async listTasks(params: ListTasksRequest, _context: ServerCallContext): Promise<ListTasksResponse> {
    const statuses = params.status ? statusesForA2AState(params.status) : undefined;
    const out = await listTasks(this.storage, this.caller, {
      assigned_to: this.agent.gaii,
      context_id: params.contextId || undefined,
      status: statuses,
      limit: params.pageSize && params.pageSize > 0 ? params.pageSize : 50,
    });
    if (!out.ok) throw asRpcError(out);
    // THE PREFILTER IS NOT THE ANSWER. Two A2A states share the status `failed` and two share
    // `working`, so narrowing the query is only half of the question a client asked; asking for
    // `rejected` returned every failure until this line. The predicate is the forward mapping read
    // as a question, so it cannot drift away from what the tasks below are labelled with.
    const rows = params.status ? out.value.filter(t => matchesA2AState(t, params.status!)) : out.value;
    const tasks = await Promise.all(rows.map(async t => toA2ATask(t, await this.history(t, params.historyLength))));
    return { tasks, nextPageToken: '', pageSize: tasks.length, totalSize: tasks.length };
  }

  /**
   * A2A's push config is per TASK; V4's is per principal with an optional task, and the A2A door is
   * the one that fills the task in. The credentials are stored and never returned — by V4's
   * projection, which has no field for them, so this method cannot leak one by forgetting.
   */
  async createTaskPushNotificationConfig(params: TaskPushNotificationConfig, _context: ServerCallContext): Promise<TaskPushNotificationConfig> {
    // Registering a delivery target is `agent:write` on the REST twin: it configures where this
    // node will make an outbound call carrying a secret.
    this.requireScope('agent:write');
    if (!params.taskId) throw new JsonRpcRequestMalformedError({ message: 'A task id is required: this registers where to reach you about ONE task.' });
    await this.taskOr404(params.taskId);

    const out = await setPushTarget(this.storage, this.config, this.caller, {
      url: params.url,
      token: params.token || undefined,
      authentication: params.authentication
        ? { schemes: [params.authentication.scheme], credentials: params.authentication.credentials || undefined }
        : undefined,
      id: params.id || undefined,
    });
    if (!out.ok) throw asRpcError(out);

    // The task binding is the one thing V4's door does not set, so it is written here, on the row
    // that was just created, through the same store.
    const record = await this.storage.getAgentV2PushConfig(this.caller.owner, out.value.config.id);
    if (!record) throw new Error('The delivery target could not be read back after being written.');
    await this.storage.upsertAgentV2PushConfig({ ...record, taskId: params.taskId });

    const saved = await this.storage.getAgentV2PushConfig(this.caller.owner, record.id);
    return toA2APushConfig(saved ?? { ...record, taskId: params.taskId });
  }

  async getTaskPushNotificationConfig(params: GetTaskPushNotificationConfigRequest, _context: ServerCallContext): Promise<TaskPushNotificationConfig> {
    this.requireScope('messages:read');
    const record = await this.storage.getAgentV2PushConfig(this.caller.owner, params.id);
    if (!record || (params.taskId && record.taskId !== params.taskId)) {
      throw new JsonRpcPushNotificationNotSupportedError({ message: 'No such delivery target for that task.' });
    }
    return toA2APushConfig(record);
  }

  async listTaskPushNotificationConfigs(params: ListTaskPushNotificationConfigsRequest, _context: ServerCallContext): Promise<ListTaskPushNotificationConfigsResponse> {
    this.requireScope('messages:read');
    const out = await listPushTargets(this.storage, this.config, this.caller);
    if (!out.ok) throw asRpcError(out);
    // listPushTargets answers with the public projection, which is what A2A wants too — but it has
    // no task on it, so the records are read again for the binding rather than guessed at.
    const records = await this.storage.listAgentV2PushConfigs(this.caller.owner);
    const wanted = records.filter(r => out.value.some(c => c.id === r.id))
      .filter(r => !params.taskId || r.taskId === params.taskId);
    return { configs: wanted.map(toA2APushConfig), nextPageToken: '' };
  }

  async deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigRequest, _context: ServerCallContext): Promise<void> {
    this.requireScope('agent:write');
    const out = await deletePushTarget(this.storage, this.config, this.caller, params.id);
    if (!out.ok) throw asRpcError(out);
  }
}
