/**
 * @file src/routes/generator/prompts.ts
 * @description Generator prompt-building routes — per-component code/spec/test prompt, the
 *   blueprint/interview prompt, and the self-correction (fix/reflection/explain/edit/impact/
 *   blueprint-fix) prompts, all assembled from stored project state via buildPrompt. This is
 *   the SINGLE source of truth for generator prompts: both the browser UI and the server
 *   autopilot fetch from here, so the two flows always run identical prompts.
 * @structure
 *   - loadComponentPromptContext: shared loader — completed components (+ merged specs), self
 *     spec, extension/data-API spec, translation keys — used by the code/spec/test GET route
 *     and the POST build route.
 *   - registerPromptRoutes: GET /prompts/:cid (code|spec|test), GET /prompts (blueprint|interview),
 *     POST /prompts/build (fix|reflection|explain|edit|impact|blueprint-fix|fresh-generation).
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/generator.ts (max-file-lines)
 *   v1.1.0 — 2026-07-18 — Add POST /prompts/build so the browser fetches the self-correction
 *     prompts from the DB too (kills System A client builders); extract shared context loader;
 *     blueprint-fix now wraps the canonical gen-blueprint (keeps service_slug).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { buildPrompt } from '../../services/generator-prompts/index.js';
import type { PromptRuntimeData, Blueprint, InterviewSpec, ComponentState } from '../../services/generator-prompts/types.js';

type BlueprintShape = { components?: Array<{ id: string; type: string; label: string; subtype?: string }>; dataModel?: Record<string, unknown> };

/**
 * Load the cross-component context a per-component prompt needs: every completed component
 * (with its spec merged from the canonical generator.<project>.spec.<id> key), this component's
 * own spec, the extension spec + data-API spec cortex prompts depend on, and translation keys.
 * Shared by the code/spec/test GET route and the POST build route so both see identical context.
 */
async function loadComponentPromptContext(
  storage: Storage,
  gaii: string,
  projectId: string,
  componentId: string,
  component: { id: string; type: string; label: string; subtype?: string },
  blueprint: BlueprintShape,
): Promise<{
  completedComponents: ComponentState[];
  selfSpec: Record<string, unknown> | undefined;
  extensionSpec: Record<string, unknown> | undefined;
  dataApiSpec: Record<string, unknown> | undefined;
  translationKeys: string[];
}> {
  const componentKeyPrefix = `generator.${projectId}.component.`;
  const specKeyPrefix = `generator.${projectId}.spec.`;
  const [allComponentRecords, allSpecRecords] = await Promise.all([
    storage.listMemory(gaii, { prefix: componentKeyPrefix }),
    storage.listMemory(gaii, { prefix: specKeyPrefix }),
  ]);
  const specByComponentId = new Map<string, unknown>();
  for (const sr of allSpecRecords) specByComponentId.set(sr.key.slice(specKeyPrefix.length), sr.value);

  const completedComponents = allComponentRecords
    .filter(r => {
      const val = r.value as { status?: string; registeredAs?: string };
      return (val.status === 'registered' || val.status === 'ready' || val.status === 'done') && val.registeredAs;
    })
    .map(r => {
      const val = r.value as Record<string, unknown>;
      if (!val.subtype && blueprint?.components) {
        const bpc = blueprint.components.find((c) => c.label === val.label || c.id === val.id);
        if (bpc && (bpc as Record<string, unknown>).subtype) {
          val.subtype = (bpc as Record<string, unknown>).subtype;
          logger.warn(`⚠️ SUBTYPE MISSING from stored component "${val.id || val.label}" — enriched from blueprint as "${(bpc as Record<string, unknown>).subtype}". Autopilot will auto-fix this.`);
        }
      }
      if (!val.spec) {
        const compId = (val.id as string) || r.key.slice(componentKeyPrefix.length);
        if (specByComponentId.has(compId)) val.spec = specByComponentId.get(compId);
      }
      return val;
    }) as unknown as ComponentState[];

  const specRec = await storage.getMemory(gaii, `generator.${projectId}.spec.${componentId}`);
  const selfSpec = specRec?.value as Record<string, unknown> | undefined;

  let extensionSpec: Record<string, unknown> | undefined;
  let dataApiSpec: Record<string, unknown> | undefined;
  if (component.type === 'cortex' && blueprint?.components) {
    const extBpComp = blueprint.components.find((c) => c.type === 'extension');
    if (extBpComp) {
      const extSpecRec = await storage.getMemory(gaii, `generator.${projectId}.spec.${extBpComp.id}`);
      extensionSpec = extSpecRec?.value as Record<string, unknown> | undefined;
    }
    const dataCortexBp = blueprint.components.find((c) => c.type === 'cortex' && (c as Record<string, unknown>).subtype === 'data');
    if (dataCortexBp && dataCortexBp.id !== componentId) {
      const dataSpecRec = await storage.getMemory(gaii, `generator.${projectId}.spec.${dataCortexBp.id}`);
      dataApiSpec = dataSpecRec?.value as Record<string, unknown> | undefined;
    }
  }

  const translationKeys = (completedComponents as unknown as Array<Record<string, unknown>>)
    .filter(c => c.type === 'translation' && (c.contextBundle as Record<string, unknown>)?.keys)
    .flatMap(c => ((c.contextBundle as Record<string, unknown>)?.keys as string[]) || []);

  return { completedComponents, selfSpec, extensionSpec, dataApiSpec, translationKeys };
}

/** Build the canonical blueprint prompt (with the live cortex-lib catalog), used by the
 *  blueprint GET route and reused as the body of the blueprint-fix retry prompt. */
async function buildBlueprintPromptBody(
  storage: Storage,
  config: AimeatConfig,
  authHeader: string,
  projectDescription: string,
  interviewSpec: unknown,
): Promise<string> {
  let cortexCatalog: Array<Record<string, unknown>> = [];
  try {
    const cortexResp = await fetch(`http://localhost:${config.port}/v1/cortex`, {
      headers: { 'Authorization': authHeader || '' },
    });
    const cortexJson = await cortexResp.json() as { data?: Array<Record<string, unknown>> };
    cortexCatalog = (cortexJson.data || []).filter((c: Record<string, unknown>) =>
      c.active && ((c.components as Array<Record<string, unknown>>) || []).some((comp: Record<string, unknown>) => comp.type === 'lib')
    );
  } catch { /* cortex catalog optional */ }

  return buildPrompt(storage, 'gen-blueprint', {
    projectDescription,
    interviewSpec,
    cortexCatalog,
    nodeUrl: config.baseUrl.replace(/\/+$/, ''),
  } as unknown as PromptRuntimeData);
}

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

      const [projectRec, interviewRec] = await Promise.all([
        storage.getMemory(gaii, `generator.${projectId}.project`),
        storage.getMemory(gaii, `generator.${projectId}.interview-spec`),
      ]);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const project = projectRec.value as { blueprint?: BlueprintShape; description?: string };
      const interviewSpec = interviewRec?.value ?? null;
      const blueprint = project.blueprint;

      if (!blueprint?.components) {
        res.status(400).json(error(config.nodeId, 'NO_BLUEPRINT', 'Blueprint not yet submitted'));
        return;
      }

      const component = blueprint.components.find((c) => c.id === componentId);
      if (!component) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Component "${componentId}" not in blueprint`));
        return;
      }

      // Determine prompt type — code (default), spec, or test
      const promptType = (req.query.type as string) || 'code';
      let promptId: string;
      if (promptType === 'test') {
        if (component.type === 'extension') promptId = 'gen-test-extension-spec';
        else if (component.type === 'cortex') {
          const sub = (component.subtype as string) || '';
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
        if (component.type === 'extension') promptId = 'gen-extension-spec';
        else if (component.type === 'cortex') {
          const sub = (component.subtype as string) || '';
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
        const promptIdMap: Record<string, string> = {
          csm: 'gen-csm', memory: 'gen-memory', translation: 'gen-translation',
          extension: 'gen-extension-code', app: 'gen-app',
        };
        promptId = promptIdMap[component.type];
        if (component.type === 'cortex') {
          const sub = (component.subtype as string) || '';
          if (sub === 'data') promptId = 'gen-cortex-data';
          else if (sub === 'component') promptId = 'gen-cortex-component';
          else if (sub === 'app-domain') promptId = 'gen-cortex-app-domain';
          else promptId = 'gen-cortex-component';
        }
        if (!promptId) promptId = 'gen-extension-code';
      }

      const ctx = await loadComponentPromptContext(storage, gaii, projectId, componentId, component, blueprint);

      let prompt: string;
      try {
        prompt = await buildPrompt(storage, promptId, {
          blueprint: blueprint as unknown as Blueprint,
          interviewSpec: interviewSpec as unknown as InterviewSpec,
          blueprintComponent: component,
          componentLabel: component.label,
          componentType: component.type,
          completedComponents: ctx.completedComponents,
          projectDescription: project.description || '',
          selfSpec: ctx.selfSpec,
          extensionSpec: ctx.extensionSpec,
          dataApiSpec: ctx.dataApiSpec,
          translationKeys: ctx.translationKeys,
          nodeUrl: config.baseUrl.replace(/\/+$/, ''),
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

  // POST /v1/generator/:projectId/prompts/build — build a self-correction prompt.
  // The browser has runtime data the GET route doesn't (the current code, validator errors,
  // the edit/change request), so it POSTs that here and the server assembles the prompt from
  // the SAME DB templates the autopilot uses. Supported kinds:
  //   fix, reflection, explain, edit, impact, blueprint-fix, fresh-generation.
  const BUILDABLE = new Set([
    'gen-fix', 'gen-reflection', 'gen-explain', 'gen-edit', 'gen-impact',
    'gen-blueprint-fix', 'gen-fresh-generation',
  ]);
  router.post('/v1/generator/:projectId/prompts/build',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const body = (req.body ?? {}) as {
        promptId?: string; componentId?: string; code?: string; errors?: string[];
        changeRequest?: string; upstreamChanges?: string; componentType?: string;
        componentLabel?: string; originalPrompt?: string; testContext?: Record<string, unknown>;
        previousAttempts?: Array<Record<string, unknown>>; reflectionDiagnosis?: string;
      };
      const promptId = body.promptId || '';
      if (!BUILDABLE.has(promptId)) {
        res.status(400).json(error(config.nodeId, 'BAD_PROMPT', `promptId "${promptId}" is not buildable via this route`));
        return;
      }

      const [projectRec, interviewRec] = await Promise.all([
        storage.getMemory(gaii, `generator.${projectId}.project`),
        storage.getMemory(gaii, `generator.${projectId}.interview-spec`),
      ]);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }
      const project = projectRec.value as { blueprint?: BlueprintShape; description?: string };
      const interviewSpec = interviewRec?.value ?? null;
      const blueprint = project.blueprint;

      // Assemble runtime data: stored project state + browser-supplied fields.
      const data: PromptRuntimeData = {
        blueprint: blueprint as unknown as Blueprint,
        interviewSpec: interviewSpec as unknown as InterviewSpec,
        projectDescription: project.description || '',
        code: body.code,
        errors: body.errors,
        changeRequest: body.changeRequest,
        upstreamChanges: body.upstreamChanges,
        componentType: body.componentType,
        componentLabel: body.componentLabel,
        originalPrompt: body.originalPrompt,
        testContext: body.testContext,
        previousAttempts: body.previousAttempts,
        reflectionDiagnosis: body.reflectionDiagnosis,
        nodeUrl: config.baseUrl.replace(/\/+$/, ''),
      };

      // Component-scoped prompts: enrich with this component's blueprint entry + context.
      if (body.componentId && blueprint?.components) {
        const component = blueprint.components.find((c) => c.id === body.componentId);
        if (component) {
          data.blueprintComponent = component;
          if (!data.componentType) data.componentType = component.type;
          if (!data.componentLabel) data.componentLabel = component.label;
          const ctx = await loadComponentPromptContext(storage, gaii, projectId, body.componentId, component, blueprint);
          data.completedComponents = ctx.completedComponents;
          data.selfSpec = ctx.selfSpec;
          data.extensionSpec = ctx.extensionSpec;
          data.dataApiSpec = ctx.dataApiSpec;
          data.translationKeys = ctx.translationKeys;
        }
      }

      // Blueprint-fix wraps the canonical blueprint prompt so the retry keeps service_slug etc.
      if (promptId === 'gen-blueprint-fix') {
        data.blueprintBody = await buildBlueprintPromptBody(
          storage, config, req.headers.authorization || '', project.description || '', interviewSpec,
        );
      }

      let prompt: string;
      try {
        prompt = await buildPrompt(storage, promptId, data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[generator] buildPrompt (build route) FAILED for ${promptId}: ${msg}`);
        res.status(500).json(error(config.nodeId, 'PROMPT_BUILD_FAILED', `Failed to build prompt "${promptId}": ${msg}`));
        return;
      }
      res.json(success(config.nodeId, { promptId, prompt }));
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
        const prompt = await buildPrompt(storage, 'gen-interview', {
          projectDescription: project.description || '',
          locale: (req.query.locale as string) || (interviewSpec as Record<string, unknown>)?.locale as string || 'en',
        } as unknown as PromptRuntimeData);
        res.json(success(config.nodeId, { prompt }));
        return;
      }

      const prompt = await buildBlueprintPromptBody(
        storage, config, req.headers.authorization || '', project.description || '', interviewSpec,
      );
      res.json(success(config.nodeId, { prompt }));
    }
  );
}
