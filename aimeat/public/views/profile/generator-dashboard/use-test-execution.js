/**
 * @file use-test-execution.js
 * @description Custom hook for test execution — manages test scope selection,
 *   batch test runs, per-component test fix requests, and test result accumulation.
 *
 *   Part of the hook-per-domain architecture for ProjectDashboard. This hook owns
 *   all testing-related state (scope, running flag, report, fix round counter) and
 *   exposes handlers for running tests and fixing failed components.
 *
 *   Exposes testScopeRef/testReportRef for stale-closure-safe reads from long-running
 *   async operations in useAutopilot. The autopilot hook calls pushTestResult() to
 *   add test results during the generation pipeline.
 *
 *   Architecture: useDashboardCore → useTestExecution
 *                   ↑ pushTestResult called by useAutopilot
 *                   ↑ testScopeRef/testReportRef read by useAutopilot
 *
 * @structure
 *   - useTestExecution(core, projectId, orSettings, session, showToast): custom hook
 *     State: testScope, testRunning, testReport, testFixRound
 *     Refs: testScopeRef, testReportRef (mirrors for stale-closure safety)
 *     Handlers: handleRunTests, handleTestFixRequest, pushTestResult
 * @usage
 *   import { useTestExecution } from './generator-dashboard/use-test-execution.js';
 *   const testExec = useTestExecution(core, projectId, orSettings, session, showToast);
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js ProjectDashboard
 */
import { useState, useEffect, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiPost } from '/js/api.js';
import {
  loadAllComponents, saveComponent, registerComponent, writeProjectLog,
} from '/js/services/generator.js';
import { buildComponentPrompt, buildFixPrompt, buildReflectionPrompt, buildTestPrompt } from '/js/services/generator-prompts.js';
import { validateComponent } from '/js/services/generator-validate.js';
import { runTests, runComponentTest } from '/js/services/generator-testing.js';
import { runWithAi, stripCodeblock } from '../generator-detail.js';

/**
 * @param {Object} core — useDashboardCore return value
 * @param {string} projectId
 * @param {Object} orSettings — OpenRouter settings { hasApiKey, autoRetry, maxRetries }
 * @param {Object} session
 * @param {Function} showToast
 */
export function useTestExecution(core, projectId, orSettings, session, showToast) {
  const [testScope, setTestScope] = useState('comprehensive');
  const [testRunning, setTestRunning] = useState(false);
  const [testReport, setTestReport] = useState(null);
  const [testFixRound, setTestFixRound] = useState(0);

  // Ref mirrors for stale-closure-safe reads from useAutopilot's long-running loops
  const testScopeRef = useRef(testScope);
  useEffect(() => { testScopeRef.current = testScope; }, [testScope]);
  const testReportRef = useRef(testReport);
  useEffect(() => { testReportRef.current = testReport; }, [testReport]);

  /**
   * Push a test result into the report — called by useAutopilot during per-component testing.
   * Uses functional updater to always work with latest state.
   */
  function pushTestResult(componentId, label, result) {
    result.label = label;
    setTestReport(prev => {
      const existing = prev || { level: testScopeRef.current, timestamp: new Date().toISOString(), components: [], overall: 'passed' };
      const comps = existing.components.filter(c => c.componentId !== componentId);
      comps.push(result);
      const failedCount = comps.filter(c => c.status === 'failed').length;
      const passedCount = comps.filter(c => c.status === 'passed').length;
      return { ...existing, components: comps, overall: failedCount === 0 ? 'passed' : (passedCount > 0 ? 'partial' : 'failed') };
    });
  }

  async function handleRunTests() {
    if (testScope === 'none') return;
    setTestRunning(true);
    setTestReport(null);
    const testableTypes = ['extension', 'cortex', 'app'];
    const freshComps = await loadAllComponents(projectId);
    const testableComps = freshComps.filter(c => testableTypes.includes(c.type) && c.registeredAs);

    if (testableComps.length === 0) {
      showToast?.(t('profile.generator.test_no_testable'), true);
      setTestRunning(false);
      return;
    }

    const report = { level: testScope, timestamp: new Date().toISOString(), components: [], overall: 'passed' };
    await writeProjectLog(projectId, 'tests_batch_start', { meta: { scope: testScope, count: testableComps.length } });

    for (const comp of testableComps) {
      const testEnvironment = (comp.type === 'cortex' || comp.type === 'app') ? 'browser' : 'server';

      // Ensure settings are applied and extension/cortex is activated before testing
      if (comp.type === 'extension') {
        try { await apiPost(`/v1/generator/${projectId}/apply-settings/${encodeURIComponent(comp.registeredAs)}`); } catch { /* */ }
      }
      if (comp.type === 'extension' || comp.type === 'cortex') {
        try {
          const actUrl = comp.type === 'extension'
            ? `/v1/extensions/${encodeURIComponent(comp.registeredAs)}/activate`
            : `/v1/cortex/${encodeURIComponent(comp.registeredAs)}/activate`;
          await apiPost(actUrl);
        } catch { /* already active */ }
      }

      // Generate fresh test code
      let testCode = null;
      try {
        await writeProjectLog(projectId, 'test_prompt_generating', { meta: { component: comp.label, type: comp.type, by: 'batch' } });
        const testPrompt = buildTestPrompt(
          comp.type, comp.result, comp.label, comp.registeredAs,
          core.project?.blueprint, core.interviewSpec
        );
        testCode = await runWithAi(projectId, testPrompt);
        testCode = stripCodeblock(testCode);
        await saveComponent(projectId, { ...comp, testPrompt, testCode, testEnvironment });
        await writeProjectLog(projectId, 'test_code_generated', { meta: { component: comp.label, environment: testEnvironment, by: 'batch' } });
      } catch (e) {
        await writeProjectLog(projectId, 'test_code_generation_failed', { meta: { component: comp.label, error: e.message, by: 'batch' } });
        report.components.push({ componentId: comp.id, label: comp.label, type: comp.type, status: 'failed', scenarios: 0, passed: 0, errors: [`Test generation failed: ${e.message}`], screenshots: [], fixRound: 0 });
        continue;
      }

      // Execute test
      try {
        await writeProjectLog(projectId, 'test_executing', { meta: { component: comp.label, environment: testEnvironment, by: 'batch' } });
        const testResp = await runComponentTest(projectId, comp.id, testCode, testEnvironment);
        const testResult = testResp?.data?.result || testResp?.result;
        if (testResult) {
          testResult.label = comp.label;
          report.components.push(testResult);
          await saveComponent(projectId, { ...comp, testResult });
          await writeProjectLog(projectId, 'component_test_' + testResult.status, { meta: { component: comp.label, errors: testResult.errors, by: 'batch' } });
        } else {
          report.components.push({ componentId: comp.id, label: comp.label, type: comp.type, status: 'failed', scenarios: 0, passed: 0, errors: ['No test result returned'], screenshots: [], fixRound: 0 });
        }
      } catch (e) {
        report.components.push({ componentId: comp.id, label: comp.label, type: comp.type, status: 'failed', scenarios: 0, passed: 0, errors: [e.message], screenshots: [], fixRound: 0 });
        await writeProjectLog(projectId, 'component_test_error', { meta: { component: comp.label, error: e.message, by: 'batch' } });
      }

      // Update report status
      const failedCount = report.components.filter(c => c.status === 'failed').length;
      const passedCount = report.components.filter(c => c.status === 'passed').length;
      report.overall = failedCount === 0 ? 'passed' : (passedCount > 0 ? 'partial' : 'failed');
      setTestReport({ ...report });
    }

    await writeProjectLog(projectId, 'tests_batch_complete', { meta: { scope: testScope, overall: report.overall, total: report.components.length } });
    if (report.overall === 'passed') {
      showToast?.(t('profile.generator.test_passed'));
    } else {
      showToast?.(t('profile.generator.test_failed'), true);
    }
    setTestRunning(false);
    await core.loadData();
  }

  async function handleTestFixRequest(componentId, action) {
    if (action === 'skip') return;
    if (action === 'manual') {
      core.setSelectedId(componentId);
      return;
    }
    // action === 'auto'
    const MAX_FIX_ROUNDS = 3;
    if (testFixRound >= MAX_FIX_ROUNDS) {
      showToast?.(t('profile.generator.test_fix_round') + ' ' + MAX_FIX_ROUNDS + ' — ' + t('profile.generator.test_fix_manual'), true);
      return;
    }

    const comp = core.components.find(c => c.id === componentId);
    if (!comp) return;

    const failedTestComp = testReport?.components?.find(c => c.componentId === componentId);
    if (!failedTestComp) return;

    const blueprintComp = core.project?.blueprint?.components?.find(c => c.id === componentId);
    const testContext = {
      errors: failedTestComp.errors || [],
      trace: failedTestComp.trace || [],
      dependencyResults: (testReport?.components || [])
        .filter(c => c.componentId !== componentId && c.status === 'passed')
        .map(c => ({ componentId: c.componentId, status: c.status })),
      blueprintComponent: blueprintComp || null,
    };

    setTestRunning(true);
    setTestFixRound(prev => prev + 1);
    showToast?.(t('profile.generator.test_fix_round') + ' ' + (testFixRound + 1));

    try {
      const completedComps = core.components.filter(c => c.status === 'done' && c.registeredAs);
      const originalPrompt = comp.prompt || buildComponentPrompt(
        comp.type, comp.label,
        core.project?.description, core.project?.blueprint, completedComps,
        core.interviewSpec,
      );
      // Step 1: Reflection — diagnose the failure before writing code
      let reflectionDiagnosis = '';
      try {
        const reflectionPrompt = buildReflectionPrompt(comp.result || '', failedTestComp.errors || [], testContext);
        reflectionDiagnosis = await runWithAi(projectId, reflectionPrompt);
      } catch { /* reflection is optional enhancement */ }

      const fixP = buildFixPrompt(originalPrompt, comp.result || '', failedTestComp.errors || [], comp.type, testContext, null, reflectionDiagnosis);

      let content = await runWithAi(projectId, fixP);
      content = stripCodeblock(content);

      let vr = validateComponent(comp.type, content, core.project?.blueprint);

      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          showToast?.(t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
          const retryP = buildFixPrompt(originalPrompt, content, vr.errors, comp.type);
          content = await runWithAi(projectId, retryP);
          content = stripCodeblock(content);
          vr = validateComponent(comp.type, content, core.project?.blueprint);
        }
      }

      if (!vr.valid) {
        showToast?.(t('profile.generator.openrouter.stepFailed') + ': ' + comp.label, true);
        setTestRunning(false);
        return;
      }

      const updated = {
        ...comp, status: 'done', result: content, validationErrors: [],
        history: [...(comp.history || []),
          { action: 'test_fix', at: new Date().toISOString(), by: 'autopilot', round: testFixRound + 1 },
        ],
      };
      await saveComponent(projectId, updated);

      // Re-register
      const extComp = core.components.find(c => c.type === 'extension' && c.registeredAs);
      const csmComp = core.components.find(c => c.type === 'csm' && c.registeredAs);
      const serviceSlug = extComp?.registeredAs || csmComp?.registeredAs?.split('/')?.pop() || '';
      if (comp.type === 'cortex') {
        const cortexVr = validateComponent('cortex', content, core.project?.blueprint);
        await registerComponent('cortex', cortexVr.extracted, session, serviceSlug);
      } else {
        await registerComponent(comp.type, vr.extracted || content, session, serviceSlug);
      }
      await writeProjectLog(projectId, 'test_fix_registered', { meta: { component: comp.label, round: testFixRound + 1 } });
      await core.loadData();

      // Re-run tests
      const resp = await runTests(projectId, testScope);
      const report = resp?.data || resp;
      setTestReport(report);
      await writeProjectLog(projectId, 'tests_rerun', { meta: { scope: testScope, overall: report.overall, fixRound: testFixRound + 1 } });

      if (report.overall === 'passed') {
        showToast?.(t('profile.generator.test_passed'));
      } else {
        showToast?.(t('profile.generator.test_failed'), true);
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
    setTestRunning(false);
  }

  return {
    testScope, setTestScope, testScopeRef,
    testRunning, testReport, testReportRef,
    handleRunTests, handleTestFixRequest, pushTestResult,
  };
}
