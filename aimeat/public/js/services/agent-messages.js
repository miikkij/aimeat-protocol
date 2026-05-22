/**
 * @file agent-messages.js
 * @description Frontend API service for agent messages.
 *   Provides send, list, thread listing, and status update operations.
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import { apiGet, apiPost, apiPatch } from '/js/api.js';

export async function sendMessage(agentName, content, threadId) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/messages`, {
    content,
    direction: 'inbound',
    ...(threadId && { thread_id: threadId }),
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
