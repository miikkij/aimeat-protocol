/**
 * @file views/profile/generator-detail.spec-section.js
 * @description SPEC prompt/result editor block for extension, cortex and app component types in
 *   the service generator detail view (generate → validate → save spec workflow). Extracted
 *   verbatim from generator-detail.js to satisfy max-file-lines. All state lives in the parent
 *   ComponentDetail and is passed in as props; this component holds no hooks of its own.
 * @structure
 *   - SpecSection: SPEC PROMPT + SPEC RESULT sections with validate/save/fix-with-AI actions
 * @usage
 *   import { SpecSection } from './generator-detail.spec-section.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-detail.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { CopyButton } from '/components/CopyButton.js';
import { saveComponent, saveSpec } from '/js/services/generator.js';
import { validateExtensionSpec, validateDataApiSpec, validateComponentSpec, validateAppDomainSpec, validateAppSpec } from '/js/services/generator-spec-validate.js';
import { runWithAi, loadPromptFromBackend } from './generator-detail.ai.js';

export function SpecSection({
  component, project, projectId, showToast, onUpdate, orSettings,
  specPrompt, specResult, setSpecResult, specAiRunning, setSpecAiRunning,
  specValidation, setSpecValidation, setGeneratedPrompt,
}) {
  // Spec fix prompt — derived from current spec validation errors + spec result (shared by Copy and Fix-with-AI buttons)
  const specFixPrompt = specValidation && !specValidation.valid
    ? 'Fix the following spec JSON. It has validation errors.\n\n'
      + '## Errors\n' + specValidation.errors.map((e, i) => (i + 1) + '. ' + e).join('\n')
      + '\n\n## Current Spec\n```json\n' + specResult + '\n```\n\n'
      + '## Rules\n- Fix ONLY the listed errors\n- Do NOT remove existing actions\n- Return the COMPLETE fixed JSON'
    : null;

  return html`
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
  `;
}
