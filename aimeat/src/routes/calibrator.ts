/**
 * @file calibrator.ts
 * @description Prompt Calibrator API — CRUD for calibration projects, versions, and batches.
 *   V2 uses a batch-based 4-step flow: Generate → Analyze → Reflect → Synthesize.
 * @structure
 *   - GET  /v1/calibrator/templates — default prompt templates
 *   - POST /v1/calibrator — create project
 *   - GET  /v1/calibrator — list projects (with batchCount + latestAvgScore)
 *   - GET  /v1/calibrator/:id — get project
 *   - PUT  /v1/calibrator/:id — update project
 *   - DELETE /v1/calibrator/:id — delete project + all data
 *   - POST /v1/calibrator/:id/versions — create version
 *   - GET  /v1/calibrator/:id/versions — list versions
 *   - GET  /v1/calibrator/:id/versions/:v — get version
 *   - POST /v1/calibrator/:id/batches — create empty batch
 *   - GET  /v1/calibrator/:id/batches — list batches (summary)
 *   - GET  /v1/calibrator/:id/batches/:batchId — full batch detail
 *   - PUT  /v1/calibrator/:id/batches/:batchId — update batch
 *   - DELETE /v1/calibrator/:id/batches/:batchId — delete batch
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial implementation
 *   v2.0.0 — 2026-03-29 — V2 redesign: batch-based 4-step flow
 *   v2.1.0 — 2026-07-16 — GET /:id/detail composite (project + dimensions + versions + current version +
 *     batches from one prefix scan) — folds the detail-view mount's 4-request waterfall.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { createCalibratorDetailService } from '../services/db/calibrator-detail-db-service.js';

const DEFAULT_ANALYSIS_TEMPLATE = `You are evaluating whether a candidate AI model's output is STRUCTURALLY CORRECT compared to a reference output.

CRITICAL RULES:
- Focus ONLY on structural correctness — does the output WORK, not whether it looks identical
- Ignore ALL cosmetic differences: label text, descriptions, key ordering, naming style, whitespace
- Limit to 5-8 dimensions maximum — only the ones that actually matter for correctness
- A dimension PASSES if the candidate achieves the structural goal, even if the specific implementation differs
- Be GENEROUS with passing — if the structure is functionally equivalent, it passes

REFERENCE OUTPUT (the structurally correct target):
{TARGET_OUTPUT}

CANDIDATE OUTPUT (produced by {MODEL_NAME}):
{CANDIDATE_OUTPUT}

THE PROMPT that was given (for context):
{PROMPT_USED}

Evaluate ONLY these structural aspects (skip any that don't apply):
1. TOP-LEVEL STRUCTURE: Does it have the required top-level keys/sections? (critical)
2. COMPONENT COUNT: Does it have the right number and types of major elements? (critical)
3. DATA PIPELINE: Do data flows form valid chains (producer → consumer)? (critical)
4. REQUIRED SECTIONS: Are all mandatory sections present? (major)
5. DATA MODEL: Are data structures defined with correct types? (major)
6. NO UNNECESSARY EXTRAS: Did the candidate add things that shouldn't be there? (major)
7. RELATIONSHIPS: Are cross-references and dependencies valid? (minor)
8. CONFIGURATION: Are settings, schedules, and config correct? (minor)

Output as JSON with 5-8 dimensions:
{
  "dimensions": [
    {
      "name": "short_snake_case_name",
      "description": "What this measures",
      "category": "structure|data_model|missing|extra|quality",
      "severity": "critical|major|minor",
      "expected": "brief: what reference has",
      "actual": "brief: what candidate has",
      "pass": true or false
    }
  ],
  "analysis": "2-3 paragraph analysis. What works well? What's structurally broken? What's the most impactful fix?",
  "proposals": [
    "Concrete GENERIC prompt fix — what to add/change to prevent this structural error in any similar prompt"
  ]
}`;

const DEFAULT_REFLECTION_TEMPLATE = `You are helping improve an AI prompt based on test results.

THE PROMPT being calibrated:
{PROMPT_USED}

THE DESIRED OUTPUT (reference — what a perfect response looks like):
{TARGET_OUTPUT}

WHAT THE CANDIDATE MODEL ({MODEL_NAME}) ACTUALLY PRODUCED:
{CANDIDATE_OUTPUT}

ANALYSIS OF WHAT WENT WRONG:
{ANALYSIS_TEXT}

Based on this analysis, suggest concrete improvements to the prompt that would make the candidate model produce output closer to the reference.

Rules:
- Suggest GENERIC prompt modifications — do NOT reference project-specific names, APIs, or domain concepts
- Each fix must work for ANY prompt calibration task, not just this one
- Explain WHAT to add/change and WHERE in the prompt
- Be specific — show the actual text to add or modify
- Focus on the root causes identified in the analysis, not symptoms

Output as JSON:
{
  "proposals": [
    "1. Description of what to change and where — because [reason]",
    "2. Description of what to change and where — because [reason]"
  ],
  "reasoning": "Multi-paragraph explanation of why these specific changes should help, what root causes they address, and how they relate to the analysis findings."
}`;

const DEFAULT_SELF_REFLECTION_TEMPLATE = `You are reviewing your own output to help improve the prompt that produced it.

THE PROMPT you were given:
{PROMPT_USED}

THE DESIRED OUTPUT (reference — what a perfect response looks like):
{TARGET_OUTPUT}

YOUR OUTPUT (what you actually produced):
{CANDIDATE_OUTPUT}

ANALYSIS OF THE DIFFERENCES:
{ANALYSIS_TEXT}

You know your own tendencies better than any external reviewer. Based on this analysis, suggest concrete improvements to the prompt that would help YOU produce output closer to the reference next time.

Think about:
- What in the prompt was ambiguous or easy to misinterpret?
- What assumptions did you make that turned out to be wrong?
- What additional instructions or examples would have guided you better?

Rules:
- Suggest GENERIC prompt modifications — do NOT reference project-specific names, APIs, or domain concepts
- Each fix must work for ANY prompt calibration task, not just this one
- Explain WHAT to add/change and WHERE in the prompt
- Be specific — show the actual text to add or modify

Output as JSON:
{
  "proposals": [
    "1. Description of what to change and where — because [reason]",
    "2. Description of what to change and where — because [reason]"
  ],
  "reasoning": "Multi-paragraph explanation from your perspective as the model that produced this output — why these changes would help you specifically, what confused you about the original prompt, and how the proposed changes address that."
}`;

const DEFAULT_SYNTHESIS_TEMPLATE = `You are reviewing prompt improvement proposals from multiple AI models.

THE PROMPT being calibrated:
{PROMPT_USED}

PROPOSALS FROM THE REASONING MODEL (the judge):
{JUDGE_PROPOSALS}

PROPOSALS FROM THE CANDIDATE MODELS (self-reflection):
{CANDIDATE_PROPOSALS}

Your task:
1. GROUP overlapping proposals — if the judge and a candidate both suggest the same fix, note this overlap (overlapping proposals are more likely to be correct)
2. SCORE each unique proposal: how much would it actually improve the prompt? (high/medium/low impact)
3. Create 2-3 OPTION SETS:
   - Option A (conservative): only high-impact, low-risk changes
   - Option B (moderate): high + medium impact changes
   - Option C (aggressive): all changes including experimental ones
4. RECOMMEND which option to try first and explain why

Output as JSON:
{
  "groupedProposals": [
    {
      "proposal": "Description of the fix",
      "sources": ["judge:model1", "self:model2"],
      "overlap": true,
      "impact": "high",
      "risk": "low",
      "explanation": "Why this would help"
    }
  ],
  "options": {
    "A": {
      "label": "Conservative — high-confidence fixes only",
      "proposalIds": [0, 2],
      "expectedImpact": "Should fix the most critical dimension failures"
    },
    "B": {
      "label": "Moderate — likely improvements",
      "proposalIds": [0, 1, 2, 4],
      "expectedImpact": "Should address most gaps"
    },
    "C": {
      "label": "Aggressive — all suggestions",
      "proposalIds": [0, 1, 2, 3, 4, 5],
      "expectedImpact": "Maximum change, might introduce new issues"
    }
  },
  "recommendation": "Start with Option B because...",
  "analysis": "Multi-paragraph synthesis of all proposals, what overlaps, what's unique to specific models, and what the overall calibration strategy should be."
}`;

/** Loosely-typed shapes for the dynamic calibrator JSON stored in memory records. */
interface CalibratorDimension {
  name?: string;
  description?: unknown;
  category?: unknown;
  [key: string]: unknown;
}

interface CalibratorBatchModel {
  modelId?: string;
  modelLabel?: string;
  step2_analysis?: { overallScore?: number | null; dimensions?: CalibratorDimension[] };
  [key: string]: unknown;
}

interface CalibratorCandidateModel {
  id: string;
  label: string;
  [key: string]: unknown;
}

export function calibratorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
  const detailDb = createCalibratorDetailService(storage);

  /** Helper: write a calibrator memory key with required MemoryRecord fields */
  async function setCalMemory(gaii: string, key: string, value: unknown, tags: string[]) {
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

  // ── Template defaults (MUST be before /:id to avoid Express matching "templates" as :id) ──
  router.get('/v1/calibrator/templates',
    requireAuth(), requireRole('owner'),
    async (_req: Request, res: Response) => {
      res.json(success(config.nodeId, {
        analysisPromptTemplate: DEFAULT_ANALYSIS_TEMPLATE,
        reflectionPromptTemplate: DEFAULT_REFLECTION_TEMPLATE,
        selfReflectionPromptTemplate: DEFAULT_SELF_REFLECTION_TEMPLATE,
        synthesisPromptTemplate: DEFAULT_SYNTHESIS_TEMPLATE,
      }));
    }
  );

  // ── List projects ──
  router.get('/v1/calibrator',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const allMemory = await storage.listMemory(gaii, { prefix: 'calibrator.', tags: ['project'] });
      const projectRecords = allMemory
        .filter(m => m.key.endsWith('.project'))
        .sort((a, b) => new Date((b.value as Record<string, unknown>).createdAt as string).getTime() - new Date((a.value as Record<string, unknown>).createdAt as string).getTime());

      const projects = [];
      for (const m of projectRecords) {
        const project = m.value as Record<string, unknown>;
        const projectId = project.projectId as string;

        // Count batches and compute latestAvgScore
        const batchMemory = await storage.listMemory(gaii, { prefix: `calibrator.${projectId}.batch.` });
        const batchCount = batchMemory.length;
        let latestAvgScore: number | null = null;

        if (batchCount > 0) {
          // Find latest batch by createdAt
          const batches = batchMemory
            .map(bm => bm.value as Record<string, unknown>)
            .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
          const latestBatch = batches[0];
          const models = (latestBatch.models as CalibratorBatchModel[]) || [];
          const scores = models
            .map(m => m.step2_analysis?.overallScore)
            .filter((s): s is number => s != null);
          if (scores.length > 0) {
            latestAvgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
          }
        }

        projects.push({ ...project, batchCount, latestAvgScore });
      }

      res.json(success(config.nodeId, { projects }));
    }
  );

  // ── Create project ──
  router.post('/v1/calibrator',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const { name } = req.body ?? {};
      if (!name || typeof name !== 'string') {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'name is required.'));
      }
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
      await setCalMemory(gaii, `calibrator.${projectId}.project`, project, ['calibrator', 'project']);
      res.status(201).json(success(config.nodeId, { project }));
      emitChange('memory');
    }
  );

  // ── Get project ──
  router.get('/v1/calibrator/:id',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const record = await storage.getMemory(gaii, `calibrator.${id}.project`);
      if (!record) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Calibration project not found.'));
      }
      // Backfill missing or outdated template fields
      const project = record.value as Record<string, unknown>;
      let needsSave = false;
      // Update analysis template if it contains old versions (line-by-line or verbose structural)
      const analysisStr = (project.analysisPromptTemplate as string) || '';
      if (!analysisStr || analysisStr.includes('For each difference between A and B') || analysisStr.includes('Do NOT create dimensions for')) {
        project.analysisPromptTemplate = DEFAULT_ANALYSIS_TEMPLATE; needsSave = true;
      }
      if (!project.reflectionPromptTemplate) { project.reflectionPromptTemplate = DEFAULT_REFLECTION_TEMPLATE; needsSave = true; }
      if (!project.selfReflectionPromptTemplate) { project.selfReflectionPromptTemplate = DEFAULT_SELF_REFLECTION_TEMPLATE; needsSave = true; }
      if (!project.synthesisPromptTemplate) { project.synthesisPromptTemplate = DEFAULT_SYNTHESIS_TEMPLATE; needsSave = true; }
      if (needsSave) {
        await setCalMemory(gaii, `calibrator.${id}.project`, project, ['calibrator', 'project']);
      }
      const dimRecord = await storage.getMemory(gaii, `calibrator.${id}.dimensions`);
      res.json(success(config.nodeId, {
        project,
        dimensions: dimRecord?.value ?? [],
      }));
    }
  );

  // ── Project detail (composite mount) ──
  // GET /v1/calibrator/:id/detail — the whole project-detail view mount in ONE prefix scan: project +
  // dimensions + version summaries + current version + batch summaries. Folds the 4-request waterfall the
  // detail view fired on open (getProject → listVersions → getVersion → listBatches). The lazy
  // template-backfill (getProject's behavior) is applied here because the default-template constants and
  // setCalMemory live in this module. The individual endpoints stay for interactive re-fetches. This is a
  // 2-segment path (:id/detail) — no collision with /:id or the literal /:id/versions|/batches captures.
  router.get('/v1/calibrator/:id/detail',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const data = await detailDb.overview(gaii, id);
      if (!data) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Calibration project not found.'));
      }
      // Lazy template backfill — identical to GET /v1/calibrator/:id, kept behavior-compatible.
      const project = data.project;
      let needsSave = false;
      const analysisStr = (project.analysisPromptTemplate as string) || '';
      if (!analysisStr || analysisStr.includes('For each difference between A and B') || analysisStr.includes('Do NOT create dimensions for')) {
        project.analysisPromptTemplate = DEFAULT_ANALYSIS_TEMPLATE; needsSave = true;
      }
      if (!project.reflectionPromptTemplate) { project.reflectionPromptTemplate = DEFAULT_REFLECTION_TEMPLATE; needsSave = true; }
      if (!project.selfReflectionPromptTemplate) { project.selfReflectionPromptTemplate = DEFAULT_SELF_REFLECTION_TEMPLATE; needsSave = true; }
      if (!project.synthesisPromptTemplate) { project.synthesisPromptTemplate = DEFAULT_SYNTHESIS_TEMPLATE; needsSave = true; }
      if (needsSave) {
        await setCalMemory(gaii, `calibrator.${id}.project`, project, ['calibrator', 'project']);
      }
      res.json(success(config.nodeId, data));
    }
  );

  // ── Update project ──
  router.put('/v1/calibrator/:id',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const record = await storage.getMemory(gaii, `calibrator.${id}.project`);
      if (!record) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Calibration project not found.'));
      }
      const project = record.value as Record<string, unknown>;
      const {
        name, reasoningLlm, analysisPromptTemplate, reflectionPromptTemplate,
        selfReflectionPromptTemplate, synthesisPromptTemplate, candidateModels, status,
      } = req.body ?? {};
      if (name !== undefined) project.name = name;
      if (reasoningLlm !== undefined) project.reasoningLlm = reasoningLlm;
      if (analysisPromptTemplate !== undefined) project.analysisPromptTemplate = analysisPromptTemplate;
      if (reflectionPromptTemplate !== undefined) project.reflectionPromptTemplate = reflectionPromptTemplate;
      if (selfReflectionPromptTemplate !== undefined) project.selfReflectionPromptTemplate = selfReflectionPromptTemplate;
      if (synthesisPromptTemplate !== undefined) project.synthesisPromptTemplate = synthesisPromptTemplate;
      if (candidateModels !== undefined) project.candidateModels = candidateModels;
      if (status !== undefined) project.status = status;
      await setCalMemory(gaii, `calibrator.${id}.project`, project, ['calibrator', 'project']);
      res.json(success(config.nodeId, { project }));
      emitChange('memory');
    }
  );

  // ── Delete project (cascade) ──
  router.delete('/v1/calibrator/:id',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const allKeys = await storage.listMemory(gaii, { prefix: `calibrator.${id}.` });
      for (const m of allKeys) {
        await storage.deleteMemory(gaii, m.key);
      }
      res.json(success(config.nodeId, { deleted: allKeys.length }));
      emitChange('memory');
    }
  );

  // ── Create version ──
  router.post('/v1/calibrator/:id/versions',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const projectRecord = await storage.getMemory(gaii, `calibrator.${id}.project`);
      if (!projectRecord) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Calibration project not found.'));
      }
      const { prompt, targetOutput, changelog } = req.body ?? {};
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'prompt is required.'));
      }
      const project = projectRecord.value as Record<string, unknown>;
      const newVersion = ((project.currentVersion as number) || 0) + 1;
      const version = {
        version: newVersion,
        prompt,
        targetOutput: targetOutput || '',
        changelog: changelog || (newVersion === 1 ? 'Initial version' : ''),
        createdAt: new Date().toISOString(),
      };
      await setCalMemory(gaii, `calibrator.${id}.version.${newVersion}`, version, ['calibrator', 'version']);
      project.currentVersion = newVersion;
      await setCalMemory(gaii, `calibrator.${id}.project`, project, ['calibrator', 'project']);
      res.status(201).json(success(config.nodeId, { version }));
      emitChange('memory');
    }
  );

  // ── List versions ──
  router.get('/v1/calibrator/:id/versions',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const allMemory = await storage.listMemory(gaii, { prefix: `calibrator.${id}.version.` });
      const versions = allMemory
        .map(m => {
          const v = m.value as Record<string, unknown>;
          return { version: v.version, changelog: v.changelog, createdAt: v.createdAt };
        })
        .sort((a, b) => (a.version as number) - (b.version as number));
      res.json(success(config.nodeId, { versions }));
    }
  );

  // ── Get version ──
  router.get('/v1/calibrator/:id/versions/:v',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const v = req.params.v as string;
      const record = await storage.getMemory(gaii, `calibrator.${id}.version.${v}`);
      if (!record) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Version not found.'));
      }
      res.json(success(config.nodeId, { version: record.value }));
    }
  );

  // ── Create batch ──
  router.post('/v1/calibrator/:id/batches',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const { promptVersion } = req.body ?? {};
      if (!promptVersion || typeof promptVersion !== 'number' || promptVersion < 1) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'promptVersion (positive integer) is required.'));
      }

      // Verify version exists
      const versionRecord = await storage.getMemory(gaii, `calibrator.${id}.version.${promptVersion}`);
      if (!versionRecord) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${promptVersion} not found.`));
      }

      // Verify project exists and get candidate models
      const projectRecord = await storage.getMemory(gaii, `calibrator.${id}.project`);
      if (!projectRecord) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Calibration project not found.'));
      }
      const project = projectRecord.value as Record<string, unknown>;
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

      await setCalMemory(gaii, `calibrator.${id}.batch.${batchId}`, batch, ['calibrator', 'batch']);
      res.status(201).json(success(config.nodeId, { batch }));
      emitChange('memory');
    }
  );

  // ── List batches (summary) ──
  router.get('/v1/calibrator/:id/batches',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const allMemory = await storage.listMemory(gaii, { prefix: `calibrator.${id}.batch.` });

      let batches = allMemory
        .map(m => {
          const b = m.value as Record<string, unknown>;
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

      const versionFilter = req.query.version as string | undefined;
      if (versionFilter) {
        batches = batches.filter(b => String(b.promptVersion) === versionFilter);
      }

      res.json(success(config.nodeId, { batches }));
    }
  );

  // ── Get batch detail ──
  router.get('/v1/calibrator/:id/batches/:batchId',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const batchId = req.params.batchId as string;
      const record = await storage.getMemory(gaii, `calibrator.${id}.batch.${batchId}`);
      if (!record) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Batch not found.'));
      }
      res.json(success(config.nodeId, { batch: record.value }));
    }
  );

  // ── Update batch ──
  router.put('/v1/calibrator/:id/batches/:batchId',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const batchId = req.params.batchId as string;
      const record = await storage.getMemory(gaii, `calibrator.${id}.batch.${batchId}`);
      if (!record) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Batch not found.'));
      }
      const batch = record.value as Record<string, unknown>;
      const { models, status, step4_synthesis } = req.body ?? {};
      if (models !== undefined) batch.models = models;
      if (status !== undefined) batch.status = status;
      if (step4_synthesis !== undefined) batch.step4_synthesis = step4_synthesis;
      await setCalMemory(gaii, `calibrator.${id}.batch.${batchId}`, batch, ['calibrator', 'batch']);

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
        const dimRecord = await storage.getMemory(gaii, `calibrator.${id}.dimensions`);
        const existingDims = (dimRecord?.value as CalibratorDimension[]) || [];
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
        if (added) {
          await setCalMemory(gaii, `calibrator.${id}.dimensions`, existingDims, ['calibrator', 'dimensions']);
        }
      }

      res.json(success(config.nodeId, { batch }));
      emitChange('memory');
    }
  );

  // ── Delete batch ──
  router.delete('/v1/calibrator/:id/batches/:batchId',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const batchId = req.params.batchId as string;
      const record = await storage.getMemory(gaii, `calibrator.${id}.batch.${batchId}`);
      if (!record) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Batch not found.'));
      }
      await storage.deleteMemory(gaii, `calibrator.${id}.batch.${batchId}`);
      res.json(success(config.nodeId, { deleted: 1 }));
      emitChange('memory');
    }
  );

  return router;
}
