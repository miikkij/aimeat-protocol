/**
 * @file generator-autopilot.ts
 * @description Server-side autopilot for the generator pipeline. Runs the full
 *   spec→code→validate→register→probe→test loop as a background process.
 *   The browser just starts it and polls for status — closing the tab doesn't kill it.
 *
 *   Uses internal HTTP calls to the same server for registration, testing, and probing
 *   to reuse all existing validation logic without duplication.
 *
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial backend autopilot
 */

import { join } from 'node:path';
import { type Storage } from '../storage/interface.js';
import { type AimeatConfig } from '../config.js';
import { complete as openrouterComplete } from './openrouter.js';
import { getEncryptionKey } from './encryption.js';
import { decrypt } from './encryption.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

// Logger wrapper — accepts both winston-style (msg, meta) and pino-style (meta, msg)
const log = {
  info: (a: string | Record<string, unknown>, b?: string | Record<string, unknown>) =>
    typeof a === 'string' ? logger.info(a, b as Record<string, unknown>) : logger.info(b as string || JSON.stringify(a)),
  warn: (a: string | Record<string, unknown>, b?: string | Record<string, unknown>) =>
    typeof a === 'string' ? logger.warn(a, b as Record<string, unknown>) : logger.warn(b as string || JSON.stringify(a)),
  error: (a: string | Record<string, unknown>, b?: string | Record<string, unknown>) =>
    typeof a === 'string' ? logger.error(a, b as Record<string, unknown>) : logger.error(b as string || JSON.stringify(a)),
};

// ── Prompt builders — imported from public JS (pure ESM, no browser deps) ──
// These are the SAME files the browser uses. They're pure functions.
const PROMPT_DIR = join(import.meta.dirname, '..', '..', 'public', 'js', 'services');

let promptModules: {
  buildComponentPrompt: (...args: unknown[]) => Promise<string>;
  buildBlueprintPrompt: (...args: unknown[]) => string;
  buildFixPrompt: (...args: unknown[]) => string;
  buildTestPrompt: (...args: unknown[]) => string;
  buildExtensionSpecPrompt: (params: Record<string, unknown>) => string;
  buildDataApiSpecPrompt: (params: Record<string, unknown>) => string;
  buildComponentSpecPrompt: (params: Record<string, unknown>) => string;
  buildAppDomainSpecPrompt: (params: Record<string, unknown>) => string;
  formatSpecForPrompt: (spec: unknown, label: string) => string;
  validateComponent: (type: string, result: string, blueprint?: unknown) => { valid: boolean; errors: string[]; extracted?: unknown };
  validateExtensionSpec: (spec: unknown) => { valid: boolean; errors: string[] };
  validateDataApiSpec: (spec: unknown) => { valid: boolean; errors: string[] };
  validateSpecAgainstProbe: (spec: unknown, probes: unknown[]) => { valid: boolean; mismatches: unknown[] };
  buildExtensionTestFromSpec: (spec: unknown, name: string) => string;
  buildDataCortexTestFromSpec: (spec: unknown) => string;
  createBundle: (component: unknown, probeResults: unknown[]) => unknown;
  stripCodeblock: (text: string) => string;
} | null = null;

/** Load prompt builder modules from public/js/services/ (one-time, cached) */
async function loadPromptModules() {
  if (promptModules) return promptModules;

  const [
    promptsBuild, promptsBase, promptsFix, promptsTest,
    specs, specValidate, specTests,
    validate, contextBundle,
    cortexData, cortexFeature, cortexApp,
  ] = await Promise.all([
    import(join(PROMPT_DIR, 'generator-prompts-build.js')),
    import(join(PROMPT_DIR, 'generator-prompts-base.js')),
    import(join(PROMPT_DIR, 'generator-prompts-fix.js')),
    import(join(PROMPT_DIR, 'generator-prompts-test.js')),
    import(join(PROMPT_DIR, 'generator-specs.js')),
    import(join(PROMPT_DIR, 'generator-spec-validate.js')),
    import(join(PROMPT_DIR, 'generator-spec-tests.js')),
    import(join(PROMPT_DIR, 'generator-validate.js')),
    import(join(PROMPT_DIR, 'generator-context-bundle.js')),
    import(join(PROMPT_DIR, 'generator-prompts-cortex-data.js')),
    import(join(PROMPT_DIR, 'generator-prompts-cortex-feature.js')),
    import(join(PROMPT_DIR, 'generator-prompts-cortex-app.js')),
  ]);

  // Inject cortex modules into the build module (it lazy-loads them behind typeof window guard)
  if (promptsBuild._setCortexModules) {
    promptsBuild._setCortexModules({
      buildDataCortexPrompt: cortexData.buildDataCortexPrompt,
      buildFeatureCortexPrompt: cortexFeature.buildFeatureCortexPrompt,
      buildAppDomainCortexPrompt: cortexApp.buildAppDomainCortexPrompt,
      createBundle: contextBundle.createBundle,
      formatBundlesForPrompt: contextBundle.formatBundlesForPrompt,
    });
  }

  promptModules = {
    buildComponentPrompt: promptsBuild.buildComponentPrompt,
    buildBlueprintPrompt: promptsBuild.buildBlueprintPrompt,
    buildFixPrompt: promptsFix.buildFixPrompt,
    buildTestPrompt: promptsTest.buildTestPrompt,
    buildExtensionSpecPrompt: specs.buildExtensionSpecPrompt,
    buildDataApiSpecPrompt: specs.buildDataApiSpecPrompt,
    buildComponentSpecPrompt: specs.buildComponentSpecPrompt,
    buildAppDomainSpecPrompt: specs.buildAppDomainSpecPrompt,
    formatSpecForPrompt: specs.formatSpecForPrompt,
    validateComponent: validate.validateComponent,
    validateExtensionSpec: specValidate.validateExtensionSpec,
    validateDataApiSpec: specValidate.validateDataApiSpec,
    validateSpecAgainstProbe: specValidate.validateSpecAgainstProbe,
    buildExtensionTestFromSpec: specTests.buildExtensionTestFromSpec,
    buildDataCortexTestFromSpec: specTests.buildDataCortexTestFromSpec,
    createBundle: contextBundle.createBundle,
    stripCodeblock: promptsBuild.stripCodeblock || ((t: string) => {
      // Inline fallback — strip markdown fences
      const m = t.trim().match(/^```[^\n]*\n([\s\S]*?)```\s*$/);
      return m ? m[1].trim() : t.trim();
    }),
  };
  return promptModules;
}

// ── Autopilot state ──

export interface AutopilotStatus {
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  currentComponent: string | null;
  progress: { total: number; completed: number; failed: number; skipped: number };
  componentResults: Array<{ id: string; label: string; status: string; error?: string }>;
  startedAt: string;
  updatedAt: string;
}

// In-memory map of running autopilots (one per project)
const runningAutopilots = new Map<string, { status: AutopilotStatus; cancelFlag: boolean }>();

export function getAutopilotStatus(projectId: string): AutopilotStatus | null {
  return runningAutopilots.get(projectId)?.status ?? null;
}

export function cancelAutopilot(projectId: string): boolean {
  const entry = runningAutopilots.get(projectId);
  if (entry && entry.status.status === 'running') {
    entry.cancelFlag = true;
    return true;
  }
  return false;
}

export function isAutopilotRunning(projectId: string): boolean {
  return runningAutopilots.get(projectId)?.status.status === 'running';
}

// ── Internal HTTP helper (calls own server) ──

async function internalFetch(config: AimeatConfig, path: string, jwt: string, opts: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: unknown; error?: unknown }> {
  const url = `http://localhost:${config.port}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwt}`,
  };
  const fetchOpts: RequestInit = { method: opts.method || 'GET', headers };
  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);

  const resp = await fetch(url, fetchOpts);
  const json = await resp.json() as Record<string, unknown>;
  return { ok: resp.ok, status: resp.status, data: json.data, error: json.error };
}

// ── Main autopilot loop ──

export async function runAutopilot(
  projectId: string,
  ownerGhii: string,
  ownerName: string,
  jwt: string,
  config: AimeatConfig,
  storage: Storage,
): Promise<void> {
  // Logger is the module-level winston wrapper defined above

  if (isAutopilotRunning(projectId)) {
    throw new Error('Autopilot already running for this project');
  }

  const modules = await loadPromptModules();
  if (!modules) throw new Error('Failed to load prompt modules');

  // Read project data
  const projectRec = await storage.getMemory(ownerGhii, `generator.${projectId}.project`);
  if (!projectRec) throw new Error('Project not found');
  const project = projectRec.value as Record<string, unknown>;
  const blueprint = project.blueprint as Record<string, unknown> | undefined;
  if (!blueprint) throw new Error('No blueprint — generate blueprint first');

  const interviewRec = await storage.getMemory(ownerGhii, `generator.${projectId}.interview-spec`);
  const interviewSpec = (interviewRec?.value as Record<string, unknown>) ?? null;

  const phases = (blueprint.phases as Array<{ componentIds?: string[] }>) || [];
  const phaseOrder = phases.flatMap(p => p.componentIds || []);

  // Read OpenRouter settings
  const prefsRecord = await storage.getMemory(ownerGhii, 'openrouter.settings');
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const provider = (prefs.provider as string) || 'openrouter';
  const baseUrl = (prefs.baseUrl as string) || (provider === 'lmstudio' ? 'http://localhost:1234/v1' : 'https://openrouter.ai/api/v1');
  const model = (prefs.model as string) || (prefs.executionModel as string) || 'anthropic/claude-sonnet-4';
  const temperature = (prefs.temperature as number) ?? undefined;

  // Decrypt API key
  let apiKey: string | undefined;
  const apiKeyRecord = await storage.getMemory(ownerGhii, 'openrouter.apikey');
  const encrypted = ((apiKeyRecord?.value as Record<string, unknown>)?.encrypted as string) ?? null;
  if (encrypted) {
    const encKey = getEncryptionKey(config);
    if (encKey) apiKey = decrypt(encrypted, encKey);
  }
  if (!apiKey && provider === 'openrouter') throw new Error('No OpenRouter API key configured');

  // Initialize status
  const now = new Date().toISOString();
  const entry = {
    status: {
      status: 'running' as const,
      currentComponent: null as string | null,
      progress: { total: phaseOrder.length, completed: 0, failed: 0, skipped: 0 },
      componentResults: [] as Array<{ id: string; label: string; status: string; error?: string }>,
      startedAt: now,
      updatedAt: now,
    },
    cancelFlag: false,
  };
  runningAutopilots.set(projectId, entry);

  const updateStatus = (patch: Partial<AutopilotStatus>) => {
    Object.assign(entry.status, patch, { updatedAt: new Date().toISOString() });
    // Persist to memory for UI polling
    storage.setMemory({
      key: `generator.${projectId}.autopilot-status`,
      ownerGaii: ownerGhii,
      value: entry.status,
      visibility: 'owner',
      version: 1,
      tags: ['generator', 'autopilot'],
      ttlHours: null,
      createdAt: entry.status.startedAt,
      updatedAt: entry.status.updatedAt,
    }).catch(() => {});
    emitChange('memory');
  };

  /** Call OpenRouter with the current settings */
  async function callLLM(prompt: string): Promise<string> {
    const result = await openrouterComplete(apiKey, model, prompt, undefined, baseUrl, { temperature });
    return result.content;
  }

  /** Read all components for this project */
  async function loadComponents(): Promise<Array<Record<string, unknown>>> {
    const records = await storage.listMemory(ownerGhii, { prefix: `generator.${projectId}.component.`, visibility: 'owner' });
    return records.map(r => {
      const val = (typeof r.value === 'string' ? JSON.parse(r.value) : r.value) as Record<string, unknown>;
      if (!val.id && r.key) val.id = r.key.replace(`generator.${projectId}.component.`, '');
      if (!val.label) val.label = val.id;
      return { ...val, _version: r.version };
    });
  }

  /** Save component data */
  async function saveComp(comp: Record<string, unknown>) {
    const key = `generator.${projectId}.component.${comp.id as string}`;
    const version = (comp._version as number) || 0;
    const { _version, ...data } = comp;
    try {
      if (version === 0) {
        await storage.setMemory({
          key, ownerGaii: ownerGhii, value: data, visibility: 'owner',
          version: 1, tags: ['generator', 'component'], ttlHours: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
      } else {
        const rec = await storage.getMemory(ownerGhii, key);
        if (rec) {
          await storage.setMemory({ ...rec, value: data, version: (rec.version ?? 1) + 1, updatedAt: new Date().toISOString() });
        }
      }
    } catch (e) {
      log.warn(`saveComp failed for ${comp.id as string} — retrying: ${(e as Error).message}`);
      const rec = await storage.getMemory(ownerGhii, key);
      if (rec) {
        await storage.setMemory({ ...rec, value: data, version: (rec.version ?? 1) + 1, updatedAt: new Date().toISOString() });
      }
    }
    emitChange('memory');
  }

  // ── Main loop ──
  try {
    for (const cid of phaseOrder) {
      if (entry.cancelFlag) break;

      const comps = await loadComponents();
      let comp = comps.find(c => c.id === cid);
      if (!comp || comp.registeredAs) {
        // Already registered — mark as completed and skip
        if (comp?.registeredAs) {
          entry.status.progress.completed++;
          entry.status.componentResults.push({ id: cid, label: (comp?.label as string) || cid, status: 'already_registered' });
        }
        continue;
      }

      const compLabel = (comp.label as string) || cid;
      const compType = (comp.type as string) || 'unknown';
      updateStatus({ currentComponent: compLabel });
      log.info(`[${cid}] Processing: ${compLabel} (${compType})`);

      try {
        // ── SPEC GENERATION ──
        const specTypes = ['extension', 'cortex'];
        let spec: Record<string, unknown> | null = null;

        if (specTypes.includes(compType)) {
          const bpComp = ((blueprint.components as Array<Record<string, unknown>>) || []).find((c: Record<string, unknown>) => c.label === compLabel);
          if (bpComp) {
            let specPrompt: string | null = null;

            if (compType === 'extension') {
              specPrompt = modules.buildExtensionSpecPrompt({ blueprint, blueprintComponent: bpComp, interviewSpec });
            } else if ((bpComp.subtype as string) === 'data') {
              const extComp = comps.find(c => c.type === 'extension' && c.spec);
              if (extComp?.spec) specPrompt = modules.buildDataApiSpecPrompt({ extensionSpec: extComp.spec, blueprint });
            } else if ((bpComp.subtype as string) === 'component' || (bpComp.id as string)?.startsWith('component-')) {
              const dataCortex = comps.find(c => c.type === 'cortex' && c.spec && ((c.subtype as string) === 'data'));
              if (dataCortex?.spec) {
                const translationKeys = comps.filter(c => c.type === 'translation' && (c as Record<string, unknown>).contextBundle)
                  .flatMap(c => ((c as Record<string, unknown>).contextBundle as Record<string, unknown>)?.keys as string[] || []);
                specPrompt = modules.buildComponentSpecPrompt({ dataApiSpec: dataCortex.spec, componentLabel: compLabel, translationKeys });
              }
            } else if ((bpComp.subtype as string) === 'app-domain') {
              const dataCortex = comps.find(c => c.type === 'cortex' && c.spec && ((c.subtype as string) === 'data'));
              const componentSpecs = comps.filter(c => c.spec && ((c.subtype as string) === 'component')).map(c => c.spec);
              const translationKeys = comps.filter(c => c.type === 'translation' && (c as Record<string, unknown>).contextBundle)
                .flatMap(c => ((c as Record<string, unknown>).contextBundle as Record<string, unknown>)?.keys as string[] || []);
              if (dataCortex?.spec) {
                specPrompt = modules.buildAppDomainSpecPrompt({
                  componentSpecs, dataApiSpec: dataCortex.spec,
                  useCases: interviewSpec?.useCases, translationKeys, views: interviewSpec?.views,
                });
              }
            }

            if (specPrompt) {
              log.info(`[${cid}] Generating spec for ${compLabel}`);
              const specRaw = await callLLM(specPrompt);
              let specText = specRaw.trim();
              const fenceMatch = specText.match(/```(?:json)?\s*\n([\s\S]*?)```/);
              if (fenceMatch) specText = fenceMatch[1].trim();

              try {
                spec = JSON.parse(specText) as Record<string, unknown>;
                log.info(`[${cid}] Spec generated: ${spec.name as string}`);
              } catch {
                log.warn(`[${cid}] Spec JSON parse failed — continuing without spec`);
                spec = null;
              }

              if (spec) {
                comp = { ...comp, spec };
                await saveComp(comp);
                // Save spec independently
                await storage.setMemory({
                  key: `generator.${projectId}.spec.${cid}`,
                  ownerGaii: ownerGhii, value: spec, visibility: 'owner',
                  version: 1, tags: ['generator', 'spec'], ttlHours: null,
                  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                }).catch(() => {});
              }
            }
          }
        }

        if (entry.cancelFlag) break;

        // ── CODE GENERATION ──
        log.info(`[${cid}] Building code prompt for ${compLabel}`);
        const freshComps = await loadComponents();
        const completedComponents = freshComps.filter(c => c.status === 'done' && c.registeredAs);
        const prompt = await modules.buildComponentPrompt(
          compType, compLabel,
          project.description, blueprint, completedComponents,
          interviewSpec,
        );

        log.info(`[${cid}] Calling OpenRouter for ${compLabel} (prompt: ${(prompt as string).length} chars)`);
        let content = await callLLM(prompt as string);
        content = modules.stripCodeblock(content);

        // ── VALIDATE ──
        let vr = modules.validateComponent(compType, content, blueprint);

        // Auto-retry on validation failure
        if (!vr.valid) {
          const maxRetries = 3;
          for (let attempt = 1; attempt <= maxRetries && !vr.valid && !entry.cancelFlag; attempt++) {
            log.info(`[${cid}] Retry ${attempt}/${maxRetries} for ${compLabel}`);
            const fixPrompt = modules.buildFixPrompt(prompt as string, content, vr.errors, compType);
            content = await callLLM(fixPrompt);
            content = modules.stripCodeblock(content);
            vr = modules.validateComponent(compType, content, blueprint);
          }
        }

        if (!vr.valid) {
          log.warn(`[${cid}] Validation failed for ${compLabel} — skipping: ${vr.errors[0]}`);
          comp = { ...comp, result: content, status: 'errors', validationErrors: vr.errors };
          await saveComp(comp);
          entry.status.progress.failed++;
          entry.status.componentResults.push({ id: cid, label: compLabel, status: 'validation_failed', error: vr.errors[0] });
          continue;
        }

        // ── REGISTER ──
        log.info(`[${cid}] Registering ${compLabel}`);
        comp = { ...comp, result: content, status: 'done', validationErrors: [] };
        await saveComp(comp);

        // Use internal HTTP to register — reuses all existing validation/registration logic
        try {
          // Submit content first
          await internalFetch(config, `/v1/generator/${projectId}/components/${cid}/submit`, jwt, {
            method: 'POST',
            body: { content, type: compType },
          });

          // For types that have catalogue registration (CSM, MSM, Extension, App)
          if (['csm', 'msm', 'extension', 'app'].includes(compType)) {
            const regResp = await internalFetch(config, `/v1/generator/${projectId}/components/${cid}/register`, jwt, { method: 'POST' });
            if (!regResp.ok) {
              throw new Error(`Registration failed: ${JSON.stringify(regResp.error)}`);
            }
          }

          // For cortex: use the cortex API directly
          if (compType === 'cortex') {
            const extracted = vr.extracted as { manifest: string; libs: Array<{ filename: string; code: string }> } | undefined;
            if (extracted?.manifest) {
              const libs: Record<string, string> = {};
              for (const lib of (extracted.libs || [])) {
                if (lib.filename && lib.code) libs[lib.filename] = lib.code;
              }
              const cortexResp = await internalFetch(config, '/v1/cortex', jwt, {
                method: 'POST',
                body: { manifest: extracted.manifest, ...(Object.keys(libs).length > 0 ? { libs } : {}) },
              });
              if (!cortexResp.ok) {
                // Try deactivate + delete + retry
                const nameMatch = extracted.manifest.match(/name:\s*"?([^\s"]+)"?/);
                if (nameMatch) {
                  await internalFetch(config, `/v1/cortex/${encodeURIComponent(nameMatch[1])}/deactivate`, jwt, { method: 'POST' }).catch(() => {});
                  await internalFetch(config, `/v1/cortex/${encodeURIComponent(nameMatch[1])}`, jwt, { method: 'DELETE' }).catch(() => {});
                  await internalFetch(config, '/v1/cortex', jwt, {
                    method: 'POST',
                    body: { manifest: extracted.manifest, ...(Object.keys(libs).length > 0 ? { libs } : {}) },
                  });
                }
              }
              // Activate
              const name = extracted.manifest.match(/name:\s*"?([^\s"]+)"?/)?.[1];
              if (name) {
                await internalFetch(config, `/v1/cortex/${encodeURIComponent(name)}/deactivate`, jwt, { method: 'POST' }).catch(() => {});
                await internalFetch(config, `/v1/cortex/${encodeURIComponent(name)}/activate`, jwt, { method: 'POST' });
              }
            }
          }

          // For memory/translation: store in memory directly
          if (compType === 'memory' || compType === 'translation') {
            const extComp = freshComps.find(c => c.type === 'extension' && c.registeredAs);
            const csmComp = freshComps.find(c => c.type === 'csm' && c.registeredAs);
            const serviceSlug = (extComp?.registeredAs as string) || ((csmComp?.registeredAs as string) || '').split('/').pop() || '';

            if (compType === 'memory') {
              const entries = typeof content === 'string' ? JSON.parse(content) : content;
              for (const [rawKey, value] of Object.entries(entries)) {
                const key = (serviceSlug && !rawKey.startsWith(serviceSlug + '.')) ? `${serviceSlug}.${rawKey}` : rawKey;
                await storage.setMemory({
                  key, ownerGaii: ownerGhii, value, visibility: 'public',
                  version: 1, tags: ['generator', 'memory'], ttlHours: null,
                  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                });
              }
            }

            if (compType === 'translation') {
              const translations = typeof content === 'string' ? JSON.parse(content) : content;
              for (const [locale, strings] of Object.entries(translations)) {
                if (locale && typeof strings === 'object') {
                  const key = serviceSlug ? `${serviceSlug}.i18n.${locale}` : `i18n.${locale}`;
                  await storage.setMemory({
                    key, ownerGaii: ownerGhii, value: strings, visibility: 'public',
                    version: 1, tags: ['generator', 'translation'], ttlHours: null,
                    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                  });
                }
              }
            }
          }

          // Determine registered name
          const regName = comp.registeredAs || extractRegisteredName(compType, content, vr);
          comp = { ...comp, registeredAs: regName, contextBundle: modules.createBundle({ ...comp, registeredAs: regName }, []) };
          await saveComp(comp);
          log.info(`[${cid}] Registered: ${compLabel} as ${regName as string}`);

        } catch (regErr) {
          log.warn(`[${cid}] Registration failed for ${compLabel}: ${(regErr as Error).message}`);
          entry.status.progress.failed++;
          entry.status.componentResults.push({ id: cid, label: compLabel, status: 'registration_failed', error: (regErr as Error).message });
          continue;
        }

        // ── ACTIVATE EXTENSION ──
        if (compType === 'extension' && comp.registeredAs) {
          try {
            await internalFetch(config, `/v1/generator/${projectId}/apply-settings/${encodeURIComponent(comp.registeredAs as string)}`, jwt, { method: 'POST' });
            await internalFetch(config, `/v1/extensions/${encodeURIComponent(comp.registeredAs as string)}/activate`, jwt, { method: 'POST' });
            log.info(`[${cid}] Activated extension: ${comp.registeredAs as string}`);
          } catch (e) {
            log.warn(`[${cid}] Extension activation failed: ${(e as Error).message}`);
          }

          // ── PROBE ──
          try {
            const probeResp = await internalFetch(config, `/v1/generator/${projectId}/probe-extension`, jwt, {
              method: 'POST',
              body: { extensionName: comp.registeredAs, scenarios: buildProbeScenarios(blueprint, comp, content) },
            });
            const probeResults = ((probeResp.data as Record<string, unknown>)?.results as unknown[]) || [];
            const contextBundle = modules.createBundle({ ...comp, registeredAs: comp.registeredAs }, probeResults);
            comp = { ...comp, probeResults, contextBundle };
            await saveComp(comp);
            log.info(`[${cid}] Probed extension: ${probeResults.length} actions`);

            // Spec-vs-probe validation
            if (comp.spec && probeResults.length > 0) {
              const sv = modules.validateSpecAgainstProbe(comp.spec, probeResults);
              if (!sv.valid) {
                log.warn(`[${cid}] Spec-vs-probe mismatch: ${(sv.mismatches as Array<{message: string}>).map(m => m.message).join('; ')}`);
              }
            }
          } catch (e) {
            log.warn(`[${cid}] Extension probe failed: ${(e as Error).message}`);
          }
        }

        // ── CORTEX ACTIVATE ──
        if (compType === 'cortex' && comp.registeredAs) {
          // Already activated during registration above
        }

        // ── TEST ──
        if (['extension', 'cortex'].includes(compType) && comp.registeredAs) {
          try {
            let testPromptText: string;
            if (comp.spec && compType === 'extension') {
              testPromptText = modules.buildExtensionTestFromSpec(comp.spec, comp.registeredAs as string);
            } else if (comp.spec && compType === 'cortex' && (comp.spec as Record<string, unknown>).wrapsExtension) {
              testPromptText = modules.buildDataCortexTestFromSpec(comp.spec);
            } else {
              testPromptText = modules.buildTestPrompt(compType, content, compLabel, comp.registeredAs, blueprint, interviewSpec, comp.probeResults || null);
            }

            log.info(`[${cid}] Generating test for ${compLabel}`);
            let testCode = await callLLM(testPromptText);
            testCode = modules.stripCodeblock(testCode);

            const testEnvironment = (compType === 'cortex' || compType === 'app') ? 'browser' : 'server';
            const testResp = await internalFetch(config, `/v1/generator/${projectId}/test/${cid}`, jwt, {
              method: 'POST',
              body: { testCode, environment: testEnvironment },
            });
            const testResult = (testResp.data as Record<string, unknown>)?.result as Record<string, unknown>;
            if (testResult) {
              comp = { ...comp, testCode, testResult };
              await saveComp(comp);
              log.info(`[${cid}] Test: ${testResult.status as string}`);
            }
          } catch (e) {
            log.warn(`[${cid}] Test execution failed: ${(e as Error).message}`);
          }
        }

        entry.status.progress.completed++;
        entry.status.componentResults.push({ id: cid, label: compLabel, status: 'completed' });
        emitChange('memory');

      } catch (componentErr) {
        log.error(`[${cid}] Uncaught error processing ${compLabel}: ${(componentErr as Error).message}`);
        entry.status.progress.failed++;
        entry.status.componentResults.push({ id: cid, label: compLabel, status: 'error', error: (componentErr as Error).message });
        // Continue to next component
      }
    }

    updateStatus({
      status: entry.cancelFlag ? 'cancelled' : 'completed',
      currentComponent: null,
    });
    log.info(`Autopilot finished: ${entry.status.progress.completed} completed, ${entry.status.progress.failed} failed, ${entry.status.progress.skipped} skipped`);

  } catch (fatalErr) {
    log.error(`Autopilot fatal error: ${(fatalErr as Error).message}`);
    updateStatus({ status: 'failed', currentComponent: null });
  } finally {
    // Keep status for 1 hour, then clean up
    setTimeout(() => runningAutopilots.delete(projectId), 60 * 60 * 1000);
  }
}

// ── Helpers ──

function extractRegisteredName(type: string, content: string, vr: { extracted?: unknown }): string | null {
  if (type === 'extension' || type === 'cortex') {
    const nameMatch = (typeof content === 'string' ? content : '').match(/name:\s*"?([^\s"]+)"?/);
    return nameMatch?.[1] || null;
  }
  if (type === 'csm' || type === 'msm') {
    const nameMatch = (typeof content === 'string' ? content : '').match(/name:\s*"?([^\s"]+)"?/);
    return nameMatch?.[1] || null;
  }
  return null;
}

function buildProbeScenarios(blueprint: Record<string, unknown>, comp: Record<string, unknown>, content: string): Array<{ action: string; input: Record<string, unknown> }> {
  const bpComp = ((blueprint.components as Array<Record<string, unknown>>) || []).find((c: Record<string, unknown>) => c.label === comp.label);
  const bpScenarios = ((blueprint.testScenarios as Array<Record<string, unknown>>) || [])
    .filter((ts: Record<string, unknown>) => ts.component === bpComp?.id)
    .flatMap((ts: Record<string, unknown>) => (ts.scenarios as Array<{ action: string; input: Record<string, unknown> }>) || []);

  if (bpScenarios.length > 0) {
    return bpScenarios.map(s => ({ action: s.action, input: s.input || {} }));
  }
  // Fallback: extract action names from YAML
  const actionMatches = [...content.matchAll(/- id:\s*"?([^\s"]+)/g)];
  return actionMatches.map(m => ({ action: m[1], input: {} }));
}
