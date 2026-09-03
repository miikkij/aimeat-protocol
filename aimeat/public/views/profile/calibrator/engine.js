/**
 * @file public/views/profile/calibrator/engine.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four steps of a calibration run and what they say to the models. Step 1: every
 *   candidate answers the prompt. Step 2: the judge compares each answer with the target output,
 *   checkpoint by checkpoint, and scores it (critical 3, major 2, minor 1). Step 3: the judge and
 *   the candidate itself propose corrections to the prompt. Step 4: the judge groups the proposals
 *   into three options. Applying an option writes the next version of the prompt. The same
 *   composers feed the copy-this-step's-prompt road, and the paste-back readers turn an answer
 *   brought back by hand into the same record the model call would have written. Every call goes
 *   through POST /v1/openrouter/complete, under the calibration's own name in the usage table.
 * @structure computeWeightedScore · extractJson · callModel · compose* · runStep1..4 · runAll ·
 *   optionProposals · applyOption · stepPrompts · pasteInto · PENDING_*
 * @usage import { runAll, stepPrompts, pasteInto } from './engine.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial; the step logic lifted from calibrator-batch.js v1.1.0 and
 *     calibrator-batch.helpers.js v1.0.0, with the judge resolved by role when the calibration has
 *     no judge of its own.
 */
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { authHeaders } from '/js/services/auth.js';
import { updateBatch, createVersion } from '/js/services/calibrator.js';

const x = (key, vars) => t('calpage.' + key, vars);

export const PENDING_GENERATION = { status: 'pending', output: null, durationMs: null, error: null, promptSent: null };
export const PENDING_ANALYSIS = { status: 'pending', dimensions: [], overallScore: null, analysis: null, error: null, promptSent: null, rawResponse: null };
export const PENDING_REFLECTION = { status: 'pending', judgeProposals: null, selfProposals: null, error: null };
export const PENDING_SYNTHESIS = { status: 'pending', groupedProposals: [], options: null, recommendation: null, analysis: null, error: null, promptSent: null, rawResponse: null };

/** The weighted share of checkpoints that passed: critical 3, major 2, minor 1. 0-100, or null. */
export function computeWeightedScore(dims) {
  if (!dims || dims.length === 0) return null;
  const weights = { critical: 3, major: 2, minor: 1 };
  let total = 0, passed = 0;
  for (const d of dims) {
    const w = weights[d.severity] || 1;
    total += w;
    if (d.pass) passed += w;
  }
  return total > 0 ? Math.round((passed / total) * 100) : null;
}

/** The first {...} block a model wrapped its JSON answer in, parsed; null when there is none. */
export function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }   // eslint-disable-line aimeat/no-silent-catch -- text that is not JSON IS the answer
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One completion through the owner's key. `model` names a model outright; `modelRole` lets the
 * server pick the model the owner set for that role on the AI page. Retries once on a gateway
 * error or an empty answer; gives up after thirty minutes.
 * @param {string} projectId
 * @param {string} prompt
 * @param {{ model?: string, modelRole?: string, temperature?: number, top_p?: number, max_tokens?: number, retries?: number }} [opts]
 */
export async function callModel(projectId, prompt, opts = {}) {
  const { model, modelRole, temperature, top_p, max_tokens, retries = 1 } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1_800_000);
    try {
      const body = { projectId, prompt };
      if (model) body.model = model; else if (modelRole) body.modelRole = modelRole;
      if (temperature !== undefined) body.temperature = temperature;
      if (top_p !== undefined) body.top_p = top_p;
      if (max_tokens !== undefined) body.max_tokens = max_tokens;
      const raw = await fetch('/v1/openrouter/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (!raw.ok) {
        let msg = `HTTP ${raw.status}`;
        try { const e = await raw.json(); msg = e.error?.message || msg; } catch (err) { swallowed('calibrator engine: error body', err); }
        if (attempt < retries && (raw.status === 502 || raw.status === 503 || raw.status === 429)) { await wait(3000); continue; }
        throw new Error(msg);
      }
      const resp = await raw.json();
      if (resp.ok === false) throw new Error(resp.error?.message || x('errProvider'));
      const content = resp.data?.content || '';
      if (!content && attempt < retries) { await wait(3000); continue; }
      if (!content) throw new Error(x('errEmpty', { model: resp.data?.model || model || '' }));
      return content;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(x('errTimeout'), { cause: e });
      if (attempt < retries && e.name === 'TypeError') { await wait(3000); continue; }
      throw e;
    } finally { clearTimeout(timeoutId); }
  }
  throw new Error(x('errProvider'));
}

/* ── What each step says to the model ─────────────────────────────────────────────────────────── */

const fill = (template, pairs) => Object.entries(pairs).reduce((s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), v ?? ''), String(template || ''));
const analysisText = (m) => (typeof m.step2_analysis?.analysis === 'string' ? m.step2_analysis.analysis : JSON.stringify(m.step2_analysis?.analysis || '', null, 2));

export const composeAnalysis = (project, version, m) => fill(project.analysisPromptTemplate, {
  TARGET_OUTPUT: version.targetOutput, CANDIDATE_OUTPUT: m.step1_generation?.output, MODEL_NAME: m.modelLabel, PROMPT_USED: version.prompt,
});
const reflectionPairs = (version, m) => ({
  PROMPT_USED: version.prompt, TARGET_OUTPUT: version.targetOutput, CANDIDATE_OUTPUT: m.step1_generation?.output, MODEL_NAME: m.modelLabel, ANALYSIS_TEXT: analysisText(m),
});
export const composeReflection = (project, version, m) => fill(project.reflectionPromptTemplate, reflectionPairs(version, m));
export const composeSelf = (project, version, m) => fill(project.selfReflectionPromptTemplate, reflectionPairs(version, m));

const proposalText = (p) => (typeof p === 'string' ? p : p?.text || p?.proposal || JSON.stringify(p));
const block = (label, list) => `[${label}]\n${list.map((p, i) => `${i + 1}. ${proposalText(p)}`).join('\n')}`;

export function composeSynthesis(project, version, batch) {
  const judge = [], self = [];
  for (const m of batch?.models || []) {
    if (m.step3_reflection?.status !== 'done') continue;
    const jp = m.step3_reflection.judgeProposals?.proposals || [];
    if (jp.length) judge.push(block(m.modelLabel, jp));
    const sp = m.step3_reflection.selfProposals?.proposals || [];
    if (sp.length) self.push(block(m.modelLabel, sp));
  }
  return fill(project.synthesisPromptTemplate, { PROMPT_USED: version.prompt, JUDGE_PROPOSALS: judge.join('\n\n') || '(none)', CANDIDATE_PROPOSALS: self.join('\n\n') || '(none)' });
}

/** The prompt that turns a set of proposals into the next version. English on purpose: it is read by a model. */
export function composeApply(prompt, proposals) {
  return `YOU ARE A PROMPT EDITOR. Your job is to MODIFY AN INSTRUCTION PROMPT — not to follow it, not to generate output from it.

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
${prompt}
═══ THE INSTRUCTION PROMPT TO MODIFY (end) ═══

═══ FIXES TO APPLY ═══
${proposals.map((p, i) => `${i + 1}. ${p}`).join('\n')}
═══ END FIXES ═══

Now return the full modified instruction prompt with the fixes incorporated. Remember: you are returning INSTRUCTIONS, not the output those instructions would produce.`;
}

/** The proposals one option (A, B or C) of a synthesis selects, as text. */
export function optionProposals(synth, key) {
  const opt = synth?.options?.[key];
  if (!opt) return [];
  const all = synth.groupedProposals || [];
  const ids = opt.proposalIds || opt.proposals || [];
  return ids.map((id) => {
    const p = typeof id === 'number' ? all[id] : all.find((gp) => gp.id === id || gp.proposalId === id);
    return p ? proposalText(p) : null;
  }).filter(Boolean);
}

/* ── The steps ────────────────────────────────────────────────────────────────────────────────── */

/** The judge's call: the calibration's own model, or the AI page's reasoning role. */
const judgeCall = (ctx, temperature) => (ctx.judge?.own && ctx.judge.modelId ? { model: ctx.judge.modelId, temperature } : { modelRole: 'reasoning', temperature });
const hasJudge = (ctx) => !!(ctx.judge && (ctx.judge.own ? ctx.judge.modelId : true));
const say = (ctx, text) => { try { ctx.onProgress?.(text); } catch (err) { swallowed('calibrator engine: progress', err); } };

async function persist(ctx, batch, patch) {
  const next = { ...batch, ...patch };
  const saved = (await updateBatch(ctx.projectId, batch.batchId, patch)) || next;
  try { ctx.onBatch?.(saved); } catch (err) { swallowed('calibrator engine: onBatch', err); }
  return saved;
}

export async function runStep1(ctx, batch) {
  const models = [...(batch.models || [])];
  say(ctx, x('progress.generate', { n: models.length }));
  const results = await Promise.allSettled(models.map(async (m) => {
    const copy = { ...m };
    const candidate = (ctx.project.candidateModels || []).find((c) => c.id === copy.modelId);
    if (!candidate || !candidate.modelId) {
      copy.step1_generation = { status: 'error', output: null, durationMs: 0, error: x('errNoCandidate'), promptSent: ctx.version.prompt };
    } else {
      const start = Date.now();
      try {
        const output = await callModel(ctx.projectId, ctx.version.prompt, { model: candidate.modelId, temperature: candidate.temperature ?? 0.3, top_p: candidate.top_p, max_tokens: candidate.max_tokens });
        copy.step1_generation = { status: 'done', output, durationMs: Date.now() - start, error: null, promptSent: ctx.version.prompt };
      } catch (e) {
        copy.step1_generation = { status: 'error', output: null, durationMs: Date.now() - start, error: e.message, promptSent: ctx.version.prompt };
      }
    }
    copy.step2_analysis = { ...PENDING_ANALYSIS };
    copy.step3_reflection = { ...PENDING_REFLECTION };
    return copy;
  }));
  const updated = results.map((r, i) => (r.status === 'fulfilled' ? r.value : models[i]));
  return persist(ctx, batch, { models: updated, status: 'generated', step4_synthesis: { ...PENDING_SYNTHESIS } });
}

export async function runStep2(ctx, batch) {
  if (!hasJudge(ctx)) throw new Error(x('errNoJudge'));
  const models = [...(batch.models || [])];
  say(ctx, x('progress.analyze', { n: models.filter((m) => m.step1_generation?.status === 'done').length }));
  const results = await Promise.allSettled(models.map(async (m) => {
    const copy = { ...m };
    if (copy.step1_generation?.status !== 'done') return copy;
    const composed = composeAnalysis(ctx.project, ctx.version, copy);
    try {
      const raw = await callModel(ctx.projectId, composed, judgeCall(ctx, 0.1));
      const parsed = extractJson(raw);
      const dims = parsed?.dimensions || [];
      copy.step2_analysis = { status: 'done', dimensions: dims, overallScore: computeWeightedScore(dims), analysis: parsed?.analysis || raw, error: null, promptSent: composed, rawResponse: raw };
    } catch (e) {
      copy.step2_analysis = { status: 'error', dimensions: [], overallScore: null, analysis: null, error: e.message, promptSent: composed, rawResponse: null };
    }
    copy.step3_reflection = { ...PENDING_REFLECTION };
    return copy;
  }));
  const updated = results.map((r, i) => (r.status === 'fulfilled' ? r.value : models[i]));
  return persist(ctx, batch, { models: updated, status: 'analyzed', step4_synthesis: { ...PENDING_SYNTHESIS } });
}

export async function runStep3(ctx, batch) {
  if (!hasJudge(ctx)) throw new Error(x('errNoJudge'));
  const models = [...(batch.models || [])];
  const eligible = models.filter((m) => m.step2_analysis?.status === 'done').length;
  let done = 0;
  for (let i = 0; i < models.length; i++) {
    const m = { ...models[i] };
    if (m.step2_analysis?.status !== 'done') continue;
    done++;
    const candidate = (ctx.project.candidateModels || []).find((c) => c.id === m.modelId);
    say(ctx, x('progress.reflectJudge', { model: m.modelLabel, i: done, n: eligible }));
    const judgeComposed = composeReflection(ctx.project, ctx.version, m);
    let judgeProposals;
    try {
      const raw = await callModel(ctx.projectId, judgeComposed, judgeCall(ctx, 0.2));
      const parsed = extractJson(raw);
      judgeProposals = { proposals: parsed?.proposals || [], reasoning: parsed?.reasoning || raw, promptSent: judgeComposed, rawResponse: raw };
    } catch (e) {
      judgeProposals = { proposals: [], reasoning: '', error: e.message, promptSent: judgeComposed, rawResponse: null };
    }
    say(ctx, x('progress.reflectSelf', { model: m.modelLabel, i: done, n: eligible }));
    const selfComposed = composeSelf(ctx.project, ctx.version, m);
    let selfProposals;
    try {
      const raw = await callModel(ctx.projectId, selfComposed, candidate?.modelId ? { model: candidate.modelId, temperature: 0.2 } : judgeCall(ctx, 0.2));
      const parsed = extractJson(raw);
      selfProposals = { proposals: parsed?.proposals || [], reasoning: parsed?.reasoning || raw, promptSent: selfComposed, rawResponse: raw };
    } catch (e) {
      selfProposals = { proposals: [], reasoning: '', error: e.message, promptSent: selfComposed, rawResponse: null };
    }
    m.step3_reflection = { status: 'done', judgeProposals, selfProposals, error: null };
    models[i] = m;
  }
  return persist(ctx, batch, { models, status: 'reflected', step4_synthesis: { ...PENDING_SYNTHESIS } });
}

export async function runStep4(ctx, batch) {
  if (!hasJudge(ctx)) throw new Error(x('errNoJudge'));
  say(ctx, x('progress.synthesize'));
  const composed = composeSynthesis(ctx.project, ctx.version, batch);
  let synthesis;
  try {
    const raw = await callModel(ctx.projectId, composed, judgeCall(ctx, 0.1));
    const parsed = extractJson(raw);
    synthesis = { status: 'done', groupedProposals: parsed?.groupedProposals || parsed?.proposals || [], options: parsed?.options || null, recommendation: parsed?.recommendation || '', analysis: parsed?.analysis || raw, error: null, promptSent: composed, rawResponse: raw };
  } catch (e) {
    synthesis = { ...PENDING_SYNTHESIS, status: 'error', error: e.message, promptSent: composed };
  }
  return persist(ctx, batch, { models: batch.models, status: 'synthesized', step4_synthesis: synthesis });
}

/** All four steps in a row; each one is persisted before the next starts. */
export async function runAll(ctx, batch) {
  let b = await runStep1(ctx, batch);
  b = await runStep2(ctx, b);
  b = await runStep3(ctx, b);
  return runStep4(ctx, b);
}

/** Write the next version of the prompt from one option of a run's synthesis. */
export async function applyOption(ctx, batch, key) {
  const proposals = optionProposals(batch.step4_synthesis, key);
  if (!proposals.length) throw new Error(x('errNoProposals'));
  if (!ctx.version?.prompt) throw new Error(x('errNoPrompt'));
  const improved = String(await callModel(ctx.projectId, composeApply(ctx.version.prompt, proposals), judgeCall(ctx, 0.1)) || '').trim();
  if (!improved || improved.length < 100) throw new Error(x('errApplyShort'));
  return createVersion(ctx.projectId, { prompt: improved, targetOutput: ctx.version.targetOutput || '', changelog: x('changelogApplied', { n: proposals.length, option: key }) });
}

/* ── The copy-and-paste road ──────────────────────────────────────────────────────────────────── */

/** The texts a person copies into their own AI for one step: one per model, or one for the whole run. */
export function stepPrompts(step, ctx, batch) {
  const models = batch?.models || [];
  if (step === 'generate') return [{ label: x('promptFor.generate'), text: ctx.version.prompt || '' }];
  if (step === 'analyze') return models.filter((m) => m.step1_generation?.status === 'done').map((m) => ({ label: m.modelLabel, text: composeAnalysis(ctx.project, ctx.version, m) }));
  if (step === 'reflect') {
    return models.filter((m) => m.step2_analysis?.status === 'done').flatMap((m) => [
      { label: x('promptFor.judge', { model: m.modelLabel }), text: composeReflection(ctx.project, ctx.version, m) },
      { label: x('promptFor.self', { model: m.modelLabel }), text: composeSelf(ctx.project, ctx.version, m) },
    ]);
  }
  return [{ label: x('promptFor.synthesize'), text: composeSynthesis(ctx.project, ctx.version, batch) }];
}

/**
 * An answer brought back by hand, written into the run the same way the model call writes it.
 * `which` is 'judge' or 'self' for the reflection step. Returns the fields to persist.
 */
export function pasteInto(step, batch, modelIndex, text, which) {
  const models = [...(batch.models || [])];
  if (step === 'synthesize') {
    const parsed = extractJson(text);
    return { status: 'synthesized', step4_synthesis: { status: 'done', groupedProposals: parsed?.groupedProposals || parsed?.proposals || [], options: parsed?.options || null, recommendation: parsed?.recommendation || '', analysis: parsed?.analysis || text, error: null, promptSent: null, rawResponse: text } };
  }
  const m = { ...models[modelIndex] };
  if (step === 'generate') {
    m.step1_generation = { status: 'done', output: text, durationMs: 0, error: null, promptSent: null };
  } else if (step === 'analyze') {
    const parsed = extractJson(text);
    const dims = parsed?.dimensions || [];
    m.step2_analysis = { status: 'done', dimensions: dims, overallScore: computeWeightedScore(dims), analysis: parsed?.analysis || text, error: null, promptSent: null, rawResponse: text };
  } else {
    const parsed = extractJson(text);
    const existing = m.step3_reflection || { ...PENDING_REFLECTION };
    const part = { proposals: parsed?.proposals || [], reasoning: parsed?.reasoning || text, promptSent: null, rawResponse: text };
    const next = { ...existing, [which === 'self' ? 'selfProposals' : 'judgeProposals']: part };
    next.status = next.judgeProposals && next.selfProposals ? 'done' : existing.status;
    m.step3_reflection = next;
  }
  models[modelIndex] = m;
  return { models };
}
