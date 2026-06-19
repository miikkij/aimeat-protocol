/**
 * @file notebook.js
 * @description Notebook slice B client service. classifyNote() asks the backend AI classifier where a
 *   note belongs; materializeDocument() then ORCHESTRATES the placement over the existing generic
 *   memory/organism APIs (no-SSR — the client composes create-organism / create-workspace /
 *   write-document; there is no per-feature backend write route). Supports an existing target, a new
 *   workspace in an existing organism, or a brand-new organism+workspace, always materializing the
 *   note as a workspace DOCUMENT.
 * @structure
 *   - classifyNote(text) — POST /v1/librarian/classify
 *   - materializeDocument(plan) — resolve/create org → ws → document space → write doc → drop source
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: classify + materialize-document orchestration (slice B).
 */
import { api, apiPost } from '/js/api.js';
import { createMemory, getMemory, deleteMemory } from '/js/services/memory.js';
import { createOrganism, saveManifest, listWorkspaces, saveWorkspaceRegistry, wsRoot } from '/js/services/organisms.js';

const DOC_SPACE = 'pages';

function rid(prefix) {
  const r = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return prefix + r;
}

/** Ask the backend AI classifier where a note belongs. Returns the ClassifyResult envelope's data.
 *  This is a slow AI call — give it the full AI timeout (30 min) and DO NOT retry, otherwise the
 *  default 30s client timeout aborts a model that is still thinking and re-fires the request. */
export async function classifyNote(text) {
  const resp = await api('/v1/librarian/classify', {
    method: 'POST',
    body: JSON.stringify({ text }),
    timeoutMs: 1_800_000,
    retries: 0,
  });
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Classify failed');
  return resp?.data || null;
}

/** A document-space objectType for a memory-backed workspace. */
function docSpaceObjectType() {
  return { name: 'Pages', namespace: DOC_SPACE, schemaRef: 'schema:document@1', mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true };
}

function newWorkspaceManifest(orgId, name) {
  return { manifestVersion: '1.0', id: orgId, name: name || 'Notebook', kind: 'project', status: 'active', objectTypes: [docSpaceObjectType()] };
}

/** Read a workspace manifest (raw value), or null if it has none / is unreadable. */
async function readManifest(orgId, wsId) {
  try {
    const r = await getMemory(`${wsRoot(orgId, wsId)}.meta.manifest`);
    return r?.data?.value || null;
  } catch { return null; }
}

/**
 * Materialize a note into a workspace document.
 * @param {object} plan
 * @param {string|null} plan.organismId  Existing organism id, or null to create one.
 * @param {string} [plan.organismName]   Name for a new organism (when organismId is null).
 * @param {string|null} plan.workspaceId Existing workspace id, or null to create one.
 * @param {string} [plan.workspaceName]  Name for a new workspace (when workspaceId is null).
 * @param {string|null} plan.space       Existing document-space namespace, or null to use/create the default.
 * @param {string} plan.title
 * @param {string} plan.markdown
 * @param {string} [plan.sourceKey]      Inbox note key to delete once filed.
 * @returns {Promise<{organismId:string, workspaceId:string, space:string, docId:string}>}
 */
export async function materializeDocument(plan) {
  let { organismId, workspaceId, space } = plan;

  // 1. Organism — create if needed.
  if (!organismId) {
    const resp = await createOrganism({
      name: (plan.organismName || 'Notebook').trim(),
      description: 'Created from the notebook',
      type: 'project',
      join_policy: 'approval_required',
      visibility: 'private',
    });
    if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not create organism');
    organismId = resp?.data?.organism?.id;
    if (!organismId) throw new Error('Organism creation returned no id');
  }

  // 2. Workspace — create if needed (registry + manifest with a document space).
  if (!workspaceId) {
    workspaceId = rid('ws-');
    const manifest = newWorkspaceManifest(organismId, plan.workspaceName);
    await saveManifest(organismId, workspaceId, manifest);
    await apiPost('/v1/memory', { key: `${wsRoot(organismId, workspaceId)}.meta.readme`, value: `# ${manifest.name}\n\nCreated from the notebook.`, visibility: 'private' });
    const existing = await listWorkspaces(organismId);
    await saveWorkspaceRegistry(organismId, [...existing, { id: workspaceId, name: manifest.name, createdAt: new Date().toISOString() }]);
    space = DOC_SPACE;
  }

  // 3. Document space — ensure one exists on the chosen workspace.
  if (!space) {
    const manifest = await readManifest(organismId, workspaceId);
    const existingDoc = (manifest?.objectTypes || []).find(ot => (ot.mode === 'document') || (!ot.mode && ot.kind === 'document'));
    if (existingDoc?.namespace) {
      space = existingDoc.namespace;
    } else if (manifest) {
      // Best-effort: add a default document space to the manifest so the doc renders.
      const updated = { ...manifest, objectTypes: [...(manifest.objectTypes || []), docSpaceObjectType()] };
      await saveManifest(organismId, workspaceId, updated).catch(() => {});
      space = DOC_SPACE;
    } else {
      space = DOC_SPACE;
    }
  }

  // 4. Write the document.
  const docId = rid('doc-');
  const key = `${wsRoot(organismId, workspaceId)}.${space}.${docId}.latest`;
  const resp = await createMemory(key, { id: docId, title: plan.title, markdown: plan.markdown }, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not write document');

  // 5. Drop the source inbox note (it has been filed).
  if (plan.sourceKey) await deleteMemory(plan.sourceKey).catch(() => {});

  return { organismId, workspaceId, space, docId };
}
