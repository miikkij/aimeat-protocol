/**
 * @file foundry-detail.js
 * @description Per-component detail editor and test UI for the service foundry.
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
 *   import { ComponentDetail, TestScopeSelector, TestResultsView } from './foundry-detail.js';
 *   import { runWithAi, stripCodeblock, cancelAiRequest } from './foundry-detail.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js (was inline in v6.1.0)
 *   v1.1.0 — 2026-03-24 — Fix useEffect deps (testCode/testResult sync), add trace display
 *   v1.2.0 — 2026-03-25 — Fix validationResult reset: Register button no longer disappears after validation passes
 *   v1.3.0 — 2026-03-26 — V5: context bundles on register, explain step before validation
 *   v2.0.0 — 2026-03-26 — Multi-pass workflow: pass-specific prompts, skeleton/unit/assembly flow,
 *     reflection panel, pass submit handlers, ReflectionPanel component
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPost } from '/js/api.js';
import {
  saveComponent, registerComponent, reregisterComponent, writeProjectLog, writeDebugArtifact,
  getNextPass, MULTI_PASS_TYPES, saveSkeleton, saveUnit, saveTestCode,
  loadSkeleton, loadUnits, loadTestCode, createUnitPasses, appendReflection,
  loadReflectionHistory, isDuplicatePrescription, MAX_REFLECTIONS,
} from '/js/services/foundry.js';
import { buildComponentPrompt, buildFixPrompt, buildReflectionPrompt, buildTestPrompt } from '/js/services/foundry-prompts.js';
import { validateComponent, validateSkeleton, validateUnit } from '/js/services/foundry-validate.js';
import { verifyContract } from '/js/services/foundry-contract.js';
import { smokeTest } from '/js/services/foundry-smoke.js';
import { createBundle } from '/js/services/foundry-context-bundle.js';
import { buildExplainPrompt, buildFoundryReflectionPrompt } from '/js/services/foundry-prompts-fix.js';
import { runComponentTest, screenshotUrl } from '/js/services/foundry-testing.js';
import {
  buildSkeletonPrompt, buildExtensionUnitPrompt, buildCortexMethodUnitPrompt,
  buildFeatureCortexSectionPrompt, buildAppViewUnitPrompt,
  buildExtensionAssemblyPrompt, buildCortexAssemblyPrompt, buildAppAssemblyPrompt,
} from '/js/services/foundry-prompts-build.js';
import { buildTestFirstPrompt } from '/js/services/foundry-prompts-test.js';

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
    // Multiple code blocks inside (e.g., cortex: ```yaml + ```javascript)
    // Check if the ENTIRE response is wrapped in an OUTER fence (AI sometimes does this)
    // Pattern: ```\n```yaml\n...\n```\n```javascript\n...\n```\n```
    const outerMatch = trimmed.match(/^```\s*\n([\s\S]*)\n```\s*$/);
    if (outerMatch) return outerMatch[1].trim();
    // Otherwise: multiple blocks ARE the content — don't strip anything
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
  const cls = `fnd-step-arrow${direction === 'down' ? ' fnd-step-arrow--down' : ''}`;
  return html`<svg class=${cls} viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="10" fill="var(--accent,#E8564A)" opacity="0.15"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent,#E8564A)" stroke-width="1.5"/>
    <path d=${chevron} fill="none" stroke="var(--accent,#E8564A)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ── Multi-Pass Helpers ──────────────────────────────── */

/**
 * Generate the prompt for the current pass based on pass type and context.
 */
function generatePassPrompt(pass, ctx) {
  const { component, blueprint, interviewSpec, skeleton, units, testCode, reflectionHistory } = ctx;
  const bpComp = blueprint?.components?.find(c => c.label === component.label || c.id === component.id);
  if (!bpComp) {
    console.warn('[foundry] Blueprint component not found for', component.id, component.label, 'Available:', blueprint?.components?.map(c => c.id + ':' + c.label));
  }

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
 * Handle saving the response for a pass based on its type.
 */
async function handlePassSubmit(projectId, componentId, pass, response, ctx) {
  switch (pass.type) {
    case 'test':
      await saveTestCode(projectId, componentId, response);
      return { saved: true };
    case 'skeleton':
      await saveSkeleton(projectId, componentId, response);
      return { saved: true };
    case 'unit':
      await saveUnit(projectId, componentId, pass.unitId, response);
      return { saved: true };
    case 'assembly':
      // Assembly produces final component code — saved via saveComponent in caller
      return { saved: true, isFinal: true };
    case 'reflection': {
      const prescription = parseReflectionPrescription(response);
      if (prescription) {
        await appendReflection(projectId, componentId, {
          attempt: pass.attempt || 1,
          at: new Date().toISOString(),
          prescription,
        });
      }
      return { saved: true, prescription };
    }
    default:
      return { saved: false };
  }
}

/**
 * Extract one unit's definition from skeleton YAML by finding its block.
 */
function parseUnitFromSkeleton(skeletonYaml, unitId) {
  if (!skeletonYaml || !unitId) return { id: unitId, label: unitId };
  const lines = skeletonYaml.split('\n');
  let found = false;
  let block = [];
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
        break; // next item or section
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
  // Look for describe/test blocks mentioning the unit ID
  const regex = new RegExp(`(describe|test|it)\\s*\\(['"](.*?${unitId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?)['"]`, 'i');
  const match = testCode.match(regex);
  if (!match) return '';
  // Return a window around the match
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
    // Try to find YAML block with diagnosis/prescription
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

/* ── ReflectionPanel (Task 18) ──────────────────────── */

function ReflectionPanel({ prescription, reflectionHistory, onExecute }) {
  const isEscalated = prescription?.action === 'escalate_to_user';
  const isLoop = prescription && isDuplicatePrescription(reflectionHistory || [], prescription);
  const atMax = (reflectionHistory || []).length >= MAX_REFLECTIONS;

  return html`
    <div class="fnd-reflection-panel">
      <h4 class="fnd-reflection-title">${t('profile.foundry.reflectionHistory')}</h4>

      ${prescription && html`
        <div class="fnd-reflection-current">
          <div class="fnd-reflection-section">
            <strong>${t('profile.foundry.reflectionDiagnosis')}:</strong>
            <p>${prescription.diagnosis || '—'}</p>
            ${prescription.rootCause && html`<p>${prescription.rootCause}</p>`}
          </div>
          <div class="fnd-reflection-section">
            <strong>${t('profile.foundry.reflectionPrescription')}:</strong>
            <p>${prescription.action}${prescription.target ? ' -> ' + prescription.target : ''}</p>
          </div>
          ${isEscalated && html`
            <div class="fnd-reflection-escalated">${t('profile.foundry.escalatedToUser')}</div>
          `}
          ${isLoop && html`
            <div class="fnd-reflection-escalated">${t('profile.foundry.loopDetected')}</div>
          `}
          ${atMax && html`
            <div class="fnd-reflection-escalated">${t('profile.foundry.maxReflections')}</div>
          `}
          ${!isEscalated && !isLoop && !atMax && onExecute && html`
            <button class="btn-primary btn-sm" onClick=${() => onExecute(prescription)}>
              ${t('profile.foundry.reflectionPrescription')}
            </button>
          `}
        </div>
      `}

      ${reflectionHistory && reflectionHistory.length > 0 && html`
        <details class="fnd-reflection-history">
          <summary>${t('profile.foundry.reflectionHistory')} (${reflectionHistory.length})</summary>
          ${reflectionHistory.map((entry, i) => html`
            <div class="fnd-reflection-entry">
              <div class="fnd-reflection-attempt">#${i + 1} — ${entry.at ? new Date(entry.at).toLocaleString() : ''}</div>
              ${entry.prescription && html`
                <p>${entry.prescription.diagnosis || ''} -> ${entry.prescription.action || ''}</p>
              `}
            </div>
          `)}
        </details>
      `}
    </div>
  `;
}

/* ── ComponentDetail ─────────────────────────────────── */

export function ComponentDetail({ component, project, components, projectId, interviewSpec, liveStatuses, onUpdate, onAdvance, showToast, session, orSettings }) {
  const [result, setResult] = useState(component.result || '');
  const [validationResult, setValidationResult] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const resultRef = { current: null };
  const prevCompIdRef = useRef(component.id);
  const [generatedPrompt, setGeneratedPrompt] = useState(null);

  // Test state
  const [testCode, setTestCode] = useState(component.testCode || '');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(component.testResult || null);

  // Multi-pass state
  const isMultiPass = MULTI_PASS_TYPES.includes(component.type);
  const [passPrompt, setPassPrompt] = useState('');
  const [passResponse, setPassResponse] = useState('');
  const [skeleton, setSkeleton] = useState(null);
  const [unitMap, setUnitMap] = useState({});
  const [passTestCode, setPassTestCode] = useState('');
  const [reflHistory, setReflHistory] = useState([]);
  const [currentPrescription, setCurrentPrescription] = useState(null);

  // Load multi-pass data when component changes
  useEffect(() => {
    if (!isMultiPass) return;
    loadSkeleton(projectId, component.id).then(s => setSkeleton(s)).catch(() => {});
    loadUnits(projectId, component.id).then(u => setUnitMap(u || {})).catch(() => {});
    loadTestCode(projectId, component.id).then(tc => setPassTestCode(tc || '')).catch(() => {});
    loadReflectionHistory(projectId, component.id).then(h => setReflHistory(h || [])).catch(() => {});
  }, [component.id, component.status]);

  // Generate pass prompt when current pass changes
  useEffect(() => {
    if (!isMultiPass || !component.passes) return;
    const currentPass = getNextPass(component.passes);
    if (!currentPass) { setPassPrompt(''); return; }
    try {
      const ctx = {
        component, blueprint: project.blueprint, interviewSpec,
        skeleton, units: unitMap, testCode: passTestCode, reflectionHistory: reflHistory,
      };
      const p = generatePassPrompt(currentPass, ctx);
      setPassPrompt(typeof p === 'string' ? p : (p || ''));
    } catch (e) {
      console.error('[foundry] Pass prompt generation failed:', e);
      setPassPrompt('');
    }
  }, [component.id, component.passes, skeleton, unitMap, passTestCode, reflHistory]);

  useEffect(() => {
    const componentSwitched = prevCompIdRef.current !== component.id;
    prevCompIdRef.current = component.id;

    setResult(component.result || '');
    setTestCode(component.testCode || '');
    setTestResult(component.testResult || null);
    // Only reset validationResult when switching to a different component.
    // When status changes (e.g. validating→done) within the same component,
    // keep validationResult so the Register button stays visible.
    if (componentSwitched) {
      setValidationResult(null);
      setGeneratedPrompt(null);
    }
    // Auto-transition to prompt_ready when opening an unstarted component
    if (component.status === 'not_started') {
      buildComponentPrompt(
        component.type, component.label,
        project.description, project.blueprint,
        components.filter(c => c.status === 'done'),
        interviewSpec,
      ).then(prompt => {
        saveComponent(projectId, {
          ...component, status: 'prompt_ready', prompt,
          history: [...(component.history || []), { action: 'prompt_generated', at: new Date().toISOString(), by: 'system' }],
        }).then(() => onUpdate());
      });
    }
    // Resolve prompt for display if not already stored on component
    if (!component.prompt) {
      const completedComps = components.filter(c => c.status === 'done' && c.registeredAs);
      buildComponentPrompt(
        component.type, component.label,
        project.description, project.blueprint, completedComps,
        interviewSpec,
      ).then(p => setGeneratedPrompt(p));
    }
  }, [component.id, component.result, component.status, component.testCode, component.testResult]);

  const completedComponents = components.filter(c => c.status === 'done' && c.registeredAs);
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
          showToast?.((t('profile.foundry.validationFailed')) + ': ' + vr.errors.join(', '), true);
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
        showToast?.(t('profile.foundry.registrationNameMissing'), true);
        setRegistering(false);
        return;
      }
      const registered = addHistory(component, 'registered', { registeredAs: regName });
      // Create context bundle for downstream prompts (probe results added later if probed)
      const bundle = createBundle({ ...registered, registeredAs: regName, result }, []);
      await saveComponent(projectId, { ...registered, status: 'done', registeredAs: regName, contextBundle: bundle });
      // Smoke test after registration — catch load failures early
      const smoke = await smokeTest(component.type, regName, session);
      if (!smoke.passed) {
        showToast?.(`Smoke test failed: ${smoke.error}`, true);
      } else {
        showToast?.(t('profile.foundry.componentRegistered').replace('{name}', regName));
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
      const extComp = components.find(c => c.type === 'extension' && c.registeredAs);
      const csmComp = components.find(c => c.type === 'csm' && c.registeredAs);
      const serviceSlug = extComp?.registeredAs || csmComp?.registeredAs?.split('/')?.pop() || '';

      // Re-validate current result before re-registering
      const vr = validateComponent(component.type, component.result || result, project.blueprint);
      if (!vr.valid) {
        showToast?.((t('profile.foundry.validationFailed')) + ': ' + vr.errors.join(', '), true);
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
      showToast?.(t('profile.foundry.reregistered').replace('{name}', regName));
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      await onUpdate();
    } catch (e) {
      showToast?.(t('profile.foundry.reregisterFailed').replace('{error}', e.message), true);
    }
    setRegistering(false);
  }

  async function handleRegeneratePrompt() {
    const fresh = await buildComponentPrompt(
      component.type, component.label,
      project.description, project.blueprint,
      components.filter(c => c.status === 'done'),
      interviewSpec,
    );
    const updated = addHistory(component, 'prompt_regenerated');
    await saveComponent(projectId, { ...updated, status: 'prompt_ready', prompt: fresh });
    showToast?.(t('profile.foundry.promptRegenerated'));
    onUpdate();
  }

  async function handleCopyPrompt() {
    const fresh = await buildComponentPrompt(
      component.type, component.label,
      project.description, project.blueprint,
      components.filter(c => c.status === 'done'),
      interviewSpec,
    );
    try {
      await navigator.clipboard.writeText(fresh);
      const updated = addHistory(component, 'prompt_copied');
      await saveComponent(projectId, { ...updated, status: 'waiting_user', prompt: fresh });
      showToast?.(t('profile.foundry.promptCopied'));
      onUpdate();
    } catch { /* clipboard fallback */ }
  }

  async function handleRunComponentAi() {
    setAiRunning(true);
    try {
      const completedComps = components.filter(c => c.status === 'done' && c.registeredAs);
      const fresh = await buildComponentPrompt(
        component.type, component.label,
        project.description, project.blueprint, completedComps,
        interviewSpec,
      );
      writeDebugArtifact(projectId, component.id, 'prompt', fresh);
      let content = await runWithAi(projectId, fresh);
      writeDebugArtifact(projectId, component.id, 'ai-raw-response', content);
      content = stripCodeblock(content);
      setResult(content);

      // Validate
      let vr = validateComponent(component.type, content, project.blueprint);

      // Auto-retry if enabled
      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          showToast?.(t('profile.foundry.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
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
        showToast?.(t('profile.foundry.openrouter.stepComplete'));
      } else {
        const errored = addHistory(component, 'validation_failed', { errors: vr.errors, by: 'autopilot' });
        await saveComponent(projectId, { ...errored, status: 'errors', result: content, validationErrors: vr.errors, prompt: fresh });
        showToast?.(t('profile.foundry.openrouter.stepFailed'), true);
      }
      onUpdate();
    } catch (e) {
      console.error('[foundry] AI run failed:', e);
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
      showToast?.(t('profile.foundry.test_prompt_copied'));
      await writeProjectLog(projectId, 'test_prompt_copied', { meta: { component: component.label, by: 'user' } });
    } catch { /* clipboard fallback */ }
  }

  async function handleRunComponentTest() {
    if (!testCode.trim()) return;
    setTestRunning(true);
    setTestResult(null);
    // Ensure settings are applied and extension/cortex is activated before testing
    if (component.type === 'extension') {
      try { await apiPost(`/v1/foundry/${projectId}/apply-settings/${encodeURIComponent(component.registeredAs)}`); } catch { /* */ }
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
        showToast?.(t('profile.foundry.test_passed'));
        await writeProjectLog(projectId, 'component_test_passed', { meta: { component: component.label, by: 'user' } });
      } else {
        showToast?.(t('profile.foundry.test_failed'), true);
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
      try { await apiPost(`/v1/foundry/${projectId}/apply-settings/${encodeURIComponent(component.registeredAs)}`); } catch { /* */ }
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
        showToast?.(t('profile.foundry.test_passed'));
        await writeProjectLog(projectId, 'component_test_passed', { meta: { component: component.label, by: 'user-ai' } });
      } else {
        showToast?.(t('profile.foundry.test_failed'), true);
        await writeProjectLog(projectId, 'component_test_failed', { meta: { component: component.label, errors: tr?.errors, by: 'user-ai' } });
      }
      onUpdate();
    } catch (e) {
      showToast?.(`Test error: ${e.message}`, true);
      await writeProjectLog(projectId, 'component_test_error', { meta: { component: component.label, error: e.message, by: 'user-ai' } });
    }
    setTestRunning(false);
  }

  // Multi-pass: current pass and submit handler
  const currentPass = isMultiPass && component.passes ? getNextPass(component.passes) : null;

  async function handlePassCopy() {
    if (!passPrompt) return;
    try {
      await navigator.clipboard.writeText(passPrompt);
      showToast?.(t('profile.foundry.promptCopied'));
    } catch { /* clipboard fallback */ }
  }

  async function handlePassValidateAndSave() {
    if (!currentPass || !passResponse.trim()) return;
    const res = await handlePassSubmit(projectId, component.id, currentPass, passResponse, {
      component, blueprint: project.blueprint, interviewSpec,
      skeleton, units: unitMap, testCode: passTestCode, reflectionHistory: reflHistory,
    });

    // Update pass status
    const updatedPasses = (component.passes || []).map(p =>
      p.id === currentPass.id ? { ...p, status: 'validated' } : p
    );

    // If skeleton pass just completed, create unit passes from the skeleton
    if (currentPass.type === 'skeleton') {
      const unitPasses = createUnitPasses(passResponse);
      updatedPasses.push(...unitPasses);
      // Add assembly pass after all unit passes
      updatedPasses.push({ id: 'assembly', type: 'assembly', status: 'pending', attempt: 1 });
      setSkeleton(passResponse);
    }
    if (currentPass.type === 'unit') {
      setUnitMap(prev => ({ ...prev, [currentPass.unitId]: passResponse }));
    }
    if (currentPass.type === 'test') {
      setPassTestCode(passResponse);
    }
    if (currentPass.type === 'reflection' && res.prescription) {
      setCurrentPrescription(res.prescription);
      setReflHistory(prev => [...prev, { attempt: currentPass.attempt || 1, at: new Date().toISOString(), prescription: res.prescription }]);
    }

    // If assembly, save result to component too
    if (res.isFinal) {
      setResult(passResponse);
    }

    const updated = addHistory(component, 'pass_completed', { passId: currentPass.id, passType: currentPass.type });
    await saveComponent(projectId, { ...updated, passes: updatedPasses });
    setPassResponse('');
    onUpdate();
  }

  return html`
    <div class="fnd-component-detail">
      <div class="fnd-comp-header">
        <h4>${component.label}</h4>
        <span class="fnd-type-badge type-${component.type}">${component.type.toUpperCase()}</span>
        <span class="fnd-status-badge status-${component.status}">${component.status}</span>
      </div>

      ${isMultiPass && currentPass ? html`
        <!-- Multi-Pass Workflow -->
        <div class="fnd-section">
          <label>${t('profile.foundry.passProgress')} — ${t('profile.foundry.' + (({'test':'passTest','skeleton':'passSkeleton','unit':'passUnit','assembly':'passAssembly','reflection':'passReflection'})[currentPass.type] || currentPass.type))}${currentPass.unitLabel ? ': ' + currentPass.unitLabel : ''}</label>
          <pre class="fnd-prompt-box">${passPrompt}</pre>
          <div class="flex-row-wrap">
            <button class="btn-outline btn-sm" onClick=${handlePassCopy}>
              ${t('profile.foundry.copyPrompt')}
            </button>
          </div>
        </div>
        <div class="fnd-section">
          <label>${t('profile.foundry.result')}</label>
          <textarea
            class="fnd-result-area"
            rows="12"
            placeholder=${t('profile.foundry.resultPlaceholder')}
            value=${passResponse}
            onInput=${e => setPassResponse(e.target.value)}
          />
          <div class="fnd-actions">
            <button class="btn-primary btn-sm" onClick=${handlePassValidateAndSave}
              disabled=${!passResponse.trim()}>
              ${t('profile.foundry.validate')}
            </button>
          </div>
        </div>

        ${currentPrescription && html`
          <${ReflectionPanel}
            prescription=${currentPrescription}
            reflectionHistory=${reflHistory}
            onExecute=${null}
          />
        `}
      ` : html`
      <!-- AI Chat Mode (single-shot) -->
      <div class="fnd-section">
        <label>${t('profile.foundry.prompt')}</label>
        <pre class="fnd-prompt-box">${prompt}</pre>
        <div class="flex-row-wrap">
          ${workflowStep === 'copy' && html`<${StepArrow} />`}
          <button class="btn-outline btn-sm" onClick=${handleCopyPrompt}
            title=${t('profile.foundry.copyPromptHint')}>
            ${t('profile.foundry.copyPrompt')}
          </button>
          ${orSettings?.hasApiKey && html`
            <button class="btn-outline btn-sm fnd-or-run-btn ${aiRunning ? 'fnd-or-running' : ''}"
              onClick=${handleRunComponentAi}
              disabled=${aiRunning || component.registeredAs}>
              ${aiRunning
                ? html`<span class="fnd-or-spinner"></span> ${t('profile.foundry.openrouter.waiting')}`
                : t('profile.foundry.openrouter.runWithAi')}
            </button>
          `}
          <button class="btn-ghost btn-sm" onClick=${handleRegeneratePrompt} title=${t('profile.foundry.regeneratePromptHint')}>
            ${'↻ ' + (t('profile.foundry.regeneratePrompt'))}
          </button>
        </div>
      </div>
      <div class="fnd-section">
        <div class="flex-row">
          <label>${t('profile.foundry.result')}</label>
          ${workflowStep === 'paste' && html`<${StepArrow} direction="down" />`}
        </div>
        ${component.type === 'extension' && html`
          <p class="fnd-hint">${t('profile.foundry.extensionPasteHint')}</p>
        `}
        <textarea
          ref=${el => { resultRef.current = el; }}
          class="fnd-result-area"
          rows="12"
          placeholder=${component.type === 'extension'
            ? t('profile.foundry.extensionResultPlaceholder')
            : t('profile.foundry.resultPlaceholder')}
          value=${result}
          onInput=${e => setResult(e.target.value)}
        />
        <div class="fnd-actions">
          ${explainPrompt && html`
            <button class="btn-ghost btn-sm" onClick=${() => navigator.clipboard.writeText(explainPrompt)}
              title="Copy explain prompt — ask AI to describe what it built before validating">
              Explain
            </button>
          `}
          ${workflowStep === 'validate' && html`<${StepArrow} />`}
          <button class="btn-primary btn-sm" onClick=${handleValidate} disabled=${!result.trim()}
            title=${t('profile.foundry.validateHint')}>
            ${t('profile.foundry.validate')}
          </button>
          ${validationResult?.valid && html`
            ${workflowStep === 'register' && html`<${StepArrow} />`}
            <button class="btn-success btn-sm" onClick=${handleRegister} disabled=${registering}
              title=${t('profile.foundry.registerHint')}>
              ${registering ? '...' : t('profile.foundry.register')}
            </button>
          `}
          ${component.registeredAs && result.trim() && html`
            <button class="btn-outline btn-sm" onClick=${handleReregister} disabled=${registering}
              title=${t('profile.foundry.reregisterHint')}>
              ${registering ? '...' : (t('profile.foundry.reregister'))}
            </button>
          `}
        </div>
      </div>

      <!-- Errors -->
      ${validationResult && !validationResult.valid && html`
        <div class="fnd-errors">
          <label>${t('profile.foundry.errors')}</label>
          <ul>
            ${validationResult.errors.map(e => html`<li>${e}</li>`)}
          </ul>
          ${reflectionPrompt && html`
            <div class="flex-row" style="margin-bottom: 0.5rem">
              <button class="btn-outline btn-sm" onClick=${() => navigator.clipboard.writeText(reflectionPrompt)}>
                1. Copy Reflection (diagnose first)
              </button>
            </div>
          `}
          ${fixPrompt && html`
            <div class="flex-row">
              ${workflowStep === 'fix' && html`<${StepArrow} />`}
              <button class="btn-primary btn-sm" onClick=${() => navigator.clipboard.writeText(fixPrompt)}>
                2. ${t('profile.foundry.copyFixPrompt')}
              </button>
            </div>
          `}
        </div>
      `}
      `}

      <!-- Test Section (for registered testable components) -->
      <!-- Same structure as component generation: PROMPT → RESULT (test code) → RUN -->
      ${isTestable && html`
        <div class="fnd-section fnd-test-section">
          <label>${t('profile.foundry.test_prompt')} (${testEnvironment})</label>
          <pre class="fnd-prompt-box">${currentTestPrompt}</pre>
          <div class="flex-row-wrap">
            <button class="btn-outline btn-sm" onClick=${handleCopyTestPrompt}>
              ${t('profile.foundry.test_copy_prompt')}
            </button>
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline btn-sm fnd-or-run-btn ${testRunning ? 'fnd-or-running' : ''}"
                onClick=${handleRunTestWithAi}
                disabled=${testRunning}>
                ${testRunning
                  ? html`<span class="fnd-or-spinner"></span> ${t('profile.foundry.test_running')}`
                  : t('profile.foundry.test_run_with_ai')}
              </button>
            `}
          </div>
        </div>
        <div class="fnd-section">
          <label>${t('profile.foundry.test_code')}</label>
          <textarea
            class="fnd-result-area"
            rows="8"
            placeholder=${t('profile.foundry.test_code_placeholder')}
            value=${testCode}
            onInput=${e => setTestCode(e.target.value)}
          />
          <div class="fnd-actions">
            <button class="btn-primary btn-sm" onClick=${handleRunComponentTest}
              disabled=${!testCode.trim() || testRunning}>
              ${testRunning
                ? html`<span class="fnd-or-spinner"></span> ${t('profile.foundry.test_running')}`
                : t('profile.foundry.test_run')}
            </button>
          </div>
        </div>

        <!-- Test Result -->
        ${testResult && html`
          <div class="fnd-section">
            <div class="fnd-test-result-detail fnd-test-${testResult.status}">
              <strong>${t('profile.foundry.test_result_title')}: ${t('profile.foundry.test_component_' + testResult.status)}</strong>
              ${testResult.errors && testResult.errors.length > 0 && html`
                <ul class="fnd-test-errors">
                  ${testResult.errors.map(e => html`<li>${e}</li>`)}
                </ul>
              `}
              ${testResult.trace && testResult.trace.length > 0 && html`
                <details class="fnd-test-trace">
                  <summary>${t('profile.foundry.test_trace_title') || 'Trace'} (${testResult.trace.length})</summary>
                  <pre class="fnd-trace-pre">${testResult.trace.map(t =>
                    `[${t.status}] ${t.fn}(${t.args})\n  → ${t.result}`
                  ).join('\n\n')}</pre>
                </details>
              `}
              ${testResult.screenshots && testResult.screenshots.length > 0 && html`
                <div class="fnd-test-screenshots">
                  <div class="fnd-screenshot-grid">
                    ${testResult.screenshots.map(s => html`
                      <img src=${screenshotUrl(projectId, s)} class="fnd-screenshot" alt=${s}
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
  return html`<div class="fnd-test-scope ${compact ? 'fnd-test-scope-compact' : ''}">
    ${!compact && html`<h4>${t('profile.foundry.test_scope_title')}</h4>`}
    ${['comprehensive', 'basic', 'none'].map(level => html`
      <label class="fnd-or-radio-label" title=${t('profile.foundry.test_scope_' + level)}>
        <input type="radio" name="test-scope-${compact ? 'compact' : 'full'}" value=${level}
          checked=${value === level}
          onChange=${() => onChange(level)} />
        ${compact
          ? (level === 'comprehensive' ? '✓ ' + t('profile.foundry.test_scope_comprehensive_short')
            : level === 'basic' ? '○ ' + t('profile.foundry.test_scope_basic_short')
            : '— ' + t('profile.foundry.test_scope_none_short'))
          : t('profile.foundry.test_scope_' + level)}
      </label>
    `)}
  </div>`;
}

export function TestResultsView({ report, projectId, onFixRequest }) {
  if (!report) return null;

  const overallKey = report.overall === 'passed' ? 'test_passed'
    : report.overall === 'partial' ? 'test_partial'
    : 'test_failed';

  return html`<div class="fnd-test-results">
    <div class="fnd-test-overall fnd-test-${report.overall}">
      ${t('profile.foundry.' + overallKey)}
    </div>
    ${(report.components || []).map(c => html`
      <div class="fnd-test-component fnd-test-${c.status}">
        <strong>${c.label || c.componentId}</strong>
        <span class="fnd-test-badge">${t('profile.foundry.test_component_' + c.status)}</span>
        ${c.fixRound > 0 && html`<span class="fnd-test-badge">${t('profile.foundry.test_fix_round')} ${c.fixRound}</span>`}
        ${c.errors && c.errors.length > 0
          ? html`<span>${c.errors.length} ${t('profile.foundry.test_errors_count')}</span>`
          : html`<span>${c.passed}/${c.scenarios}</span>`}
        ${c.errors && c.errors.length > 0 && html`<ul class="fnd-test-errors">
          ${c.errors.map(e => html`<li>${e}</li>`)}
        </ul>`}
        ${c.screenshots && c.screenshots.length > 0 && html`<div class="fnd-test-screenshots">
          <strong>${t('profile.foundry.test_screenshots')}</strong>
          <div class="fnd-screenshot-grid">
            ${c.screenshots.map(s => html`
              <img src=${screenshotUrl(projectId, s)} class="fnd-screenshot" alt=${s}
                onClick=${() => window.open(screenshotUrl(projectId, s), '_blank')} />
            `)}
          </div>
        </div>`}
        ${c.status === 'failed' && onFixRequest && html`<div class="fnd-test-fix-actions">
          <button class="btn-primary" onClick=${() => onFixRequest(c.componentId, 'auto')}>
            ${t('profile.foundry.test_fix_auto')}
          </button>
          <button class="btn-outline" onClick=${() => onFixRequest(c.componentId, 'manual')}>
            ${t('profile.foundry.test_fix_manual')}
          </button>
          <button class="btn-ghost" onClick=${() => onFixRequest(c.componentId, 'skip')}>
            ${t('profile.foundry.test_fix_skip')}
          </button>
        </div>`}
      </div>
    `)}
  </div>`;
}
