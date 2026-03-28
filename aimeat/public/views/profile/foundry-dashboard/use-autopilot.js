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
 *   import { useAutopilot } from './foundry-dashboard/use-autopilot.js';
 *   const autopilot = useAutopilot(core, autopilotState, projectId, orSettings, session, testExec, showToast);
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js ProjectDashboard
 *   v2.0.0 — 2026-03-26 — Wire multi-pass flow: runComponentPasses for extension/cortex/app
 */
import { t } from '/js/i18n.js';
import { apiPost, apiDelete } from '/js/api.js';
import {
  loadAllComponents, saveComponent, registerComponent, writeProjectLog, writeDebugArtifact,
  MULTI_PASS_TYPES, createInitialPasses, createUnitPasses, getNextPass,
  saveSkeleton, saveUnit, saveTestCode, loadSkeleton, loadUnits, loadTestCode,
  appendReflection, loadReflectionHistory, isDuplicatePrescription, MAX_REFLECTIONS,
} from '/js/services/foundry.js';
import { buildComponentPrompt, buildFixPrompt, buildReflectionPrompt, buildFreshGenerationPrompt, buildTestPrompt } from '/js/services/foundry-prompts.js';
import {
  buildSkeletonPrompt, buildExtensionUnitPrompt, buildCortexMethodUnitPrompt,
  buildFeatureCortexSectionPrompt, buildAppViewUnitPrompt,
  buildExtensionAssemblyPrompt, buildCortexAssemblyPrompt, buildAppAssemblyPrompt,
} from '/js/services/foundry-prompts-build.js';
import { buildTestFirstPrompt } from '/js/services/foundry-prompts-test.js';
import { buildFoundryReflectionPrompt } from '/js/services/foundry-prompts-fix.js';
import { validateComponent, validateSkeleton, validateUnit } from '/js/services/foundry-validate.js';
import { runComponentTest, probeExtension } from '/js/services/foundry-testing.js';
import { createBundle } from '/js/services/foundry-context-bundle.js';
import { runWithAi, stripCodeblock } from '../foundry-detail.js';

/* ── Multi-Pass Helpers (replicated from foundry-detail.js) ── */

/**
 * Extract one unit's definition block from skeleton YAML by finding its id.
 */
function parseUnitFromSkeleton(skeletonYaml, unitId) {
  if (!skeletonYaml || !unitId) return { id: unitId, label: unitId };
  const lines = skeletonYaml.split('\n');
  let found = false;
  const block = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if ((trimmed.startsWith('- id: ') && trimmed.slice(6).trim() === unitId) ||
        (trimmed.startsWith('- name: ') && trimmed.slice(8).trim() === unitId)) {
      found = true;
      block.push(line);
      continue;
    }
    if (found) {
      if (trimmed.startsWith('- ') || (/^\w/.test(trimmed) && trimmed.endsWith(':'))) {
        break;
      }
      block.push(line);
    }
  }
  return { id: unitId, label: unitId, raw: block.join('\n') };
}

/**
 * Extract the test section for a specific unit from the full test code.
 */
function extractTestForUnit(testCode, unitId) {
  if (!testCode || !unitId) return '';
  const regex = new RegExp(`(describe|test|it)\\s*\\(['"](.*?${unitId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?)['"]`, 'i');
  const match = testCode.match(regex);
  if (!match) return '';
  const idx = testCode.indexOf(match[0]);
  const start = Math.max(0, testCode.lastIndexOf('\n', idx - 200));
  const end = Math.min(testCode.length, testCode.indexOf('\n', idx + 500));
  return testCode.slice(start, end > start ? end : testCode.length).trim();
}

/**
 * Parse a reflection response to extract diagnosis and prescription.
 */
function parseReflectionPrescription(responseText) {
  if (!responseText) return null;
  try {
    const yamlMatch = responseText.match(/```(?:yaml)?\s*\n([\s\S]*?)```/);
    const block = yamlMatch ? yamlMatch[1] : responseText;
    const diagMatch = block.match(/diagnosis:\s*(.+)/);
    const rootMatch = block.match(/root_cause:\s*(.+)/);
    const actionMatch = block.match(/action:\s*(.+)/);
    const targetMatch = block.match(/target:\s*(.+)/);
    if (diagMatch || actionMatch) {
      return {
        diagnosis: diagMatch ? diagMatch[1].trim() : '',
        rootCause: rootMatch ? rootMatch[1].trim() : '',
        action: actionMatch ? actionMatch[1].trim() : 'unknown',
        target: targetMatch ? targetMatch[1].trim() : '',
      };
    }
  } catch { /* parse failed */ }
  return null;
}

/**
 * Generate the prompt for a given pass based on type and context.
 * Dispatch logic mirrors foundry-detail.js generatePassPrompt().
 */
function generatePassPrompt(pass, ctx) {
  const { component, blueprint, interviewSpec, skeleton, units, testCode, reflectionHistory } = ctx;
  const bpComp = blueprint?.components?.find(c => c.label === component.label || c.id === component.id);

  switch (pass.type) {
    case 'test':
      return buildTestFirstPrompt({
        componentType: component.type,
        subtype: bpComp?.subtype,
        label: component.label,
        blueprint,
        blueprintComponent: bpComp,
        interviewSpec,
      });
    case 'skeleton':
      return buildSkeletonPrompt({
        componentType: component.type,
        subtype: bpComp?.subtype,
        label: component.label,
        blueprint,
        blueprintComponent: bpComp,
        interviewSpec,
        testCode,
      });
    case 'unit': {
      const unitDef = parseUnitFromSkeleton(skeleton || '', pass.unitId);
      const testExcerpt = extractTestForUnit(testCode || '', pass.unitId);
      if (component.type === 'extension') {
        return buildExtensionUnitPrompt({ skeleton, unitDef, dataSources: bpComp?.dataSources, testExcerpt });
      } else if (component.type === 'cortex') {
        const subtype = bpComp?.subtype || 'data';
        if (subtype === 'feature') {
          return buildFeatureCortexSectionPrompt({ skeleton, sectionDef: unitDef, dataCortexProbe: null, platformUiExample: null, translationKeys: null });
        }
        return buildCortexMethodUnitPrompt({ skeleton, unitDef, extensionProbeResult: null, componentSubtype: subtype });
      } else if (component.type === 'app') {
        return buildAppViewUnitPrompt({ skeleton, viewDef: unitDef, featureCortexRenderSpec: null, translationKeys: null });
      }
      return '';
    }
    case 'assembly': {
      if (component.type === 'extension') {
        return buildExtensionAssemblyPrompt({ skeleton, units, label: component.label });
      } else if (component.type === 'cortex') {
        return buildCortexAssemblyPrompt({ skeleton, units, label: component.label, subtype: bpComp?.subtype });
      } else if (component.type === 'app') {
        return buildAppAssemblyPrompt({ skeleton, units, label: component.label, appDomainCortexName: null, designSystem: null });
      }
      return '';
    }
    case 'reflection':
      return buildFoundryReflectionPrompt({
        skeleton, testCode,
        failedOutput: pass.failedOutput || '',
        errors: pass.errors || [],
        failedPass: pass.failedPass || {},
        reflectionHistory: reflectionHistory || [],
        upstreamProbes: null,
      });
    default:
      return '';
  }
}

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

  /**
   * Run all passes for a multi-pass component (extension, cortex, app).
   * Iterates: test → skeleton → unit(s) → assembly, with reflection on failure.
   *
   * @param {Object} comp - The component object
   * @param {string} cid - Component ID
   * @param {Object} project - Project object (with blueprint)
   * @param {Object} interviewSpec - Interview spec
   * @returns {{ success: boolean, content: string|null, updated: Object }} - Final result
   */
  async function runComponentPasses(comp, cid, project, interviewSpec) {
    const blueprint = project.blueprint;
    const bpComp = blueprint?.components?.find(c => c.label === comp.label || c.id === comp.id);

    // Initialize passes
    let passes = createInitialPasses(comp.type);
    let skeleton = await loadSkeleton(projectId, cid) || '';
    let testCode = await loadTestCode(projectId, cid) || '';
    let units = await loadUnits(projectId, cid) || {};
    let reflectionHistory = await loadReflectionHistory(projectId, cid) || [];
    let updated = { ...comp };

    // If skeleton already exists, we may have unit passes created already
    if (skeleton && passes.length >= 2) {
      // Mark test and skeleton as done if they exist
      const testPass = passes.find(p => p.type === 'test');
      if (testPass && testCode) testPass.status = 'validated';
      const skelPass = passes.find(p => p.type === 'skeleton');
      if (skelPass && skeleton) {
        skelPass.status = 'validated';
        const unitPasses = createUnitPasses(skeleton);
        // Mark already-completed units
        for (const up of unitPasses) {
          if (units[up.unitId]) up.status = 'validated';
        }
        passes = [...passes, ...unitPasses];
        // Add assembly if all units done
        const allUnitsDone = unitPasses.every(up => up.status === 'validated');
        if (allUnitsDone && unitPasses.length > 0) {
          passes.push({ id: 'assembly', type: 'assembly', status: 'pending', attempt: 1 });
        }
      }
    }

    await writeProjectLog(projectId, 'multipass_start', {
      meta: { component: comp.label, type: comp.type, passCount: passes.length, by: 'autopilot' },
    });

    // Track the last AI response — used as final assembly content
    let lastContent = null;

    // Iterate through passes
    while (true) {
      if (autopilotState.cancelledRef.current) return { success: false, content: null, updated };

      const nextPass = getNextPass(passes);
      if (!nextPass) break; // All passes done

      autopilotState.setStep(`${comp.label} — pass: ${nextPass.type}${nextPass.unitId ? ` (${nextPass.unitId})` : ''}`);

      // Build context for prompt generation
      const ctx = { component: comp, blueprint, interviewSpec, skeleton, units, testCode, reflectionHistory };
      const prompt = generatePassPrompt(nextPass, ctx);

      if (!prompt) {
        await writeProjectLog(projectId, 'multipass_empty_prompt', {
          meta: { component: comp.label, pass: nextPass.id, type: nextPass.type, by: 'autopilot' },
        });
        nextPass.status = 'validated'; // skip empty-prompt passes
        continue;
      }

      writeDebugArtifact(projectId, cid, `pass-${nextPass.id}-prompt`, prompt);

      // Determine model role: reasoning for planning passes, execution for code passes
      const reasoningPasses = ['test', 'skeleton', 'reflection'];
      const passModelRole = reasoningPasses.includes(nextPass.type) ? 'reasoning' : 'execution';

      await writeProjectLog(projectId, 'multipass_ai_call', {
        meta: { component: comp.label, pass: nextPass.id, type: nextPass.type, modelRole: passModelRole, promptLength: prompt.length, by: 'autopilot' },
      });

      // Call AI
      let content;
      try {
        content = await runWithAi(projectId, prompt, null, passModelRole);
      } catch (e) {
        showToast?.(`${comp.label} (${nextPass.id}): ${e.message}`, true);
        await writeProjectLog(projectId, 'multipass_ai_failed', {
          meta: { component: comp.label, pass: nextPass.id, type: nextPass.type, modelRole: passModelRole, error: e.message, by: 'autopilot' },
        });
        return { success: false, content: null, updated };
      }
      if (autopilotState.cancelledRef.current) return { success: false, content: null, updated };

      writeDebugArtifact(projectId, cid, `pass-${nextPass.id}-raw`, content);
      await writeProjectLog(projectId, 'multipass_ai_response', {
        meta: { component: comp.label, pass: nextPass.id, type: nextPass.type, modelRole: passModelRole, responseLength: content.length, by: 'autopilot' },
      });
      content = stripCodeblock(content);
      writeDebugArtifact(projectId, cid, `pass-${nextPass.id}-stripped`, content);

      // Validate based on pass type
      let validationResult;
      switch (nextPass.type) {
        case 'test':
          // Basic check: non-empty and contains assert/expect/test
          validationResult = {
            valid: content.length > 50 && (/assert|expect|test|describe|it\s*\(/.test(content)),
            errors: content.length <= 50 ? ['Test code too short'] : (!(/assert|expect|test|describe|it\s*\(/.test(content)) ? ['No assertions found in test code'] : []),
          };
          break;
        case 'skeleton':
          validationResult = validateSkeleton(content, bpComp, interviewSpec);
          break;
        case 'unit':
          validationResult = validateUnit(content, parseUnitFromSkeleton(skeleton, nextPass.unitId), comp.type);
          break;
        case 'assembly':
          validationResult = validateComponent(comp.type, content, blueprint);
          break;
        default:
          validationResult = { valid: true, errors: [] };
      }

      // Handle validation failure — trigger reflection loop
      if (!validationResult.valid) {
        await writeProjectLog(projectId, 'multipass_validation_failed', {
          meta: { component: comp.label, pass: nextPass.id, type: nextPass.type, errors: validationResult.errors, by: 'autopilot' },
        });

        let resolved = false;
        for (let reflectAttempt = 0; reflectAttempt < MAX_REFLECTIONS && !resolved; reflectAttempt++) {
          if (autopilotState.cancelledRef.current) return { success: false, content: null, updated };

          autopilotState.setStep(`${comp.label} — reflection ${reflectAttempt + 1}/${MAX_REFLECTIONS} for ${nextPass.id}`);

          // Build reflection prompt
          const reflectionPass = {
            type: 'reflection',
            failedOutput: content,
            errors: validationResult.errors,
            failedPass: nextPass,
          };
          const reflCtx = { component: comp, blueprint, interviewSpec, skeleton, units, testCode, reflectionHistory };
          const reflPrompt = generatePassPrompt(reflectionPass, reflCtx);
          writeDebugArtifact(projectId, cid, `pass-${nextPass.id}-reflection-${reflectAttempt + 1}-prompt`, reflPrompt);

          let reflResponse;
          try {
            reflResponse = await runWithAi(projectId, reflPrompt, null, 'reasoning');
          } catch (e) {
            await writeProjectLog(projectId, 'multipass_reflection_ai_failed', {
              meta: { component: comp.label, pass: nextPass.id, attempt: reflectAttempt + 1, error: e.message, by: 'autopilot' },
            });
            break;
          }
          writeDebugArtifact(projectId, cid, `pass-${nextPass.id}-reflection-${reflectAttempt + 1}-response`, reflResponse);
          reflResponse = stripCodeblock(reflResponse);

          // Parse prescription
          const prescription = parseReflectionPrescription(reflResponse);

          // Save reflection
          await appendReflection(projectId, cid, {
            attempt: reflectAttempt + 1,
            at: new Date().toISOString(),
            prescription,
            passId: nextPass.id,
          });
          reflectionHistory = await loadReflectionHistory(projectId, cid);

          // Check for escalation or loop
          if (prescription?.action === 'escalate_to_user') {
            await writeProjectLog(projectId, 'multipass_escalated', {
              meta: { component: comp.label, pass: nextPass.id, diagnosis: prescription.diagnosis, by: 'autopilot' },
            });
            showToast?.(`${comp.label}: Reflection escalated — needs manual attention`, true);
            return { success: false, content: null, updated };
          }
          if (isDuplicatePrescription(reflectionHistory.slice(0, -1), prescription)) {
            await writeProjectLog(projectId, 'multipass_reflection_loop', {
              meta: { component: comp.label, pass: nextPass.id, attempt: reflectAttempt + 1, by: 'autopilot' },
            });
            showToast?.(`${comp.label}: Reflection loop detected for ${nextPass.id}`, true);
            return { success: false, content: null, updated };
          }

          // Retry the pass with context from reflection
          const retryPrompt = prompt + `\n\n--- PREVIOUS ATTEMPT FAILED ---\nErrors: ${validationResult.errors.join('; ')}\nDiagnosis: ${prescription?.diagnosis || reflResponse}\nFix: Regenerate addressing the above issues.\n`;
          writeDebugArtifact(projectId, cid, `pass-${nextPass.id}-retry-${reflectAttempt + 1}-prompt`, retryPrompt);

          try {
            content = await runWithAi(projectId, retryPrompt, null, passModelRole);
          } catch (e) {
            showToast?.(`${comp.label} (${nextPass.id} retry): ${e.message}`, true);
            return { success: false, content: null, updated };
          }
          content = stripCodeblock(content);
          writeDebugArtifact(projectId, cid, `pass-${nextPass.id}-retry-${reflectAttempt + 1}-stripped`, content);

          // Re-validate
          switch (nextPass.type) {
            case 'test':
              validationResult = {
                valid: content.length > 50 && (/assert|expect|test|describe|it\s*\(/.test(content)),
                errors: content.length <= 50 ? ['Test code too short'] : (!(/assert|expect|test|describe|it\s*\(/.test(content)) ? ['No assertions found'] : []),
              };
              break;
            case 'skeleton':
              validationResult = validateSkeleton(content, bpComp, interviewSpec);
              break;
            case 'unit':
              validationResult = validateUnit(content, parseUnitFromSkeleton(skeleton, nextPass.unitId), comp.type);
              break;
            case 'assembly':
              validationResult = validateComponent(comp.type, content, blueprint);
              break;
            default:
              validationResult = { valid: true, errors: [] };
          }

          if (validationResult.valid) resolved = true;
        }

        if (!resolved) {
          showToast?.(`${comp.label}: Failed after ${MAX_REFLECTIONS} reflections on ${nextPass.id}`, true);
          await writeProjectLog(projectId, 'multipass_gave_up', {
            meta: { component: comp.label, pass: nextPass.id, maxReflections: MAX_REFLECTIONS, by: 'autopilot' },
          });
          return { success: false, content: null, updated };
        }
      }

      // Validation passed — save based on pass type
      switch (nextPass.type) {
        case 'test':
          await saveTestCode(projectId, cid, content);
          testCode = content;
          break;
        case 'skeleton':
          await saveSkeleton(projectId, cid, content);
          skeleton = content;
          // Create unit passes from skeleton
          {
            const unitPasses = createUnitPasses(skeleton);
            if (unitPasses.length > 0) {
              passes.push(...unitPasses);
              // Add assembly pass after all unit passes
              passes.push({ id: 'assembly', type: 'assembly', status: 'pending', attempt: 1 });
            } else {
              // No units extracted — add assembly directly
              passes.push({ id: 'assembly', type: 'assembly', status: 'pending', attempt: 1 });
            }
          }
          break;
        case 'unit':
          await saveUnit(projectId, cid, nextPass.unitId, content);
          units[nextPass.unitId] = content;
          break;
        case 'assembly':
          // Assembly produces the final component code — will be returned
          break;
      }

      nextPass.status = 'validated';
      updated = {
        ...updated,
        history: [...(updated.history || []), {
          action: `pass_${nextPass.type}_validated`,
          at: new Date().toISOString(),
          by: 'autopilot',
          passId: nextPass.id,
        }],
      };
      await saveComponent(projectId, updated);

      // Track last content for return value (assembly output is the final result)
      lastContent = content;

      await writeProjectLog(projectId, 'multipass_pass_done', {
        meta: { component: comp.label, pass: nextPass.id, type: nextPass.type, by: 'autopilot' },
      });
    }

    // All passes done — the last content is from assembly
    await writeProjectLog(projectId, 'multipass_complete', {
      meta: { component: comp.label, type: comp.type, totalPasses: passes.length, by: 'autopilot' },
    });

    // Load final assembly content: it's the last 'content' from the assembly pass
    // (content variable still holds the last AI response, which is the assembly output)
    // Verify we have a non-empty result
    const assemblyPass = passes.find(p => p.type === 'assembly');
    if (!assemblyPass) {
      // No assembly was needed (shouldn't happen for multi-pass)
      return { success: false, content: null, updated };
    }

    return { success: true, content: lastContent, updated };
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

        let content;
        let updated;
        let vr;
        let prompt; // original prompt — used by test fix loops

        // ── Multi-pass vs single-shot dispatch ──
        if (MULTI_PASS_TYPES.includes(comp.type)) {
          // Multi-pass flow: test → skeleton → units → assembly
          const passResult = await runComponentPasses(comp, cid, project, interviewSpec);
          if (!passResult.success) {
            // runComponentPasses already logged and toasted — move to next component or stop
            updated = passResult.updated;
            await core.loadData();
            if (autopilotState.cancelledRef.current) break;
            continue; // skip to next component
          }
          content = passResult.content;
          updated = passResult.updated;
          // Set prompt for test fix loops — use the assembly prompt as representative
          prompt = `[Multi-pass ${comp.type} component: ${comp.label}] Final assembled code.`;
          // Validate the final assembly output
          vr = validateComponent(comp.type, content, project.blueprint);
          if (!vr.valid) {
            updated = { ...updated, result: content, status: 'errors', validationErrors: vr.errors,
              history: [...(updated.history || []), { action: 'assembly_validation_failed', at: new Date().toISOString(), by: 'autopilot', errors: vr.errors }],
            };
            await saveComponent(projectId, updated);
            await core.loadData();
            showToast?.(t('profile.foundry.openrouter.stepFailed') + ': ' + comp.label, true);
            break;
          }
          // Save final result
          updated = { ...updated, result: content, status: 'done', validationErrors: [],
            history: [...(updated.history || []), { action: 'multipass_validation_passed', at: new Date().toISOString(), by: 'autopilot' }],
          };
          await saveComponent(projectId, updated);
        } else {
          // Single-shot flow (CSM, MSM, Memory, Translation) — existing behavior
          const latestComps = await loadAllComponents(projectId);
          const completedComponents = latestComps.filter(c => c.status === 'done' && c.registeredAs);
          prompt = await buildComponentPrompt(
            comp.type, comp.label,
            project.description, project.blueprint, completedComponents,
            interviewSpec,
          );
          try {
            content = await runWithAi(projectId, prompt, null, 'execution');
          } catch (e) {
            showToast?.(`${comp.label}: ${e.message}`, true);
            break;
          }
          if (autopilotState.cancelledRef.current) break;
          writeDebugArtifact(projectId, cid, 'prompt', prompt);
          writeDebugArtifact(projectId, cid, 'ai-raw-response', content);
          content = stripCodeblock(content);
          writeDebugArtifact(projectId, cid, 'generated', content);

          updated = { ...comp, result: content, status: 'validating', prompt,
            history: [...(comp.history || []), { action: 'ai_response_received', at: new Date().toISOString(), by: 'autopilot' }],
          };
          await saveComponent(projectId, updated);

          vr = validateComponent(comp.type, content, project.blueprint);

          // Auto-retry if enabled
          if (!vr.valid && orSettings?.autoRetry) {
            const max = orSettings.maxRetries || 3;
            for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
              if (autopilotState.cancelledRef.current) break;
              autopilotState.setStep(
                comp.label + ' - ' + t('profile.foundry.openrouter.retrying').replace('{current}', attempt).replace('{max}', max)
              );
              const fixPrompt = buildFixPrompt(prompt, content, vr.errors, comp.type);
              writeDebugArtifact(projectId, cid, 'fix-prompt-' + attempt, fixPrompt);
              try {
                content = await runWithAi(projectId, fixPrompt, null, 'execution');
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
            showToast?.(t('profile.foundry.openrouter.stepFailed') + ': ' + comp.label, true);
            break;
          }
          if (autopilotState.cancelledRef.current) break;

          // Validation passed — save and register
          updated = { ...updated, result: content, status: 'done', validationErrors: [],
            history: [...updated.history, { action: 'validation_passed', at: new Date().toISOString(), by: 'autopilot' }],
          };
          await saveComponent(projectId, updated);
        }

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
                const deactUrl = comp.type === 'extension' ? `/v1/extensions/${encodeURIComponent(oldName)}/deactivate` : `/v1/cortex/${encodeURIComponent(oldName)}/deactivate`;
                await apiPost(deactUrl).catch(() => {});
                const delUrl = comp.type === 'extension' ? `/v1/extensions/${encodeURIComponent(oldName)}` : `/v1/cortex/${encodeURIComponent(oldName)}`;
                await apiDelete(delUrl);
                resp = await doRegister();
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
              await apiPost(`/v1/foundry/${projectId}/apply-settings/${encodeURIComponent(updated.registeredAs)}`);
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
            autopilotState.setStep(comp.label + ' — ' + t('profile.foundry.test_generating'));
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
              aiTestCode = await runWithAi(projectId, testPromptText, null, 'reasoning');
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
            autopilotState.setStep(comp.label + ' — ' + t('profile.foundry.test_running'));
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
                showToast?.(`${comp.label}: ${t('profile.foundry.test_failed')}`, true);

                // Per-component fix loop with reflection + history + fresh generation
                const MAX_FIX = 3;
                let fixed = false;
                const previousAttempts = [];
                for (let fix = 0; fix < MAX_FIX && !fixed && !autopilotState.cancelledRef.current; fix++) {
                  autopilotState.setStep(
                    comp.label + ' — ' + t('profile.foundry.openrouter.retrying').replace('{current}', fix + 1).replace('{max}', MAX_FIX)
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
                    reflectionDiagnosis = await runWithAi(projectId, reflectionPrompt, null, 'reasoning');
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
                    content = await runWithAi(projectId, fixPrompt, null, 'execution');
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
                      await apiPost(`/v1/foundry/${projectId}/apply-settings/${encodeURIComponent(updated.registeredAs)}`);
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
                    let newTestCode = await runWithAi(projectId, newTestPrompt, null, 'reasoning');
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
                    showToast?.(`${comp.label}: ${t('profile.foundry.test_passed')}`);
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
                  showToast?.(`${comp.label}: ${t('profile.foundry.test_fix_round')} ${MAX_FIX}`, true);
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
