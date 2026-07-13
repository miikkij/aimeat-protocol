/**
 * @file src/routes/generator/prompts.ts
 * @description Generator prompt-building routes — per-component code/spec/test prompt and the
 *   blueprint/interview prompt, both assembled from stored project state via buildPrompt. Extracted
 *   from src/routes/generator.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/generator.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { buildPrompt } from '../../services/generator-prompts/index.js';
import type { PromptRuntimeData, Blueprint, InterviewSpec, ComponentState } from '../../services/generator-prompts/types.js';

export function registerPromptRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  ownerGhii: (req: Express.Request) => string,
): void {
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
      // Include 'done' status — autopilot uses 'done' while UI uses 'registered'/'ready'
      const allComponentRecords = await storage.listMemory(gaii, { prefix: `generator.${projectId}.component.` });
      // Load every stored spec and merge it onto the matching component — the SAME thing the
      // browser's loadAllComponents() does (generator.js: specMap[component.id]). Specs live under
      // their own key (generator.<project>.spec.<id>), NOT on the component record, so without this
      // merge a dependency's spec — e.g. the data cortex's methods/returnsExample that a component
      // cortex prompt needs via resolveCortexComponent → completedComponents[].spec — would be missing
      // and the prompt would silently degrade. Reading from the spec key makes the chain consume the
      // spec from the exact same canonical place the autopilot/UI wrote it.
      const componentKeyPrefix = `generator.${projectId}.component.`;
      const specKeyPrefix = `generator.${projectId}.spec.`;
      const allSpecRecords = await storage.listMemory(gaii, { prefix: specKeyPrefix });
      const specByComponentId = new Map<string, unknown>();
      for (const sr of allSpecRecords) specByComponentId.set(sr.key.slice(specKeyPrefix.length), sr.value);
      const completedComponents = allComponentRecords
        .filter(r => {
          const val = r.value as { status?: string; registeredAs?: string };
          return (val.status === 'registered' || val.status === 'ready' || val.status === 'done') && val.registeredAs;
        })
        .map(r => {
          // Enrich with subtype from blueprint (not stored in component records)
          const val = r.value as Record<string, unknown>;
          if (!val.subtype && blueprint?.components) {
            const bpc = blueprint.components.find((c: { id: string; label: string }) => c.label === val.label || c.id === val.id);
            if (bpc && (bpc as Record<string, unknown>).subtype) {
              val.subtype = (bpc as Record<string, unknown>).subtype;
              logger.warn(`⚠️ SUBTYPE MISSING from stored component "${val.id || val.label}" — enriched from blueprint as "${(bpc as Record<string, unknown>).subtype}". Autopilot will auto-fix this.`);
            }
          }
          // Merge the spec from its canonical key if the record doesn't already carry it
          if (!val.spec) {
            const compId = (val.id as string) || r.key.slice(componentKeyPrefix.length);
            if (specByComponentId.has(compId)) val.spec = specByComponentId.get(compId);
          }
          return val;
        });

      // Determine prompt type — code (default) or spec
      const promptType = (req.query.type as string) || 'code';

      let promptId: string;
      if (promptType === 'test') {
        // Test prompt
        if (component.type === 'extension') promptId = 'gen-test-extension-spec';
        else if (component.type === 'cortex') {
          const sub = (component as Record<string, unknown>).subtype as string || '';
          if (sub === 'component') promptId = 'gen-test-cortex-component';
          else if (sub === 'app-domain') promptId = 'gen-test-cortex-app-domain';
          else promptId = 'gen-test-cortex-spec';
        }
        else if (component.type === 'app') promptId = 'gen-test-app';
        else {
          res.status(400).json(error(config.nodeId, 'NO_TEST', `Component type "${component.type}" does not use test prompts`));
          return;
        }
      } else if (promptType === 'spec') {
        // Spec prompt — only for extension and cortex
        if (component.type === 'extension') promptId = 'gen-extension-spec';
        else if (component.type === 'cortex') {
          const sub = (component as Record<string, unknown>).subtype as string || '';
          if (sub === 'data') promptId = 'gen-data-api-spec';
          else if (sub === 'component') promptId = 'gen-component-spec';
          else if (sub === 'app-domain') promptId = 'gen-app-domain-spec';
          else promptId = 'gen-component-spec';
        } else if (component.type === 'app') {
          promptId = 'gen-app-spec';
        } else {
          res.status(400).json(error(config.nodeId, 'NO_SPEC', `Component type "${component.type}" does not use specs`));
          return;
        }
      } else {
        // Code prompt
        const promptIdMap: Record<string, string> = {
          csm: 'gen-csm', memory: 'gen-memory', translation: 'gen-translation',
          extension: 'gen-extension-code', app: 'gen-app',
        };
        promptId = promptIdMap[component.type];
        if (component.type === 'cortex') {
          const sub = (component as Record<string, unknown>).subtype as string || '';
          if (sub === 'data') promptId = 'gen-cortex-data';
          else if (sub === 'component') promptId = 'gen-cortex-component';
          else if (sub === 'app-domain') promptId = 'gen-cortex-app-domain';
          else promptId = 'gen-cortex-component';
        }
        if (!promptId) promptId = 'gen-extension-code';
      }

      // Load extension spec if available (for code prompts that reference it)
      const specRec = await storage.getMemory(gaii, `generator.${projectId}.spec.${componentId}`);
      const selfSpec = specRec?.value as Record<string, unknown> | undefined;

      // Load extension spec for cortex prompts that need it (gen-data-api-spec, gen-cortex-data)
      let extensionSpec: Record<string, unknown> | undefined;
      let dataApiSpec: Record<string, unknown> | undefined;
      if (component.type === 'cortex') {
        // Find extension component ID from blueprint
        const extBpComp = blueprint.components.find((c: { type: string }) => c.type === 'extension');
        if (extBpComp) {
          const extSpecRec = await storage.getMemory(gaii, `generator.${projectId}.spec.${extBpComp.id}`);
          extensionSpec = extSpecRec?.value as Record<string, unknown> | undefined;
        }
        // Find data-cortex spec for component/app-domain spec prompts
        const dataCortexBp = blueprint.components.find((c: { type: string; subtype?: string }) => c.type === 'cortex' && (c as Record<string, unknown>).subtype === 'data');
        if (dataCortexBp && dataCortexBp.id !== componentId) {
          const dataSpecRec = await storage.getMemory(gaii, `generator.${projectId}.spec.${dataCortexBp.id}`);
          dataApiSpec = dataSpecRec?.value as Record<string, unknown> | undefined;
        }
      }

      // Gather translation keys for cortex component/app-domain prompts
      const translationKeys = (completedComponents as Array<Record<string, unknown>>)
        .filter(c => c.type === 'translation' && (c.contextBundle as Record<string, unknown>)?.keys)
        .flatMap(c => ((c.contextBundle as Record<string, unknown>)?.keys as string[]) || []);

      let prompt: string;
      try {
        prompt = await buildPrompt(storage, promptId, {
          blueprint: blueprint as unknown as Blueprint,
          interviewSpec: interviewSpec as unknown as InterviewSpec,
          blueprintComponent: component,
          componentLabel: component.label,
          componentType: component.type,
          completedComponents: completedComponents as unknown as ComponentState[],
          projectDescription: project.description || '',
          selfSpec,
          extensionSpec,
          dataApiSpec,
          translationKeys,
        } as unknown as PromptRuntimeData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[generator] buildPrompt FAILED for ${promptId}: ${msg}`);
        res.status(500).json(error(config.nodeId, 'PROMPT_BUILD_FAILED', `Failed to build prompt "${promptId}": ${msg}`));
        return;
      }

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

      const promptType = (req.query.type as string) || 'blueprint';

      if (promptType === 'interview') {
        // Interview prompt — gen-interview from DB
        const prompt = await buildPrompt(storage, 'gen-interview', {
          projectDescription: project.description || '',
          locale: (req.query.locale as string) || (interviewSpec as Record<string, unknown>)?.locale as string || 'en',
        } as unknown as PromptRuntimeData);
        res.json(success(config.nodeId, { prompt }));
        return;
      }

      // Blueprint prompt — gen-blueprint from DB
      // Load cortex catalog for available libraries
      let cortexCatalog: Array<Record<string, unknown>> = [];
      try {
        const cortexResp = await fetch(`http://localhost:${config.port}/v1/cortex`, {
          headers: { 'Authorization': req.headers.authorization || '' },
        });
        const cortexJson = await cortexResp.json() as { data?: Array<Record<string, unknown>> };
        cortexCatalog = (cortexJson.data || []).filter((c: Record<string, unknown>) =>
          c.active && ((c.components as Array<Record<string, unknown>>) || []).some((comp: Record<string, unknown>) => comp.type === 'lib')
        );
      } catch { /* cortex catalog optional */ }

      const prompt = await buildPrompt(storage, 'gen-blueprint', {
        projectDescription: project.description || '',
        interviewSpec,
        cortexCatalog,
      } as unknown as PromptRuntimeData);

      res.json(success(config.nodeId, { prompt }));
    }
  );
}
