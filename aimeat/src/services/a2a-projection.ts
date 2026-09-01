/**
 * @file src/services/a2a-projection.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What this node already stores, said in A2A's words. Pure functions: no I/O, no
 *   storage, no decisions about who may do what.
 *
 *   V4 AND V5 WERE BUILT FOR THIS FILE TO BE SHORT. The message carries role + parts + messageId +
 *   contextId + taskId because that is the A2A message; the task carries the five MCP statuses
 *   because A2A's map onto them. So this is a rename and a re-nesting rather than a translation, and
 *   the places where it is NOT are the interesting ones:
 *
 *     A2A's Part is a tagged union with a `$case`, ours is a `kind`. A file part is `url` there and
 *     `file.uri` here, and `raw` bytes have no counterpart at all — a part in this node carries a
 *     pointer, never bytes, so an inbound `raw` part is refused rather than silently stored empty.
 *
 *     A2A's TaskState is a protobuf ENUM (numbers), and its JSON names are SCREAMING_SNAKE. The MCP
 *     status is the stored word and this is the only place the second vocabulary is written.
 *
 *     A2A's push config is per TASK; ours is per PRINCIPAL with an optional task. A config with no
 *     task is every task's, which is the more useful default and the one V4 already had.
 *
 * @structure toA2APart / fromA2APart · toA2AMessage · toA2ATaskState · toA2ATask · toA2APushConfig
 * @usage const task = toA2ATask(record, history);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a).
 */
import { TaskState, Role, type Part, type Message, type Task, type TaskPushNotificationConfig } from '@a2a-js/sdk';
import type { AgentV2MessageRecord, AgentV2TaskRecord, AgentV2PushConfigRecord, MessagePart } from '../storage/interface.js';

/** One of our parts, as an A2A part. */
export function toA2APart(part: MessagePart): Part {
  switch (part.kind) {
    case 'text':
      return { content: { $case: 'text', value: part.text }, metadata: part.metadata, filename: '', mediaType: 'text/plain' };
    case 'file':
      return {
        content: { $case: 'url', value: part.file.uri },
        metadata: part.metadata,
        filename: part.file.name ?? '',
        mediaType: part.file.mimeType ?? '',
      };
    case 'data':
      return { content: { $case: 'data', value: part.data }, metadata: part.metadata, filename: '', mediaType: 'application/json' };
  }
}

/**
 * An A2A part, as one of ours. Returns null for a part this node cannot hold, and the caller turns
 * that into a refusal — `raw` bytes are the case that matters: a part here carries a pointer, and
 * accepting a `raw` part by dropping its bytes would store an empty attachment and call it success.
 */
export function fromA2APart(part: Part): MessagePart | null {
  const meta = part.metadata as Record<string, unknown> | undefined;
  const c = part.content;
  if (!c) return null;
  if (c.$case === 'text') return meta ? { kind: 'text', text: c.value, metadata: meta } : { kind: 'text', text: c.value };
  if (c.$case === 'url') {
    const file: { name?: string; mimeType?: string; uri: string } = { uri: c.value };
    if (part.filename) file.name = part.filename;
    if (part.mediaType) file.mimeType = part.mediaType;
    return meta ? { kind: 'file', file, metadata: meta } : { kind: 'file', file };
  }
  if (c.$case === 'data') {
    const value = c.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return meta ? { kind: 'data', data: value as Record<string, unknown>, metadata: meta } : { kind: 'data', data: value as Record<string, unknown> };
  }
  // 'raw' — bytes inline. Not held here, deliberately. See the file header.
  return null;
}

export function toA2AMessage(m: AgentV2MessageRecord): Message {
  return {
    messageId: m.messageId,
    contextId: m.contextId,
    taskId: m.taskId ?? '',
    role: m.role === 'agent' ? Role.ROLE_AGENT : Role.ROLE_USER,
    parts: m.parts.map(toA2APart),
    metadata: m.metadata ?? undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

/**
 * The A2A state for a stored task.
 *
 * Four A2A states have no MCP status of their own and are recovered from what sits beside it:
 * `submitted` from a task nobody started, `rejected` and `auth-required` from an error code. This
 * is the same mapping models/agent-v2-task.ts states in words; it is written twice because one is
 * the string a person reads and the other is a protobuf enum, and collapsing them would mean the
 * REST answer and the A2A answer share a bug rather than merely agreeing.
 */
export function toA2ATaskState(task: Pick<AgentV2TaskRecord, 'status' | 'startedAt' | 'error'>): TaskState {
  switch (task.status) {
    case 'working':
      return task.startedAt ? TaskState.TASK_STATE_WORKING : TaskState.TASK_STATE_SUBMITTED;
    case 'input_required':
      return task.error?.code === 'AUTH_REQUIRED' ? TaskState.TASK_STATE_AUTH_REQUIRED : TaskState.TASK_STATE_INPUT_REQUIRED;
    case 'completed':
      return TaskState.TASK_STATE_COMPLETED;
    case 'failed':
      return task.error?.code === 'REJECTED' ? TaskState.TASK_STATE_REJECTED : TaskState.TASK_STATE_FAILED;
    case 'cancelled':
      return TaskState.TASK_STATE_CANCELED;
  }
}

/**
 * A stored task as an A2A Task.
 *
 * The result becomes ONE artifact rather than a status message, because that is what an artifact is
 * for: A2A's `status.message` is the sentence about the state and `artifacts` are what the work
 * produced, and putting the output in the sentence is how a client ends up parsing prose.
 */
export function toA2ATask(task: AgentV2TaskRecord, history: AgentV2MessageRecord[] = []): Task {
  const statusMessage: Message | undefined = task.statusMessage
    ? {
      messageId: `${task.taskId}:status`,
      contextId: task.contextId,
      taskId: task.taskId,
      role: Role.ROLE_AGENT,
      parts: [{ content: { $case: 'text', value: task.statusMessage }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    }
    : undefined;

  return {
    id: task.taskId,
    contextId: task.contextId,
    status: {
      state: toA2ATaskState(task),
      message: statusMessage,
      timestamp: task.lastUpdatedAt,
    },
    artifacts: task.result && task.result.length > 0
      ? [{
        artifactId: `${task.taskId}:result`,
        name: 'result',
        description: '',
        parts: (task.result as MessagePart[]).map(toA2APart),
        metadata: undefined,
        extensions: [],
      }]
      : [],
    history: history.map(toA2AMessage),
    // The error is not an A2A field of its own: a failed task carries its reason where a client
    // will actually look for it, which is the task metadata beside the state that says it failed.
    metadata: task.error
      ? { ...(task.metadata ?? {}), error: task.error }
      : (task.metadata ?? undefined),
  };
}

/** A stored delivery target as A2A's per-task push config. */
export function toA2APushConfig(c: AgentV2PushConfigRecord): TaskPushNotificationConfig {
  return {
    tenant: '',
    id: c.id,
    // A config with no task of its own belongs to every task of that principal, which is the more
    // useful default and the one V4 already had. A2A has no way to say that, so it reports empty.
    taskId: c.taskId ?? '',
    url: c.url,
    token: c.token ?? '',
    // A2A v1 carries ONE scheme; we store a list because that is what the v0.3 shape had. The first
    // is the one the Authorization header is built from, so it is the one that is true.
    authentication: c.authSchemes.length > 0
      // The credentials are never returned by anything, here included.
      ? { scheme: c.authSchemes[0], credentials: '' }
      : undefined,
  };
}
