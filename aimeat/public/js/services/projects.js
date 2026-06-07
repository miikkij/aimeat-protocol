/**
 * @file projects.js
 * @description Client service for the project brain — a project is an organism (type:'project')
 *   with a manifest. Wraps the generic backend: create + apply the project template (register
 *   org-scoped object schemas + write the manifest), read the workspace, write/publish drafts,
 *   and resolve gate approvals. Object shapes (PROJECT_SCHEMAS) mirror docs/csm-bundles/project/
 *   (the source of truth); they're inlined so the UI can apply a template via existing endpoints
 *   with no new backend route.
 * @structure
 *   - PROJECT_OBJECT_TYPES / PROJECT_SCHEMAS — the shipped project template
 *   - createProject() — organism + apply template (schemas + manifest + readme)
 *   - getWorkspace / writeDraft / publishDraft / listApprovals / resolveApproval / setConfig
 * @usage import * as projects from '/js/services/projects.js';
 * @version-history
 *   v1.0.0 -- 2026-06-07 -- Phase 5 slice 1: project UI service.
 */
import { apiGet, apiPost, apiPut } from '/js/api.js';

/** Object types in the shipped "project" template (name → namespace + versioned + write role). */
export const PROJECT_OBJECT_TYPES = [
  { name: 'goal',        namespace: 'meta.goals',          writeRole: 'owner',  versioned: true },
  { name: 'plan',        namespace: 'meta.plans',          writeRole: 'owner',  versioned: true },
  { name: 'deliverable', namespace: 'shared.deliverables', writeRole: 'member', versioned: true },
  { name: 'decision',    namespace: 'meta.decisions',      writeRole: 'member', versioned: false, append: true },
  { name: 'resource',    namespace: 'shared.resources',    writeRole: 'member', versioned: true },
];

/** Compiled JSON Schemas for each object type (mirror of the bundle CSMs). */
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

function manifestFor(orgId, name, summary) {
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

/** List the caller's project-type organisms. */
export async function listProjects(ghii) {
  const resp = await apiGet(`/v1/organisms?type=project${ghii ? `&member=${encodeURIComponent(ghii)}` : ''}`);
  return resp?.data?.organisms || [];
}

/** Create a project organism and apply the project template (schemas + manifest + readme). */
export async function createProject({ name, summary }) {
  const created = await apiPost('/v1/organisms', { name, description: summary, type: 'project', join_policy: 'invite_only', visibility: 'private' });
  const orgId = created?.data?.organism?.id;
  if (!orgId) throw new Error(created?.error?.message || 'Failed to create project organism');

  for (const [namespace, schema] of Object.entries(PROJECT_SCHEMAS)) {
    await apiPut(`/v1/memory/${encodeURIComponent(`organism.${orgId}.${namespace}`)}/schema`, {
      schema, apply_to: 'prefix', schema_mode: 'strict',
    });
  }
  await apiPost('/v1/memory', { key: `organism.${orgId}.meta.manifest`, value: manifestFor(orgId, name, summary), visibility: 'private' });
  await apiPost('/v1/memory', { key: `organism.${orgId}.meta.readme`, value: `# ${name}\n\n${summary || ''}`, visibility: 'private' });
  return orgId;
}

/** Read the manifest-driven workspace. */
export async function getWorkspace(orgId) {
  const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace`);
  return resp?.data || null;
}

/** Write/overwrite an object's draft (`…{namespace}.{id}.draft`). */
export async function writeDraft(orgId, namespace, instanceId, value) {
  return apiPost('/v1/memory', { key: `organism.${orgId}.${namespace}.${instanceId}.draft`, value, visibility: 'private' });
}

/** Publish a draft → new version + latest (or a pending approval if the publish gate is on). */
export async function publishDraft(orgId, namespace, instanceId) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/publish`, { namespace, id: instanceId });
}

/** List version history keys for an instance. */
export async function listVersions(orgId, namespace, instanceId) {
  const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.${namespace}.${instanceId}.version.`)}`);
  return resp?.data?.items || [];
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

/** Read/write the runtime config entry (e.g. the publish gate toggle). */
export async function getConfig(orgId) {
  // Use the prefix list (200-empty when absent) rather than GET :key (404 → console noise).
  const key = `organism.${orgId}.meta.config`;
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(key)}`);
    const item = (resp?.data?.items || []).find(i => i.key === key);
    return item?.value || {};
  } catch { return {}; }
}
export async function setPublishGate(orgId, enabled, approverRole = 'owner') {
  const cfg = await getConfig(orgId);
  const next = { ...cfg, gates: { ...(cfg.gates || {}), publish: { enabled: !!enabled, approverRole } } };
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.config`, value: next, visibility: 'private' });
}
