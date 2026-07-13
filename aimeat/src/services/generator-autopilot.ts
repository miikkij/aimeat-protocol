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
 *   v1.1.0 — 2026-06-06 — Spec/code/test prompts now built via the canonical
 *     GET /v1/generator/:projectId/prompts/:cid?type=spec|code|test route — the exact
 *     same path the browser UI uses (generator-detail.js loadPromptFromBackend). Removes
 *     divergent inline prompt construction that gated spec generation on in-memory
 *     comp.spec and silently produced empty specs / specs that never reached the code
 *     prompt. Order now matches the UI: spec → validate → store → code (with stored spec).
 *   v1.2.0 — 2026-06-06 — Spec persistence now goes through the canonical
 *     POST /v1/generator/:projectId/components/:cid/spec endpoint (the same store the UI's
 *     "Save Spec" writes to: generator.<project>.spec.<id>), replacing a direct
 *     storage.setMemory with hardcoded version:1 + swallowed error that silently dropped
 *     the spec on re-runs. The browser reads specs back from this key (loadAllComponents
 *     merges specMap[id]), so this is what makes generated specs appear in the UI on refresh.
 *   v1.3.0 — 2026-06-06 — (a) Validation auto-retry count now honors the user's configured
 *     openrouter.settings.maxRetries (1-10) instead of a hardcoded 3 — each retry still sends the
 *     validator errors back to the LLM via gen-fix. (b) Honors the "Testauslaajuus" test scope:
 *     scope 'none' skips the test phase so a test failure can no longer break the pipeline before
 *     later components get their spec/code/register steps (which left their spec boxes empty).
 *   v1.4.0 — 2026-07-01 — Vendor-neutral default: replace the hardcoded anthropic/claude-sonnet-4
 *     fallback with OpenRouter's free-models router 'openrouter/free'.
 *   v1.5.0 — 2026-07-13 — Extract internalFetch/extractRegisteredName/buildProbeScenarios to
 *     generator-autopilot-helpers.ts and the spec + test/fix phases to generator-autopilot-phases.ts
 *     (max-file-lines). Behavior unchanged; runAutopilot orchestrates the phases via a shared context.
 */

import { type Storage } from '../storage/interface.js';
import { type AimeatConfig } from '../config.js';
import { complete as openrouterComplete } from './openrouter.js';
import { getEncryptionKey } from './encryption.js';
import { decrypt } from './encryption.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';
import { GeneratorDebugWriter } from './generator-debug.js';
import { issueJWT } from '../auth/jwt.js';

const log = { info: (m: string) => logger.info(m), warn: (m: string) => logger.warn(m), error: (m: string) => logger.error(m) };

// ── Clean TypeScript imports from src/services/generator-prompts/ ──
// No browser imports, no pathToFileURL hacks, no dynamic import()
import { buildPrompt, stripCodeblock, createBundle } from './generator-prompts/index.js';
import { validateComponent, verifyContract } from './generator-prompts/validate.js';
import { validateSpecAgainstProbe } from './generator-prompts/spec-validate.js';
import type { PromptRuntimeData, ComponentState, ProbeResult, Blueprint, InterviewSpec } from './generator-prompts/types.js';
import { internalFetch, extractRegisteredName, buildProbeScenarios } from './generator-autopilot-helpers.js';
import { type AutopilotRunCtx, runSpecPhase, runTestPhase } from './generator-autopilot-phases.js';

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

// ── Main autopilot loop ──

export async function runAutopilot(
  projectId: string,
  ownerGhii: string,
  ownerName: string,
  _jwt: string,
  config: AimeatConfig,
  storage: Storage,
  testScope: 'comprehensive' | 'basic' | 'none' = 'comprehensive',
): Promise<void> {
  // Logger is the module-level winston wrapper defined above

  if (isAutopilotRunning(projectId)) {
    throw new Error('Autopilot already running for this project');
  }

  // Mint our own internal JWT — don't depend on the browser's token.
  // The frontend JWT could expire or get revoked during long-running pipelines.
  // 4-hour TTL, owner role, wildcard scopes — this is a trusted server-side process.
  const jwt = await issueJWT({
    sub: ownerName,
    owner: ownerName,
    node: config.nodeId,
    roles: ['owner'],
    scopes: ['*'],
  }, 4 * 60 * 60); // 4 hours
  log.info(`Autopilot minted internal JWT for ${ownerName} (4h TTL)`);

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
  const model = (prefs.model as string) || (prefs.executionModel as string) || 'openrouter/free';
  const temperature = (prefs.temperature as number) ?? undefined;
  // Validation auto-retry count — honor the user's OpenRouter setting (clamped 1-10, default 3),
  // the SAME value the browser UI uses (orSettings.maxRetries, generator-detail.js:461). The old
  // hardcoded 3 ignored the configured value, so a project set to 10 still gave up after 3 and
  // `break`ed the whole pipeline. The autopilot always retries up to this many times (it can't
  // fall back to a manual copy-paste like the UI can when autoRetry is off).
  const maxValidationRetries = Math.max(1, Math.min(10, Number(prefs.maxRetries) || 3));
  log.info(`Autopilot validation auto-retry budget: ${maxValidationRetries} (from openrouter.settings.maxRetries)`);

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
    const data = Object.fromEntries(Object.entries(comp).filter(([k]) => k !== '_version'));
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

  // ── Debug artifact writer ──
  const debug = new GeneratorDebugWriter(projectId);

  // Autopilot log lines — written to both terminal AND project debug dir
  const autopilotLog: string[] = [];
  const alog = {
    info: (m: string) => { log.info(m); autopilotLog.push(`[INFO] ${new Date().toISOString()} ${m}`); },
    warn: (m: string) => { log.warn(m); autopilotLog.push(`[WARN] ${new Date().toISOString()} ${m}`); },
    error: (m: string) => { log.error(m); autopilotLog.push(`[ERROR] ${new Date().toISOString()} ${m}`); },
    flush: () => debug.writeArtifact('_autopilot', 'terminal-log', autopilotLog.join('\n')).catch(() => {}),
  };

  // Write project metadata at start
  debug.writeProjectMeta(
    { projectId, name: project.name, description: project.description },
    interviewSpec,
    blueprint,
  ).catch(() => {});

  // Shared context for the extracted spec + test phases (they close over the same loop state).
  const ctx: AutopilotRunCtx = {
    config, jwt, projectId, ownerGhii, storage,
    blueprint, interviewSpec,
    debug, alog, callLLM, saveComp, entry,
  };
  // ── Main loop ──
  try {
    for (const cid of phaseOrder) {
      if (entry.cancelFlag) break;

      const comps = await loadComponents();
      // Enrich with subtype from blueprint and auto-fix stored records
      const bpComps = (blueprint.components as Array<Record<string, unknown>>) || [];
      for (const fc of comps) {
        if (!fc.subtype) {
          const bpc = bpComps.find(b => b.label === fc.label || b.id === fc.id);
          if (bpc?.subtype) {
            fc.subtype = bpc.subtype;
            alog.warn(`[${fc.id}] ⚠️ SUBTYPE MISSING — auto-fixing to "${bpc.subtype}"`);
            // Permanently fix the stored record
            const key = `generator.${projectId}.component.${fc.id as string}`;
            const rec = await storage.getMemory(ownerGhii, key);
            if (rec) {
              const val = rec.value as Record<string, unknown>;
              val.subtype = bpc.subtype;
              await storage.setMemory({ ...rec, value: val, version: (rec.version ?? 1) + 1, updatedAt: new Date().toISOString() }).catch(() => {});
            }
          }
        }
      }
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

      // Phase gate: only process types enabled for this run.
      // Enable one phase at a time. Verify each before enabling the next.
      const ENABLED_TYPES = ['csm', 'memory', 'translation', 'extension', 'cortex']; // Phase gate: stop after cortex — app gated
      // Cortex subtype gate: only cortex-data for now
      const ENABLED_CORTEX_SUBTYPES = ['data', 'component', 'app-domain'];
      if (!ENABLED_TYPES.includes(compType)) {
        alog.info(`[${cid}] Phase gate: ${compType} not enabled yet — stopping pipeline`);
        entry.status.componentResults.push({ id: cid, label: compLabel, status: 'phase_gated' });
        break;
      }

      // Cortex subtype gate
      if (compType === 'cortex') {
        const bpC = ((blueprint.components as Array<Record<string, unknown>>) || []).find((c: Record<string, unknown>) => c.label === compLabel);
        const sub = (bpC?.subtype as string) || '';
        if (!ENABLED_CORTEX_SUBTYPES.includes(sub)) {
          alog.info(`[${cid}] Cortex subtype gate: ${sub} not enabled yet — stopping pipeline (enabled: ${ENABLED_CORTEX_SUBTYPES.join(', ')})`);
          entry.status.componentResults.push({ id: cid, label: compLabel, status: 'phase_gated' });
          break;
        }
      }

      updateStatus({ currentComponent: compLabel });
      alog.info(`[${cid}] Processing: ${compLabel} (${compType})`);

      try {
        // ── SPEC GENERATION ──
        comp = await runSpecPhase(ctx, cid, compLabel, compType, comp);

        if (entry.cancelFlag) break;

        // ── CODE GENERATION ──
        // Build the code prompt through the SAME backend route the browser UI uses
        // (GET /prompts/:cid?type=code) — identical to loadPromptFromBackend(projectId, id,
        // 'code') in generator-detail.js, which the UI re-runs right after "Save Spec". The
        // route loads THIS component's just-stored spec (generator.<project>.spec.<cid>) as
        // selfSpec, plus every prior registered component (with their specs + context bundles),
        // so the spec is embedded in the code prompt exactly as in the manual UI flow. The old
        // inline construction duplicated this logic and read selfSpec from comp.spec, which was
        // often empty — so the spec never reached the prompt.
        alog.info(`[${cid}] Building code prompt for ${compLabel}`);
        const codePromptResp = await internalFetch(config, `/v1/generator/${projectId}/prompts/${encodeURIComponent(cid)}?type=code`, jwt);
        const prompt: string = ((codePromptResp.data as Record<string, unknown>)?.prompt as string) || '';
        if (!codePromptResp.ok || !prompt) {
          throw new Error(`Failed to build code prompt for ${compLabel} (status ${codePromptResp.status}): ${JSON.stringify(codePromptResp.error)}`);
        }

        alog.info(`[${cid}] Calling OpenRouter for ${compLabel} (prompt: ${(prompt as string).length} chars)`);
        debug.writeComponentPrompt(cid, prompt as string).catch(() => {});
        let content = await callLLM(prompt as string);
        debug.writeArtifact(cid, 'ai-raw-response', content).catch(() => {});
        // Cortex validator needs the fenced blocks (```yaml + ```javascript) to extract manifest+libs.
        // stripCodeblock would remove them, making the validator unable to parse the format.
        if (compType !== 'cortex') {
          content = stripCodeblock(content);
        }
        debug.writeComponentGenerated(cid, content).catch(() => {});

        // ── VALIDATE ──
        let vr = validateComponent(compType, content, blueprint as unknown as Blueprint);

        // Auto-retry on validation failure — each retry sends the validator's errors back to the
        // LLM via the gen-fix prompt (original task + failing code + errors), exactly like the UI's
        // buildFixPrompt. Count comes from the user's configured maxRetries (not a hardcoded 3).
        if (!vr.valid) {
          const maxRetries = maxValidationRetries;
          for (let attempt = 1; attempt <= maxRetries && !vr.valid && !entry.cancelFlag; attempt++) {
            alog.info(`[${cid}] Validation retry ${attempt}/${maxRetries} for ${compLabel} — sending ${vr.errors.length} validator error(s) back to the LLM`);
            const fixPrompt = await buildPrompt(storage, 'gen-fix', { blueprint: blueprint as unknown as Blueprint, interviewSpec: interviewSpec as unknown as InterviewSpec, originalPrompt: prompt, code: content, errors: vr.errors, componentType: compType } as unknown as PromptRuntimeData);
            debug.writeArtifact(cid, `validation-fix-${attempt}-prompt`, fixPrompt).catch(() => {});
            content = await callLLM(fixPrompt);
            debug.writeArtifact(cid, `validation-fix-${attempt}-response`, content).catch(() => {});
            if (compType !== 'cortex') content = stripCodeblock(content);
            vr = validateComponent(compType, content, blueprint as unknown as Blueprint);
          }
        }

        if (!vr.valid) {
          alog.error(`[${cid}] Validation failed for ${compLabel} — STOPPING pipeline: ${vr.errors[0]}`);
          comp = { ...comp, result: content, status: 'errors', validationErrors: vr.errors };
          await saveComp(comp);
          entry.status.progress.failed++;
          entry.status.componentResults.push({ id: cid, label: compLabel, status: 'validation_failed', error: vr.errors[0] });
          break; // STOP — downstream components depend on this one
        }

        // ── CONTRACT VERIFICATION ──
        const bpCompForContract = ((blueprint.components as Array<Record<string, unknown>>) || [])
          .find((c: Record<string, unknown>) => c.label === compLabel || c.id === cid);
        if (bpCompForContract) {
          const cr = verifyContract(compType, content, bpCompForContract as unknown as import('./generator-prompts/types.js').BlueprintComponent, blueprint as unknown as import('./generator-prompts/types.js').Blueprint);
          if (!cr.valid) {
            alog.warn(`[${cid}] Contract mismatches: ${cr.mismatches.join('; ')}`);
            // Attempt one fix round with contract errors
            const contractFixPrompt = await buildPrompt(storage, 'gen-fix', {
              blueprint: blueprint as unknown as Blueprint, interviewSpec: interviewSpec as unknown as InterviewSpec,
              originalPrompt: prompt, code: content,
              errors: cr.mismatches.map(m => `Contract: ${m}`),
              componentType: compType,
            } as unknown as PromptRuntimeData);
            let fixedContent = await callLLM(contractFixPrompt);
            if (compType !== 'cortex') fixedContent = stripCodeblock(fixedContent);
            const fixVr = validateComponent(compType, fixedContent, blueprint as unknown as Blueprint);
            if (fixVr.valid) {
              const fixCr = verifyContract(compType, fixedContent, bpCompForContract as unknown as import('./generator-prompts/types.js').BlueprintComponent, blueprint as unknown as import('./generator-prompts/types.js').Blueprint);
              if (fixCr.valid) {
                content = fixedContent;
                alog.info(`[${cid}] Contract fix succeeded`);
              } else {
                alog.warn(`[${cid}] Contract fix still has mismatches — proceeding with original: ${fixCr.mismatches.join('; ')}`);
              }
            } else {
              alog.warn(`[${cid}] Contract fix broke validation — proceeding with original`);
            }
          }
        }

        // ── REGISTER ──
        alog.info(`[${cid}] Registering ${compLabel}`);
        comp = { ...comp, result: content, status: 'done', validationErrors: [] };
        await saveComp(comp);

        // Use internal HTTP to register — reuses all existing validation/registration logic
        try {
          // Submit content first
          const submitResp = await internalFetch(config, `/v1/generator/${projectId}/components/${cid}/submit`, jwt, {
            method: 'POST',
            body: { content, type: compType },
          });
          if (!submitResp.ok) {
            alog.warn(`[${cid}] Submit failed (${submitResp.status}): ${JSON.stringify(submitResp.error)}`);
            throw new Error(`Submit failed: ${JSON.stringify(submitResp.error)}`);
          }

          // For types that have catalogue registration (CSM, MSM, Extension, App)
          if (['csm', 'msm', 'extension', 'app'].includes(compType)) {
            alog.info(`[${cid}] Calling register endpoint for ${compType}...`);
            const regResp = await internalFetch(config, `/v1/generator/${projectId}/components/${cid}/register`, jwt, { method: 'POST' });
            if (!regResp.ok) {
              alog.error(`[${cid}] ❌ Register FAILED (${regResp.status}): ${JSON.stringify(regResp.error)}`);
              throw new Error(`Registration failed: ${JSON.stringify(regResp.error)}`);
            }
            alog.info(`[${cid}] ✅ Register succeeded for ${compType}`);
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
            // service_slug comes from blueprint — the single source of truth
            const serviceSlug = (blueprint as Record<string, unknown>).service_slug as string;
            if (!serviceSlug) {
              throw new Error(`Blueprint missing "service_slug" — cannot namespace memory keys. Regenerate blueprint with service_slug field.`);
            }

            alog.info(`[${cid}] serviceSlug="${serviceSlug}" (from blueprint.service_slug)`);

            if (compType === 'memory') {
              const stripped = typeof content === 'string' ? stripCodeblock(content) : content;
              const entries = typeof stripped === 'string' ? JSON.parse(stripped) : stripped;
              const rawKeys = Object.keys(entries);
              for (const [rawKey, value] of Object.entries(entries)) {
                const key = rawKey.startsWith(serviceSlug + '.') ? rawKey : `${serviceSlug}.${rawKey}`;
                alog.info(`[${cid}] Memory key: "${rawKey}" → stored as "${key}" (owner: ${ownerGhii})`);
                await storage.setMemory({
                  key, ownerGaii: ownerGhii, value, visibility: 'public',
                  version: 1, tags: ['generator', 'memory'], ttlHours: null,
                  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                });
              }
              alog.info(`[${cid}] Memory: ${rawKeys.length} keys stored with prefix "${serviceSlug}"`);
              debug.writeComponentArtifact(cid, 'memory-keys', rawKeys.map(k => `${k} → ${serviceSlug}.${k}`).join('\n')).catch(() => {});
            }

            if (compType === 'translation') {
              const stripped = typeof content === 'string' ? stripCodeblock(content) : content;
              const translations = typeof stripped === 'string' ? JSON.parse(stripped) : stripped;
              for (const [locale, strings] of Object.entries(translations)) {
                if (locale && typeof strings === 'object') {
                  const key = `${serviceSlug}.i18n.${locale}`;
                  const keyCount = Object.keys(strings as object).length;
                  alog.info(`[${cid}] Translation: locale="${locale}" → stored as "${key}" (${keyCount} keys, owner: ${ownerGhii})`);
                  await storage.setMemory({
                    key, ownerGaii: ownerGhii, value: strings, visibility: 'public',
                    version: 1, tags: ['generator', 'translation'], ttlHours: null,
                    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                  });
                }
              }
              debug.writeComponentArtifact(cid, 'translation-keys', Object.keys(translations).map(l => `${l} → ${serviceSlug}.i18n.${l}`).join('\n')).catch(() => {});
            }
          }

          // Determine registered name — memory/translation include serviceSlug prefix to match stored keys
          let regName = comp.registeredAs || extractRegisteredName(compType, content, vr);
          if ((compType === 'memory' || compType === 'translation') && regName) {
            const slug = (blueprint as Record<string, unknown>).service_slug as string;
            if (!slug) throw new Error(`Blueprint missing "service_slug" — cannot determine registered name for ${compLabel}`);
            if (!(regName as string).startsWith(slug + '.')) regName = `${slug}.${regName as string}`;
          }
          comp = { ...comp, registeredAs: regName, contextBundle: createBundle({ ...comp, registeredAs: regName } as unknown as ComponentState, []) };
          await saveComp(comp);
          alog.info(`[${cid}] Registered: ${compLabel} as ${regName as string}`);

        } catch (regErr) {
          alog.error(`[${cid}] Registration failed for ${compLabel} — STOPPING pipeline: ${(regErr as Error).message}`);
          entry.status.progress.failed++;
          entry.status.componentResults.push({ id: cid, label: compLabel, status: 'registration_failed', error: (regErr as Error).message });
          break; // STOP — downstream components depend on this one
        }

        // ── SMOKE TEST ──
        if (['extension', 'cortex', 'app'].includes(compType) && comp.registeredAs) {
          try {
            if (compType === 'extension') {
              const smokeResp = await internalFetch(config, `/v1/extensions/${encodeURIComponent(comp.registeredAs as string)}/activate`, jwt, { method: 'POST' });
              if (!smokeResp.ok) {
                alog.warn(`[${cid}] Smoke test failed: extension activation error (${smokeResp.status})`);
              } else {
                alog.info(`[${cid}] Smoke test passed: extension activates`);
              }
            } else if (compType === 'cortex') {
              const libUrl = `/v1/cortex/${encodeURIComponent(comp.registeredAs as string)}/libs/${encodeURIComponent(comp.registeredAs as string)}.js`;
              const smokeResp = await internalFetch(config, libUrl, jwt, { method: 'GET' });
              if (!smokeResp.ok) {
                alog.warn(`[${cid}] Smoke test failed: cortex lib not accessible (${smokeResp.status})`);
              } else {
                alog.info(`[${cid}] Smoke test passed: cortex lib accessible`);
              }
            } else if (compType === 'app') {
              const appUrl = `/v1/apps/${encodeURIComponent(ownerGhii.split('@')[0])}/${encodeURIComponent(comp.registeredAs as string)}`;
              const smokeResp = await internalFetch(config, appUrl, jwt, { method: 'GET' });
              if (!smokeResp.ok) {
                alog.warn(`[${cid}] Smoke test failed: app not accessible (${smokeResp.status})`);
              } else {
                alog.info(`[${cid}] Smoke test passed: app accessible`);
              }
            }
          } catch (e) {
            alog.warn(`[${cid}] Smoke test error: ${(e as Error).message}`);
          }
        }

        // ── ACTIVATE EXTENSION ──
        if (compType === 'extension' && comp.registeredAs) {
          try {
            await internalFetch(config, `/v1/generator/${projectId}/apply-settings/${encodeURIComponent(comp.registeredAs as string)}`, jwt, { method: 'POST' });
            await internalFetch(config, `/v1/extensions/${encodeURIComponent(comp.registeredAs as string)}/activate`, jwt, { method: 'POST' });
            alog.info(`[${cid}] Activated extension: ${comp.registeredAs as string}`);
          } catch (e) {
            alog.warn(`[${cid}] Extension activation failed: ${(e as Error).message}`);
          }

          // ── PROBE ──
          try {
            const probeResp = await internalFetch(config, `/v1/generator/${projectId}/probe-extension`, jwt, {
              method: 'POST',
              body: { extensionName: comp.registeredAs, scenarios: buildProbeScenarios(blueprint, comp, content) },
            });
            const probeResults = ((probeResp.data as Record<string, unknown>)?.results as unknown[]) || [];
            const contextBundle = createBundle({ ...comp, registeredAs: comp.registeredAs as string } as unknown as ComponentState, probeResults as unknown as ProbeResult[]);
            comp = { ...comp, probeResults, contextBundle };
            await saveComp(comp);
            alog.info(`[${cid}] Probed extension: ${probeResults.length} actions`);

            // Check if ALL probes failed — means extension code is fundamentally broken
            const probeFailCount = probeResults.filter((p: unknown) => (p as Record<string, unknown>).status !== 200).length;
            if (probeResults.length > 0 && probeFailCount === probeResults.length) {
              alog.error(`[${cid}] ALL ${probeResults.length} probe actions failed — extension code is broken, STOPPING`);
              entry.status.progress.failed++;
              entry.status.componentResults.push({ id: cid, label: compLabel, status: 'probe_all_failed', error: `All ${probeResults.length} actions returned errors` });
              break; // STOP — downstream components need working extension
            }

            // Spec-vs-probe validation
            if (comp.spec && probeResults.length > 0) {
              const sv = validateSpecAgainstProbe(comp.spec as Record<string, unknown>, probeResults as unknown as ProbeResult[]);
              if (!sv.valid) {
                alog.warn(`[${cid}] Spec-vs-probe mismatch: ${(sv.mismatches as Array<{message: string}>).map(m => m.message).join('; ')}`);
              }
            }
          } catch (e) {
            alog.warn(`[${cid}] Extension probe failed: ${(e as Error).message}`);
          }
        }

        // ── CORTEX ACTIVATE ──
        if (compType === 'cortex' && comp.registeredAs) {
          // Already activated during registration above
        }

        // ── TEST (extracted to generator-autopilot-phases.ts) ──
        const testOutcome = await runTestPhase(ctx, cid, compLabel, compType, comp, content, prompt, testScope);
        comp = testOutcome.comp;
        content = testOutcome.content;
        const testPassed = testOutcome.testPassed;

        if (!testPassed) {
          const testErrors = ((comp.testResult as Record<string, unknown>)?.errors as string[]) || [];
          alog.error(`[${cid}] Test failed after all fix rounds — STOPPING pipeline: ${testErrors[0] || 'test failed'}`);
          entry.status.progress.failed++;
          entry.status.componentResults.push({ id: cid, label: compLabel, status: 'test_failed', error: testErrors[0] || 'Test failed after all fix rounds' });
          break;
        }

        entry.status.progress.completed++;
        entry.status.componentResults.push({ id: cid, label: compLabel, status: 'completed' });
        emitChange('memory');

      } catch (componentErr) {
        alog.error(`[${cid}] Uncaught error processing ${compLabel} — STOPPING pipeline: ${(componentErr as Error).message}`);
        entry.status.progress.failed++;
        entry.status.componentResults.push({ id: cid, label: compLabel, status: 'error', error: (componentErr as Error).message });
        break; // STOP — don't continue with broken state
      }
    }

    updateStatus({
      status: entry.cancelFlag ? 'cancelled' : (entry.status.progress.failed > 0 ? 'failed' : 'completed'),
      currentComponent: null,
    });
    // Final summary with per-component status
    alog.info(`\n${'═'.repeat(60)}`);
    alog.info(`AUTOPILOT ${entry.status.progress.failed > 0 ? 'FAILED' : 'COMPLETED'}: ${entry.status.progress.completed} completed, ${entry.status.progress.failed} failed, ${entry.status.progress.skipped} skipped`);
    for (const cr of entry.status.componentResults) {
      const icon = cr.status === 'completed' || cr.status === 'already_registered' ? '✅' : cr.status === 'phase_gated' ? '⏸️' : '❌';
      alog.info(`  ${icon} ${cr.label} — ${cr.status}${cr.error ? ': ' + cr.error : ''}`);
    }
    alog.info(`${'═'.repeat(60)}\n`);

  } catch (fatalErr) {
    alog.error(`Autopilot fatal error: ${(fatalErr as Error).message}`);
    updateStatus({ status: 'failed', currentComponent: null });
  } finally {
    // Save complete autopilot terminal log to project debug directory
    alog.flush();
    // Keep status for 1 hour, then clean up
    setTimeout(() => runningAutopilots.delete(projectId), 60 * 60 * 1000);
  }
}
