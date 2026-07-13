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
 *   v1.1.0 — 2026-03-24 — Fix useEffect deps (testCode/testResult sync), add trace display
 *   v1.2.0 — 2026-03-25 — Fix validationResult reset: Register button no longer disappears after validation passes
 *   v1.3.0 — 2026-03-26 — V5: context bundles on register, explain step before validation
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
// DEPRECATED: browser-side prompt builders no longer used. Prompts loaded from database via API.
// import { buildComponentPrompt, buildFixPrompt, buildReflectionPrompt, buildTestPrompt } from '/js/services/generator-prompts.js';
import { validateComponent } from '/js/services/generator-validate.js';
import { validateExtensionSpec, validateDataApiSpec, validateComponentSpec, validateAppDomainSpec, validateAppSpec } from '/js/services/generator-spec-validate.js';
import { verifyContract } from '/js/services/generator-contract.js';
import { smokeTest } from '/js/services/generator-smoke.js';
import { createBundle } from '/js/services/generator-context-bundle.js';
import { buildExplainPrompt, buildReflectionPrompt, buildFixPrompt } from '/js/services/generator-prompts-fix.js';
import { runComponentTest, screenshotUrl } from '/js/services/generator-testing.js';

/* ── OpenRouter Autopilot Helpers (shared) ───────────── */

// Active AbortController for current AI request — allows instant cancel
let _activeAiController = null;

/** Strip markdown codeblock wrapper if AI wrapped the response in ``` */
export function stripCodeblock(text) {
  if (!text) return text;
  const trimmed = text.trim();
  // Count how many ``` fences exist
  const fenceCount = (trimmed.match(/^```/gm) || []).length;
  if (fenceCount === 2) {
    // Single code block wrapper: ```lang\n...\n``` — strip the outer fences
    const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)```\s*$/);
    if (match) return match[1].trim();
  }
  if (fenceCount > 2) {
    // Multiple code blocks inside (e.g., cortex: ```yaml + ```javascript, or extension: ```yaml + ```js per action)
    // Check if the ENTIRE response is wrapped in an OUTER fence (AI sometimes does this)
    const outerMatch = trimmed.match(/^```\s*\n([\s\S]*)\n```\s*$/);
    if (outerMatch) return outerMatch[1].trim();

    // Extension multi-block pattern: ```yaml\n...\n``` followed by one or more ```javascript\n...\n```
    // Combine into single text: YAML content + JS content separated by // actions/... markers
    const blocks = [];
    const blockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = blockRegex.exec(trimmed)) !== null) {
      blocks.push({ lang: match[1], content: match[2].trim() });
    }
    if (blocks.length >= 2) {
      const yamlBlock = blocks.find(b => b.lang === 'yaml' || b.lang === 'yml');
      const jsBlocks = blocks.filter(b => b.lang === 'javascript' || b.lang === 'js' || b.lang === '');
      if (yamlBlock && jsBlocks.length > 0) {
        // Check if JS blocks already have // actions/ markers — if so, combine cleanly
        const hasActionMarkers = jsBlocks.some(b => /^\/\/\s*actions\//m.test(b.content));
        if (hasActionMarkers) {
          // Extension format: YAML manifest + action files with // actions/ markers
          return yamlBlock.content + '\n' + jsBlocks.map(b => b.content).join('\n');
        }
      }
      // Generic multi-block: combine all blocks
      return blocks.map(b => b.content).join('\n\n');
    }

    // Fallback: return with fences — the validator can handle them
    return trimmed;
  }
  // No fences or unparseable — return as-is
  return trimmed;
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
    if (e.name === 'AbortError') throw new Error('Cancelled', { cause: e });
    if (e.name === 'TypeError') throw new Error('Network error — connection lost', { cause: e });
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

/* ── Prompt Loading (from database via API — single source of truth) ── */

/**
 * Load a component prompt from the database via the backend API.
 * Replaces the old browser-side buildComponentPrompt() which used local JS templates.
 * @param {string} projectId
 * @param {string} componentId
 * @param {'code'|'spec'|'test'} type - prompt type
 * @returns {Promise<string>} the prompt text
 */
async function loadPromptFromBackend(projectId, componentId, type = 'code') {
  const s = window.AIMEAT?.auth?.getSession?.();
  if (!s) throw new Error('Not authenticated');
  const resp = await s.fetch(`/v1/generator/${projectId}/prompts/${componentId}?type=${type}`);
  if (!resp.ok) throw new Error(resp.error?.message || 'Failed to load prompt');
  return resp.data?.prompt || '';
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
 * @param {'right'|'down'} [props.direction='right'] - arrow direction
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

export function ComponentDetail({ component, project, projectId, liveStatuses, onUpdate, onAdvance, showToast, session, orSettings }) {
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

  async function handleResetComponent() {
    if (!confirm('Reset this component? Spec, code, test results, and registration will all be cleared.')) return;
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
      console.error('[generator] AI run failed:', e);
      showToast?.(e.message, true);
    }
    setAiRunning(false);
  }

  // Mandatory reflection before fix — diagnose first, then fix
  const reflectionPrompt = validationResult && !validationResult.valid
    ? buildReflectionPrompt(result, validationResult.errors)
    : null;
  const fixPrompt = validationResult && !validationResult.valid
    ? buildFixPrompt(prompt, result, validationResult.errors, component.type)
    : null;

  // Explain prompt — optional step after generation, before validation
  const bpComp = project.blueprint?.components?.find(c => c.label === component.label || c.id === component.id);
  const explainPrompt = result.trim() && !validationResult
    ? buildExplainPrompt(component.type, result, bpComp)
    : null;

  // Spec fix prompt — derived from current spec validation errors + spec result (shared by Copy and Fix-with-AI buttons)
  const specFixPrompt = specValidation && !specValidation.valid
    ? 'Fix the following spec JSON. It has validation errors.\n\n'
      + '## Errors\n' + specValidation.errors.map((e, i) => (i + 1) + '. ' + e).join('\n')
      + '\n\n## Current Spec\n```json\n' + specResult + '\n```\n\n'
      + '## Rules\n- Fix ONLY the listed errors\n- Do NOT remove existing actions\n- Return the COMPLETE fixed JSON'
    : null;

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
        <h4>${component.label}</h4>
        <span class="pf-gen-type-badge type-${component.type}">${component.type.toUpperCase()}</span>
        <span class="pf-gen-status-badge status-${component.status}">${component.status}</span>
        <button class="btn-ghost btn-xs" style="margin-left:auto" onClick=${handleResetComponent}
          title="Reset this component — clears spec, code, test, registration">↺ Reset</button>
      </div>

      <!-- SPEC (extension and cortex only) -->
      ${hasSpec && html`
        <div class="pf-gen-section">
          <label>SPEC PROMPT</label>
          <pre class="pf-gen-prompt-box" style="max-height:200px;overflow:auto;font-size:11px">${specPrompt || 'Loading spec prompt...'}</pre>
          <div class="flex-row-wrap">
            <${CopyButton} text=${specPrompt} label="Copy Spec Prompt" className="btn-outline btn-sm"
              onCopied=${() => showToast?.('Spec prompt copied')} />
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline btn-sm pf-gen-or-run-btn ${specAiRunning ? 'pf-gen-or-running' : ''}"
                onClick=${async () => {
                  if (!specPrompt) return;
                  setSpecAiRunning(true);
                  try {
                    const aiResult = await runWithAi(projectId, specPrompt);
                    setSpecResult(aiResult);
                    showToast?.('Spec generated');
                  } catch (e) {
                    showToast?.('Spec generation failed: ' + e.message, true);
                  }
                  setSpecAiRunning(false);
                }}
                disabled=${specAiRunning || !specPrompt}>
                ${specAiRunning ? html`<span class="pf-gen-or-spinner"></span> Generating...` : 'Run with AI'}
              </button>
            `}
          </div>
        </div>
        <div class="pf-gen-section">
          <label>SPEC RESULT</label>
          <textarea
            class="pf-gen-result-area"
            rows="8"
            placeholder="Paste the spec JSON here (from AI response)"
            value=${specResult}
            onInput=${e => { setSpecResult(e.target.value); setSpecValidation(null); }}
          />
          <div class="pf-gen-actions">
            <button class="btn-primary btn-sm" onClick=${() => {
              try {
                const parsed = JSON.parse(specResult);
                // Validate spec structure
                let sv;
                if (component.type === 'extension') sv = validateExtensionSpec(parsed);
                else if (component.type === 'app') sv = validateAppSpec(parsed);
                else if (component.subtype === 'data') sv = validateDataApiSpec(parsed);
                else if (component.subtype === 'component') sv = validateComponentSpec(parsed);
                else if (component.subtype === 'app-domain') sv = validateAppDomainSpec(parsed);
                // FAIL LOUD: a cortex must declare its subtype. A silent fallback to a default
                // validator (previously validateDataApiSpec) masked the real bug — a missing subtype —
                // as a confusing "Missing wrapsExtension" error on a component cortex. Name the real cause.
                else if (component.type === 'cortex') sv = { valid: false, errors: ['Cortex component "' + component.id + '" has no subtype (expected data | component | app-domain) — this is an upstream blueprint/init bug; fix the subtype, do not guess a validator'] };
                else sv = { valid: false, errors: ['Cannot select a spec validator for component "' + component.id + '" (type=' + component.type + ', subtype=' + component.subtype + ')'] };
                // Also check blueprint action IDs
                const bp = project?.blueprint;
                if (bp && component.type === 'extension') {
                  const specActionIds = new Set((parsed.actions || []).map(a => a.id));
                  const bpActions = Object.keys(bp.dataModel?.actions || {})
                    .filter(k => k.startsWith('ext:'))
                    .map(k => k.replace('ext:', '').replace(/^[^/]+\//, ''));
                  for (const expected of bpActions) {
                    if (!specActionIds.has(expected)) {
                      sv.valid = false;
                      sv.errors.push('Blueprint declares action "' + expected + '" but it is missing from the spec');
                    }
                  }
                }
                setSpecValidation(sv);
                if (sv.valid) showToast?.('Spec validation passed');
                else showToast?.('Spec validation failed: ' + sv.errors[0], true);
              } catch (e) {
                setSpecValidation({ valid: false, errors: ['Invalid JSON: ' + e.message] });
                showToast?.('Invalid JSON: ' + e.message, true);
              }
            }} disabled=${!specResult.trim()}>
              Validate Spec
            </button>
            ${specValidation?.valid && html`
              <button class="btn-success btn-sm" onClick=${async () => {
                try {
                  const parsed = JSON.parse(specResult);
                  await saveSpec(projectId, component.id, parsed);
                  // Rebuild code prompt now that the spec is saved
                  const freshPrompt = await loadPromptFromBackend(projectId, component.id, 'code');
                  setGeneratedPrompt(freshPrompt);
                  if (component.prompt) {
                    await saveComponent(projectId, { ...component, prompt: freshPrompt, spec: parsed });
                  }
                  showToast?.('Spec saved');
                  onUpdate();
                } catch (e) {
                  showToast?.('Save failed: ' + e.message, true);
                }
              }}>
                Save Spec
              </button>
            `}
            ${component.spec && specResult && html`
              <span class="text-caption" style="color:var(--success,#22c55e)">✓ Spec saved</span>
            `}
          </div>
          ${specValidation && !specValidation.valid && html`
            <div class="pf-gen-validation-errors">
              <strong>Spec Validation Errors</strong>
              <ul>${specValidation.errors.map(e => html`<li>${e}</li>`)}</ul>
              <div class="flex-row-wrap" style="margin-top:8px">
                <${CopyButton} text=${specFixPrompt} label="Copy Fix Prompt" className="btn-outline btn-sm"
                  onCopied=${() => showToast?.('Fix prompt copied')} />
                ${orSettings?.hasApiKey && html`
                  <button class="btn-outline btn-sm pf-gen-or-run-btn ${specAiRunning ? 'pf-gen-or-running' : ''}"
                    onClick=${async () => {
                      const fixPrompt = specFixPrompt;
                      setSpecAiRunning(true);
                      try {
                        const fixed = await runWithAi(projectId, fixPrompt);
                        // Strip code fences if present
                        const cleaned = fixed.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
                        setSpecResult(cleaned);
                        setSpecValidation(null);
                        showToast?.('Fixed spec received — click Validate Spec');
                      } catch (e) {
                        showToast?.('Fix failed: ' + e.message, true);
                      }
                      setSpecAiRunning(false);
                    }}
                    disabled=${specAiRunning}>
                    ${specAiRunning ? html`<span class="pf-gen-or-spinner"></span> Fixing...` : 'Fix with AI'}
                  </button>
                `}
              </div>
            </div>
          `}
          ${specValidation?.valid && html`
            <div class="pf-gen-validation-passed">
              <strong>✓ Spec Valid</strong>
            </div>
          `}
        </div>
      `}

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
        <strong>${c.label || c.componentId}</strong>
        <span class="pf-gen-test-badge">${t('profile.generator.test_component_' + c.status)}</span>
        ${c.fixRound > 0 && html`<span class="pf-gen-test-badge">${t('profile.generator.test_fix_round')} ${c.fixRound}</span>`}
        ${c.errors && c.errors.length > 0
          ? html`<span>${c.errors.length} ${t('profile.generator.test_errors_count')}</span>`
          : html`<span>${c.passed}/${c.scenarios}</span>`}
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
