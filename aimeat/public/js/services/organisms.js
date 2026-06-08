/**
 * AIMEAT Organisms Service
 * Organism CRUD, membership, join requests, and the manifest-driven workspace
 * (a "project" is just an organism with a meta.manifest): apply a template,
 * read the workspace, write/publish drafts, and resolve gate approvals.
 */
import { api, apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

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
export async function deleteWorkspace(orgId) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(orgId)}/workspace`);
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
export async function applyGeneratedWorkspace(orgId, generated) {
  for (const [namespace, schema] of Object.entries(generated.schemas || {})) {
    await apiPut(`/v1/memory/${encodeURIComponent(`organism.${orgId}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'strict' });
  }
  const manifest = { ...generated.manifest, id: orgId, status: generated.manifest.status || 'active' };
  await apiPost('/v1/memory', { key: `organism.${orgId}.meta.manifest`, value: manifest, visibility: 'private' });
  await apiPost('/v1/memory', { key: `organism.${orgId}.meta.readme`, value: `# ${manifest.name || 'Workspace'}\n\n${manifest.summary || ''}`, visibility: 'private' });
  // Write any example instances as DRAFTS (clearly not-yet-published samples). Best-effort: a
  // sample that doesn't validate is skipped, not fatal.
  let n = 0;
  for (const [namespace, items] of Object.entries(generated.examples || {})) {
    if (!Array.isArray(items)) continue;
    for (const item of items.slice(0, 5)) {
      n++;
      const id = String((item && item.id) || `example-${n}`).replace(/[^a-zA-Z0-9_-]/g, '-');
      await apiPost('/v1/memory', { key: `organism.${orgId}.${namespace}.${id}.draft`, value: { ...item, id }, visibility: 'private' }).catch(() => {});
    }
  }
}

/** Apply the project template to an EXISTING organism (register schemas + write the manifest + readme). */
export async function applyProjectTemplate(orgId, name, summary) {
  for (const [namespace, schema] of Object.entries(PROJECT_SCHEMAS)) {
    await apiPut(`/v1/memory/${encodeURIComponent(`organism.${orgId}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'strict' });
  }
  await apiPost('/v1/memory', { key: `organism.${orgId}.meta.manifest`, value: projectManifest(orgId, name, summary), visibility: 'private' });
  await apiPost('/v1/memory', { key: `organism.${orgId}.meta.readme`, value: `# ${name}\n\n${summary || ''}`, visibility: 'private' });
}

/** Read the manifest-driven workspace. Returns null if the org has no workspace yet. */
export async function getWorkspace(orgId) {
  const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace`);
  return resp?.data || null;
}

/** Overwrite the organism's manifest (e.g. edited name/summary/policy from Settings). */
export async function saveManifest(orgId, manifest) {
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.manifest`, value: manifest, visibility: 'private' });
}

/** kebab-case a free-typed name into a safe namespace segment / type name. */
function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/** Manually add an object type to the manifest (no AI). mode 'document' needs no schema;
 *  'records' gets a starter {id,title} schema that can be refined later via Restructure. */
export async function addSpace(orgId, manifest, name, mode) {
  const base = slug(name);
  const plural = base.endsWith('s') ? base : base + 's';
  const existing = new Set((manifest.objectTypes || []).map(o => o.namespace));
  let namespace = `shared.${plural}`;
  for (let i = 2; existing.has(namespace); i++) namespace = `shared.${plural}-${i}`;
  const ot = { name: base, schemaRef: `schema:${base}@1`, namespace, backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode };
  if (mode === 'records') {
    await apiPut(`/v1/memory/${encodeURIComponent(`organism.${orgId}.${namespace}`)}/schema`, {
      schema: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } },
      apply_to: 'prefix', schema_mode: 'strict',
    });
  }
  return saveManifest(orgId, { ...manifest, objectTypes: [...(manifest.objectTypes || []), ot] });
}

/** Remove an object type from the manifest by name. Its data is left in memory (orphaned, not
 *  deleted) — re-adding the type surfaces it again; a full wipe is the workspace-delete path. */
export async function removeSpace(orgId, manifest, typeName) {
  return saveManifest(orgId, { ...manifest, objectTypes: (manifest.objectTypes || []).filter(o => o.name !== typeName) });
}

/** Fetch the JSON Schema registered for an object-type namespace (drives schema-aware forms).
 *  Probes a sub-key so the prefix schema resolves (a prefix schema doesn't self-match its own key). */
export async function getObjectSchema(orgId, namespace) {
  const key = `organism.${orgId}.${namespace}._form`;
  try {
    const resp = await apiGet(`/v1/memory/${encodeURIComponent(key)}/schema`);
    return resp?.data?.has_schema ? resp.data.schema : null;
  } catch { return null; }
}

/** Write/overwrite an object's draft (`…{namespace}.{id}.draft`). */
export async function writeDraft(orgId, namespace, instanceId, value) {
  return apiPost('/v1/memory', { key: `organism.${orgId}.${namespace}.${instanceId}.draft`, value, visibility: 'private' });
}

/** Publish a draft → new version + latest (or a pending approval if the publish gate is on). */
export async function publishDraft(orgId, namespace, instanceId) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/publish`, { namespace, id: instanceId });
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

/** Section indexes for every document-space, keyed by objectType name. A section is
 *  { id, name, parentId, documents:[docId] } — a flat array forming a tree via parentId. */
export async function getAllSections(orgId) {
  const out = {};
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.meta.sections.`)}`);
    for (const it of (resp?.data?.items || [])) {
      const m = String(it.key || '').match(/\.meta\.sections\.(.+)$/);
      if (m) out[m[1]] = Array.isArray(it.value?.sections) ? it.value.sections : [];
    }
  } catch { /* none yet */ }
  return out;
}

/** Persist the section index for one document-space (organism.{id}.meta.sections.{typeName}). */
export async function saveSections(orgId, typeName, sections) {
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.sections.${typeName}`, value: { sections }, visibility: 'private' });
}

/** Toggle the publish-review gate in the org's config. */
export async function setPublishGate(orgId, enabled, approverRole = 'owner') {
  const cfg = await getConfig(orgId);
  const next = { ...cfg, gates: { ...(cfg.gates || {}), publish: { enabled: !!enabled, approverRole } } };
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.config`, value: next, visibility: 'private' });
}
