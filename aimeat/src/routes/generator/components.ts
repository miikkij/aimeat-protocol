/**
 * @file src/routes/generator/components.ts
 * @description Generator blueprint + component routes — validate/store blueprint, component spec,
 *   component submit, catalogue registration, reset, log, and project complete. Extracted from
 *   src/routes/generator.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/generator.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { validateBlueprint, validateComponent } from '../../services/generator-validate.js';
import type { ComponentType } from '../../services/generator-validate.js';
import { registerCsm, registerMsm, registerExtension, registerApp, registerCortex } from '../../services/generator-registration.js';
import { emitChange } from '../../services/event-bus.js';
import { validateExtensionSpec, validateDataApiSpec, validateComponentSpec, validateAppDomainSpec, validateAppSpec } from '../../services/generator-prompts/index.js';
import type { Blueprint } from '../../services/generator-prompts/types.js';

export function registerComponentRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  ownerGhii: (req: Express.Request) => string,
): void {
  const VALID_COMPONENT_TYPES: ComponentType[] = ['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'];

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
        return val.status === 'ready' || val.status === 'registered' || val.status === 'done';
      });
      if (hasSubmitted) {
        res.status(409).json(error(config.nodeId, 'BLUEPRINT_LOCKED', 'Cannot overwrite blueprint — components have already been submitted. Delete components first or create a new project.'));
        return;
      }

      const updatedProject = {
        ...(projectRec.value as Record<string, unknown>),
        blueprint: validation.parsed ?? validation.extracted ?? blueprint,  // store the PARSED object — every downstream route reads blueprint.components directly (not a JSON string)
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
  // POST /v1/generator/:projectId/components/:componentId/spec — store a component's formal spec
  // (the spec-first step for extension/cortex/app). The code prompt reads it back as
  // selfSpec / extensionSpec / dataApiSpec. Mirrors the browser saveSpec() but server-side under
  // the owner GHII, so the agent/API path can do spec-first exactly like the UI.
  router.post('/v1/generator/:projectId/components/:componentId/spec',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const { spec } = req.body ?? {};

      if (!spec || typeof spec !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'spec object is required'));
        return;
      }

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // VALIDATE the spec BEFORE storing it. The browser blocks invalid specs client-side
      // (generator-detail.js runs the .js validators and only reveals "Save Spec" when valid); the
      // agent path has no such gate, so we run the SAME validators here — generator-prompts/
      // spec-validate.ts is a byte-for-byte port of public/js/services/generator-spec-validate.js —
      // and dispatch the SAME way the spec-PROMPT route picks the prompt, so the validator matches
      // the prompt that produced this spec. validate spec -> store spec.
      const specBlueprint = (projectRec.value as { blueprint?: { components?: Array<Record<string, unknown>> } })?.blueprint;
      const specBpComponent = specBlueprint?.components?.find((c) => c['id'] === componentId);
      if (!specBpComponent) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Component "${componentId}" not in blueprint (import the blueprint first)`));
        return;
      }
      const specType = specBpComponent['type'] as string;
      const specSubtype = (specBpComponent['subtype'] as string) || '';
      let specCheck: { valid: boolean; errors: string[] };
      if (specType === 'extension') specCheck = validateExtensionSpec(spec);
      else if (specType === 'app') specCheck = validateAppSpec(spec);
      else if (specType === 'cortex') {
        if (specSubtype === 'data') specCheck = validateDataApiSpec(spec);
        else if (specSubtype === 'component') specCheck = validateComponentSpec(spec);
        else if (specSubtype === 'app-domain') specCheck = validateAppDomainSpec(spec);
        else {
          // FAIL LOUD: a cortex MUST declare its subtype. Match the spec-PROMPT route (it builds a
          // gen-component-spec prompt for an unknown cortex subtype) so the validator agrees with the
          // prompt, but log it — a missing subtype is an upstream blueprint bug, not a normal path.
          specCheck = validateComponentSpec(spec);
          logger.warn(`⚠️ SUBTYPE MISSING on cortex "${componentId}" at spec store — validated as component spec to match the prompt route. Fix the blueprint subtype.`);
        }
      } else {
        res.status(400).json(error(config.nodeId, 'NO_SPEC', `Component type "${specType}" does not use specs`));
        return;
      }
      if (!specCheck.valid) {
        // Return errors for the agent to correct — do NOT store an invalid spec.
        res.status(422).json(error(config.nodeId, 'SPEC_VALIDATION_FAILED', specCheck.errors.join('; ')));
        return;
      }

      const now = new Date().toISOString();
      const key = `generator.${projectId}.spec.${componentId}`;
      const existing = await storage.getMemory(gaii, key);
      await storage.setMemory({
        key,
        ownerGaii: gaii,
        value: spec,
        visibility: 'owner',
        version: existing ? existing.version + 1 : 1,
        tags: ['generator', 'spec'],
        ttlHours: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { stored: true, componentId }));
      emitChange('memory');
    }
  );

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
      const blueprint = (projectRec?.value as { blueprint?: Blueprint })?.blueprint;
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

      let registeredAs: string;
      try {
        switch (component.type) {
          case 'csm': registeredAs = await registerCsm(component.content, ownerName, storage); break;
          case 'msm': registeredAs = await registerMsm(component.content, ownerName, storage); break;
          case 'extension': registeredAs = await registerExtension(component.content, ownerName, regGhii, storage, config.maxExtensionsPerOwner); break;
          case 'app': registeredAs = await registerApp(component.content, ownerName, regGhii, storage); break;
          case 'cortex':
            // Install + activate via the service layer (the public /v1/cortex routes are owner-only;
            // the agent JWT would 403 and the install would silently fail). See registerCortex.
            registeredAs = await registerCortex(component.content, ownerName, regGhii, storage, config);
            break;
          case 'memory':
          case 'translation': {
            // Write data to actual memory keys so AIMEAT.data.get() can read them.
            // service_slug from blueprint — the single source of truth for namespacing
            const projectRec2 = await storage.getMemory(gaii, `generator.${projectId}.project`);
            const blueprint2 = (projectRec2?.value as Record<string, unknown>)?.blueprint as Record<string, unknown> | undefined;
            const slug = (blueprint2?.service_slug as string) || '';
            if (!slug) {
              res.status(400).json(error(config.nodeId, 'NO_SERVICE_SLUG', 'Blueprint missing "service_slug" — cannot namespace memory keys. Regenerate blueprint.'));
              return;
            }
            try {
              const raw = component.content;
              const clean = typeof raw === 'string' ? raw.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim() : raw;
              const parsed = typeof clean === 'string' ? JSON.parse(clean) : clean;
              const now = new Date().toISOString();
              if (component.type === 'translation') {
                for (const [locale, strings] of Object.entries(parsed)) {
                  if (locale && typeof strings === 'object' && strings !== null) {
                    const memKey = `${slug}.i18n.${locale}`;
                    await storage.setMemory({ key: memKey, ownerGaii: regGhii, value: strings as Record<string, unknown>, visibility: 'public', version: 1, tags: ['generator', 'translation'], ttlHours: null, createdAt: now, updatedAt: now });
                  }
                }
              } else {
                for (const [rawKey, value] of Object.entries(parsed)) {
                  const memKey = rawKey.startsWith(slug + '.') ? rawKey : `${slug}.${rawKey}`;
                  await storage.setMemory({ key: memKey, ownerGaii: regGhii, value: value as Record<string, unknown>, visibility: 'public', version: 1, tags: ['generator', 'memory'], ttlHours: null, createdAt: now, updatedAt: now });
                }
              }
            } catch (e) {
              console.error(`[generator] Failed to store ${component.type} in memory:`, e);
            }
            registeredAs = slug;
            break;
          }
          default:
            res.status(400).json(error(config.nodeId, 'UNSUPPORTED_TYPE', `Registration not supported for type: ${component.type as string}`));
            return;
        }

        const now = new Date().toISOString();
        await storage.setMemory({
          ...componentRec,
          // status 'done' (not 'registered') + registeredAs is what the generator UI keys on to render
          // the component GREEN/registered and to look it up as active in the live catalogue. Clear
          // validationErrors — a successful register implies it validated. Mirrors the UI registerComponent.
          value: { ...component, status: 'done', registeredAt: now, registeredAs, validationErrors: [] },
          version: (componentRec.version ?? 1) + 1,
          updatedAt: now,
        });
        res.json(success(config.nodeId, { registered: true, componentId, registeredAs }));
        emitChange('memory');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json(error(config.nodeId, 'REGISTRATION_ERROR', msg));
      }
    }
  );

  // POST /v1/generator/:projectId/components/:componentId/reset — reset a component to empty state for regeneration
  router.post('/v1/generator/:projectId/components/:componentId/reset',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;

      const rec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      if (!rec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Component not found'));
        return;
      }

      const comp = rec.value as Record<string, unknown>;
      const now = new Date().toISOString();

      // Clear all generated content, keep only blueprint-derived fields (id, type, label, subtype)
      const reset = {
        id: comp.id,
        type: comp.type,
        label: comp.label,
        subtype: comp.subtype,
        status: 'pending',
        // Clear generated fields
        result: undefined,
        spec: undefined,
        registeredAs: undefined,
        contextBundle: undefined,
        testCode: undefined,
        testResult: undefined,
        validationErrors: undefined,
        probeResults: undefined,
        history: [...((comp.history as unknown[]) || []), { action: 'reset', at: now, by: 'user' }],
      };

      await storage.setMemory({
        ...rec,
        value: reset,
        version: (rec.version ?? 1) + 1,
        updatedAt: now,
      });

      // Also delete the separate spec record if it exists
      try {
        await storage.deleteMemory(gaii, `generator.${projectId}.spec.${componentId}`);
      } catch { /* may not exist */ }

      // Also delete the prompt record if stored
      try {
        await storage.deleteMemory(gaii, `generator.${projectId}.prompt.${componentId}`);
      } catch { /* may not exist */ }

      emitChange('memory');
      res.json(success(config.nodeId, { reset: true, componentId }));
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
        const val = r.value as { status?: string; registeredAs?: string };
        // "registered" = has a registeredAs (the UI's own definition); accept legacy
        // status 'registered'/'done' too for backward compatibility with older records.
        return !!val.registeredAs || val.status === 'registered' || val.status === 'done';
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
}
