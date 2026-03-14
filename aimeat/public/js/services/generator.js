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
 *   - Cleanup (cleanupOldEntries)
 *   - Registration (registerComponent)
 * @usage import { listProjects, buildAgentSetupPrompt } from '/js/services/generator.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial generator service
 *   v1.1.0 — 2026-03-14 — Rewritten buildAgentSetupPrompt with SSE, GAII docs, full HTTP examples
 *   v1.1.1 — 2026-03-14 — getListeners now queries /v1/agents instead of memory; heartbeat uses /v1/checkin
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
  await apiPost('/v1/memory', {
    key: `generator.${projectId}.project`,
    value: project,
    visibility: 'private',
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
  const key = `generator.${projectId}.component.${data.id}`;
  if (version === 0) {
    // New component — use POST to create
    await apiPost('/v1/memory', {
      key,
      value: data,
      visibility: 'private',
    });
  } else {
    // Existing component — use PUT with optimistic locking
    await apiPut(`/v1/memory/${key}`, {
      value: data,
      visibility: 'private',
      version,
    });
  }
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
  await apiPost('/v1/memory', {
    key: `generator.${projectId}.queue.${id}`,
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
        results.push(await apiPost('/v1/memory', { key, value, visibility: 'private' }));
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
    description: 'Auto-created agent for the service generator queue',
    capabilities: ['generator'],
  });
  const data = resp?.data || resp;
  return {
    gaii: data.agent?.gaii,
    name: agentName,
    privateKey: data.private_key,
    publicKey: data.public_key,
  };
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

  return `You are an AIMEAT Generator Agent. Your job is to listen for generator tasks via SSE (Server-Sent Events), process them, and write results back.

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

## Event-Driven Task Listening (SSE)

Instead of polling, use Server-Sent Events to react instantly when tasks are queued.

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

**Listen for events where \`domain === "memory"\`** — this means someone wrote to memory (e.g. a new task was queued).

### Step 3: On "memory" event, scan for pending tasks

\`\`\`
GET ${nodeUrl}/v1/memory?prefix=generator.&visibility=owner
Authorization: Bearer {token}
\`\`\`

Filter items where the key contains \`.queue.\` and \`value.status === "pending"\`.

Example response:
\`\`\`json
{
  "ok": true,
  "data": {
    "items": [
      {
        "key": "generator.prj-abc123.queue.task-xyz789",
        "value": {
          "taskId": "task-xyz789",
          "componentId": "csm-main",
          "type": "csm",
          "prompt": "Generate a CSM for...",
          "status": "pending",
          "createdAt": "2026-03-14T01:15:00.000Z",
          "expiresAt": "2026-03-14T01:45:00.000Z"
        },
        "visibility": "owner",
        "version": 1,
        "created_at": "...",
        "updated_at": "..."
      }
    ]
  }
}
\`\`\`

### Step 4: Claim the task (optimistic locking)

For each pending task at key \`K\` with version \`V\`:

\`\`\`
PUT ${nodeUrl}/v1/memory/{K}
Authorization: Bearer {token}
Content-Type: application/json

{
  "value": {
    "taskId": "{from task}",
    "componentId": "{from task}",
    "type": "{from task}",
    "prompt": "{from task}",
    "status": "processing",
    "claimedBy": "${gaii || '{your-gaii}'}",
    "createdAt": "{from task}",
    "expiresAt": "{from task}"
  },
  "visibility": "owner",
  "version": {V}
}
\`\`\`

- If you get **200 OK** → you claimed the task, proceed to Step 5.
- If you get **409 Conflict** → another agent already claimed it, skip this task.

### Step 5: Process the task

Read \`task.prompt\` — it contains the full generation instructions.
Execute the prompt to generate the requested output (CSM, MSM, extension, app HTML, memory entries, or translations).

### Step 6: Write result

Extract \`{projectId}\` and \`{taskId}\` from the task's key (format: \`generator.{projectId}.queue.{taskId}\`).

\`\`\`
PUT ${nodeUrl}/v1/memory/generator.{projectId}.results.{taskId}
Authorization: Bearer {token}
Content-Type: application/json

{
  "value": {
    "taskId": "{taskId}",
    "componentId": "{componentId from task}",
    "status": "completed",
    "result": "{your generated output as a string}",
    "completedAt": "{current ISO timestamp}"
  },
  "visibility": "owner",
  "version": 0
}
\`\`\`

### Step 7: Update queue entry status

\`\`\`
PUT ${nodeUrl}/v1/memory/{original queue key}
Authorization: Bearer {token}
Content-Type: application/json

{
  "value": {
    "...all original task fields...",
    "status": "completed",
    "completedAt": "{current ISO timestamp}"
  },
  "visibility": "owner",
  "version": {current version from your claim write + 1}
}
\`\`\`

## Heartbeat (Checkin)

Call the checkin endpoint on startup and periodically (every 60 seconds) so the UI knows you're online:

\`\`\`
POST ${nodeUrl}/v1/checkin
Authorization: Bearer {token}
\`\`\`

Response: \`{ "ok": true, "data": { "gaii": "...", "last_seen": "..." } }\`

This updates your \`last_seen\` timestamp. The UI uses this to show you as an active listener.

## Error Handling

If task processing fails, write the result with \`"status": "failed"\` and include an \`"error"\` field:

\`\`\`json
{
  "value": {
    "taskId": "...",
    "componentId": "...",
    "status": "failed",
    "error": "Description of what went wrong",
    "completedAt": "..."
  },
  "visibility": "owner",
  "version": 0
}
\`\`\`

Also update the queue entry status to \`"failed"\` (same as Step 7 but with status "failed").

## SSE Reconnection

The SSE stream may disconnect. When it does:
1. Re-authenticate if your token has expired (POST /v1/auth/token)
2. Get a new SSE ticket (POST /v1/events/ticket)
3. Reconnect to the SSE stream (GET /v1/events?ticket={ticket})
4. Immediately scan for pending tasks (Step 3) in case events were missed during disconnect

## Lifecycle Summary

\`\`\`
authenticate → checkin → get SSE ticket → connect SSE stream
                                               ↓
                                       on "memory" event:
                                         scan for pending tasks →
                                         claim task (409 = skip) →
                                         process prompt →
                                         write result →
                                         update queue status →
                                         checkin
\`\`\`
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
