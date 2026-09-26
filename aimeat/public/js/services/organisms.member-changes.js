/**
 * @file public/js/services/organisms.member-changes.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspace changes any member may make, through the node's member change doors:
 *   add a space, save a document space's sections, set the workspace's rule for members' changes, and
 *   list or decide the suggestions that rule files. Each door answers with what happened, which the
 *   page shows: `status` 'applied' (done), 'pending_approval' (sent to the workspace's creator and
 *   admins, with `suggestion`) or 'unchanged'; a refusal throws with the reason.
 *
 *   WHY. addSpace and saveSections wrote the workspace's own meta records with POST /v1/memory, which
 *   only the workspace's creator and an organism admin may write, so a contributor's section filing
 *   and a notebook's new document space were refused, and the page swallowed the refusal. They moved
 *   here from organisms.js and call the doors; organisms.js re-exports them, so every import stands.
 * @structure addSpace · addWorkspaceSpaces · saveSections · setMemberChangeRule · listSuggestions ·
 *   decideSuggestion · changeOutcome
 * @usage import { saveSections, changeOutcome } from '/js/services/organisms.js';
 * @version-history
 *   v1.0.0 — 2026-09-25 — Moved addSpace and saveSections out of organisms.js onto the member change
 *     doors, with the rule and the suggestions beside them.
 */
import { apiGet, apiPost, apiPut } from '/js/api.js';

const enc = encodeURIComponent;
const wsBase = (orgId) => `/v1/organisms/${enc(orgId)}/workspace`;

/** kebab-case a free-typed name into a safe namespace segment / type name. */
function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/** Add objectTypes through the member door. Returns the door's data: { status, added, skipped, suggestion? }. */
export async function addWorkspaceSpaces(orgId, wsId, spaces, schemas) {
  const r = await apiPost(`${wsBase(orgId)}/spaces?ws=${enc(wsId)}`, { spaces, ...(schemas ? { schemas } : {}) });
  return r?.data || null;
}

/** Add one space by name (no AI). mode 'document' needs no schema; 'records' gets a starter
 *  {id,title} schema that can be refined later via Restructure. */
export async function addSpace(orgId, wsId, manifest, name, mode) {
  const base = slug(name);
  const plural = base.endsWith('s') ? base : base + 's';
  const existing = new Set((manifest?.objectTypes || []).map(o => o.namespace));
  let namespace = `shared.${plural}`;
  for (let i = 2; existing.has(namespace); i++) namespace = `shared.${plural}-${i}`;
  const ot = { name: base, schemaRef: `schema:${base}@1`, namespace, backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode };
  const schemas = mode === 'records'
    ? { [namespace]: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } } }
    : undefined;
  return addWorkspaceSpaces(orgId, wsId, [ot], schemas);
}

/** Save the section index of one document space. Returns { status, sections?, suggestion? }. */
export async function saveSections(orgId, wsId, typeName, sections) {
  const r = await apiPut(`${wsBase(orgId)}/sections/${enc(typeName)}?ws=${enc(wsId)}`, { sections });
  return r?.data || null;
}

/** Set how the workspace takes its members' changes: 'direct' or 'suggest'. Creator/admin only. */
export async function setMemberChangeRule(orgId, wsId, rule) {
  const r = await apiPut(`${wsBase(orgId)}?ws=${enc(wsId)}`, { ws: wsId, member_changes: rule });
  return r?.data || null;
}

/** The suggestions the caller may see, each with can_decide. */
export async function listSuggestions(orgId, wsId, status) {
  const qs = new URLSearchParams({ ...(wsId ? { ws: wsId } : {}), ...(status ? { status } : {}) }).toString();
  const r = await apiGet(`/v1/organisms/${enc(orgId)}/workspace/suggestions${qs ? `?${qs}` : ''}`);
  return r?.data?.suggestions || [];
}

/** Approve or decline one suggestion ('approve' | 'decline'), with an optional note for the member. */
export async function decideSuggestion(orgId, suggestionId, decision, note) {
  const r = await apiPost(`/v1/organisms/${enc(orgId)}/workspace/suggestions/${enc(suggestionId)}`, { decision, ...(note ? { note } : {}) });
  return r?.data || null;
}

/** What a door's answer means for the page: 'applied' | 'pending' | 'unchanged'. */
export function changeOutcome(result) {
  if (result?.status === 'pending_approval') return 'pending';
  if (result?.status === 'unchanged') return 'unchanged';
  return 'applied';
}
