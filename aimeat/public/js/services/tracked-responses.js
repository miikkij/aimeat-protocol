/**
 * @file tracked-responses.js
 * @description Frontend service for Tracked Responses — the Memory Contract that owes a (possibly
 *   federated) reply to an inbox message once a watched workspace record satisfies a condition.
 *   Thin wrappers over /v1/tracked-responses; plus message-importance flags stored as owner memory
 *   (no schema migration) for the lightweight "Important / needs reply" tier.
 * @structure create / list / get / getDraft / evaluate / markReplied / cancel + importance flags
 * @usage import * as tracked from '/js/services/tracked-responses.js';
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial service (Tracked Responses + importance flags).
 */
import { api, apiGet } from '/js/api.js';
import { createMemory, getMemory, deleteMemory } from '/js/services/memory.js';
import { swallowed } from '/js/swallowed.js';

const enc = encodeURIComponent;
const FLAG_PREFIX = 'message-flag.';
const flagKey = (messageId) => `${FLAG_PREFIX}${messageId}.latest`;

/** Create a Tracked Response from an inbox message. `watch` = { key, condition:{field,equals} }. */
export async function createTrackedResponse({ messageId, watch, response, references, title, tier } = /** @type {{ messageId?: any, watch?: any, response?: any, references?: any, title?: any, tier?: any }} */ ({})) {
  const resp = await api('/v1/tracked-responses', {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId, watch, response, references, title, tier }),
  });
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not create tracked response');
  return resp?.data?.trackedResponse || null;
}

/** AI triage: form the intent for a message as an actionable record (organism/workspace + record TYPE
 *  + title/content + completion condition). Slow AI call — full timeout, no retry. Returns
 *  { suggestion, context:{organisms:[{id,name,workspaces:[{id,name,recordTypes:[{namespace,name}]}]}]} }. */
export async function triageMessage(text) {
  const resp = await api('/v1/tracked-responses/classify', { method: 'POST', body: JSON.stringify({ text }), timeoutMs: 1_800_000, retries: 0 });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'Triage failed'); e.code = resp.error?.code; throw e; }
  return resp?.data || null;
}

/** AI fill: produce a record value conforming to the chosen record type's ACTUAL schema (any shape,
 *  AI-authored per workspace) + the schema-correct completion condition + inject field. Validated
 *  server-side before returning. Slow AI call. Returns { value, condition, inject }. */
export async function fillRecord({ organismId, ws, namespace, recordId, message, title, content } = /** @type {{ organismId?: any, ws?: any, namespace?: any, recordId?: any, message?: any, title?: any, content?: any }} */ ({})) {
  const resp = await api('/v1/tracked-responses/fill', {
    method: 'POST',
    body: JSON.stringify({ organism_id: organismId, ws, namespace, record_id: recordId, message, title, content }),
    timeoutMs: 1_800_000, retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'Fill failed'); e.code = resp.error?.code; throw e; }
  return resp?.data || null;
}

export async function listTrackedResponses(state) {
  const r = await apiGet(`/v1/tracked-responses${state ? `?state=${enc(state)}` : ''}`);
  return r?.data?.trackedResponses || [];
}

export async function getTrackedResponse(id) {
  const r = await apiGet(`/v1/tracked-responses/${enc(id)}`);
  return r?.data?.trackedResponse || null;
}

/** The suggested reply built when an approve-mode contract fired ({ draft:{body,result}, source, state }). */
export async function getTrackedResponseDraft(id) {
  const r = await apiGet(`/v1/tracked-responses/${enc(id)}/draft`);
  return r?.data || null;
}

export async function evaluateTrackedResponse(id) {
  const r = await api(`/v1/tracked-responses/${enc(id)}/evaluate`, { method: 'POST' });
  return r?.data?.trackedResponse || null;
}

export async function markTrackedResponseReplied(id, sentMessageId) {
  return api(`/v1/tracked-responses/${enc(id)}/replied`, { method: 'POST', body: JSON.stringify({ sent_message_id: sentMessageId }) });
}

export async function cancelTrackedResponse(id) {
  return api(`/v1/tracked-responses/${enc(id)}/cancel`, { method: 'POST' });
}

// ── Lightweight "Important / needs reply" flag (Tier 1) — owner memory, no schema migration ──
export async function setMessageImportant(messageId, important) {
  if (important) return createMemory(flagKey(messageId), { important: true, at: new Date().toISOString() }, 'private');
  return deleteMemory(flagKey(messageId)).catch(err => { swallowed('tracked-responses: setMessageImportant', err); });
}

export async function isMessageImportant(messageId) {
  try { const r = await getMemory(flagKey(messageId)); return !!(r?.data?.value?.important); }
  catch (err) { swallowed('tracked-responses', err); return false; }
}

/** Return the set of message ids the owner flagged important (for the "Needs reply" filter). Uses a
 *  PREFIX query so it fetches only the tiny `message-flag.*` set — never the whole memory store. A flag
 *  record exists ONLY while important (un-flag deletes it), so key-presence is sufficient. */
export async function listImportantMessageIds() {
  try {
    const r = await apiGet(`/v1/memory?prefix=${enc(FLAG_PREFIX)}`);
    const items = r?.data?.items || [];
    return items
      .map(m => String(m.key || ''))
      .filter(k => k.startsWith(FLAG_PREFIX))
      .map(k => k.slice(FLAG_PREFIX.length).replace(/\.latest$/, ''));
  } catch (err) { swallowed('tracked-responses: listImportantMessageIds', err); return []; }
}
