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

/** Generate a custom workspace ({ manifest, schemas }) from a description, using the user's
 *  OpenRouter key + the manifest-architect prompt. One-shot (no interview). Throws on AI/parse error. */
export async function generateWorkspace(description) {
  const base = await getManifestArchitectPrompt();
  const systemPrompt = `${base}

=== ONE-SHOT GENERATION MODE ===
Do NOT interview. From the user's description, output ONLY a single JSON object:
{
  "manifest": { a valid manifest — manifestVersion,id(""),name,kind,status:"active",objectTypes:[{name,schemaRef,namespace,cardinality,backing:"memory",writeRole,versioned}], policy:{agentAutonomy,alwaysGate} },
  "schemas": { "<namespace>": <a JSON Schema {type:"object",required:[...],properties:{...}} for that objectType>, ... one per memory-backed objectType, keyed by its namespace }
}
Namespaces: owner-controlled types use "meta.<plural>", collaborative use "shared.<plural>". Every memory-backed objectType needs a schema entry under its namespace, and an "id" string property. Use bounded enums for status-like fields. No prose, no markdown fences.`;

  const resp = await apiPost('/v1/ai/complete', {
    prompt: description,
    systemPrompt,
    modelRole: 'execution',
    max_tokens: 3000,
    app_id: 'organism-workspace',
  });
  if (resp?.ok === false) { const e = new Error(resp?.error?.message || 'AI call failed'); e.code = resp?.error?.code; throw e; }
  const content = String(resp?.data?.content || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const generated = JSON.parse(content);
  if (!generated.manifest || !generated.schemas) throw new Error('AI output missing manifest or schemas');
  return generated;
}

/** Apply a generated (or any) workspace to an organism: register its schemas + write the manifest. */
export async function applyGeneratedWorkspace(orgId, generated) {
  for (const [namespace, schema] of Object.entries(generated.schemas || {})) {
    await apiPut(`/v1/memory/${encodeURIComponent(`organism.${orgId}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'strict' });
  }
  const manifest = { ...generated.manifest, id: orgId, status: generated.manifest.status || 'active' };
  await apiPost('/v1/memory', { key: `organism.${orgId}.meta.manifest`, value: manifest, visibility: 'private' });
  await apiPost('/v1/memory', { key: `organism.${orgId}.meta.readme`, value: `# ${manifest.name || 'Workspace'}\n\n${manifest.summary || ''}`, visibility: 'private' });
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

/** Toggle the publish-review gate in the org's config. */
export async function setPublishGate(orgId, enabled, approverRole = 'owner') {
  const cfg = await getConfig(orgId);
  const next = { ...cfg, gates: { ...(cfg.gates || {}), publish: { enabled: !!enabled, approverRole } } };
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.config`, value: next, visibility: 'private' });
}
