/**
 * @file email.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT Email Service: the owner's address (/v1/ghii/me, the verification pair
 *   under /v1/ghii/email), their connected mailboxes (/v1/connections: the mail providers, a
 *   connection's delegations and the addresses it may send as), what left through the node
 *   (/v1/outbound/log), what the node mailed them (/v1/notifications/mail), and the chat prompt.
 * @usage import * as email from '/js/services/email.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Sähköpostin sivu", direction A).
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** The owner's own record: notification_email, email_verified_at, verification_level, locale. */
export async function me() { const r = await apiGet('/v1/ghii/me'); return r?.data ?? null; }
/** Start verifying an address: a code goes to it. Changing the address un-verifies the old one. */
export const startVerify = (address) => apiPost('/v1/ghii/email/verify', { email: address });
export const confirmVerify = (code, verificationId) => apiPost('/v1/ghii/email/confirm', { code, ...(verificationId ? { verification_id: verificationId } : {}) });

/** Mail providers only, from the node's provider list: those that read or send mail. */
export async function mailProviders() {
  const r = await apiGet('/v1/connections/providers');
  const list = r?.data?.providers ?? [];
  return list.filter(p => (p.capabilities || []).some(c => c === 'read-mail' || c === 'send-mail'));
}
/** The owner's connections at mail providers. */
export async function mailConnections(providers) {
  const ids = new Set((providers || []).map(p => p.id));
  const r = await apiGet('/v1/connections');
  return (r?.data?.connections ?? []).filter(c => ids.has(c.provider));
}
/** Begin connecting: the address a PERSON opens; completion is a new row in the list. */
export async function startConnection(providerId) {
  const r = await apiPost('/v1/connections/start', { provider: providerId, mode: 'personal', return_url: '/connection-done.html' });
  return r?.data?.authorize_url ?? null;
}
export const removeConnection = (id) => apiDelete(`/v1/connections/${encodeURIComponent(id)}`);
export async function delegations(id) { const r = await apiGet(`/v1/connections/${encodeURIComponent(id)}/delegations`); return r?.data?.delegations ?? []; }
export const setDelegation = (did, enabled) => apiPatch(`/v1/connections/delegations/${encodeURIComponent(did)}`, { enabled });
/** The addresses a Gmail connection may send as (its own plus verified aliases). Best-effort. */
export async function sendAsAliases(connectionId) {
  try {
    const r = await apiPost(`/v1/connections/${encodeURIComponent(connectionId)}/read/sendAs`, {});
    const d = r?.data?.data;
    const list = Array.isArray(d?.sendAs) ? d.sendAs : Array.isArray(d) ? d : [];
    return list.map(a => (typeof a === 'string' ? a : a.sendAsEmail || a.email || '')).filter(Boolean);
  } catch (err) { swallowed('email: aliases', err); return []; }
}

/** What left through the node: { messages, total }. */
export async function outboundLog(limit = 50) {
  const r = await apiGet(`/v1/outbound/log?per_page=${limit}`);
  return r?.data ?? { messages: [], total: 0 };
}
/** What the node mailed the owner: { entries: [{ kind, subject, at }], total }. */
export async function mailLog() { const r = await apiGet('/v1/notifications/mail'); return r?.data ?? { entries: [], total: 0 }; }

export async function getPrompt() { const r = await apiGet('/v1/templates/email-mcp'); return r?.data?.prompt ?? ''; }

/** Wait for a connection round to finish: the pop-up announces, or the list grows. */
export async function waitForConnection(countBefore, listFn) {
  const DEADLINE = Date.now() + 180_000;
  let channel = null, announced = false;
  try { channel = new BroadcastChannel('aimeat-connect'); channel.onmessage = () => { announced = true; }; }
  catch (err) { swallowed('email: broadcast', err); }
  try {
    while (Date.now() < DEADLINE) {
      await new Promise(r => setTimeout(r, 1200));
      if (announced) return true;
      if ((await listFn()).length > countBefore) return true;
    }
    return false;
  } finally { if (channel) channel.close(); }
}
