/**
 * Generator Service — manages project state via Memory API
 * All state stored at generator.{projectId}.* memory keys
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

/* ── Helpers ─────────────────────────────────────────── */

function genId() {
  return 'prj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function taskId() {
  return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/* ── Project CRUD ────────────────────────────────────── */

export async function listProjects() {
  const resp = await apiGet('/v1/memory?prefix=generator.');
  const items = resp?.data?.items || resp?.data?.entries || [];
  return items
    .filter(i => i.key.endsWith('.project'))
    .map(i => ({ key: i.key, ...(typeof i.value === 'string' ? JSON.parse(i.value) : i.value) }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
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
  await apiPut(`/v1/memory/generator.${projectId}.project`, {
    value: project,
    visibility: 'private',
    version: 0,
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
    visibility: 'private',
    version,
  });
  return { ...updated, _version: version + 1 };
}

export async function archiveProject(projectId) {
  return updateProject(projectId, { status: 'archived' });
}

export async function deleteProject(projectId) {
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.`);
  const items = resp?.data?.items || resp?.data?.entries || [];
  for (const item of items) {
    await apiDelete(`/v1/memory/${encodeURIComponent(item.key)}`);
  }
}

/* ── Component State ─────────────────────────────────── */

export async function getComponent(projectId, componentId) {
  const resp = await apiGet(`/v1/memory/generator.${projectId}.component.${componentId}`);
  return resp?.data || null;
}

export async function saveComponent(projectId, component) {
  const version = component._version || 0;
  const { _version, ...data } = component;
  await apiPut(`/v1/memory/generator.${projectId}.component.${data.id}`, {
    value: data,
    visibility: 'private',
    version,
  });
  return { ...data, _version: version + 1 };
}

export async function loadAllComponents(projectId) {
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.component.`);
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
  await apiPut(`/v1/memory/generator.${projectId}.queue.${id}`, {
    value: entry,
    visibility: 'owner',
  });
  return entry;
}

export async function pollResults(projectId) {
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.results.`);
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
  const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.queue.`);
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
      const resp = await apiGet(`/v1/memory?prefix=generator.${projectId}.${pfx}.`);
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

/* ── Registration ────────────────────────────────────── */

export async function registerComponent(type, result, session) {
  switch (type) {
    case 'csm':
      return apiPost('/v1/csm', typeof result === 'string' ? JSON.parse(result) : result);
    case 'msm':
      return apiPost('/v1/msm', typeof result === 'string' ? JSON.parse(result) : result);
    case 'extension': {
      // POST /v1/extensions expects { manifest: yamlString, scripts: { key: code } }
      const parts = parseExtensionResult(result);
      return apiPost('/v1/extensions', { manifest: parts.manifest, scripts: parts.scripts });
    }
    case 'app':
      return apiPost('/v1/apps', typeof result === 'string' ? JSON.parse(result) : result);
    case 'memory': {
      const entries = typeof result === 'string' ? JSON.parse(result) : result;
      const results = [];
      for (const [key, value] of Object.entries(entries)) {
        results.push(await apiPut(`/v1/memory/${encodeURIComponent(key)}`, { value, visibility: 'private', version: 0 }));
      }
      return { ok: true, registered: results.length };
    }
    case 'translation': {
      const translations = typeof result === 'string' ? JSON.parse(result) : result;
      return { ok: true, translations };
    }
    default:
      throw new Error(`Unknown component type: ${type}`);
  }
}

/* ── Agent Listeners ─────────────────────────────────── */

export async function getListeners() {
  try {
    const resp = await apiGet('/v1/memory?prefix=generator.listeners.');
    const items = resp?.data?.items || resp?.data?.entries || [];
    const now = Date.now();
    return items.map(i => {
      const val = typeof i.value === 'string' ? JSON.parse(i.value) : i.value;
      val.online = val.lastPoll && (now - new Date(val.lastPoll).getTime()) < 5 * 60 * 1000;
      return val;
    });
  } catch { return []; }
}

export function buildAgentSetupPrompt(nodeUrl) {
  return `You are an AIMEAT Generator Agent. Your job is to poll the generator task queue, process pending tasks, and write results back.

## Setup
1. Authenticate with the AIMEAT node at: ${nodeUrl}
   - POST ${nodeUrl}/v1/auth/token with your agent credentials
   - Include the JWT as Bearer token in all subsequent requests

2. Register with capability "generator" if not already done.

## Poll Loop (repeat every 15-30 seconds)

### Step 1: Write heartbeat
PUT ${nodeUrl}/v1/memory/generator.listeners.{your-agent-id}
Body: { "value": { "gaii": "{your-gaii}", "name": "{your-name}", "lastPoll": "{ISO timestamp}", "status": "active" }, "visibility": "owner" }

### Step 2: Scan for pending tasks
GET ${nodeUrl}/v1/memory?prefix=generator.&visibility=owner
Filter items where key contains ".queue." and value.status === "pending".

### Step 3: Claim a task (optimistic locking)
For each pending task at key K with version V:
PUT ${nodeUrl}/v1/memory/{K}
Body: { "value": { ...task, "status": "processing", "claimedBy": "{your-gaii}" }, "visibility": "owner", "version": V }
If 409 Conflict → another agent claimed it, skip.

### Step 4: Process the task
Read task.prompt — it contains the full generation instructions.
Execute the prompt (generate CSM, MSM, extension, app, memory entries, or translations).

### Step 5: Write result
PUT ${nodeUrl}/v1/memory/generator.{projectId}.results.{taskId}
Body: { "value": { "taskId": "{taskId}", "componentId": "{componentId}", "status": "completed", "result": "{your output}", "completedAt": "{ISO timestamp}" }, "visibility": "owner" }

### Step 6: Update queue entry status
PUT ${nodeUrl}/v1/memory/{queue-key}
Body: { "value": { ...task, "status": "completed", "completedAt": "{ISO timestamp}" }, "visibility": "owner", "version": {current version} }

## Error Handling
If processing fails, write status "failed" with an error field instead of "completed".
`;
}

/* ── Extension Result Parser ─────────────────────────── */

function parseExtensionResult(result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  // Extract YAML manifest (first ```yaml block)
  const yamlMatch = text.match(/```yaml\s*\n([\s\S]*?)```/i);
  const manifest = yamlMatch ? yamlMatch[1].trim() : '';
  // Extract JS script blocks (```javascript blocks with // actions/... comments)
  const jsBlocks = [...text.matchAll(/```javascript\s*\n\/\/\s*(actions\/[\w-]+\.js)\s*\n([\s\S]*?)```/gi)];
  const scripts = {};
  for (const m of jsBlocks) {
    const filename = m[1].replace('actions/', '');
    scripts[filename] = m[2].trim();
  }
  return { manifest, scripts };
}
