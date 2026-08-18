/**
 * @file tracked-classify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Tracked Response triage — the records-oriented analog of the notebook document
 *   classifier. Given an inbox message and the caller's organisms → workspaces → RECORD types, asks the
 *   caller's own model to choose the single best place for the message AS AN ACTIONABLE RECORD: which
 *   organism, which workspace, which RECORD TYPE (bug / feature / task / decision / … — chosen
 *   generically from what the workspace actually offers, not hard-coded), a drafted title + content,
 *   and the completion condition (which field reaching which value means "done") + the field whose
 *   value carries the result back in the reply. Server-side because the caller's own key and budget
 *   are server-side; the model only ever picks ids/namespaces present in the context we build. No AI
 *   key → NotebookAiError (the feature is gated on AI, never a static guess).
 * @structure buildRecordContext() · triageMessage()
 * @usage const r = await triageMessage(storage, config, { gaii, ownerName, viewerGaii, text });
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial: AI record-type triage for Tracked Responses.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 8b: the two completions here run through the chokepoint
 *     (via notebook-ai.ts) and are attributed as `tracked:triage` / `tracked:fill`, so the owner can
 *     see what this feature spends. Nothing here decrypts a key any more.
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { stripCodeblock } from './llm-strip.js';
import { collectWorkspaceSummary } from './structure-overview.js';
import { validateMemoryWrite } from './schema-validator.js';
import { NotebookAiError, resolveOwnerModel, completeOwner } from './notebook-ai.js';

export interface TriageRecordType { namespace: string; name: string }
export interface TriageWorkspace { id: string; name: string; recordTypes: TriageRecordType[] }
export interface TriageOrganism { id: string; name: string; description: string; workspaces: TriageWorkspace[] }

export interface TriageSuggestion {
  organismId: string | null; organismName?: string;
  workspaceId: string | null; workspaceName?: string;
  namespace: string | null; recordTypeName?: string;
  title: string; markdown: string;
  condition: { field: string; equals: string };
  inject: { field: string } | null;
  confidence: number; reason?: string;
}
export interface TriageResult {
  suggestion: TriageSuggestion | null;
  context: { organisms: TriageOrganism[] };
  model: string;
}

const MAX_ORGS = 30;
const MAX_WS_PER_ORG = 25;

const TRIAGE_SYSTEM =
  'You triage ONE incoming message into a single actionable workspace RECORD. Output STRICT JSON only — no prose, no code fences.';

const TRIAGE_TEMPLATE = `Available places (organisms → workspaces → record types) you may choose from:
{{structure}}

Incoming message:
"""
{{message}}
"""

Decide the single best place for this message as an actionable record, and draft it. Return EXACTLY this JSON shape:
{
  "suggestion": {
    "organismId": "<an id from the structure, or null>",
    "workspaceId": "<a workspace id within that organism, or null>",
    "namespace": "<a record-type namespace within that workspace, or null>",
    "title": "<short, specific title>",
    "markdown": "<clean markdown describing the actionable item>",
    "condition": { "field": "status", "equals": "done" },
    "inject": { "field": "resolution" },
    "confidence": 0.0,
    "reason": "<one short line>"
  }
}

Rules:
- Choose the record TYPE that best matches the message's nature — a bug report → a bug-like type, a feature idea → a feature-like type, a task → a task type, a decision/question → the closest type. Do NOT default to "bug" unless the message is actually a defect.
- "namespace" MUST be one of the chosen workspace's record types. If no place fits, set organismId, workspaceId and namespace to null.
- "condition" = the field and value on that record meaning the work is finished (usually status = done; pick what fits the type).
- "inject.field" = the record field whose value should be quoted back in the reply when done (e.g. resolution / outcome / answer), or null if none fits.`;

/** Build the compact organism → workspace → RECORD-type map the model triages against. Only the
 *  caller's readable workspaces and their RECORD spaces (mode:'records') are included. */
export async function buildRecordContext(
  storage: Storage, config: AimeatConfig, opts: { ownerName: string; viewerGaii: string },
): Promise<TriageOrganism[]> {
  const orgItems = await storage.listOrganisms({ member: opts.ownerName, page: 1, perPage: MAX_ORGS });
  const organisms: TriageOrganism[] = [];
  for (const org of orgItems) {
    const regKey = `organism.${org.id}.meta.workspaces`;
    const { items: regItems } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
    const wsSeen = new Map<string, { id: string; name?: string }>();
    for (const rec of regItems) {
      if (rec.key !== regKey) continue;
      const list = (rec.value as { workspaces?: Array<{ id?: string; name?: string }> } | null)?.workspaces ?? [];
      for (const w of list) if (typeof w?.id === 'string' && !wsSeen.has(w.id)) wsSeen.set(w.id, { id: w.id, name: w.name });
    }
    const workspaces: TriageWorkspace[] = [];
    for (const w of [...wsSeen.values()].slice(0, MAX_WS_PER_ORG)) {
      const summary = await collectWorkspaceSummary(storage, config, { orgId: org.id, ws: w.id, name: w.name, viewerGaii: opts.viewerGaii });
      if (!summary.readable) continue;
      const recordTypes = summary.spaces.filter(s => s.mode === 'records').map(s => ({ namespace: s.namespace, name: s.name }));
      if (recordTypes.length) workspaces.push({ id: w.id, name: summary.name, recordTypes });
    }
    if (workspaces.length) organisms.push({ id: org.id, name: org.name, description: org.description || '', workspaces });
  }
  return organisms;
}

interface RawTriage {
  organismId?: unknown; workspaceId?: unknown; namespace?: unknown; title?: unknown; markdown?: unknown;
  condition?: { field?: unknown; equals?: unknown }; inject?: { field?: unknown } | null;
  confidence?: unknown; reason?: unknown;
}

/** Resolve the model's choice against the real context: drop ids/namespaces that don't exist. */
function resolveTriage(context: TriageOrganism[], raw: RawTriage, fallbackText: string): TriageSuggestion {
  const org = typeof raw.organismId === 'string' ? context.find(o => o.id === raw.organismId) : undefined;
  const ws = org && typeof raw.workspaceId === 'string' ? org.workspaces.find(w => w.id === raw.workspaceId) : undefined;
  const rt = ws && typeof raw.namespace === 'string' ? ws.recordTypes.find(r => r.namespace === raw.namespace) : undefined;
  const field = typeof raw.condition?.field === 'string' && raw.condition.field.trim() ? raw.condition.field.trim() : 'status';
  const equals = typeof raw.condition?.equals === 'string' && raw.condition.equals.trim() ? raw.condition.equals.trim() : 'done';
  const injectField = typeof raw.inject?.field === 'string' && raw.inject.field.trim() ? raw.inject.field.trim() : null;
  return {
    organismId: org ? org.id : null, organismName: org?.name,
    workspaceId: ws ? ws.id : null, workspaceName: ws?.name,
    namespace: rt ? rt.namespace : null, recordTypeName: rt?.name,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Untitled',
    markdown: typeof raw.markdown === 'string' && raw.markdown.trim() ? raw.markdown : fallbackText,
    condition: { field, equals },
    inject: injectField ? { field: injectField } : null,
    confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
  };
}

export async function triageMessage(
  storage: Storage, config: AimeatConfig, opts: { gaii: string; ownerName: string; viewerGaii: string; text: string },
): Promise<TriageResult> {
  const text = opts.text.trim();
  if (!text) throw new NotebookAiError('INVALID_INPUT', 'text is required');

  const owner = await resolveOwnerModel(storage, config, opts.gaii, 'tracked:triage');   // throws NO_OPENROUTER_KEY when missing
  const context = await buildRecordContext(storage, config, { ownerName: opts.ownerName, viewerGaii: opts.viewerGaii });
  const prompt = TRIAGE_TEMPLATE
    .split('{{structure}}').join(JSON.stringify({ organisms: context }, null, 2))
    .split('{{message}}').join(text);

  const result = await completeOwner(owner, prompt, TRIAGE_SYSTEM, { temperature: 0.2 });
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(stripCodeblock(result.content).trim()); }
  catch { throw new NotebookAiError('PARSE_ERROR', 'The model did not return valid JSON. Try again.', 502); }

  const suggestion = resolveTriage(context, (parsed.suggestion as RawTriage) ?? {}, text);
  return { suggestion, context: { organisms: context }, model: result.model };
}

// ── Fill: produce a record value conforming to the chosen type's ACTUAL schema ──
// Record schemas are AI-authored per organism/workspace — they can be ANY shape, not a fixed
// {id,title,status,description}. So at integration time the model must produce a value that conforms
// to that exact schema (real field names + enums), and derive the completion condition + the field to
// quote back FROM that schema. We then validate before writing — never a heuristic field-name guess.

export interface FillResult {
  value: Record<string, unknown>;
  condition: { field: string; equals: unknown };
  inject: { field: string } | null;
  model: string;
}

const FILL_SYSTEM =
  'You produce ONE workspace record that conforms EXACTLY to a given JSON Schema. Output STRICT JSON only — no prose, no code fences.';

const FILL_TEMPLATE = `The record type's JSON Schema — the record you create MUST conform to it (use its real field names, honour required fields and enum values; in strict mode do NOT add fields the schema does not declare):
{{schema}}

Source message:
"""
{{message}}
"""

Draft title: {{title}}
Draft content:
{{content}}

Return EXACTLY this JSON:
{
  "value": { /* a record object that VALIDATES against the schema above; put the message's substance into the appropriate fields; set any status/state-like field to its initial ("open"/"todo"-like) value */ },
  "condition": { "field": "<the schema field whose value signals the work is DONE>", "equals": <the value that field holds when done — from its enum if it has one, e.g. "done" / "shipped" / true> },
  "inject": { "field": "<an existing schema field whose value should be quoted back to the sender when done, e.g. resolution / outcome / answer> " }
}
Rules:
- "value" MUST validate against the schema (correct field names, required fields, allowed enum values).
- "condition.equals" MUST be a value the chosen status/state field can actually take (use the enum). If there is no status-like field, pick the most sensible completion signal that exists in the schema.
- "inject.field" MUST name a field that exists in the schema, or be null if none fits.
- Do not invent fields the schema forbids.`;

function parseFill(content: string): { value: Record<string, unknown>; condition: { field: string; equals: unknown }; inject: { field: string } | null } {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(stripCodeblock(content).trim()); }
  catch { throw new NotebookAiError('PARSE_ERROR', 'The model did not return valid JSON. Try again.', 502); }
  const value = (parsed.value && typeof parsed.value === 'object') ? parsed.value as Record<string, unknown> : {};
  const c = (parsed.condition as { field?: unknown; equals?: unknown }) || {};
  const field = typeof c.field === 'string' && c.field.trim() ? c.field.trim() : 'status';
  const equals = c.equals !== undefined ? c.equals : 'done';
  const inj = parsed.inject as { field?: unknown } | null;
  const inject = inj && typeof inj.field === 'string' && inj.field.trim() ? { field: inj.field.trim() } : null;
  return { value, condition: { field, equals }, inject };
}

/**
 * Ask the model to produce a record value that conforms to the chosen record type's real schema, plus
 * the schema-correct completion condition + inject field. Validates against the schema (one repair
 * retry on failure). `recordId` is forced onto the value so it matches the memory key.
 */
export async function fillRecord(
  storage: Storage, config: AimeatConfig,
  opts: { gaii: string; organismId: string; wsId: string; namespace: string; recordId: string; message: string; title: string; content: string },
): Promise<FillResult> {
  const owner = await resolveOwnerModel(storage, config, opts.gaii, 'tracked:fill');
  const base = `organism.${opts.organismId}.w.${opts.wsId}.${opts.namespace}`;
  const probeKey = `${base}.${opts.recordId}.draft`;
  const schemaRec = await storage.findApplicableSchema(probeKey);
  const schemaJson = schemaRec?.schemaJson ?? { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } };

  const fillPrompt = (extraNote = '') => FILL_TEMPLATE
    .split('{{schema}}').join(JSON.stringify(schemaJson, null, 2))
    .split('{{message}}').join(opts.message)
    .split('{{title}}').join(opts.title || '')
    .split('{{content}}').join(opts.content || '') + extraNote;

  let lastErrors = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const note = attempt === 0 ? '' : `\n\nYour previous value FAILED validation:\n${lastErrors}\nReturn a corrected value that conforms.`;
    const r = await completeOwner(owner, fillPrompt(note), FILL_SYSTEM, { temperature: 0.1 });
    const filled = parseFill(r.content);
    // Force id to match the memory key (records are addressed by id). Never inject a `title` the schema
    // doesn't declare — schemas are AI-authored and may use any field names (headline, summary, …); the
    // model fills the real fields, we only pin the id.
    const props = (schemaJson.properties && typeof schemaJson.properties === 'object') ? schemaJson.properties as Record<string, unknown> : null;
    if (!props || props.id) filled.value.id = opts.recordId;
    const check = await validateMemoryWrite(probeKey, filled.value, storage);
    if (check.valid) return { ...filled, model: r.model };
    lastErrors = (check.errors ?? []).map(e => `${e.path} ${e.message}`).join('; ');
  }
  // Validation still failing after a repair attempt — surface it rather than write a malformed record.
  throw new NotebookAiError('FILL_INVALID', `Could not build a record matching the type's schema: ${lastErrors}`, 422);
}
