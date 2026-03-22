/**
 * @file generator-detail.js
 * @description Per-component detail editor and test UI for the service generator.
 *   Handles the generate → validate → register workflow for individual components,
 *   plus test prompt generation, test execution, and result display.
 *   Also exports shared AI utility functions (runWithAi, stripCodeblock, cancelAiRequest).
 * @structure
 *   - runWithAi, stripCodeblock, cancelAiRequest: AI call utilities (shared)
 *   - getWorkflowStep: determines component's current workflow state
 *   - StepArrow: SVG arrow indicator for guided workflow
 *   - ComponentDetail: main per-component editor panel
 *   - TestScopeSelector: radio group for test scope level
 *   - TestResultsView: renders full test report with screenshots
 * @usage
 *   import { ComponentDetail, TestScopeSelector, TestResultsView } from './generator-detail.js';
 *   import { runWithAi, stripCodeblock, cancelAiRequest } from './generator-detail.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js (was inline in v6.1.0)
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPost } from '/js/api.js';
import {
  saveComponent, registerComponent, reregisterComponent, writeProjectLog,
} from '/js/services/generator.js';
import { buildComponentPrompt, buildFixPrompt, buildTestPrompt } from '/js/services/generator-prompts.js';
import { validateComponent } from '/js/services/generator-validate.js';
import { runComponentTest, screenshotUrl } from '/js/services/generator-testing.js';

/* ── OpenRouter Autopilot Helpers (shared) ───────────── */

// Active AbortController for current AI request — allows instant cancel
let _activeAiController = null;

/** Strip markdown codeblock wrapper if AI wrapped the response in ``` */
export function stripCodeblock(text) {
  if (!text) return text;
  const trimmed = text.trim();
  // Match ```<optional lang>\n...\n``` or ```<optional lang>\n...```
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)```\s*$/);
  return match ? match[1].trim() : trimmed;
}

export async function runWithAi(projectId, prompt, systemPrompt = null) {
  const body = { projectId, prompt };
  if (systemPrompt) body.systemPrompt = systemPrompt;
  // Use direct fetch with 10-minute timeout (apiPost has 30s limit)
  const controller = new AbortController();
  _activeAiController = controller;
  const timeoutId = setTimeout(() => controller.abort(), 1_800_000); // 30 min
  const headers = { 'Content-Type': 'application/json' };
  const session = window.AIMEAT?.auth?.getSession?.();
  if (session?.jwt) headers['Authorization'] = 'Bearer ' + session.jwt;
  try {
    const raw = await fetch('/v1/openrouter/complete', {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    });
    if (!raw.ok) {
      // Try to parse error body, fall back to status text
      let msg = `HTTP ${raw.status}`;
      try { const e = await raw.json(); msg = e.error?.message || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const resp = await raw.json();
    if (resp.ok === false) throw new Error(resp.error?.message || 'OpenRouter error');
    return resp.data.content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Cancelled');
    if (e.name === 'TypeError') throw new Error('Network error — connection lost');
    throw e;
  } finally {
    clearTimeout(timeoutId);
    _activeAiController = null;
  }
}

/** Abort the active AI request immediately */
export function cancelAiRequest() {
  if (_activeAiController) _activeAiController.abort();
}

/* ── Workflow Helpers ─────────────────────────────────── */

export function getWorkflowStep(component, validationResult, result) {
  if (component.registeredAs) return 'done';
  if (validationResult?.valid === true) return 'register';
  if (validationResult?.valid === false) return 'fix';
  if ((result || '').trim()) return 'validate';
  if (component.status === 'waiting_user' || component.status === 'prompt_ready') return 'paste';
  return 'copy';
}

/** Small circle-with-arrow SVG placed inline next to the current action target.
 * @param {Object} props
 * @param {'right'|'down'} [props.direction='right'] — arrow direction
 */
function StepArrow({ direction = 'right' } = {}) {
  const chevron = direction === 'down'
    ? 'M8 10l4 4 4-4'   // ↓ pointing down
    : 'M10 8l4 4-4 4';  // → pointing right
  const cls = `pf-gen-step-arrow${direction === 'down' ? ' pf-gen-step-arrow--down' : ''}`;
  return html`<svg class=${cls} viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="10" fill="var(--accent,#E8564A)" opacity="0.15"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent,#E8564A)" stroke-width="1.5"/>
    <path d=${chevron} fill="none" stroke="var(--accent,#E8564A)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ── ComponentDetail ─────────────────────────────────── */

export function ComponentDetail({ component, project, components, projectId, interviewSpec, liveStatuses, onUpdate, onAdvance, showToast, session, orSettings }) {
  const [result, setResult] = useState(component.result || '');
  const [validationResult, setValidationResult] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const resultRef = { current: null };

  // Test state
  const [testCode, setTestCode] = useState(component.testCode || '');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(component.testResult || null);

  useEffect(() => {
    setResult(component.result || '');
    setTestCode(component.testCode || '');
    setTestResult(component.testResult || null);
    setValidationResult(null);
    // Auto-transition to prompt_ready when opening an unstarted component
    if (component.status === 'not_started') {
      const prompt = buildComponentPrompt(
        component.type, component.label,
        project.description, project.blueprint,
        components.filter(c => c.status === 'done'),
        interviewSpec,
      );
      saveComponent(projectId, {
        ...component, status: 'prompt_ready', prompt,
        history: [...(component.history || []), { action: 'prompt_generated', at: new Date().toISOString(), by: 'system' }],
      }).then(() => onUpdate());
    }
  }, [component.id, component.result, component.status]);

  const completedComponents = components.filter(c => c.status === 'done' && c.registeredAs);
  const prompt = component.prompt || buildComponentPrompt(
    component.type, component.label,
    project.description, project.blueprint, completedComponents,
    interviewSpec,
  );

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
      // Derive service slug from extension name or CSM for service-prefixed keys
      const extComp = components.find(c => c.type === 'extension' && c.registeredAs);
      const csmComp = components.find(c => c.type === 'csm' && c.registeredAs);
      const serviceSlug = extComp?.registeredAs
        || csmComp?.registeredAs?.split('/')?.pop()
        || '';

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
        || (d.locales ? `i18n-${d.locales.join('-')}` : null) // Translation fallback
        || (d.keys?.length ? `memory:${d.keys[d.keys.length - 1]}` : null)   // Memory: use last key name (e.g. "memory:municipalities.data")
        || null;
      if (!regName) {
        // Registration succeeded but we couldn't extract the name — warn user
        showToast?.(t('profile.generator.registrationNameMissing'), true);
        setRegistering(false);
        return;
      }
      const registered = addHistory(component, 'registered', { registeredAs: regName });
      await saveComponent(projectId, { ...registered, status: 'done', registeredAs: regName });
      showToast?.(t('profile.generator.componentRegistered').replace('{name}', regName));
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
      const extComp = components.find(c => c.type === 'extension' && c.registeredAs);
      const csmComp = components.find(c => c.type === 'csm' && c.registeredAs);
      const serviceSlug = extComp?.registeredAs || csmComp?.registeredAs?.split('/')?.pop() || '';

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
        || (d.locales ? `i18n-${d.locales.join('-')}` : null)
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
    const fresh = buildComponentPrompt(
      component.type, component.label,
      project.description, project.blueprint,
      components.filter(c => c.status === 'done'),
      interviewSpec,
    );
    const updated = addHistory(component, 'prompt_regenerated');
    await saveComponent(projectId, { ...updated, status: 'prompt_ready', prompt: fresh });
    showToast?.(t('profile.generator.promptRegenerated'));
    onUpdate();
  }

  async function handleCopyPrompt() {
    const fresh = buildComponentPrompt(
      component.type, component.label,
      project.description, project.blueprint,
      components.filter(c => c.status === 'done'),
      interviewSpec,
    );
    try {
      await navigator.clipboard.writeText(fresh);
      const updated = addHistory(component, 'prompt_copied');
      await saveComponent(projectId, { ...updated, status: 'waiting_user', prompt: fresh });
      showToast?.(t('profile.generator.promptCopied'));
      onUpdate();
    } catch { /* clipboard fallback */ }
  }

  async function handleRunComponentAi() {
    setAiRunning(true);
    try {
      const completedComps = components.filter(c => c.status === 'done' && c.registeredAs);
      const fresh = buildComponentPrompt(
        component.type, component.label,
        project.description, project.blueprint, completedComps,
        interviewSpec,
      );
      let content = await runWithAi(projectId, fresh);
      // Strip codeblock wrappers for extensions (AI models often wrap in ```)
      if (component.type === 'extension') content = stripCodeblock(content);
      setResult(content);

      // Validate
      let vr = validateComponent(component.type, content, project.blueprint);

      // Auto-retry if enabled
      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          showToast?.(t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
          const fp = buildFixPrompt(fresh, content, vr.errors, component.type);
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
      showToast?.(e.message, true);
    }
    setAiRunning(false);
  }

  const fixPrompt = validationResult && !validationResult.valid
    ? buildFixPrompt(prompt, result, validationResult.errors, component.type)
    : null;

  // Test prompt for testable component types
  const testableTypes = ['extension', 'cortex', 'app'];
  const isTestable = testableTypes.includes(component.type) && component.registeredAs;
  const testEnvironment = (component.type === 'cortex' || component.type === 'app') ? 'browser' : 'server';
  const currentTestPrompt = isTestable
    ? buildTestPrompt(component.type, component.result || result, component.label, component.registeredAs, project.blueprint, interviewSpec)
    : null;

  async function handleCopyTestPrompt() {
    if (!currentTestPrompt) return;
    try {
      await navigator.clipboard.writeText(currentTestPrompt);
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
      // Save test code and result to component
      await saveComponent(projectId, {
        ...component, testCode, testPrompt: currentTestPrompt, testEnvironment, testResult: tr,
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
      await saveComponent(projectId, {
        ...component, testCode: aiCode, testPrompt: currentTestPrompt, testEnvironment, testResult: tr,
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
        <h4>${component.label}</h4>
        <span class="pf-gen-type-badge type-${component.type}">${component.type.toUpperCase()}</span>
        <span class="pf-gen-status-badge status-${component.status}">${component.status}</span>
      </div>

      <!-- AI Chat Mode -->
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
          ${fixPrompt && html`
            <div class="flex-row">
              ${workflowStep === 'fix' && html`<${StepArrow} />`}
              <button class="btn-primary btn-sm" onClick=${() => navigator.clipboard.writeText(fixPrompt)}>
                ${t('profile.generator.copyFixPrompt')}
              </button>
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
    </div>
  `;
}

/* ── Test Scope & Results ────────────────────────────── */

export function TestScopeSelector({ value, onChange, compact }) {
  return html`<div class="pf-gen-test-scope ${compact ? 'pf-gen-test-scope-compact' : ''}">
    ${!compact && html`<h4>${t('profile.generator.test_scope_title')}</h4>`}
    ${['comprehensive', 'basic', 'none'].map(level => html`
      <label class="pf-gen-or-radio-label" title=${t('profile.generator.test_scope_' + level)}>
        <input type="radio" name="test-scope-${compact ? 'compact' : 'full'}" value=${level}
          checked=${value === level}
          onChange=${() => onChange(level)} />
        ${compact
          ? (level === 'comprehensive' ? '✓ ' + t('profile.generator.test_scope_comprehensive_short')
            : level === 'basic' ? '○ ' + t('profile.generator.test_scope_basic_short')
            : '— ' + t('profile.generator.test_scope_none_short'))
          : t('profile.generator.test_scope_' + level)}
      </label>
    `)}
  </div>`;
}

export function TestResultsView({ report, projectId, onFixRequest }) {
  if (!report) return null;

  const overallKey = report.overall === 'passed' ? 'test_passed'
    : report.overall === 'partial' ? 'test_partial'
    : 'test_failed';

  return html`<div class="pf-gen-test-results">
    <div class="pf-gen-test-overall pf-gen-test-${report.overall}">
      ${t('profile.generator.' + overallKey)}
    </div>
    ${(report.components || []).map(c => html`
      <div class="pf-gen-test-component pf-gen-test-${c.status}">
        <strong>${c.componentId}</strong>
        <span class="pf-gen-test-badge">${t('profile.generator.test_component_' + c.status)}</span>
        <span>${c.passed}/${c.scenarios}</span>
        ${c.errors && c.errors.length > 0 && html`<ul class="pf-gen-test-errors">
          ${c.errors.map(e => html`<li>${e}</li>`)}
        </ul>`}
        ${c.screenshots && c.screenshots.length > 0 && html`<div class="pf-gen-test-screenshots">
          <strong>${t('profile.generator.test_screenshots')}</strong>
          <div class="pf-gen-screenshot-grid">
            ${c.screenshots.map(s => html`
              <img src=${screenshotUrl(projectId, s)} class="pf-gen-screenshot" alt=${s}
                onClick=${() => window.open(screenshotUrl(projectId, s), '_blank')} />
            `)}
          </div>
        </div>`}
        ${c.status === 'failed' && onFixRequest && html`<div class="pf-gen-test-fix-actions">
          <button class="btn-primary" onClick=${() => onFixRequest(c.componentId, 'auto')}>
            ${t('profile.generator.test_fix_auto')}
          </button>
          <button class="btn-outline" onClick=${() => onFixRequest(c.componentId, 'manual')}>
            ${t('profile.generator.test_fix_manual')}
          </button>
          <button class="btn-ghost" onClick=${() => onFixRequest(c.componentId, 'skip')}>
            ${t('profile.generator.test_fix_skip')}
          </button>
        </div>`}
      </div>
    `)}
  </div>`;
}
