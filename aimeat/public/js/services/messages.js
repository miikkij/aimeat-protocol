/**
 * @file messages.js
 * @description Frontend service for human↔human direct messaging (GHII↔GHII): send, inbox,
 *   conversations/threads, read receipts, delete, the first-contact request gate (requests/accept/
 *   block), plus small storage helpers used to upload and resolve message attachments.
 * @structure send / listInbox / listConversations / getConversation / markConversationRead /
 *   markRead / deleteMessage / listRequests / acceptRequest / blockContact / listContacts /
 *   uploadAttachment / attachmentUrl
 * @usage import * as messages from '/js/services/messages.js';
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 5: Inbox tab).
 *   v1.0.1 -- 2026-06-19 -- JSDoc type annotations for frontend type-checking
 *   v1.1.0 -- 2026-06-23 -- send() carries the optional `interactive` payload (federated AskUserQuestion).
 */
import { api, apiGet } from '/js/api.js';

const enc = encodeURIComponent;

/** Send a direct message. `attachments` is an array of descriptors (storage_key, mime, size, kind, inline, id).
 *  `subject` opens a new topic thread; `conversationId` continues a specific existing thread.
 *  `interactive` carries a structured AskUserQuestion payload (a `questions` spec or the human's `answers`). */
export async function send({ to, body, attachments, replyTo, subject, conversationId, interactive } = /** @type {{ to?: any, body?: any, attachments?: any, replyTo?: any, subject?: any, conversationId?: any, interactive?: any }} */ ({})) {
  return api('/v1/messages', {
    method: 'POST',
    body: JSON.stringify({ to, body, attachments, reply_to: replyTo, subject, conversation_id: conversationId, interactive }),
  });
}

/** Send one message to MANY recipients. `to` is an array of identities and/or `groupId` is a Share Group
 *  whose members are the audience. `mode` 'announcement' = read-only; 'broadcast' = repliable. `interactive`
 *  makes it a poll. Returns { broadcast_id, recipients, sent, failed }. */
export async function sendBroadcast({ to, groupId, mode, body, attachments, interactive } = /** @type {{ to?: any, groupId?: any, mode?: any, body?: any, attachments?: any, interactive?: any }} */ ({})) {
  return api('/v1/messages/broadcast', {
    method: 'POST',
    body: JSON.stringify({ to, group_id: groupId, mode, body, attachments, interactive }),
  });
}

/** Aggregated results for a broadcast (recipients, delivered/read/answered counts, poll answers). */
export async function getBroadcastResults(broadcastId) {
  const r = await apiGet(`/v1/messages/broadcast/${enc(broadcastId)}`);
  return r?.data || null;
}

export async function listInbox(unreadOnly = false) {
  const r = await apiGet(`/v1/messages/inbox${unreadOnly ? '?unread=true' : ''}`);
  return r?.data || { messages: [], total: 0, unread: 0 };
}

export async function listConversations() {
  const r = await apiGet('/v1/messages/conversations');
  return r?.data?.conversations || [];
}

export async function getConversation(conversationId) {
  const r = await apiGet(`/v1/messages/conversations/${enc(conversationId)}`);
  return r?.data?.messages || [];
}

export async function markConversationRead(conversationId) {
  return api(`/v1/messages/conversations/${enc(conversationId)}/read`, { method: 'POST' });
}

export async function markRead(id) {
  return api(`/v1/messages/${enc(id)}/read`, { method: 'PATCH' });
}

export async function deleteMessage(id) {
  return api(`/v1/messages/${enc(id)}`, { method: 'DELETE' });
}

export async function listRequests() {
  const r = await apiGet('/v1/messages/requests');
  return r?.data?.requests || [];
}

export async function acceptRequest(contactId) {
  return api(`/v1/messages/requests/${enc(contactId)}/accept`, { method: 'POST' });
}

export async function blockContact(contactId) {
  return api(`/v1/messages/contacts/${enc(contactId)}/block`, { method: 'POST' });
}

export async function listContacts(state) {
  const r = await apiGet(`/v1/messages/contacts${state ? `?state=${enc(state)}` : ''}`);
  return r?.data?.contacts || [];
}

/** Upload a file (base64 inline) to the caller's storage and return its descriptor for a message. */
export async function uploadAttachment(file, kindOverride) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const data = btoa(binary);
  const key = `dm-out/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const mime = file.type || 'application/octet-stream';
  await api('/v1/storage', {
    method: 'POST',
    body: JSON.stringify({ key, data, mime_type: mime, visibility: 'private' }),
  });
  const kind = kindOverride || (mime.startsWith('image/') ? 'image'
    : mime.startsWith('audio/') ? 'audio'
    : mime.startsWith('video/') ? 'video' : 'file');
  return { storage_key: key, mime, size: file.size, kind, name: file.name };
}

/** Resolve a presigned, no-auth download URL for one of the caller's own storage keys (for <img>). */
export async function attachmentUrl(localKey) {
  const r = await apiGet(`/v1/storage/${localKey.split('/').map(enc).join('/')}?mode=handle`);
  return r?.data?.download_url || r?.data?.url || null;
}
