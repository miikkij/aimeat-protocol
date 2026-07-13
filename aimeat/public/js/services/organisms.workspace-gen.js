/**
 * @file public/js/services/organisms.workspace-gen.js
 * @description Manifest-driven workspace generator — the shipped "project" template (object types,
 *   schemas, manifest), the one-shot Workspace Architect prompt, and the parse/validate/apply
 *   pipeline that turns an AI response into a locked workspace. Extracted from organisms.js.
 * @usage import { buildGeneratorPrompt, parseGenerated, validateGenerated, applyGeneratedWorkspace } from './organisms.workspace-gen.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from organisms.js (max-file-lines)
 */
import { api, apiGet, apiPost, apiPut } from '/js/api.js';
import { wsRoot } from './organisms.shared.js';

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
- "document" — free-form markdown that grows organically, with no schema. Use this whenever the user asks for documents, a wiki, notes, guides, design docs, or an open / free-form format. Documents render rich markdown: \`\`\`mermaid fenced blocks become diagrams, and \`\`\`aimeat-memory fenced blocks become LIVE data (the block names a memory key; the document shows that key's current value — array of objects renders as a table — fresh on every open, so agent-maintained data belongs in a memory key + embed, not in pasted static tables). Mention these in a document space's "description" when the space is meant for dashboards or agent-fed reports.

Respond with this shape:
{
  "manifest": {
    "manifestVersion": "1.0",
    "id": "",
    "name": "<short workspace name>",
    "kind": "<short-kebab-case kind, e.g. game-dev>",
    "status": "active",
    "objectTypes": [ <one entry per type> ],
    "i18n": { <UI labels per language — see below> },
    "policy": { "agentAutonomy": "L3", "alwaysGate": [] }
  },
  "schemas": { <one JSON Schema per RECORDS type, keyed by that type's namespace> },
  "examples": { <1-3 sample records per RECORDS type, keyed by that type's namespace> }
}

Give every objectType all of these fields:
- "name": a short singular noun, e.g. "milestone" or "design-doc".
- "description": one short sentence on what this space is for — the workspace UI shows it under the space's title so a reader knows what belongs here.
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
Also, for each property:
- Give every property except "id" a short English "description" telling a human what to fill in.
- Result fields that an agent or automation fills later (e.g. result_ref, output links, error details) get "readOnly": true — the form hides them from humans. Never list a readOnly field in "required".
- Fields that should default to the acting user's identity (e.g. requested_by, created_by, author) get "x-default": "currentUser".

Inside "manifest", add an "i18n" object with UI labels: one entry per language — always "en", plus the language of the user's request if different. Keys are flat strings:
- "<namespace>.<field>": a short human label for that field
- "<namespace>.<field>.hint": one short sentence telling the user what to enter
- "type.<objectType name>": a short plural label for that type's tab
- "type.<objectType name>.desc": one short sentence on what this space is for (the localized form of the objectType "description")
Example: "i18n": { "en": { "shared.milestones.title": "Title", "shared.milestones.title.hint": "A short name for the milestone", "type.milestone": "Milestones", "type.milestone.desc": "Project milestones and their status" }, "fi": { "shared.milestones.title": "Otsikko", "shared.milestones.title.hint": "Lyhyt nimi virstanpylväälle", "type.milestone": "Virstanpylväät", "type.milestone.desc": "Projektin virstanpylväät ja niiden tila" } }
Cover every field of every RECORDS type (labels + hints) and every objectType (type.<name> + type.<name>.desc) in every language you include.

For each DOCUMENT type, the content is free markdown — keep it out of "schemas" and "examples" (a document needs neither).

Under "examples", add 1-3 realistic sample records per RECORDS type, with ids like "example-1", each valid against that type's schema.

Worked example — request "track game milestones plus free-form design docs":
{
  "manifest": {
    "manifestVersion": "1.0", "id": "", "name": "Game Project", "kind": "game-dev", "status": "active",
    "objectTypes": [
      { "name": "milestone", "description": "Project milestones and their status", "schemaRef": "schema:milestone@1", "namespace": "shared.milestones", "backing": "memory", "writeRole": "member", "cardinality": "many", "versioned": true, "mode": "records" },
      { "name": "design-doc", "description": "Free-form design documents", "schemaRef": "schema:design-doc@1", "namespace": "shared.design-docs", "backing": "memory", "writeRole": "member", "cardinality": "many", "versioned": true, "mode": "document" }
    ],
    "i18n": {
      "en": { "type.milestone": "Milestones", "type.milestone.desc": "Project milestones and their status", "type.design-doc": "Design docs", "type.design-doc.desc": "Free-form design documents", "shared.milestones.title": "Title", "shared.milestones.title.hint": "A short name for the milestone", "shared.milestones.status": "Status", "shared.milestones.status.hint": "Where this milestone stands", "shared.milestones.due_date": "Due date", "shared.milestones.due_date.hint": "When this should be done" },
      "fi": { "type.milestone": "Virstanpylväät", "type.milestone.desc": "Projektin virstanpylväät ja niiden tila", "type.design-doc": "Suunnitteludokumentit", "type.design-doc.desc": "Vapaamuotoiset suunnitteludokumentit", "shared.milestones.title": "Otsikko", "shared.milestones.title.hint": "Lyhyt nimi virstanpylväälle", "shared.milestones.status": "Tila", "shared.milestones.status.hint": "Missä vaiheessa tämä on", "shared.milestones.due_date": "Määräpäivä", "shared.milestones.due_date.hint": "Milloin tämän pitäisi olla valmis" }
    },
    "policy": { "agentAutonomy": "L3", "alwaysGate": [] }
  },
  "schemas": {
    "shared.milestones": { "type": "object", "required": ["id", "title", "status"], "properties": { "id": { "type": "string" }, "title": { "type": "string", "description": "A short name for the milestone" }, "status": { "type": "string", "enum": ["planned", "in-progress", "done"], "description": "Where this milestone stands" }, "due_date": { "type": "string", "format": "date", "description": "When this should be done" } } }
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
      app_id: 'organism-workspace',
    }),
    timeoutMs: 600_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp?.error?.message || 'AI call failed'); e.code = resp?.error?.code; throw e; }
  return String(resp?.data?.content || '');
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
  // 'storage'/'knowledge' are NOT valid backings: files and knowledge packages attach via workspace
  // Sources or document images, never as a backed space (the server gate rejects them too).
  const backings = ['memory', 'tasks'];
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
export async function applyGeneratedWorkspace(orgId, wsId, generated, opts = {}) {
  const root = wsRoot(orgId, wsId);
  for (const [namespace, schema] of Object.entries(generated.schemas || {})) {
    // 'open' (not 'strict'): generated schemas enforce required fields + types but TOLERATE extra fields,
    // so later autonomous/agent writes aren't silently rejected over a stray property. The generator
    // pre-locks structure before any real content exists; strict betoni fights every later write.
    await apiPut(`/v1/memory/${encodeURIComponent(`${root}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'open' });
  }
  const manifest = { ...generated.manifest, id: orgId, status: generated.manifest.status || 'active' };
  await apiPost('/v1/memory', { key: `${root}.meta.manifest`, value: manifest, visibility: 'private' });
  await apiPost('/v1/memory', { key: `${root}.meta.readme`, value: `# ${manifest.name || 'Workspace'}\n\n${manifest.summary || ''}`, visibility: 'private' });
  // Write any example instances as DRAFTS (clearly not-yet-published samples). Best-effort: a
  // sample that doesn't validate is skipped, not fatal. `skipExamples` suppresses these entirely —
  // the Secretary setup path fills workspaces with REAL content instead (fake "example-N" records read
  // as disinformation, not examples), so it never wants placeholders.
  if (!opts.skipExamples) {
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
}

/** Apply the project template to a workspace (register schemas + write the manifest + readme). */
export async function applyProjectTemplate(orgId, wsId, name, summary) {
  const root = wsRoot(orgId, wsId);
  for (const [namespace, schema] of Object.entries(PROJECT_SCHEMAS)) {
    // 'open' (not 'strict'): generated schemas enforce required fields + types but TOLERATE extra fields,
    // so later autonomous/agent writes aren't silently rejected over a stray property. The generator
    // pre-locks structure before any real content exists; strict betoni fights every later write.
    await apiPut(`/v1/memory/${encodeURIComponent(`${root}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'open' });
  }
  await apiPost('/v1/memory', { key: `${root}.meta.manifest`, value: projectManifest(orgId, name, summary), visibility: 'private' });
  await apiPost('/v1/memory', { key: `${root}.meta.readme`, value: `# ${name}\n\n${summary || ''}`, visibility: 'private' });
}
