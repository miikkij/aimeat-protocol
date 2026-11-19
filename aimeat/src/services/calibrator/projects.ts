/**
 * @file src/services/calibrator/projects.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Prompt Calibrator's projects, prompt versions and test batches: the work the
 *   fifteen /v1/calibrator routes (routes/calibrator.ts) and the MCP tool aimeat_calibrator
 *   (mcp/calibrator.ts) both run. Every record is a private memory record of the OWNER
 *   (`calibrator.<projectId>.project|dimensions|version.<n>|batch.<batchId>`), so the page and the
 *   owner's agent read and change the same projects. Who may call is decided before these run: the
 *   owner in person, or the owner's agent holding memory:read-as-owner (and memory:write-as-owner
 *   for a change). Each read passes what it returns through the caller's ContentReader, and a record
 *   the reader may not see answers NOT_FOUND like an absent one. Moved out of the route unchanged.
 * @structure CalibratorDeps · CalResult · calibratorTemplates · listProjects · createProject ·
 *   getProject · projectDetail · updateProject · deleteProject · createVersion · listVersions ·
 *   getVersion · createBatch · listBatches · getBatch · updateBatch · deleteBatch
 * @usage const out = await createProject(deps, ownerGhii, { name }); if (!out.ok) …
 * @version-history
 *   v1.0.0 — 2026-11-19 — Moved out of routes/calibrator.ts unchanged, keyed by the owner GHII the
 *     caller acts for, so an agent works on the owner's projects (feature audit 2026-11-19, 4.4 item 5).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
// The calibrator writes its records as private over whatever the key held, so it does not know the
// earlier visibility (services/event-bus.ts emitRecordChangePriorUnknown).
import { emitRecordChangePriorUnknown } from '../event-bus.js';
import { createCalibratorDetailService, type CalibratorDetail } from '../db/calibrator-detail-db-service.js';
import type { ContentReader } from '../classification/reader.js';
import { presentMemories, presentMemory } from '../classification/present-memory.js';
import { updateMemoryRecord, UNCHANGED } from '../record-cas.js';
import {
  DEFAULT_ANALYSIS_TEMPLATE, DEFAULT_REFLECTION_TEMPLATE, DEFAULT_SELF_REFLECTION_TEMPLATE, DEFAULT_SYNTHESIS_TEMPLATE,
  PROJECT_TAGS, fillTemplates,
  type CalibratorDimension, type CalibratorBatchModel, type CalibratorCandidateModel,
} from './templates.js';

export interface CalibratorDeps { storage: Storage; config: AimeatConfig }
/** An answer in the route's terms: the data (201 for a create), or the status, code and sentence of a refusal. */
export type CalResult<T> = { ok: true; status?: 201; data: T } | { ok: false; status: number; code: string; message: string };

const notFound = (message: string) => ({ ok: false as const, status: 404, code: 'NOT_FOUND', message });
const invalid = (message: string) => ({ ok: false as const, status: 400, code: 'INVALID_BODY', message });
type Body = Record<string, unknown>;

/** Write a calibrator memory key with the required MemoryRecord fields. */
async function setCalMemory(storage: Storage, gaii: string, key: string, value: unknown, tags: string[]): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key,
    ownerGaii: gaii,
    value,
    visibility: 'private',
    tags,
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Change a stored calibrator record on the version that was read (record-cas.ts), and again on a
 * fresh read when another request wrote it meanwhile. `mutate` gets its own copy (null when the
 * record is absent) and answers UNCHANGED to write nothing. Answers the value as written, or null.
 */
async function changeCalMemory<T>(storage: Storage, gaii: string, key: string, tags: string[], mutate: (cur: T | null) => T | typeof UNCHANGED): Promise<T | null> {
  const written = await updateMemoryRecord(storage, gaii, key, (rec) => {
    const next = mutate(rec ? structuredClone(rec.value) as T : null);
    return next === UNCHANGED ? UNCHANGED : { value: next, visibility: 'private', tags };
  });
  return written ? written.value as T : null;
}

/** The lazy template backfill of a project read, written onto the stored project, not the copy read. */
async function saveFilledTemplates(storage: Storage, gaii: string, id: string): Promise<void> {
  await changeCalMemory<Record<string, unknown>>(storage, gaii, `calibrator.${id}.project`, PROJECT_TAGS,
    cur => (cur && fillTemplates(cur) ? cur : UNCHANGED));
}

/** GET /v1/calibrator/templates — the four default prompt templates. */
export function calibratorTemplates(): Record<string, string> {
  return {
    analysisPromptTemplate: DEFAULT_ANALYSIS_TEMPLATE,
    reflectionPromptTemplate: DEFAULT_REFLECTION_TEMPLATE,
    selfReflectionPromptTemplate: DEFAULT_SELF_REFLECTION_TEMPLATE,
    synthesisPromptTemplate: DEFAULT_SYNTHESIS_TEMPLATE,
  };
}

/** GET /v1/calibrator — the projects, newest first, each with batchCount, latestAvgScore and modelCount. */
export async function listProjects(deps: CalibratorDeps, gaii: string, reader: ContentReader): Promise<CalResult<{ projects: Body[] }>> {
  const { storage } = deps;
  const allMemory = await presentMemories(reader, await storage.listMemory(gaii, { prefix: 'calibrator.', tags: ['project'] }));
  const projectRecords = allMemory
    .filter(m => m.key.endsWith('.project'))
    .sort((a, b) => new Date((b.value as Body).createdAt as string).getTime() - new Date((a.value as Body).createdAt as string).getTime());

  const projects = [];
  for (const m of projectRecords) {
    const project = m.value as Body;
    const projectId = project.projectId as string;

    // Count batches and compute latestAvgScore
    const batchMemory = await presentMemories(reader, await storage.listMemory(gaii, { prefix: `calibrator.${projectId}.batch.` }));
    const batchCount = batchMemory.length;
    let latestAvgScore: number | null = null;

    if (batchCount > 0) {
      // The latest batch THAT HAS A SCORE, newest first: a batch created and never started
      // carries no score and must not hide the last real result behind a null.
      const batches = batchMemory
        .map(bm => bm.value as Body)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
      for (const batch of batches) {
        const models = (batch.models as CalibratorBatchModel[]) || [];
        const scores = models
          .map(model => model.step2_analysis?.overallScore)
          .filter((s): s is number => s != null);
        if (scores.length > 0) {
          latestAvgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
          break;
        }
      }
    }

    // How many models are under test, so the list can say it without opening the project.
    const modelCount = ((project.candidateModels as CalibratorCandidateModel[]) || []).filter(cm => cm && (cm as { modelId?: string }).modelId).length;
    projects.push({ ...project, batchCount, latestAvgScore, modelCount });
  }
  return { ok: true, data: { projects } };
}

/** POST /v1/calibrator — a new project with the default templates. */
export async function createProject(deps: CalibratorDeps, gaii: string, body: Body): Promise<CalResult<{ project: Body }>> {
  const { name } = body;
  if (!name || typeof name !== 'string') return invalid('name is required.');
  const projectId = `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const project = {
    projectId,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    status: 'active',
    reasoningLlm: null,
    analysisPromptTemplate: DEFAULT_ANALYSIS_TEMPLATE,
    reflectionPromptTemplate: DEFAULT_REFLECTION_TEMPLATE,
    selfReflectionPromptTemplate: DEFAULT_SELF_REFLECTION_TEMPLATE,
    synthesisPromptTemplate: DEFAULT_SYNTHESIS_TEMPLATE,
    candidateModels: [],
    currentVersion: 0,
  };
  await setCalMemory(deps.storage, gaii, `calibrator.${projectId}.project`, project, ['calibrator', 'project']);
  emitRecordChangePriorUnknown('memory', gaii, 'private');
  return { ok: true, status: 201, data: { project } };
}

/** GET /v1/calibrator/:id — the project (its missing templates filled) and its dimensions. */
export async function getProject(deps: CalibratorDeps, gaii: string, reader: ContentReader, id: string): Promise<CalResult<{ project: Body; dimensions: unknown }>> {
  const { storage } = deps;
  const stored = await storage.getMemory(gaii, `calibrator.${id}.project`);
  const record = stored ? await presentMemory(reader, stored) : null;
  if (!record) return notFound('Calibration project not found.');
  // Backfill missing or outdated template fields
  const project = record.value as Body;
  if (fillTemplates(project)) await saveFilledTemplates(storage, gaii, id);
  const dimStored = await storage.getMemory(gaii, `calibrator.${id}.dimensions`);
  const dimRecord = dimStored ? await presentMemory(reader, dimStored) : null;
  return { ok: true, data: { project, dimensions: dimRecord?.value ?? [] } };
}

/**
 * GET /v1/calibrator/:id/detail — the project, its dimensions, version summaries, the current version
 * and batch summaries from one prefix scan. The lazy template backfill of getProject applies here too.
 */
export async function projectDetail(deps: CalibratorDeps, gaii: string, reader: ContentReader, id: string): Promise<CalResult<CalibratorDetail>> {
  const data = await createCalibratorDetailService(deps.storage).overview(reader, id, gaii);
  if (!data) return notFound('Calibration project not found.');
  // Lazy template backfill — identical to GET /v1/calibrator/:id, kept behavior-compatible.
  if (fillTemplates(data.project)) await saveFilledTemplates(deps.storage, gaii, id);
  return { ok: true, data };
}

/** PUT /v1/calibrator/:id — set the fields the body names on the stored project. */
export async function updateProject(deps: CalibratorDeps, gaii: string, id: string, body: Body): Promise<CalResult<{ project: Body }>> {
  const {
    name, reasoningLlm, analysisPromptTemplate, reflectionPromptTemplate,
    selfReflectionPromptTemplate, synthesisPromptTemplate, candidateModels, status,
  } = body;
  // The fields this request names are set on the stored project, so another request's change
  // to the others stays.
  const project = await changeCalMemory<Body>(deps.storage, gaii, `calibrator.${id}.project`, PROJECT_TAGS, (cur) => {
    if (!cur) return UNCHANGED;
    if (name !== undefined) cur.name = name;
    if (reasoningLlm !== undefined) cur.reasoningLlm = reasoningLlm;
    if (analysisPromptTemplate !== undefined) cur.analysisPromptTemplate = analysisPromptTemplate;
    if (reflectionPromptTemplate !== undefined) cur.reflectionPromptTemplate = reflectionPromptTemplate;
    if (selfReflectionPromptTemplate !== undefined) cur.selfReflectionPromptTemplate = selfReflectionPromptTemplate;
    if (synthesisPromptTemplate !== undefined) cur.synthesisPromptTemplate = synthesisPromptTemplate;
    if (candidateModels !== undefined) cur.candidateModels = candidateModels;
    if (status !== undefined) cur.status = status;
    return cur;
  });
  if (!project) return notFound('Calibration project not found.');
  emitRecordChangePriorUnknown('memory', gaii, 'private');
  return { ok: true, data: { project } };
}

/** DELETE /v1/calibrator/:id — the project and everything under it. */
export async function deleteProject(deps: CalibratorDeps, gaii: string, id: string): Promise<CalResult<{ deleted: number }>> {
  const allKeys = await deps.storage.listMemory(gaii, { prefix: `calibrator.${id}.` });
  for (const m of allKeys) {
    await deps.storage.deleteMemory(gaii, m.key);
  }
  emitRecordChangePriorUnknown('memory', gaii, 'private');
  return { ok: true, data: { deleted: allKeys.length } };
}

/** POST /v1/calibrator/:id/versions — the next prompt version. */
export async function createVersion(deps: CalibratorDeps, gaii: string, id: string, body: Body): Promise<CalResult<{ version: Body }>> {
  const { prompt, targetOutput, changelog } = body;
  const validPrompt = !!prompt && typeof prompt === 'string';
  // The version number is taken on the project's version first, so two requests at the same
  // moment get two numbers and neither version record overwrites the other.
  let found = false;
  let newVersion = 0;
  await changeCalMemory<Body>(deps.storage, gaii, `calibrator.${id}.project`, PROJECT_TAGS, (cur) => {
    found = !!cur;
    if (!cur || !validPrompt) return UNCHANGED;
    newVersion = ((cur.currentVersion as number) || 0) + 1;
    cur.currentVersion = newVersion;
    return cur;
  });
  if (!found) return notFound('Calibration project not found.');
  if (!validPrompt) return invalid('prompt is required.');
  const version = {
    version: newVersion,
    prompt,
    targetOutput: targetOutput || '',
    changelog: changelog || (newVersion === 1 ? 'Initial version' : ''),
    createdAt: new Date().toISOString(),
  };
  await setCalMemory(deps.storage, gaii, `calibrator.${id}.version.${newVersion}`, version, ['calibrator', 'version']);
  emitRecordChangePriorUnknown('memory', gaii, 'private');
  return { ok: true, status: 201, data: { version } };
}

/** GET /v1/calibrator/:id/versions — the version summaries, oldest first. */
export async function listVersions(deps: CalibratorDeps, gaii: string, reader: ContentReader, id: string): Promise<CalResult<{ versions: Body[] }>> {
  const allMemory = await presentMemories(reader, await deps.storage.listMemory(gaii, { prefix: `calibrator.${id}.version.` }));
  const versions = allMemory
    .map(m => {
      const v = m.value as Body;
      return { version: v.version, changelog: v.changelog, createdAt: v.createdAt };
    })
    .sort((a, b) => (a.version as number) - (b.version as number));
  return { ok: true, data: { versions } };
}

/** GET /v1/calibrator/:id/versions/:v — one version whole. */
export async function getVersion(deps: CalibratorDeps, gaii: string, reader: ContentReader, id: string, v: string): Promise<CalResult<{ version: unknown }>> {
  const stored = await deps.storage.getMemory(gaii, `calibrator.${id}.version.${v}`);
  const record = stored ? await presentMemory(reader, stored) : null;
  if (!record) return notFound('Version not found.');
  return { ok: true, data: { version: record.value } };
}

/** POST /v1/calibrator/:id/batches — an empty batch of the project's candidate models for one version. */
export async function createBatch(deps: CalibratorDeps, gaii: string, id: string, body: Body): Promise<CalResult<{ batch: Body }>> {
  const { storage } = deps;
  const { promptVersion } = body;
  if (!promptVersion || typeof promptVersion !== 'number' || promptVersion < 1) {
    return invalid('promptVersion (positive integer) is required.');
  }

  // Verify version exists
  const versionRecord = await storage.getMemory(gaii, `calibrator.${id}.version.${promptVersion}`);
  if (!versionRecord) return notFound(`Version ${promptVersion} not found.`);

  // Verify project exists and get candidate models
  const projectRecord = await storage.getMemory(gaii, `calibrator.${id}.project`);
  if (!projectRecord) return notFound('Calibration project not found.');
  const project = projectRecord.value as Body;
  const candidateModels = (project.candidateModels as CalibratorCandidateModel[]) || [];

  const batchId = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const models = candidateModels.map((m) => ({
    modelId: m.id,
    modelLabel: m.label,
    step1_generation: { status: 'pending', output: null, durationMs: null, error: null, promptSent: null },
    step2_analysis: { status: 'pending', dimensions: [], overallScore: null, analysis: null, error: null, promptSent: null, rawResponse: null },
    step3_reflection: { status: 'pending', judgeProposals: null, selfProposals: null, error: null },
  }));

  const batch = {
    batchId,
    projectId: id,
    promptVersion,
    createdAt: new Date().toISOString(),
    status: 'created',
    models,
    step4_synthesis: { status: 'pending', groupedProposals: [], options: null, recommendation: null, analysis: null, error: null, promptSent: null, rawResponse: null },
  };

  await setCalMemory(storage, gaii, `calibrator.${id}.batch.${batchId}`, batch, ['calibrator', 'batch']);
  emitRecordChangePriorUnknown('memory', gaii, 'private');
  return { ok: true, status: 201, data: { batch } };
}

/** GET /v1/calibrator/:id/batches — the batch summaries, newest first, optionally of one version. */
export async function listBatches(deps: CalibratorDeps, gaii: string, reader: ContentReader, id: string, versionFilter?: string): Promise<CalResult<{ batches: Body[] }>> {
  const allMemory = await presentMemories(reader, await deps.storage.listMemory(gaii, { prefix: `calibrator.${id}.batch.` }));

  let batches = allMemory
    .map(m => {
      const b = m.value as Body;
      const models = (b.models as CalibratorBatchModel[]) || [];
      const scores = models.map((model) => ({
        modelId: model.modelId,
        modelLabel: model.modelLabel,
        overallScore: model.step2_analysis?.overallScore ?? null,
      }));
      return {
        batchId: b.batchId,
        createdAt: b.createdAt,
        promptVersion: b.promptVersion,
        status: b.status,
        modelCount: models.length,
        scores,
      };
    })
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  if (versionFilter) {
    batches = batches.filter(b => String(b.promptVersion) === versionFilter);
  }
  return { ok: true, data: { batches } };
}

/** GET /v1/calibrator/:id/batches/:batchId — one batch whole. */
export async function getBatch(deps: CalibratorDeps, gaii: string, reader: ContentReader, id: string, batchId: string): Promise<CalResult<{ batch: unknown }>> {
  const stored = await deps.storage.getMemory(gaii, `calibrator.${id}.batch.${batchId}`);
  const record = stored ? await presentMemory(reader, stored) : null;
  if (!record) return notFound('Batch not found.');
  return { ok: true, data: { batch: record.value } };
}

/** PUT /v1/calibrator/:id/batches/:batchId — set models, status or step4_synthesis; the dimensions found are added to the project's. */
export async function updateBatch(deps: CalibratorDeps, gaii: string, id: string, batchId: string, body: Body): Promise<CalResult<{ batch: Body }>> {
  const { storage } = deps;
  const { models, status, step4_synthesis } = body;
  // Set on the stored batch, so a concurrent update of its other fields stays.
  const batch = await changeCalMemory<Body>(storage, gaii, `calibrator.${id}.batch.${batchId}`, ['calibrator', 'batch'], (cur) => {
    if (!cur) return UNCHANGED;
    if (models !== undefined) cur.models = models;
    if (status !== undefined) cur.status = status;
    if (step4_synthesis !== undefined) cur.step4_synthesis = step4_synthesis;
    return cur;
  });
  if (!batch) return notFound('Batch not found.');

  // Auto-discover dimensions from Step 2 results
  const batchModels = (batch.models as CalibratorBatchModel[]) || [];
  const allDimensions: CalibratorDimension[] = [];
  for (const model of batchModels) {
    const dims = model.step2_analysis?.dimensions;
    if (Array.isArray(dims)) {
      allDimensions.push(...dims);
    }
  }

  if (allDimensions.length > 0) {
    // Appended to the stored list, so the dimensions a concurrent batch update added stay.
    await changeCalMemory<CalibratorDimension[]>(storage, gaii, `calibrator.${id}.dimensions`, ['calibrator', 'dimensions'], (cur) => {
      const existingDims = cur || [];
      const existingNames = new Set(existingDims.map((d) => d.name));
      let added = false;
      for (const dim of allDimensions) {
        if (dim.name && !existingNames.has(dim.name)) {
          existingDims.push({
            name: dim.name,
            description: dim.description,
            category: dim.category,
            discoveredInBatch: batchId,
          });
          existingNames.add(dim.name);
          added = true;
        }
      }
      return added ? existingDims : UNCHANGED;
    });
  }

  emitRecordChangePriorUnknown('memory', gaii, 'private');
  return { ok: true, data: { batch } };
}

/** DELETE /v1/calibrator/:id/batches/:batchId — one batch. */
export async function deleteBatch(deps: CalibratorDeps, gaii: string, id: string, batchId: string): Promise<CalResult<{ deleted: number }>> {
  const record = await deps.storage.getMemory(gaii, `calibrator.${id}.batch.${batchId}`);
  if (!record) return notFound('Batch not found.');
  await deps.storage.deleteMemory(gaii, `calibrator.${id}.batch.${batchId}`);
  emitRecordChangePriorUnknown('memory', gaii, 'private');
  return { ok: true, data: { deleted: 1 } };
}
