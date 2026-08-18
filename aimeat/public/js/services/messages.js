/**
 * @file messages.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend service for human↔human direct messaging (GHII↔GHII): send, inbox,
 *   conversations/threads, read receipts, delete, the first-contact request gate (requests/accept/
 *   block), plus small storage helpers used to upload and resolve message attachments.
 * @structure send / listInbox / listConversations / getConversation / markConversationRead /
 *   markRead / deleteMessage / listRequests / acceptRequest / blockContact / listContacts /
 *   uploadAttachment / attachmentUrl / transcribeAttachment
 * @usage import * as messages from '/js/services/messages.js';
 * @version-history
 *   v1.4.0 -- 2026-08-01 -- Voice messages: uploadAttachment carries a recording's measured
 *     `duration_seconds` into the descriptor (so a thread can show "0:14" before fetching the audio),
 *     and transcribeAttachment() turns one voice attachment into text on the caller's own copy.
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 5: Inbox tab).
 *   v1.0.1 -- 2026-06-19 -- JSDoc type annotations for frontend type-checking
 *   v1.1.0 -- 2026-06-23 -- send() carries the optional `interactive` payload (federated AskUserQuestion).
 *   v1.1.1 -- 2026-07-17 -- uploadAttachment: add a random suffix to the storage key so same-named files
 *     uploaded in the same millisecond (two clipboard "image.png" pastes) don't overwrite each other.
 *   v1.2.0 -- 2026-07-21 -- getConversation(…, all): default loads the newest 50 (server page); all=true
 *     walks every page (per_page=200) so long threads show their FULL history instead of only the last 50.
 *   v1.3.0 -- 2026-07-27 -- uploadAttachment goes through the PRESIGNED path (mint URL, then raw PUT)
 *     instead of base64-inlining the file into a JSON body. Inlining inflated every attachment by 4/3
 *     and forced it under security.json_body_limit_large_mb, a ceiling separate from the storage quota:
 *     a 10.6 MB video failed to send while the operator raised quota.storage_max_file_size_mb and saw
 *     no effect. Also surfaces the real reason (size / HTTP status) instead of an opaque failure.
 */
import { api, apiGet } from '/js/api.js';
import { t } from '/js/i18n.js';

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

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

/** The node mints an ABSOLUTE upload URL from its configured base URL. Collapse it to a path when the
 *  origin already matches, so the PUT stays a plain same-origin request instead of a preflighted one. */
function uploadTarget(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search : u.href;
  } catch { return url; }   // an unparseable URL is used verbatim; the PUT below reports the failure
}

/** Upload a file to the caller's storage and return its descriptor for a message.
 *
 *  PRESIGNED, never inline. The bytes are PUT raw to a one-shot upload URL, so an attachment is capped
 *  only by the node's storage limit (quota.storage_max_file_size_mb). The previous version base64'd the
 *  whole file into a JSON body, which meant a second, invisible ceiling: base64 inflates by 4/3, so a
 *  10.6 MB video became a ~14.8 MB request that had to fit inside security.json_body_limit_large_mb —
 *  a limit nobody raising the *storage* quota would think to look at. /v1/upload/ skips body parsing
 *  entirely (see server.ts) and streams instead, so neither the inflation nor that ceiling applies. */
export async function uploadAttachment(file, kindOverride) {
  // A random suffix keeps the key unique even for same-named files uploaded in the same millisecond
  // (e.g. two clipboard "image.png" pastes) — without it the second upload would overwrite the first's
  // bytes, so both attachments showed the same picture.
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `dm-out/${Date.now()}-${rand}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const mime = file.type || 'application/octet-stream';

  const mint = await api('/v1/storage', {
    method: 'POST',
    body: JSON.stringify({ key, mime_type: mime, visibility: 'private', mode: 'presigned' }),
  });
  const uploadUrl = mint?.data?.upload_url;
  if (!uploadUrl) throw new Error(t('inbox.attachNoUrl', { name: file.name }));

  // Check the size against the node's own answer BEFORE spending the token. An oversized PUT is
  // refused at 413 anyway, but the token is single-use, so failing here keeps the error specific
  // (which file, how big, what the node accepts) instead of a bare HTTP status.
  const maxBytes = Number(mint?.data?.max_size_bytes) || 0;
  if (maxBytes && file.size > maxBytes) {
    throw new Error(t('inbox.attachTooLarge', { name: file.name, size: mb(file.size), max: mb(maxBytes) }));
  }

  // Plain fetch, deliberately NOT api(): the presigned token IS the capability (no Authorization
  // header), and api() retries 5xx — a retried PUT on a consumed one-shot token answers 409
  // TOKEN_USED, which would report a transport hiccup as a failed upload. No timeout either; a large
  // video on a slow uplink outlives api()'s 30 s default.
  const resp = await fetch(uploadTarget(uploadUrl), {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: file,
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => null);   // eslint-disable-line aimeat/no-silent-catch -- non-JSON error body falls back to the status line below
    throw new Error(detail?.message || t('inbox.attachFailed', { name: file.name, status: resp.status }));
  }

  const kind = kindOverride || (mime.startsWith('image/') ? 'image'
    : mime.startsWith('audio/') ? 'audio'
    : mime.startsWith('video/') ? 'video' : 'file');
  const desc = { storage_key: key, mime, size: file.size, kind, name: file.name };
  // A voice recording arrives with its measured length attached (composer addRecording). Carrying it
  // in the descriptor lets the recipient's thread show "0:14" without downloading the audio first.
  if (Number(file.durationSeconds) > 0) desc.duration_seconds = Number(file.durationSeconds);
  return desc;
}

/** Transcribe a voice attachment on the caller's own copy of a message, with the caller's own AI key.
 *  Idempotent server-side: a second call returns the stored transcript instead of paying again. */
export async function transcribeAttachment(messageId, attachmentId, opts = {}) {
  return api(`/v1/messages/${enc(messageId)}/attachments/${enc(attachmentId)}/transcribe`, {
    method: 'POST',
    body: JSON.stringify({ force: !!opts.force, model: opts.model, language: opts.language }),
    // Speech-to-text is a provider round trip over an audio file; the default 30 s client timeout
    // cuts a perfectly good transcription off at the knees.
    timeoutMs: 180_000,
  });
}

/** Resolve a presigned, no-auth download URL for one of the caller's own storage keys (for <img>). */
export async function attachmentUrl(localKey) {
  const r = await apiGet(`/v1/storage/${localKey.split('/').map(enc).join('/')}?mode=handle`);
  return r?.data?.download_url || r?.data?.url || null;
}
