/**
 * @file services/generator-autopilot-phases.ts
 * @description Spec-generation and test/reflect/fix/re-register/re-test phases of the generator autopilot, driven by a shared run context. Extracted from services/generator-autopilot.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-autopilot.ts (max-file-lines)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { GeneratorDebugWriter } from './generator-debug.js';
import { buildPrompt, stripCodeblock } from './generator-prompts/index.js';
import { validateComponent } from './generator-prompts/validate.js';
import { validateExtensionSpec, validateDataApiSpec, validateComponentSpec, validateAppDomainSpec, validateAppSpec } from './generator-prompts/spec-validate.js';
import type { PromptRuntimeData, Blueprint, InterviewSpec } from './generator-prompts/types.js';
import type { AutopilotStatus } from './generator-autopilot.js';
import { internalFetch } from './generator-autopilot-helpers.js';

/** Shared state the extracted spec + test phases close over (mirrors the runAutopilot loop scope). */
export interface AutopilotRunCtx {
  config: AimeatConfig;
  jwt: string;
  projectId: string;
  ownerGhii: string;
  storage: Storage;
  blueprint: Record<string, unknown>;
  interviewSpec: Record<string, unknown> | null;
  debug: GeneratorDebugWriter;
  alog: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  callLLM: (prompt: string) => Promise<string>;
  saveComp: (comp: Record<string, unknown>) => Promise<void>;
  entry: { status: AutopilotStatus; cancelFlag: boolean };
}

export async function runSpecPhase(ctx: AutopilotRunCtx, cid: string, compLabel: string, compType: string, comp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { config, jwt, projectId, blueprint, debug, alog, callLLM, saveComp } = ctx;
        const specTypes = ['extension', 'cortex', 'app'];
        let spec: Record<string, unknown> | null = null;

        if (specTypes.includes(compType)) {
          const bpComp = ((blueprint.components as Array<Record<string, unknown>>) || []).find((c: Record<string, unknown>) => c.label === compLabel);
          if (bpComp) {
            // Build the spec prompt through the SAME backend route the browser UI uses
            // (GET /prompts/:cid?type=spec) — identical to loadPromptFromBackend(projectId,
            // id, 'spec') in generator-detail.js. The route ALWAYS produces a spec prompt for
            // spec-bearing types and pulls cross-component dependencies (extension spec, data-API
            // spec, translation keys) from the canonical generator.<project>.spec.<id> memory
            // keys. The old inline construction gated on comp.spec being present on the in-memory
            // component records and silently produced a null prompt → no spec generated → empty
            // specs. Never reconstruct the prompt logic here; defer to the route, like the UI does.
            const specPromptResp = await internalFetch(config, `/v1/generator/${projectId}/prompts/${encodeURIComponent(cid)}?type=spec`, jwt);
            const specPrompt: string | null = specPromptResp.ok
              ? (((specPromptResp.data as Record<string, unknown>)?.prompt as string) || null)
              : null;
            if (!specPrompt) {
              alog.warn(`[${cid}] No spec prompt for ${compLabel} (status ${specPromptResp.status}) — continuing without spec`);
            }

            if (specPrompt) {
              alog.info(`[${cid}] Generating spec for ${compLabel}`);
              debug.writeArtifact(cid, 'spec-prompt', specPrompt).catch(() => {});
              const specRaw = await callLLM(specPrompt);
              debug.writeArtifact(cid, 'spec-raw-response', specRaw).catch(() => {});
              let specText = specRaw.trim();
              const fenceMatch = specText.match(/```(?:json)?\s*\n([\s\S]*?)```/);
              if (fenceMatch) specText = fenceMatch[1].trim();

              try {
                spec = JSON.parse(specText) as Record<string, unknown>;
                debug.writeArtifact(cid, 'spec', JSON.stringify(spec, null, 2)).catch(() => {});
                alog.info(`[${cid}] Spec generated: ${(spec as Record<string, unknown>).name as string}`);

                // Validate spec structure — per component type
                const validateSpec = (): { valid: boolean; errors: string[] } => {
                  if (!spec) return { valid: false, errors: ['Spec is null'] };
                  if (compType === 'extension') {
                    const sv = validateExtensionSpec(spec);
                    // Also check blueprint action coverage
                    const specActionIds = new Set(((spec.actions || []) as Array<Record<string, unknown>>).map(a => a.id as string));
                    const bpActions = Object.keys((blueprint as Record<string, unknown>).dataModel ? ((blueprint as Record<string, unknown>).dataModel as Record<string, unknown>).actions as Record<string, unknown> || {} : {})
                      .filter(k => k.startsWith('ext:'))
                      .map(k => k.replace('ext:', '').replace(/^[^/]+\//, ''));
                    const missingActions = bpActions.filter(a => !specActionIds.has(a));
                    if (missingActions.length > 0) {
                      sv.valid = false;
                      sv.errors.push(...missingActions.map(a => `Blueprint declares action "${a}" but it is missing from the spec`));
                    }
                    return sv;
                  } else if (compType === 'app') {
                    return validateAppSpec(spec);
                  } else if (compType === 'cortex') {
                    const sub = (bpComp?.subtype as string) || '';
                    return sub === 'data' ? validateDataApiSpec(spec)
                      : sub === 'component' ? validateComponentSpec(spec)
                      : sub === 'app-domain' ? validateAppDomainSpec(spec)
                      : { valid: true, errors: [] as string[] };
                  }
                  return { valid: true, errors: [] };
                };

                let sv = validateSpec();
                if (!sv.valid) {
                  alog.warn(`[${cid}] Spec validation failed: ${sv.errors.join('; ')} — retrying`);
                  // Retry: ask LLM to fix the spec
                  const specFixPrompt = 'Fix the following spec JSON. It has validation errors.\n\n'
                    + '## Errors\n' + sv.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
                    + '\n\n## Current Spec\n```json\n' + JSON.stringify(spec, null, 2) + '\n```\n\n'
                    + '## Rules\n- Fix ONLY the listed errors\n- Do NOT remove existing fields\n- Return ONLY the COMPLETE fixed JSON, no markdown fences';
                  const fixedRaw = await callLLM(specFixPrompt);
                  let fixedText = fixedRaw.trim();
                  const fixFence = fixedText.match(/```(?:json)?\s*\n([\s\S]*?)```/);
                  if (fixFence) fixedText = fixFence[1].trim();
                  try {
                    spec = JSON.parse(fixedText) as Record<string, unknown>;
                    sv = validateSpec();
                    if (sv.valid) {
                      alog.info(`[${cid}] Spec fix succeeded`);
                      debug.writeArtifact(cid, 'spec-fixed', JSON.stringify(spec, null, 2)).catch(() => {});
                    } else {
                      alog.error(`[${cid}] Spec fix still invalid: ${sv.errors.join('; ')} — continuing without spec`);
                      spec = null;
                    }
                  } catch {
                    alog.error(`[${cid}] Spec fix JSON parse failed — continuing without spec`);
                    spec = null;
                  }
                }
              } catch {
                alog.warn(`[${cid}] Spec JSON parse failed — continuing without spec`);
                spec = null;
              }

              if (spec) {
                comp = { ...comp, spec };
                await saveComp(comp);
                // Persist the spec to its canonical key (generator.<project>.spec.<cid>) through the
                // SAME backend endpoint that backs the browser's "Save Spec" — POST .../components/:cid/spec.
                // This is EXACTLY where the UI reads specs back from on F5: loadAllComponents() queries
                // generator.<project>.spec.* and merges specMap[component.id] onto each component, so the
                // spec only needs to live under this key — it does NOT need to be on the component record.
                // The endpoint validates and version-bumps correctly (existing ? version+1 : 1); the old
                // direct storage.setMemory used a hardcoded version:1 with a swallowed error, so a re-run
                // (key already present) silently failed and the spec never reached the UI.
                const storeResp = await internalFetch(config, `/v1/generator/${projectId}/components/${encodeURIComponent(cid)}/spec`, jwt, {
                  method: 'POST', body: { spec },
                });
                if (storeResp.ok) {
                  alog.info(`[${cid}] Spec stored at generator.${projectId}.spec.${cid} — UI will show it on refresh`);
                } else {
                  alog.error(`[${cid}] Spec store FAILED (status ${storeResp.status}): ${JSON.stringify(storeResp.error)} — spec will NOT appear in the UI`);
                }
              }
            }
          }
        }
  return comp;
}

export async function runTestPhase(ctx: AutopilotRunCtx, cid: string, compLabel: string, compType: string, comp: Record<string, unknown>, content: string, prompt: string, testScope: 'comprehensive' | 'basic' | 'none'): Promise<{ comp: Record<string, unknown>; content: string; testPassed: boolean }> {
  const { config, jwt, projectId, blueprint, interviewSpec, storage, debug, alog, callLLM, saveComp, entry } = ctx;
        // ── TEST ──
        // Honor the user's "Testauslaajuus" (test scope) selection: 'none' = skip the whole test
        // phase. This is what "Ei testejä — ohita testaus" must do — without it, tests always ran
        // and a single test failure `break`ed the entire pipeline, so later components never reached
        // their spec/code/register steps and their SPEC boxes stayed empty. Skipping tests lets
        // spec + code + register run for every component. Test scope does NOT gate spec generation
        // (specs are produced in the spec phase, long before this block).
        let testPassed = true; // assume passed unless test runs and fails
        if (testScope === 'none') {
          alog.info(`[${cid}] Test scope "none" — skipping test phase (spec + code + register already done)`);
        }
        if (testScope !== 'none' && ['extension', 'cortex', 'app'].includes(compType) && comp.registeredAs) {
          try {
            // Build the test prompt through the SAME backend route the browser UI uses
            // (GET /prompts/:cid?type=test) — identical to loadPromptFromBackend(projectId, id,
            // 'test') in generator-detail.js. The route selects the subtype-specific test prompt
            // (gen-test-cortex-component / -app-domain / -spec, gen-test-extension-spec,
            // gen-test-app) and loads this component's stored spec plus golden samples (the
            // extension's stored probeResults) from the canonical records — the same inputs the
            // inline branches assembled, with no risk of subtype/dependency drift.
            const testPromptResp = await internalFetch(config, `/v1/generator/${projectId}/prompts/${encodeURIComponent(cid)}?type=test`, jwt);
            const testPromptText = ((testPromptResp.data as Record<string, unknown>)?.prompt as string) || '';
            if (!testPromptResp.ok || !testPromptText) {
              throw new Error(`Failed to build test prompt for ${compLabel} (status ${testPromptResp.status}): ${JSON.stringify(testPromptResp.error)}`);
            }

            alog.info(`[${cid}] Generating test for ${compLabel}`);
            debug.writeArtifact(cid, 'test-prompt', testPromptText).catch(() => {});
            let testCode = await callLLM(testPromptText);
            debug.writeArtifact(cid, 'test-raw-response', testCode).catch(() => {});
            testCode = stripCodeblock(testCode);

            const testEnvironment = (compType === 'cortex' || compType === 'app') ? 'browser' : 'server';
            const testResp = await internalFetch(config, `/v1/generator/${projectId}/test/${cid}`, jwt, {
              method: 'POST',
              body: { testCode, environment: testEnvironment },
            });
            let testResult = (testResp.data as Record<string, unknown>)?.result as Record<string, unknown>;
            if (testResult) {
              // Store test result WITHOUT full trace (trace can be 100KB+, exceeds memory value limit)
              // Trace is already saved in debug artifacts and terminal log
              const testResultForStorage = { ...testResult };
              delete (testResultForStorage as Record<string, unknown>).trace;
              comp = { ...comp, testCode, testResult: testResultForStorage };
              await saveComp(comp);
              const testErrors = (testResult.errors as string[]) || [];
              const testTrace = (testResult.trace as Array<Record<string, string>>) || [];
              if (testResult.status === 'passed') {
                alog.info(`[${cid}] ✅ Test PASSED`);
              } else {
                alog.error(`[${cid}] ❌ Test FAILED — ${testErrors.length} errors:`);
                for (const e of testErrors) alog.error(`[${cid}]   - ${e}`);
              }
              // Log trace with shapes
              for (const t of testTrace) {
                const resultStr = t.result || 'null';
                const shapeMatch = resultStr.match(/\[shape extracted from (\d+) chars\]/);
                if (shapeMatch) {
                  const shapeJson = resultStr.slice(0, resultStr.indexOf('\n[shape extracted')).trim().replace(/\s+/g, ' ').slice(0, 500);
                  alog.info(`[${cid}]   [${t.status}] ${t.fn}(${(t.args || '').slice(0, 60)}) → SHAPE: ${shapeJson} [from ${shapeMatch[1]} chars]`);
                } else {
                  alog.info(`[${cid}]   [${t.status}] ${t.fn}(${(t.args || '').slice(0, 60)}) → ${resultStr.slice(0, 300)}`);
                }
              }
            }

            // ── TEST→REFLECT→FIX→RE-REGISTER→RE-TEST cycle ──
            // Matches browser flow: generator-detail.js handleFixFromTest
            const maxTestFixRounds = 2;
            let testFixRound = 0;
            const previousAttempts: Array<Record<string, unknown>> = [];

            while (testResult && testResult.status === 'failed' && testFixRound < maxTestFixRounds && !entry.cancelFlag) {
              testFixRound++;
              alog.info(`[${cid}] Test failed — starting reflect+fix round ${testFixRound}/${maxTestFixRounds}`);

              // Step 1: REFLECT — diagnose the failure (no code, just analysis)
              let reflectionDiagnosis = '';
              try {
                const reflectionPrompt = await buildPrompt(storage, 'gen-reflection', {
                  blueprint: blueprint as unknown as Blueprint,
                  interviewSpec: interviewSpec as unknown as InterviewSpec,
                  code: content,
                  selfSpec: comp.spec as Record<string, unknown> | undefined,
                  errors: (testResult.errors as string[]) || [],
                  testContext: testResult as Record<string, unknown>,
                } as unknown as PromptRuntimeData);
                debug.writeArtifact(cid, `test-fix-${testFixRound}-reflection-prompt`, reflectionPrompt).catch(() => {});
                reflectionDiagnosis = await callLLM(reflectionPrompt);
                debug.writeArtifact(cid, `test-fix-${testFixRound}-reflection-response`, reflectionDiagnosis).catch(() => {});
                alog.info(`[${cid}] Reflection: ${reflectionDiagnosis.slice(0, 200)}`);
              } catch (e) {
                alog.warn(`[${cid}] Reflection failed: ${(e as Error).message}`);
              }

              previousAttempts.push({
                round: testFixRound,
                diagnosis: reflectionDiagnosis.slice(0, 500),
                errors: (testResult.errors as string[]) || [],
              });

              // Step 2: FIX — regenerate extension code with test context + diagnosis
              const fixPrompt = await buildPrompt(storage, 'gen-fix', {
                blueprint: blueprint as unknown as Blueprint,
                interviewSpec: interviewSpec as unknown as InterviewSpec,
                originalPrompt: prompt as string,
                code: content,
                errors: (testResult.errors as string[]) || [],
                componentType: compType,
                testContext: testResult as Record<string, unknown>,
                previousAttempts,
                reflectionDiagnosis,
              } as unknown as PromptRuntimeData);
              debug.writeArtifact(cid, `test-fix-${testFixRound}-fix-prompt`, fixPrompt).catch(() => {});
              let fixedContent = await callLLM(fixPrompt);
              debug.writeArtifact(cid, `test-fix-${testFixRound}-fix-response`, fixedContent).catch(() => {});
              if (compType !== 'cortex') fixedContent = stripCodeblock(fixedContent);

              // Step 3: VALIDATE the fix
              let fixVr = validateComponent(compType, fixedContent, blueprint as unknown as Blueprint);
              if (!fixVr.valid) {
                alog.warn(`[${cid}] Fix round ${testFixRound} validation failed: ${fixVr.errors[0]}`);
                // One more try
                const fixPrompt2 = await buildPrompt(storage, 'gen-fix', {
                  blueprint: blueprint as unknown as Blueprint,
                  interviewSpec: interviewSpec as unknown as InterviewSpec,
                  originalPrompt: prompt as string,
                  code: fixedContent,
                  errors: fixVr.errors,
                  componentType: compType,
                } as unknown as PromptRuntimeData);
                debug.writeArtifact(cid, `test-fix-${testFixRound}-refix-prompt`, fixPrompt2).catch(() => {});
                fixedContent = await callLLM(fixPrompt2);
                debug.writeArtifact(cid, `test-fix-${testFixRound}-refix-response`, fixedContent).catch(() => {});
                if (compType !== 'cortex') fixedContent = stripCodeblock(fixedContent);
                fixVr = validateComponent(compType, fixedContent, blueprint as unknown as Blueprint);
              }

              if (!fixVr.valid) {
                alog.warn(`[${cid}] Fix round ${testFixRound} still invalid — skipping re-register`);
                continue;
              }

              // Step 4: RE-REGISTER
              content = fixedContent;
              comp = { ...comp, result: content, status: 'done', validationErrors: [] };
              await saveComp(comp);
              try {
                await internalFetch(config, `/v1/generator/${projectId}/components/${cid}/submit`, jwt, {
                  method: 'POST', body: { content, type: compType },
                });
                if (['csm', 'msm', 'extension', 'app'].includes(compType)) {
                  await internalFetch(config, `/v1/generator/${projectId}/components/${cid}/register`, jwt, { method: 'POST' });
                }
                if (compType === 'extension' && comp.registeredAs) {
                  await internalFetch(config, `/v1/extensions/${encodeURIComponent(comp.registeredAs as string)}/activate`, jwt, { method: 'POST' });
                }
                // Cortex re-registration: validate to extract manifest+libs, then re-register via cortex API
                if (compType === 'cortex') {
                  const reVr = validateComponent('cortex', content, blueprint as unknown as Blueprint);
                  const extracted = reVr.extracted as { manifest: string; libs: Array<{ filename: string; code: string }> } | undefined;
                  if (extracted?.manifest) {
                    const libs: Record<string, string> = {};
                    for (const lib of (extracted.libs || [])) { if (lib.filename && lib.code) libs[lib.filename] = lib.code; }
                    const newName = extracted.manifest.match(/name:\s*"?([^\s"]+)"?/)?.[1];
                    // Deactivate+delete OLD cortex name if it changed
                    const oldName = comp.registeredAs as string | undefined;
                    if (oldName && oldName !== newName) {
                      await internalFetch(config, `/v1/cortex/${encodeURIComponent(oldName)}/deactivate`, jwt, { method: 'POST' }).catch(() => {});
                      await internalFetch(config, `/v1/cortex/${encodeURIComponent(oldName)}`, jwt, { method: 'DELETE' }).catch(() => {});
                    }
                    // Deactivate+delete new name too (may exist from previous attempt)
                    if (newName) {
                      await internalFetch(config, `/v1/cortex/${encodeURIComponent(newName)}/deactivate`, jwt, { method: 'POST' }).catch(() => {});
                      await internalFetch(config, `/v1/cortex/${encodeURIComponent(newName)}`, jwt, { method: 'DELETE' }).catch(() => {});
                    }
                    await internalFetch(config, '/v1/cortex', jwt, {
                      method: 'POST', body: { manifest: extracted.manifest, ...(Object.keys(libs).length > 0 ? { libs } : {}) },
                    });
                    if (newName) {
                      await internalFetch(config, `/v1/cortex/${encodeURIComponent(newName)}/activate`, jwt, { method: 'POST' });
                      // Update registeredAs if name changed
                      if (newName !== oldName) {
                        comp = { ...comp, registeredAs: newName };
                        await saveComp(comp);
                        alog.info(`[${cid}] Cortex name changed: ${oldName} → ${newName}`);
                      }
                    }
                  }
                }
                alog.info(`[${cid}] Re-registered after fix round ${testFixRound}`);
                // Update debug artifacts with the actual registered code
                debug.writeComponentGenerated(cid, content).catch(() => {});
              } catch (e) {
                alog.warn(`[${cid}] Re-registration failed: ${(e as Error).message}`);
                break;
              }

              // Step 5: RE-TEST with the same test code
              try {
                const reTestResp = await internalFetch(config, `/v1/generator/${projectId}/test/${cid}`, jwt, {
                  method: 'POST', body: { testCode, environment: testEnvironment },
                });
                testResult = (reTestResp.data as Record<string, unknown>)?.result as Record<string, unknown>;
                if (testResult) {
                  const reTestForStorage = { ...testResult }; delete (reTestForStorage as Record<string, unknown>).trace;
                  comp = { ...comp, testResult: reTestForStorage };
                  await saveComp(comp);
                  const reTestErrors = (testResult.errors as string[]) || [];
                  if (testResult.status === 'passed') {
                    alog.info(`[${cid}] ✅ Re-test round ${testFixRound}: PASSED`);
                  } else {
                    alog.error(`[${cid}] ❌ Re-test round ${testFixRound}: FAILED — ${reTestErrors.length} errors:`);
                    for (const e of reTestErrors) alog.error(`[${cid}]   - ${e}`);
                  }
                }
              } catch (e) {
                alog.warn(`[${cid}] Re-test failed: ${(e as Error).message}`);
                break;
              }
            }

            // Final round: fresh generation if still failing
            if (testResult && testResult.status === 'failed' && !entry.cancelFlag) {
              alog.info(`[${cid}] All fix rounds exhausted — trying fresh generation`);
              try {
                const freshPrompt = await buildPrompt(storage, 'gen-fresh-generation', {
                  blueprint: blueprint as unknown as Blueprint,
                  interviewSpec: interviewSpec as unknown as InterviewSpec,
                  originalPrompt: prompt as string,
                  previousAttempts,
                  testContext: testResult as Record<string, unknown>,
                } as unknown as PromptRuntimeData);
                debug.writeArtifact(cid, 'fresh-generation-prompt', freshPrompt).catch(() => {});
                let freshContent = await callLLM(freshPrompt);
                debug.writeArtifact(cid, 'fresh-generation-response', freshContent).catch(() => {});
                if (compType !== 'cortex') freshContent = stripCodeblock(freshContent);
                const freshVr = validateComponent(compType, freshContent, blueprint as unknown as Blueprint);
                if (freshVr.valid) {
                  content = freshContent;
                  comp = { ...comp, result: content, status: 'done' };
                  await saveComp(comp);
                  // Re-register fresh
                  await internalFetch(config, `/v1/generator/${projectId}/components/${cid}/submit`, jwt, {
                    method: 'POST', body: { content, type: compType },
                  });
                  if (['csm', 'msm', 'extension', 'app'].includes(compType)) {
                    await internalFetch(config, `/v1/generator/${projectId}/components/${cid}/register`, jwt, { method: 'POST' });
                  }
                  if (compType === 'extension' && comp.registeredAs) {
                    await internalFetch(config, `/v1/extensions/${encodeURIComponent(comp.registeredAs as string)}/activate`, jwt, { method: 'POST' });
                  }
                  // Cortex fresh re-registration
                  if (compType === 'cortex') {
                    const freshExtracted = freshVr.extracted as { manifest: string; libs: Array<{ filename: string; code: string }> } | undefined;
                    if (freshExtracted?.manifest) {
                      const libs: Record<string, string> = {};
                      for (const lib of (freshExtracted.libs || [])) { if (lib.filename && lib.code) libs[lib.filename] = lib.code; }
                      const newName = freshExtracted.manifest.match(/name:\s*"?([^\s"]+)"?/)?.[1];
                      const oldName = comp.registeredAs as string | undefined;
                      if (oldName && oldName !== newName) {
                        await internalFetch(config, `/v1/cortex/${encodeURIComponent(oldName)}/deactivate`, jwt, { method: 'POST' }).catch(() => {});
                        await internalFetch(config, `/v1/cortex/${encodeURIComponent(oldName)}`, jwt, { method: 'DELETE' }).catch(() => {});
                      }
                      if (newName) {
                        await internalFetch(config, `/v1/cortex/${encodeURIComponent(newName)}/deactivate`, jwt, { method: 'POST' }).catch(() => {});
                        await internalFetch(config, `/v1/cortex/${encodeURIComponent(newName)}`, jwt, { method: 'DELETE' }).catch(() => {});
                      }
                      await internalFetch(config, '/v1/cortex', jwt, {
                        method: 'POST', body: { manifest: freshExtracted.manifest, ...(Object.keys(libs).length > 0 ? { libs } : {}) },
                      });
                      if (newName) {
                        await internalFetch(config, `/v1/cortex/${encodeURIComponent(newName)}/activate`, jwt, { method: 'POST' });
                        if (newName !== oldName) {
                          comp = { ...comp, registeredAs: newName };
                          await saveComp(comp);
                          alog.info(`[${cid}] Cortex name changed: ${oldName} → ${newName}`);
                        }
                      }
                    }
                  }
                  alog.info(`[${cid}] Fresh generation registered — re-testing`);
                  const reTestResp = await internalFetch(config, `/v1/generator/${projectId}/test/${cid}`, jwt, {
                    method: 'POST', body: { testCode, environment: testEnvironment },
                  });
                  testResult = (reTestResp.data as Record<string, unknown>)?.result as Record<string, unknown>;
                  if (testResult) {
                    const freshTestForStorage = { ...testResult }; delete (freshTestForStorage as Record<string, unknown>).trace;
                    comp = { ...comp, testResult: freshTestForStorage };
                    await saveComp(comp);
                    alog.info(`[${cid}] Fresh generation test: ${testResult.status as string}`);
                  }
                } else {
                  alog.warn(`[${cid}] Fresh generation validation failed: ${freshVr.errors[0]}`);
                }
              } catch (e) {
                alog.warn(`[${cid}] Fresh generation failed: ${(e as Error).message}`);
              }
            }

          } catch (e) {
            alog.error(`[${cid}] Test execution failed: ${(e as Error).message}`);
          }

          // Check final test status
          const finalTestResult = comp.testResult as Record<string, unknown> | undefined;
          if (finalTestResult && finalTestResult.status === 'failed') {
            testPassed = false;
          }
        }
  return { comp, content, testPassed };
}
