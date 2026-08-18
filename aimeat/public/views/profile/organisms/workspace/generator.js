/**
 * @file public/views/profile/organisms/workspace/generator.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI / paste generator for organism workspaces — reused for a fresh workspace AND
 *   for "restructure" (where, via showRegenerate, it passes the current manifest so the AI EXTENDS
 *   it additively). Owns its own draft/paste state; the parent still owns the shared `genBusy` flag
 *   (so the "Set up workspace" button can disable while generating). Extracted from workspace.js to
 *   satisfy max-file-lines with no behaviour change.
 * @structure WorkspaceGenerator
 * @usage import { WorkspaceGenerator } from '/views/profile/organisms/workspace/generator.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import * as orgService from '/js/services/organisms.js';
import { OpenRouterSettings } from '/views/profile/openrouter-settings.js';

export function WorkspaceGenerator({ orgId, wsId, showToast, onApplied, onOpenSettings, showRegenerate, manifest, genBusy, setGenBusy }) {
  const [genDesc, setGenDesc] = useState('');
  const [applyBusy, setApplyBusy] = useState(false); // "Validate & apply" (pasted JSON) in flight
  const [hasAiKey, setHasAiKey] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [genErrors, setGenErrors] = useState([]);   // validation errors (JSON present, fixable)
  const [genFail, setGenFail] = useState('');        // generation failure (AI call timed out / errored)

  // Validate the JSON first; save only if clean. On errors, surface them (+ a fix prompt for the AI).
  const validateAndApply = useCallback(async (jsonText, fromGenerator) => {
    setGenErrors([]); setGenFail('');
    let generated;
    try { generated = orgService.parseGenerated(jsonText); }
    catch (e) { setGenErrors([(e && e.message) || 'Invalid JSON']); return; }
    const errs = orgService.validateGenerated(generated);
    if (errs.length) { setGenErrors(errs); return; }
    // The Generate flow owns genBusy; a direct paste-apply spins its own button only.
    const setBusyFn = fromGenerator ? setGenBusy : setApplyBusy;
    setBusyFn(true);
    try {
      await orgService.applyGeneratedWorkspace(orgId, wsId, generated);
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      if (fromGenerator) onOpenSettings();   // open settings so the user can tweak the generated workspace
      await onApplied();
    } catch (e) { setGenErrors([(e && e.message) || (t('organisms.applyError') || 'Could not apply — check the JSON.')]); }
    finally { setBusyFn(false); }
  }, [orgId, wsId, showToast, onApplied, onOpenSettings, setGenBusy]);

  const generate = useCallback(async () => {
    if (!genDesc.trim()) return;
    setGenBusy(true); setGenErrors([]); setGenFail('');
    try {
      const raw = await orgService.generateRaw(genDesc.trim(), showRegenerate ? manifest : null);
      setPasteText(raw);                  // show the generated JSON in the box
      await validateAndApply(raw, true);
    } catch (e) {
      setGenFail(e?.code === 'NO_API_KEY'
        ? (t('organisms.noAiKey') || 'Set up your OpenRouter key above, or copy the prompt to your own AI chat.')
        : ((e && e.message) || (t('organisms.generateError') || 'Generation failed')));
    } finally { setGenBusy(false); }
  }, [genDesc, validateAndApply, showRegenerate, manifest, setGenBusy]);

  const copyPrompt = useCallback(async () => {
    try {
      await copyToClipboard(await orgService.buildGeneratorPrompt(genDesc.trim(), showRegenerate ? manifest : null));
      showToast(t('organisms.promptCopied') || 'Prompt copied — paste it into any AI chat, then paste the JSON it returns below.');
    } catch (e) { showToast((e && e.message) || 'Failed to copy'); }
  }, [genDesc, showToast, showRegenerate, manifest]);

  const applyPasted = useCallback(() => { if (pasteText.trim()) validateAndApply(pasteText, false); }, [pasteText, validateAndApply]);

  const copyFixPrompt = useCallback(async () => {
    try {
      await copyToClipboard(orgService.buildFixPrompt(pasteText, genErrors));
      showToast(t('organisms.fixPromptCopied') || 'Fix prompt copied — paste it back to your AI, then paste the corrected JSON.');
    } catch (e) { showToast((e && e.message) || 'Failed to copy'); }
  }, [pasteText, genErrors, showToast]);

  return html`
    <div class="pj-section">
      <div class="pj-section-title">${showRegenerate ? (t('organisms.restructureTitle') || 'Restructure / add types with AI') : (t('organisms.generateTitle') || 'Or generate a custom workspace with AI')}</div>
      <div class="section-desc">${showRegenerate
        ? (t('organisms.restructureDesc') || 'Describe what to add or change. Existing types and their data are kept — the AI extends the current structure. (To start completely fresh, delete the workspace below first.)')
        : (t('organisms.generateDesc') || 'Describe what you want to track — the AI designs the object types. Use your OpenRouter key for one-click generation, or copy the prompt into any AI chat (free) and paste the result back.')}</div>

      <textarea class="input-field input-sm" rows="3"
        placeholder=${t('organisms.generatePlaceholder') || 'e.g. A research study tracking hypotheses, experiments and validated findings'}
        value=${genDesc} onInput=${e => setGenDesc(e.target.value)}></textarea>

      <${OpenRouterSettings} onSettingsChange=${s => setHasAiKey(!!(s && s.hasApiKey))} />

      <div class="form-actions">
        ${hasAiKey ? html`
          <button class="btn-primary btn-sm" onClick=${generate} disabled=${genBusy || !genDesc.trim()}>
            ${genBusy ? html`<span class="spinner"></span> ${t('organisms.generating') || 'Generating…'}` : (t('organisms.generate') || 'Generate with AI')}
          </button>
        ` : null}
        <button class="btn-outline btn-sm" onClick=${copyPrompt} disabled=${!genDesc.trim()}>${t('common.copyPrompt') || 'Copy prompt'}</button>
      </div>

      <div class="section-desc">${t('organisms.pasteHelp') || 'No key? Copy the prompt above into any AI chat, then paste the JSON it returns here:'}</div>
      <textarea class="input-field input-sm" rows="4"
        placeholder=${t('organisms.pastePlaceholder') || 'Paste the AI JSON response here'}
        value=${pasteText} onInput=${e => setPasteText(e.target.value)}></textarea>

      ${genFail && html`
        <div class="pj-errors">
          <div class="pj-errors-title">${t('organisms.genFailed') || 'Generation failed — try again'}</div>
          <div class="pj-error-line">${(genFail)}</div>
        </div>
      `}

      ${genErrors.length > 0 && html`
        <div class="pj-errors">
          <div class="pj-errors-title">${t('organisms.fixNeeded') || 'This needs fixing before it can be saved:'}</div>
          ${genErrors.map((e, i) => html`<div class="pj-error-line" key=${i}>${(e)}</div>`)}
          <div class="form-actions">
            <button class="btn-outline btn-sm" onClick=${copyFixPrompt}>${t('organisms.copyFixPrompt') || 'Copy fix prompt for the AI'}</button>
          </div>
        </div>
      `}

      <div class="form-actions">
        <button class="btn-primary btn-sm" onClick=${applyPasted} disabled=${applyBusy || !pasteText.trim()}>
          ${applyBusy ? html`<span class="spinner"></span> ` : ''}${t('organisms.applyPasted') || 'Validate & apply'}
        </button>
      </div>
    </div>
  `;
}
