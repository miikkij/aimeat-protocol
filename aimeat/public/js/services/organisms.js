/**
 * AIMEAT Organisms Service
 * Organism CRUD, membership, join requests, and the manifest-driven workspace
 * (a "project" is just an organism with a meta.manifest): apply a template,
 * read the workspace, write/publish drafts, and resolve gate approvals.
 */
import { api, apiGet, apiPost, apiPut, apiPatch, apiDelete } from '/js/api.js';

/** List organisms. */
export async function listOrganisms(opts = {}) {
  const params = new URLSearchParams();
  if (opts.type) params.set('type', opts.type);
  if (opts.city) params.set('city', opts.city);
  if (opts.interest) params.set('interest', opts.interest);
  if (opts.visibility) params.set('visibility', opts.visibility);
  if (opts.member) params.set('member', opts.member);
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

/** List members. */
export async function listMembers(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/members`);
}

/** List join requests (admin only). */
export async function listJoinRequests(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/join-requests`);
}

/** Review join request (approve/reject). */
export async function reviewJoinRequest(organismId, requestId, decision) {
  return apiPost(`/v1/organisms/${encodeURIComponent(organismId)}/join-requests/${encodeURIComponent(requestId)}/review`, { decision });
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
    "policy": { "agentAutonomy": "L3", "alwaysGate": [] }
  },
  "schemas": { <one JSON Schema per RECORDS type, keyed by that type's namespace> },
  "examples": { <1-3 sample records per RECORDS type, keyed by that type's namespace> }
}

Give every objectType all of these fields:
- "name": a short singular noun, e.g. "milestone" or "design-doc".
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

For each DOCUMENT type, the content is free markdown — keep it out of "schemas" and "examples" (a document needs neither).

Under "examples", add 1-3 realistic sample records per RECORDS type, with ids like "example-1", each valid against that type's schema.

Worked example — request "track game milestones plus free-form design docs":
{
  "manifest": {
    "manifestVersion": "1.0", "id": "", "name": "Game Project", "kind": "game-dev", "status": "active",
    "objectTypes": [
      { "name": "milestone", "schemaRef": "schema:milestone@1", "namespace": "shared.milestones", "backing": "memory", "writeRole": "member", "cardinality": "many", "versioned": true, "mode": "records" },
      { "name": "design-doc", "schemaRef": "schema:design-doc@1", "namespace": "shared.design-docs", "backing": "memory", "writeRole": "member", "cardinality": "many", "versioned": true, "mode": "document" }
    ],
    "policy": { "agentAutonomy": "L3", "alwaysGate": [] }
  },
  "schemas": {
    "shared.milestones": { "type": "object", "required": ["id", "title", "status"], "properties": { "id": { "type": "string" }, "title": { "type": "string" }, "status": { "type": "string", "enum": ["planned", "in-progress", "done"] }, "due_date": { "type": "string", "format": "date" } } }
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
      max_tokens: 3000,
      app_id: 'organism-workspace',
    }),
    timeoutMs: 600_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp?.error?.message || 'AI call failed'); e.code = resp?.error?.code; throw e; }
  return String(resp?.data?.content || '');
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
  const backings = ['memory', 'tasks', 'storage', 'knowledge'];
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
    await apiPut(`/v1/memory/${encodeURIComponent(`${root}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'strict' });
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
    await apiPut(`/v1/memory/${encodeURIComponent(`${root}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'strict' });
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
        if (a.isOwn) { out.push(`  ${aid}["🤖 ${mlbl(a.name)} · ${a.contributions}"]`); out.push(`  ${oid} --> ${aid}`); }
        else { out.push(`  ${aid}["🤖 agent"]`); out.push(`  ${oid} -. anon .-> ${aid}`); }
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
export async function getWorkspace(orgId, wsId) {
  const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace?ws=${encodeURIComponent(wsId)}`);
  return resp?.data || null;
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
    return Array.isArray(item?.value?.workspaces) ? item.value.workspaces : [];
  } catch { return []; }
}

/** Persist the workspace registry. */
export async function saveWorkspaceRegistry(orgId, workspaces) {
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.workspaces`, value: { workspaces }, visibility: 'private' });
}

/* ── Workspace access (per-workspace, creator-controlled, consent-backed) ──
 * Organism membership lets you DISCOVER every workspace (names + creator + your access status);
 * reading a workspace's content needs the creator's approval. ── */

/** Discover all workspaces in the org with your access status ('owner' | 'granted' | 'none'). */
export async function discoverWorkspaces(orgId) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspaces`);
    return Array.isArray(resp?.data?.workspaces) ? resp.data.workspaces : [];
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

/** Approve or deny a member's access request to your workspace. */
export async function decideWorkspaceAccess(orgId, ws, requester, decision) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/decision`, { ws, requester, decision });
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
    const types = (ws?.manifest?.objectTypes || []).filter(o => o.backing === 'memory')
      .map(o => `${o.name} (${o.mode === 'document' ? 'doc' : 'rec'})`);
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
  const types = (manifest?.objectTypes || []).filter(o => o.backing === 'memory');
  const recTypes = types.filter(o => o.mode !== 'document').map(o => o.name);
  const docTypes = types.filter(o => o.mode === 'document').map(o => o.name);
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
  if (ot.mode === 'document') {
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
  const types = (m.objectTypes || []).filter(ot => ot.backing === 'memory');
  const described = [];
  for (const ot of types) {
    // records is the default mode (mode may be undefined) — fetch the schema unless it's a document.
    const schema = ot.mode !== 'document' ? await getObjectSchema(orgId, wsId, ot.namespace).catch(() => null) : null;
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
      apply_to: 'prefix', schema_mode: 'strict',
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

/** Delete one workspace object (record or document) — its draft, published .latest and all
 *  .version.N history. Returns the number of keys removed. */
export async function deleteWorkspaceObject(orgId, wsId, namespace, id) {
  const base = `${wsRoot(orgId, wsId)}.${namespace}.${id}`;
  const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(base + '.')}`);
  const items = (resp?.data?.items) || [];
  let deleted = 0;
  for (const it of items) {
    const role = it.key.slice(base.length + 1);
    if (role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
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

/** The current owner's GHII (`owner@node`) — used to build public /v1/pub image URLs. */
export function currentGhii() {
  return window.AIMEAT?.auth?.getSession?.()?.ghii || '';
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
