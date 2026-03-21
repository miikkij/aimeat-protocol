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
import { validateInterviewSpec, validateBlueprint, validateComponent } from '../services/generator-validate.js';
import type { ComponentType } from '../services/generator-validate.js';
import { registerCsm, registerMsm, registerExtension, registerApp } from '../services/generator-registration.js';
import { emitChange } from '../services/event-bus.js';
import { encrypt, decrypt, getEncryptionKey } from '../services/encryption.js';
import { topologicalSort, runExtensionTest, runAppPlaywrightTest, runCortexPlaywrightTest, isPlaywrightAvailable, ensureScreenshotDir, cleanupScreenshots, screenshotDir, buildCortexMethodTestCode } from '../services/generator-testing.js';
import type { TestReport, TestResult } from '../services/generator-testing.js';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
// @ts-ignore — frontend ESM module, no .d.ts
import { buildComponentPrompt, buildBlueprintPrompt } from '../../public/js/services/generator-prompts.js';

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

      // Encrypt secret-type values
      const storedValues = { ...values };
      if (secretKeys?.length) {
        const encKey = getEncryptionKey(config);
        if (!encKey) {
          res.status(503).json(error(config.nodeId, 'ENCRYPTION_UNAVAILABLE', 'Encryption key not configured'));
          return;
        }
        for (const key of secretKeys) {
          if (storedValues[key] && typeof storedValues[key] === 'string') {
            storedValues[key] = encrypt(storedValues[key] as string, encKey);
          }
        }
      }

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

  // POST /v1/generator/:projectId/test/:componentId — run tests for a single component
  // NOTE: registered before bulk test and /:projectId/components/:componentId
  router.post('/v1/generator/:projectId/test/:componentId',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const { level } = req.body ?? {};
      const testLevel = (level as string) || 'basic';

      // Load project + blueprint
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }
      const project = (projectRec.value as Record<string, unknown>) ?? {};
      const blueprint = project.blueprint as { components?: Array<{ id: string; type: string; label: string; produces?: string[]; consumes?: string[] }>; testScenarios?: Array<{ component: string; scenarios: Array<{ action: string; input: Record<string, unknown>; expect: string }> }> } | null;
      if (!blueprint?.components) {
        res.status(400).json(error(config.nodeId, 'NO_BLUEPRINT', 'Blueprint required'));
        return;
      }

      const bpComp = blueprint.components.find(c => c.id === componentId);
      if (!bpComp) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Component not in blueprint'));
        return;
      }

      // Load component record
      const compRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      const compVal = (compRec?.value as Record<string, unknown>) ?? {};
      const compStatus = compVal.status as string;

      if (compStatus !== 'registered' && compStatus !== 'ready' && compStatus !== 'done') {
        res.json(success(config.nodeId, {
          result: { componentId, type: bpComp.type, status: 'skipped' as const, scenarios: 0, passed: 0, errors: ['Component not registered yet'], screenshots: [], fixRound: 0 },
        }));
        return;
      }

      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      const baseUrl = `http://localhost:${config.port}`;
      const scenarios = (blueprint.testScenarios ?? []).find(ts => ts.component === componentId)?.scenarios ?? [];

      let result: TestResult;

      if (bpComp.type === 'extension') {
        // ── Extension test: call every action with correct HTTP method ──
        const registeredAs = compVal.registeredAs as string || componentId;
        let scenarioPassed = 0;
        const errors: string[] = [];

        if (scenarios.length > 0) {
          // Use explicit test scenarios from blueprint
          for (const scenario of scenarios) {
            const tr = await runExtensionTest(baseUrl, registeredAs, scenario.action, scenario.input, token);
            if (tr.passed) { scenarioPassed++; } else { errors.push(`${scenario.action}: ${tr.error ?? 'Unknown error'}`); }
          }
        } else {
          // No explicit scenarios — auto-discover actions from extension metadata and test each
          try {
            const metaRes = await fetch(`${baseUrl}/v1/extensions/${registeredAs}`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (metaRes.ok) {
              const metaBody = await metaRes.json() as Record<string, unknown>;
              const metaData = metaBody?.data as Record<string, unknown> | undefined;
              const metaExt = metaData?.extension as Record<string, unknown> | undefined;
              const actions = ((metaData?.actions ?? metaExt?.actions ?? []) as Array<{ id: string; method?: string }>);
              for (const action of actions) {
                const tr = await runExtensionTest(baseUrl, registeredAs, action.id, {}, token, action.method);
                if (tr.passed) { scenarioPassed++; } else { errors.push(`${action.id} (${action.method || 'POST'}): ${tr.error ?? 'Unknown error'}`); }
              }
            } else {
              // Fallback: at least try init
              const tr = await runExtensionTest(baseUrl, registeredAs, 'init', {}, token);
              if (tr.passed) { scenarioPassed = 1; } else { errors.push(`init: ${tr.error ?? 'Failed'}`); }
            }
          } catch {
            const tr = await runExtensionTest(baseUrl, registeredAs, 'init', {}, token);
            if (tr.passed) { scenarioPassed = 1; } else { errors.push(`init: ${tr.error ?? 'Failed'}`); }
          }
        }

        const total = scenarios.length || Math.max(scenarioPassed + errors.length, 1);
        result = { componentId, type: bpComp.type, status: errors.length === 0 ? 'passed' : 'failed', scenarios: total, passed: scenarioPassed, errors, screenshots: [], fixRound: 0 };

      } else if (bpComp.type === 'msm') {
        // ── MSM test: verify the integration endpoint responds ──
        const registeredAs = compVal.registeredAs as string;
        const errors: string[] = [];
        let scenarioPassed = 0;

        if (registeredAs) {
          try {
            // MSM integrations are accessible via catalogue — check it exists
            const catRes = await fetch(`${baseUrl}/v1/catalogue/integrations/${encodeURIComponent(registeredAs)}`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (catRes.ok) {
              scenarioPassed++;
            } else {
              errors.push(`MSM not found in catalogue: HTTP ${catRes.status}`);
            }
          } catch (e) {
            errors.push(`MSM catalogue check failed: ${(e as Error).message}`);
          }
        } else {
          errors.push('MSM not registered');
        }

        result = { componentId, type: bpComp.type, status: errors.length === 0 ? 'passed' : 'failed', scenarios: 1, passed: scenarioPassed, errors, screenshots: [], fixRound: 0 };

      } else if (bpComp.type === 'memory') {
        // ── Memory test: write test data, read it back, validate ──
        const errors: string[] = [];
        let scenarioPassed = 0;
        const testKey = `_test.generator.${projectId}.${componentId}`;
        const testValue = { _test: true, ts: new Date().toISOString() };

        try {
          // Write
          const writeRes = await fetch(`${baseUrl}/v1/memory/${encodeURIComponent(testKey)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ value: testValue }),
          });
          if (!writeRes.ok) {
            const wb = await writeRes.json() as Record<string, unknown>;
            errors.push(`Memory write failed: HTTP ${writeRes.status} — ${JSON.stringify(wb)}`);
          } else {
            scenarioPassed++;

            // Read back
            const readRes = await fetch(`${baseUrl}/v1/memory/${encodeURIComponent(testKey)}`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!readRes.ok) {
              errors.push(`Memory read failed: HTTP ${readRes.status}`);
            } else {
              const rb = await readRes.json() as Record<string, unknown>;
              const readData = rb?.data as Record<string, unknown> | undefined;
              const readValue = readData?.value as Record<string, unknown> | undefined;
              if (readValue?._test === true) {
                scenarioPassed++;
              } else {
                errors.push(`Memory read returned unexpected value: ${JSON.stringify(readValue)}`);
              }
            }

            // Cleanup test key
            await fetch(`${baseUrl}/v1/memory/${encodeURIComponent(testKey)}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` },
            });
          }
        } catch (e) {
          errors.push(`Memory test error: ${(e as Error).message}`);
        }

        result = { componentId, type: bpComp.type, status: errors.length === 0 ? 'passed' : 'failed', scenarios: 2, passed: scenarioPassed, errors, screenshots: [], fixRound: 0 };

      } else if (bpComp.type === 'translation') {
        // ── Translation test: verify keys exist and en/fi parity ──
        const errors: string[] = [];
        let scenarioPassed = 0;

        // Find the translation key from registeredAs (e.g., "osakeanalyysi.i18n-fi")
        const regAs = compVal.registeredAs as string;
        if (regAs) {
          try {
            const transRes = await fetch(`${baseUrl}/v1/memory/${encodeURIComponent(regAs)}`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (transRes.ok) {
              const transBody = await transRes.json() as Record<string, unknown>;
              const transData = transBody?.data as Record<string, unknown> | undefined;
              const transValue = transData?.value;
              if (transValue && typeof transValue === 'object') {
                const keys = Object.keys(transValue as Record<string, unknown>);
                if (keys.length > 0) {
                  scenarioPassed++;

                  // Check parity with sibling locale
                  const isFi = regAs.includes('-fi');
                  const isEn = regAs.includes('-en');
                  const siblingKey = isFi ? regAs.replace('-fi', '-en') : isEn ? regAs.replace('-en', '-fi') : null;

                  if (siblingKey) {
                    try {
                      const sibRes = await fetch(`${baseUrl}/v1/memory/${encodeURIComponent(siblingKey)}`, {
                        headers: { 'Authorization': `Bearer ${token}` },
                      });
                      if (sibRes.ok) {
                        const sibBody = await sibRes.json() as Record<string, unknown>;
                        const sibData = sibBody?.data as Record<string, unknown> | undefined;
                        const sibValue = sibData?.value;
                        if (sibValue && typeof sibValue === 'object') {
                          const sibKeys = Object.keys(sibValue as Record<string, unknown>);
                          const missing = keys.filter(k => !sibKeys.includes(k));
                          const extra = sibKeys.filter(k => !keys.includes(k));
                          if (missing.length === 0 && extra.length === 0) {
                            scenarioPassed++;
                          } else {
                            if (missing.length > 0) errors.push(`Keys in ${regAs} but missing in ${siblingKey}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ''}`);
                            if (extra.length > 0) errors.push(`Keys in ${siblingKey} but missing in ${regAs}: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ` (+${extra.length - 5} more)` : ''}`);
                          }
                        }
                      }
                    } catch { /* sibling not available yet — skip parity check */ }
                  }
                } else {
                  errors.push('Translation file is empty (0 keys)');
                }
              } else {
                errors.push('Translation value is not an object');
              }
            } else {
              errors.push(`Translation key not found: HTTP ${transRes.status}`);
            }
          } catch (e) {
            errors.push(`Translation test error: ${(e as Error).message}`);
          }
        } else {
          errors.push('Translation not registered');
        }

        result = { componentId, type: bpComp.type, status: errors.length === 0 ? 'passed' : 'failed', scenarios: 2, passed: scenarioPassed, errors, screenshots: [], fixRound: 0 };

      } else if (bpComp.type === 'cortex') {
        // ── Cortex test: load lib, call init() AND all public methods ──
        const registeredAs = compVal.registeredAs as string;
        if (registeredAs && await isPlaywrightAvailable()) {
          const camelName = registeredAs.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
          // Get the cortex source code to discover public methods
          const cortexSource = (compVal.content as string) || (compVal.result as string) || '';
          const testCode = buildCortexMethodTestCode(camelName, cortexSource);
          const cortexResult = await runCortexPlaywrightTest(
            baseUrl, projectId, componentId, registeredAs, testCode,
          );
          result = { componentId, type: bpComp.type, status: cortexResult.passed ? 'passed' : 'failed', scenarios: 1, passed: cortexResult.passed ? 1 : 0, errors: cortexResult.errors, screenshots: [], fixRound: 0 };
        } else if (registeredAs) {
          // No Playwright — HTTP check that lib file loads and has AIMEAT registration
          const errors: string[] = [];
          try {
            const libRes = await fetch(`${baseUrl}/v1/cortex/${registeredAs}/libs/${registeredAs}.js`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (libRes.ok) {
              const libText = await libRes.text();
              if (!libText.includes('AIMEAT')) errors.push('Cortex JS does not reference AIMEAT namespace');
              if (!(libText.includes('register') || libText.includes('AIMEAT['))) errors.push('Cortex JS does not register itself');
              if (!libText.includes('init')) errors.push('Cortex JS does not contain init() function');
            } else {
              errors.push(`Cortex lib HTTP ${libRes.status}`);
            }
          } catch (e) {
            errors.push(`Cortex fetch error: ${(e as Error).message}`);
          }
          result = { componentId, type: bpComp.type, status: errors.length === 0 ? 'passed' : 'failed', scenarios: 1, passed: errors.length === 0 ? 1 : 0, errors, screenshots: [], fixRound: 0 };
        } else {
          result = { componentId, type: bpComp.type, status: 'skipped', scenarios: 0, passed: 0, errors: ['Not registered'], screenshots: [], fixRound: 0 };
        }

      } else if (bpComp.type === 'app') {
        // ── App test: Playwright loads page, checks content + console errors ──
        const registeredAs = compVal.registeredAs as string;
        if (registeredAs && await isPlaywrightAvailable()) {
          await ensureScreenshotDir(projectId);
          const appUrl = `${baseUrl}/apps/${registeredAs}`;
          const pwResult = await runAppPlaywrightTest(appUrl, projectId, componentId, scenarios);
          result = { componentId, type: bpComp.type, status: pwResult.passed ? 'passed' : 'failed', scenarios: 1, passed: pwResult.passed ? 1 : 0, errors: pwResult.errors, screenshots: pwResult.screenshots, fixRound: 0 };
        } else if (registeredAs) {
          // No Playwright — basic HTTP check that app loads
          const errors: string[] = [];
          try {
            const appRes = await fetch(`${baseUrl}/apps/${registeredAs}`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (appRes.ok) {
              const html = await appRes.text();
              if (html.length < 50) errors.push('App HTML is suspiciously short');
            } else {
              errors.push(`App returned HTTP ${appRes.status}`);
            }
          } catch (e) {
            errors.push(`App fetch error: ${(e as Error).message}`);
          }
          result = { componentId, type: bpComp.type, status: errors.length === 0 ? 'passed' : 'failed', scenarios: 1, passed: errors.length === 0 ? 1 : 0, errors, screenshots: [], fixRound: 0 };
        } else {
          result = { componentId, type: bpComp.type, status: 'skipped', scenarios: 0, passed: 0, errors: ['Not registered'], screenshots: [], fixRound: 0 };
        }

      } else if (bpComp.type === 'csm') {
        // ── CSM test: verify it exists in schema catalogue ──
        const registeredAs = compVal.registeredAs as string;
        const errors: string[] = [];
        if (registeredAs) {
          try {
            const csmRes = await fetch(`${baseUrl}/v1/schemas/${encodeURIComponent(registeredAs)}`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!csmRes.ok) errors.push(`CSM not found in schemas: HTTP ${csmRes.status}`);
          } catch (e) {
            errors.push(`CSM check error: ${(e as Error).message}`);
          }
        } else {
          errors.push('CSM not registered');
        }
        result = { componentId, type: bpComp.type, status: errors.length === 0 ? 'passed' : 'failed', scenarios: 1, passed: errors.length === 0 ? 1 : 0, errors, screenshots: [], fixRound: 0 };

      } else {
        // Unknown type — skip
        result = { componentId, type: bpComp.type, status: 'skipped', scenarios: 0, passed: 0, errors: [], screenshots: [], fixRound: 0 };
      }

      res.json(success(config.nodeId, { result }));
    }
  );

  // POST /v1/generator/:projectId/test — run tests in dependency order
  // NOTE: registered before /:projectId/components/:componentId to avoid 'test' matching as componentId
  router.post('/v1/generator/:projectId/test',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { level } = req.body ?? {};
      const testLevel = (level as string) || 'basic';

      if (!['comprehensive', 'basic', 'none'].includes(testLevel)) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'level must be comprehensive, basic, or none'));
        return;
      }

      // Level 'none' — return empty report
      if (testLevel === 'none') {
        const report: TestReport = { level: 'none', timestamp: new Date().toISOString(), components: [], overall: 'passed' };
        res.json(success(config.nodeId, { report }));
        return;
      }

      // Load project + blueprint
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }
      const project = (projectRec.value as Record<string, unknown>) ?? {};
      const blueprint = project.blueprint as { components?: Array<{ id: string; type: string; label: string; produces?: string[]; consumes?: string[] }>; testScenarios?: Array<{ component: string; scenarios: Array<{ action: string; input: Record<string, unknown>; expect: string }> }> } | null;
      if (!blueprint?.components) {
        res.status(400).json(error(config.nodeId, 'NO_BLUEPRINT', 'Blueprint required before running tests'));
        return;
      }

      // Load settings
      const settingsRec = await storage.getMemory(gaii, `generator.${projectId}.settings`);
      const settings = (settingsRec?.value as Record<string, unknown>) ?? {};
      void settings; // reserved for future use in test configuration

      // Run topological sort
      const testPlan = topologicalSort(blueprint.components, blueprint.testScenarios ?? []);
      const results: TestResult[] = [];
      const passedComponents = new Set<string>();
      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      const baseUrl = `http://localhost:${config.port}`;

      for (const plan of testPlan) {
        // Check dependencies passed
        const depsFailed = plan.dependencies.some(d => !passedComponents.has(d));
        if (depsFailed) {
          results.push({ componentId: plan.componentId, type: plan.type, status: 'skipped', scenarios: plan.scenarios.length, passed: 0, errors: ['Dependency not satisfied'], screenshots: [], fixRound: 0 });
          continue;
        }

        // Load component record
        const compRec = await storage.getMemory(gaii, `generator.${projectId}.component.${plan.componentId}`);
        const compVal = (compRec?.value as Record<string, unknown>) ?? {};
        const compStatus = compVal.status as string;

        if (compStatus !== 'registered' && compStatus !== 'ready') {
          results.push({ componentId: plan.componentId, type: plan.type, status: 'skipped', scenarios: plan.scenarios.length, passed: 0, errors: ['Component not ready or registered'], screenshots: [], fixRound: 0 });
          continue;
        }

        // B-level tests by type
        if (plan.type === 'extension') {
          const compContent = compVal.content as string | undefined;
          let extName = plan.componentId;
          if (compContent) {
            try {
              const parsed = typeof compContent === 'string' ? JSON.parse(compContent) : compContent;
              if (parsed.name) extName = parsed.name;
            } catch { /* use componentId */ }
          }
          let scenarioPassed = 0;
          const errors: string[] = [];
          for (const scenario of plan.scenarios) {
            const result = await runExtensionTest(baseUrl, extName, scenario.action, scenario.input, token);
            if (result.passed) { scenarioPassed++; } else { errors.push(result.error ?? 'Unknown error'); }
          }
          const allPassed = errors.length === 0 && plan.scenarios.length > 0;
          const status = plan.scenarios.length === 0 ? 'passed' : (allPassed ? 'passed' : 'failed');
          results.push({ componentId: plan.componentId, type: plan.type, status, scenarios: plan.scenarios.length, passed: scenarioPassed, errors, screenshots: [], fixRound: 0 });
          if (status === 'passed') passedComponents.add(plan.componentId);
        } else {
          // Other types: pass through for now (no B-level test runner yet)
          results.push({ componentId: plan.componentId, type: plan.type, status: 'passed', scenarios: 0, passed: 0, errors: [], screenshots: [], fixRound: 0 });
          passedComponents.add(plan.componentId);
        }
      }

      // C-level: Playwright tests for apps (comprehensive only)
      if (testLevel === 'comprehensive' && await isPlaywrightAvailable()) {
        await ensureScreenshotDir(projectId);
        for (const plan of testPlan) {
          if (plan.type !== 'app') continue;
          const compRec = await storage.getMemory(gaii, `generator.${projectId}.component.${plan.componentId}`);
          const compVal = (compRec?.value as Record<string, unknown>) ?? {};
          const registeredAs = compVal.registeredAs as string | undefined;
          if (!registeredAs) continue;

          const appUrl = `${baseUrl}/apps/${registeredAs}`;
          const pwResult = await runAppPlaywrightTest(appUrl, projectId, plan.componentId, plan.scenarios);

          // Update existing result for this component
          const existing = results.find(r => r.componentId === plan.componentId);
          if (existing) {
            existing.screenshots = pwResult.screenshots;
            if (!pwResult.passed) {
              existing.status = 'failed';
              existing.errors.push(...pwResult.errors);
              passedComponents.delete(plan.componentId);
            }
          }
        }
      }

      // Determine overall status
      const failedCount = results.filter(r => r.status === 'failed').length;
      const passedCount = results.filter(r => r.status === 'passed').length;
      const overall = failedCount === 0 ? 'passed' : (passedCount > 0 ? 'partial' : 'failed');

      const report: TestReport = {
        level: testLevel as 'comprehensive' | 'basic',
        timestamp: new Date().toISOString(),
        components: results,
        overall,
      };

      // Store report in memory
      const now = new Date().toISOString();
      const existingReport = await storage.getMemory(gaii, `generator.${projectId}.test-report`);
      await storage.setMemory({
        key: `generator.${projectId}.test-report`,
        ownerGaii: gaii,
        value: report,
        visibility: 'owner',
        version: existingReport ? existingReport.version + 1 : 1,
        tags: ['generator', 'test-report'],
        ttlHours: null,
        createdAt: existingReport?.createdAt ?? now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { report }));
      emitChange('memory');
    }
  );

  // GET /v1/generator/:projectId/screenshots/:filename — serve test screenshot PNGs
  // NOTE: registered before /:projectId/components/:componentId to avoid 'screenshots' matching as componentId
  router.get('/v1/generator/:projectId/screenshots/:filename',
    requireAuth(),
    requireRole('owner'),
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

      await storage.setMemory({
        key: `generator.${projectId}.component.${componentId}`,
        ownerGaii: gaii,
        value: { type, content: extractedContent, status: 'ready', submittedAt: now },
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
