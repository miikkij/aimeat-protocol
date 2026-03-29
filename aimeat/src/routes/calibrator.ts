/**
 * @file calibrator.ts
 * @description Prompt Calibrator API — CRUD for calibration projects, versions, and runs.
 * @structure
 *   - POST /v1/calibrator — create project
 *   - GET /v1/calibrator — list projects
 *   - GET /v1/calibrator/:id — get project
 *   - PUT /v1/calibrator/:id — update project
 *   - DELETE /v1/calibrator/:id — delete project + all data
 *   - POST /v1/calibrator/:id/versions — create version
 *   - GET /v1/calibrator/:id/versions — list versions
 *   - GET /v1/calibrator/:id/versions/:v — get version
 *   - POST /v1/calibrator/:id/runs — create run
 *   - GET /v1/calibrator/:id/runs — list runs
 *   - GET /v1/calibrator/:id/runs/:runId — get run
 *   - PUT /v1/calibrator/:id/runs/:runId — update run with analysis
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial implementation
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';

const DEFAULT_ANALYSIS_TEMPLATE = `You are analyzing why two AI models produced different outputs from the same prompt.

MODEL A (reference — the target quality) produced:
{TARGET_OUTPUT}

MODEL B (candidate — {MODEL_NAME}) produced:
{CANDIDATE_OUTPUT}

The PROMPT given to both models was the same prompt (shown below for context):
{PROMPT_USED}

For each difference between A and B, categorize it:
- FORMAT: output structure differs (fences, blocks, separators)
- NAMING: identifiers differ (action IDs, variable names, key names)
- STRUCTURE: component count, feature decomposition, architecture differs
- DATA_MODEL: data shapes, types, nesting differs
- MISSING: something in A is absent in B
- EXTRA: B added something not in A
- QUALITY: both work but one is better (helper extraction, null checks, etc.)

For each difference where B's output would cause problems, suggest a prompt modification that would guide B to avoid that specific mistake — without showing B what A produced.

The fix must:
- NOT mention any project-specific names, APIs, or domain concepts
- Work for ANY prompt calibration task, not just this one
- Be a concrete text addition or change to the prompt

Output as JSON so the system can parse it:
{
  "dimensions": [
    {
      "name": "short_snake_case_name",
      "description": "What this dimension measures",
      "category": "format|structure|data_model|naming|missing|extra|quality",
      "severity": "critical|major|minor",
      "expected": "what the reference has",
      "actual": "what the candidate produced",
      "pass": true or false
    }
  ],
  "analysis": "Detailed free-text analysis of the key differences. Be thorough — explain WHY each difference matters, what would break, and what the root cause likely is (e.g., model copied the example structure instead of deriving from the spec). This should be multiple paragraphs covering all significant gaps.",
  "proposals": [
    "Concrete prompt fix 1 — explain what to add/change and where in the prompt",
    "Concrete prompt fix 2 — explain what to add/change and where in the prompt"
  ]
}`;

export function calibratorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);

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

  // ── List projects ──
  router.get('/v1/calibrator',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const allMemory = await storage.listMemory(gaii, { prefix: 'calibrator.', tags: ['project'] });
      const projects = allMemory
        .filter(m => m.key.endsWith('.project'))
        .map(m => m.value)
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
      const dimRecord = await storage.getMemory(gaii, `calibrator.${id}.dimensions`);
      res.json(success(config.nodeId, {
        project: record.value,
        dimensions: dimRecord?.value ?? [],
      }));
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
      const { name, reasoningLlm, analysisPromptTemplate, candidateModels, status } = req.body ?? {};
      if (name !== undefined) project.name = name;
      if (reasoningLlm !== undefined) project.reasoningLlm = reasoningLlm;
      if (analysisPromptTemplate !== undefined) project.analysisPromptTemplate = analysisPromptTemplate;
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
        .sort((a: any, b: any) => (a.version as number) - (b.version as number));
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

  // ── Create run ──
  router.post('/v1/calibrator/:id/runs',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const { promptVersion, candidateModelId, candidateModelLabel, output, durationMs, tokensUsed } = req.body ?? {};
      if (!promptVersion || !candidateModelId || !output) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'promptVersion, candidateModelId, and output are required.'));
      }
      const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const run = {
        runId,
        timestamp: new Date().toISOString(),
        promptVersion,
        candidateModelId,
        candidateModelLabel: candidateModelLabel || candidateModelId,
        output,
        durationMs: durationMs || 0,
        tokensUsed: tokensUsed ?? null,
        dimensions: [],
        overallScore: null,
        analysis: null,
        proposals: [],
      };
      await setCalMemory(gaii, `calibrator.${id}.run.${runId}`, run, ['calibrator', 'run']);
      res.status(201).json(success(config.nodeId, { run }));
      emitChange('memory');
    }
  );

  // ── List runs ──
  router.get('/v1/calibrator/:id/runs',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const allMemory = await storage.listMemory(gaii, { prefix: `calibrator.${id}.run.` });
      let runs = allMemory
        .map(m => {
          const r = m.value as Record<string, unknown>;
          return {
            runId: r.runId,
            timestamp: r.timestamp,
            promptVersion: r.promptVersion,
            candidateModelId: r.candidateModelId,
            candidateModelLabel: r.candidateModelLabel,
            durationMs: r.durationMs,
            overallScore: r.overallScore,
            dimensions: r.dimensions,
          };
        })
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const versionFilter = req.query.version as string | undefined;
      const modelFilter = req.query.model as string | undefined;
      if (versionFilter) runs = runs.filter((r: any) => String(r.promptVersion) === versionFilter);
      if (modelFilter) runs = runs.filter((r: any) => r.candidateModelId === modelFilter);

      res.json(success(config.nodeId, { runs }));
    }
  );

  // ── Get run detail ──
  router.get('/v1/calibrator/:id/runs/:runId',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const runId = req.params.runId as string;
      const record = await storage.getMemory(gaii, `calibrator.${id}.run.${runId}`);
      if (!record) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Run not found.'));
      }
      res.json(success(config.nodeId, { run: record.value }));
    }
  );

  // ── Update run with analysis ──
  router.put('/v1/calibrator/:id/runs/:runId',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const id = req.params.id as string;
      const runId = req.params.runId as string;
      const record = await storage.getMemory(gaii, `calibrator.${id}.run.${runId}`);
      if (!record) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Run not found.'));
      }
      const run = record.value as Record<string, unknown>;
      const { dimensions, overallScore, analysis, proposals } = req.body ?? {};
      if (dimensions !== undefined) run.dimensions = dimensions;
      if (overallScore !== undefined) run.overallScore = overallScore;
      if (analysis !== undefined) run.analysis = analysis;
      if (proposals !== undefined) run.proposals = proposals;
      await setCalMemory(gaii, `calibrator.${id}.run.${runId}`, run, ['calibrator', 'run']);

      // Update project-level dimensions registry
      if (Array.isArray(dimensions) && dimensions.length > 0) {
        const dimRecord = await storage.getMemory(gaii, `calibrator.${id}.dimensions`);
        const existingDims = (dimRecord?.value as any[]) || [];
        const existingNames = new Set(existingDims.map((d: any) => d.name));
        let added = false;
        for (const dim of dimensions) {
          if (!existingNames.has(dim.name)) {
            existingDims.push({
              name: dim.name,
              description: dim.description,
              category: dim.category,
              discoveredInRun: runId,
            });
            existingNames.add(dim.name);
            added = true;
          }
        }
        if (added) {
          await setCalMemory(gaii, `calibrator.${id}.dimensions`, existingDims, ['calibrator', 'dimensions']);
        }
      }

      res.json(success(config.nodeId, { run }));
      emitChange('memory');
    }
  );

  return router;
}
