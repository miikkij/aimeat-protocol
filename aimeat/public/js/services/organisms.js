/**
 * @file organisms.js
 * @description AIMEAT Organisms Service — organism CRUD, membership, join requests, and the
 *   manifest-driven workspace (a "project" is just an organism with a meta.manifest): apply a
 *   template, generate a workspace with AI, read the workspace, write/publish drafts, and
 *   resolve gate approvals.
 * @usage import * as orgService from '/js/services/organisms.js';
 * @version-history
 *   v1.5.0 — 2026-06-24 — uploadFile(orgId, file): generic blob upload (any document/image) to an
 *     organism's private storage, returning {key,url,mime} — used by the Secretary doc/image intake.
 *   v1.4.0 — 2026-06-23 — Optional color tags: getAllColors()/saveColors() read/write the per-item
 *     color map at …w.{ws}.meta.colors.{type} (mirrors getAllSections/saveSections).
 *   v1.3.0 — 2026-06-22 — Batch endpoints: discoverWorkspaces({include:'enrichment'}) folds the
 *     per-workspace fan-out; new getWaiting() (home widget) and listCommentsBatch() (workspace comments).
 *   v1.2.1 — 2026-06-21 — Decode HTML entities in workspace names on read (listWorkspaces +
 *     discoverWorkspaces) so legacy double-escaped registry names (e.g. "STT &amp; Voice") render
 *     as plain text in the list + breadcrumb.
 *   v1.2.0 — 2026-06-16 — Generator prompt: each objectType gets a one-line "description" and a
 *     matching "type.<name>.desc" i18n key, so generated workspaces are self-describing (the
 *     workspace UI shows the description under each space's title).
 *   v1.1.0 — 2026-06-10 — Generator prompt: per-property "description", "readOnly": true for
 *     agent-filled result fields (never required), "x-default": "currentUser" for requester
 *     fields, and a manifest "i18n" block (en + request language) with flat "{ns}.{field}",
 *     "{ns}.{field}.hint" and "type.{name}" labels the workspace UI renders.
 */
import { api, apiGet, apiPost, apiPut, apiPatch, apiDelete } from '/js/api.js';
import { decodeEntities } from '/js/utils.js';

/** Does this space's data live in workspace memory keys (records/documents the workspace view can
 *  show)? Missing backing counts as memory. Mirrors the server's isMemoryBackedSpace — THE one
 *  frontend predicate; hand-rolled per-view variants of this check are how published content once
 *  went invisible. backing:'tasks' points at the task system; other values are legacy/unsupported. */
export const isMemorySpace = (ot) => !ot?.backing || ot.backing === 'memory';

/** Is this space a document space? Old manifests declared kind:'document' without a mode — honour
 *  the intent (mirrors the server's normalizeObjectTypes inference). */
export const isDocSpace = (ot) => ot?.mode === 'document' || (!ot?.mode && ot?.kind === 'document');

/** List organisms. */
export async function listOrganisms(opts = {}) {
  const params = new URLSearchParams();
  if (opts.type) params.set('type', opts.type);
  if (opts.city) params.set('city', opts.city);
  if (opts.interest) params.set('interest', opts.interest);
  if (opts.visibility) params.set('visibility', opts.visibility);
  if (opts.member) params.set('member', opts.member);
  if (opts.include) params.set('include', opts.include);   // 'counts' → each org gains workspace_count
  return apiGet(`/v1/organisms?${params.toString()}`);
}

/** Get organism detail. */
export async function getOrganism(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}`);
}

/** Create a new organism. */
export async function createOrganism(data) {
  return apiPost('/v1/organisms', data);
}

/** Update organism. */
export async function updateOrganism(id, data) {
  return api(`/v1/organisms/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** Delete organism. */
export async function deleteOrganism(id) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}`);
}

/** Join an organism. */
export async function joinOrganism(id, message) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/join`, { message });
}

/** Leave an organism. */
export async function leaveOrganism(id) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/leave`, {});
}

/** List members. Optional status filter ('active' | 'banned' | 'invited' | 'pending'). */
export async function listMembers(id, status) {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/members${q}`);
}

/** List join requests (admin only). */
export async function listJoinRequests(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/join-requests`);
}

/** Review join request (approve/reject). */
export async function reviewJoinRequest(organismId, requestId, decision) {
  return apiPost(`/v1/organisms/${encodeURIComponent(organismId)}/join-requests/${encodeURIComponent(requestId)}/review`, { decision });
}

/** "Waiting for you" — pending reviews + join-requests + invitations aggregated across the caller's
 *  member organisms in ONE request (replaces the home widget's per-org listApprovals/listJoinRequests/
 *  listWorkspaces fan-out). Returns the flat `items` array ({kind:'review'|'join'|'invite', …}). */
export async function getWaiting() {
  try {
    const resp = await apiGet('/v1/organisms/waiting');
    return Array.isArray(resp?.data?.items) ? resp.data.items : [];
  } catch { return []; }
}

/** Agent activity aggregated across every readable workspace in ONE request (organism Agents tab).
 *  Returns { agentName: { count, lastAt, workspaces:[names] } } (replaces per-workspace activity fetches). */
export async function getAgentsActivity(orgId) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/agents/activity`);
    return resp?.data?.agents || {};
  } catch { return {}; }
}

/** List the comment thread on a workspace object (record or document). */
export async function listComments(orgId, ws, space, instanceId) {
  const params = new URLSearchParams({ ws, space, instance_id: instanceId });
  return apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/comments?${params.toString()}`);
}

/** Composite key the comments-batch response is keyed by (NUL-joined, never collides with any id). */
export const commentBatchKey = (ws, space, instanceId) => `${ws}\u0000${space}\u0000${instanceId}`;

/** Fetch comment threads for MANY workspace objects in one POST (body, not URL params, so a long
 *  target list never bloats the URL). Returns the raw `{ "ws\0space\0id": {comments,total} }` map. */
export async function listCommentsBatch(orgId, instances) {
  try {
    const resp = await apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/comments/batch`, { instances });
    return (resp?.data?.comments) || {};
  } catch { return {}; }
}

/** Add a comment to a workspace object. anchor: { section?|quote? }; parentId for a threaded reply. */
export async function addComment(orgId, { ws, space, instanceId, body, anchor, parentId }) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/comments`, { ws, space, instance_id: instanceId, body, anchor, parent_id: parentId });
}

/** Delete a comment (author or creator/admin). */
export async function deleteComment(orgId, commentId, ws, space, instanceId) {
  const params = new URLSearchParams({ ws, space, instance_id: instanceId });
  return apiDelete(`/v1/organisms/${encodeURIComponent(orgId)}/comments/${encodeURIComponent(commentId)}?${params.toString()}`);
}

/** Search records + documents across the organism's readable workspaces. Optional ws filter. */
export async function searchOrganism(id, q, ws) {
  const params = new URLSearchParams({ q });
  if (ws) params.set('ws', ws);
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/search?${params.toString()}`);
}

/** Remove (revoke) a member's organism access. Creator/admin only. Pass ban=true to block re-join. */
export async function removeMember(id, memberGhii, ban = false) {
  const suffix = ban ? '?ban=1' : '';
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/members/${encodeURIComponent(memberGhii)}${suffix}`);
}

/** Lift a ban on a previously-blocked owner. Creator/admin only. */
export async function unbanMember(id, memberGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/members/${encodeURIComponent(memberGhii)}/unban`, {});
}

/** Transfer ownership to an existing active member. Creator only. */
export async function transferOwnership(id, toGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/transfer`, { to: toGhii });
}

/** Invite an owner by bare name. Creator/admin only. */
export async function inviteMember(id, invitee) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/invitations`, { invitee });
}

/** List outstanding (pending) invitations for an organism. Creator/admin only. */
export async function listInvitations(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/invitations`);
}

/** The caller's own pending invitations across all organisms. */
export async function listMyInvitations() {
  return apiGet('/v1/organisms/invitations/mine');
}

/** Accept an invitation to an organism. */
export async function acceptInvitation(id) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/invitations/accept`, {});
}

/** Decline an invitation to an organism. */
export async function declineInvitation(id) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/invitations/decline`, {});
}

/** Attach one of your own agents (GAII) to an organism you belong to. */
export async function attachAgent(id, agentGaii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/agents`, { agent_gaii: agentGaii });
}

/** Detach an agent from an organism. Agent owner or organism admin. */
export async function detachAgent(id, agentGaii) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/agents/${encodeURIComponent(agentGaii)}`);
}

/** Add admin. */
export async function addAdmin(id, targetGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/admins`, { target_ghii: targetGhii });
}

/** Remove admin. */
export async function removeAdmin(id, ghii) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/admins/${encodeURIComponent(ghii)}`);
}

// ── Workspace (manifest-driven; a "project" = an organism with a manifest) ──

/** Object types in the shipped "project" template (mirror of docs/csm-bundles/project/). */
export const PROJECT_OBJECT_TYPES = [
  { name: 'goal',        namespace: 'meta.goals',          writeRole: 'owner',  versioned: true },
  { name: 'plan',        namespace: 'meta.plans',          writeRole: 'owner',  versioned: true },
  { name: 'deliverable', namespace: 'shared.deliverables', writeRole: 'member', versioned: true },
  { name: 'decision',    namespace: 'meta.decisions',      writeRole: 'member', versioned: false, append: true },
  { name: 'resource',    namespace: 'shared.resources',    writeRole: 'member', versioned: true },
];

/** Compiled JSON Schemas per object type (mirror of the bundle CSMs). */
export const PROJECT_SCHEMAS = {
  'meta.goals': { type: 'object', required: ['id', 'title', 'status'], properties: {
    id: { type: 'string', minLength: 1 }, title: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['open', 'met', 'dropped'] },
    definitionOfDone: { type: 'array', items: { type: 'string' } }, gateId: { type: 'string' } } },
  'meta.plans': { type: 'object', required: ['id', 'approach', 'version', 'status'], properties: {
    id: { type: 'string', minLength: 1 }, approach: { type: 'string', minLength: 1 },
    version: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['proposed', 'approved', 'superseded'] },
    steps: { type: 'array', items: { type: 'string' } }, gateId: { type: 'string' } } },
  'shared.deliverables': { type: 'object', required: ['id', 'title', 'status'], properties: {
    id: { type: 'string', minLength: 1 }, title: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['proposed', 'in_progress', 'delivered', 'accepted', 'rejected'] },
    description: { type: 'string' }, acceptanceCriteria: { type: 'array', items: { type: 'string' } } } },
  'meta.decisions': { type: 'object', required: ['ts', 'kind', 'by', 'summary'], properties: {
    ts: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['decision', 'plan-change', 'deliverable', 'rating'] },
    by: { type: 'string', minLength: 1 }, summary: { type: 'string', minLength: 1 } } },
  'shared.resources': { type: 'object', required: ['id', 'kind', 'label', 'origin', 'pointer', 'visibility'], properties: {
    id: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['doc', 'code', 'asset', 'knowledge', 'link'] },
    label: { type: 'string', minLength: 1 }, origin: { type: 'string', enum: ['local', 'referenced', 'link'] },
    pointer: { type: 'string', minLength: 1 }, visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'] } } },
};

function projectManifest(orgId, name, summary) {
  return {
    manifestVersion: '1.0', id: orgId, name, kind: 'project', language: 'en',
    summary: summary || '', status: 'active',
    entry: { readme: `organism.${orgId}.meta.readme`, loadHint: 'readme -> goals -> plans -> deliverables -> decisions' },
    objectTypes: PROJECT_OBJECT_TYPES.map(ot => ({
      name: ot.name, schemaRef: `schema:project/${ot.name}@1`, namespace: ot.namespace,
      cardinality: 'many', backing: 'memory', writeRole: ot.writeRole,
      ...(ot.append ? { append: true } : {}), versioned: ot.versioned,
    })),
    policy: { agentAutonomy: 'L3', alwaysGate: ['external-release', 'spend', 'data-egress', 'data-model-change'] },
  };
}

/** Fetch the managed "manifest architect" prompt (the generator's instruction set). */
export async function getManifestArchitectPrompt() {
  try {
    const resp = await apiGet('/v1/portal/prompts/manifest-architect');
    return resp?.data?.prompt || '';
  } catch { return ''; }
}

/* Self-contained, positively-framed one-shot prompt for the workspace generator (and the
 * copy-into-any-AI-chat path). Kept separate from the interactive `manifest-architect` prompt,
 * whose interview + CSM-YAML output would contradict the single-JSON-object contract here. */
const GENERATOR_PROMPT = `You are the AIMEAT Workspace Architect. Design a workspace from the user's request and respond with exactly one JSON object — your reply begins with { and ends with }.

A workspace is a set of object types. Each type is one of two modes:
- "records" — structured items with consistent fields, validated by a schema. Use this for trackable things: milestones, tasks, risks, contacts, decisions.
- "document" — free-form markdown that grows organically, with no schema. Use this whenever the user asks for documents, a wiki, notes, guides, design docs, or an open / free-form format.

Respond with this shape:
{
  "manifest": {
    "manifestVersion": "1.0",
    "id": "",
    "name": "<short workspace name>",
    "kind": "<short-kebab-case kind, e.g. game-dev>",
    "status": "active",
    "objectTypes": [ <one entry per type> ],
    "i18n": { <UI labels per language — see below> },
    "policy": { "agentAutonomy": "L3", "alwaysGate": [] }
  },
  "schemas": { <one JSON Schema per RECORDS type, keyed by that type's namespace> },
  "examples": { <1-3 sample records per RECORDS type, keyed by that type's namespace> }
}

Give every objectType all of these fields:
- "name": a short singular noun, e.g. "milestone" or "design-doc".
- "description": one short sentence on what this space is for — the workspace UI shows it under the space's title so a reader knows what belongs here.
- "schemaRef": a label string you choose, e.g. "schema:milestone@1". Include it for every type, documents included.
- "namespace": exactly "shared.<plural>" for collaborative data, or "meta.<plural>" for owner-controlled data — e.g. "shared.milestones", "meta.decisions". The namespace is just that prefix plus the plural name; keep it to those two forms.
- "backing": "memory".
- "writeRole": "member" (any member writes), "admin", or "owner".
- "cardinality": "many".
- "versioned": true.
- "mode": "records" or "document".

For each RECORDS type, add a JSON Schema under "schemas" keyed by its namespace:
{ "type": "object", "required": ["id", ...], "properties": { "id": { "type": "string" }, ... } }
Give every record an "id" string property. Use "enum" for status-like fields and "format": "date" (or "date-time") for date fields.
Also, for each property:
- Give every property except "id" a short English "description" telling a human what to fill in.
- Result fields that an agent or automation fills later (e.g. result_ref, output links, error details) get "readOnly": true — the form hides them from humans. Never list a readOnly field in "required".
- Fields that should default to the acting user's identity (e.g. requested_by, created_by, author) get "x-default": "currentUser".

Inside "manifest", add an "i18n" object with UI labels: one entry per language — always "en", plus the language of the user's request if different. Keys are flat strings:
- "<namespace>.<field>": a short human label for that field
- "<namespace>.<field>.hint": one short sentence telling the user what to enter
- "type.<objectType name>": a short plural label for that type's tab
- "type.<objectType name>.desc": one short sentence on what this space is for (the localized form of the objectType "description")
Example: "i18n": { "en": { "shared.milestones.title": "Title", "shared.milestones.title.hint": "A short name for the milestone", "type.milestone": "Milestones", "type.milestone.desc": "Project milestones and their status" }, "fi": { "shared.milestones.title": "Otsikko", "shared.milestones.title.hint": "Lyhyt nimi virstanpylväälle", "type.milestone": "Virstanpylväät", "type.milestone.desc": "Projektin virstanpylväät ja niiden tila" } }
Cover every field of every RECORDS type (labels + hints) and every objectType (type.<name> + type.<name>.desc) in every language you include.

For each DOCUMENT type, the content is free markdown — keep it out of "schemas" and "examples" (a document needs neither).

Under "examples", add 1-3 realistic sample records per RECORDS type, with ids like "example-1", each valid against that type's schema.

Worked example — request "track game milestones plus free-form design docs":
{
  "manifest": {
    "manifestVersion": "1.0", "id": "", "name": "Game Project", "kind": "game-dev", "status": "active",
    "objectTypes": [
      { "name": "milestone", "description": "Project milestones and their status", "schemaRef": "schema:milestone@1", "namespace": "shared.milestones", "backing": "memory", "writeRole": "member", "cardinality": "many", "versioned": true, "mode": "records" },
      { "name": "design-doc", "description": "Free-form design documents", "schemaRef": "schema:design-doc@1", "namespace": "shared.design-docs", "backing": "memory", "writeRole": "member", "cardinality": "many", "versioned": true, "mode": "document" }
    ],
    "i18n": {
      "en": { "type.milestone": "Milestones", "type.milestone.desc": "Project milestones and their status", "type.design-doc": "Design docs", "type.design-doc.desc": "Free-form design documents", "shared.milestones.title": "Title", "shared.milestones.title.hint": "A short name for the milestone", "shared.milestones.status": "Status", "shared.milestones.status.hint": "Where this milestone stands", "shared.milestones.due_date": "Due date", "shared.milestones.due_date.hint": "When this should be done" },
      "fi": { "type.milestone": "Virstanpylväät", "type.milestone.desc": "Projektin virstanpylväät ja niiden tila", "type.design-doc": "Suunnitteludokumentit", "type.design-doc.desc": "Vapaamuotoiset suunnitteludokumentit", "shared.milestones.title": "Otsikko", "shared.milestones.title.hint": "Lyhyt nimi virstanpylväälle", "shared.milestones.status": "Tila", "shared.milestones.status.hint": "Missä vaiheessa tämä on", "shared.milestones.due_date": "Määräpäivä", "shared.milestones.due_date.hint": "Milloin tämän pitäisi olla valmis" }
    },
    "policy": { "agentAutonomy": "L3", "alwaysGate": [] }
  },
  "schemas": {
    "shared.milestones": { "type": "object", "required": ["id", "title", "status"], "properties": { "id": { "type": "string" }, "title": { "type": "string", "description": "A short name for the milestone" }, "status": { "type": "string", "enum": ["planned", "in-progress", "done"], "description": "Where this milestone stands" }, "due_date": { "type": "string", "format": "date", "description": "When this should be done" } } }
  },
  "examples": {
    "shared.milestones": [ { "id": "example-1", "title": "Vertical slice", "status": "planned", "due_date": "2026-09-01" } ]
  }
}

Match the user's domain and language. Respond with the JSON object only.`;

/** The system instructions for the one-shot generator + the copy-into-any-AI-chat path. */
export async function generatorSystemPrompt() {
  return GENERATOR_PROMPT;
}

/** Frame the request — when restructuring an existing workspace, give the AI the current manifest
 *  so it EXTENDS rather than starts over (additive: keep existing types unless told to remove). */
function frameRequest(description, currentManifest) {
  const req = description || '(describe the workspace you want)';
  if (!currentManifest) return req;
  return `Current manifest — EXTEND it: keep its existing objectTypes and their namespaces unless I explicitly ask to remove them, and add what I describe.\n${JSON.stringify(currentManifest)}\n\nWhat to change or add: ${req}`;
}

/** The full text to copy into any AI chat (instructions + the user's request). */
export async function buildGeneratorPrompt(description, currentManifest) {
  return (await generatorSystemPrompt()) + `\n\nUser request: ${frameRequest(description, currentManifest)}`;
}

/** Parse an AI response into { manifest, schemas } — strips markdown fences + surrounding prose. */
export function parseGenerated(text) {
  const stripped = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let json;
  try { json = JSON.parse(stripped); }
  catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON object found in the response');
    json = JSON.parse(m[0]);
  }
  if (!json.manifest || !json.schemas) throw new Error('Response is missing "manifest" or "schemas"');
  return json;
}

/** Call the AI and return the RAW content string (the caller shows + validates it).
 *  Uses a long timeout (slow free models can take minutes) and no retry on timeout. */
export async function generateRaw(description, currentManifest) {
  const resp = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({
      prompt: frameRequest(description, currentManifest),
      systemPrompt: await generatorSystemPrompt(),
      modelRole: 'execution',
      app_id: 'organism-workspace',
    }),
    timeoutMs: 600_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp?.error?.message || 'AI call failed'); e.code = resp?.error?.code; throw e; }
  return String(resp?.data?.content || '');
}

/** Archive / unarchive organism content (creator/admin). `target` = { level, ws?, namespace?, key? }.
 *  Archived content is read-only and hidden from AI materials (overview/read/search) but stays in the
 *  archive search; archiving a container cascades, unarchiving uses smart restore. */
export async function archiveContent(orgId, target) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/archive`, target);
}
export async function unarchiveContent(orgId, target) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/unarchive`, target);
}

/** Delete a workspace entirely — removes all organism.{id}.* memory + its schema locks. The
 *  organism stays (returns to "no workspace yet"). Deliberate typed-confirmation lives in the UI. */
export async function deleteWorkspace(orgId, wsId) {
  const r = await apiDelete(`/v1/organisms/${encodeURIComponent(orgId)}/workspace?ws=${encodeURIComponent(wsId)}`);
  // Drop the registry entry so the deleted workspace no longer lists.
  const list = await listWorkspaces(orgId);
  await saveWorkspaceRegistry(orgId, list.filter(w => w.id !== wsId)).catch(() => {});
  return r;
}

/** Client-side validation of a parsed { manifest, schemas }. Returns an array of human-readable
 *  errors (empty = valid). Mirrors the backend manifest-format rules so we validate BEFORE saving. */
export function validateGenerated(generated) {
  const errors = [];
  const m = (generated && generated.manifest) || {};
  const schemas = (generated && generated.schemas) || {};
  if (!m.manifestVersion) errors.push('manifest.manifestVersion is required');
  if (!m.name) errors.push('manifest.name is required');
  if (!m.kind) errors.push('manifest.kind is required');
  if (!['active', 'paused', 'done', 'archived'].includes(m.status)) errors.push('manifest.status must be one of: active, paused, done, archived');
  const ots = Array.isArray(m.objectTypes) ? m.objectTypes : [];
  if (ots.length === 0) errors.push('manifest.objectTypes must have at least one entry');
  // 'storage'/'knowledge' are NOT valid backings: files and knowledge packages attach via workspace
  // Sources or document images, never as a backed space (the server gate rejects them too).
  const backings = ['memory', 'tasks'];
  const roles = ['owner', 'admin', 'member'];
  for (const ot of ots) {
    const n = (ot && ot.name) || '(unnamed)';
    if (!ot || !ot.name) errors.push('an objectType is missing "name"');
    if (!ot || !ot.schemaRef) errors.push(`objectType "${n}" is missing "schemaRef" (any label string, e.g. "schema:${n}@1")`);
    if (!ot || !ot.namespace) errors.push(`objectType "${n}" is missing "namespace"`);
    else if (!/^(meta|shared|member)\./.test(ot.namespace)) errors.push(`objectType "${n}" namespace must start with "meta." or "shared." (got "${ot.namespace}")`);
    if (!ot || !backings.includes(ot.backing)) errors.push(`objectType "${n}" backing must be one of: ${backings.join(', ')}`);
    if (!ot || !roles.includes(ot.writeRole)) errors.push(`objectType "${n}" writeRole must be one of: ${roles.join(', ')}`);
    if (ot && ot.cardinality && !['one', 'many'].includes(ot.cardinality)) errors.push(`objectType "${n}" cardinality must be "one" or "many"`);
    if (ot && ot.backing === 'memory' && ot.mode !== 'document' && !schemas[ot.namespace]) errors.push(`no schema provided for memory objectType "${n}" (namespace "${ot.namespace}")`);
  }
  for (const [ns, sc] of Object.entries(schemas)) {
    if (!sc || typeof sc !== 'object' || sc.type !== 'object') errors.push(`schema "${ns}" must be a JSON Schema object with type:"object"`);
  }
  return errors;
}

/** A prompt the user can paste back to their AI chat to fix the listed validation problems. */
export function buildFixPrompt(jsonText, errors) {
  return `The JSON you produced for an AIMEAT workspace has validation problems. Fix ONLY these issues and output the corrected JSON object again (with "manifest" and "schemas"), no prose, no markdown fences.

Problems:
${(errors || []).map(e => '- ' + e).join('\n')}

The JSON you produced:
${jsonText}`;
}

/** Apply a generated (or any) workspace to an organism: register its schemas + write the manifest. */
/** Key root for one workspace — an organism holds many workspaces under organism.{id}.w.{wsId}. */
export function wsRoot(orgId, wsId) { return `organism.${orgId}.w.${wsId}`; }

export async function applyGeneratedWorkspace(orgId, wsId, generated) {
  const root = wsRoot(orgId, wsId);
  for (const [namespace, schema] of Object.entries(generated.schemas || {})) {
    // 'open' (not 'strict'): generated schemas enforce required fields + types but TOLERATE extra fields,
    // so later autonomous/agent writes aren't silently rejected over a stray property. The generator
    // pre-locks structure before any real content exists; strict betoni fights every later write.
    await apiPut(`/v1/memory/${encodeURIComponent(`${root}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'open' });
  }
  const manifest = { ...generated.manifest, id: orgId, status: generated.manifest.status || 'active' };
  await apiPost('/v1/memory', { key: `${root}.meta.manifest`, value: manifest, visibility: 'private' });
  await apiPost('/v1/memory', { key: `${root}.meta.readme`, value: `# ${manifest.name || 'Workspace'}\n\n${manifest.summary || ''}`, visibility: 'private' });
  // Write any example instances as DRAFTS (clearly not-yet-published samples). Best-effort: a
  // sample that doesn't validate is skipped, not fatal.
  let n = 0;
  for (const [namespace, items] of Object.entries(generated.examples || {})) {
    if (!Array.isArray(items)) continue;
    for (const item of items.slice(0, 5)) {
      n++;
      const id = String((item && item.id) || `example-${n}`).replace(/[^a-zA-Z0-9_-]/g, '-');
      await apiPost('/v1/memory', { key: `${root}.${namespace}.${id}.draft`, value: { ...item, id }, visibility: 'private' }).catch(() => {});
    }
  }
}

/** Apply the project template to a workspace (register schemas + write the manifest + readme). */
export async function applyProjectTemplate(orgId, wsId, name, summary) {
  const root = wsRoot(orgId, wsId);
  for (const [namespace, schema] of Object.entries(PROJECT_SCHEMAS)) {
    // 'open' (not 'strict'): generated schemas enforce required fields + types but TOLERATE extra fields,
    // so later autonomous/agent writes aren't silently rejected over a stray property. The generator
    // pre-locks structure before any real content exists; strict betoni fights every later write.
    await apiPut(`/v1/memory/${encodeURIComponent(`${root}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'open' });
  }
  await apiPost('/v1/memory', { key: `${root}.meta.manifest`, value: projectManifest(orgId, name, summary), visibility: 'private' });
  await apiPost('/v1/memory', { key: `${root}.meta.readme`, value: `# ${name}\n\n${summary || ''}`, visibility: 'private' });
}

/** Participants of a workspace — node → owner → agents, derived from record traces + membership.
 *  Agent names are revealed only for the caller's own agents (others come back anonymized). */
export async function getWorkspaceParticipants(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/participants?ws=${encodeURIComponent(wsId)}`);
    return r?.data || { nodes: [], viewerOwner: '' };
  } catch { return { nodes: [], viewerOwner: '' }; }
}

/** Build the participants chart: which node each identity comes from, who is human, and whose agent
 *  each agent is. The caller's own agents are named; everyone else's are ghost "agent" boxes. */
export function buildParticipantsMermaid(data) {
  const nodes = (data && data.nodes) || [];
  if (!nodes.length) return '';
  const out = ['graph TD'];
  let oi = 0, ai = 0;
  nodes.forEach((n, ni) => {
    const nid = 'N' + ni;
    out.push(`  ${nid}["🖥 ${mlbl(n.id)}${n.isLocal ? '' : ' · 🌐'}"]`);
    (n.owners || []).forEach((o) => {
      const oid = 'O' + (oi++);
      const tag = o.isSelf ? ' · you' : (o.isCreator ? ' · creator' : (o.isMember ? '' : ' · guest'));
      out.push(`  ${oid}(["👤 ${mlbl(o.owner)}${tag}"])`);
      out.push(`  ${nid} --> ${oid}`);
      (o.agents || []).forEach((a) => {
        const aid = 'A' + (ai++);
        out.push(`  ${aid}["🤖 ${mlbl(a.name)} · ${a.contributions}"]`);
        // Own agents get a solid edge; everyone else's a dashed edge (greyed — trace only, no live status).
        out.push(a.isOwn ? `  ${oid} --> ${aid}` : `  ${oid} -.-> ${aid}`);
      });
    });
  });
  return out.join('\n');
}

/** Activity feed for a workspace (who did what / where / draft-edit vs publish / when). */
export async function getWorkspaceActivity(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/activity?ws=${encodeURIComponent(wsId)}`);
    return r?.data || { events: [], total: 0 };
  } catch { return { events: [], total: 0 }; }
}

/** Read the manifest-driven workspace. Returns null if the workspace has no manifest yet. */
export async function getWorkspace(orgId, wsId, opts) {
  let url = `/v1/organisms/${encodeURIComponent(orgId)}/workspace?ws=${encodeURIComponent(wsId)}`;
  if (opts?.archived === 'only') url += '&archived=only';
  else if (opts?.includeArchived) url += '&includeArchived=true';
  const resp = await apiGet(url);
  return resp?.data || null;
}

/** OKF-style STRUCTURE OVERVIEW (Markdown) of the whole organism — every workspace's space
 *  breakdown + totals, deterministic, size-bounded. Returns '' on failure (caller shows a notice). */
export async function getOrganismOverview(orgId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/overview`);
    return r?.data?.markdown || '';
  } catch { return ''; }
}

/** OKF-style STRUCTURE OVERVIEW (Markdown) of ONE workspace — per space the most-recent entries
 *  (ids + titles) and totals. Returns '' on failure. */
export async function getWorkspaceOverview(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/overview?ws=${encodeURIComponent(wsId)}`);
    return r?.data?.markdown || '';
  } catch { return ''; }
}

/** Full workspace overview payload in ONE call: the OKF markdown PLUS the measurability `objectives`
 *  (each KPI with its resolved `current` — computed from records where the source allows, else the
 *  declared value). Lets a caller render both the table-of-contents seed and the objectives card
 *  without two requests to the same endpoint. Returns safe empties on failure. */
export async function getWorkspaceOverviewFull(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/overview?ws=${encodeURIComponent(wsId)}`);
    return { markdown: r?.data?.markdown || '', objectives: Array.isArray(r?.data?.objectives) ? r.data.objectives : [], readable: r?.data?.readable !== false };
  } catch { return { markdown: '', objectives: [], readable: false }; }
}

/** Deterministic GRAPH of the whole organism (workspaces → spaces + counts/last-activity, members,
 *  agents) — the data behind the interactive mindmap. Returns null on failure. */
export async function getOrganismGraph(orgId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/graph`);
    return r?.data?.graph || null;
  } catch { return null; }
}

/** Deterministic GRAPH of ONE workspace (root = workspace, with its spaces). Returns null on failure. */
export async function getWorkspaceGraph(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/graph?ws=${encodeURIComponent(wsId)}`);
    return r?.data?.graph || null;
  } catch { return null; }
}

/** Organism STRUCTURE TIMELINE: { current, history } — the trackable structure fingerprint's current
 *  value + archived prior versions (newest first). Returns { current: null, history: [] } on failure. */
export async function getStructureHistory(orgId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/structure/history`);
    return r?.data || { current: null, history: [] };
  } catch { return { current: null, history: [] }; }
}

/** Save a workspace's free-form README (markdown). Creator/admin only (enforced server-side). */
export async function saveWorkspaceReadme(orgId, wsId, readme) {
  return apiPut(`/v1/organisms/${encodeURIComponent(orgId)}/workspace?ws=${encodeURIComponent(wsId)}`, { ws: wsId, readme });
}

/** Overwrite a workspace's manifest (e.g. edited name/summary/policy from Settings). */
export async function saveManifest(orgId, wsId, manifest) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.manifest`, value: manifest, visibility: 'private' });
}

/* ── Workspace registry: one organism lists its workspaces at organism.{id}.meta.workspaces =
 *    { workspaces: [{ id, name, createdAt }] }. A workspace appears here even before it has a
 *    manifest (so a freshly-created, not-yet-generated workspace is openable). ── */

/** List an organism's workspaces (registry order). */
export async function listWorkspaces(orgId) {
  const key = `organism.${orgId}.meta.workspaces`;
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(key)}`);
    const item = (resp?.data?.items || []).find(i => i.key === key);
    const list = Array.isArray(item?.value?.workspaces) ? item.value.workspaces : [];
    // Names are plain text; legacy import paths stored them HTML-escaped. Decode for display.
    return list.map(w => (w && w.name ? { ...w, name: decodeEntities(w.name) } : w));
  } catch { return []; }
}

/** Persist the workspace registry. */
export async function saveWorkspaceRegistry(orgId, workspaces) {
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.workspaces`, value: { workspaces }, visibility: 'private' });
}

/* ── Workspace access (per-workspace, creator-controlled, consent-backed) ──
 * Organism membership lets you DISCOVER every workspace (names + creator + your access status);
 * reading a workspace's content needs the creator's approval. ── */

/** Discover all workspaces in the org with your access status ('owner' | 'granted' | 'none').
 *  opts.include='enrichment' folds the per-workspace getWorkspace+activity+participants fan-out into
 *  one response: each readable row gains `enrichment:{hasManifest,recs,docs,lastEvent,participants,pendingReviews}`. */
export async function discoverWorkspaces(orgId, opts = {}) {
  try {
    const qs = opts.include ? `?include=${encodeURIComponent(opts.include)}` : '';
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspaces${qs}`);
    const list = Array.isArray(resp?.data?.workspaces) ? resp.data.workspaces : [];
    // Names are plain text; legacy import paths stored them HTML-escaped. Decode for display.
    return list.map(w => (w && w.name ? { ...w, name: decodeEntities(w.name) } : w));
  } catch { return []; }
}

/** Request access to a workspace you can see but not read. */
export async function requestWorkspaceAccess(orgId, ws, message) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access`, { ws, message: message || '' });
}

/** List access requests for a workspace you created (creator/admin only). */
export async function listWorkspaceRequests(orgId, ws) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access?ws=${encodeURIComponent(ws)}`);
    return Array.isArray(resp?.data?.requests) ? resp.data.requests : [];
  } catch { return []; }
}

/** Approve or deny a member's access request to your workspace. decision: 'approve'|'deny'|'viewer'|'contributor'. */
export async function decideWorkspaceAccess(orgId, ws, requester, decision) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/decision`, { ws, requester, decision });
}

/** Full access state for a workspace you manage: pending requests + current members with their roles. */
export async function getWorkspaceAccess(orgId, ws) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access?ws=${encodeURIComponent(ws)}`);
    return { requests: Array.isArray(resp?.data?.requests) ? resp.data.requests : [], members: Array.isArray(resp?.data?.members) ? resp.data.members : [] };
  } catch { return { requests: [], members: [] }; }
}

/** Access rosters for ALL of my owned workspaces in one request (Members tab — replaces a per-owned-
 *  workspace getWorkspaceAccess fan-out). Returns [{ ws, name, members, requests }]. */
export async function getWorkspaceAccessAll(orgId) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access?all=1`);
    return Array.isArray(resp?.data?.workspaces) ? resp.data.workspaces : [];
  } catch { return []; }
}

/** Directly add (or re-role) a member: role 'viewer' (read) | 'contributor' (read+write). grantee = an
 *  owner name, GHII, or GAII — the grant applies to that owner (so all their agents inherit it). */
export async function grantWorkspaceRole(orgId, ws, grantee, role) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/grant`, { ws, grantee, role });
}

/** Remove a member's access to a workspace you manage. */
export async function revokeWorkspaceRole(orgId, ws, grantee) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/revoke`, { ws, grantee });
}

/* ── Public document-space sharing (meta.share) ──
 * Independent of the access roles above: this controls what PUBLISHED document-space pages are
 * readable by ANYONE with the public viewer link (no login). Creator/admin manages it. ── */

/** Current public-sharing state: { public, spaces: {name:bool}, docs: {"type/id":bool} }. */
export async function getWorkspaceShare(orgId, ws) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/share?ws=${encodeURIComponent(ws)}`);
    const s = resp?.data?.share || {};
    return { public: !!s.public, spaces: s.spaces || {}, docs: s.docs || {} };
  } catch { return { public: false, spaces: {}, docs: {} }; }
}

/** Merge a patch ({ public?, spaces?, docs? }) into the workspace's public-sharing state. */
export async function setWorkspaceShare(orgId, ws, patch) {
  const resp = await apiPut(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/share?ws=${encodeURIComponent(ws)}`, patch);
  const s = resp?.data?.share || {};
  return { public: !!s.public, spaces: s.spaces || {}, docs: s.docs || {} };
}

/** The public, no-login viewer URL for a workspace (whole space) or a single document. */
export function publicViewerUrl(orgId, ws, doc) {
  const base = `/v1/publicworkspaceviewer?org=${encodeURIComponent(orgId)}&ws=${encodeURIComponent(ws)}`;
  return doc ? `${base}&type=${encodeURIComponent(doc.type)}&id=${encodeURIComponent(doc.id)}` : base;
}

/** Create a new (empty) workspace: register it, return its { id, name }. The manifest is written
 *  later by setup/generate. */
export async function createWorkspace(orgId, name) {
  const id = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const createdBy = (currentGhii().split('@')[0]) || '';   // bare owner name — who controls this workspace's access
  const entry = { id, name: String(name || '').trim() || 'Workspace', createdAt: new Date().toISOString(), createdBy };
  const list = await listWorkspaces(orgId);
  await saveWorkspaceRegistry(orgId, [...list, entry]);
  return entry;
}

/** kebab-case a free-typed name into a safe namespace segment / type name. */
function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

// ── Deterministic Mermaid charts (built from stable workspace/organism data — no AI) ──

/** Sanitise a label for a Mermaid node (strip chars that break the syntax; keep it single-line). */
function mlbl(s) {
  const t = String(s == null ? '' : s).replace(/["[\]{}|<>;`\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (t.length > 96 ? t.slice(0, 95).replace(/\s+\S*$/, '') + '…' : t) || '—';
}

/** Chart 1 — organism dependency overview: who/what uses this organism. Async (aggregates members,
 *  agents, workspaces + their structure, and knowledge packages). Returns Mermaid source text. */
export async function buildOrganismOverviewMermaid(orgId) {
  const nodeId = (currentGhii().split('@')[1]) || '';
  const [orgResp, memResp, wsList] = await Promise.all([
    getOrganism(orgId).catch(() => null),
    listMembers(orgId).catch(() => null),
    listWorkspaces(orgId).catch(() => []),
  ]);
  const org = orgResp?.data?.organism || {};
  const members = memResp?.data?.members || [];
  const agents = org.agentGaiis || [];
  const wsData = [];
  for (const w of wsList) {
    const ws = await getWorkspace(orgId, w.id).catch(() => null);
    const sources = await getWorkspaceSources(orgId, w.id).catch(() => []);
    const types = (ws?.manifest?.objectTypes || []).filter(isMemorySpace)
      .map(o => `${o.name} (${isDocSpace(o) ? 'doc' : 'rec'})`);
    const knowledge = sources.filter(s => s.type === 'knowledge').map(s => s.label || s.packageId);
    wsData.push({ name: w.name || w.id, types, knowledge });
  }

  const nodes = [`  ORG(["🏢 ${mlbl(org.name || orgId)}"])`];
  const edges = [];
  const externalIds = new Set();

  if (members.length) {
    nodes.push('  subgraph USERS["👥 Users"]', '  direction TB');
    members.forEach((m, i) => {
      // External = a member whose GHII names a DIFFERENT node (federated). Local members are keyed by
      // the bare owner name (no @node), so only an explicit @other-node counts as external.
      const isExt = !!m.ghii && m.ghii.includes('@') && !!nodeId && !m.ghii.endsWith('@' + nodeId);
      if (isExt) externalIds.add('U' + i);
      nodes.push(`    U${i}["👤 ${mlbl(m.ghii)}${m.role ? ' · ' + mlbl(m.role) : ''}${isExt ? ' · 🌐 external' : ''}"]`);
    });
    nodes.push('  end');
    members.forEach((m, i) => edges.push(externalIds.has('U' + i) ? `  U${i} -. consent .-> ORG` : `  U${i} --> ORG`));
  }
  if (agents.length) {
    nodes.push('  subgraph AGENTS["🤖 Agents"]', '  direction TB');
    agents.forEach((a, i) => nodes.push(`    A${i}["🤖 ${mlbl(a)}"]`));
    nodes.push('  end');
    agents.forEach((a, i) => edges.push(`  A${i} --> ORG`));
  }

  const kmap = new Map();   // knowledge label -> node id
  for (const w of wsData) for (const k of w.knowledge) if (!kmap.has(k)) kmap.set(k, 'K' + kmap.size);
  if (kmap.size) {
    nodes.push('  subgraph KNOWLEDGE["📚 Knowledge packages"]', '  direction TB');
    for (const [label, kid] of kmap) nodes.push(`    ${kid}["📚 ${mlbl(label)}"]`);
    nodes.push('  end');
  }
  if (wsData.length) {
    nodes.push('  subgraph WORKSPACES["🗂️ Workspaces"]', '  direction TB');
    wsData.forEach((w, i) => {
      nodes.push(`    W${i}["🗂️ ${mlbl(w.name)}"]`);
      if (w.types.length) nodes.push(`    W${i}S["${mlbl(w.types.join(' · '))}"]`);
    });
    nodes.push('  end');
    wsData.forEach((w, i) => {
      edges.push(`  ORG --> W${i}`);
      if (w.types.length) edges.push(`  W${i} --> W${i}S`);
      for (const k of w.knowledge) edges.push(`  W${i} -. uses .-> ${kmap.get(k)}`);
    });
  }
  if (!members.length && !agents.length && !wsData.length) {
    edges.push('  EMPTY["No members, agents or workspaces yet"] --> ORG');
  }
  return ['graph LR', ...nodes, ...edges].join('\n');
}

/** Chart 2 — the edit→publish lifecycle this workspace's manifest defines (deterministic). Records
 *  are schema-validated; the publish gate + the manifest's policy.alwaysGate add a review step. */
export function buildEditFlowMermaid(manifest, gateOn) {
  const types = (manifest?.objectTypes || []).filter(isMemorySpace);
  const recTypes = types.filter(o => !isDocSpace(o)).map(o => o.name);
  const docTypes = types.filter(isDocSpace).map(o => o.name);
  const alwaysGate = (manifest?.policy && manifest.policy.alwaysGate) || [];

  const L = ['flowchart LR'];
  L.push('  START(["Pick what to edit"])');
  if (recTypes.length) L.push(`  REC["📋 Records: ${mlbl(recTypes.join(', '))} · schema form"]`);
  if (docTypes.length) L.push(`  DOC["📄 Documents: ${mlbl(docTypes.join(', '))} · free-form markdown"]`);
  L.push('  DRAFT["✏️ Save as DRAFT · working copy"]');
  if (gateOn) L.push('  GATE{"🔍 Owner review · publish gate on"}');
  L.push('  PUB["✅ Publish"]');
  L.push('  VER["📌 .version.N + .latest"]');

  if (recTypes.length) L.push('  START --> REC --> DRAFT');
  if (docTypes.length) L.push('  START --> DOC --> DRAFT');
  if (!recTypes.length && !docTypes.length) L.push('  START --> DRAFT');
  if (gateOn) { L.push('  DRAFT --> GATE'); L.push('  GATE -- approve --> PUB'); L.push('  GATE -- reject --> DRAFT'); }
  else L.push('  DRAFT --> PUB');
  L.push('  PUB --> VER');
  L.push('  VER -. edit again .-> DRAFT');
  if (alwaysGate.length) { L.push(`  NOTE["⚠️ Always needs approval: ${mlbl(alwaysGate.join(', '))}"]`); L.push(`  NOTE -.-> ${gateOn ? 'GATE' : 'PUB'}`); }
  return L.join('\n');
}

// ── Access prompt: a copy-paste prompt teaching an AI/agent how to use THIS workspace ──
// Bridges the MCP gap (no workspace-aware tools yet) by injecting the real structure + the exact
// conventions. Two variants: 'human' (paste into a chat) and 'agent' (imperative, assumes tools).

/** Format one objectType's full schema for the prompt's STRUCTURE block. */
function describeType(ot, schema) {
  if (isDocSpace(ot)) {
    return `• ${ot.name} (document) — namespace "${ot.namespace}". Free-form markdown pages { id, title, markdown }, organised into sections (read organism.{id}.w.{ws}.meta.sections.${ot.name}).`;
  }
  const props = (schema && schema.properties) || {};
  const req = new Set((schema && schema.required) || []);
  const fields = Object.entries(props).map(([k, d]) => {
    const bits = [d.type || 'string'];
    if (req.has(k)) bits.push('required');
    if (Array.isArray(d.enum)) bits.push('enum: ' + d.enum.join(' | '));
    if (d.type === 'array' && d.items?.type) bits.push('of ' + d.items.type);
    return `    - ${k} (${bits.join(', ')})`;
  });
  return `• ${ot.name} (records) — namespace "${ot.namespace}", writeRole ${ot.writeRole || 'member'}. Fields:\n${fields.join('\n') || '    (no schema)'}`;
}

/** Build the workspace-access prompt for an AI/agent. variant: 'human' | 'agent'. Async — fetches
 *  each records-type's schema so the FULL field list is inlined. */
export async function buildAccessPrompt(orgId, orgName, wsId, ws, variant = 'human') {
  const nodeUrl = window.location.origin;
  const m = ws?.manifest || {};
  const wsName = m.name || wsId;
  const types = (m.objectTypes || []).filter(isMemorySpace);
  const described = [];
  for (const ot of types) {
    // records is the default mode (mode may be undefined) — fetch the schema unless it's a document.
    const schema = !isDocSpace(ot) ? await getObjectSchema(orgId, wsId, ot.namespace).catch(() => null) : null;
    described.push(describeType(ot, schema));
  }
  const structure = described.join('\n') || '(no spaces declared yet)';

  const access = [
    `- Read the manifest:   aimeat_memory_read key="organism.${orgId}.w.${wsId}.meta.manifest"`,
    `- List everything:     aimeat_memory_list prefix="organism.${orgId}.w.${wsId}." limit=500`,
    `    (keys end in .draft = working copy, .latest = published, .version.N = history)`,
    `- Document sections:   aimeat_memory_read key="organism.${orgId}.w.${wsId}.meta.sections.{type}"`,
    `- Write/refresh a draft: aimeat_memory_write key="organism.${orgId}.w.${wsId}.{namespace}.{id}.draft" value={...}`,
    `- Attach a file/screenshot: aimeat_storage_upload key="organism.${orgId}.w.${wsId}.img.{name}"`,
    `    then embed it in a document's markdown as  ![alt](/v1/storage/<returned key>)`,
    `- Publish a draft:     POST ${nodeUrl}/v1/organisms/${orgId}/publish   body { "ws":"${wsId}", "namespace":"...", "id":"..." }`,
    `    (snapshots .version.N + .latest, consumes the draft; may require operator approval if the publish gate is on)`,
  ].join('\n');

  const intents = [
    `  (a) Status update — read .latest, refresh a status document, publish it.`,
    `  (b) Manage tasks / deliverables — add or edit drafts in a records space, publish when ready.`,
    `  (c) Be a coding agent — pull specs + tasks from here, implement them, then update the task`,
    `      records' status + the related documents + the status page as you go.`,
  ].join('\n');

  if (variant === 'agent') {
    return [
      `TASK: operate an AIMEAT organism workspace. Connect, learn it, interview the operator, then act.`,
      ``,
      `CONNECTION`,
      `- Node: ${nodeUrl}`,
      `- Organism: "${orgName || orgId}"  id: ${orgId}`,
      `- Workspace: "${wsName}"  ws: ${wsId}`,
      `- Use the AIMEAT MCP tools (aimeat_memory_*, aimeat_storage_*) + the REST publish endpoint below.`,
      `  If AIMEAT tools are unavailable, STOP and report — do not invent data.`,
      ``,
      `STEP 1 — LEARN (do before acting; then summarise the structure back):`,
      access,
      ``,
      `STRUCTURE (objectTypes — full schema):`,
      structure,
      ``,
      `STEP 2 — INTERVIEW the operator (ask, don't assume) which of:`,
      intents,
      `  Get specifics: which space, what to change, definition of done.`,
      ``,
      `STEP 3 — ACT (only after the operator confirms). Records: validate against the schema above`,
      `before writing. Keep edits as DRAFTS unless told to publish. The status page is just a document —`,
      `rewrite its markdown and publish.`,
      ``,
      `RULES: never publish without the operator's OK unless told to run autonomously; re-read .latest`,
      `before overwriting (avoid clobbering a newer update); report which keys you wrote and what changed.`,
    ].join('\n');
  }

  return [
    `I'm using an AIMEAT organism workspace and I'd like your help with it. First LEARN its structure,`,
    `then ASK me what I want to do, then help me do it.`,
    ``,
    `CONNECTION`,
    `- Node: ${nodeUrl}`,
    `- Organism: "${orgName || orgId}"  (id: ${orgId})`,
    `- Workspace: "${wsName}"  (ws: ${wsId})`,
    `If you're connected to AIMEAT (its MCP tools), you can read and write this workspace directly.`,
    `If you're not connected, tell me and I'll paste content back and forth manually.`,
    ``,
    `WHAT THIS IS`,
    `A workspace is a set of "spaces". Each space is either a DOCUMENT space (a free-form wiki: markdown`,
    `pages in sections) or a RECORDS space (a schema-locked list, like a form). Items have a working`,
    `DRAFT and, once published, a LATEST version (with history).`,
    ``,
    `STRUCTURE (read this back to me so I know you understand it):`,
    structure,
    ``,
    `HOW TO ACCESS IT (AIMEAT MCP + REST):`,
    access,
    ``,
    `WHAT I MIGHT WANT (ask me which):`,
    intents,
    ``,
    `RULES: keep changes as drafts so I can review; don't publish without my OK; re-read .latest before`,
    `overwriting so you don't clobber a newer update; tell me which keys you wrote and what changed.`,
    ``,
    `Start by reading the manifest + structure, then ask me which of (a)/(b)/(c) and the specifics.`,
  ].join('\n');
}

/** Build a prompt to paste into an AI / coding agent: how to build a CONTRACT AGENT that processes THIS
 *  workspace. The agent owns a contract (inputs/outputs/lifecycle), provisions its spaces, and runs the
 *  request→result loop. Mirrors docs/agent-workspace-contracts.md with this workspace's concrete ids. */
export async function buildContractAgentPrompt(orgId, orgName, wsId, ws) {
  const nodeUrl = window.location.origin;
  const m = ws?.manifest || {};
  const wsName = m.name || wsId;
  const types = (m.objectTypes || []).filter(isMemorySpace);
  const described = [];
  for (const ot of types) {
    const schema = !isDocSpace(ot) ? await getObjectSchema(orgId, wsId, ot.namespace).catch(() => null) : null;
    described.push(describeType(ot, schema));
  }
  const structure = described.join('\n') || '(no spaces declared yet)';
  return [
    `TASK: build an AIMEAT "contract agent" that PROCESSES this workspace — it reads requests, does the`,
    `work, and writes results back. The agent OWNS a contract: the spaces it READS (inputs), the spaces`,
    `it WRITES (outputs), and the status lifecycle. Follow the convention exactly so it appears and works`,
    `smoothly. Full reference: ${nodeUrl}/v1/agents/me/handbook/appdev (the "Workspace contracts" section)`,
    `and docs/agent-workspace-contracts.md.`,
    ``,
    `CONNECTION`,
    `- Node: ${nodeUrl}`,
    `- Organism: "${orgName || orgId}"  id: ${orgId}`,
    `- Workspace: "${wsName}"  ws: ${wsId}`,
    `- Use the AIMEAT MCP tools (aimeat_workspace_*, aimeat_organism_*) or the shell-callable connector`,
    `  (aimeat connect call ...) — no LLM is needed in the I/O path. If AIMEAT tools are unavailable, STOP.`,
    ``,
    `EXISTING SPACES (don't drop or rename these — UNION them with your contract's spaces):`,
    structure,
    ``,
    `1) DEFINE THE CONTRACT (embed it in the agent):`,
    `   contract:`,
    `     id: <capability>                 # e.g. research`,
    `     inputs:                          # what the agent reads + reacts to`,
    `       - space: <name>                # objectType NAME, e.g. research-request`,
    `         mode: records                # records (schema-locked) | document`,
    `         schema: { id, ..., status: requested|in-progress|done|failed, requested_by, result_ref? }`,
    `         trigger: status == 'requested'`,
    `     outputs:                         # what the agent writes`,
    `       - space: <name>                # e.g. research-result`,
    `         mode: records`,
    `         schema: { id, request_ref, ... }`,
    `     lifecycle: requested → in-progress → done (+ result_ref) | failed`,
    ``,
    `2) PROVISION the contract's spaces with add_spaces — the server UNIONS them into the manifest, skips`,
    `   any that already exist, and fills objectType defaults, so you never resend the whole manifest`,
    `   (safe + idempotent). Manifest edits are CREATOR-ONLY: a same-owner agent does this itself; for a`,
    `   cross-owner agent the creator does it.`,
    `       aimeat_workspace_update { organism_id:"${orgId}", ws:"${wsId}",`,
    `         add_spaces: [ { name:"<input-space>",  namespace:"shared.<inputs>",  mode:"records" },`,
    `                       { name:"<output-space>", namespace:"shared.<outputs>", mode:"records" } ],`,
    `         schemas: { "shared.<inputs>": <jsonSchema>, "shared.<outputs>": <jsonSchema> } }`,
    `     → returns { added, skipped }. Pass just { name, namespace, mode } per space; defaults are filled.`,
    ``,
    `3) AUTHORIZE the agent to write (skip for a same-owner agent — it already can):`,
    `   POST ${nodeUrl}/v1/organisms/${orgId}/workspace-access/grant`,
    `     body { "ws":"${wsId}", "grantee":"<agent-owner | agent#owner@node>", "role":"contributor" }`,
    `   (viewer = read only; contributor = read + write. The creator manages this in "Who works here".)`,
    ``,
    `4) RUN THE PROCESSING LOOP (deterministic, repeatable):`,
    `   discover member workspaces (aimeat_organism_list → aimeat_workspace_list) → for each that has your`,
    `   input space: aimeat_workspace_read → find inputs where the trigger holds → CLAIM it`,
    `   (aimeat_workspace_write status:"in-progress" + publish) → do the work → WRITE the output space`,
    `   (aimeat_workspace_write + publish) → ADVANCE the input (status:"done", result_ref:<outId> + publish).`,
    `   On error: set the input status:"failed" with an error field.`,
    ``,
    `5) PROCESS RELIABLY (keep this recurring / idle-hook loop idempotent + bounded — this is what keeps it safe):`,
    `   - Dedup on the OUTPUT first — this is your PRIMARY, durable guard (it survives restarts): create a`,
    `     result for an input only while that input's output is still ABSENT, so an already-fulfilled input`,
    `     is naturally skipped even after a crash/redeploy.`,
    `   - Also keep an in-memory PROCESSED set of the ids you handled THIS run and skip them — but it only`,
    `     lives for the run, so treat it as a backstop to the output-dedup, not a replacement.`,
    `   - Don't trust a status you JUST wrote when you read it back immediately: read-after-write can briefly`,
    `     still show 'requested'. Let your own in-run record decide what's handled, not an instant re-read.`,
    `   - Work a bounded batch each pass (e.g. up to ~5 inputs) and leave the rest for the next cycle —`,
    `     steady, predictable forward progress; one bad state then can't loop unbounded.`,
    `   - Advance each item at one calm cadence: one claim, one result, one status advance per item. NEVER`,
    `     hammer a single record with rapid re-publishes — a burst of writes to one id can briefly stale that`,
    `     namespace's read and feed the exact loop you're avoiding.`,
    `   - For "what changed since X" coordination, prefer the activity-delta primitive`,
    `     (GET ${nodeUrl}/v1/organisms/${orgId}/activity?since=) once it is available, over re-scanning the`,
    `     whole namespace each pass — same picture in one cheap call, so the agent stays light.`,
    ``,
    `RULES: validate every RECORDS write against its schema (a bad write is rejected). NEVER drop/rename an`,
    `existing space. Only the creator/same-owner edits the manifest; a contributor writes records only.`,
    `Writes are attributed to the agent automatically — it appears in "Who works here" + the activity`,
    `heatmap, and its results are visible to everyone who can read the workspace.`,
    ``,
    `Start: read the workspace, decide your input/output spaces, provision them, grant access, run the loop.`,
  ].join('\n');
}

/** Manually add an object type to the manifest (no AI). mode 'document' needs no schema;
 *  'records' gets a starter {id,title} schema that can be refined later via Restructure. */
export async function addSpace(orgId, wsId, manifest, name, mode) {
  const base = slug(name);
  const plural = base.endsWith('s') ? base : base + 's';
  const existing = new Set((manifest.objectTypes || []).map(o => o.namespace));
  let namespace = `shared.${plural}`;
  for (let i = 2; existing.has(namespace); i++) namespace = `shared.${plural}-${i}`;
  const ot = { name: base, schemaRef: `schema:${base}@1`, namespace, backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode };
  if (mode === 'records') {
    await apiPut(`/v1/memory/${encodeURIComponent(`${wsRoot(orgId, wsId)}.${namespace}`)}/schema`, {
      schema: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } },
      apply_to: 'prefix', schema_mode: 'open',   // tolerate extra fields; enforce required/types only (see applyGeneratedWorkspace)
    });
  }
  return saveManifest(orgId, wsId, { ...manifest, objectTypes: [...(manifest.objectTypes || []), ot] });
}

/** Remove an object type from the manifest by name. Its data is left in memory (orphaned, not
 *  deleted) — re-adding the type surfaces it again; a full wipe is the workspace-delete path. */
export async function removeSpace(orgId, wsId, manifest, typeName) {
  return saveManifest(orgId, wsId, { ...manifest, objectTypes: (manifest.objectTypes || []).filter(o => o.name !== typeName) });
}

/** Fetch the JSON Schema registered for an object-type namespace (drives schema-aware forms).
 *  Probes a sub-key so the prefix schema resolves (a prefix schema doesn't self-match its own key). */
export async function getObjectSchema(orgId, wsId, namespace) {
  const key = `${wsRoot(orgId, wsId)}.${namespace}._form`;
  try {
    const resp = await apiGet(`/v1/memory/${encodeURIComponent(key)}/schema`);
    return resp?.data?.has_schema ? resp.data.schema : null;
  } catch { return null; }
}

/** Write/overwrite an object's draft (`…w.{wsId}.{namespace}.{id}.draft`). */
export async function writeDraft(orgId, wsId, namespace, instanceId, value) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.${namespace}.${instanceId}.draft`, value, visibility: 'private' });
}

/** Publish a draft → new version + latest (or a pending approval if the publish gate is on). */
export async function publishDraft(orgId, wsId, namespace, instanceId) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/publish`, { ws: wsId, namespace, id: instanceId });
}

/** Reopen a published record for editing: server copies `.latest` → `.draft` (409 if a draft already
 *  exists). The published version stays live until the edited draft is re-published. */
export async function revertToDraft(orgId, wsId, namespace, instanceId) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/revert`, { ws: wsId, namespace, id: instanceId });
}

/** Delete one workspace object (record or document) — the bare record key, its draft, published
 *  .latest and all .version.N history. Returns the number of keys removed. Prefix `${base}` (no
 *  trailing dot) catches the bare un-suffixed key (which the workspace read surfaces as current);
 *  the per-row guard excludes sibling ids. limit=200 is the REST cap — re-run for a huge version
 *  history (idempotent). */
export async function deleteWorkspaceObject(orgId, wsId, namespace, id) {
  const base = `${wsRoot(orgId, wsId)}.${namespace}.${id}`;
  const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(base)}&limit=200`);
  const items = (resp?.data?.items) || [];
  let deleted = 0;
  for (const it of items) {
    if (it.key !== base && !it.key.startsWith(base + '.')) continue;  // exclude sibling ids
    const role = it.key === base ? '' : it.key.slice(base.length + 1);
    if (role === '' || role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
      try { await apiDelete(`/v1/memory/${encodeURIComponent(it.key)}`); deleted++; } catch { /* skip */ }
    }
  }
  return deleted;
}

/** List pending approvals (the gate inbox). */
export async function listApprovals(orgId, status = 'pending') {
  const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/approvals${status ? `?status=${status}` : ''}`);
  return resp?.data?.approvals || [];
}

/** Resolve an approval (approve | reject | edit). */
export async function resolveApproval(orgId, aid, decision, note) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/approvals/${encodeURIComponent(aid)}`, { decision, note });
}

/** Read the runtime config entry (publish gate toggle, etc.). Uses prefix-list to avoid 404 noise. */
export async function getConfig(orgId) {
  const key = `organism.${orgId}.meta.config`;
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(key)}`);
    return (resp?.data?.items || []).find(i => i.key === key)?.value || {};
  } catch { return {}; }
}

/** ── Document images (stored in /v1/storage, fetched with the session for display) ── */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Full data: URL (for immediate display in the editor before the storage upload finishes). */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Upload an image blob to the organism's private storage. Returns a /v1/storage/<key> URL to
 *  embed in markdown; the document view resolves it with the session token (storage GET needs auth). */
export async function uploadImage(orgId, blob, mime) {
  const ext = (mime && mime.split('/')[1]) ? '.' + mime.split('/')[1].replace(/[^a-z0-9]/gi, '') : '';
  const key = `organism.${orgId}.img.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${ext}`;
  const resp = await apiPost('/v1/storage', { key, visibility: 'private', data: await blobToBase64(blob), mime_type: mime || 'application/octet-stream' });
  if (resp?.ok === false) throw new Error(resp?.error?.message || 'Upload failed');
  return `/v1/storage/${encodeURIComponent(resp?.data?.key || key)}`;
}

/** Upload any file blob (document or image) to an organism's private storage. Returns
 *  { key, url, mime } where url is a /v1/storage/<key> path (the owner fetches it with the
 *  session token). Generic sibling of uploadImage — used by the Secretary doc/image intake. */
export async function uploadFile(orgId, file) {
  const mime = (file && file.type) || 'application/octet-stream';
  const rawName = (file && file.name) || 'file';
  const safe = rawName.replace(/[^a-z0-9.\-_]/gi, '_').slice(-60);
  const key = `organism.${orgId}.files.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
  const resp = await apiPost('/v1/storage', { key, visibility: 'private', data: await blobToBase64(file), mime_type: mime });
  if (resp?.ok === false) throw new Error(resp?.error?.message || 'Upload failed');
  const finalKey = resp?.data?.key || key;
  return { key: finalKey, url: `/v1/storage/${encodeURIComponent(finalKey)}`, mime };
}

/** Fetch a /v1/storage file with the session token and return an object URL (for <img>). */
export async function fetchStorageObjectUrl(url) {
  const jwt = window.AIMEAT?.auth?.getSession?.()?.jwt;
  const resp = await fetch(url, { headers: jwt ? { Authorization: 'Bearer ' + jwt } : {} });
  if (!resp.ok) throw new Error('image fetch failed: ' + resp.status);
  return URL.createObjectURL(await resp.blob());
}

/** List the caller's storage files → map of key → visibility (for showing per-image visibility). */
export async function listStorageVisibilities() {
  const resp = await apiGet('/v1/storage');
  const out = {};
  for (const f of (resp?.data?.files || [])) out[f.key] = f.visibility;
  return out;
}

/** Change one stored image's visibility ('private' | 'owner' | 'public'). */
export async function setImageVisibility(key, visibility) {
  return apiPatch(`/v1/storage/${encodeURIComponent(key)}/visibility`, { visibility });
}

// Matches an embedded storage image in either URL form, capturing the bare object key in group 3:
//   ![alt](/v1/storage/<key>)            — private, owner fetches with the session token
//   ![alt](/v1/pub/<ownerGhii>/<key>)    — public, anyone loads it via a plain <img>
const STORAGE_IMG_RE = /!\[([^\]]*)\]\(\/v1\/(?:storage|pub\/[^/)]+)\/([^\s)]+)\)/g;

/** The current owner's GHII (`owner@node`). ALWAYS returns a string so callers can safely `.split('@')`.
 *  Prefers the synchronous `auth.storedGhii` accessor; falls back to a sync `getSession()` only when it
 *  returns a session object with a string `ghii` (on some builds `getSession()` is async / returns a
 *  Promise — never return that, or `.split` blows up at call sites). Empty string when unknown. */
export function currentGhii() {
  const auth = (typeof window !== 'undefined' && window.AIMEAT && window.AIMEAT.auth) || null;
  if (!auth) return '';
  if (typeof auth.storedGhii === 'string' && auth.storedGhii) return auth.storedGhii;
  try {
    const s = typeof auth.getSession === 'function' ? auth.getSession() : null;
    if (s && typeof s === 'object' && typeof s.ghii === 'string') return s.ghii;
  } catch { /* ignore */ }
  return '';
}

/** Pull the storage object keys (+ alt text) embedded in a markdown document, in order (both forms). */
export function extractStorageImages(markdown) {
  const out = []; const seen = new Set();
  STORAGE_IMG_RE.lastIndex = 0;
  let m;
  while ((m = STORAGE_IMG_RE.exec(String(markdown || ''))) !== null) {
    const key = decodeURIComponent(m[2]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, alt: m[1] || key.split('.').pop() });
  }
  return out;
}

/** Rewrite each embedded image's URL to match its visibility: public → /v1/pub/<ghii>/<key> (loads
 *  for any viewer), otherwise → /v1/storage/<key> (owner-only, session-fetched). `visByKey` maps the
 *  bare object key → 'public' | 'private' | 'owner'; keys not present default to private. */
export function applyImageVisibilityUrls(markdown, visByKey, ghii) {
  return String(markdown || '').replace(STORAGE_IMG_RE, (full, alt, rawKey) => {
    const key = decodeURIComponent(rawKey);
    const url = (visByKey[key] === 'public' && ghii)
      ? `/v1/pub/${encodeURIComponent(ghii)}/${encodeURIComponent(key)}`
      : `/v1/storage/${encodeURIComponent(key)}`;
    return `![${alt}](${url})`;
  });
}

/** Section indexes for every document-space, keyed by objectType name. A section is
 *  { id, name, parentId, documents:[docId] } — a flat array forming a tree via parentId. */
export async function getAllSections(orgId, wsId) {
  const out = {};
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(`${wsRoot(orgId, wsId)}.meta.sections.`)}`);
    for (const it of (resp?.data?.items || [])) {
      const m = String(it.key || '').match(/\.meta\.sections\.(.+)$/);
      if (m) out[m[1]] = Array.isArray(it.value?.sections) ? it.value.sections : [];
    }
  } catch { /* none yet */ }
  return out;
}

/** Persist the section index for one document-space (…w.{wsId}.meta.sections.{typeName}). */
export async function saveSections(orgId, wsId, typeName, sections) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.sections.${typeName}`, value: { sections }, visibility: 'private' });
}

/** Read the optional per-item color tags for every space → { typeName: { instanceId: colorKey } }.
 *  Mirrors getAllSections; stored at …w.{wsId}.meta.colors.{typeName} = { colors: { id: key } }. */
export async function getAllColors(orgId, wsId) {
  const out = {};
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(`${wsRoot(orgId, wsId)}.meta.colors.`)}`);
    for (const it of (resp?.data?.items || [])) {
      const m = String(it.key || '').match(/\.meta\.colors\.(.+)$/);
      if (m) out[m[1]] = (it.value && typeof it.value.colors === 'object' && it.value.colors) || {};
    }
  } catch { /* none yet */ }
  return out;
}

/** Persist the per-item color map for one space (…w.{wsId}.meta.colors.{typeName}). */
export async function saveColors(orgId, wsId, typeName, colors) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.colors.${typeName}`, value: { colors }, visibility: 'private' });
}

/* ── Sources: references the workspace draws on (memory / storage / knowledge). Pointers only —
 *  the referenced data is never copied or moved, it stays where it lives. Stored at
 *  organism.{id}.meta.sources = { sources: [{ id, type, label, key?, ownerGaii?, packageId?, external }] }. */

/** Read the workspace's attached source references (empty array if none). */
export async function getWorkspaceSources(orgId, wsId) {
  const key = `${wsRoot(orgId, wsId)}.meta.sources`;
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(key)}`);
    const item = (resp?.data?.items || []).find(i => i.key === key);
    return Array.isArray(item?.value?.sources) ? item.value.sources : [];
  } catch { return []; }
}

/** Persist the workspace's source references. */
export async function saveWorkspaceSources(orgId, wsId, sources) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.sources`, value: { sources }, visibility: 'private' });
}

/** List the caller's own storage files (key, size, mime, visibility) — for the storage source picker. */
export async function listOwnStorageFiles() {
  const resp = await apiGet('/v1/storage');
  return resp?.data?.files || [];
}

/** Toggle the publish-review gate in the org's config. */
export async function setPublishGate(orgId, enabled, approverRole = 'owner') {
  const cfg = await getConfig(orgId);
  const next = { ...cfg, gates: { ...(cfg.gates || {}), publish: { enabled: !!enabled, approverRole } } };
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.config`, value: next, visibility: 'private' });
}
