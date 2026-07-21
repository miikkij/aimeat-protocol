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
 *   v1.1.1 -- 2026-07-17 -- uploadAttachment: add a random suffix to the storage key so same-named files
 *     uploaded in the same millisecond (two clipboard "image.png" pastes) don't overwrite each other.
 *   v1.2.0 -- 2026-07-21 -- getConversation(…, all): default loads the newest 50 (server page); all=true
 *     walks every page (per_page=200) so long threads show their FULL history instead of only the last 50.
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
export async function sendBroadcast({ to, groupId, audience, mode, body, attachments, interactive } = /** @type {{ to?: any, groupId?: any, audience?: any, mode?: any, body?: any, attachments?: any, interactive?: any }} */ ({})) {
  return api('/v1/messages/broadcast', {
    method: 'POST',
    body: JSON.stringify({ to, group_id: groupId, audience, mode, body, attachments, interactive }),
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

/**
 * Fetch a conversation thread. Default = the newest page (server default 50). Pass all=true to load the
 * ENTIRE history: it walks every page (per_page=200) so long threads are never truncated — no message is
 * hidden, only paged. Returns the messages array newest-first (the caller reverses for chat display);
 * dedupes by id so a message arriving mid-walk can't double-render.
 */
export async function getConversation(conversationId, viaAgent, all = false) {
  const base = `/v1/messages/conversations/${enc(conversationId)}`;
  const agent = viaAgent ? `&agent=${enc(viaAgent)}` : '';
  const perPage = all ? 200 : 50;
  const first = await apiGet(`${base}?per_page=${perPage}&page=1${agent}`);
  const data = first?.data || {};
  let messages = data.messages || [];
  const total = Number(data.total) || messages.length;
  if (all && total > messages.length) {
    const pages = Math.ceil(total / perPage);
    for (let p = 2; p <= pages; p++) {
      const r = await apiGet(`${base}?per_page=${perPage}&page=${p}${agent}`);
      messages = messages.concat(r?.data?.messages || []);
    }
    const seen = new Set();
    messages = messages.filter(m => m && m.id && !seen.has(m.id) && seen.add(m.id));
  }
  return messages;
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
  // A random suffix keeps the key unique even for same-named files uploaded in the same millisecond
  // (e.g. two clipboard "image.png" pastes) — without it the second upload would overwrite the first's
  // bytes, so both attachments showed the same picture.
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `dm-out/${Date.now()}-${rand}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
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
