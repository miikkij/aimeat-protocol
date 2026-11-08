/**
 * @file public/views/profile/capabilities/publish.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bodies the Capabilities page sends when a person adds a capability by hand or
 *   shows or hides one, and how the page reads the answer. Pure functions with no imports, so the E2E
 *   suite (test/e2e-capabilities.ts) sends exactly the body the page sends.
 *
 *   WHY. The hand-added form sent `visibility` and no `status`, and createCapability stores an entry
 *   without a status as a draft (src/services/capability-record.ts). "Visible to agents" ticked thus
 *   gave a public draft: another account could not open or call it, the MCP search did not list it,
 *   and nothing on the page made it active. "Show to agents" on the row sent `visibility` alone, which
 *   leaves a draft a draft. Ticked now means publish: the body asks for status 'active', through the
 *   same POST and PUT /v1/capabilities the MCP tools' service decides. The server keeps its rules: on
 *   a moderated node it answers 'pending_review' instead, and on a self_only node it refuses a public
 *   entry with 403 PUBLIC_DISABLED before anything is stored.
 * @structure manualCreateBody · visibilityPatch · shownToAgents · waitsForReview
 * @usage import { manualCreateBody, visibilityPatch } from './publish.js';
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial: "Visible to agents" ticked publishes the entry (status active),
 *     and "Show to agents" publishes a draft.
 */

/** The POST /v1/capabilities body for the hand-added form. Ticked publishes; unticked stays a private draft. */
export function manualCreateBody(form) {
  const visible = form.visibility === 'public';
  const webhookUrl = String(form.webhookUrl || '').trim();
  return {
    name: String(form.name || '').trim(),
    summary: String(form.summary || '').trim(),
    callable: !!webhookUrl,
    visibility: visible ? 'public' : 'private',
    status: visible ? 'active' : 'draft',
    webhookUrl: webhookUrl || undefined,
    source: { type: 'manual', ref: 'manual', version: '1.0.0' },
    tags: String(form.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/**
 * The PUT /v1/capabilities/:id body for "Show to agents" and "Hide from agents" on one member.
 * Showing a draft also asks for status 'active', because a public draft is not shown to anyone.
 * Any other status is left to the server: a retired or rejected entry is not brought back from here.
 */
export function visibilityPatch(member, visibility) {
  if (visibility !== 'public') return { visibility: 'private' };
  return member.status === 'draft' ? { visibility: 'public', status: 'active' } : { visibility: 'public' };
}

/** True when the row offers "Hide from agents": the entry is public and was published or sent for review. */
export function shownToAgents(group) {
  return group.visibility === 'public' && group.status !== 'draft';
}

/** True when the server put the published entry in the operator's review queue. */
export function waitsForReview(record) {
  return !!record && record.status === 'pending_review';
}
