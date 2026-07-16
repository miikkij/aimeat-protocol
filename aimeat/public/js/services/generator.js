/**
 * @file generator.js
 * @description Generator service — manages project state, task queue, and component
 *   lifecycle via the AIMEAT Memory API.
 *   All state stored at generator.{projectId}.* memory keys.
 * @structure
 *   - Project CRUD (listProjects, createProject, updateProject, deleteProject, archiveProject)
 *   - Component state (getComponent, saveComponent, loadAllComponents)
 *   - Agent queue (enqueueTask, pollResults, pollLogs, checkQueueStatus)
 *   - Interview Spec (saveInterviewSpec, getInterviewSpec)
 *   - Cleanup (cleanupOldEntries)
 *   - Registration (registerComponent) — includes cortex case with auto-activate
 *   - Lifecycle (getComponentStatuses, activateAll, deactivateAll, removeComponents, reregisterComponent, getAppLaunchUrl)
 *   - Activity Logging (writeProjectLog)
 * @usage import { listProjects, createProject, registerComponent } from '/js/services/generator.js';
 * @version-history
 *   v1.2.0 — 2026-07-16 — Add getProjectState (GET /v1/generator/:id/state mount composite) + extract pure
 *     buildComponentsFromItems/computeStatuses so the composite and the individual-fetch path share one
 *     transform; getComponentStatuses takes optional pre-loaded components to skip the redundant scan.
 *   v1.0.0 — 2026-03-10 — Initial generator service
 *   v1.1.0 — 2026-03-14 — Rewritten buildAgentSetupPrompt with SSE, GAII docs, full HTTP examples
 *   v1.1.1 — 2026-03-14 — getListeners now queries /v1/agents instead of memory; heartbeat uses /v1/checkin
 *   v1.2.0 — 2026-03-14 — saveComponent retries on 409 VERSION_CONFLICT;
 *     registerComponent sends YAML as { yaml: string } for CSM/MSM instead of JSON.parse
 *   v2.0.0 — 2026-03-14 — Replace regex sanitizeYaml with cleanYaml that uses
 *     real yaml parse+stringify — no more regex hacks
 *   v3.0.0 — 2026-03-14 — Add interview spec storage (saveInterviewSpec,
 *     getInterviewSpec); add cortex case in registerComponent with auto-activate
 *   v3.1.0 — 2026-03-15 — Namespace CSM/MSM names with owner (owner/name) to avoid
 *     collisions; upsert pattern (delete+recreate) on NAME_TAKEN for re-runs
 *   v4.0.0 — 2026-03-15 — Add lifecycle management: getComponentStatuses,
 *     activateAll, deactivateAll, removeComponents, getAppLaunchUrl
 *   v4.1.0 — 2026-03-15 — Improve saveComponent retry: up to 3 retries on
 *     409 VERSION_CONFLICT instead of 1, preventing 409 spam on rapid updates
 *   v4.2.0 — 2026-03-15 — deleteProject now fully cleans up all registered
 *     components (extensions, cortex, apps, csm, msm) + extension memory +
 *     translation i18n keys before removing generator state
 *   v4.3.0 — 2026-03-15 — Memory visibility changed to 'public' for cross-component access
 *   v4.4.0 — 2026-03-17 — Add reregisterComponent (deactivate → remove → register → re-activate)
 *   v4.5.0 — 2026-03-19 — Add writeProjectLog for user-action activity logging; fix apiPatch import
 *   v5.0.0 — 2026-03-20 — Remove agent-related functions (replaced by OpenRouter autopilot)
 *   v5.1.0 — 2026-03-21 — Add saveProjectSettings/getProjectSettings for settings collection step
 *   v5.1.1 — 2026-06-19 — lint fixes (misleading-char-class/unused-expression/empty-block)
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { registerComponent } from './generator.registration.js';

// registerComponent + its CSM/MSM/extension/app/cortex parsers were extracted to
// ./generator.registration.js (max-file-lines). Re-exported so consumers importing from this
// module keep working; reregisterComponent (below) also calls it.
export { registerComponent };

/* ── Helpers ─────────────────────────────────────────── */

function genId() {
  return 'prj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function taskId() {
  return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/* ── Project CRUD ────────────────────────────────────── */

export async function listProjects() {
  const resp = await apiGet('/v1/memory?prefix=generator.&owner_scope=true');
  const items = resp?.data?.items || resp?.data?.entries || [];
  const all = items
    .filter(i => i.key.endsWith('.project'))
    .map(i => ({ key: i.key, ...(typeof i.value === 'string' ? JSON.parse(i.value) : i.value) }));

  // Auto-clean corrupted/orphaned project entries (missing projectId or name)
  const valid = [];
  for (const p of all) {
    if (!p.projectId || !p.name) {
      try { await apiDelete(`/v1/memory/${encodeURIComponent(p.key)}`); } catch { /* best effort */ }
      continue;
    }
    valid.push(p);
  }
  return valid.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function getProject(projectId) {
  // Use owner_scope to find projects regardless of which agent/identity created them
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.project&owner_scope=true`);
  const items = resp?.data?.items || [];
  const item = items.find(i => i.key === `generator.${projectId}.project`);
  if (!item) return null;
  const val = typeof item.value === 'string' ? JSON.parse(item.value) : (item.value || item);
  return { ...val, _version: item.version };
}

export async function createProject(name, description) {
  const projectId = genId();
  const project = {
    projectId,
    name,
    description,
    status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blueprint: null,
  };
  await apiPost('/v1/memory', {
    key: `generator.${projectId}.project`,
    value: project,
    visibility: 'owner',
  });
  return { ...project, _version: 1 };
}

export async function updateProject(projectId, updates) {
  const current = await getProject(projectId);
  if (!current) throw new Error('Project not found');
  const version = current._version || 0;
  const rest = Object.fromEntries(Object.entries(current).filter(([k]) => k !== '_version'));
  const updated = { ...rest, ...updates, updatedAt: new Date().toISOString() };
  await apiPut(`/v1/memory/generator.${projectId}.project`, {
    value: updated,
    visibility: 'owner',
    version,
  });
  return { ...updated, _version: version + 1 };
}

export async function archiveProject(projectId) {
  return updateProject(projectId, { status: 'archived' });
}

export async function deleteProject(projectId, session) {
  // Phase 1: Unregister all live components (extensions, cortex, apps, csm, msm)
  const components = await loadAllComponents(projectId);
  const registered = components.filter(c => c.registeredAs);

  for (const comp of registered) {
    const name = comp.registeredAs;
    try {
      if (comp.type === 'extension') {
        try { await apiPost(`/v1/extensions/${encodeURIComponent(name)}/deactivate`); } catch { /* ok */ }
        await apiDelete(`/v1/extensions/${encodeURIComponent(name)}`);
        // Extension memory is cleaned up by DELETE /v1/extensions/{name} on the backend
      } else if (comp.type === 'cortex') {
        try { await apiPost(`/v1/cortex/${encodeURIComponent(name)}/deactivate`); } catch { /* ok */ }
        await apiDelete(`/v1/cortex/${encodeURIComponent(name)}`);
      } else if (comp.type === 'app') {
        const owner = session?.owner || '';
        await apiDelete(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
      } else if (comp.type === 'csm') {
        await apiDelete(`/v1/csm/${encodeURIComponent(name)}`);
      } else if (comp.type === 'msm') {
        await apiDelete(`/v1/msm/${encodeURIComponent(name)}`);
      }
    } catch { /* best effort — component may already be gone */ }
  }

  // Phase 2: Clean translation memory keys — only delete this project's locale keys
  // registeredAs format: "yritystietopalvelu.i18n.fi" (service_slug from blueprint)
  const translationComps = components.filter(c => c.type === 'translation' && c.registeredAs);
  for (const comp of translationComps) {
    const name = comp.registeredAs;
    if (name) {
      // registeredAs IS the memory key (e.g., "yritystietopalvelu.i18n.fi")
      try { await apiDelete(`/v1/memory/${encodeURIComponent(name)}`); } catch { /* best effort */ }
    }
  }

  // Phase 3: Delete all generator state keys
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.&owner_scope=true`);
  const items = resp?.data?.items || resp?.data?.entries || [];
  for (const item of items) {
    await apiDelete(`/v1/memory/${encodeURIComponent(item.key)}`);
  }
}

/* ── Activity Logging ────────────────────────────────── */

/**
 * Write a project-level activity log entry to memory.
 * Uses the same key pattern as agent logs: generator.{projectId}.logs.{logId}
 */
export async function writeProjectLog(projectId, action, details = {}) {
  const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const key = `generator.${projectId}.logs.${logId}`;
  try {
    await apiPost('/v1/memory', {
      key,
      value: {
        logId,
        level: 'info',
        message: action,
        componentId: details.componentId || null,
        meta: details.meta || null,
        source: 'ui',
        timestamp: new Date().toISOString(),
      },
      visibility: 'owner',
      tags: ['generator', 'log'],
    });
  } catch { /* best-effort logging — don't block user flow */ }
}

/* ── Debug Artifact Writer ─────────────────────────── */

/**
 * Write a debug artifact to disk for a generator component.
 * Best-effort — failures are silently ignored (don't block user flow).
 * @param {string} projectId
 * @param {string} componentId
 * @param {string} phase — 'prompt'|'generated'|'validation'|'test-prompt'|'test-code'|'test-result'|'project-meta'
 * @param {string|object} content
 */
export async function writeDebugArtifact(projectId, componentId, phase, content) {
  try {
    await apiPost(`/v1/generator/${projectId}/debug/${componentId}`, { phase, content });
  } catch { /* best-effort */ }
}

/* ── Interview Spec ─────────────────────────────────── */

export async function saveInterviewSpec(projectId, spec) {
  return apiPost('/v1/memory', {
    key: `generator.${projectId}.interview-spec`,
    value: spec,
    visibility: 'owner',
  });
}

export async function getInterviewSpec(projectId) {
  try {
    const key = `generator.${projectId}.interview-spec`;
    const resp = await apiGet(`/v1/memory?prefix=${key}&owner_scope=true`);
    const item = (resp?.data?.items || []).find(i => i.key === key);
    if (!item?.value) return null;
    return typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
  } catch { return null; }
}

/* ── Pending Edit State ─────────────────────────────── */

export async function savePendingEdit(projectId, data) {
  return apiPost('/v1/memory', {
    key: `generator.${projectId}.pending-edit`,
    value: data,
    visibility: 'owner',
  });
}

export async function getPendingEdit(projectId) {
  try {
    const key = `generator.${projectId}.pending-edit`;
    const resp = await apiGet(`/v1/memory?prefix=${key}&owner_scope=true`);
    const item = (resp?.data?.items || []).find(i => i.key === key);
    if (!item?.value) return null;
    return typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
  } catch { return null; }
}

export async function clearPendingEdit(projectId) {
  try {
    await apiDelete(`/v1/memory/generator.${projectId}.pending-edit`);
  } catch { /* ignore */ }
}

/* ── Project Settings ────────────────────────────────── */

export async function saveProjectSettings(projectId, values, secretKeys) {
  return apiPost(`/v1/generator/${projectId}/settings`, { values, secretKeys });
}

export async function getProjectSettings(projectId) {
  const res = await apiGet(`/v1/generator/${projectId}/settings`);
  return res?.data?.values || {};
}

/* ── Component State ─────────────────────────────────── */

export async function getComponent(projectId, componentId) {
  const key = `generator.${projectId}.component.${componentId}`;
  const resp = await apiGet(`/v1/memory?prefix=${key}&owner_scope=true`);
  const item = (resp?.data?.items || []).find(i => i.key === key);
  return item || null;
}

export async function saveComponent(projectId, component) {
  let version = component._version || 0;
  const data = Object.fromEntries(Object.entries(component).filter(([k]) => k !== '_version'));
  const key = `generator.${projectId}.component.${data.id}`;
  if (version === 0) {
    // New component — use POST to create
    await apiPost('/v1/memory', {
      key,
      value: data,
      visibility: 'owner',
    });
  } else {
    // Existing component — use PUT with optimistic locking; retry up to 3 times on conflict
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await apiPut(`/v1/memory/${key}`, {
          value: data,
          visibility: 'owner',
          version,
        });
        break; // success
      } catch (err) {
        const isConflict = err?.code === 'VERSION_CONFLICT' || err?.status === 409;
        if (isConflict && attempt < MAX_RETRIES) {
          // Re-fetch current version and retry
          const fresh = await apiGet(`/v1/memory/${key}`);
          version = fresh?.data?.version ?? version + 1;
        } else {
          throw err;
        }
      }
    }
  }
  return { ...data, _version: version + 1 };
}

/**
 * Pure transform: build the dashboard's component list from raw memory items + spec items. Extracted from
 * loadAllComponents so both the individual-fetch path AND the /state composite (which seeds the same raw
 * items) share ONE transform — id backfill, content→result mapping, cortex markdown reconstruction, and
 * spec merge from the separate spec.* keys. Items carry {key, value, version}.
 */
export function buildComponentsFromItems(items, specItems, projectId) {
  const specMap = {};
  const specPrefix = `generator.${projectId}.spec.`;
  for (const si of (specItems || [])) {
    const compId = si.key?.startsWith(specPrefix) ? si.key.slice(specPrefix.length) : null;
    if (compId) {
      try {
        specMap[compId] = typeof si.value === 'string' ? JSON.parse(si.value) : si.value;
      } catch { /* skip unparseable specs */ }
    }
  }

  return (items || []).map(i => {
    const val = typeof i.value === 'string' ? JSON.parse(i.value) : i.value;
    // Ensure id is present — extract from memory key if missing (backend submit may omit it)
    if (!val.id && i.key) {
      const prefix = `generator.${projectId}.component.`;
      val.id = i.key.startsWith(prefix) ? i.key.slice(prefix.length) : i.key;
    }
    if (!val.label) val.label = val.id;
    // Map backend 'content' field to frontend 'result' if result is missing
    if (!val.result && val.content) val.result = val.content;
    // Reconstruct raw markdown from extracted cortex JSON — the validator expects yaml+js code blocks
    if (val.result && val.type === 'cortex' && typeof val.result === 'string') {
      try {
        const parsed = JSON.parse(val.result);
        if (parsed.manifest && parsed.libs) {
          const js = parsed.libs[0]?.code || '';
          val.result = '```yaml\n' + parsed.manifest + '\n```\n\n```javascript\n' + js + '\n```';
        }
      } catch { /* not extracted JSON — already in raw format, leave as-is */ }
    }
    // Merge spec from separate storage — spec survives component state overwrites
    if (!val.spec && specMap[val.id]) {
      val.spec = specMap[val.id];
    }
    return { ...val, _version: i.version };
  });
}

export async function loadAllComponents(projectId) {
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.component.&owner_scope=true`);
  const items = resp?.data?.items || resp?.data?.entries || [];
  // Load specs separately — they're stored in their own keys so they survive component state overwrites
  const specResp = await apiGet(`/v1/memory?prefix=generator.${projectId}.spec.&owner_scope=true`);
  const specItems = specResp?.data?.items || specResp?.data?.entries || [];
  return buildComponentsFromItems(items, specItems, projectId);
}

/**
 * The Generator dashboard mount composite: project + interview-spec + components (built from the same
 * transform) + pending-edit from ONE server-side prefix scan (GET /v1/generator/:id/state). Returns null
 * on 404/error so the caller falls back to the individual reads. The live extension/cortex/apps status
 * reads stay separate (see getComponentStatuses).
 */
export async function getProjectState(projectId) {
  try {
    const resp = await apiGet(`/v1/generator/${projectId}/state`);
    const d = resp?.data;
    if (!d?.project) return null;
    const parse = (item) => (item && item.value != null)
      ? (typeof item.value === 'string' ? JSON.parse(item.value) : item.value)
      : null;
    return {
      project: { ...parse(d.project), _version: d.project.version },
      interviewSpec: parse(d.interviewSpec),
      pendingEdit: parse(d.pendingEdit),
      components: buildComponentsFromItems(d.componentItems || [], d.specItems || [], projectId),
    };
  } catch { return null; }
}

/**
 * Save a spec to its own memory key — independent of the component data.
 * Specs are king: they must survive component state overwrites (manual registration,
 * validation retries, code regeneration).
 *
 * @param {string} projectId
 * @param {string} componentId
 * @param {object} spec - The spec JSON
 */
export async function saveSpec(projectId, componentId, spec) {
  const key = `generator.${projectId}.spec.${componentId}`;
  try {
    await apiPost('/v1/memory', { key, value: spec, visibility: 'owner' });
  } catch (err) {
    // If key already exists, update it
    if (err?.status === 409 || err?.code === 'ALREADY_EXISTS') {
      const fresh = await apiGet(`/v1/memory/${key}`);
      const version = fresh?.data?.version ?? 1;
      await apiPut(`/v1/memory/${key}`, { value: spec, visibility: 'owner', version });
    } else {
      throw err;
    }
  }
}

/* ── Agent Queue ─────────────────────────────────────── */

export async function enqueueTask(projectId, componentId, type, prompt, assignedTo, assignedToTag) {
  const id = taskId();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const entry = {
    taskId: id,
    componentId,
    type,
    prompt,
    assignedTo: assignedTo || null,
    assignedToTag: assignedToTag || 'generator',
    status: 'pending',
    timeoutMinutes: 30,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  await apiPost('/v1/memory', {
    key: `generator.${projectId}.queue.${id}`,
    value: entry,
    visibility: 'owner',
  });
  return entry;
}

export async function pollResults(projectId) {
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.results.&owner_scope=true`);
  const items = resp?.data?.items || resp?.data?.entries || [];
  return items.map(i => typeof i.value === 'string' ? JSON.parse(i.value) : i.value);
}

export async function pollLogs(projectId, taskIdVal) {
  try {
    const resp = await apiGet(`/v1/memory/generator.${projectId}.logs.${taskIdVal}`);
    return resp?.data?.entries || [];
  } catch { return []; }
}

export async function checkQueueStatus(projectId) {
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.queue.&owner_scope=true`);
  const items = resp?.data?.items || resp?.data?.entries || [];
  const now = Date.now();
  return items.map(i => {
    const val = typeof i.value === 'string' ? JSON.parse(i.value) : i.value;
    if ((val.status === 'pending' || val.status === 'processing') && new Date(val.expiresAt).getTime() < now) {
      val.status = 'expired';
    }
    return val;
  });
}

/* ── Cleanup ────────────────────────────────────────── */

export async function cleanupOldEntries(projectId) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const prefixes = ['queue', 'results', 'logs'];
  for (const pfx of prefixes) {
    try {
      const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.${pfx}.&owner_scope=true`);
      const items = resp?.data?.items || [];
      for (const item of items) {
        const val = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
        const ts = val.completedAt || val.createdAt || item.created_at;
        if (ts && new Date(ts).getTime() < cutoff) {
          await apiDelete(`/v1/memory/${encodeURIComponent(item.key)}`);
        }
      }
    } catch { /* best effort */ }
  }
}

/* ── Lifecycle Management ────────────────────────────── */

/**
 * Get live status for all registered components in a project.
 * Checks extensions, cortex, and apps APIs for current state.
 */
/**
 * Pure transform: derive each component's install/registration status by matching comp.registeredAs
 * against the live extension / cortex / apps lists. Extracted so the composite mount can reuse the
 * already-loaded components (no second component scan). Behavior identical to the inline loop.
 */
export function computeStatuses(components, liveExtensions, liveCortexes, liveApps) {
  const statuses = {};
  for (const comp of components) {
    const name = comp.registeredAs;
    if (!name) {
      statuses[comp.id] = { installed: false, status: 'not_registered' };
      continue;
    }

    if (comp.type === 'extension') {
      const ext = liveExtensions.find(e => e.name === name || e.metadata?.name === name);
      statuses[comp.id] = ext
        ? { installed: true, status: ext.status || 'installed', active: ext.status === 'active' }
        : { installed: false, status: 'not_found' };
    } else if (comp.type === 'cortex') {
      const ctx = liveCortexes.find(c => c.name === name || c.metadata?.name === name);
      statuses[comp.id] = ctx
        ? { installed: true, status: ctx.status || 'installed', active: ctx.status === 'active' }
        : { installed: false, status: 'not_found' };
    } else if (comp.type === 'app') {
      const app = liveApps.find(a => a.filename === name || a.name === name);
      statuses[comp.id] = app
        ? { installed: true, status: 'published', active: true }
        : { installed: false, status: 'not_found' };
    } else {
      // csm, msm, memory, translation — no live status to check
      statuses[comp.id] = { installed: !!name, status: name ? 'registered' : 'not_registered' };
    }
  }

  return statuses;
}

/**
 * Live install/registration status for a project's components. Fetches the three live registries
 * (extensions / cortex / apps) in parallel and matches them against the components. Pass `components` to
 * reuse an already-loaded list (the dashboard mount does this after the /state composite) and skip the
 * redundant component scan; omit it to load them here.
 */
export async function getComponentStatuses(projectId, components) {
  const comps = components || await loadAllComponents(projectId);
  const [extResp, ctxResp, appsResp] = await Promise.all([
    apiGet('/v1/extensions').catch(() => null),
    apiGet('/v1/cortex').catch(() => null),
    apiGet('/v1/apps').catch(() => null),
  ]);
  const liveExtensions = extResp?.data?.extensions || extResp?.data || [];
  const liveCortexes = ctxResp?.data?.extensions || ctxResp?.data || [];
  const liveApps = appsResp?.data?.apps || appsResp?.data || [];
  return computeStatuses(comps, liveExtensions, liveCortexes, liveApps);
}

/**
 * Activate all extensions and cortexes in a project.
 * Returns { activated: string[], errors: string[] }
 */
export async function activateAll(projectId) {
  const components = await loadAllComponents(projectId);
  const activated = [];
  const errors = [];

  for (const comp of components) {
    if (!comp.registeredAs) continue;
    try {
      if (comp.type === 'extension') {
        await apiPost(`/v1/extensions/${encodeURIComponent(comp.registeredAs)}/activate`);
        activated.push(comp.registeredAs);
      } else if (comp.type === 'cortex') {
        await apiPost(`/v1/cortex/${encodeURIComponent(comp.registeredAs)}/activate`);
        activated.push(comp.registeredAs);
      }
    } catch (e) {
      errors.push(`${comp.registeredAs}: ${e.message || 'activation failed'}`);
    }
  }

  return { activated, errors };
}

/**
 * Deactivate all extensions and cortexes in a project.
 * Returns { deactivated: string[], errors: string[] }
 */
export async function deactivateAll(projectId) {
  const components = await loadAllComponents(projectId);
  const deactivated = [];
  const errors = [];

  for (const comp of components) {
    if (!comp.registeredAs) continue;
    try {
      if (comp.type === 'extension') {
        await apiPost(`/v1/extensions/${encodeURIComponent(comp.registeredAs)}/deactivate`);
        deactivated.push(comp.registeredAs);
      } else if (comp.type === 'cortex') {
        await apiPost(`/v1/cortex/${encodeURIComponent(comp.registeredAs)}/deactivate`);
        deactivated.push(comp.registeredAs);
      }
    } catch (e) {
      errors.push(`${comp.registeredAs}: ${e.message || 'deactivation failed'}`);
    }
  }

  return { deactivated, errors };
}

/**
 * Remove selected components from the AIMEAT node.
 * @param {string} projectId
 * @param {string[]} componentIds - which component IDs to remove
 * @param {boolean} includeMemory - also delete memory keys written by extensions
 * @param {object} session - user session for owner context
 * Returns { removed: string[], errors: string[] }
 */
export async function removeComponents(projectId, componentIds, includeMemory, session) {
  const components = await loadAllComponents(projectId);
  const toRemove = components.filter(c => componentIds.includes(c.id) && c.registeredAs);
  const removed = [];
  const errors = [];

  for (const comp of toRemove) {
    const name = comp.registeredAs;
    try {
      if (comp.type === 'extension') {
        // Deactivate first, then delete
        try { await apiPost(`/v1/extensions/${encodeURIComponent(name)}/deactivate`); } catch { /* ok */ }
        await apiDelete(`/v1/extensions/${encodeURIComponent(name)}`);
        if (includeMemory) {
          // Clean up extension memory (ext:{name} namespace)
          try {
            const resp = await apiGet(`/v1/memory?prefix=&owner=ext:${encodeURIComponent(name)}&owner_scope=true`);
            const items = resp?.data?.items || [];
            for (const item of items) {
              try { await apiDelete(`/v1/memory/${encodeURIComponent(item.key)}?owner=ext:${encodeURIComponent(name)}`); } catch { /* best effort */ }
            }
          } catch { /* memory cleanup is best effort */ }
        }
      } else if (comp.type === 'cortex') {
        try { await apiPost(`/v1/cortex/${encodeURIComponent(name)}/deactivate`); } catch { /* ok */ }
        await apiDelete(`/v1/cortex/${encodeURIComponent(name)}`);
      } else if (comp.type === 'app') {
        const owner = session?.owner || '';
        await apiDelete(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
      } else if (comp.type === 'csm') {
        await apiDelete(`/v1/csm/${encodeURIComponent(name)}`);
      } else if (comp.type === 'msm') {
        await apiDelete(`/v1/msm/${encodeURIComponent(name)}`);
      } else if (comp.type === 'translation') {
        // registeredAs IS the memory key (e.g., "yritystietopalvelu.i18n.fi")
        try { await apiDelete(`/v1/memory/${encodeURIComponent(name)}`); } catch { /* best effort */ }
      }
      removed.push(name);
      // Clear registeredAs in component state
      await saveComponent(projectId, { ...comp, registeredAs: null, status: 'not_started' });
    } catch (e) {
      errors.push(`${name}: ${e.message || 'removal failed'}`);
    }
  }

  // Update project timestamp so it doesn't show "Invalid Date"
  if (removed.length > 0) {
    try { await updateProject(projectId, {}); } catch { /* best effort */ }
  }

  return { removed, errors };
}

/**
 * Re-register a component: deactivate → remove → register → re-activate if it was active.
 * Useful when updating a component that is already installed on the node.
 * @param {string} projectId
 * @param {object} component - the component object
 * @param {object} validationResult - validated extraction result
 * @param {object} session - user session
 * @param {string} serviceSlug - service slug for namespacing
 * @param {object} liveStatuses - current live statuses map (keyed by component id)
 * Returns the registration response (same shape as registerComponent).
 */
export async function reregisterComponent(projectId, component, validationResult, session, serviceSlug, liveStatuses) {
  const name = component.registeredAs;
  if (!name) throw new Error('Component is not registered');

  // Check if it was active before removal
  const wasActive = liveStatuses?.[component.id]?.active === true;

  // Step 1: Deactivate (best effort)
  if (component.type === 'extension') {
    try { await apiPost(`/v1/extensions/${encodeURIComponent(name)}/deactivate`); } catch { /* ok */ }
  } else if (component.type === 'cortex') {
    try { await apiPost(`/v1/cortex/${encodeURIComponent(name)}/deactivate`); } catch { /* ok */ }
  }

  // Step 2: Remove
  if (component.type === 'extension') {
    await apiDelete(`/v1/extensions/${encodeURIComponent(name)}`);
  } else if (component.type === 'cortex') {
    await apiDelete(`/v1/cortex/${encodeURIComponent(name)}`);
  } else if (component.type === 'app') {
    const owner = session?.owner || '';
    await apiDelete(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  } else if (component.type === 'csm') {
    await apiDelete(`/v1/csm/${encodeURIComponent(name)}`);
  } else if (component.type === 'msm') {
    await apiDelete(`/v1/msm/${encodeURIComponent(name)}`);
  }

  // Step 3: Register new version
  const extracted = validationResult?.extracted || component.result;
  const resp = await registerComponent(component.type, extracted, session, serviceSlug);

  // Step 4: Re-activate if it was active (extensions/cortex that don't auto-activate)
  if (wasActive && component.type === 'extension') {
    const newName = resp?.data?.extension?.name || resp?.data?.name || name;
    try { await apiPost(`/v1/extensions/${encodeURIComponent(newName)}/activate`); } catch { /* best effort */ }
  }
  // Note: cortex auto-activates in registerComponent, so no need to re-activate

  return resp;
}

/**
 * Get the launch URL for the app component in a project.
 */
export function getAppLaunchUrl(components, session) {
  const appComp = components.find(c => c.type === 'app' && c.registeredAs);
  if (!appComp) return null;
  const owner = session?.owner || '';
  const filename = appComp.registeredAs.endsWith('.html') ? appComp.registeredAs : appComp.registeredAs + '.html';
  return `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}?mode=inline`;
}
