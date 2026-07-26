/**
 * @file public/js/services/organisms.prompts.js
 * @description Copy-paste prompts that teach an AI/agent how to use a specific organism workspace —
 *   the human/agent "access" prompt and the "contract agent" build prompt, each with this
 *   workspace's real structure and ids inlined. Extracted from organisms.js.
 * @usage import { buildAccessPrompt, buildContractAgentPrompt } from './organisms.prompts.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from organisms.js (max-file-lines)
 */
import { isMemorySpace, isDocSpace, getObjectSchema } from './organisms.shared.js';
import { swallowed } from '/js/swallowed.js';

// ── Access prompt: a copy-paste prompt teaching an AI/agent how to use THIS workspace ──
// Bridges the MCP gap (no workspace-aware tools yet) by injecting the real structure + the exact
// conventions. Two variants: 'human' (paste into a chat) and 'agent' (imperative, assumes tools).

/** Format one objectType's full schema for the prompt's STRUCTURE block. */
function describeType(ot, schema) {
  if (isDocSpace(ot)) {
    return `• ${ot.name} (document) — namespace "${ot.namespace}". Free-form markdown pages { id, title, markdown }, organised into sections (read organism.{id}.w.{ws}.meta.sections.${ot.name}).`;
  }
  const props = (schema && schema.properties) || {};
  const req = new Set((schema && schema.required) || []);
  const fields = Object.entries(props).map(([k, d]) => {
    const bits = [d.type || 'string'];
    if (req.has(k)) bits.push('required');
    if (Array.isArray(d.enum)) bits.push('enum: ' + d.enum.join(' | '));
    if (d.type === 'array' && d.items?.type) bits.push('of ' + d.items.type);
    return `    - ${k} (${bits.join(', ')})`;
  });
  return `• ${ot.name} (records) — namespace "${ot.namespace}", writeRole ${ot.writeRole || 'member'}. Fields:\n${fields.join('\n') || '    (no schema)'}`;
}

/** Build the workspace-access prompt for an AI/agent. variant: 'human' | 'agent'. Async — fetches
 *  each records-type's schema so the FULL field list is inlined. */
export async function buildAccessPrompt(orgId, orgName, wsId, ws, variant = 'human') {
  const nodeUrl = window.location.origin;
  const m = ws?.manifest || {};
  const wsName = m.name || wsId;
  const types = (m.objectTypes || []).filter(isMemorySpace);
  const described = [];
  for (const ot of types) {
    // records is the default mode (mode may be undefined) — fetch the schema unless it's a document.
    const schema = !isDocSpace(ot) ? await getObjectSchema(orgId, wsId, ot.namespace).catch(err => { swallowed('organisms.prompts: types', err); return null; }) : null;
    described.push(describeType(ot, schema));
  }
  const structure = described.join('\n') || '(no spaces declared yet)';

  const access = [
    `- Read the manifest:   aimeat_memory_read key="organism.${orgId}.w.${wsId}.meta.manifest"`,
    `- List everything:     aimeat_memory_list prefix="organism.${orgId}.w.${wsId}." limit=500`,
    `    (keys end in .draft = working copy, .latest = published, .version.N = history)`,
    `- Document sections:   aimeat_memory_read key="organism.${orgId}.w.${wsId}.meta.sections.{type}"`,
    `- Write/refresh a draft: aimeat_memory_write key="organism.${orgId}.w.${wsId}.{namespace}.{id}.draft" value={...}`,
    `- Attach a file/screenshot: aimeat_storage_upload key="organism.${orgId}.w.${wsId}.img.{name}"`,
    `    then embed it in a document's markdown as  ![alt](/v1/storage/<returned key>)`,
    `- Live data in documents: a \`\`\`aimeat-memory fenced block (body: key: <memory key>, optional view: table|props|list,`,
    `    fields: a,b and title: ...) renders that key's CURRENT value on every open — write changing data with`,
    `    aimeat_memory_write as an array of objects (consistent field names) and embed the key instead of a static table;`,
    `    re-writing the SAME key updates every document that embeds it. \`\`\`mermaid blocks render as diagrams.`,
    `- Publish a draft:     POST ${nodeUrl}/v1/organisms/${orgId}/publish   body { "ws":"${wsId}", "namespace":"...", "id":"..." }`,
    `    (snapshots .version.N + .latest, consumes the draft; may require operator approval if the publish gate is on)`,
  ].join('\n');

  const intents = [
    `  (a) Status update — read .latest, refresh a status document, publish it.`,
    `  (b) Manage tasks / deliverables — add or edit drafts in a records space, publish when ready.`,
    `  (c) Be a coding agent — pull specs + tasks from here, implement them, then update the task`,
    `      records' status + the related documents + the status page as you go.`,
  ].join('\n');

  if (variant === 'agent') {
    return [
      `TASK: operate an AIMEAT organism workspace. Connect, learn it, interview the operator, then act.`,
      ``,
      `CONNECTION`,
      `- Node: ${nodeUrl}`,
      `- Organism: "${orgName || orgId}"  id: ${orgId}`,
      `- Workspace: "${wsName}"  ws: ${wsId}`,
      `- Use the AIMEAT MCP tools (aimeat_memory_*, aimeat_storage_*) + the REST publish endpoint below.`,
      `  If AIMEAT tools are unavailable, STOP and report — do not invent data.`,
      ``,
      `STEP 1 — LEARN (do before acting; then summarise the structure back):`,
      access,
      ``,
      `STRUCTURE (objectTypes — full schema):`,
      structure,
      ``,
      `STEP 2 — INTERVIEW the operator (ask, don't assume) which of:`,
      intents,
      `  Get specifics: which space, what to change, definition of done.`,
      ``,
      `STEP 3 — ACT (only after the operator confirms). Records: validate against the schema above`,
      `before writing. Keep edits as DRAFTS unless told to publish. The status page is just a document —`,
      `rewrite its markdown and publish.`,
      ``,
      `RULES: never publish without the operator's OK unless told to run autonomously; re-read .latest`,
      `before overwriting (avoid clobbering a newer update); report which keys you wrote and what changed.`,
    ].join('\n');
  }

  return [
    `I'm using an AIMEAT organism workspace and I'd like your help with it. First LEARN its structure,`,
    `then ASK me what I want to do, then help me do it.`,
    ``,
    `CONNECTION`,
    `- Node: ${nodeUrl}`,
    `- Organism: "${orgName || orgId}"  (id: ${orgId})`,
    `- Workspace: "${wsName}"  (ws: ${wsId})`,
    `If you're connected to AIMEAT (its MCP tools), you can read and write this workspace directly.`,
    `If you're not connected, tell me and I'll paste content back and forth manually.`,
    ``,
    `WHAT THIS IS`,
    `A workspace is a set of "spaces". Each space is either a DOCUMENT space (a free-form wiki: markdown`,
    `pages in sections) or a RECORDS space (a schema-locked list, like a form). Items have a working`,
    `DRAFT and, once published, a LATEST version (with history).`,
    ``,
    `STRUCTURE (read this back to me so I know you understand it):`,
    structure,
    ``,
    `HOW TO ACCESS IT (AIMEAT MCP + REST):`,
    access,
    ``,
    `WHAT I MIGHT WANT (ask me which):`,
    intents,
    ``,
    `RULES: keep changes as drafts so I can review; don't publish without my OK; re-read .latest before`,
    `overwriting so you don't clobber a newer update; tell me which keys you wrote and what changed.`,
    ``,
    `Start by reading the manifest + structure, then ask me which of (a)/(b)/(c) and the specifics.`,
  ].join('\n');
}

/** Build a prompt to paste into an AI / coding agent: how to build a CONTRACT AGENT that processes THIS
 *  workspace. The agent owns a contract (inputs/outputs/lifecycle), provisions its spaces, and runs the
 *  request→result loop. Mirrors docs/agent-workspace-contracts.md with this workspace's concrete ids. */
export async function buildContractAgentPrompt(orgId, orgName, wsId, ws) {
  const nodeUrl = window.location.origin;
  const m = ws?.manifest || {};
  const wsName = m.name || wsId;
  const types = (m.objectTypes || []).filter(isMemorySpace);
  const described = [];
  for (const ot of types) {
    const schema = !isDocSpace(ot) ? await getObjectSchema(orgId, wsId, ot.namespace).catch(err => { swallowed('organisms.prompts: types', err); return null; }) : null;
    described.push(describeType(ot, schema));
  }
  const structure = described.join('\n') || '(no spaces declared yet)';
  return [
    `TASK: build an AIMEAT "contract agent" that PROCESSES this workspace — it reads requests, does the`,
    `work, and writes results back. The agent OWNS a contract: the spaces it READS (inputs), the spaces`,
    `it WRITES (outputs), and the status lifecycle. Follow the convention exactly so it appears and works`,
    `smoothly. Full reference: ${nodeUrl}/v1/agents/me/handbook/appdev (the "Workspace contracts" section)`,
    `and docs/agent-workspace-contracts.md.`,
    ``,
    `CONNECTION`,
    `- Node: ${nodeUrl}`,
    `- Organism: "${orgName || orgId}"  id: ${orgId}`,
    `- Workspace: "${wsName}"  ws: ${wsId}`,
    `- Use the AIMEAT MCP tools (aimeat_workspace_*, aimeat_organism_*) or the shell-callable connector`,
    `  (aimeat connect call ...) — no LLM is needed in the I/O path. If AIMEAT tools are unavailable, STOP.`,
    ``,
    `EXISTING SPACES (don't drop or rename these — UNION them with your contract's spaces):`,
    structure,
    ``,
    `1) DEFINE THE CONTRACT (embed it in the agent):`,
    `   contract:`,
    `     id: <capability>                 # e.g. research`,
    `     inputs:                          # what the agent reads + reacts to`,
    `       - space: <name>                # objectType NAME, e.g. research-request`,
    `         mode: records                # records (schema-locked) | document`,
    `         schema: { id, ..., status: requested|in-progress|done|failed, requested_by, result_ref? }`,
    `         trigger: status == 'requested'`,
    `     outputs:                         # what the agent writes`,
    `       - space: <name>                # e.g. research-result`,
    `         mode: records`,
    `         schema: { id, request_ref, ... }`,
    `     lifecycle: requested → in-progress → done (+ result_ref) | failed`,
    ``,
    `2) PROVISION the contract's spaces with add_spaces — the server UNIONS them into the manifest, skips`,
    `   any that already exist, and fills objectType defaults, so you never resend the whole manifest`,
    `   (safe + idempotent). Manifest edits are CREATOR-ONLY: a same-owner agent does this itself; for a`,
    `   cross-owner agent the creator does it.`,
    `       aimeat_workspace_update { organism_id:"${orgId}", ws:"${wsId}",`,
    `         add_spaces: [ { name:"<input-space>",  namespace:"shared.<inputs>",  mode:"records" },`,
    `                       { name:"<output-space>", namespace:"shared.<outputs>", mode:"records" } ],`,
    `         schemas: { "shared.<inputs>": <jsonSchema>, "shared.<outputs>": <jsonSchema> } }`,
    `     → returns { added, skipped }. Pass just { name, namespace, mode } per space; defaults are filled.`,
    ``,
    `3) AUTHORIZE the agent to write (skip for a same-owner agent — it already can):`,
    `   POST ${nodeUrl}/v1/organisms/${orgId}/workspace-access/grant`,
    `     body { "ws":"${wsId}", "grantee":"<agent-owner | agent#owner@node>", "role":"contributor" }`,
    `   (viewer = read only; contributor = read + write. The creator manages this in "Who works here".)`,
    ``,
    `4) RUN THE PROCESSING LOOP (deterministic, repeatable):`,
    `   discover member workspaces (aimeat_organism_list → aimeat_workspace_list) → for each that has your`,
    `   input space: aimeat_workspace_read → find inputs where the trigger holds → CLAIM it`,
    `   (aimeat_workspace_write status:"in-progress" + publish) → do the work → WRITE the output space`,
    `   (aimeat_workspace_write + publish) → ADVANCE the input (status:"done", result_ref:<outId> + publish).`,
    `   On error: set the input status:"failed" with an error field.`,
    ``,
    `5) PROCESS RELIABLY (keep this recurring / idle-hook loop idempotent + bounded — this is what keeps it safe):`,
    `   - Dedup on the OUTPUT first — this is your PRIMARY, durable guard (it survives restarts): create a`,
    `     result for an input only while that input's output is still ABSENT, so an already-fulfilled input`,
    `     is naturally skipped even after a crash/redeploy.`,
    `   - Also keep an in-memory PROCESSED set of the ids you handled THIS run and skip them — but it only`,
    `     lives for the run, so treat it as a backstop to the output-dedup, not a replacement.`,
    `   - Don't trust a status you JUST wrote when you read it back immediately: read-after-write can briefly`,
    `     still show 'requested'. Let your own in-run record decide what's handled, not an instant re-read.`,
    `   - Work a bounded batch each pass (e.g. up to ~5 inputs) and leave the rest for the next cycle —`,
    `     steady, predictable forward progress; one bad state then can't loop unbounded.`,
    `   - Advance each item at one calm cadence: one claim, one result, one status advance per item. NEVER`,
    `     hammer a single record with rapid re-publishes — a burst of writes to one id can briefly stale that`,
    `     namespace's read and feed the exact loop you're avoiding.`,
    `   - For "what changed since X" coordination, prefer the activity-delta primitive`,
    `     (GET ${nodeUrl}/v1/organisms/${orgId}/activity?since=) once it is available, over re-scanning the`,
    `     whole namespace each pass — same picture in one cheap call, so the agent stays light.`,
    ``,
    `RULES: validate every RECORDS write against its schema (a bad write is rejected). NEVER drop/rename an`,
    `existing space. Only the creator/same-owner edits the manifest; a contributor writes records only.`,
    `Writes are attributed to the agent automatically — it appears in "Who works here" + the activity`,
    `heatmap, and its results are visible to everyone who can read the workspace.`,
    ``,
    `Start: read the workspace, decide your input/output spaces, provision them, grant access, run the loop.`,
  ].join('\n');
}
