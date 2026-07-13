/**
 * @file calibrator-batch.js
 * @description Batch card component for the Prompt Calibrator V2.
 *   Renders collapsed summary + expanded 4-step detail view.
 *   Handles step execution (generate, analyze, reflect, synthesize).
 * @structure
 *   - BatchCard (default export) — collapsed/expanded toggle, step execution
 *   - PasteBack — reusable paste-back textarea component
 *   - callModel — sends prompt to OpenRouter-compatible endpoint
 *   - extractJson — best-effort JSON extraction from LLM text
 *   - renderStep1 — Step 1 UI (Generation)
 *   - renderStep2 — Step 2 UI (Analysis)
 *   - renderStep3 — Step 3 UI (Reflection — dual columns)
 *   - renderStep4 — Step 4 UI (Synthesis — grouped proposals + A/B/C options)
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial V2 implementation
 *   v1.0.1 — 2026-06-19 — lint fixes (misleading-char-class/unused-expression/empty-block)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';

/** Weighted score: critical=3, major=2, minor=1. Returns 0-100 or null. */
function computeWeightedScore(dims) {
  if (!dims || dims.length === 0) return null;
  const weights = { critical: 3, major: 2, minor: 1 };
  let totalWeight = 0, passedWeight = 0;
  for (const d of dims) {
    const w = weights[d.severity] || 1;
    totalWeight += w;
    if (d.pass) passedWeight += w;
  }
  return totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : null;
}
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { copyToClipboard } from '/js/utils.js';
import { getBatch, updateBatch, createVersion } from '/js/services/calibrator.js';


// ── Helpers ──

async function callModel(projectId, prompt, modelId, { retries = 1, temperature, top_p, max_tokens } = /** @type {{ retries?: number, temperature?: number, top_p?: number, max_tokens?: number }} */ ({})) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1_800_000); // 30 min
    const headers = { 'Content-Type': 'application/json' };
    const session = window.AIMEAT?.auth?.getSession?.();
    if (session?.jwt) headers['Authorization'] = 'Bearer ' + session.jwt;
    try {
      const body = { projectId, prompt, model: modelId };
      if (temperature !== undefined) body.temperature = temperature;
      if (top_p !== undefined) body.top_p = top_p;
      if (max_tokens !== undefined) body.max_tokens = max_tokens;
      const raw = await fetch('/v1/openrouter/complete', {
        method: 'POST', headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!raw.ok) {
        let msg = `HTTP ${raw.status}`;
        try { const e = await raw.json(); msg = e.error?.message || msg; } catch { /* ignore */ }
        // Retry on 502/503/429
        if (attempt < retries && (raw.status === 502 || raw.status === 503 || raw.status === 429)) {
          console.warn(`callModel retry ${attempt + 1}/${retries}: ${msg}`);
          await new Promise(r => setTimeout(r, 3000)); // wait 3s before retry
          continue;
        }
        throw new Error(msg);
      }
      const resp = await raw.json();
      if (resp.ok === false) throw new Error(resp.error?.message || 'OpenRouter error');
      const content = resp.data?.content || '';
      // Empty response = model didn't run properly. Retry if possible.
      if (!content && attempt < retries) {
        console.warn(`callModel retry ${attempt + 1}/${retries}: empty response from ${modelId}`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (!content) {
        throw new Error(`Model returned empty response (${modelId}). This usually means OpenRouter failed to route the request. Try again.`);
      }
      return content;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Request timed out (30 min)', { cause: e });
      // Retry on network errors
      if (attempt < retries && e.name === 'TypeError') {
        console.warn(`callModel retry ${attempt + 1}/${retries}: network error`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw e;
    } finally { clearTimeout(timeoutId); }
  }
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function scoreClass(score) {
  if (score == null) return '';
  if (score >= 80) return 'pass';
  if (score >= 50) return 'mixed';
  return 'fail';
}

function formatDuration(ms) {
  if (!ms) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

const PENDING_ANALYSIS = { status: 'pending', dimensions: [], overallScore: null, analysis: null, error: null, promptSent: null, rawResponse: null };
const PENDING_REFLECTION = { status: 'pending', judgeProposals: null, selfProposals: null, error: null };
const PENDING_SYNTHESIS = { status: 'pending', groupedProposals: [], options: null, recommendation: null, analysis: null, error: null, promptSent: null, rawResponse: null };


// ── PasteBack Component ──

function PasteBack({ label, onSave }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  if (!open) return html`<button class="btn-ghost btn-sm" onClick=${() => setOpen(true)}>${label}</button>`;
  return html`
    <div class="fnd-cal-paste">
      <textarea value=${text} onInput=${e => setText(e.target.value)}
        placeholder="Paste JSON response here..." />
      <div class="fnd-cal-paste-actions">
        <button class="btn-primary btn-sm" onClick=${() => { onSave(text); setOpen(false); setText(''); }}
          disabled=${!text.trim()}>${t('profile.calibrator.save')}</button>
        <button class="btn-ghost btn-sm" onClick=${() => { setOpen(false); setText(''); }}>${t('profile.calibrator.back')}</button>
      </div>
    </div>
  `;
}


// ── Collapsible Pre Block ──

function CollapsiblePre({ label, text }) {
  if (!text) return null;
  return html`
    <details class="fnd-cal-collapsible">
      <summary>${label}</summary>
      <div class="fnd-cal-run-detail">
        <pre>${text}</pre>
      </div>
    </details>
  `;
}


// ── BatchCard Component ──

export default function BatchCard({ batchSummary, index, projectId, project, currentVersion, onUpdate, showToast, autoRunAll }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [selectedOption, setSelectedOption] = useState('B');
  const [applyingFixes, setApplyingFixes] = useState(false);
  const [applyElapsed, setApplyElapsed] = useState(0);

  const hasReasoningModel = !!project?.reasoningLlm?.modelId;
  const candidates = project?.candidateModels || [];
  const hasVersion = !!currentVersion;

  // ── Data Loading ──

  const loadDetail = useCallback(async () => {
    const b = await getBatch(projectId, batchSummary.batchId);
    setDetail(b);
    return b;
  }, [projectId, batchSummary.batchId]);

  const toggleExpand = async () => {
    if (!expanded && !detail) await loadDetail();
    setExpanded(!expanded);
  };

  // ── Auto-run on mount ──

  const autoRunTriggered = useState(false);
  useEffect(() => {
    if (autoRunAll && !autoRunTriggered[0] && !running) {
      autoRunTriggered[1](true);
      (async () => {
        setExpanded(true);
        const d = await loadDetail();
        if (!d) { console.error('autoRunAll: failed to load batch detail'); return; }
        setDetail(d);
        await handleRunAllSteps(d);
      })();
    }
  }, [autoRunAll]);

  // ── Step 1: Generate ──

  async function handleStep1(batchDetail, chain) {
    let d = batchDetail || detail;
    if (!d || !currentVersion) return null;
    if (!chain) setRunning(true);

    const models = [...(d.models || [])];
    setProgress(`${t('profile.calibrator.step1')}: ${t('profile.calibrator.generating')} — ${models.length} ${t('profile.calibrator.models')} (parallel)...`);

    // Run all models in parallel
    const results = await Promise.allSettled(models.map(async (m) => {
      const copy = { ...m };
      const candidate = candidates.find(c => c.id === copy.modelId);
      if (!candidate || !candidate.modelId) {
        copy.step1_generation = { status: 'error', output: null, durationMs: 0, error: 'No matching candidate model found', promptSent: currentVersion.prompt };
      } else {
        const start = Date.now();
        try {
          // Step 1: Generation — use model's configured temperature, or default 0.3
          const output = await callModel(projectId, currentVersion.prompt, candidate.modelId, { temperature: candidate.temperature ?? 0.3, top_p: candidate.top_p, max_tokens: candidate.max_tokens });
          copy.step1_generation = { status: 'done', output, durationMs: Date.now() - start, error: null, promptSent: currentVersion.prompt };
        } catch (e) {
          copy.step1_generation = { status: 'error', output: null, durationMs: Date.now() - start, error: e.message, promptSent: currentVersion.prompt };
        }
      }
      copy.step2_analysis = { ...PENDING_ANALYSIS };
      copy.step3_reflection = { ...PENDING_REFLECTION };
      return copy;
    }));

    const updatedModels = results.map((r, i) => r.status === 'fulfilled' ? r.value : models[i]);
    const updated = await updateBatch(projectId, d.batchId, { models: updatedModels, status: 'generated', step4_synthesis: { ...PENDING_SYNTHESIS } });
    const result = updated || { ...d, models: updatedModels, status: 'generated', step4_synthesis: { ...PENDING_SYNTHESIS } };
    setDetail(result);
    if (!chain) { setRunning(false); setProgress(''); }
    onUpdate?.();
    return result;
  }

  // ── Step 2: Analyze ──

  async function handleStep2(batchDetail, chain) {
    let d = batchDetail || detail;
    if (!d || !hasReasoningModel || !currentVersion) return null;
    if (!chain) setRunning(true);

    const models = [...(d.models || [])];
    const eligible = models.filter(m => m.step1_generation?.status === 'done');
    setProgress(`${t('profile.calibrator.step2')}: ${t('profile.calibrator.analyzing')} — ${eligible.length} ${t('profile.calibrator.models')} (parallel)...`);

    // Run analysis in parallel for all models that have Step 1 output
    const results = await Promise.allSettled(models.map(async (m) => {
      const copy = { ...m };
      if (copy.step1_generation?.status !== 'done') return copy;

      const composed = (project.analysisPromptTemplate || '')
        .replace(/\{TARGET_OUTPUT\}/g, currentVersion.targetOutput || '')
        .replace(/\{CANDIDATE_OUTPUT\}/g, copy.step1_generation.output || '')
        .replace(/\{MODEL_NAME\}/g, copy.modelLabel || '')
        .replace(/\{PROMPT_USED\}/g, currentVersion.prompt || '');

      try {
        // Step 2: Analysis — deterministic, follow analysis template strictly
        const raw = await callModel(projectId, composed, project.reasoningLlm.modelId, { temperature: 0.1 });
        const parsed = extractJson(raw);
        const dims = parsed?.dimensions || [];
        const score = computeWeightedScore(dims);
        copy.step2_analysis = { status: 'done', dimensions: dims, overallScore: score, analysis: parsed?.analysis || raw, error: null, promptSent: composed, rawResponse: raw };
      } catch (e) {
        copy.step2_analysis = { status: 'error', dimensions: [], overallScore: null, analysis: null, error: e.message, promptSent: composed, rawResponse: null };
      }
      copy.step3_reflection = { ...PENDING_REFLECTION };
      return copy;
    }));

    const updatedModels = results.map((r, i) => r.status === 'fulfilled' ? r.value : models[i]);
    const updated = await updateBatch(projectId, d.batchId, { models: updatedModels, status: 'analyzed', step4_synthesis: { ...PENDING_SYNTHESIS } });
    const result = updated || { ...d, models: updatedModels, status: 'analyzed', step4_synthesis: { ...PENDING_SYNTHESIS } };
    setDetail(result);
    if (!chain) { setRunning(false); setProgress(''); }
    onUpdate?.();
    return result;
  }

  // ── Step 3: Reflect (judge + self) ──

  async function handleStep3(batchDetail, chain) {
    let d = batchDetail || detail;
    if (!d || !hasReasoningModel || !currentVersion) return null;
    if (!chain) setRunning(true);

    const models = [...(d.models || [])];
    let reflected = 0;
    for (let i = 0; i < models.length; i++) {
      const m = { ...models[i] };
      if (m.step2_analysis?.status !== 'done') continue;
      reflected++;
      const candidate = candidates.find(c => c.id === m.modelId);

      // 3a: Judge reflection
      setProgress(`${t('profile.calibrator.step3')}: ${t('profile.calibrator.judgeReflecting')} — ${m.modelLabel} (${reflected}/${models.length})...`);
      const judgeComposed = (project.reflectionPromptTemplate || '')
        .replace(/\{PROMPT_USED\}/g, currentVersion.prompt || '')
        .replace(/\{TARGET_OUTPUT\}/g, currentVersion.targetOutput || '')
        .replace(/\{CANDIDATE_OUTPUT\}/g, m.step1_generation?.output || '')
        .replace(/\{MODEL_NAME\}/g, m.modelLabel || '')
        .replace(/\{ANALYSIS_TEXT\}/g, typeof m.step2_analysis.analysis === 'string' ? m.step2_analysis.analysis : JSON.stringify(m.step2_analysis.analysis || '', null, 2));

      let judgeProposals;
      try {
        // Step 3a: Judge reflection — focused proposals, low randomness
        const raw = await callModel(projectId, judgeComposed, project.reasoningLlm.modelId, { temperature: 0.2 });
        const parsed = extractJson(raw);
        judgeProposals = { proposals: parsed?.proposals || [], reasoning: parsed?.reasoning || raw, promptSent: judgeComposed, rawResponse: raw };
      } catch (e) {
        judgeProposals = { proposals: [], reasoning: '', error: e.message, promptSent: judgeComposed, rawResponse: null };
      }

      // 3b: Self-reflection (send to candidate model itself)
      setProgress(`${t('profile.calibrator.step3')}: ${t('profile.calibrator.selfReflecting')} — ${m.modelLabel} (${reflected}/${models.length})...`);
      const selfComposed = (project.selfReflectionPromptTemplate || '')
        .replace(/\{PROMPT_USED\}/g, currentVersion.prompt || '')
        .replace(/\{TARGET_OUTPUT\}/g, currentVersion.targetOutput || '')
        .replace(/\{CANDIDATE_OUTPUT\}/g, m.step1_generation?.output || '')
        .replace(/\{MODEL_NAME\}/g, m.modelLabel || '')
        .replace(/\{ANALYSIS_TEXT\}/g, typeof m.step2_analysis.analysis === 'string' ? m.step2_analysis.analysis : JSON.stringify(m.step2_analysis.analysis || '', null, 2));

      let selfProposals;
      const selfModelId = candidate?.modelId || project.reasoningLlm.modelId;
      try {
        // Step 3b: Self-reflection — candidate reflects on own output
        const raw = await callModel(projectId, selfComposed, selfModelId, { temperature: 0.2 });
        const parsed = extractJson(raw);
        selfProposals = { proposals: parsed?.proposals || [], reasoning: parsed?.reasoning || raw, promptSent: selfComposed, rawResponse: raw };
      } catch (e) {
        selfProposals = { proposals: [], reasoning: '', error: e.message, promptSent: selfComposed, rawResponse: null };
      }

      m.step3_reflection = { status: 'done', judgeProposals, selfProposals, error: null };
      models[i] = m;
    }

    const updated = await updateBatch(projectId, d.batchId, { models, status: 'reflected', step4_synthesis: { ...PENDING_SYNTHESIS } });
    const result = updated || { ...d, models, status: 'reflected', step4_synthesis: { ...PENDING_SYNTHESIS } };
    setDetail(result);
    if (!chain) { setRunning(false); setProgress(''); }
    onUpdate?.();
    return result;
  }

  // ── Step 4: Synthesize ──

  async function handleStep4(batchDetail, chain) {
    let d = batchDetail || detail;
    if (!d || !hasReasoningModel || !currentVersion) return null;
    if (!chain) setRunning(true);
    setProgress(`${t('profile.calibrator.step4')}: ${t('profile.calibrator.synthesizing')}...`);

    // Collect all proposals from all models
    const judgeBlocks = [];
    const selfBlocks = [];
    for (const m of (d.models || [])) {
      if (m.step3_reflection?.status !== 'done') continue;
      const jp = m.step3_reflection.judgeProposals?.proposals || [];
      if (jp.length) judgeBlocks.push(`[${m.modelLabel}]\n${jp.map((p, i) => `${i + 1}. ${typeof p === 'string' ? p : p.text || JSON.stringify(p)}`).join('\n')}`);
      const sp = m.step3_reflection.selfProposals?.proposals || [];
      if (sp.length) selfBlocks.push(`[${m.modelLabel}]\n${sp.map((p, i) => `${i + 1}. ${typeof p === 'string' ? p : p.text || JSON.stringify(p)}`).join('\n')}`);
    }

    const composed = (project.synthesisPromptTemplate || '')
      .replace(/\{PROMPT_USED\}/g, currentVersion.prompt || '')
      .replace(/\{JUDGE_PROPOSALS\}/g, judgeBlocks.join('\n\n') || '(none)')
      .replace(/\{CANDIDATE_PROPOSALS\}/g, selfBlocks.join('\n\n') || '(none)');

    let synthesis;
    try {
      // Step 4: Synthesis — deterministic grouping and scoring
      const raw = await callModel(projectId, composed, project.reasoningLlm.modelId, { temperature: 0.1 });
      const parsed = extractJson(raw);
      synthesis = {
        status: 'done',
        groupedProposals: parsed?.groupedProposals || parsed?.proposals || [],
        options: parsed?.options || null,
        recommendation: parsed?.recommendation || '',
        analysis: parsed?.analysis || raw,
        error: null,
        promptSent: composed,
        rawResponse: raw,
      };
    } catch (e) {
      synthesis = { ...PENDING_SYNTHESIS, status: 'error', error: e.message, promptSent: composed };
    }

    // Always include models in the final update so batch list shows correct scores
    const updated = await updateBatch(projectId, d.batchId, { models: d.models, status: 'synthesized', step4_synthesis: synthesis });
    const result = updated || { ...d, status: 'synthesized', step4_synthesis: synthesis };
    setDetail(result);
    if (!chain) { setRunning(false); setProgress(''); }
    onUpdate?.();
    return result;
  }

  // ── Run All Steps ──

  async function handleRunAllSteps(batchDetail) {
    let d = batchDetail || detail;
    setRunning(true);
    try {
      d = await handleStep1(d, true);
      if (!d) return;
      d = await handleStep2(d, true);
      if (!d) return;
      d = await handleStep3(d, true);
      if (!d) return;
      await handleStep4(d, true);
    } catch (e) {
      showToast?.(e.message, true);
    }
    setRunning(false);
    setProgress('');
  }

  // ── Apply Selected Proposals ──

  async function handleApplySelected() {
    const synth = detail?.step4_synthesis;
    if (!synth?.options || !hasReasoningModel) return;

    // Use the prompt from the batch's own version, not the parent's currently selected version
    const batchVersion = detail?.promptVersion || batchSummary?.promptVersion;
    let batchPrompt = currentVersion?.prompt || '';
    if (batchVersion) {
      try {
        const { getVersion } = await import('/js/services/calibrator.js');
        const ver = await getVersion(projectId, batchVersion);
        if (ver?.prompt) batchPrompt = ver.prompt;
      } catch { /* best effort — fall through to the no-prompt guard below */ }
    }
    if (!batchPrompt) { showToast?.('Could not load prompt for this batch\'s version', true); return; }

    const opt = synth.options[selectedOption] || synth.options.B || synth.options.A;
    if (!opt) { showToast?.('No option found', true); return; }

    const proposalIds = opt.proposalIds || opt.proposals || [];
    const allProposals = synth.groupedProposals || [];
    const selectedProposals = proposalIds.map(id => {
      // proposalIds are array indices into groupedProposals
      const p = typeof id === 'number' ? allProposals[id] : allProposals.find(gp => gp.id === id || gp.proposalId === id);
      return p ? (p.text || p.proposal || JSON.stringify(p)) : null;
    }).filter(Boolean);

    if (!selectedProposals.length) { showToast?.('No proposals in selected option', true); return; }

    const applyPrompt = `YOU ARE A PROMPT EDITOR. Your job is to MODIFY AN INSTRUCTION PROMPT — not to follow it, not to generate output from it.

TASK: Apply the proposed fixes below to the instruction prompt below. Return the MODIFIED INSTRUCTION PROMPT.

CRITICAL RULES:
- You are editing the INSTRUCTIONS, not executing them
- The prompt below tells AI models what to do. You must IMPROVE those instructions.
- Do NOT generate the kind of output the prompt asks for (e.g., do NOT generate JSON blueprints, code, or data)
- Do NOT add project-specific terms, names, APIs, or domain concepts
- Each fix must be GENERIC — applicable to any prompt of this type
- Return ONLY the full modified instruction prompt text
- No explanations, no markdown fences, no commentary before or after

═══ THE INSTRUCTION PROMPT TO MODIFY (start) ═══
${batchPrompt}
═══ THE INSTRUCTION PROMPT TO MODIFY (end) ═══

═══ FIXES TO APPLY ═══
${selectedProposals.map((p, i) => `${i + 1}. ${p}`).join('\n')}
═══ END FIXES ═══

Now return the full modified instruction prompt with the fixes incorporated. Remember: you are returning INSTRUCTIONS, not the output those instructions would produce.`;

    setApplyingFixes(true);
    setApplyElapsed(0);
    const applyStart = Date.now();
    const applyTimer = setInterval(() => setApplyElapsed(Math.floor((Date.now() - applyStart) / 1000)), 1000);
    try {
      // Apply: precise instruction following, minimal creativity
      const improved = await callModel(projectId, applyPrompt, project.reasoningLlm.modelId, { temperature: 0.1 });
      const trimmed = (improved || '').trim();
      const elapsed = ((Date.now() - applyStart) / 1000).toFixed(0);
      if (!trimmed || trimmed.length < 100) {
        showToast?.(`Model returned empty or too-short response after ${elapsed}s. The model may have timed out — try again or use a more capable reasoning model.`, true);
        clearInterval(applyTimer); setApplyingFixes(false);
        return;
      }
      // Sanity check: if the result is ONLY a JSON object (no text before/after), it's likely wrong
      // But prompts that contain JSON examples are fine — only reject pure JSON with no instructions
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed.architecture) {
          showToast?.(`Model returned blueprint JSON instead of a modified prompt (${elapsed}s). Try again.`, true);
          clearInterval(applyTimer); setApplyingFixes(false);
          return;
        }
      } catch { /* not pure JSON — good, it's a prompt */ }
      await createVersion(projectId, {
        prompt: trimmed,
        targetOutput: currentVersion.targetOutput || '',
        changelog: `Applied ${selectedProposals.length} proposals (option ${selectedOption})`,
      });
      showToast?.(`New version created (${elapsed}s) — reload to see it in the version dropdown`);
      // Force full page reload so version dropdown and project state refresh
      setTimeout(() => onUpdate?.(), 500);
    } catch (e) {
      showToast?.(e.message, true);
    }
    clearInterval(applyTimer); setApplyingFixes(false);
  }

  // ── Copy prompt + selected proposals ──

  function handleCopyPromptAndProposals() {
    const synth = detail?.step4_synthesis;
    if (!synth?.options || !currentVersion) return;

    const opt = synth.options[selectedOption] || synth.options.B || synth.options.A;
    const proposalIds = opt?.proposalIds || opt?.proposals || [];
    const allProposals = synth.groupedProposals || [];
    const selectedProposals = proposalIds.map(id => {
      const p = allProposals.find(gp => gp.id === id || gp.proposalId === id);
      return p ? (p.text || p.proposal || JSON.stringify(p)) : id;
    }).filter(Boolean);

    const text = `Here is a prompt that needs improvement:\n\n---\n${currentVersion.prompt}\n---\n\nApply these proposed fixes:\n${selectedProposals.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nReturn ONLY the modified prompt text.`;
    copyToClipboard(text).then(() => showToast?.('Copied'));
  }

  // ── Paste handlers ──

  function handlePasteStep1(modelIndex, text) {
    if (!detail) return;
    const models = [...detail.models];
    models[modelIndex] = { ...models[modelIndex], step1_generation: { status: 'done', output: text, durationMs: 0, error: null, promptSent: null } };
    updateBatch(projectId, detail.batchId, { models }).then(u => { setDetail(u || { ...detail, models }); onUpdate?.(); });
  }

  function handlePasteStep2(modelIndex, text) {
    if (!detail) return;
    const parsed = extractJson(text);
    const dims = parsed?.dimensions || [];
    const score = computeWeightedScore(dims);
    const models = [...detail.models];
    models[modelIndex] = {
      ...models[modelIndex],
      step2_analysis: { status: 'done', dimensions: dims, overallScore: score, analysis: parsed?.analysis || text, error: null, promptSent: null, rawResponse: text },
    };
    updateBatch(projectId, detail.batchId, { models }).then(u => { setDetail(u || { ...detail, models }); onUpdate?.(); });
  }

  function handlePasteJudge(modelIndex, text) {
    if (!detail) return;
    const parsed = extractJson(text);
    const models = [...detail.models];
    const m = { ...models[modelIndex] };
    const existing = m.step3_reflection || { ...PENDING_REFLECTION };
    m.step3_reflection = {
      ...existing,
      status: existing.selfProposals ? 'done' : existing.status,
      judgeProposals: { proposals: parsed?.proposals || [], reasoning: parsed?.reasoning || text, promptSent: null, rawResponse: text },
    };
    if (m.step3_reflection.judgeProposals && m.step3_reflection.selfProposals) m.step3_reflection.status = 'done';
    models[modelIndex] = m;
    updateBatch(projectId, detail.batchId, { models }).then(u => { setDetail(u || { ...detail, models }); onUpdate?.(); });
  }

  function handlePasteSelf(modelIndex, text) {
    if (!detail) return;
    const parsed = extractJson(text);
    const models = [...detail.models];
    const m = { ...models[modelIndex] };
    const existing = m.step3_reflection || { ...PENDING_REFLECTION };
    m.step3_reflection = {
      ...existing,
      status: existing.judgeProposals ? 'done' : existing.status,
      selfProposals: { proposals: parsed?.proposals || [], reasoning: parsed?.reasoning || text, promptSent: null, rawResponse: text },
    };
    if (m.step3_reflection.judgeProposals && m.step3_reflection.selfProposals) m.step3_reflection.status = 'done';
    models[modelIndex] = m;
    updateBatch(projectId, detail.batchId, { models }).then(u => { setDetail(u || { ...detail, models }); onUpdate?.(); });
  }

  function handlePasteSynthesis(text) {
    if (!detail) return;
    const parsed = extractJson(text);
    const synth = {
      status: 'done',
      groupedProposals: parsed?.groupedProposals || parsed?.proposals || [],
      options: parsed?.options || null,
      recommendation: parsed?.recommendation || '',
      analysis: parsed?.analysis || text,
      error: null, promptSent: null, rawResponse: text,
    };
    updateBatch(projectId, detail.batchId, { status: 'synthesized', step4_synthesis: synth })
      .then(u => { setDetail(u || { ...detail, status: 'synthesized', step4_synthesis: synth }); onUpdate?.(); });
  }

  // ── Render: Step 1 (Generation) ──

  function renderStep1() {
    const models = detail?.models || [];
    const anyDone = models.some(m => m.step1_generation?.status === 'done');
    return html`
      <details class="fnd-cal-step" open=${anyDone}>
        <summary>${t('profile.calibrator.step1')}</summary>
        <div class="fnd-cal-step-body">
          ${models.map((m, i) => html`
            <div class="fnd-cal-step-model" key=${m.modelId}>
              <div class="fnd-cal-batch-meta">
                <strong>${m.modelLabel}</strong>
                ${m.step1_generation?.status === 'done' ? html`
                  <span class="fnd-cal-run-time">${formatDuration(m.step1_generation.durationMs)}</span>
                ` : ''}
                ${m.step1_generation?.status === 'error' ? html`
                  <span class="fnd-cal-run-score fail">${m.step1_generation.error}</span>
                ` : ''}
              </div>
              ${m.step1_generation?.output ? html`
                <${CollapsiblePre} label=${t('profile.calibrator.viewOutput')} text=${m.step1_generation.output} />
              ` : ''}
              ${m.step1_generation?.promptSent ? html`
                <${CollapsiblePre} label=${t('profile.calibrator.viewPromptSent')} text=${m.step1_generation.promptSent} />
              ` : ''}
              <div class="fnd-cal-run-actions">
                ${m.step1_generation?.output ? html`
                  <${CopyButton} text=${m.step1_generation.output} label=${t('profile.calibrator.copy')} className="btn-sm" onCopied=${() => showToast?.('Output copied')} />
                ` : ''}
                <${PasteBack} label=${t('profile.calibrator.pasteOutput')} onSave=${text => handlePasteStep1(i, text)} />
              </div>
            </div>
          `)}
          <div class="fnd-cal-step-actions">
            <button class="btn-primary btn-sm" onClick=${() => handleStep1()} disabled=${running || !hasVersion}>
              ${t('profile.calibrator.runStep1')}
            </button>
          </div>
        </div>
      </details>
    `;
  }

  // ── Render: Step 2 (Analysis) ──

  function renderStep2() {
    const models = detail?.models || [];
    const anyAnalyzed = models.some(m => m.step2_analysis?.status === 'done');
    const anyGenerated = models.some(m => m.step1_generation?.status === 'done');

    return html`
      <details class="fnd-cal-step" open=${anyAnalyzed}>
        <summary>${t('profile.calibrator.step2')}</summary>
        <div class="fnd-cal-step-body">
          ${!currentVersion?.targetOutput ? html`
            <div class="fnd-cal-warning">${t('profile.calibrator.noTargetWarning')}</div>
          ` : ''}
          ${models.filter(m => m.step1_generation?.status === 'done').map((m) => {
            const modelIndex = models.indexOf(m);
            const a = m.step2_analysis;
            return html`
              <div class="fnd-cal-step-model" key=${m.modelId}>
                <div class="fnd-cal-batch-meta">
                  <strong>${m.modelLabel}</strong>
                  ${a?.overallScore != null ? html`
                    <span class="fnd-cal-run-score ${scoreClass(a.overallScore)}">${a.overallScore}%</span>
                  ` : ''}
                  ${a?.status === 'error' ? html`
                    <span class="fnd-cal-run-score fail">${a.error}</span>
                  ` : ''}
                </div>
                ${a?.dimensions?.length > 0 ? html`
                  <table class="fnd-cal-dim-table">
                    <thead><tr>
                      <th></th><th>${t('profile.calibrator.dimensions')}</th><th>Expected</th><th>Actual</th><th>Severity</th>
                    </tr></thead>
                    <tbody>
                      ${a.dimensions.map(d2 => html`
                        <tr>
                          <td><span class="fnd-cal-dim-badge ${d2.pass ? 'pass' : 'fail'}">${d2.pass ? '\u2713' : '\u2717'}</span></td>
                          <td>${d2.name}</td>
                          <td>${d2.expected || ''}</td>
                          <td>${d2.actual || ''}</td>
                          <td>${d2.severity || ''}</td>
                        </tr>
                      `)}
                    </tbody>
                  </table>
                ` : ''}
                ${a?.analysis ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewAnalysis')} text=${typeof a.analysis === 'string' ? a.analysis : JSON.stringify(a.analysis, null, 2)} />` : ''}
                ${a?.promptSent ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewPromptSent')} text=${a.promptSent} />` : ''}
                ${a?.rawResponse ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewRawResponse')} text=${a.rawResponse} />` : ''}
                <div class="fnd-cal-run-actions">
                  ${a?.analysis ? html`
                    <${CopyButton} text=${typeof a.analysis === 'string' ? a.analysis : JSON.stringify(a.analysis, null, 2)} label=${t('profile.calibrator.copy')} className="btn-sm" onCopied=${() => showToast?.('Analysis copied')} />
                  ` : ''}
                  <${PasteBack} label=${t('profile.calibrator.pasteAnalysis')} onSave=${text => handlePasteStep2(modelIndex, text)} />
                </div>
              </div>
            `;
          })}
          <div class="fnd-cal-step-actions">
            <button class="btn-primary btn-sm" onClick=${() => handleStep2()} disabled=${running || !hasReasoningModel || !anyGenerated}>
              ${t('profile.calibrator.runStep2')}
            </button>
            ${!hasReasoningModel ? html`<span class="fnd-cal-hint">${t('profile.calibrator.setReasoningModel')}</span>` : ''}
          </div>
        </div>
      </details>
    `;
  }

  // ── Render: Step 3 (Reflection — dual columns) ──

  function renderStep3() {
    const models = detail?.models || [];
    const anyReflected = models.some(m => m.step3_reflection?.status === 'done');
    const anyAnalyzed = models.some(m => m.step2_analysis?.status === 'done');

    return html`
      <details class="fnd-cal-step" open=${anyReflected}>
        <summary>${t('profile.calibrator.step3')}</summary>
        <div class="fnd-cal-step-body">
          ${models.filter(m => m.step2_analysis?.status === 'done').map((m) => {
            const modelIndex = models.indexOf(m);
            const r = m.step3_reflection;
            const jp = r?.judgeProposals;
            const sp = r?.selfProposals;
            return html`
              <div class="fnd-cal-step-model" key=${m.modelId}>
                <div class="fnd-cal-batch-meta">
                  <strong>${m.modelLabel}</strong>
                  ${r?.status === 'done' && (jp?.proposals?.length || sp?.proposals?.length)
                    ? html`<span class="fnd-cal-run-score pass">${(jp?.proposals?.length || 0) + (sp?.proposals?.length || 0)} proposals</span>`
                    : r?.status === 'done' ? html`<span class="fnd-cal-run-score mixed">no proposals</span>` : ''}
                  ${r?.error ? html`<span class="fnd-cal-run-score fail">${r.error}</span>` : ''}
                </div>
                <div class="fnd-cal-reflection-cols">
                  <!-- Judge column -->
                  <div class="fnd-cal-reflection-col">
                    <h4>${t('profile.calibrator.step3a')}</h4>
                    ${jp?.error ? html`<div class="fnd-cal-hint" style="color:var(--danger)">Error: ${jp.error}</div>` : ''}
                    ${jp?.proposals?.length > 0 ? html`
                      <ol>
                        ${jp.proposals.map(p => html`<li>${typeof p === 'string' ? p : p.text || JSON.stringify(p)}</li>`)}
                      </ol>
                    ` : !jp?.error ? html`<div class="fnd-cal-hint">No proposals</div>` : ''}
                    ${jp?.reasoning ? html`<div class="fnd-cal-hint">${jp.reasoning}</div>` : ''}
                    ${jp?.promptSent ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewPromptSent')} text=${jp.promptSent} />` : ''}
                    ${jp?.rawResponse ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewRawResponse')} text=${jp.rawResponse} />` : ''}
                    <${PasteBack} label=${t('profile.calibrator.pasteJudgeProposals')} onSave=${text => handlePasteJudge(modelIndex, text)} />
                  </div>
                  <!-- Self column -->
                  <div class="fnd-cal-reflection-col">
                    <h4>${t('profile.calibrator.step3b')}</h4>
                    ${sp?.error ? html`<div class="fnd-cal-hint" style="color:var(--danger)">Error: ${sp.error}</div>` : ''}
                    ${sp?.proposals?.length > 0 ? html`
                      <ol>
                        ${sp.proposals.map(p => html`<li>${typeof p === 'string' ? p : p.text || JSON.stringify(p)}</li>`)}
                      </ol>
                    ` : !sp?.error ? html`<div class="fnd-cal-hint">No proposals</div>` : ''}
                    ${sp?.reasoning ? html`<div class="fnd-cal-hint">${sp.reasoning}</div>` : ''}
                    ${sp?.promptSent ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewPromptSent')} text=${sp.promptSent} />` : ''}
                    ${sp?.rawResponse ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewRawResponse')} text=${sp.rawResponse} />` : ''}
                    <${PasteBack} label=${t('profile.calibrator.pasteSelfProposals')} onSave=${text => handlePasteSelf(modelIndex, text)} />
                  </div>
                </div>
              </div>
            `;
          })}
          <div class="fnd-cal-step-actions">
            <button class="btn-primary btn-sm" onClick=${() => handleStep3()} disabled=${running || !hasReasoningModel || !anyAnalyzed}>
              ${t('profile.calibrator.runStep3')}
            </button>
            ${!hasReasoningModel ? html`<span class="fnd-cal-hint">${t('profile.calibrator.setReasoningModel')}</span>` : ''}
          </div>
        </div>
      </details>
    `;
  }

  // ── Render: Step 4 (Synthesis) ──

  function renderStep4() {
    const models = detail?.models || [];
    const anyReflected = models.some(m => m.step3_reflection?.status === 'done');
    const synth = detail?.step4_synthesis;
    const hasSynthesis = synth?.status === 'done';

    return html`
      <details class="fnd-cal-step" open=${hasSynthesis}>
        <summary>${t('profile.calibrator.step4')}</summary>
        <div class="fnd-cal-step-body">
          ${synth?.error ? html`<div class="fnd-cal-warning" style="color:var(--danger)">Error: ${synth.error}</div>` : ''}
          ${synth?.status === 'error' && synth?.analysis ? html`<div class="fnd-cal-hint" style="color:var(--danger)">${synth.analysis}</div>` : ''}

          <!-- Grouped proposals -->
          ${synth?.groupedProposals?.length > 0 ? html`
            <div class="fnd-cal-synthesis">
              <div class="fnd-cal-editor-label">${t('profile.calibrator.groupedProposals')}</div>
              ${synth.groupedProposals.map((gp, i) => html`
                <div class="fnd-cal-proposal-card" key=${gp.id || i}>
                  <div>${gp.text || gp.proposal || JSON.stringify(gp)}</div>
                  ${gp.sources ? html`<div class="fnd-cal-proposal-sources">${t('profile.calibrator.overlap')}: ${Array.isArray(gp.sources) ? gp.sources.join(', ') : gp.sources}</div>` : ''}
                  ${gp.overlap ? html`<span class="fnd-cal-dim-badge ${gp.overlap > 1 ? 'pass' : 'fail'}">${t('profile.calibrator.overlap')}: ${gp.overlap}</span> ` : ''}
                  ${gp.impact ? html`<span class="fnd-cal-proposal-impact ${gp.impact}">${t('profile.calibrator.impact')}: ${gp.impact}</span>` : ''}
                </div>
              `)}
            </div>
          ` : ''}

          <!-- Options A/B/C -->
          ${synth?.options ? html`
            <div class="fnd-cal-options">
              ${['A', 'B', 'C'].map(key => {
                const opt = synth.options[key];
                if (!opt) return null;
                return html`
                  <div class="fnd-cal-option ${selectedOption === key ? 'selected' : ''}"
                    onClick=${() => setSelectedOption(key)}>
                    <input type="radio" name="synth-option" value=${key}
                      checked=${selectedOption === key}
                      onChange=${() => setSelectedOption(key)} />
                    <div>
                      <div class="fnd-cal-option-label">${t('profile.calibrator.option' + key)}</div>
                      ${opt.description ? html`<div class="fnd-cal-option-impact">${opt.description}</div>` : ''}
                      ${opt.proposalIds ? html`<div class="fnd-cal-option-impact">${opt.proposalIds.length} ${t('profile.calibrator.proposals')}</div>` : ''}
                    </div>
                  </div>
                `;
              })}
            </div>
          ` : ''}

          <!-- Recommendation -->
          ${synth?.recommendation ? html`
            <div class="fnd-cal-recommendation">
              <strong>${t('profile.calibrator.recommendation')}:</strong> ${synth.recommendation}
            </div>
          ` : ''}

          <!-- Apply / Copy actions -->
          ${hasSynthesis && synth?.options ? html`
            <div class="fnd-cal-step-actions">
              <button class="btn-primary btn-sm" onClick=${handleApplySelected}
                disabled=${applyingFixes || !hasReasoningModel}>
                ${applyingFixes ? t('profile.calibrator.applyingFixes') : t('profile.calibrator.applySelected')}
              </button>
              <button class="btn-ghost btn-sm" onClick=${handleCopyPromptAndProposals}>
                ${t('profile.calibrator.copyPromptAndProposals')}
              </button>
            </div>
            ${applyingFixes ? html`
              <div class="fnd-cal-progress">
                ${t('profile.calibrator.applyingFixes')} ${applyElapsed}s — ${applyElapsed > 30 ? 'Large prompts take time. Do not close the browser.' : 'Rewriting prompt with selected proposals...'}
              </div>
            ` : ''}
          ` : ''}

          <!-- Collapsible prompt/response -->
          ${synth?.promptSent ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewPromptSent')} text=${synth.promptSent} />` : ''}
          ${synth?.rawResponse ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewRawResponse')} text=${synth.rawResponse} />` : ''}
          <${PasteBack} label=${t('profile.calibrator.pasteSynthesis')} onSave=${handlePasteSynthesis} />

          <!-- Run button -->
          <div class="fnd-cal-step-actions">
            <button class="btn-primary btn-sm" onClick=${() => handleStep4()} disabled=${running || !hasReasoningModel || !anyReflected}>
              ${t('profile.calibrator.runStep4')}
            </button>
            ${!hasReasoningModel ? html`<span class="fnd-cal-hint">${t('profile.calibrator.setReasoningModel')}</span>` : ''}
          </div>
        </div>
      </details>
    `;
  }

  // ── Main Render ──

  const b = batchSummary;
  const status = detail?.status || b.status || 'pending';
  const scores = b.scores || [];

  return html`
    <div class="fnd-cal-batch">
      <div class="fnd-cal-batch-header" onClick=${toggleExpand}>
        <div class="fnd-cal-batch-meta">
          <strong>${t('profile.calibrator.batch')} #${index}</strong>
          <span>v${b.promptVersion}</span>
          <span>${new Date(b.createdAt).toLocaleString()}</span>
        </div>
        <div class="fnd-cal-batch-meta">
          <span>${t('profile.calibrator.batchStatus')}: ${status}</span>
          <span>${b.modelCount || scores.length} ${t('profile.calibrator.models')}</span>
        </div>
        <div class="fnd-cal-batch-scores">
          ${scores.map(s => html`
            <span class="fnd-cal-run-score ${scoreClass(s.overallScore)}" key=${s.modelId}>
              ${s.modelLabel} ${s.overallScore != null ? s.overallScore + '%' : '—'}
            </span>
          `)}
        </div>
      </div>

      ${running ? html`<div class="fnd-cal-progress">${progress}</div>` : ''}

      ${expanded && detail ? html`
        <div class="fnd-cal-batch-detail">
          ${renderStep1()}
          ${renderStep2()}
          ${renderStep3()}
          ${renderStep4()}
        </div>
      ` : ''}
    </div>
  `;
}
