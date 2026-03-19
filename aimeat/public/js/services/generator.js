/**
 * @file generator.js
 * @description Generator service — manages project state, task queue, agent listeners,
 *   and agent setup prompt generation via the AIMEAT Memory API.
 *   All state stored at generator.{projectId}.* memory keys.
 * @structure
 *   - Project CRUD (listProjects, createProject, updateProject, deleteProject, archiveProject)
 *   - Component state (getComponent, saveComponent, loadAllComponents)
 *   - Agent queue (enqueueTask, pollResults, pollLogs, checkQueueStatus)
 *   - Agent discovery (discoverAgents, getListeners)
 *   - Agent setup (createGeneratorAgent, buildAgentSetupPrompt)
 *   - Interview Spec (saveInterviewSpec, getInterviewSpec)
 *   - Cleanup (cleanupOldEntries)
 *   - Registration (registerComponent) — includes cortex case with auto-activate
 *   - Lifecycle (getComponentStatuses, activateAll, deactivateAll, removeComponents, reregisterComponent, getAppLaunchUrl)
 * @usage import { listProjects, buildAgentSetupPrompt } from '/js/services/generator.js';
 * @version-history
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
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { parse as parseYaml, stringify as stringifyYaml } from '/lib/yaml.mjs';

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
  const resp = await apiGet(`/v1/memory/generator.${projectId}.project`);
  if (!resp?.data) return null;
  const item = resp.data;
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
  const { _version, ...rest } = current;
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
        // Clean extension memory (ext:{name} namespace)
        try {
          const memResp = await apiGet(`/v1/memory?prefix=&owner=ext:${encodeURIComponent(name)}&owner_scope=true`);
          for (const item of (memResp?.data?.items || [])) {
            try { await apiDelete(`/v1/memory/${encodeURIComponent(item.key)}?owner=ext:${encodeURIComponent(name)}`); } catch { /* best effort */ }
          }
        } catch { /* best effort */ }
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
  // registeredAs format: "halytyskartta.i18n-fi" or "i18n-fi" (legacy)
  const translationComps = components.filter(c => c.type === 'translation' && c.registeredAs);
  const extComp = components.find(c => c.type === 'extension' && c.registeredAs);
  const csmComp = components.find(c => c.type === 'csm' && c.registeredAs);
  const slug = extComp?.registeredAs || csmComp?.registeredAs?.split('/')?.pop() || '';
  for (const comp of translationComps) {
    const name = comp.registeredAs;
    if (name) {
      // Try service-prefixed key first, then legacy format
      const locale = name.replace(/^.*i18n-/, '');
      const prefixedKey = slug ? `${slug}.i18n.${locale}` : `i18n.${locale}`;
      try { await apiDelete(`/v1/memory/${encodeURIComponent(prefixedKey)}`); } catch { /* best effort */ }
      // Also try legacy unprefixed key
      if (slug) {
        try { await apiDelete(`/v1/memory/${encodeURIComponent(`i18n.${locale}`)}`); } catch { /* best effort */ }
      }
    }
  }

  // Phase 3: Delete all generator state keys
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.&owner_scope=true`);
  const items = resp?.data?.items || resp?.data?.entries || [];
  for (const item of items) {
    await apiDelete(`/v1/memory/${encodeURIComponent(item.key)}`);
  }
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
    const resp = await apiGet(`/v1/memory/generator.${projectId}.interview-spec`);
    if (!resp?.data?.value) return null;
    return typeof resp.data.value === 'string' ? JSON.parse(resp.data.value) : resp.data.value;
  } catch { return null; }
}

/* ── Component State ─────────────────────────────────── */

export async function getComponent(projectId, componentId) {
  const resp = await apiGet(`/v1/memory/generator.${projectId}.component.${componentId}`);
  return resp?.data || null;
}

export async function saveComponent(projectId, component) {
  let version = component._version || 0;
  const { _version, ...data } = component;
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

export async function loadAllComponents(projectId) {
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.component.&owner_scope=true`);
  const items = resp?.data?.items || resp?.data?.entries || [];
  return items.map(i => {
    const val = typeof i.value === 'string' ? JSON.parse(i.value) : i.value;
    return { ...val, _version: i.version };
  });
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

/* ── Agent Discovery ─────────────────────────────────── */

export async function discoverAgents() {
  try {
    const resp = await apiGet('/v1/agents');
    const agents = resp?.data?.agents || resp?.data || [];
    // Filter client-side for agents with generation-relevant capabilities
    return agents.filter(a => {
      const caps = a.capabilities || [];
      return caps.some(c => ['generator', 'builder', 'code-generation', 'general'].includes(c));
    });
  } catch { return []; }
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

/* ── App Manifest Parser ─────────────────────────────── */

/**
 * Extract name, description, version from an AIMEAT App Manifest HTML comment.
 * Expected format: <!-- AIMEAT App Manifest\nname: ...\nversion: ...\n-->
 */
function parseAppManifest(html) {
  const meta = { name: '', description: '', version: '1.0.0' };
  const match = html.match(/<!--\s*AIMEAT App Manifest\s*\n([\s\S]*?)-->/i);
  if (!match) return meta;
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*(name|description|version|entry)\s*:\s*(.+)/i);
    if (m) {
      const key = m[1].toLowerCase();
      if (key in meta) meta[key] = m[2].trim();
    }
  }
  return meta;
}

/* ── Registration ────────────────────────────────────── */

/**
 * Clean YAML through the real yaml parser: parse → re-serialize.
 * No regex hacks. If the YAML is valid, the parser handles block scalars,
 * multiline strings, quoting, etc. correctly. Returns clean YAML string.
 * Falls back to minimal text cleanup if parse fails entirely.
 */
function cleanYaml(text) {
  if (typeof text !== 'string') return text;
  // Minimal pre-clean: only fix chars that prevent parsing at all
  let s = text;
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  s = s.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  try {
    const parsed = parseYaml(s);
    return stringifyYaml(parsed, { lineWidth: 0 });
  } catch {
    // Try fixing markdown bullets and retry
    s = s.replace(/^(\s*)\*\s{2,}/gm, '$1- ');
    s = s.replace(/^(\s*)\*\s+(?=\S)/gm, '$1- ');
    try {
      const parsed = parseYaml(s);
      return stringifyYaml(parsed, { lineWidth: 0 });
    } catch {
      return s; // give up, return pre-cleaned text
    }
  }
}

/**
 * Prefix service.name in YAML with owner namespace (owner/name) to avoid collisions.
 * If already namespaced with this owner, leaves it unchanged.
 */
function namespacedYaml(result, owner) {
  const raw = typeof result === 'string' ? cleanYaml(result) : result;
  if (!owner || typeof raw !== 'string') return typeof result === 'string' ? { yaml: raw } : result;
  try {
    const parsed = parseYaml(raw);
    const name = parsed?.service?.name;
    if (name && !name.startsWith(owner + '/')) {
      parsed.service.name = owner + '/' + name;
    }
    return { yaml: stringifyYaml(parsed, { lineWidth: 0 }) };
  } catch {
    return { yaml: raw };
  }
}

/**
 * POST a CSM/MSM manifest. On 409 NAME_TAKEN, delete the old one (if owned) and retry.
 */
async function upsertManifest(endpoint, body, owner) {
  try {
    return await apiPost(endpoint, body);
  } catch (err) {
    const code = err?.code || '';
    if (err?.status === 409 || code.includes('NAME_TAKEN')) {
      // Extract name from the YAML we just tried to post
      try {
        const parsed = parseYaml(body.yaml);
        const name = parsed?.service?.name;
        if (name) {
          await apiDelete(`${endpoint}/${encodeURIComponent(name)}`);
          return await apiPost(endpoint, body);
        }
      } catch { /* delete failed — not our manifest, surface original error */ }
    }
    throw err;
  }
}

export async function registerComponent(type, result, session, serviceSlug = '') {
  const owner = session?.owner;
  switch (type) {
    case 'csm': {
      // CSM results are YAML — namespace the service name with owner to avoid collisions
      const yaml = namespacedYaml(result, owner);
      return upsertManifest('/v1/csm', yaml, owner);
    }
    case 'msm': {
      // MSM results are YAML — namespace the service name with owner to avoid collisions
      const yaml = namespacedYaml(result, owner);
      return upsertManifest('/v1/msm', yaml, owner);
    }
    case 'extension': {
      // POST /v1/extensions expects { manifest: yamlString, scripts: { key: code } }
      const parts = parseExtensionResult(result);
      return apiPost('/v1/extensions', { manifest: cleanYaml(parts.manifest), scripts: parts.scripts });
    }
    case 'app': {
      // App result is HTML. POST /v1/apps expects { filename, content (base64), name, description, ... }
      const html = typeof result === 'string' ? result : String(result);
      const appMeta = parseAppManifest(html);
      const content = btoa(unescape(encodeURIComponent(html))); // UTF-8 safe base64
      return apiPost('/v1/apps', {
        filename: (appMeta.name || 'app') + '.html',
        content,
        mime_type: 'text/html',
        name: appMeta.name || 'Generated App',
        description: appMeta.description || '',
        version: appMeta.version || '1.0.0',
      });
    }
    case 'memory': {
      const entries = typeof result === 'string' ? JSON.parse(result) : result;
      const results = [];
      for (const [rawKey, value] of Object.entries(entries)) {
        // Service-prefix memory keys to avoid collisions across services
        // Skip __meta and __index keys (they already contain the namespace)
        const key = (serviceSlug && !rawKey.startsWith(serviceSlug + '.'))
          ? `${serviceSlug}.${rawKey}`
          : rawKey;
        results.push(await apiPost('/v1/memory', { key, value, visibility: 'public' }));
      }
      return { data: { registered: results.length, keys: results.map((_, i) => {
        const rawKey = Object.keys(entries)[i];
        return (serviceSlug && !rawKey.startsWith(serviceSlug + '.'))
          ? `${serviceSlug}.${rawKey}`
          : rawKey;
      }) } };
    }
    case 'translation': {
      const translations = typeof result === 'string' ? JSON.parse(result) : result;
      // Store each locale's translations with service-prefix to avoid collisions
      const locales = [];
      for (const [locale, strings] of Object.entries(translations)) {
        if (locale && typeof strings === 'object') {
          const key = serviceSlug ? `${serviceSlug}.i18n.${locale}` : `i18n.${locale}`;
          await apiPost('/v1/memory', {
            key,
            value: strings,
            visibility: 'public',
          });
          locales.push(locale);
        }
      }
      const prefix = serviceSlug ? `${serviceSlug}.` : '';
      return { ok: true, data: { locales, name: `${prefix}i18n-${locales.join('-')}` } };
    }
    case 'cortex': {
      // Cortex result contains YAML manifest + optional JS lib code (pre-extracted by validator)
      const extracted = typeof result === 'string' ? null : result;
      if (!extracted || !extracted.manifest) {
        throw new Error('Cortex result must be pre-extracted by validator (manifest + libs)');
      }
      const body = { manifest: extracted.manifest };
      if (extracted.libs && extracted.libs.length > 0) {
        const libs = {};
        for (const lib of extracted.libs) {
          if (lib.filename && lib.code) libs[lib.filename] = lib.code;
        }
        if (Object.keys(libs).length > 0) body.libs = libs;
      }
      const installResp = await apiPost('/v1/cortex', body);
      // Auto-activate after install
      const name = installResp?.data?.name || installResp?.data?.extension?.name;
      if (name) {
        await apiPost(`/v1/cortex/${encodeURIComponent(name)}/activate`);
      }
      return installResp;
    }
    default:
      throw new Error(`Unknown component type: ${type}`);
  }
}

/* ── Lifecycle Management ────────────────────────────── */

/**
 * Get live status for all registered components in a project.
 * Checks extensions, cortex, and apps APIs for current state.
 */
export async function getComponentStatuses(projectId) {
  const components = await loadAllComponents(projectId);
  const statuses = {};

  // Fetch live extension list
  let liveExtensions = [];
  try {
    const resp = await apiGet('/v1/extensions');
    liveExtensions = resp?.data?.extensions || resp?.data || [];
  } catch { /* extensions API may not exist */ }

  // Fetch live cortex list
  let liveCortexes = [];
  try {
    const resp = await apiGet('/v1/cortex');
    liveCortexes = resp?.data?.extensions || resp?.data || [];
  } catch { /* cortex API may not exist */ }

  // Fetch live apps list
  let liveApps = [];
  try {
    const resp = await apiGet('/v1/apps');
    liveApps = resp?.data?.apps || resp?.data || [];
  } catch { /* apps API may not exist */ }

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
        // Translation keys stored as {service}.i18n.{locale} or legacy i18n.{locale}
        const locale = name.replace(/^.*i18n-/, '');
        if (locale) {
          // Find service slug from sibling extension/csm
          const extSibling = comps.find(c => c.type === 'extension' && c.registeredAs);
          const csmSibling = comps.find(c => c.type === 'csm' && c.registeredAs);
          const svcSlug = extSibling?.registeredAs || csmSibling?.registeredAs?.split('/')?.pop() || '';
          const memKey = svcSlug ? `${svcSlug}.i18n.${locale}` : `i18n.${locale}`;
          try { await apiDelete(`/v1/memory/${encodeURIComponent(memKey)}`); } catch { /* best effort */ }
          if (svcSlug) {
            try { await apiDelete(`/v1/memory/${encodeURIComponent(`i18n.${locale}`)}`); } catch { /* best effort */ }
          }
        }
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
  return `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(appComp.registeredAs)}?mode=inline`;
}

/* ── Agent Listeners ─────────────────────────────────── */

export async function getListeners() {
  try {
    const resp = await apiGet('/v1/agents');
    const agents = resp?.data?.agents || [];
    const now = Date.now();
    return agents
      .filter(a => (a.capabilities || []).includes('generator'))
      .map(a => ({
        gaii: a.gaii,
        name: a.name || a.display_name,
        lastPoll: a.last_seen,
        status: 'active',
        online: a.last_seen && (now - new Date(a.last_seen).getTime()) < 5 * 60 * 1000,
      }));
  } catch { return []; }
}

/* ── Generator Agent Setup ──────────────────────────── */

/**
 * Create a dedicated generator agent via POST /v1/agents.
 * Returns { gaii, privateKey, publicKey, name } or throws on failure.
 */
export async function createGeneratorAgent(ownerName) {
  const agentName = 'generator-' + Date.now().toString(36);
  const resp = await apiPost('/v1/agents', {
    name: agentName,
    owner: ownerName,
    display_name: 'Generator Agent',
    description: 'Auto-created agent for the service generator pipeline',
    capabilities: ['generator'],
    scopes: [
      'memory:read', 'memory:write', 'memory:delete',
      'catalogue:read',
      'generator:read', 'generator:write', 'generator:execute',
    ],
  });
  const data = resp?.data || resp;
  return {
    gaii: data.agent?.gaii,
    name: agentName,
    privateKey: data.private_key,
    publicKey: data.public_key,
  };
}

/**
 * Build a SHORT agent setup prompt with credentials + URL to full instructions.
 * Suitable for Telegram/chat where long prompts get split into multiple messages.
 */
export function buildAgentShortPrompt(nodeUrl, credentials) {
  const { gaii, name, privateKey } = credentials || {};
  return `You are an AIMEAT Generator Agent.

## Credentials
- GAII: ${gaii}
- Agent name: ${name}
- Private key (Ed25519, base64): ${privateKey}
- Node URL: ${nodeUrl}

## Full instructions
Fetch and read: ${nodeUrl}/v1/generator/agent-guide

That document contains everything: authentication, SSE setup, the full generator pipeline (blueprint → components → registration), heartbeat, error handling.

## Quick start
1. Authenticate: POST ${nodeUrl}/v1/auth/token — sign (GAII + timestamp) with your private key
2. Checkin: POST ${nodeUrl}/v1/checkin — marks you as online
3. Connect SSE: POST ${nodeUrl}/v1/events/ticket → GET ${nodeUrl}/v1/events?ticket={ticket}
4. On SSE "memory" event: GET ${nodeUrl}/v1/generator/projects → for each project, GET ${nodeUrl}/v1/generator/{projectId}
5. If response has session.agentGaii === your GAII → you are assigned. Do NOT call /session/claim (owner already did it).
6. Start heartbeat (POST .../session/heartbeat every 60s), then execute the pipeline per the full instructions above.

## Persistent connection

Ask the user: "Do you want me to set up a persistent listener service that runs in the background and automatically handles generator tasks whenever they're assigned? Or should I wait for you to tell me when to start?"

If the user wants persistent: set up a background service/daemon that maintains the SSE connection and auto-executes when assigned. If you cannot create a persistent service on this platform, tell the user clearly.

If the user wants manual: wait for the user to say when to start, then execute once.`;
}

export function buildAgentSetupPrompt(nodeUrl, credentials) {
  const { gaii, name, privateKey } = credentials || {};

  const credentialsBlock = gaii && privateKey ? `
## Your Credentials

- **GAII:** \`${gaii}\`
- **Agent name:** \`${name}\`
- **Private key (Ed25519, base64):** \`${privateKey}\`

> Store these securely. The private key cannot be retrieved again.

## GAII Format

GAII (Global AI Identifier) follows the format: \`agent#owner@node\`
- **Agent name:** 3-64 chars, lowercase alphanumeric + hyphens only (\`[a-z0-9-]\`). No underscores.
- **Owner name:** same rules as agent name.
- **Node ID:** format \`aimeat-{region}-{number}-{name}\` (e.g. \`aimeat-finland-001-genesis\`).
- Your GAII is: \`${gaii}\`

## Authentication

Before making any API call, obtain a JWT token using Ed25519 signature-based authentication.

### Steps

1. Generate a current ISO 8601 timestamp (e.g. \`2026-03-14T01:15:00.000Z\`)
2. Concatenate: \`{your GAII}{timestamp}\` — no separator, just the two strings joined
3. Sign the concatenated string with your Ed25519 private key (raw bytes, not hashed first)
4. Base64-encode the 64-byte signature
5. POST to get a JWT

### Auth Request

\`\`\`
POST ${nodeUrl}/v1/auth/token
Content-Type: application/json

{
  "gaii": "${gaii}",
  "timestamp": "{ISO 8601 timestamp you generated in step 1}",
  "signature": "{base64-encoded Ed25519 signature from step 4}"
}
\`\`\`

### Auth Response

\`\`\`json
{
  "ok": true,
  "data": {
    "token": "eyJ...",
    "expires_at": "2026-03-14T02:15:00.000Z"
  }
}
\`\`\`

### Using the Token

Include in all subsequent requests: \`Authorization: Bearer {token}\`

**Token expiry:** Check \`expires_at\` in the response. When a request returns HTTP 401, re-authenticate by repeating the steps above.

### Example — Node.js

\`\`\`javascript
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const GAII = '${gaii}';
const PRIVATE_KEY = '${privateKey}'; // base64-encoded 32-byte Ed25519 seed

async function authenticate() {
  const timestamp = new Date().toISOString();
  const message = GAII + timestamp;
  const msgBytes = new TextEncoder().encode(message);
  const keyBytes = Uint8Array.from(atob(PRIVATE_KEY), c => c.charCodeAt(0));
  const sigBytes = await ed.signAsync(msgBytes, keyBytes);
  const signature = btoa(String.fromCharCode(...sigBytes));

  const resp = await fetch('${nodeUrl}/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gaii: GAII, timestamp, signature }),
  });
  const data = await resp.json();
  return data.data.token;
}
\`\`\`

### Example — Python

\`\`\`python
import base64, requests
from datetime import datetime, timezone
from nacl.signing import SigningKey

GAII = '${gaii}'
PRIVATE_KEY = '${privateKey}'  # base64-encoded 32-byte Ed25519 seed

def authenticate():
    timestamp = datetime.now(timezone.utc).isoformat()
    message = (GAII + timestamp).encode()
    key_bytes = base64.b64decode(PRIVATE_KEY)
    signing_key = SigningKey(key_bytes)
    signature = base64.b64encode(signing_key.sign(message).signature).decode()

    resp = requests.post('${nodeUrl}/v1/auth/token', json={
        'gaii': GAII, 'timestamp': timestamp, 'signature': signature
    })
    return resp.json()['data']['token']
\`\`\`
` : `
## Setup
1. Authenticate with the AIMEAT node at: ${nodeUrl}
   - POST ${nodeUrl}/v1/auth/token with your agent credentials
   - Include the JWT as Bearer token in all subsequent requests

2. Register with capability "generator" if not already done.`;

  return `You are an AIMEAT Generator Agent. Your job is to listen for session assignments via SSE, then autonomously execute the full service generation pipeline — blueprint, components, registration.

**Node URL:** ${nodeUrl}
${credentialsBlock}

## AIMEAT API Conventions

All responses follow this envelope format:
\`\`\`json
{
  "ok": true,
  "protocol": "aimeat",
  "version": "v1",
  "node": "aimeat-...",
  "timestamp": "...",
  "data": { ... },
  "hints": [ { "description": "...", "method": "GET", "url": "/v1/..." } ]
}
\`\`\`

Error responses have \`"ok": false\` and an \`"error": { "code": "...", "message": "..." }\` field instead of \`data\`.

**Memory API specifics:**
- Keys use dots as separators (e.g. \`generator.listeners.my-agent\`). Allowed chars: \`a-z0-9._-\`
- \`visibility\` controls access: \`"private"\` = only this agent, \`"owner"\` = all agents under same owner, \`"public"\` = anyone
- \`version\` enables optimistic concurrency: set \`"version": 0\` for first write, then use the version returned by the server for updates. A 409 Conflict means another writer changed it first.

## Discovering Session Assignments (SSE)

Use Server-Sent Events to discover when you've been assigned a generation session.

### Step 1: Get an SSE ticket

\`\`\`
POST ${nodeUrl}/v1/events/ticket
Authorization: Bearer {token}
\`\`\`

Response: \`{ "ok": true, "data": { "ticket": "abc123...", "expires": 30 } }\`

### Step 2: Connect to the SSE stream

\`\`\`
GET ${nodeUrl}/v1/events?ticket={ticket}
\`\`\`

This returns a \`text/event-stream\`. Each event is a JSON line:
\`\`\`
data: {"domain":"memory","timestamp":1710378900000}
\`\`\`

### Step 3: On "memory" event, check for assigned sessions

When you receive an event where \`domain === "memory"\`, check for projects assigned to you:

\`\`\`
GET ${nodeUrl}/v1/generator/projects
Authorization: Bearer {token}
\`\`\`

Look for projects where \`session.agentGaii\` matches your GAII (\`${gaii || '{your-gaii}'}\`) and \`session.status === "active"\`.

### Step 4: Load the full project state

\`\`\`
GET ${nodeUrl}/v1/generator/{projectId}
Authorization: Bearer {token}
\`\`\`

Response includes \`project\`, \`interviewSpec\`, \`components\`, and \`session\`. The \`interviewSpec\` contains everything from the user interview — service name, description, components to generate, and detailed specs for each.

### Step 5: Claim the session

\`\`\`
POST ${nodeUrl}/v1/generator/{projectId}/session/claim
Authorization: Bearer {token}
\`\`\`

- **200 OK** → you own the session, proceed with generation.
- **409 SESSION_BUSY** → another agent already claimed it, do not proceed.

## Heartbeat Loop

Once you have claimed a session, send heartbeats every 60 seconds to keep the session alive. The session TTL is 5 minutes — if you miss heartbeats for 5 minutes, the UI shows "Agent disconnected" and the owner can reassign.

\`\`\`
POST ${nodeUrl}/v1/generator/{projectId}/session/heartbeat
Authorization: Bearer {token}
Content-Type: application/json

{
  "phase": "blueprint",
  "componentId": null,
  "stepNumber": 1,
  "totalSteps": 5
}
\`\`\`

The \`phase\` field tracks where you are in the pipeline: \`"blueprint"\`, \`"generating"\`, \`"registering"\`, \`"completing"\`.
The \`componentId\` field is null during blueprint phase, then the ID of the component being processed.
\`stepNumber\` and \`totalSteps\` let the UI show a progress bar.

**CRITICAL:** If heartbeat returns **404** → the owner clicked Stop. You MUST immediately cease all work and exit the pipeline. Do not write any more results.

## Logging

Throughout the pipeline, write log entries so the owner sees real-time progress in the UI:

\`\`\`
POST ${nodeUrl}/v1/generator/{projectId}/log
Authorization: Bearer {token}
Content-Type: application/json

{
  "level": "info",
  "message": "Generating CSM for user profiles...",
  "componentId": "csm-profiles"
}
\`\`\`

Levels: \`"info"\` for progress updates, \`"warn"\` for retries/non-fatal issues, \`"error"\` for failures.
Include \`componentId\` when the log relates to a specific component, omit it for general pipeline messages.

## Generation Pipeline

### Phase 1: Blueprint

Read the \`interviewSpec\` from the project state. Generate a blueprint that defines all components to build, their types, dependencies, and generation order.

\`\`\`
POST ${nodeUrl}/v1/generator/{projectId}/steps/blueprint
Authorization: Bearer {token}
Content-Type: application/json

{
  "blueprint": "{ ... blueprint JSON as string ... }"
}
\`\`\`

The server validates the blueprint structure. If validation fails (400 response), read the error message, fix the blueprint, and retry. **Maximum 3 retries** — if it still fails after 3 attempts, log the error and stop.

Update heartbeat: \`{ "phase": "blueprint", "stepNumber": 1, "totalSteps": 1 }\`

### Phase 2: Component Generation

For each component defined in the blueprint, generate the content and submit it:

\`\`\`
POST ${nodeUrl}/v1/generator/{projectId}/components/{componentId}/submit
Authorization: Bearer {token}
Content-Type: application/json

{
  "type": "csm",
  "content": "{ ... component content as string ... }"
}
\`\`\`

Valid types: \`"csm"\`, \`"msm"\`, \`"extension"\`, \`"app"\`, \`"memory"\`, \`"translation"\`, \`"cortex"\`.

The server validates each component. On validation error (400), read the error details, fix the content, and resubmit. **Maximum 3 retries per component.**

After each component, update heartbeat with progress:
\`\`\`json
{ "phase": "generating", "componentId": "csm-profiles", "stepNumber": 3, "totalSteps": 8 }
\`\`\`

### Phase 3: Registration

After all components are validated and stored, register each one to the node's catalogue:

\`\`\`
POST ${nodeUrl}/v1/generator/{projectId}/components/{componentId}/register
Authorization: Bearer {token}
\`\`\`

Update heartbeat: \`{ "phase": "registering", "componentId": "csm-profiles", "stepNumber": 6, "totalSteps": 8 }\`

### Phase 4: Completion

When all components are generated and registered:

\`\`\`
POST ${nodeUrl}/v1/generator/{projectId}/complete
Authorization: Bearer {token}
\`\`\`

This marks the project as active and releases the session.

## Checkin (Listener Bar)

Call the checkin endpoint on startup and periodically (every 60 seconds) so the UI knows you're online:

\`\`\`
POST ${nodeUrl}/v1/checkin
Authorization: Bearer {token}
\`\`\`

Response: \`{ "ok": true, "data": { "gaii": "...", "last_seen": "..." } }\`

This updates your \`last_seen\` timestamp. The UI uses this to show you as an active listener.

## Error Handling

- **404 on heartbeat** → owner clicked Stop. Cease all work immediately.
- **409 SESSION_BUSY on claim** → another agent already has the session. Do not proceed.
- **400 validation errors** → read the error message, fix your output, and retry (max 3 attempts per step).
- **Network errors** → use exponential backoff (1s, 2s, 4s, 8s...) up to 60s max delay.
- **Auth errors (401/403)** → re-authenticate with POST /v1/auth/token, then retry.

## SSE Reconnection

The SSE stream may disconnect. When it does:
1. Re-authenticate if your token has expired (POST /v1/auth/token)
2. Get a new SSE ticket (POST /v1/events/ticket)
3. Reconnect to the SSE stream (GET /v1/events?ticket={ticket})
4. Immediately check for pending session assignments (Step 3) in case events were missed during disconnect

## Lifecycle Summary

\`\`\`
authenticate → checkin → get SSE ticket → connect SSE stream
                                               ↓
                                       on "memory" event:
                                         GET /v1/generator/projects →
                                         find assigned session →
                                         POST .../session/claim (409 = skip) →
                                         ┌─────────────────────────────────────┐
                                         │  start heartbeat loop (every 60s)  │
                                         │  POST .../session/heartbeat        │
                                         │  (404 = stop immediately)          │
                                         └─────────────────────────────────────┘
                                         POST .../steps/blueprint →
                                         for each component:
                                           POST .../components/{id}/submit →
                                           POST .../components/{id}/register →
                                           POST .../log (progress) →
                                           heartbeat (update progress) →
                                         POST .../complete →
                                         checkin
\`\`\`
`;
}

/* ── Extension Result Parser ─────────────────────────── */

function parseExtensionResult(result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result);

  // Strategy 1: markdown fences present — use them
  const yamlMatch = text.match(/```yaml\s*\n([\s\S]*?)```/i);
  const fencedJs = [...text.matchAll(/```javascript\s*\n\/\/\s*(actions\/[\w-]+\.js)\s*\n([\s\S]*?)```/gi)];

  if (yamlMatch && fencedJs.length > 0) {
    const scripts = {};
    for (const m of fencedJs) {
      scripts[m[1].replace('actions/', '')] = m[2].trim();
    }
    return { manifest: yamlMatch[1].trim(), scripts };
  }

  // Strategy 2: no fences — split on `// actions/filename.js` comment boundaries
  // The YAML manifest is everything before the first `// actions/` line.
  // Each JS file starts at `// actions/filename.js` and ends before the next one.
  const actionCommentRegex = /^\/\/\s*actions\/([\w-]+\.js)\s*$/gm;
  const boundaries = [];
  let m;
  while ((m = actionCommentRegex.exec(text)) !== null) {
    boundaries.push({ filename: m[1], index: m.index, afterComment: m.index + m[0].length });
  }

  if (boundaries.length === 0) {
    // No JS blocks found at all — return whatever we have as manifest
    const manifest = yamlMatch ? yamlMatch[1].trim() : text.trim();
    return { manifest, scripts: {} };
  }

  // Everything before first // actions/ comment is the YAML manifest
  let manifest = text.slice(0, boundaries[0].index).trim();
  // Strip any markdown fences or stray ``` from the manifest
  manifest = manifest.replace(/^```\w*\s*\n?/gm, '').replace(/```\s*$/gm, '').trim();

  const scripts = {};
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].afterComment;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
    let code = text.slice(start, end).trim();
    // Strip any trailing/leading markdown fences
    code = code.replace(/^```\w*\s*\n?/gm, '').replace(/```\s*$/gm, '').trim();
    scripts[boundaries[i].filename] = code;
  }

  return { manifest, scripts };
}
