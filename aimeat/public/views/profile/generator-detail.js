/**
 * @file generator-detail.js
 * @description Per-component detail editor and test UI for the service generator.
 *   Handles the generate → validate → register workflow for individual components,
 *   plus test prompt generation, test execution, and result display.
 *   Also exports shared AI utility functions (runWithAi, stripCodeblock, cancelAiRequest).
 * @structure
 *   - ComponentDetail: main per-component editor panel
 *   Re-exports (from sibling modules, kept here for import compatibility):
 *   - runWithAi, stripCodeblock, cancelAiRequest (./generator-detail.ai.js)
 *   - getWorkflowStep (./generator-detail.helpers.js)
 *   - TestScopeSelector, TestResultsView (./generator-detail.results.js)
 * @usage
 *   import { ComponentDetail, TestScopeSelector, TestResultsView } from './generator-detail.js';
 *   import { runWithAi, stripCodeblock, cancelAiRequest } from './generator-detail.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js (was inline in v6.1.0)
 *   v1.1.0 — 2026-03-24 — Fix useEffect deps (testCode/testResult sync), add trace display
 *   v1.2.0 — 2026-03-25 — Fix validationResult reset: Register button no longer disappears after validation passes
 *   v1.3.0 — 2026-03-26 — V5: context bundles on register, explain step before validation
 *   v1.4.0 — 2026-07-13 — Split for max-file-lines: AI utils, workflow helpers, spec section and
 *     results view moved to sibling modules (behavior unchanged; re-exported for compatibility)
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPost } from '/js/api.js';
import { copyToClipboard } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';
import {
  saveComponent, saveSpec, registerComponent, reregisterComponent, writeProjectLog, writeDebugArtifact,
} from '/js/services/generator.js';
// All prompts (including the self-correction ones) are loaded from the database via API —
// single source of truth shared with the autopilot. No browser-side prompt builders remain.
import { validateComponent } from '/js/services/generator-validate.js';
import { verifyContract } from '/js/services/generator-contract.js';
import { smokeTest } from '/js/services/generator-smoke.js';
import { createBundle } from '/js/services/generator-context-bundle.js';
import { runComponentTest, screenshotUrl } from '/js/services/generator-testing.js';
import { runWithAi, stripCodeblock, cancelAiRequest, loadPromptFromBackend, buildPromptFromBackend } from './generator-detail.ai.js';
import { getWorkflowStep, StepArrow } from './generator-detail.helpers.js';
import { SpecSection } from './generator-detail.spec-section.js';
import { TestScopeSelector, TestResultsView } from './generator-detail.results.js';
import { useConfirm } from '/components/Modal.js';

// Re-export moved symbols so existing consumers (generator-tab, generator-dashboard, dashboard hooks)
// keep importing them from this module unchanged.
export { runWithAi, stripCodeblock, cancelAiRequest };
export { getWorkflowStep };
export { TestScopeSelector, TestResultsView };

/* ── ComponentDetail ─────────────────────────────────── */

export function ComponentDetail({ component, project, projectId, liveStatuses, onUpdate, onAdvance, showToast, session, orSettings }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [result, setResult] = useState(component.result || '');
  const [validationResult, setValidationResult] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const resultRef = { current: null };
  const prevCompIdRef = useRef(component.id);
  const [generatedPrompt, setGeneratedPrompt] = useState(null);

  // Spec state (for extension and cortex types)
  const hasSpec = ['extension', 'cortex', 'app'].includes(component.type);
  const [specPrompt, setSpecPrompt] = useState('');
  const [specResult, setSpecResult] = useState(component.spec ? JSON.stringify(component.spec, null, 2) : '');
  const [specAiRunning, setSpecAiRunning] = useState(false);
  const [specValidation, setSpecValidation] = useState(null); // { valid, errors }

  // Test state
  const [testCode, setTestCode] = useState(component.testCode || '');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(component.testResult || null);

  useEffect(() => {
    const componentSwitched = prevCompIdRef.current !== component.id;
    prevCompIdRef.current = component.id;

    setResult(component.result || '');
    setTestCode(component.testCode || '');
    setTestResult(component.testResult || null);
    // Only reset validationResult when switching to a different component.
    // When status changes (e.g. validating→done) within the same component,
    // keep validationResult so the Register button stays visible.
    // Reset state on component switch OR component reset (status goes back to pending/not_started)
    const wasReset = !componentSwitched && (component.status === 'pending' || component.status === 'not_started') && !component.result;
    if (componentSwitched || wasReset) {
      setValidationResult(null);
      setGeneratedPrompt(null);
      setSpecResult(component.spec ? JSON.stringify(component.spec, null, 2) : '');
      setSpecPrompt('');
      setSpecValidation(null);
      setCurrentTestPrompt(null);
    }
    // Auto-transition to prompt_ready when opening an unstarted component
    if (component.status === 'not_started') {
      loadPromptFromBackend(projectId, component.id, 'code').then(prompt => {
        saveComponent(projectId, {
          ...component, status: 'prompt_ready', prompt,
          history: [...(component.history || []), { action: 'prompt_generated', at: new Date().toISOString(), by: 'system' }],
        }).then(() => onUpdate());
      });
    }
    // Resolve prompt for display if not already stored on component
    if (!component.prompt) {
      loadPromptFromBackend(projectId, component.id, 'code')
        .then(p => setGeneratedPrompt(p))
        .catch(() => {}); // silently fail if not ready
    }
    // Load spec prompt for extension/cortex types
    if (hasSpec && !specPrompt) {
      loadPromptFromBackend(projectId, component.id, 'spec')
        .then(p => setSpecPrompt(p))
        .catch(e => console.warn('Spec prompt load failed:', e.message));
    }
    // Load existing spec result
    if (component.spec && !specResult) {
      setSpecResult(JSON.stringify(component.spec, null, 2));
    }
    // Hand-tuned trigger list: react only to these specific component fields. Depending on the whole
    // `component` object, `onUpdate`, `projectId`, or the spec* state would broaden triggers and risk
    // a save→onUpdate→re-run loop (see v1.1.0 "Fix useEffect deps").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [component.id, component.result, component.status, component.testCode, component.testResult]);

  const prompt = component.prompt || generatedPrompt || '';

  // Workflow step for guided UI
  const workflowStep = getWorkflowStep(component, validationResult, result);

  function addHistory(comp, action, extra = {}) {
    return { ...comp, history: [...(comp.history || []), { action, at: new Date().toISOString(), by: 'user', ...extra }] };
  }

  async function handleValidate() {
    const validating = addHistory(component, 'validating');
    await saveComponent(projectId, { ...validating, status: 'validating', result });

    const vr = validateComponent(component.type, result, project.blueprint);
    setValidationResult(vr);
    if (vr.valid) {
      // Contract verification — check generated output matches blueprint contract
      const bpComp = project.blueprint?.components?.find(c => c.label === component.label || c.id === component.id);
      const cr = verifyContract(component.type, result, bpComp, project.blueprint);
      if (!cr.valid) {
        vr.valid = false;
        vr.errors = [...(vr.errors || []), ...cr.mismatches.map(m => `Contract: ${m}`)];
        setValidationResult(vr);
      }
    }
    if (vr.valid) {
      const done = addHistory(validating, 'validation_passed');
      await saveComponent(projectId, { ...done, status: 'done', result, validationErrors: [] });
    } else {
      const errored = addHistory(validating, 'validation_failed', { errors: vr.errors });
      await saveComponent(projectId, { ...errored, status: 'errors', result, validationErrors: vr.errors });
    }
    onUpdate();
  }

  async function handleRegister() {
    setRegistering(true);
    try {
      // service_slug from blueprint — the single source of truth for namespacing
      const serviceSlug = project?.blueprint?.service_slug;
      if (!serviceSlug) {
        showToast?.('Blueprint missing "service_slug" — cannot register component. Regenerate blueprint.', true);
        setRegistering(false);
        return;
      }

      let resp;
      if (component.type === 'cortex') {
        const vr = validateComponent('cortex', component.result || result, project.blueprint);
        if (!vr.valid) {
          showToast?.((t('profile.generator.validationFailed')) + ': ' + vr.errors.join(', '), true);
          setRegistering(false);
          return;
        }
        resp = await registerComponent('cortex', vr.extracted, session, serviceSlug);
      } else {
        resp = await registerComponent(component.type, validationResult?.extracted || result, session, serviceSlug);
      }
      // Extract registered name from response — each type returns a different shape
      const d = resp?.data || {};
      const regName = d.csm?.name           // CSM: { data: { csm: { name } } }
        || d.integration?.name              // MSM: { data: { integration: { name } } }
        || d.extension?.name                // Extension: { data: { extension: { name } } }
        || d.filename                       // App: { data: { filename } }
        || d.name                           // Cortex/Translation: { data: { name } }
        || d.id
        || (d.locales ? `i18n.${d.locales.join('.')}` : null) // Translation fallback
        || (d.keys?.length ? `memory:${d.keys[d.keys.length - 1]}` : null)   // Memory: use last key name (e.g. "memory:municipalities.data")
        || null;
      if (!regName) {
        // Registration succeeded but we couldn't extract the name — warn user
        showToast?.(t('profile.generator.registrationNameMissing'), true);
        setRegistering(false);
        return;
      }
      const registered = addHistory(component, 'registered', { registeredAs: regName });
      // Create context bundle for downstream prompts (probe results added later if probed)
      const bundle = createBundle({ ...registered, registeredAs: regName, result }, []);
      // Preserve spec from earlier spec-generation step (if it exists on the component)
      const compWithSpec = component.spec ? { ...registered, spec: component.spec } : registered;
      await saveComponent(projectId, { ...compWithSpec, status: 'done', registeredAs: regName, contextBundle: bundle });
      // Save spec independently — survives future component state overwrites
      if (component.spec && component.id) {
        await saveSpec(projectId, component.id, component.spec).catch(() => {});
      }
      // Smoke test after registration — catch load failures early
      const smoke = await smokeTest(component.type, regName, session);
      if (!smoke.passed) {
        showToast?.(`Smoke test failed: ${smoke.error}`, true);
      } else {
        showToast?.(t('profile.generator.componentRegistered').replace('{name}', regName));
      }
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      await onUpdate();
      // Auto-advance to next component after successful registration
      if (onAdvance) onAdvance(component.id);
    } catch (e) {
      setValidationResult({ valid: false, errors: [`Registration failed: ${e.message}`] });
      showToast?.(e.message, true);
    }
    setRegistering(false);
  }

  async function handleReregister() {
    setRegistering(true);
    try {
      // service_slug from blueprint — the single source of truth for namespacing
      const serviceSlug = project?.blueprint?.service_slug;
      if (!serviceSlug) {
        showToast?.('Blueprint missing "service_slug" — cannot re-register. Regenerate blueprint.', true);
        setRegistering(false);
        return;
      }

      // Re-validate current result before re-registering
      const vr = validateComponent(component.type, component.result || result, project.blueprint);
      if (!vr.valid) {
        showToast?.((t('profile.generator.validationFailed')) + ': ' + vr.errors.join(', '), true);
        setRegistering(false);
        return;
      }

      const resp = await reregisterComponent(projectId, component, vr, session, serviceSlug, liveStatuses);
      const d = resp?.data || {};
      const regName = d.csm?.name || d.integration?.name || d.extension?.name
        || d.filename || d.name || d.id
        || (d.locales ? `i18n.${d.locales.join('.')}` : null)
        || (d.keys?.length ? `memory:${d.keys[d.keys.length - 1]}` : null)
        || component.registeredAs;
      const updated = { ...component, status: 'done', registeredAs: regName,
        history: [...(component.history || []), { action: 're-registered', at: new Date().toISOString(), by: 'user', registeredAs: regName }],
      };
      await saveComponent(projectId, updated);
      showToast?.(t('profile.generator.reregistered').replace('{name}', regName));
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      await onUpdate();
    } catch (e) {
      showToast?.(t('profile.generator.reregisterFailed').replace('{error}', e.message), true);
    }
    setRegistering(false);
  }

  async function handleRegeneratePrompt() {
    const fresh = await loadPromptFromBackend(projectId, component.id, 'code');
    const updated = addHistory(component, 'prompt_regenerated');
    await saveComponent(projectId, { ...updated, status: 'prompt_ready', prompt: fresh });
    showToast?.(t('profile.generator.promptRegenerated'));
    onUpdate();
  }

  function handleResetComponent() {
    confirm('Reset this component? Spec, code, test results, and registration will all be cleared.', async () => {
    try {
      const s = session || window.AIMEAT?.auth?.getSession?.();
      if (!s) return;
      const resp = await s.fetch(`/v1/generator/${projectId}/components/${component.id}/reset`, { method: 'POST' });
      if (resp.ok) {
        // Clear all local state
        setResult('');
        setValidationResult(null);
        setSpecResult('');
        setSpecPrompt('');
        setSpecValidation(null);
        setGeneratedPrompt(null);
        setTestCode('');
        setTestResult(null);
        setCurrentTestPrompt(null);
        showToast?.('Component reset — ready for regeneration');
        // Reload spec prompt immediately after reset
        if (hasSpec) {
          loadPromptFromBackend(projectId, component.id, 'spec')
            .then(p => setSpecPrompt(p))
            .catch(e => console.warn('Spec prompt reload after reset failed:', e.message));
        }
        onUpdate();
      } else {
        showToast?.('Reset failed: ' + (resp.error?.message || 'Unknown error'), true);
      }
    } catch (e) {
      showToast?.('Reset failed: ' + e.message, true);
    }
    }, { danger: true });
  }

  async function handleCopyPrompt() {
    const fresh = await loadPromptFromBackend(projectId, component.id, 'code');
    try {
      await copyToClipboard(fresh);
      const updated = addHistory(component, 'prompt_copied');
      await saveComponent(projectId, { ...updated, status: 'waiting_user', prompt: fresh });
      showToast?.(t('profile.generator.promptCopied'));
      onUpdate();
    } catch { /* clipboard fallback */ }
  }

  async function handleRunComponentAi() {
    setAiRunning(true);
    try {
      const fresh = await loadPromptFromBackend(projectId, component.id, 'code');
      writeDebugArtifact(projectId, component.id, 'prompt', fresh);
      let content = await runWithAi(projectId, fresh);
      writeDebugArtifact(projectId, component.id, 'ai-raw-response', content);
      // Cortex validator needs fenced blocks (```yaml + ```javascript) to extract manifest+libs
      if (component.type !== 'cortex') content = stripCodeblock(content);
      setResult(content);

      // Validate
      let vr = validateComponent(component.type, content, project.blueprint);

      // Auto-retry if enabled
      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          showToast?.(t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
          const fp = await buildPromptFromBackend(projectId, 'gen-fix', {
            componentId: component.id, originalPrompt: fresh, code: content, errors: vr.errors, componentType: component.type,
          });
          content = await runWithAi(projectId, fp);
          setResult(content);
          vr = validateComponent(component.type, content, project.blueprint);
        }
      }

      setValidationResult(vr);
      if (vr.valid) {
        const done = addHistory(component, 'validation_passed', { by: 'autopilot' });
        await saveComponent(projectId, { ...done, status: 'done', result: content, validationErrors: [], prompt: fresh });
        showToast?.(t('profile.generator.openrouter.stepComplete'));
      } else {
        const errored = addHistory(component, 'validation_failed', { errors: vr.errors, by: 'autopilot' });
        await saveComponent(projectId, { ...errored, status: 'errors', result: content, validationErrors: vr.errors, prompt: fresh });
        showToast?.(t('profile.generator.openrouter.stepFailed'), true);
      }
      onUpdate();
    } catch (e) {
      console.error('[generator] AI run failed:', e);
      showToast?.(e.message, true);
    }
    setAiRunning(false);
  }

  // Self-correction prompts — fetched from the DB (single source of truth) on validation
  // transitions, not on every keystroke. Reflection + fix are built for the failed code;
  // explain is offered after generation, before validation.
  const [reflectionPrompt, setReflectionPrompt] = useState(null);
  const [fixPrompt, setFixPrompt] = useState(null);
  const [explainPrompt, setExplainPrompt] = useState(null);

  const validationFailed = !!(validationResult && !validationResult.valid);
  useEffect(() => {
    if (validationFailed) {
      buildPromptFromBackend(projectId, 'gen-reflection', {
        componentId: component.id, code: result, errors: validationResult.errors, componentType: component.type,
      }).then(setReflectionPrompt).catch(() => setReflectionPrompt(null));
      buildPromptFromBackend(projectId, 'gen-fix', {
        componentId: component.id, originalPrompt: prompt, code: result, errors: validationResult.errors, componentType: component.type,
      }).then(setFixPrompt).catch(() => setFixPrompt(null));
    } else {
      setReflectionPrompt(null);
      setFixPrompt(null);
    }
    // Intentionally keyed on the validation transition, not `result`, to avoid a network
    // POST on every keystroke — the failed code is captured when validation ran.
    // eslint-disable-next-line
  }, [validationResult, projectId, component.id, component.type]);

  const canExplain = !!(result.trim() && !validationResult);
  useEffect(() => {
    if (canExplain) {
      buildPromptFromBackend(projectId, 'gen-explain', {
        componentId: component.id, code: result, componentType: component.type,
      }).then(setExplainPrompt).catch(() => setExplainPrompt(null));
    } else {
      setExplainPrompt(null);
    }
    // eslint-disable-next-line
  }, [canExplain, projectId, component.id, component.type]);

  // Test prompt for testable component types
  const testableTypes = ['extension', 'cortex', 'app'];
  const isTestable = testableTypes.includes(component.type) && component.registeredAs;
  const testEnvironment = (component.type === 'cortex' || component.type === 'app') ? 'browser' : 'server';
  const [currentTestPrompt, setCurrentTestPrompt] = useState(null);

  // Load test prompt from backend when component is testable
  useEffect(() => {
    if (isTestable) {
      loadPromptFromBackend(projectId, component.id, 'test')
        .then(p => setCurrentTestPrompt(p))
        .catch(() => setCurrentTestPrompt(null));
    } else {
      setCurrentTestPrompt(null);
    }
  }, [component.id, component.registeredAs, isTestable, projectId]);

  async function handleCopyTestPrompt() {
    if (!currentTestPrompt) return;
    try {
      await copyToClipboard(currentTestPrompt);
      showToast?.(t('profile.generator.test_prompt_copied'));
      await writeProjectLog(projectId, 'test_prompt_copied', { meta: { component: component.label, by: 'user' } });
    } catch { /* clipboard fallback */ }
  }

  async function handleRunComponentTest() {
    if (!testCode.trim()) return;
    setTestRunning(true);
    setTestResult(null);
    // Ensure settings are applied and extension/cortex is activated before testing
    if (component.type === 'extension') {
      try { await apiPost(`/v1/generator/${projectId}/apply-settings/${encodeURIComponent(component.registeredAs)}`); } catch { /* */ }
    }
    if (component.type === 'extension' || component.type === 'cortex') {
      try {
        const actUrl = component.type === 'extension'
          ? `/v1/extensions/${encodeURIComponent(component.registeredAs)}/activate`
          : `/v1/cortex/${encodeURIComponent(component.registeredAs)}/activate`;
        await apiPost(actUrl);
      } catch { /* already active */ }
    }
    await writeProjectLog(projectId, 'test_executing', { meta: { component: component.label, environment: testEnvironment, by: 'user' } });
    try {
      const resp = await runComponentTest(projectId, component.id, testCode, testEnvironment);
      const tr = resp?.data?.result || resp?.result;
      setTestResult(tr);
      // Save test code and result to component (strip trace to stay under memory size limit)
      const trForStorage = tr ? { ...tr } : tr;
      if (trForStorage?.trace) delete trForStorage.trace;
      await saveComponent(projectId, {
        ...component, testCode, testPrompt: currentTestPrompt, testEnvironment, testResult: trForStorage,
        history: [...(component.history || []), { action: 'test_' + (tr?.status || 'unknown'), at: new Date().toISOString(), by: 'user', errors: tr?.errors }],
      });
      if (tr?.status === 'passed') {
        showToast?.(t('profile.generator.test_passed'));
        await writeProjectLog(projectId, 'component_test_passed', { meta: { component: component.label, by: 'user' } });
      } else {
        showToast?.(t('profile.generator.test_failed'), true);
        await writeProjectLog(projectId, 'component_test_failed', { meta: { component: component.label, errors: tr?.errors, by: 'user' } });
      }
      onUpdate();
    } catch (e) {
      showToast?.(`Test error: ${e.message}`, true);
      await writeProjectLog(projectId, 'component_test_error', { meta: { component: component.label, error: e.message, by: 'user' } });
    }
    setTestRunning(false);
  }

  async function handleRunTestWithAi() {
    if (!isTestable || !orSettings?.hasApiKey) return;
    setTestRunning(true);
    setTestResult(null);
    // Ensure settings are applied and extension/cortex is activated before testing
    if (component.type === 'extension') {
      try { await apiPost(`/v1/generator/${projectId}/apply-settings/${encodeURIComponent(component.registeredAs)}`); } catch { /* */ }
    }
    if (component.type === 'extension' || component.type === 'cortex') {
      try {
        const actUrl = component.type === 'extension'
          ? `/v1/extensions/${encodeURIComponent(component.registeredAs)}/activate`
          : `/v1/cortex/${encodeURIComponent(component.registeredAs)}/activate`;
        await apiPost(actUrl);
      } catch { /* already active */ }
    }
    await writeProjectLog(projectId, 'test_prompt_generating', { meta: { component: component.label, type: component.type, by: 'user-ai' } });
    try {
      let aiCode = await runWithAi(projectId, currentTestPrompt);
      aiCode = stripCodeblock(aiCode);
      setTestCode(aiCode);
      await saveComponent(projectId, { ...component, testCode: aiCode, testPrompt: currentTestPrompt, testEnvironment });
      await writeProjectLog(projectId, 'test_code_generated', { meta: { component: component.label, environment: testEnvironment, codeLength: aiCode.length, by: 'user-ai' } });

      // Execute immediately
      await writeProjectLog(projectId, 'test_executing', { meta: { component: component.label, environment: testEnvironment, by: 'user-ai' } });
      const resp = await runComponentTest(projectId, component.id, aiCode, testEnvironment);
      const tr = resp?.data?.result || resp?.result;
      setTestResult(tr);
      const trForStorage2 = tr ? { ...tr } : tr;
      if (trForStorage2?.trace) delete trForStorage2.trace;
      await saveComponent(projectId, {
        ...component, testCode: aiCode, testPrompt: currentTestPrompt, testEnvironment, testResult: trForStorage2,
        history: [...(component.history || []), { action: 'test_' + (tr?.status || 'unknown'), at: new Date().toISOString(), by: 'user-ai', errors: tr?.errors }],
      });
      if (tr?.status === 'passed') {
        showToast?.(t('profile.generator.test_passed'));
        await writeProjectLog(projectId, 'component_test_passed', { meta: { component: component.label, by: 'user-ai' } });
      } else {
        showToast?.(t('profile.generator.test_failed'), true);
        await writeProjectLog(projectId, 'component_test_failed', { meta: { component: component.label, errors: tr?.errors, by: 'user-ai' } });
      }
      onUpdate();
    } catch (e) {
      showToast?.(`Test error: ${e.message}`, true);
      await writeProjectLog(projectId, 'component_test_error', { meta: { component: component.label, error: e.message, by: 'user-ai' } });
    }
    setTestRunning(false);
  }

  return html`
    <div class="pf-gen-component-detail">
      <div class="pf-gen-comp-header">
        <div class="card-h3">${component.label}</div>
        <span class="pf-gen-type-badge type-${component.type}">${component.type.toUpperCase()}</span>
        <span class="pf-gen-status-badge status-${component.status}">${component.status}</span>
        <button class="btn-ghost btn-xs" style="margin-left:auto" onClick=${handleResetComponent}
          title="Reset this component — clears spec, code, test, registration">↺ Reset</button>
      </div>

      <!-- SPEC (extension and cortex only) -->
      ${hasSpec && html`<${SpecSection}
        component=${component} project=${project} projectId=${projectId}
        showToast=${showToast} onUpdate=${onUpdate} orSettings=${orSettings}
        specPrompt=${specPrompt} specResult=${specResult} setSpecResult=${setSpecResult}
        specAiRunning=${specAiRunning} setSpecAiRunning=${setSpecAiRunning}
        specValidation=${specValidation} setSpecValidation=${setSpecValidation}
        setGeneratedPrompt=${setGeneratedPrompt} />`}

      <!-- CODE PROMPT (AI Chat Mode) -->
      <div class="pf-gen-section">
        <label>${t('profile.generator.prompt')}</label>
        <pre class="pf-gen-prompt-box">${prompt}</pre>
        <div class="flex-row-wrap">
          ${workflowStep === 'copy' && html`<${StepArrow} />`}
          <button class="btn-outline btn-sm" onClick=${handleCopyPrompt}
            title=${t('profile.generator.copyPromptHint')}>
            ${t('profile.generator.copyPrompt')}
          </button>
          ${orSettings?.hasApiKey && html`
            <button class="btn-outline btn-sm pf-gen-or-run-btn ${aiRunning ? 'pf-gen-or-running' : ''}"
              onClick=${handleRunComponentAi}
              disabled=${aiRunning || component.registeredAs}>
              ${aiRunning
                ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.openrouter.waiting')}`
                : t('profile.generator.openrouter.runWithAi')}
            </button>
          `}
          <button class="btn-ghost btn-sm" onClick=${handleRegeneratePrompt} title=${t('profile.generator.regeneratePromptHint')}>
            ${'↻ ' + (t('profile.generator.regeneratePrompt'))}
          </button>
        </div>
      </div>
      <div class="pf-gen-section">
        <div class="flex-row">
          <label>${t('profile.generator.result')}</label>
          ${workflowStep === 'paste' && html`<${StepArrow} direction="down" />`}
        </div>
        ${component.type === 'extension' && html`
          <p class="pf-gen-hint">${t('profile.generator.extensionPasteHint')}</p>
        `}
        <textarea
          ref=${el => { resultRef.current = el; }}
          class="pf-gen-result-area"
          rows="12"
          placeholder=${component.type === 'extension'
            ? t('profile.generator.extensionResultPlaceholder')
            : t('profile.generator.resultPlaceholder')}
          value=${result}
          onInput=${e => setResult(e.target.value)}
        />
        <div class="pf-gen-actions">
          ${explainPrompt && html`
            <${CopyButton} text=${explainPrompt} label="Explain" className="btn-ghost btn-sm"
              title="Copy explain prompt — ask AI to describe what it built before validating" />
          `}
          ${workflowStep === 'validate' && html`<${StepArrow} />`}
          <button class="btn-primary btn-sm" onClick=${handleValidate} disabled=${!result.trim()}
            title=${t('profile.generator.validateHint')}>
            ${t('profile.generator.validate')}
          </button>
          ${validationResult?.valid && html`
            ${workflowStep === 'register' && html`<${StepArrow} />`}
            <button class="btn-success btn-sm" onClick=${handleRegister} disabled=${registering}
              title=${t('profile.generator.registerHint')}>
              ${registering ? '...' : t('profile.generator.register')}
            </button>
          `}
          ${component.registeredAs && result.trim() && html`
            <button class="btn-outline btn-sm" onClick=${handleReregister} disabled=${registering}
              title=${t('profile.generator.reregisterHint')}>
              ${registering ? '...' : (t('profile.generator.reregister'))}
            </button>
          `}
        </div>
      </div>

      <!-- Errors -->
      ${validationResult && !validationResult.valid && html`
        <div class="pf-gen-errors">
          <label>${t('profile.generator.errors')}</label>
          <ul>
            ${validationResult.errors.map(e => html`<li>${e}</li>`)}
          </ul>
          ${reflectionPrompt && html`
            <div class="flex-row" style="margin-bottom: 0.5rem">
              <${CopyButton} text=${reflectionPrompt} label="1. Copy Reflection (diagnose first)" className="btn-outline btn-sm" />
            </div>
          `}
          ${fixPrompt && html`
            <div class="flex-row">
              ${workflowStep === 'fix' && html`<${StepArrow} />`}
              <${CopyButton} text=${fixPrompt} label=${'2. ' + t('profile.generator.copyFixPrompt')} className="btn-primary btn-sm" />
            </div>
          `}
        </div>
      `}

      <!-- Test Section (for registered testable components) -->
      <!-- Same structure as component generation: PROMPT → RESULT (test code) → RUN -->
      ${isTestable && html`
        <div class="pf-gen-section pf-gen-test-section">
          <label>${t('profile.generator.test_prompt')} (${testEnvironment})</label>
          <pre class="pf-gen-prompt-box">${currentTestPrompt}</pre>
          <div class="flex-row-wrap">
            <button class="btn-outline btn-sm" onClick=${handleCopyTestPrompt}>
              ${t('profile.generator.test_copy_prompt')}
            </button>
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline btn-sm pf-gen-or-run-btn ${testRunning ? 'pf-gen-or-running' : ''}"
                onClick=${handleRunTestWithAi}
                disabled=${testRunning}>
                ${testRunning
                  ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.test_running')}`
                  : t('profile.generator.test_run_with_ai')}
              </button>
            `}
          </div>
        </div>
        <div class="pf-gen-section">
          <label>${t('profile.generator.test_code')}</label>
          <textarea
            class="pf-gen-result-area"
            rows="8"
            placeholder=${t('profile.generator.test_code_placeholder')}
            value=${testCode}
            onInput=${e => setTestCode(e.target.value)}
          />
          <div class="pf-gen-actions">
            <button class="btn-primary btn-sm" onClick=${handleRunComponentTest}
              disabled=${!testCode.trim() || testRunning}>
              ${testRunning
                ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.test_running')}`
                : t('profile.generator.test_run')}
            </button>
          </div>
        </div>

        <!-- Test Result -->
        ${testResult && html`
          <div class="pf-gen-section">
            <div class="pf-gen-test-result-detail pf-gen-test-${testResult.status}">
              <strong>${t('profile.generator.test_result_title')}: ${t('profile.generator.test_component_' + testResult.status)}</strong>
              ${testResult.errors && testResult.errors.length > 0 && html`
                <ul class="pf-gen-test-errors">
                  ${testResult.errors.map(e => html`<li>${e}</li>`)}
                </ul>
              `}
              ${testResult.trace && testResult.trace.length > 0 && html`
                <details class="pf-gen-test-trace">
                  <summary>${t('profile.generator.test_trace_title') || 'Trace'} (${testResult.trace.length})</summary>
                  <pre class="pf-gen-trace-pre">${testResult.trace.map(t =>
                    `[${t.status}] ${t.fn}(${t.args})\n  → ${t.result}`
                  ).join('\n\n')}</pre>
                </details>
              `}
              ${testResult.screenshots && testResult.screenshots.length > 0 && html`
                <div class="pf-gen-test-screenshots">
                  <div class="pf-gen-screenshot-grid">
                    ${testResult.screenshots.map(s => html`
                      <img src=${screenshotUrl(projectId, s)} class="pf-gen-screenshot" alt=${s}
                        onClick=${() => window.open(screenshotUrl(projectId, s), '_blank')} />
                    `)}
                  </div>
                </div>
              `}
            </div>
          </div>
        `}
      `}
      <${ConfirmUI} />
    </div>
  `;
}

