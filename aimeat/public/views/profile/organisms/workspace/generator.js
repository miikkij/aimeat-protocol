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
 *   v1.9.0 -- 2026-09-26 -- Every part is a library component that takes data: the section Card, the
 *     Sub-heading with its description, the Text areas, FormActions with the loud action (its spinner
 *     the Spinner) and the action link, and the Attention note with the row Label and each refusal as
 *     the Form message. The page writes no class (page migration G2b).
 *   v1.8.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.7.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 -- 2026-09-25 -- A failed generation's note: its heading is the row label (.poster-label) and each reason the Form message's refused cut (.form-message--error), as the attention notes and forms of the other tabs say it (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.4.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
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
import { Card } from '/components/Card.js';
import { Action, Loud } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SubHeading, HeadDesc } from '/components/SubHeading.js';
import { TextArea } from '/components/TextField.js';
import { FormActions } from '/components/Field.js';
import { Spinner } from '/components/Spinner.js';
import { Stack } from '/components/Layout.js';

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

  const descWords = t('organisms.generatePlaceholder') || 'e.g. A research study tracking hypotheses, experiments and validated findings';
  const pasteWords = t('organisms.pastePlaceholder') || 'Paste the AI JSON response here';
  return html`
    <${Card} tone="section">
      <${Stack}>
        <${SubHeading} desc=${showRegenerate
          ? (t('organisms.restructureDesc') || 'Describe what to add or change. Existing types and their data are kept — the AI extends the current structure. (To start completely fresh, delete the workspace below first.)')
          : (t('organisms.generateDesc') || 'Describe what you want to track — the AI designs the object types. Use your OpenRouter key for one-click generation, or copy the prompt into any AI chat (free) and paste the result back.')}>${showRegenerate ? (t('organisms.restructureTitle') || 'Restructure / add types with AI') : (t('organisms.generateTitle') || 'Or generate a custom workspace with AI')}<//>

        <${TextArea} rows=${3} placeholder=${descWords} ariaLabel=${descWords} value=${genDesc} onInput=${setGenDesc} />

        <${OpenRouterSettings} onSettingsChange=${s => setHasAiKey(!!(s && s.hasApiKey))} />

        <${FormActions}>
          ${hasAiKey ? html`
            <${Loud} control onClick=${generate} disabled=${genBusy || !genDesc.trim()}>
              ${genBusy ? html`<${Spinner} /> ${t('organisms.generating') || 'Generating…'}` : (t('organisms.generate') || 'Generate with AI')}
            <//>
          ` : null}
          <${Action} small onClick=${copyPrompt} disabled=${!genDesc.trim()}>${t('common.copyPrompt') || 'Copy prompt'}<//>
        <//>

        <${HeadDesc}>${t('organisms.pasteHelp') || 'No key? Copy the prompt above into any AI chat, then paste the JSON it returns here:'}<//>
        <${TextArea} rows=${4} placeholder=${pasteWords} ariaLabel=${pasteWords} value=${pasteText} onInput=${setPasteText} />

        ${genFail && html`
          <${Note} kind="aside" size="small">
            <${Label} block>${t('organisms.genFailed') || 'Generation failed — try again'}<//>
            <${Note} kind="message" error>${(genFail)}<//>
          <//>
        `}

        ${genErrors.length > 0 && html`
          <${Note} kind="aside" size="small">
            <${Label} block>${t('organisms.fixNeeded') || 'This needs fixing before it can be saved:'}<//>
            <${Stack} gap="tight">${genErrors.map((e, i) => html`<${Note} kind="message" error key=${i}>${(e)}<//>`)}<//>
            <${FormActions}>
              <${Action} small onClick=${copyFixPrompt}>${t('organisms.copyFixPrompt') || 'Copy fix prompt for the AI'}<//>
            <//>
          <//>
        `}

        <${FormActions}>
          <${Loud} control onClick=${applyPasted} disabled=${applyBusy || !pasteText.trim()}>
            ${applyBusy ? html`<${Spinner} /> ` : ''}${t('organisms.applyPasted') || 'Validate & apply'}
          <//>
        <//>
      <//>
    <//>
  `;
}
