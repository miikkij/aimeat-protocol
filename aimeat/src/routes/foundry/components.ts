/**
 * @file src/routes/foundry/components.ts
 * @description Foundry blueprint + component routes: validate/store blueprint, submit/register components into the catalogue, log entries, mark complete, and serve generation prompts. Extracted from src/routes/foundry.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/foundry.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { validateBlueprint, validateComponent } from '../../services/foundry-validate.js';
import type { ComponentType } from '../../services/foundry-validate.js';
import { registerCsm, registerMsm, registerExtension, registerApp } from '../../services/foundry-registration.js';
import { emitChange } from '../../services/event-bus.js';
// @ts-expect-error — frontend ESM module, no .d.ts
import { buildComponentPrompt, buildBlueprintPrompt } from '../../../public/js/services/generator-prompts.js';

export function registerComponentRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const VALID_COMPONENT_TYPES: ComponentType[] = ['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'];

  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;

  // POST /v1/foundry/:projectId/steps/blueprint — validate + store blueprint
  // NOTE: registered before /:projectId/components/:componentId/submit to prevent 'steps' matching as componentId
  router.post('/v1/foundry/:projectId/steps/blueprint',
    requireAuth(),
    requireRole('agent'),
    requireScope('foundry:write'),
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
      const projectRec = await storage.getMemory(gaii, `foundry.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Guard: prevent blueprint overwrite if components have been submitted
      const existingComponents = await storage.listMemory(gaii, { prefix: `foundry.${projectId}.component.` });
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
        const compKey = `foundry.${projectId}.component.${comp.id}`;
        const existing = await storage.getMemory(gaii, compKey);
        if (!existing) {
          await storage.setMemory({
            key: compKey,
            ownerGaii: gaii,
            value: { id: comp.id, type: comp.type, label: comp.label, status: 'not_started', prompt: null, result: null, validationErrors: [], registeredAs: null, history: [] },
            visibility: 'owner',
            version: 1,
            tags: ['foundry', 'component', comp.type],
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

  // POST /v1/foundry/:projectId/components/:componentId/submit — validate + store component content
  router.post('/v1/foundry/:projectId/components/:componentId/submit',
    requireAuth(),
    requireRole('agent'),
    requireScope('foundry:write'),
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
      const projectRec = await storage.getMemory(gaii, `foundry.${projectId}.project`);
      const blueprint = (projectRec?.value as { blueprint?: { components?: Array<{ id?: string; label?: string }> } })?.blueprint;
      if (!blueprint) {
        res.status(400).json(error(config.nodeId, 'NO_BLUEPRINT', 'Blueprint must be submitted before components'));
        return;
      }
      if (blueprint.components && !blueprint.components.some((c) => c.id === componentId)) {
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
      const existingRec = await storage.getMemory(gaii, `foundry.${projectId}.component.${componentId}`);
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
      const bpComp = blueprint.components?.find((c) => c.id === componentId);
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
        key: `foundry.${projectId}.component.${componentId}`,
        ownerGaii: gaii,
        value: mergedValue,
        visibility: 'owner',
        version: newVersion,
        tags: ['foundry', 'component', type as string],
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

  // POST /v1/foundry/:projectId/components/:componentId/register — register a validated component into the AIMEAT catalogue
  router.post('/v1/foundry/:projectId/components/:componentId/register',
    requireAuth(),
    requireRole('agent'),
    requireScope('foundry:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;

      const componentRec = await storage.getMemory(gaii, `foundry.${projectId}.component.${componentId}`);
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
            // No catalogue registration needed — stored in foundry memory keys only
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

  // POST /v1/foundry/:projectId/log — write log entry to memory
  router.post('/v1/foundry/:projectId/log',
    requireAuth(),
    requireRole('agent'),
    requireScope('foundry:execute'),
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
        key: `foundry.${projectId}.logs.${logId}`,
        ownerGaii: gaii,
        value: { logId, level, message, componentId: componentId ?? null, meta: meta ?? null, timestamp: now },
        visibility: 'owner',
        version: 1,
        tags: ['foundry', 'log'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { logged: true, logId }));
      emitChange('memory');
    }
  );

  // POST /v1/foundry/:projectId/complete — mark project active, release session
  router.post('/v1/foundry/:projectId/complete',
    requireAuth(),
    requireRole('agent'),
    requireScope('foundry:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const projectRec = await storage.getMemory(gaii, `foundry.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Guard: require at least one registered component before marking complete
      const componentRecords = await storage.listMemory(gaii, { prefix: `foundry.${projectId}.component.` });
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
      await storage.deleteMemory(gaii, `foundry.${projectId}.session`);

      res.json(success(config.nodeId, { status: 'active', registeredComponents: registeredCount }));
      emitChange('memory');
    }
  );

  // GET /v1/foundry/:projectId/prompts/:componentId — get the generation prompt for a component
  // Returns the SAME prompt that the UI gives to users, with full context (blueprint, completed components, interview spec).
  router.get('/v1/foundry/:projectId/prompts/:componentId',
    requireAuth(),
    requireRole('agent'),
    requireScope('foundry:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;

      // Load project state
      const [projectRec, interviewRec] = await Promise.all([
        storage.getMemory(gaii, `foundry.${projectId}.project`),
        storage.getMemory(gaii, `foundry.${projectId}.interview-spec`),
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
      const allComponentRecords = await storage.listMemory(gaii, { prefix: `foundry.${projectId}.component.` });
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

  // GET /v1/foundry/:projectId/prompts — get the blueprint generation prompt
  router.get('/v1/foundry/:projectId/prompts',
    requireAuth(),
    requireRole('agent'),
    requireScope('foundry:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const [projectRec, interviewRec] = await Promise.all([
        storage.getMemory(gaii, `foundry.${projectId}.project`),
        storage.getMemory(gaii, `foundry.${projectId}.interview-spec`),
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
}
