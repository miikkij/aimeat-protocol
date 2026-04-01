// @file src/routes/generator.ts
// @description Service generator API. Thin validation layer over Memory API.
// Agents and the browser UI submit generated content here; the route validates it, then writes to
// generator.* memory keys using the same structure the frontend reads.
// @structure
//   POST   /v1/generator/projects                                           — create a new generator project
//   GET    /v1/generator/projects                                           — list all projects for the caller
//   GET    /v1/generator/:projectId                                         — get full project state (project, interviewSpec, components)
//   DELETE /v1/generator/:projectId                                         — delete project and all associated data (cascade)
//   POST   /v1/generator/:projectId/interview                               — save/update interview spec for a project
//   POST   /v1/generator/:projectId/settings                                — store project settings values (with optional encryption)
//   GET    /v1/generator/:projectId/settings                                — retrieve project settings values
//   POST   /v1/generator/:projectId/steps/blueprint                         — validate + store blueprint
//   POST   /v1/generator/:projectId/components/:componentId/submit          — validate + store component content
//   POST   /v1/generator/:projectId/components/:componentId/register        — register a validated component into the AIMEAT catalogue
//   POST   /v1/generator/:projectId/test                                    — run tests in dependency order
//   GET    /v1/generator/:projectId/screenshots/:filename                   — serve test screenshot PNGs
//   POST   /v1/generator/:projectId/log                                     — write log entry to memory
//   POST   /v1/generator/:projectId/complete                                — mark project active
//   GET    /v1/generator/:projectId/prompts/:componentId                    — get the generation prompt for a component
//   GET    /v1/generator/:projectId/prompts                                 — get the blueprint generation prompt
// @usage
//   Consumed by AI agents via device auth (generator:read / generator:write / generator:execute scopes)
//   and by the browser UI (owner JWT satisfies agent role check).
// @version-history
//   v1.0.0 — 2026-03-18 — Initial implementation
//   v1.1.0 — 2026-03-18 — Add project management and interview endpoints (Task 3)
//   v1.2.0 — 2026-03-18 — Add session claim, heartbeat, and release endpoints (Task 4)
//   v1.3.0 — 2026-03-18 — Add blueprint, component submit, log, and complete endpoints (Task 5)
//   v1.4.0 — 2026-03-18 — Add component registration endpoint (Task 6)
//   v1.5.0 — 2026-03-18 — Fix session claim: use setMemory for new sessions (setMemoryIfVersion only for CAS on existing stale sessions)
//   v1.6.0 — 2026-03-19 — Fix emitChange, session ownership, validation status codes, dead code removal, type checks
//   v1.7.0 — 2026-03-19 — Add GET /v1/generator/my-assignments polling endpoint for agent discovery
//   v1.8.0 — 2026-03-19 — Update agent guide to use polling instead of SSE for assignment discovery
//   v1.9.0 — 2026-03-19 — Safety guards: version increment, blueprint immutability, registered component protection, session identity check
//   v2.0.0 — 2026-03-19 — Add DELETE /v1/generator/:projectId cascade delete; validate componentId in heartbeat against blueprint
//   v5.0.0 — 2026-03-20 — Remove agent guide, my-assignments, and session endpoints (replaced by OpenRouter autopilot)
//   v5.1.0 — 2026-03-21 — Add settings collection endpoints (POST/GET /v1/generator/:projectId/settings)
//   v5.2.0 — 2026-03-21 — Add test execution endpoint, screenshot serving, and screenshot cleanup on delete (Task 16)

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { logger } from '../utils/logger.js';
import { validateInterviewSpec, validateBlueprint, validateComponent } from '../services/generator-validate.js';
import type { ComponentType } from '../services/generator-validate.js';
import { registerCsm, registerMsm, registerExtension, registerApp } from '../services/generator-registration.js';
import { emitChange } from '../services/event-bus.js';
// encryption removed from generator settings — values stored as plain text in owner-scoped memory
import { topologicalSort, executeHttpTest, executePlaywrightTest, isPlaywrightAvailable, ensureScreenshotDir, cleanupScreenshots, screenshotDir } from '../services/generator-testing.js';
import type { TestReport, TestResult } from '../services/generator-testing.js';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
// @ts-ignore — frontend ESM module, no .d.ts
import { buildComponentPrompt, buildBlueprintPrompt } from '../../public/js/services/generator-prompts.js';
import { GeneratorDebugWriter } from '../services/generator-debug.js';

export function generatorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const VALID_COMPONENT_TYPES: ComponentType[] = ['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'];

  // Generator data is always stored under the owner's GHII (created by browser/owner session).
  // Agents need to read/write using the owner's GHII, not their own GAII.
  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;

  // POST /v1/generator/projects — create a new generator project
  router.post('/v1/generator/projects',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const { name, description } = req.body ?? {};

      if (!name || typeof name !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'name is required'));
        return;
      }

      const projectId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const project = {
        projectId,
        name: name.trim(),
        description: (description ?? '').trim(),
        status: 'draft',
        blueprint: null,
        createdAt: now,
        updatedAt: now,
      };

      await storage.setMemory({
        key: `generator.${projectId}.project`,
        ownerGaii: gaii,
        value: project,
        visibility: 'owner',
        version: 1,
        tags: ['generator', 'project'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.status(201).json(success(config.nodeId, { projectId, project }));
      emitChange('memory');
    }
  );

  // GET /v1/generator/projects — list all projects for the caller
  // NOTE: This static route MUST be registered before GET /v1/generator/:projectId
  router.get('/v1/generator/projects',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const records = await storage.listMemory(gaii, { prefix: 'generator.', visibility: 'owner' });
      const projects = records
        .filter(r => r.key.endsWith('.project'))
        .map(r => r.value);

      res.json(success(config.nodeId, { projects }));
    }
  );

  // ── Debug file viewer API (MUST be before :projectId routes) ─────────

  router.get('/v1/generator/debug/projects',
    requireAuth(), requireRole('owner'),
    async (_req, res) => {
      const { listDebugProjects } = await import('../services/generator-debug.js');
      res.json(success(config.nodeId, { projects: await listDebugProjects() }));
    }
  );

  router.get('/v1/generator/debug/:projectId/files',
    requireAuth(), requireRole('owner'),
    async (req, res) => {
      const { listDebugFiles } = await import('../services/generator-debug.js');
      res.json(success(config.nodeId, { projectId: req.params['projectId'] as string, files: await listDebugFiles(req.params['projectId'] as string) }));
    }
  );

  router.get('/v1/generator/debug/:projectId/file',
    requireAuth(), requireRole('owner'),
    async (req, res) => {
      const { readDebugFile } = await import('../services/generator-debug.js');
      const filePath = (req.query['path'] as string) || '';
      if (!filePath) { res.status(400).json(error(config.nodeId, 'INVALID_QUERY', 'path query parameter is required')); return; }
      const content = await readDebugFile(req.params['projectId'] as string, filePath);
      if (content === null) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found')); return; }
      res.json(success(config.nodeId, { projectId: req.params['projectId'] as string, path: filePath, content }));
    }
  );

  router.delete('/v1/generator/debug/:projectId',
    requireAuth(), requireRole('owner'),
    async (req, res) => {
      const { deleteDebugProject } = await import('../services/generator-debug.js');
      res.json(success(config.nodeId, { deleted: await deleteDebugProject(req.params['projectId'] as string), projectId: req.params['projectId'] as string }));
    }
  );

  // GET /v1/generator/:projectId — get full project state
  router.get('/v1/generator/:projectId',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const [projectRec, interviewRec, sessionRec] = await Promise.all([
        storage.getMemory(gaii, `generator.${projectId}.project`),
        storage.getMemory(gaii, `generator.${projectId}.interview-spec`),
        storage.getMemory(gaii, `generator.${projectId}.session`),
      ]);

      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const componentRecords = await storage.listMemory(gaii, {
        prefix: `generator.${projectId}.component.`,
      });
      const components = componentRecords.map(r => r.value);

      res.json(success(config.nodeId, {
        project: projectRec.value,
        interviewSpec: interviewRec?.value ?? null,
        components,
        session: sessionRec?.value ?? null,
      }));
    }
  );

  // DELETE /v1/generator/:projectId — delete project and all associated data (cascade)
  router.delete('/v1/generator/:projectId',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Cascade delete all project data
      const allRecords = await storage.listMemory(gaii, { prefix: `generator.${projectId}.` });
      for (const rec of allRecords) {
        await storage.deleteMemory(gaii, rec.key);
      }

      // Clean up test screenshots from filesystem
      await cleanupScreenshots(projectId);

      res.json(success(config.nodeId, { deleted: true, keysRemoved: allRecords.length }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/interview — save/update interview spec
  // Also fixes visibility: frontend previously wrote 'private', now writes 'owner' so agents can read it.
  router.post('/v1/generator/:projectId/interview',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { interviewSpec } = req.body ?? {};

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const validation = validateInterviewSpec(JSON.stringify(interviewSpec));
      if (!validation.valid) {
        res.status(422).json(error(config.nodeId, 'VALIDATION_ERROR', 'Invalid interview spec', undefined, { errors: validation.errors }));
        return;
      }

      const now = new Date().toISOString();
      await storage.setMemory({
        key: `generator.${projectId}.interview-spec`,
        ownerGaii: gaii,
        value: interviewSpec,
        visibility: 'owner',
        version: 1,
        tags: ['generator', 'interview'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { saved: true }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/settings — store project settings values
  router.post('/v1/generator/:projectId/settings',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const gaii = ownerGhii(req);
      const { values, secretKeys } = req.body as {
        values: Record<string, string | number | boolean>;
        secretKeys?: string[];
      };

      if (!values || typeof values !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'values object required'));
        return;
      }

      // Verify project exists
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Store values as-is (no encryption — settings are already protected by owner-scoped memory)
      const storedValues = { ...values };

      // Store using full MemoryRecord pattern
      const now = new Date().toISOString();
      const existing = await storage.getMemory(gaii, `generator.${projectId}.settings`);
      await storage.setMemory({
        key: `generator.${projectId}.settings`,
        ownerGaii: gaii,
        value: storedValues,
        visibility: 'owner',
        version: existing ? existing.version + 1 : 1,
        tags: ['generator', 'settings'],
        ttlHours: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { stored: Object.keys(values).length }));
      emitChange('memory');
    }
  );

  // GET /v1/generator/:projectId/settings — retrieve project settings values
  router.get('/v1/generator/:projectId/settings',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const gaii = ownerGhii(req);

      const rec = await storage.getMemory(gaii, `generator.${projectId}.settings`);
      const values = (rec?.value as Record<string, unknown>) ?? {};

      res.json(success(config.nodeId, { values }));
    }
  );

  // POST /v1/generator/:projectId/test/:componentId — execute AI-generated test code
  // NOTE: registered before bulk test and /:projectId/components/:componentId
  router.post('/v1/generator/:projectId/test/:componentId',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const { testCode, environment } = req.body ?? {};

      if (!testCode) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'testCode is required — AI must generate the test code first'));
        return;
      }

      // Load component record for metadata
      const compRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      const compVal = (compRec?.value as Record<string, unknown>) ?? {};
      const compType = (compVal.type as string) || 'unknown';
      const registeredAs = compVal.registeredAs as string || componentId;

      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      const baseUrl = `http://localhost:${config.port}`;

      let result: TestResult;

      // Determine execution environment: browser (Playwright) or server (HTTP)
      const env = (environment as string) || (compType === 'cortex' || compType === 'app' ? 'browser' : 'server');

      if (env === 'browser') {
        // Browser test — execute AI-generated code in Playwright
        if (!await isPlaywrightAvailable()) {
          result = { componentId, type: compType, status: 'skipped', scenarios: 0, passed: 0, errors: ['Playwright not available'], screenshots: [], fixRound: 0 };
        } else {
          // All browser tests use the self-contained test page
          // It includes auth, library scripts, and test code — Playwright just navigates and reads results
          const targetUrl = `${baseUrl}/v1/generator/test-page/${projectId}/${componentId}`;

          await ensureScreenshotDir(projectId);
          const pwResult = await executePlaywrightTest(testCode as string, projectId, componentId, targetUrl, [], token);
          result = { componentId, type: compType, status: pwResult.passed ? 'passed' : 'failed', scenarios: 1, passed: pwResult.passed ? 1 : 0, errors: pwResult.errors, screenshots: pwResult.screenshots, fixRound: 0 };
        }
      } else {
        // Server test — execute AI-generated code with testFetch helper
        const httpResult = await executeHttpTest(testCode as string, baseUrl, token);
        result = { componentId, type: compType, status: httpResult.passed ? 'passed' : 'failed', scenarios: 1, passed: httpResult.passed ? 1 : 0, errors: httpResult.errors, screenshots: [], fixRound: 0, trace: httpResult.trace };
      }

      // Debug: write test artifacts to disk and log to terminal
      const debugWriter = new GeneratorDebugWriter(projectId);
      const compLabel = (compVal.label as string) || componentId;
      await debugWriter.writeTestCode(componentId, testCode as string);
      await debugWriter.writeTestResult(componentId, result as unknown as Record<string, unknown>);
      await debugWriter.appendLog({
        event: 'test_executed',
        componentId,
        componentLabel: compLabel,
        type: compType,
        environment: env,
        status: result.status,
        errors: result.errors,
        passed: result.passed,
        scenarios: result.scenarios,
      });

      // Terminal output — clear summary of what happened
      const statusIcon = result.status === 'passed' ? '\u2705' : result.status === 'failed' ? '\u274C' : '\u23ED';
      logger.info(`[generator-test] ${statusIcon} ${compLabel} (${compType}): ${result.status}${result.errors.length > 0 ? ' — ' + result.errors.length + ' errors' : ''}`, {
        projectId, componentId, environment: env, errors: result.errors.slice(0, 3),
      });
      // Log trace for failed tests — shows every callExt/readExtMemory call with results
      if (result.status === 'failed' && result.trace && result.trace.length > 0) {
        for (const t of result.trace) {
          logger.info(`[generator-test]   ${t.fn}(${t.args}) → [${t.status}] ${t.result}`);
        }
      }

      res.json(success(config.nodeId, { result }));
    }
  );

  // POST /v1/generator/:projectId/debug/:componentId — write debug artifact to disk
  router.post('/v1/generator/:projectId/debug/:componentId',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const { phase, content } = req.body ?? {};

      if (!phase || !content) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'phase and content are required'));
        return;
      }

      const debugWriter = new GeneratorDebugWriter(projectId);
      const phases: Record<string, () => Promise<void>> = {
        'prompt': () => debugWriter.writeComponentPrompt(componentId, content as string),
        'generated': () => debugWriter.writeComponentGenerated(componentId, content as string),
        'validation': () => debugWriter.writeValidation(componentId, content as Record<string, unknown>),
        'test-prompt': () => debugWriter.writeTestPrompt(componentId, content as string),
        'test-code': () => debugWriter.writeTestCode(componentId, content as string),
        'test-result': () => debugWriter.writeTestResult(componentId, content as Record<string, unknown>),
        'project-meta': () => debugWriter.writeProjectMeta(
          (content as Record<string, unknown>).project as Record<string, unknown>,
          (content as Record<string, unknown>).interviewSpec,
          (content as Record<string, unknown>).blueprint,
        ),
      };

      const handler = phases[phase as string];
      if (handler) {
        await handler();
      } else {
        // Generic fallback — write any phase as a text artifact
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        await debugWriter.writeArtifact(componentId, phase as string, text);
      }
      await debugWriter.appendLog({ event: `debug_${phase}`, componentId, timestamp: new Date().toISOString() });
      res.json(success(config.nodeId, { written: true, phase, componentId }));
    }
  );

  // POST /v1/generator/:projectId/apply-settings/:extensionName — inject project settings into extension config
  // Reads settings from generator.{projectId}.settings and merges them into the extension's config object.
  // This bridges blueprint settings (collected from user) to the extension's runtime config (ctx.config).
  router.post('/v1/generator/:projectId/apply-settings/:extensionName',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const extensionName = req.params['extensionName'] as string;

      // Load project settings
      const settingsRec = await storage.getMemory(gaii, `generator.${projectId}.settings`);
      const settings = (settingsRec?.value as Record<string, unknown>) ?? {};

      // Debug: log what we found
      const settingsKeys = Object.keys(settings);
      const settingsDebug = settingsKeys.map(k => {
        const v = settings[k];
        if (typeof v === 'string' && v.startsWith('enc:')) return `${k}: [encrypted ${v.length} chars]`;
        if (typeof v === 'string') return `${k}: "${v.slice(0, 3)}...[${v.length} chars]"`;
        return `${k}: ${JSON.stringify(v)}`;
      });
      logger.info(`apply-settings: found ${settingsKeys.length} settings for project ${projectId}`, { keys: settingsDebug });

      if (settingsKeys.length === 0) {
        res.json(success(config.nodeId, { applied: 0, message: 'No settings to apply', debug: { settingsRecordExists: !!settingsRec } }));
        return;
      }

      // Load extension
      const ext = await storage.getExtension(extensionName);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${extensionName}" not found`));
        return;
      }

      logger.info(`apply-settings: extension ${extensionName} current config keys: ${Object.keys(ext.config).join(', ')}`);

      // Pass values through as-is (no encryption/decryption)
      const decrypted = { ...settings };
      const decryptLog = Object.keys(settings).map(k => {
        const v = settings[k];
        return `${k}: ${typeof v === 'string' ? v.length + ' chars' : typeof v}`;
      });

      logger.info(`apply-settings: decrypt results`, { results: decryptLog });

      // Merge settings into extension config (preserving __schedules and other internal keys)
      const newConfig = { ...ext.config, ...decrypted };
      await storage.updateExtension(extensionName, { config: newConfig });

      // Log final state (masked)
      const finalKeys = Object.keys(newConfig).filter(k => !k.startsWith('__'));
      const finalDebug = finalKeys.map(k => {
        const v = newConfig[k];
        if (typeof v === 'string' && v.length > 3) return `${k}: "${v.slice(0, 3)}..."`;
        return `${k}: ${JSON.stringify(v)}`;
      });
      logger.info(`apply-settings: extension ${extensionName} config updated`, { configKeys: finalDebug });

      res.json(success(config.nodeId, { applied: Object.keys(decrypted).length, keys: Object.keys(decrypted), decryptLog }));
    }
  );

  // POST /v1/generator/:projectId/probe-extension — call extension actions with test params, capture real responses
  // Used by autopilot to get actual API response shapes for injection into cortex/app prompts.
  router.post('/v1/generator/:projectId/probe-extension',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { extensionName, scenarios } = req.body as {
        extensionName?: string;
        scenarios?: Array<{ action: string; input: Record<string, unknown> }>;
      };

      if (!extensionName || !scenarios || !Array.isArray(scenarios)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'extensionName and scenarios[] required.'));
      }

      // Verify project ownership
      const projectRecord = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRecord) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found.'));
      }

      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      const baseUrl = `http://localhost:${config.port}`;
      const results: Array<{ action: string; input: Record<string, unknown>; status: number; response: unknown }> = [];

      for (const scenario of scenarios) {
        try {
          const resp = await fetch(`${baseUrl}/v1/ext/${encodeURIComponent(extensionName)}/${encodeURIComponent(scenario.action)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(scenario.input || {}),
          });
          const body = await resp.json() as Record<string, unknown>;
          results.push({
            action: scenario.action,
            input: scenario.input || {},
            status: resp.status,
            response: (body as { data?: unknown }).data ?? body,
          });
        } catch (e) {
          results.push({
            action: scenario.action,
            input: scenario.input || {},
            status: 500,
            response: { error: (e as Error).message },
          });
        }
      }

      logger.info('[generator] Extension probe complete', { extensionName, probed: results.length, projectId });

      res.json(success(config.nodeId, { extensionName, results }));
    },
  );

  // POST /v1/generator/:projectId/test — legacy bulk test endpoint
  // Tests are now per-component via AI-generated code. This endpoint returns a stub.
  router.post('/v1/generator/:projectId/test',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const report: TestReport = {
        level: 'none',
        timestamp: new Date().toISOString(),
        components: [],
        overall: 'passed',
      };
      res.json(success(config.nodeId, { report }, [
        { description: 'Tests are now per-component. Use POST /v1/generator/:projectId/test/:componentId with AI-generated testCode.', method: 'POST', url: `/v1/generator/${req.params['projectId'] as string}/test/:componentId` },
      ]));
    }
  );

  // GET /v1/generator/:projectId/screenshots/:filename — serve test screenshot PNGs
  // NOTE: registered before /:projectId/components/:componentId to avoid 'screenshots' matching as componentId
  // Screenshots are project-scoped and non-sensitive — serve without auth
  // so <img src="..."> tags work without JS-based auth header injection
  router.get('/v1/generator/:projectId/screenshots/:filename',
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const filename = req.params['filename'] as string;

      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'Invalid filename'));
        return;
      }

      const filepath = join(screenshotDir(projectId), filename);
      try {
        const data = await readFile(filepath);
        res.set('Content-Type', 'image/png');
        res.send(data);
      } catch {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Screenshot not found'));
      }
    }
  );

  // GET /v1/generator/test-page/:projectId/:componentId — browser test runner page
  // Serves a self-contained HTML page that loads cortex/app library, auth, and test code.
  // Playwright just navigates here and reads window.__testResults.
  // CSP is removed for this route — AI-generated test code may use eval/new Function and
  // this is an internal test page behind auth, not a public-facing page.
  router.get('/v1/generator/test-page/:projectId/:componentId',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      // Remove CSP for test pages — AI-generated code may need eval()
      res.removeHeader('Content-Security-Policy');
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const token = (req.headers.authorization ?? '').replace('Bearer ', '');

      const compRec = await storage.getMemory(ownerGhii(req), `generator.${projectId}.component.${componentId}`);
      const compVal = (compRec?.value as Record<string, unknown>) ?? {};
      const compType = (compVal.type as string) || 'unknown';
      const registeredAs = compVal.registeredAs as string || componentId;
      const testCode = (compVal.testCode as string) || '';

      if (!testCode) {
        res.status(400).send('No test code for this component');
        return;
      }

      // Build cortex/app script tags — nonce required for CSP
      const nonce = res.locals.cspNonce as string;
      const scripts: string[] = [];
      if (compType === 'cortex' && registeredAs) {
        // Load ALL project cortex dependencies BEFORE the component under test.
        // Component cortexes depend on data cortex + platform UI cortexes.
        // Without these, tests fail with "lib not loaded" errors.
        const allComps = await storage.listMemory(ownerGhii(req), { prefix: `generator.${projectId}.component.`, visibility: 'owner' });
        // Platform UI cortexes first (always available, not project-specific)
        const platformCortexes = ['aimeat-ui-nav', 'aimeat-ui-layout', 'aimeat-ui-viewers', 'aimeat-ui-forms', 'aimeat-ui-dialogs', 'aimeat-charts'];
        for (const pc of platformCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc}/libs/${pc}.js"></script>`);
        }
        // Then project cortexes in dependency order: data cortex before components
        const projectCortexes: Array<{ name: string; subtype: string }> = [];
        for (const rec of allComps) {
          const val = rec.value as Record<string, unknown>;
          if (val.type === 'cortex' && val.registeredAs && val.registeredAs !== registeredAs) {
            projectCortexes.push({ name: val.registeredAs as string, subtype: (val.subtype as string) || '' });
          }
        }
        // Data cortex first, then other cortexes
        projectCortexes.sort((a, b) => (a.subtype === 'data' ? -1 : b.subtype === 'data' ? 1 : 0));
        for (const pc of projectCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc.name}/libs/${pc.name}.js"></script>`);
        }
        // Finally the component under test
        scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${registeredAs}/libs/${registeredAs}.js"></script>`);
      }
      // App tests need the same cortex libraries the app uses
      // Load all cortex libs that belong to this project
      if (compType === 'app') {
        // Platform UI cortexes first
        const platformCortexes = ['aimeat-ui-nav', 'aimeat-ui-layout', 'aimeat-ui-viewers', 'aimeat-ui-forms', 'aimeat-ui-dialogs', 'aimeat-charts'];
        for (const pc of platformCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc}/libs/${pc}.js"></script>`);
        }
        const allComps = await storage.listMemory(ownerGhii(req), { prefix: `generator.${projectId}.component.`, visibility: 'owner' });
        // Data cortex first, then components, then app-domain
        const cortexes: Array<{ name: string; subtype: string }> = [];
        for (const rec of allComps) {
          const val = rec.value as Record<string, unknown>;
          if (val.type === 'cortex' && val.registeredAs) {
            cortexes.push({ name: val.registeredAs as string, subtype: (val.subtype as string) || '' });
          }
        }
        cortexes.sort((a, b) => {
          const order = { data: 0, component: 1, feature: 1, 'app-domain': 2 };
          return (order[a.subtype as keyof typeof order] ?? 1) - (order[b.subtype as keyof typeof order] ?? 1);
        });
        for (const c of cortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${c.name}/libs/${c.name}.js"></script>`);
        }
      }

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Test: ${registeredAs}</title></head>
<body>
<h1>Testing: ${registeredAs} (${compType})</h1>
<pre id="log"></pre>
<div id="result"></div>

<script nonce="${nonce}" src="/v1/libs/aimeat-auth.js"></script>
<script nonce="${nonce}">
// Inject test session into the real auth library
// Uses the same session.fetch() pattern as the real createSession() in aimeat-auth.js:
//   const resp = await fetch(url, { ...opts, headers }); return resp.json();
(function() {
  var jwt = ${JSON.stringify(token)};
  var parseJwt = function(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch(e) { return null; } };
  var payload = parseJwt(jwt);
  var session = {
    jwt: jwt,
    owner: payload && payload.owner || null,
    gaii: payload && payload.sub || null,
    ghii: (payload && payload.owner || '') + '@' + (payload && payload.node || ''),
    publicKey: null,
    nodeUrl: window.location.origin,
    roles: payload && payload.roles || [],
    get valid() { return true; },
    async fetch(path, opts) {
      if (!opts) opts = {};
      var url = window.location.origin + path;
      var headers = Object.assign({}, opts.headers || {}, {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + jwt
      });
      var resp = await fetch(url, Object.assign({}, opts, { headers: headers }));
      return resp.json();
    },
    async refresh() { return this; }
  };
  // Override getSession synchronously — before aimeat-data.js loads
  var origGetSession = AIMEAT.auth.getSession.bind(AIMEAT.auth);
  AIMEAT.auth.getSession = function() { return session || origGetSession(); };
})();
</script>
<script nonce="${nonce}" src="/v1/libs/aimeat-data.js"></script>

${scripts.join('\n')}

<script nonce="${nonce}">
// Ensure AIMEAT namespace aliases exist — cortex IIFEs register under different paths
// and generated code may use any of them
(function() {
  if (!window.AIMEAT) window.AIMEAT = {};
  if (!window.AIMEAT.ui) window.AIMEAT.ui = {};
  // Alias bundled cortex names to AIMEAT.ui.* paths if not already set
  var aliases = {
    'aimeat-ui-forms': 'forms', 'aimeat-ui-nav': 'nav', 'aimeat-ui-layout': 'layout',
    'aimeat-ui-viewers': 'viewers', 'aimeat-ui-dialogs': 'dialogs',
  };
  for (var full in aliases) {
    var short = aliases[full];
    if (AIMEAT[full] && !AIMEAT.ui[short]) AIMEAT.ui[short] = AIMEAT[full];
    if (AIMEAT.ui[short] && !AIMEAT[full]) AIMEAT[full] = AIMEAT.ui[short];
  }
})();
</script>

<script nonce="${nonce}">
// Test runner
window.__testResults = null;
window.__testRunning = true;
(async function() {
  try {
    ${testCode}
  } catch (e) {
    if (!window.__testResults) {
      window.__testResults = { passed: false, errors: ['Test threw: ' + e.message] };
    }
  } finally {
    window.__testRunning = false;
    if (!window.__testResults) {
      window.__testResults = { passed: false, errors: ['Test did not complete'] };
    }
    // Show results in DOM
    var el = document.getElementById('result');
    if (el && window.__testResults) {
      el.textContent = JSON.stringify(window.__testResults, null, 2);
      el.style.color = window.__testResults.passed ? 'green' : 'red';
    }
  }
})();
</script>
</body></html>`;

      res.set('Content-Type', 'text/html');
      res.send(html);
    }
  );

  // POST /v1/generator/:projectId/steps/blueprint — validate + store blueprint
  // NOTE: registered before /:projectId/components/:componentId/submit to prevent 'steps' matching as componentId
  router.post('/v1/generator/:projectId/steps/blueprint',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { blueprint } = req.body ?? {};

      if (!blueprint || typeof blueprint !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'blueprint string is required'));
        return;
      }

      const validation = validateBlueprint(blueprint);
      if (!validation.valid) {
        // Return validation errors to agent — do NOT write to memory
        const errors = validation.errors ?? [];
        res.status(422).json(error(config.nodeId, 'VALIDATION_FAILED', errors.join('; ')));
        return;
      }

      // Update the project's blueprint field in memory
      const now = new Date().toISOString();
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Guard: prevent blueprint overwrite if components have been submitted
      const existingComponents = await storage.listMemory(gaii, { prefix: `generator.${projectId}.component.` });
      const hasSubmitted = existingComponents.some(r => {
        const val = r.value as { status?: string };
        return val.status === 'ready' || val.status === 'registered';
      });
      if (hasSubmitted) {
        res.status(409).json(error(config.nodeId, 'BLUEPRINT_LOCKED', 'Cannot overwrite blueprint — components have already been submitted. Delete components first or create a new project.'));
        return;
      }

      const updatedProject = {
        ...(projectRec.value as Record<string, unknown>),
        blueprint: validation.extracted ?? blueprint,
        status: 'blueprint_ready',
        updatedAt: now,
      };
      await storage.setMemory({ ...projectRec, value: updatedProject, version: (projectRec.version ?? 1) + 1, updatedAt: now });

      // Initialize component records from blueprint — same as frontend handleSubmitBlueprint().
      // This ensures the sidebar shows components immediately when agent submits blueprint.
      const parsed = typeof (validation.extracted ?? blueprint) === 'string'
        ? JSON.parse(validation.extracted ?? blueprint)
        : (validation.extracted ?? blueprint);
      const bpComponents = (parsed as { components?: Array<{ id: string; type: string; label: string }> }).components ?? [];
      for (const comp of bpComponents) {
        const compKey = `generator.${projectId}.component.${comp.id}`;
        const existing = await storage.getMemory(gaii, compKey);
        if (!existing) {
          await storage.setMemory({
            key: compKey,
            ownerGaii: gaii,
            value: { id: comp.id, type: comp.type, label: comp.label, status: 'not_started', prompt: null, result: null, validationErrors: [], registeredAs: null, history: [] },
            visibility: 'owner',
            version: 1,
            tags: ['generator', 'component', comp.type],
            ttlHours: null,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      res.json(success(config.nodeId, { valid: true, errors: [], warnings: validation.warnings ?? [] }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/components/:componentId/submit — validate + store component content
  router.post('/v1/generator/:projectId/components/:componentId/submit',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const { type, content } = req.body ?? {};

      if (!type || !VALID_COMPONENT_TYPES.includes(type as ComponentType)) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', `type must be one of: ${VALID_COMPONENT_TYPES.join(', ')}`));
        return;
      }
      if (!content || typeof content !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'content string is required'));
        return;
      }

      // Blueprint is REQUIRED before submitting components
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      const blueprint = (projectRec?.value as any)?.blueprint;
      if (!blueprint) {
        res.status(400).json(error(config.nodeId, 'NO_BLUEPRINT', 'Blueprint must be submitted before components'));
        return;
      }
      if (blueprint.components && !blueprint.components.some((c: any) => c.id === componentId)) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Component "${componentId}" not in blueprint`));
        return;
      }

      const validation = validateComponent(type as ComponentType, content);

      if (!validation.valid) {
        // Return errors for agent to correct — do NOT write to memory
        const errors = validation.errors ?? [];
        res.status(422).json(error(config.nodeId, 'VALIDATION_FAILED', errors.join('; ')));
        return;
      }

      // Write validated component to memory
      const now = new Date().toISOString();
      const existingRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      if (existingRec) {
        const existingStatus = (existingRec.value as { status?: string })?.status;
        if (existingStatus === 'registered') {
          res.status(409).json(error(config.nodeId, 'ALREADY_REGISTERED', 'Component is already registered. Cannot re-submit.'));
          return;
        }
      }
      const newVersion = existingRec ? existingRec.version + 1 : 1;

      const extractedContent = typeof validation.extracted === 'string'
        ? validation.extracted
        : JSON.stringify(validation.extracted);

      // Merge with existing record to preserve frontend fields (id, label, prompt, history, etc.)
      const existingValue = (existingRec?.value ?? {}) as Record<string, unknown>;
      // Resolve label from blueprint if not in existing record
      const bpComp = blueprint.components?.find((c: { id: string }) => c.id === componentId);
      const mergedValue = {
        ...existingValue,
        id: componentId,
        label: existingValue.label || bpComp?.label || componentId,
        type,
        result: extractedContent,
        content: extractedContent,
        status: 'ready',
        submittedAt: now,
      };

      await storage.setMemory({
        key: `generator.${projectId}.component.${componentId}`,
        ownerGaii: gaii,
        value: mergedValue,
        visibility: 'owner',
        version: newVersion,
        tags: ['generator', 'component', type as string],
        ttlHours: null,
        createdAt: existingRec?.createdAt ?? now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, {
        valid: true,
        errors: [],
        warnings: validation.warnings ?? [],
        extracted: validation.extracted,
      }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/components/:componentId/register — register a validated component into the AIMEAT catalogue
  router.post('/v1/generator/:projectId/components/:componentId/register',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;

      const componentRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      if (!componentRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Component not found — submit content first'));
        return;
      }

      const component = componentRec.value as { type: ComponentType; content: string; status: string };
      if (component.status !== 'ready') {
        res.status(400).json(error(config.nodeId, 'NOT_READY', 'Component must be in "ready" status before registration'));
        return;
      }

      // For registration, resolve owner from auth (works for both owner and agent sessions)
      const ownerName = req.auth!.owner;
      const regGhii = `${ownerName}@${config.nodeId}`;

      try {
        switch (component.type) {
          case 'csm': await registerCsm(component.content, ownerName, storage); break;
          case 'msm': await registerMsm(component.content, ownerName, storage); break;
          case 'extension': await registerExtension(component.content, ownerName, regGhii, storage, config.maxExtensionsPerOwner); break;
          case 'app': await registerApp(component.content, ownerName, regGhii, storage); break;
          case 'memory':
          case 'translation':
          case 'cortex':
            // No catalogue registration needed — stored in generator memory keys only
            break;
          default:
            res.status(400).json(error(config.nodeId, 'UNSUPPORTED_TYPE', `Registration not supported for type: ${component.type as string}`));
            return;
        }

        const now = new Date().toISOString();
        await storage.setMemory({
          ...componentRec,
          value: { ...component, status: 'registered', registeredAt: now },
          version: (componentRec.version ?? 1) + 1,
          updatedAt: now,
        });
        res.json(success(config.nodeId, { registered: true, componentId }));
        emitChange('memory');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json(error(config.nodeId, 'REGISTRATION_ERROR', msg));
      }
    }
  );

  // POST /v1/generator/:projectId/log — write log entry to memory
  router.post('/v1/generator/:projectId/log',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { level, message, componentId, meta } = req.body ?? {};

      if (!level || typeof level !== 'string' || !message || typeof message !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'level and message are required strings'));
        return;
      }
      if (!['info', 'warn', 'error'].includes(level)) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'level must be info, warn, or error'));
        return;
      }
      if (meta != null && typeof meta !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'meta must be an object or null'));
        return;
      }

      const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      await storage.setMemory({
        key: `generator.${projectId}.logs.${logId}`,
        ownerGaii: gaii,
        value: { logId, level, message, componentId: componentId ?? null, meta: meta ?? null, timestamp: now },
        visibility: 'owner',
        version: 1,
        tags: ['generator', 'log'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { logged: true, logId }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/complete — mark project active, release session
  router.post('/v1/generator/:projectId/complete',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Guard: require at least one registered component before marking complete
      const componentRecords = await storage.listMemory(gaii, { prefix: `generator.${projectId}.component.` });
      const registeredCount = componentRecords.filter(r => {
        const val = r.value as { status?: string };
        return val.status === 'registered';
      }).length;

      if (registeredCount === 0) {
        res.status(400).json(error(config.nodeId, 'NO_COMPONENTS', 'Cannot complete project — no components have been registered. Generate and register components first.'));
        return;
      }

      const now = new Date().toISOString();
      await storage.setMemory({
        ...projectRec,
        value: {
          ...(projectRec.value as Record<string, unknown>),
          status: 'active',
          completedAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      });

      // Release session if it exists
      await storage.deleteMemory(gaii, `generator.${projectId}.session`);

      res.json(success(config.nodeId, { status: 'active', registeredComponents: registeredCount }));
      emitChange('memory');
    }
  );

  // GET /v1/generator/:projectId/prompts/:componentId — get the generation prompt for a component
  // Returns the SAME prompt that the UI gives to users, with full context (blueprint, completed components, interview spec).
  router.get('/v1/generator/:projectId/prompts/:componentId',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;

      // Load project state
      const [projectRec, interviewRec] = await Promise.all([
        storage.getMemory(gaii, `generator.${projectId}.project`),
        storage.getMemory(gaii, `generator.${projectId}.interview-spec`),
      ]);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const project = projectRec.value as { blueprint?: { components?: Array<{ id: string; type: string; label: string }>; dataModel?: Record<string, unknown> }; description?: string };
      const interviewSpec = interviewRec?.value ?? null;
      const blueprint = project.blueprint;

      if (!blueprint?.components) {
        res.status(400).json(error(config.nodeId, 'NO_BLUEPRINT', 'Blueprint not yet submitted'));
        return;
      }

      const component = blueprint.components.find((c: { id: string }) => c.id === componentId);
      if (!component) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Component "${componentId}" not in blueprint`));
        return;
      }

      // Load completed components for context
      const allComponentRecords = await storage.listMemory(gaii, { prefix: `generator.${projectId}.component.` });
      const completedComponents = allComponentRecords
        .filter(r => {
          const val = r.value as { status?: string };
          return val.status === 'registered' || val.status === 'ready';
        })
        .map(r => r.value);

      // Build the same prompt that UI shows to users
      const prompt = buildComponentPrompt(
        component.type,
        component.label,
        project.description || '',
        blueprint,
        completedComponents,
        interviewSpec,
      );

      res.json(success(config.nodeId, {
        componentId,
        type: component.type,
        label: component.label,
        prompt,
      }));
    }
  );

  // GET /v1/generator/:projectId/prompts — get the blueprint generation prompt
  router.get('/v1/generator/:projectId/prompts',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const [projectRec, interviewRec] = await Promise.all([
        storage.getMemory(gaii, `generator.${projectId}.project`),
        storage.getMemory(gaii, `generator.${projectId}.interview-spec`),
      ]);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const project = projectRec.value as { description?: string };
      const interviewSpec = interviewRec?.value ?? null;

      const prompt = buildBlueprintPrompt(project.description || '', interviewSpec);

      res.json(success(config.nodeId, { prompt }));
    }
  );

  return router;
}
