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
 *   - distributeNote(text) — POST /v1/librarian/distribute (split into placed chunks)
 *   - materializeDocument(plan) — resolve/create org → ws → document space → write doc → drop source
 *   - distributeChunks(chunks, sourceKey, onProgress) — materialize each chunk to its home
 *   - getNotebookSettings/saveNotebookSettings — the per-owner trust toggles (notebook.settings)
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: classify + materialize-document orchestration (slice B).
 *   v1.1.0 — 2026-06-21 — Phase 3: distribute (split → many homes) + notebook.settings trust toggles.
 *   v1.2.0 — 2026-06-21 — Add materializeRecord (records-space sibling) + patchRecord for the Tracked
 *     Response flow (inbox message → actionable workspace record, source preserved).
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

/** Ask the backend to SPLIT a note into placed chunks (notebook stage 3). Slow AI call — full timeout,
 *  no retry (same reasoning as classifyNote). Returns the DistributeResult envelope's data. */
export async function distributeNote(text) {
  const resp = await api('/v1/librarian/distribute', {
    method: 'POST',
    body: JSON.stringify({ text }),
    timeoutMs: 1_800_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'Distribute failed'); e.code = resp.error?.code; throw e; }
  return resp?.data || null;
}

/** The per-owner notebook trust toggles ({ autoDetectIntent, autoRunPlan, autoDistribute }). */
export async function getNotebookSettings() {
  try { const r = await getMemory('notebook.settings'); return (r?.data?.value) || {}; }
  catch { return {}; }
}
export async function saveNotebookSettings(settings) {
  return createMemory('notebook.settings', settings, 'private');
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

/** A records-space objectType (mode:'records') for a memory-backed workspace — the sibling of the
 *  document space, used by materializeRecord (e.g. a `bug` space). */
function recordSpaceObjectType(namespace, name) {
  return { name: name || namespace, namespace, mode: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true };
}

/**
 * Materialize a note into a workspace RECORD (mode:'records'), the actionable sibling of
 * materializeDocument. Unlike documents it does NOT delete any source — the Tracked Response that
 * binds this record needs the originating inbox message to persist. Returns the record's `.latest`
 * memory key so a Tracked Response can watch it.
 * @param {object} plan
 * @param {string|null} plan.organismId   Existing organism id, or null to create one.
 * @param {string} [plan.organismName]    Name for a new organism.
 * @param {string|null} plan.workspaceId  Existing workspace id, or null to create one.
 * @param {string} [plan.workspaceName]   Name for a new workspace.
 * @param {string} plan.space             Records-space namespace (e.g. 'bug').
 * @param {string} [plan.spaceName]       Display name for a newly-created space.
 * @param {object} plan.record            The record value (e.g. { title, markdown, status, severity }).
 * @param {string} [plan.recordId]
 * @returns {Promise<{organismId:string, workspaceId:string, space:string, recordId:string, key:string}>}
 */
export async function materializeRecord(plan) {
  let { organismId, workspaceId } = plan;
  const namespace = plan.space || 'note';

  // 1. Organism — create if needed.
  if (!organismId) {
    const resp = await createOrganism({
      name: (plan.organismName || 'Notebook').trim(),
      description: 'Created from the notebook',
      type: 'project', join_policy: 'approval_required', visibility: 'private',
    });
    if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not create organism');
    organismId = resp?.data?.organism?.id;
    if (!organismId) throw new Error('Organism creation returned no id');
  }

  // 2. Workspace — create if needed (registry + manifest with the records space).
  if (!workspaceId) {
    workspaceId = rid('ws-');
    const manifest = { manifestVersion: '1.0', id: organismId, name: plan.workspaceName || 'Notebook', kind: 'project', status: 'active', objectTypes: [recordSpaceObjectType(namespace, plan.spaceName)] };
    await saveManifest(organismId, workspaceId, manifest);
    await apiPost('/v1/memory', { key: `${wsRoot(organismId, workspaceId)}.meta.readme`, value: `# ${manifest.name}\n\nCreated from the notebook.`, visibility: 'private' });
    const existing = await listWorkspaces(organismId);
    await saveWorkspaceRegistry(organismId, [...existing, { id: workspaceId, name: manifest.name, createdAt: new Date().toISOString() }]);
  } else {
    // Ensure the records space exists on the chosen workspace (additive — never replace the manifest).
    const manifest = await readManifest(organismId, workspaceId);
    if (manifest && !(manifest.objectTypes || []).some(ot => ot.namespace === namespace)) {
      const updated = { ...manifest, objectTypes: [...(manifest.objectTypes || []), recordSpaceObjectType(namespace, plan.spaceName)] };
      await saveManifest(organismId, workspaceId, updated).catch(() => {});
    }
  }

  // 3. Write the record at its .latest key (the key a Tracked Response watches).
  const recordId = plan.recordId || rid('rec-');
  const key = `${wsRoot(organismId, workspaceId)}.${namespace}.${recordId}.latest`;
  const value = { id: recordId, ...(plan.record || {}) };
  const resp = await createMemory(key, value, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not write record');

  return { organismId, workspaceId, space: namespace, recordId, key };
}

/** Best-effort merge a patch onto an existing memory record value (e.g. stamp a trackedResponse
 *  back-ref onto a freshly-materialized record). Reads current value, shallow-merges, rewrites. */
export async function patchRecord(key, patch) {
  try {
    const r = await getMemory(key);
    const cur = (r?.data?.value && typeof r.data.value === 'object') ? r.data.value : {};
    await createMemory(key, { ...cur, ...patch }, 'private');
  } catch { /* best-effort back-ref */ }
}

/**
 * Materialize each chunk of a distribute plan into its own home. Chunks with a resolved home go there;
 * chunks the model proposed a NEW name for create that org/workspace; chunks with neither are grouped
 * into a single shared "Notebook" organism (created once, reused) so unplaced pieces are never lost.
 * The source inbox note is dropped ONLY after every chunk has been filed.
 * @param {Array} chunks  DistributeChunk[] from distributeNote().
 * @param {string} [sourceKey]  Inbox note key to delete once all chunks are filed.
 * @param {(index:number, status:'running'|'done'|'failed', result?:object)=>void} [onProgress]
 * @returns {Promise<Array>} per-chunk materialize results
 */
export async function distributeChunks(chunks, sourceKey, onProgress) {
  const results = [];
  let notebookFallback = null;   // { organismId, workspaceId, space } for unplaced chunks
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    onProgress?.(i, 'running');
    const organismName = c.createNew?.organismName || c.organismName;
    const plan = {
      organismId: c.organismId || null,
      organismName,
      workspaceId: c.workspaceId || null,
      workspaceName: c.createNew?.workspaceName || c.workspaceName,
      space: c.space || null,
      title: c.title,
      markdown: c.markdown,
    };
    const unplaced = !plan.organismId && !organismName;
    if (unplaced && notebookFallback) {
      plan.organismId = notebookFallback.organismId;
      plan.workspaceId = notebookFallback.workspaceId;
      plan.space = notebookFallback.space;
    }
    try {
      const res = await materializeDocument(plan);   // no sourceKey — don't delete per chunk
      if (unplaced && !notebookFallback) notebookFallback = { organismId: res.organismId, workspaceId: res.workspaceId, space: res.space };
      results.push(res);
      onProgress?.(i, 'done', res);
    } catch (e) {
      onProgress?.(i, 'failed');
      throw e;   // surface the failure; source note is NOT deleted so nothing is lost
    }
  }
  if (sourceKey) await deleteMemory(sourceKey).catch(() => {});
  return results;
}
