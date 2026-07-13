/**
 * @file use-edit-mode.js
 * @description Custom hook for the edit service flow — change request → impact
 *   analysis → targeted per-component edits. Supports both manual (copy prompt)
 *   and AI-driven (single or batch) edit modes.
 *
 *   Part of the hook-per-domain architecture for ProjectDashboard. This hook owns
 *   all edit-mode state (mode, change request, impact analysis result, parsed impact,
 *   errors, AI running indicator) and exposes handlers for the full edit workflow.
 *
 *   Uses autopilotState (from useAutopilotState) for batch edit operations —
 *   handleRunAllEditsAi uses autopilotState.start/finish/setStep/cancelledRef
 *   to share the autopilot UI with the generation pipeline.
 *
 *   Restores pending edit state from useDashboardCore.pendingEdit on load.
 *
 *   Architecture: useDashboardCore → useEditMode ← useAutopilotState
 *                   → EditModePanel (sub-component)
 *
 * @structure
 *   - useEditMode(core, autopilotState, projectId, orSettings, session, showToast): custom hook
 *     State: editMode, changeRequest, impactResult, impactParsed, impactErrors, aiRunning
 *     Handlers: exitEditMode, handleCopyImpactPrompt, handleRunImpactAi, handleParseImpact,
 *               handleRunAllEditsAi, handleCopyEditPrompt, handleRunSingleEditAi
 * @usage
 *   import { useEditMode } from './foundry-dashboard/use-edit-mode.js';
 *   const edit = useEditMode(core, autopilotState, projectId, orSettings, session, showToast);
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js ProjectDashboard
 */
import { useState, useEffect } from 'preact/hooks';
import { t } from '/js/i18n.js';
import {
  saveComponent, registerComponent, writeProjectLog,
  savePendingEdit, clearPendingEdit,
} from '/js/services/foundry.js';
import { buildImpactPrompt, buildEditPrompt, buildFixPrompt } from '/js/services/foundry-prompts.js';
import { validateComponent } from '/js/services/foundry-validate.js';
import { runWithAi, stripCodeblock } from '../foundry-detail.js';

/** History helper — creates a new component object with a history entry appended */
function addHistory(comp, action, extra = {}) {
  return { ...comp, history: [...(comp.history || []), { action, at: new Date().toISOString(), by: 'autopilot', ...extra }] };
}

/**
 * @param {Object} core — useDashboardCore return value
 * @param {Object} autopilotState — useAutopilotState return value
 * @param {string} projectId
 * @param {Object} orSettings — { hasApiKey, autoRetry, maxRetries }
 * @param {Object} session
 * @param {Function} showToast
 */
export function useEditMode(core, autopilotState, projectId, orSettings, session, showToast) {
  const [editMode, setEditMode] = useState(null);
  const [changeRequest, setChangeRequest] = useState('');
  const [impactResult, setImpactResult] = useState('');
  const [impactParsed, setImpactParsed] = useState(null);
  const [impactErrors, setImpactErrors] = useState([]);
  const [aiRunning, setAiRunning] = useState(null);

  // Restore pending edit when core loads it
  useEffect(() => {
    if (core.pendingEdit) {
      setChangeRequest(core.pendingEdit.changeRequest || '');
      setImpactParsed(core.pendingEdit.impactParsed || null);
      setImpactResult(core.pendingEdit.impactResult || '');
      setEditMode(core.pendingEdit.impactParsed ? 'editing' : 'request');
    }
  }, [core.pendingEdit]);

  function exitEditMode() {
    setEditMode(null);
    setChangeRequest('');
    setImpactResult('');
    setImpactParsed(null);
    setImpactErrors([]);
    clearPendingEdit(projectId).catch(() => {});
  }

  function handleCopyImpactPrompt() {
    const prompt = buildImpactPrompt(changeRequest, core.project?.blueprint);
    navigator.clipboard.writeText(prompt).catch(() => {});
    showToast?.(t('profile.foundry.impactPromptCopied'));
    setEditMode('impact');
  }

  async function handleRunImpactAi() {
    if (!orSettings?.hasApiKey) return;
    setAiRunning('impact');
    try {
      const prompt = buildImpactPrompt(changeRequest, core.project?.blueprint);
      const content = await runWithAi(projectId, prompt);
      setImpactResult(content);
      setEditMode('impact');
      // Auto-parse
      let text = content.trim();
      const jsonMatch = text.match(/```json\s*\n([\s\S]*?)```/i);
      if (jsonMatch) text = jsonMatch[1].trim();
      const parsed = JSON.parse(text);
      if (parsed.analysis && Array.isArray(parsed.analysis)) {
        setImpactParsed(parsed);
        setImpactErrors([]);
        setEditMode('editing');
        savePendingEdit(projectId, { changeRequest, impactParsed: parsed, impactResult: content }).catch(() => {});
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
    setAiRunning(null);
  }

  function handleParseImpact() {
    try {
      let text = impactResult.trim();
      const jsonMatch = text.match(/```json\s*\n([\s\S]*?)```/i);
      if (jsonMatch) text = jsonMatch[1].trim();
      const parsed = JSON.parse(text);
      if (!parsed.analysis || !Array.isArray(parsed.analysis)) {
        setImpactErrors([t('profile.foundry.impactArrayRequired')]);
        return;
      }
      setImpactParsed(parsed);
      setImpactErrors([]);
      setEditMode('editing');
      savePendingEdit(projectId, { changeRequest, impactParsed: parsed, impactResult }).catch(() => {});
    } catch (e) {
      setImpactErrors([t('profile.foundry.invalidJson').replace('{error}', e.message)]);
    }
  }

  async function handleRunAllEditsAi() {
    if (!orSettings?.hasApiKey || !impactParsed?.analysis) return;
    autopilotState.start();
    try {
      const editable = impactParsed.analysis.filter(a => a.impact === 'root' || a.impact === 'update');
      for (const item of editable) {
        if (autopilotState.cancelledRef.current) break;
        // Read core.components inline (not destructured) to avoid stale closure
        const comp = core.components.find(c => c.id === item.id);
        if (!comp) continue;
        autopilotState.setStep(comp.label);
        core.setSelectedId(comp.id);

        const upstream = impactParsed.analysis
          .filter(a => a.impact === 'root' && a.id !== comp.id)
          .map(a => `- ${a.label}: ${a.suggestedChange}`)
          .join('\n') || '';
        const prompt = buildEditPrompt(
          comp.type, comp.label,
          comp.result || '(no current code)',
          item.suggestedChange || changeRequest,
          upstream || null,
        );

        let content;
        try {
          content = await runWithAi(projectId, prompt);
        } catch (e) {
          showToast?.(`${comp.label}: ${e.message}`, true);
          break;
        }
        if (autopilotState.cancelledRef.current) break;
        content = stripCodeblock(content);

        let vr = validateComponent(comp.type, content, core.project?.blueprint);

        if (!vr.valid && orSettings?.autoRetry) {
          const max = orSettings.maxRetries || 3;
          for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
            if (autopilotState.cancelledRef.current) break;
            autopilotState.setStep(
              comp.label + ' - ' + t('profile.foundry.openrouter.retrying').replace('{current}', attempt).replace('{max}', max)
            );
            const fp = buildFixPrompt(prompt, content, vr.errors, comp.type);
            try { content = await runWithAi(projectId, fp); } catch { break; }
            content = stripCodeblock(content);
            vr = validateComponent(comp.type, content, core.project?.blueprint);
          }
        }

        if (!vr.valid) {
          const errored = addHistory(comp, 'validation_failed', { errors: vr.errors, by: 'autopilot' });
          await saveComponent(projectId, { ...errored, status: 'errors', result: content, validationErrors: vr.errors });
          await core.loadData();
          showToast?.(t('profile.foundry.openrouter.stepFailed') + ': ' + comp.label, true);
          break;
        }

        const updated = addHistory(comp, 'edited', { by: 'autopilot', change: item.suggestedChange });
        await saveComponent(projectId, { ...updated, status: 'done', result: content, validationErrors: [] });

        try {
          const serviceSlug = core.components.find(c => c.type === 'csm' && c.registeredAs)?.registeredAs?.split('/')?.pop() || '';
          if (comp.type === 'cortex') {
            const cortexVr = validateComponent('cortex', content, core.project?.blueprint);
            await registerComponent('cortex', cortexVr.extracted, session, serviceSlug);
          } else {
            await registerComponent(comp.type, vr.extracted || content, session, serviceSlug);
          }
          await writeProjectLog(projectId, 'component_edited', { meta: { component: comp.label, by: 'autopilot' } });
        } catch (e) {
          showToast?.(`${comp.label}: Registration failed: ${e.message}`, true);
          await core.loadData();
          break;
        }
        await core.loadData();
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
    autopilotState.finish();
    showToast?.(t('profile.foundry.openrouter.stepComplete'));
  }

  function handleCopyEditPrompt(comp, suggestedChange) {
    const upstream = impactParsed?.analysis
      ?.filter(a => a.impact === 'root' && a.id !== comp.id)
      ?.map(a => `- ${a.label}: ${a.suggestedChange}`)
      ?.join('\n') || '';
    const prompt = buildEditPrompt(
      comp.type, comp.label,
      comp.result || '(no current code)',
      suggestedChange || changeRequest,
      upstream || null,
    );
    navigator.clipboard.writeText(prompt).catch(() => {});
    showToast?.(t('profile.foundry.editPromptCopied').replace('{name}', comp.label));
  }

  async function handleRunSingleEditAi(comp, suggestedChange) {
    if (!orSettings?.hasApiKey) return;
    setAiRunning(comp.id);
    try {
      const upstream = impactParsed?.analysis
        ?.filter(a => a.impact === 'root' && a.id !== comp.id)
        ?.map(a => `- ${a.label}: ${a.suggestedChange}`)
        ?.join('\n') || '';
      const prompt = buildEditPrompt(
        comp.type, comp.label,
        comp.result || '(no current code)',
        suggestedChange || changeRequest,
        upstream || null,
      );
      let content = await runWithAi(projectId, prompt);
      content = stripCodeblock(content);
      let vr = validateComponent(comp.type, content, core.project?.blueprint);

      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          const fp = buildFixPrompt(prompt, content, vr.errors, comp.type);
          try { content = await runWithAi(projectId, fp); } catch { break; }
          content = stripCodeblock(content);
          vr = validateComponent(comp.type, content, core.project?.blueprint);
        }
      }

      if (!vr.valid) {
        const errored = addHistory(comp, 'validation_failed', { errors: vr.errors, by: 'autopilot' });
        await saveComponent(projectId, { ...errored, status: 'errors', result: content, validationErrors: vr.errors });
        await core.loadData();
        showToast?.(t('profile.foundry.openrouter.stepFailed') + ': ' + comp.label, true);
        setAiRunning(null);
        return;
      }

      const updated = addHistory(comp, 'edited', { by: 'autopilot', change: suggestedChange });
      await saveComponent(projectId, { ...updated, status: 'done', result: content, validationErrors: [] });
      const serviceSlug = core.components.find(c => c.type === 'csm' && c.registeredAs)?.registeredAs?.split('/')?.pop() || '';
      if (comp.type === 'cortex') {
        const cortexVr = validateComponent('cortex', content, core.project?.blueprint);
        await registerComponent('cortex', cortexVr.extracted, session, serviceSlug);
      } else {
        await registerComponent(comp.type, vr.extracted || content, session, serviceSlug);
      }
      await writeProjectLog(projectId, 'component_edited', { meta: { component: comp.label, by: 'autopilot' } });
      await core.loadData();
      showToast?.(t('profile.foundry.openrouter.stepDone').replace('{name}', comp.label));
    } catch (e) {
      showToast?.(e.message, true);
    }
    setAiRunning(null);
  }

  return {
    editMode, setEditMode, changeRequest, setChangeRequest,
    impactResult, setImpactResult, impactParsed, impactErrors,
    aiRunning,
    exitEditMode, handleCopyImpactPrompt, handleRunImpactAi,
    handleParseImpact, handleRunAllEditsAi, handleCopyEditPrompt,
    handleRunSingleEditAi,
  };
}
