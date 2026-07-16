/**
 * @file agent-messages.js
 * @description Frontend API service for agent messages.
 *   Provides send, list, thread listing, and status update operations.
 * @version-history
 *   v1.3.0 -- 2026-07-16 -- Add getMessagesOverview (GET /v1/agents/:name/messages/overview) folding the
 *     Messages subtab's commands + threads + messages mount reads into one.
 *   v1.2.0 -- 2026-05-30 -- sendMessage accepts optional metadata (used to attach
 *     prompt_answer when the owner answers an agent's option-prompt).
 *   v1.1.0 -- 2026-05-22 -- Add linkedTaskId param to sendMessage for task-scoped chat
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import { apiGet, apiPost, apiPatch } from '/js/api.js';

/**
 * Composite mount for the Messages subtab: command palette + enriched threads + message history (page 1)
 * in ONE call. Returns { commands, threads, messages } or null on error so the caller can fall back to the
 * individual reads.
 */
export async function getMessagesOverview(agentName) {
  try {
    const resp = await apiGet(`/v1/agents/${encodeURIComponent(agentName)}/messages/overview`);
    return resp?.data ?? null;
  } catch { return null; }
}

export async function sendMessage(agentName, content, threadId, linkedTaskId, metadata) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/messages`, {
    content,
    direction: 'inbound',
    ...(threadId && { thread_id: threadId }),
    ...(linkedTaskId && { linked_task_id: linkedTaskId }),
    ...(metadata && { metadata }),
  });
}

export async function listMessages(agentName, opts = {}) {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.perPage) params.set('per_page', String(opts.perPage));
  if (opts.direction) params.set('direction', opts.direction);
  if (opts.threadId) params.set('thread_id', opts.threadId);
  const qs = params.toString();
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/messages${qs ? '?' + qs : ''}`);
}

export async function listThreads(agentName) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/messages/threads`);
}

export async function updateMessageStatus(agentName, messageId, status) {
  return apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/messages/${messageId}`, { status });
}
