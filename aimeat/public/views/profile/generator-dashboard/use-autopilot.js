/**
 * @file use-autopilot.js
 * @description Custom hook for the autopilot generation pipeline — the most complex
 *   hook in the system. Iterates through all unregistered components in phase order,
 *   generates code via AI, validates, auto-retries on failure, registers, applies
 *   settings, activates, and runs per-component tests with fix loops.
 *
 *   Part of the hook-per-domain architecture for ProjectDashboard. This hook has NO
 *   own state — it uses autopilotState (from useAutopilotState) for UI state and
 *   testExec.pushTestResult (from useTestExecution) for test result accumulation.
 *
 *   STALE CLOSURE WARNING: handleRunAll runs for minutes. All reads of state that
 *   might change during execution use refs (testExec.testScopeRef, testExec.testReportRef)
 *   or fresh API calls (loadAllComponents). core.project and core.interviewSpec are
 *   read once at call time — they don't change during autopilot.
 *
 *   Architecture: useDashboardCore → useAutopilot ← useAutopilotState
 *                                                 ← useTestExecution (pushTestResult, refs)
 *
 * @structure
 *   - useAutopilot(core, autopilotState, projectId, orSettings, session, testExec, showToast): custom hook
 *     State: none (uses autopilotState)
 *     Handler: handleRunAll
 * @usage
 *   import { useAutopilot } from './generator-dashboard/use-autopilot.js';
 *   const autopilot = useAutopilot(core, autopilotState, projectId, orSettings, session, testExec, showToast);
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js ProjectDashboard
 */
import { t } from '/js/i18n.js';
import { apiPost, apiDelete } from '/js/api.js';
import {
  loadAllComponents, saveComponent, registerComponent, writeProjectLog, writeDebugArtifact,
} from '/js/services/generator.js';
import { buildComponentPrompt, buildFixPrompt, buildReflectionPrompt, buildFreshGenerationPrompt, buildTestPrompt } from '/js/services/generator-prompts.js';
import { validateComponent } from '/js/services/generator-validate.js';
import { runComponentTest, probeExtension } from '/js/services/generator-testing.js';
import { createBundle } from '/js/services/generator-context-bundle.js';
import { runWithAi, stripCodeblock } from '../generator-detail.js';
// ── Spec-driven pipeline imports ──
import {
  buildExtensionSpecPrompt, buildDataApiSpecPrompt, buildComponentSpecPrompt,
  buildAppDomainSpecPrompt, formatSpecForPrompt,
} from '/js/services/generator-specs.js';
import {
  validateExtensionSpec, validateDataApiSpec, validateComponentSpec,
  validateAppDomainSpec, validateSpecAgainstProbe,
} from '/js/services/generator-spec-validate.js';
import {
  buildExtensionTestFromSpec, buildDataCortexTestFromSpec, buildIntegrationTest,
} from '/js/services/generator-spec-tests.js';

/**
 * @param {Object} core — useDashboardCore return value
 * @param {Object} autopilotState — useAutopilotState return value
 * @param {string} projectId
 * @param {Object} orSettings — { hasApiKey, autoRetry, maxRetries }
 * @param {Object} session
 * @param {Object} testExec — useTestExecution return value (testScopeRef, testReportRef, pushTestResult)
 * @param {Function} showToast
 */
export function useAutopilot(core, autopilotState, projectId, orSettings, session, testExec, showToast) {

  // ── Spec generation helper ──
  // Generates a spec for a component. Spec is generated BEFORE code — spec is king.
  // Returns parsed JSON spec or null on failure.
  async function generateSpec(comp, project, interviewSpec) {
    const blueprint = project.blueprint;
    const bpComp = blueprint?.components?.find(c => c.label === comp.label);
    if (!bpComp) return null;

    let specPrompt = null;
    let validatorFn = null;

    if (comp.type === 'extension') {
      specPrompt = buildExtensionSpecPrompt({ blueprint, blueprintComponent: bpComp, interviewSpec });
      validatorFn = validateExtensionSpec;
    } else if (comp.type === 'cortex' && (bpComp.subtype === 'data' || comp.label?.toLowerCase().includes('data'))) {
      const allComps = await loadAllComponents(projectId);
      const extComp = allComps.find(c => c.type === 'extension' && c.spec);
      if (!extComp?.spec) { showToast?.(`${comp.label}: No extension spec found — generate extension first`, true); return null; }
      specPrompt = buildDataApiSpecPrompt({ extensionSpec: extComp.spec, blueprint });
      validatorFn = validateDataApiSpec;
    } else if (comp.type === 'cortex' && (bpComp.subtype === 'component' || bpComp.id?.startsWith('component-'))) {
      const allComps = await loadAllComponents(projectId);
      const dataCortex = allComps.find(c => c.type === 'cortex' && c.spec && (c.subtype === 'data' || c.label?.toLowerCase().includes('data')));
      if (!dataCortex?.spec) { showToast?.(`${comp.label}: No data API spec found — generate data cortex first`, true); return null; }
      const translationKeys = allComps
        .filter(c => c.type === 'translation' && c.contextBundle?.keys)
        .flatMap(c => c.contextBundle.keys);
      const viewDef = interviewSpec?.views?.find(v =>
        comp.label.toLowerCase().includes((v.title || '').toLowerCase())
      );
      specPrompt = buildComponentSpecPrompt({ dataApiSpec: dataCortex.spec, componentLabel: comp.label, viewDefinition: viewDef, translationKeys });
      validatorFn = validateComponentSpec;
    } else if (comp.type === 'cortex' && (bpComp.subtype === 'app-domain' || bpComp.id?.startsWith('cortex-app'))) {
      const allComps = await loadAllComponents(projectId);
      const dataCortex = allComps.find(c => c.type === 'cortex' && c.spec && (c.subtype === 'data' || c.label?.toLowerCase().includes('data')));
      const componentSpecs = allComps
        .filter(c => c.spec && (c.subtype === 'component' || c.id?.startsWith?.('component-')))
        .map(c => c.spec);
      const translationKeys = allComps
        .filter(c => c.type === 'translation' && c.contextBundle?.keys)
        .flatMap(c => c.contextBundle.keys);
      if (!dataCortex?.spec) { showToast?.(`${comp.label}: No data API spec found`, true); return null; }
      specPrompt = buildAppDomainSpecPrompt({
        componentSpecs, dataApiSpec: dataCortex.spec,
        useCases: interviewSpec?.useCases, translationKeys, views: interviewSpec?.views,
      });
      validatorFn = validateAppDomainSpec;
    }

    if (!specPrompt) return null; // CSM, memory, translation don't need specs

    autopilotState.setStep(comp.label + ' — generating spec...');
    const cid = bpComp.id || comp.id;
    writeDebugArtifact(projectId, cid, 'spec-prompt', specPrompt);
    await writeProjectLog(projectId, 'spec_generating', { meta: { component: comp.label, type: comp.type, by: 'autopilot' } });

    let specRaw;
    try {
      specRaw = await runWithAi(projectId, specPrompt);
    } catch (e) {
      showToast?.(`${comp.label}: Spec generation failed: ${e.message}`, true);
      await writeProjectLog(projectId, 'spec_generation_failed', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
      return null;
    }
    writeDebugArtifact(projectId, cid, 'spec-raw-response', specRaw);

    // Parse JSON — strip markdown fences if present
    let specText = specRaw.trim();
    const fenceMatch = specText.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    if (fenceMatch) specText = fenceMatch[1].trim();

    let spec;
    try {
      spec = JSON.parse(specText);
    } catch (e) {
      showToast?.(`${comp.label}: Spec JSON parse failed`, true);
      writeDebugArtifact(projectId, cid, 'spec-parse-error', e.message + '\n\n' + specText);
      await writeProjectLog(projectId, 'spec_parse_failed', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
      return null;
    }

    // Validate spec structure
    if (validatorFn) {
      const sv = validatorFn(spec);
      if (!sv.valid) {
        showToast?.(`${comp.label}: Spec validation failed: ${sv.errors[0]}`, true);
        writeDebugArtifact(projectId, cid, 'spec-validation-errors', sv.errors.join('\n'));
        await writeProjectLog(projectId, 'spec_validation_failed', { meta: { component: comp.label, errors: sv.errors, by: 'autopilot' } });
        return null;
      }
    }

    writeDebugArtifact(projectId, cid, 'spec', JSON.stringify(spec, null, 2));
    await writeProjectLog(projectId, 'spec_generated', { meta: { component: comp.label, specName: spec.name, actions: spec.actions?.length || spec.methods?.length || 0, by: 'autopilot' } });
    return spec;
  }

  async function handleRunAll() {
    if (!orSettings?.hasApiKey || autopilotState.running) return;
    autopilotState.start();

    // Read project/interviewSpec once — they don't change during autopilot
    const project = core.project;
    const interviewSpec = core.interviewSpec;
    const phases = project?.blueprint?.phases || [];
    const phaseOrder = phases.flatMap(p => p.componentIds || []);

    // Debug: write project metadata at autopilot start
    writeDebugArtifact(projectId, '_project', 'project-meta', {
      project: { projectId, name: project?.name, description: project?.description },
      interviewSpec,
      blueprint: project?.blueprint,
    });

    try {
      // Iterate through all components in phase order
      for (const cid of phaseOrder) {
        if (autopilotState.cancelledRef.current) break;
        // IMPORTANT: always fetch fresh state from API, not from closure (which is stale after loadData)
        const freshComps = await loadAllComponents(projectId);
        const comp = freshComps.find(c => c.id === cid);
        if (!comp || comp.registeredAs) continue; // skip already registered

        autopilotState.setStep(comp.label);
        core.setSelectedId(cid);

        // ── SPEC GENERATION (before code — spec is king) ──
        const specTypes = ['extension', 'cortex'];
        let spec = null;
        if (specTypes.includes(comp.type)) {
          spec = await generateSpec(comp, project, interviewSpec);
          if (spec && !autopilotState.cancelledRef.current) {
            comp = { ...comp, spec };
            await saveComponent(projectId, comp);
          }
        }
        if (autopilotState.cancelledRef.current) break;

        // Build prompt — spec flows as context if available
        const latestComps = await loadAllComponents(projectId);
        const completedComponents = latestComps.filter(c => c.status === 'done' && c.registeredAs);
        const prompt = await buildComponentPrompt(
          comp.type, comp.label,
          project.description, project.blueprint, completedComponents,
          interviewSpec,
        );
        // Run AI
        let content;
        try {
          content = await runWithAi(projectId, prompt);
        } catch (e) {
          showToast?.(`${comp.label}: ${e.message}`, true);
          break;
        }
        if (autopilotState.cancelledRef.current) break;
        // Debug: write full AI exchange — sent prompt, raw response, processed result
        writeDebugArtifact(projectId, cid, 'prompt', prompt);
        writeDebugArtifact(projectId, cid, 'ai-raw-response', content);
        content = stripCodeblock(content);
        writeDebugArtifact(projectId, cid, 'generated', content);

        // Save result
        let updated = { ...comp, result: content, status: 'validating', prompt,
          history: [...(comp.history || []), { action: 'ai_response_received', at: new Date().toISOString(), by: 'autopilot' }],
        };
        await saveComponent(projectId, updated);

        // Validate
        let vr = validateComponent(comp.type, content, project.blueprint);

        // Auto-retry if enabled
        if (!vr.valid && orSettings?.autoRetry) {
          const max = orSettings.maxRetries || 3;
          for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
            if (autopilotState.cancelledRef.current) break;
            autopilotState.setStep(
              comp.label + ' - ' + t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max)
            );
            const fixPrompt = buildFixPrompt(prompt, content, vr.errors, comp.type);
            writeDebugArtifact(projectId, cid, 'fix-prompt-' + attempt, fixPrompt);
            try {
              content = await runWithAi(projectId, fixPrompt);
            } catch (e) {
              showToast?.(`${comp.label}: ${e.message}`, true);
              break;
            }
            writeDebugArtifact(projectId, cid, 'fix-raw-response-' + attempt, content);
            content = stripCodeblock(content);
            vr = validateComponent(comp.type, content, project.blueprint);
          }
        }

        if (!vr.valid) {
          updated = { ...updated, result: content, status: 'errors', validationErrors: vr.errors,
            history: [...updated.history, { action: 'validation_failed', at: new Date().toISOString(), by: 'autopilot', errors: vr.errors }],
          };
          await saveComponent(projectId, updated);
          await core.loadData();
          showToast?.(t('profile.generator.openrouter.stepFailed') + ': ' + comp.label, true);
          break;
        }
        if (autopilotState.cancelledRef.current) break;

        // Validation passed — save and register
        updated = { ...updated, result: content, status: 'done', validationErrors: [],
          history: [...updated.history, { action: 'validation_passed', at: new Date().toISOString(), by: 'autopilot' }],
        };
        await saveComponent(projectId, updated);

        // Register component
        try {
          const extComp = (await loadAllComponents(projectId)).find(c => c.type === 'extension' && c.registeredAs);
          const csmComp = (await loadAllComponents(projectId)).find(c => c.type === 'csm' && c.registeredAs);
          const serviceSlug = extComp?.registeredAs || csmComp?.registeredAs?.split('/')?.pop() || '';

          let resp;
          const doRegister = async () => {
            if (comp.type === 'cortex') {
              const cortexVr = validateComponent('cortex', content, project.blueprint);
              return registerComponent('cortex', cortexVr.extracted, session, serviceSlug);
            }
            return registerComponent(comp.type, vr.extracted || content, session, serviceSlug);
          };
          try {
            resp = await doRegister();
          } catch (regErr) {
            // If "already installed", remove the old one and retry
            if (regErr.message?.includes('already installed') || regErr.message?.includes('already exists') || regErr.message?.includes('409')) {
              const oldName = vr.extracted?.match?.(/name:\s*"?([^\s"]+)/)?.[1] || content?.match?.(/name:\s*"?([^\s"]+)/)?.[1];
              if (oldName) {
                await writeProjectLog(projectId, 'component_reregistering', { meta: { component: comp.label, oldName, by: 'autopilot' } });
                try {
                  const deactUrl = comp.type === 'extension' ? `/v1/extensions/${encodeURIComponent(oldName)}/deactivate` : `/v1/cortex/${encodeURIComponent(oldName)}/deactivate`;
                  await apiPost(deactUrl).catch(() => {});
                  const delUrl = comp.type === 'extension' ? `/v1/extensions/${encodeURIComponent(oldName)}` : `/v1/cortex/${encodeURIComponent(oldName)}`;
                  await apiDelete(delUrl);
                  resp = await doRegister();
                } catch (reregErr) {
                  throw reregErr;
                }
              } else {
                throw regErr;
              }
            } else {
              throw regErr;
            }
          }
          const d = resp?.data || {};
          const regName = d.csm?.name || d.integration?.name || d.extension?.name
            || d.filename || d.name || d.id
            || (d.locales ? `i18n-${d.locales.join('-')}` : null)
            || (d.keys?.length ? `memory:${d.keys[d.keys.length - 1]}` : null)
            || null;
          if (regName) {
            updated = { ...updated, registeredAs: regName,
              history: [...updated.history, { action: 'registered', at: new Date().toISOString(), by: 'autopilot', registeredAs: regName }],
            };
            await saveComponent(projectId, updated);
            await writeProjectLog(projectId, 'component_registered', { meta: { component: comp.label, registeredAs: regName, by: 'autopilot' } });
          }
        } catch (e) {
          const errMsg = e.message || String(e);
          showToast?.(`${comp.label}: Registration failed: ${errMsg}`, true);
          await writeProjectLog(projectId, 'component_registration_failed', { meta: { component: comp.label, type: comp.type, error: errMsg, by: 'autopilot' } });
          await core.loadData();
          break;
        }

        await core.loadData();

        // Apply project settings to extension config (API keys, etc.) + activate
        if ((comp.type === 'extension' || comp.type === 'cortex') && updated.registeredAs) {
          if (comp.type === 'extension') {
            try {
              await apiPost(`/v1/generator/${projectId}/apply-settings/${encodeURIComponent(updated.registeredAs)}`);
              await writeProjectLog(projectId, 'settings_applied', { meta: { component: comp.label, registeredAs: updated.registeredAs, by: 'autopilot' } });
            } catch (e) {
              await writeProjectLog(projectId, 'settings_apply_failed', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
            }
          }
          try {
            const activateUrl = comp.type === 'extension'
              ? `/v1/extensions/${encodeURIComponent(updated.registeredAs)}/activate`
              : `/v1/cortex/${encodeURIComponent(updated.registeredAs)}/activate`;
            await apiPost(activateUrl);
            await writeProjectLog(projectId, 'component_activated', { meta: { component: comp.label, registeredAs: updated.registeredAs, by: 'autopilot' } });
          } catch (e) {
            await writeProjectLog(projectId, 'component_activation_failed', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
          }
        }

        // Probe extension after activation — capture real API responses for downstream prompts
        if (comp.type === 'extension' && updated.registeredAs && !autopilotState.cancelledRef.current) {
          try {
            // Build probe scenarios from blueprint testScenarios or from extension action list
            const bpComp = project.blueprint?.components?.find(c => c.label === comp.label);
            const bpScenarios = (project.blueprint?.testScenarios || [])
              .filter(ts => ts.component === bpComp?.id)
              .flatMap(ts => ts.scenarios || []);

            let probeScenarios;
            if (bpScenarios.length > 0) {
              probeScenarios = bpScenarios.map(s => ({ action: s.action, input: s.input || {} }));
            } else {
              // Fallback: extract action names from generated YAML and call each with empty input
              const actionMatches = [...(content.matchAll(/- id:\s*"?([^\s"]+)/g) || [])];
              probeScenarios = actionMatches.map(m => ({ action: m[1], input: {} }));
            }

            if (probeScenarios.length > 0) {
              autopilotState.setStep(comp.label + ' — probing extension...');
              await writeProjectLog(projectId, 'extension_probe_start', { meta: { component: comp.label, extensionName: updated.registeredAs, scenarios: probeScenarios.length, by: 'autopilot' } });

              const probeResp = await probeExtension(projectId, updated.registeredAs, probeScenarios);
              const probeResults = probeResp?.data?.results || [];

              // Save probe results + context bundle — downstream prompts will inject these
              const contextBundle = createBundle(updated, probeResults);
              updated = { ...updated, probeResults, contextBundle,
                history: [...(updated.history || []), { action: 'extension_probed', at: new Date().toISOString(), by: 'autopilot', probed: probeResults.length }],
              };
              await saveComponent(projectId, updated);
              writeDebugArtifact(projectId, comp.id || bpComp?.id || 'ext', 'probe-results', JSON.stringify(probeResults, null, 2));
              await writeProjectLog(projectId, 'extension_probe_complete', { meta: { component: comp.label, results: probeResults.length, by: 'autopilot' } });

              // ── SPEC-VS-PROBE VALIDATION — spec is king ──
              if (updated.spec && probeResults.length > 0) {
                const specProbeResult = validateSpecAgainstProbe(updated.spec, probeResults);
                writeDebugArtifact(projectId, comp.id || bpComp?.id || 'ext', 'spec-vs-probe', JSON.stringify(specProbeResult, null, 2));
                if (!specProbeResult.valid) {
                  await writeProjectLog(projectId, 'spec_probe_mismatch', {
                    meta: { component: comp.label, mismatches: specProbeResult.mismatches.map(m => m.message), by: 'autopilot' },
                  });
                  showToast?.(`${comp.label}: Probe doesn't match spec — code may need regeneration`, true);
                  // Log each mismatch for debugging
                  for (const m of specProbeResult.mismatches) {
                    console.warn(`[spec-vs-probe] ${m.message}`);
                  }
                } else {
                  await writeProjectLog(projectId, 'spec_probe_validated', { meta: { component: comp.label, by: 'autopilot' } });
                }
              }
            }
          } catch (e) {
            await writeProjectLog(projectId, 'extension_probe_failed', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
          }
        }

        // Per-component test immediately after registration
        // Read testScope via ref for stale-closure safety
        if (!autopilotState.cancelledRef.current && testExec.testScopeRef.current !== 'none') {
          const testableTypes = ['extension', 'cortex', 'app'];
          if (testableTypes.includes(comp.type)) {
            autopilotState.setStep(comp.label + ' — ' + t('profile.generator.test_generating'));
            await writeProjectLog(projectId, 'test_prompt_generating', { meta: { component: comp.label, type: comp.type, by: 'autopilot' } });
            const testEnvironment = (comp.type === 'cortex' || comp.type === 'app') ? 'browser' : 'server';
            let aiTestCode;
            let testPromptText;
            // Gather probe results: own probeResults for extensions, or extension's probeResults for cortex/app
            let testProbeResults = updated.probeResults || null;
            if (!testProbeResults && (comp.type === 'cortex' || comp.type === 'app')) {
              const allComps = await loadAllComponents(projectId);
              const extComp = allComps.find(c => c.type === 'extension' && c.probeResults);
              testProbeResults = extComp?.probeResults || null;
            }
            try {
              testPromptText = buildTestPrompt(
                comp.type, content, comp.label, updated.registeredAs,
                project.blueprint, interviewSpec, testProbeResults
              );
              await writeProjectLog(projectId, 'test_prompt_built', { meta: { component: comp.label, environment: testEnvironment, promptLength: testPromptText.length, by: 'autopilot' } });
              writeDebugArtifact(projectId, cid, 'test-prompt', testPromptText);
              aiTestCode = await runWithAi(projectId, testPromptText);
              writeDebugArtifact(projectId, cid, 'test-raw-response', aiTestCode);
              aiTestCode = stripCodeblock(aiTestCode);
              writeDebugArtifact(projectId, cid, 'test-code', aiTestCode);
              updated = { ...updated, testPrompt: testPromptText, testCode: aiTestCode, testEnvironment,
                history: [...(updated.history || []), { action: 'test_code_generated', at: new Date().toISOString(), by: 'autopilot' }],
              };
              await saveComponent(projectId, updated);
              await writeProjectLog(projectId, 'test_code_generated', { meta: { component: comp.label, environment: testEnvironment, codeLength: aiTestCode.length, by: 'autopilot' } });
              // Refresh UI so test code textarea shows the generated code before test runs
              await core.loadData();
            } catch (e) {
              await writeProjectLog(projectId, 'test_code_generation_failed', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
              showToast?.(`${comp.label}: Test generation failed: ${e.message}`, true);
              await core.loadData();
              continue;
            }
            if (autopilotState.cancelledRef.current) break;

            // Execute test
            autopilotState.setStep(comp.label + ' — ' + t('profile.generator.test_running'));
            await writeProjectLog(projectId, 'test_executing', { meta: { component: comp.label, environment: testEnvironment, by: 'autopilot' } });
            try {
              const testResp = await runComponentTest(projectId, comp.id, aiTestCode, testEnvironment);
              const testResult = testResp?.data?.result || testResp?.result;

              if (testResult) {
                updated = { ...updated, testResult,
                  history: [...(updated.history || []), { action: 'test_' + testResult.status, at: new Date().toISOString(), by: 'autopilot', errors: testResult.errors }],
                };
                await saveComponent(projectId, updated);
                // Refresh UI so test result displays immediately
                await core.loadData();
              }

              if (testResult) {
                testExec.pushTestResult(comp.id, comp.label, testResult);
              }

              if (testResult && testResult.status === 'failed') {
                await writeProjectLog(projectId, 'component_test_failed', { meta: { component: comp.label, errors: testResult.errors, by: 'autopilot' } });
                showToast?.(`${comp.label}: ${t('profile.generator.test_failed')}`, true);

                // Per-component fix loop with reflection + history + fresh generation
                const MAX_FIX = 3;
                let fixed = false;
                const previousAttempts = [];
                for (let fix = 0; fix < MAX_FIX && !fixed && !autopilotState.cancelledRef.current; fix++) {
                  autopilotState.setStep(
                    comp.label + ' — ' + t('profile.generator.openrouter.retrying').replace('{current}', fix + 1).replace('{max}', MAX_FIX)
                  );
                  await writeProjectLog(projectId, 'test_fix_round_start', { meta: { component: comp.label, round: fix + 1, maxRounds: MAX_FIX, by: 'autopilot' } });
                  updated = { ...updated, history: [...(updated.history || []), { action: 'test_fix_round', at: new Date().toISOString(), by: 'autopilot', round: fix + 1, maxRounds: MAX_FIX }] };
                  await saveComponent(projectId, updated);

                  // Build testContext with trace data
                  const currentReport = testExec.testReportRef.current;
                  const testContext = {
                    errors: testResult.errors,
                    trace: testResult.trace || [],
                    dependencyResults: (currentReport?.components || [])
                      .filter(c => c.componentId !== comp.id && c.status === 'passed')
                      .map(c => ({ componentId: c.componentId, status: c.status })),
                    blueprintComponent: project.blueprint?.components?.find(c => c.label === comp.label) || null,
                  };

                  const allErrors = [
                    ...(vr.errors || []),
                    ...testResult.errors.map(e => `TEST FAILURE: ${e}`),
                  ];

                  // Step 1: Reflection — diagnose the failure before writing code
                  let reflectionDiagnosis = '';
                  try {
                    const reflectionPrompt = buildReflectionPrompt(content, allErrors, testContext);
                    writeDebugArtifact(projectId, cid, 'test-fix-reflection-' + (fix + 1), reflectionPrompt);
                    reflectionDiagnosis = await runWithAi(projectId, reflectionPrompt);
                    writeDebugArtifact(projectId, cid, 'test-fix-diagnosis-' + (fix + 1), reflectionDiagnosis);
                  } catch (e) {
                    await writeProjectLog(projectId, 'test_fix_reflection_failed', { meta: { component: comp.label, round: fix + 1, error: e.message } });
                  }

                  // Step 2: Detect oscillation — same errors as previous round?
                  const lastAttempt = previousAttempts[previousAttempts.length - 1];
                  const sameErrors = lastAttempt && JSON.stringify(lastAttempt.errors.sort()) === JSON.stringify(allErrors.sort());

                  let fixPrompt;
                  if (fix === MAX_FIX - 1 || sameErrors) {
                    // Final round or oscillation detected: fresh generation with pitfalls
                    fixPrompt = buildFreshGenerationPrompt(prompt, previousAttempts, testContext);
                    writeDebugArtifact(projectId, cid, 'test-fix-prompt-' + (fix + 1) + '-FRESH', fixPrompt);
                    await writeProjectLog(projectId, 'test_fix_fresh_generation', { meta: { component: comp.label, round: fix + 1, reason: sameErrors ? 'oscillation_detected' : 'final_round' } });
                  } else {
                    // Normal fix with reflection + history
                    fixPrompt = buildFixPrompt(prompt, content, allErrors, comp.type, testContext, previousAttempts, reflectionDiagnosis);
                    writeDebugArtifact(projectId, cid, 'test-fix-prompt-' + (fix + 1), fixPrompt);
                  }

                  try {
                    content = await runWithAi(projectId, fixPrompt);
                    writeDebugArtifact(projectId, cid, 'test-fix-raw-response-' + (fix + 1), content);
                  } catch (e) {
                    showToast?.(`${comp.label}: ${e.message}`, true);
                    await writeProjectLog(projectId, 'test_fix_ai_failed', { meta: { component: comp.label, round: fix + 1, error: e.message, by: 'autopilot' } });
                    break;
                  }
                  if (autopilotState.cancelledRef.current) break;

                  const fixVr = validateComponent(comp.type, content, project.blueprint);
                  if (!fixVr.valid) {
                    updated = { ...updated, history: [...(updated.history || []), { action: 'test_fix_validation_failed', at: new Date().toISOString(), by: 'autopilot', round: fix + 1, errors: fixVr.errors }] };
                    await saveComponent(projectId, updated);
                    await writeProjectLog(projectId, 'test_fix_validation_failed', { meta: { component: comp.label, round: fix + 1, errors: fixVr.errors, by: 'autopilot' } });
                    continue;
                  }

                  // Deactivate + remove before re-registering to ensure clean state
                  if ((comp.type === 'extension' || comp.type === 'cortex') && updated.registeredAs) {
                    try {
                      const deactUrl = comp.type === 'extension'
                        ? `/v1/extensions/${encodeURIComponent(updated.registeredAs)}/deactivate`
                        : `/v1/cortex/${encodeURIComponent(updated.registeredAs)}/deactivate`;
                      await apiPost(deactUrl).catch(() => {});
                      const delUrl = comp.type === 'extension'
                        ? `/v1/extensions/${encodeURIComponent(updated.registeredAs)}`
                        : `/v1/cortex/${encodeURIComponent(updated.registeredAs)}`;
                      await apiDelete(delUrl);
                    } catch { /* may not exist */ }
                  }

                  // Re-register fixed version
                  updated = { ...updated, result: content, status: 'done', validationErrors: [] };
                  await saveComponent(projectId, updated);

                  try {
                    const extComp2 = (await loadAllComponents(projectId)).find(c => c.type === 'extension' && c.registeredAs);
                    const csmComp2 = (await loadAllComponents(projectId)).find(c => c.type === 'csm' && c.registeredAs);
                    const slug2 = extComp2?.registeredAs || csmComp2?.registeredAs?.split('/')?.pop() || '';
                    if (comp.type === 'cortex') {
                      const cvr = validateComponent('cortex', content, project.blueprint);
                      await registerComponent('cortex', cvr.extracted, session, slug2);
                    } else {
                      await registerComponent(comp.type, fixVr.extracted || content, session, slug2);
                    }
                    await writeProjectLog(projectId, 'test_fix_reregistered', { meta: { component: comp.label, round: fix + 1, by: 'autopilot' } });

                    if (comp.type === 'extension') {
                      await apiPost(`/v1/generator/${projectId}/apply-settings/${encodeURIComponent(updated.registeredAs)}`);
                    }
                    if (comp.type === 'extension' || comp.type === 'cortex') {
                      const actUrl = comp.type === 'extension'
                        ? `/v1/extensions/${encodeURIComponent(updated.registeredAs)}/activate`
                        : `/v1/cortex/${encodeURIComponent(updated.registeredAs)}/activate`;
                      await apiPost(actUrl);
                    }
                  } catch (e) {
                    showToast?.(`${comp.label}: Re-register failed: ${e.message}`, true);
                    await writeProjectLog(projectId, 'test_fix_reregister_failed', { meta: { component: comp.label, round: fix + 1, error: e.message, by: 'autopilot' } });
                    continue;
                  }

                  // Regenerate test code for the fixed component
                  await writeProjectLog(projectId, 'test_fix_regenerating_test', { meta: { component: comp.label, round: fix + 1, by: 'autopilot' } });
                  try {
                    const newTestPrompt = buildTestPrompt(comp.type, content, comp.label, updated.registeredAs, project.blueprint, interviewSpec, testProbeResults);
                    writeDebugArtifact(projectId, cid, 'test-fix-test-prompt-' + (fix + 1), newTestPrompt);
                    let newTestCode = await runWithAi(projectId, newTestPrompt);
                    writeDebugArtifact(projectId, cid, 'test-fix-test-raw-response-' + (fix + 1), newTestCode);
                    newTestCode = stripCodeblock(newTestCode);
                    aiTestCode = newTestCode;
                  } catch (e) {
                    await writeProjectLog(projectId, 'test_fix_regen_failed', { meta: { component: comp.label, round: fix + 1, error: e.message, by: 'autopilot' } });
                  }

                  await writeProjectLog(projectId, 'test_fix_retesting', { meta: { component: comp.label, round: fix + 1, by: 'autopilot' } });
                  const reTestResp = await runComponentTest(projectId, comp.id, aiTestCode, testEnvironment);
                  const reTestResult = reTestResp?.data?.result || reTestResp?.result;

                  if (reTestResult) {
                    reTestResult.fixRound = fix + 1;
                    testExec.pushTestResult(comp.id, comp.label, reTestResult);
                  }

                  if (reTestResult && reTestResult.status !== 'failed') {
                    fixed = true;
                    updated = { ...updated, testResult: reTestResult, testCode: aiTestCode,
                      history: [...(updated.history || []), { action: 'test_fixed', at: new Date().toISOString(), by: 'autopilot', round: fix + 1 }],
                    };
                    await saveComponent(projectId, updated);
                    await writeProjectLog(projectId, 'component_test_fixed', { meta: { component: comp.label, fixRound: fix + 1, by: 'autopilot' } });
                    showToast?.(`${comp.label}: ${t('profile.generator.test_passed')}`);
                  } else {
                    testResult.errors = reTestResult?.errors || testResult.errors;
                    // Record this attempt for next round's context
                    previousAttempts.push({
                      round: fix + 1,
                      diagnosis: reflectionDiagnosis || null,
                      errors: reTestResult?.errors || testResult.errors,
                    });
                    // Update trace for next round
                    if (reTestResult?.trace) testContext.trace = reTestResult.trace;
                    updated = { ...updated, testResult: reTestResult || testResult, testCode: aiTestCode,
                      history: [...(updated.history || []), { action: 'test_fix_still_failing', at: new Date().toISOString(), by: 'autopilot', round: fix + 1, errors: reTestResult?.errors }],
                    };
                    await saveComponent(projectId, updated);
                    await writeProjectLog(projectId, 'test_fix_still_failing', { meta: { component: comp.label, round: fix + 1, errors: reTestResult?.errors, by: 'autopilot' } });
                  }
                }

                if (!fixed && !autopilotState.cancelledRef.current) {
                  updated = { ...updated, history: [...(updated.history || []), { action: 'test_gave_up', at: new Date().toISOString(), by: 'autopilot', maxRounds: MAX_FIX }] };
                  await saveComponent(projectId, updated);
                  await writeProjectLog(projectId, 'component_test_gave_up', { meta: { component: comp.label, maxRounds: MAX_FIX, by: 'autopilot' } });
                  showToast?.(`${comp.label}: ${t('profile.generator.test_fix_round')} ${MAX_FIX}`, true);
                  break;
                }

                await core.loadData();
              } else if (testResult) {
                await writeProjectLog(projectId, 'component_test_passed', { meta: { component: comp.label, by: 'autopilot' } });
              } else {
                await writeProjectLog(projectId, 'component_test_no_result', { meta: { component: comp.label, response: JSON.stringify(testResp).slice(0, 200), by: 'autopilot' } });
              }
            } catch (e) {
              await writeProjectLog(projectId, 'component_test_error', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
              showToast?.(`${comp.label}: Test error: ${e.message}`, true);
            }
          }
        }
      }
    } catch (e) {
      showToast?.(e.message, true);
    }

    autopilotState.finish();
    await core.loadData();
  }

  return { handleRunAll };
}
