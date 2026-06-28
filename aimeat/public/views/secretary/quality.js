/**
 * @file secretary/quality.js
 * @description Multi-step quality pipeline for the Secretary's AI work — replaces single-shot prompts
 *   with triage → gather → produce → verify, so deliverables are grounded, reasoned, and fact-checked
 *   rather than one-prompt wonders that hallucinate. Quality is the goal; cost is accepted.
 *
 *   MODEL POLICY: the pipeline requires a ≥200k-context model (e.g. owl-alpha) on the owner's
 *   OpenRouter key — small/local models can't hold the grounding context. When no big-enough model is
 *   configured the pipeline does NOT run a degraded completion; it returns a composed copy-paste prompt
 *   for the prompt-driven path (paste into a big AI chat, bring the result back).
 *
 *   The two model roles (`reasoning` / `execution`) and `temperature` are already supported by
 *   /v1/ai/complete; triage decides the temperature per task (fact-based ≈0.2, creative ≈0.7).
 * @structure
 *   - MIN_CONTEXT (200_000) — the floor
 *   - getAiCapability() -> { execModel, reasoningModel, maxContext, bigEnough, configured }
 *   - reasonJson(sys, user) -> parsed JSON  (reasoning model, temp 0)
 *   - produce(sys, user, {temperature}) -> string  (execution model, task temp)
 *   - produceDeliverable({ action, owner, contextName, locale, space, runDiscover })
 *       -> { mode:'generated', content, taskType, temperature, searched, verify, cap }
 *        | { mode:'prompt-driven', prompt, cap }
 *   - composeDeliverablePrompt(...) — the copy-paste multi-step prompt for the fallback
 * @usage const out = await produceDeliverable({ action, owner, contextName, locale, space, runDiscover });
 * @version-history
 *   v0.1.0 — 2026-06-28 — Initial: triage/gather/produce/verify pipeline + 200k model gate + fallback.
 */
import { api, apiGet } from '/js/api.js';
import { extractJson } from '/js/services/secretary-helpers.js';

export const MIN_CONTEXT = 200_000;
const LONG = { timeoutMs: 1_800_000, retries: 0 };

/**
 * The quality contract handed to specialists in every delegated task, so they work like the Secretary:
 * grounded, no fabrication, and ask the owner (aimeat_dm_ask) when facts are missing rather than guess.
 * Specialists already have aimeat_dm_ask + workspace/memory read tools — this tells them to use them.
 */
export const SPECIALIST_CONTRACT = [
  'WORK TO THIS QUALITY CONTRACT:',
  '- Ground everything ONLY in the facts/context you are given or can read from the workspace. Never invent numbers, metrics, statistics, quotes, testimonials, names, dates, events, deals, or outcomes.',
  '- If a needed fact is missing and only the owner can provide it, ASK them with a structured question (the aimeat_dm_ask tool) instead of guessing; for anything still unknown, use a [bracketed placeholder].',
  '- Use a ≥200k-context model so you can hold the grounding context; set temperature by task (low ≈0.2 for fact-based, higher ≈0.7 for creative).',
  '- Verify your output against the facts before delivering, and flag anything not supported.',
].join('\n');

/** Read the owner's configured models + their context windows → capability for the quality pipeline. */
export async function getAiCapability() {
  const [settingsR, modelsR] = await Promise.all([
    apiGet('/v1/memory/openrouter.settings').catch(() => null),
    apiGet('/v1/openrouter/models').catch(() => null),
  ]);
  const s = (settingsR && settingsR.data && settingsR.data.value) || {};
  const models = (modelsR && modelsR.data && modelsR.data.models) || [];
  const ctxOf = (id) => { const m = models.find((x) => x && x.id === id); return (m && Number(m.context_length)) || 0; };
  const execModel = s.executionModel || s.model || s.reasoningModel || '';
  const reasoningModel = s.reasoningModel || s.model || execModel || '';
  const execCtx = ctxOf(execModel);
  const reasoningCtx = ctxOf(reasoningModel);
  const maxContext = Math.max(execCtx, reasoningCtx);
  return { execModel, reasoningModel, execCtx, reasoningCtx, maxContext, bigEnough: maxContext >= MIN_CONTEXT, configured: !!execModel };
}

/** Reasoning step: a decision/triage/verify call. Reasoning model, temperature 0, returns parsed JSON. */
export async function reasonJson(systemPrompt, prompt, appId = 'secretary-quality-reason') {
  const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt, systemPrompt, modelRole: 'reasoning', temperature: 0, app_id: appId }), ...LONG });
  const raw = (r && r.data && r.data.content) || '';
  try { return extractJson(raw); } catch { return null; }
}

/**
 * Produce step: generate the deliverable. Execution model, temperature set by triage (per task).
 * @param {string} systemPrompt
 * @param {string} prompt
 * @param {{ temperature?: number }} [opts]
 */
export async function produce(systemPrompt, prompt, { temperature } = {}) {
  const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt, systemPrompt, modelRole: 'execution', temperature, app_id: 'secretary-quality-produce' }), ...LONG });
  return ((r && r.data && r.data.content) || '').trim();
}

const lang = (locale) => (locale === 'fi' ? 'Finnish' : 'English');

// ── Prompt builders ─────────────────────────────────────────────────────────────────────────────
const triageSys = (locale) => `You triage a task for a personal Secretary before it is produced. Decide, with real reasoning, how to do it well. Return ONLY JSON: {"taskType":"fact"|"creative"|"mixed","needsSearch":boolean,"searchQuery":string,"temperature":number,"plan":string,"missing":[string]}. "taskType": is the deliverable fact-based (lists, reports, plans, summaries) or creative (stories, pitches, copy) or mixed? "needsSearch": would looking things up in the public directory materially improve it? "searchQuery": the query to use if so. "temperature": 0.1–0.3 for fact-based, 0.6–0.8 for creative, in between for mixed. "plan": 1–2 sentences on how to produce it. "missing": facts the workspace context lacks that the deliverable needs (these become placeholders, never inventions). Reply fields in ${lang(locale)} where free-text.`;
const triageUser = (action, space) => `Task: ${action.summary}${action.why ? `\n(${action.why})` : ''}\n\nWorkspace context available:\n${space || '(none)'}`;

const produceSys = (owner, contextName, locale) => `You are ${owner || 'the user'}'s personal Secretary in the "${contextName}" context. Produce the requested deliverable as a usable, high-quality DRAFT, grounded ONLY in the facts provided below. STRICT — never invent or embellish: no made-up numbers, metrics, statistics, quotes, testimonials, names, dates, events, deals, or outcomes. If a needed detail is not in the facts, insert a [bracketed placeholder] for the owner to fill — never fabricate one. If the facts are too thin, produce a clearly-labelled skeleton with placeholders and a short "what's missing" note rather than fiction. Markdown is fine. Reply in ${lang(locale)}. Output only the deliverable, no preamble.`;
const produceUser = (action, facts) => `Task: ${action.summary}${action.why ? `\n(${action.why})` : ''}\n\nFacts — the ONLY information you may use:\n${facts || '(no facts available — produce a skeleton with placeholders)'}`;

const clarifySys = (locale) => `You decide whether a deliverable task is missing facts that ONLY the owner can provide, and if so, what to ask — so the Secretary asks instead of guessing. Return ONLY JSON: {"ask":boolean,"questions":[{"id":"q1","header":"short chip","prompt":"the question","options":[{"id":"o1","label":"..."}],"multiSelect":false,"allowOther":true}]}. ask=true ONLY if producing well genuinely needs the owner's input (a preference, a specific fact, a choice) that is NOT in the facts and that you must NOT invent — do NOT ask about things you can reasonably infer or that don't matter. 1–5 questions, each with 2–5 concrete options (always allowOther so they can type their own). Headers/prompts/labels in ${lang(locale)}.`;
const clarifyUser = (action, space) => `Task: ${action.summary}${action.why ? `\n(${action.why})` : ''}\n\nWorkspace context available:\n${space || '(none)'}`;

const verifySys = (locale) => `You fact-check a Secretary's draft against the facts it was given. Return ONLY JSON: {"ok":boolean,"issues":[string]}. "ok": false if the draft states any specific fact (number, metric, quote, name, date, event, outcome) NOT supported by the facts. List each unsupported claim in "issues" (short). Bracketed [placeholders] are fine, not issues. Write issues in ${lang(locale)}.`;
const verifyUser = (content, facts) => `Facts provided:\n${facts || '(none)'}\n\nDraft to check:\n${content}`;

/** The copy-paste prompt for the prompt-driven path (no ≥200k model configured). */
export function composeDeliverablePrompt({ action, contextName, locale, space }) {
  return `You are my personal secretary for "${contextName}". Produce this deliverable, working in steps and thinking before you write.

TASK: ${action.summary}${action.why ? `\n(${action.why})` : ''}

Do it in four steps:
1. TRIAGE — decide if this is fact-based or creative, and what information it needs.
2. GATHER — use ONLY the context below as facts. Note what is missing.
3. PRODUCE — write the deliverable grounded strictly in those facts. Never invent numbers, metrics, quotes, names, dates, events, or outcomes. For anything unknown, write a [bracketed placeholder] I can fill in. If the context is too thin, give a clearly-labelled skeleton with placeholders plus a short "what's missing" list — not a fictional story.
4. VERIFY — re-read your draft and remove or bracket any claim not supported by the context.

Reply in ${lang(locale)}. Output the final deliverable (after your own verification).

CONTEXT (the only facts you may use):
${space || '(no context available — produce a skeleton with placeholders)'}`;
}

/** Full pipeline for a "Do it" deliverable. Returns generated content (+ verify) or a copy-paste prompt. */
export async function produceDeliverable({ action, owner, contextName, locale, space, runDiscover }) {
  const cap = await getAiCapability();
  if (!cap.bigEnough) {
    return { mode: 'prompt-driven', prompt: composeDeliverablePrompt({ action, contextName, locale, space }), cap };
  }
  // 1. Triage (reasoning, temp 0) — decide approach, temperature, whether to search.
  /** @type {any} */
  const triage = (await reasonJson(triageSys(locale), triageUser(action, space), 'secretary-quality-triage')) || {};
  const taskType = ['fact', 'creative', 'mixed'].includes(triage.taskType) ? triage.taskType : 'fact';
  const temperature = typeof triage.temperature === 'number'
    ? Math.min(1, Math.max(0, triage.temperature))
    : (taskType === 'creative' ? 0.7 : taskType === 'mixed' ? 0.45 : 0.2);
  // 1b. Clarify — when triage found missing facts, ask the owner (a batch of option questions) instead
  // of guessing. Only when the gap genuinely needs the owner's input; otherwise fall through to produce.
  if (Array.isArray(triage.missing) && triage.missing.length) {
    /** @type {any} */
    const clarify = (await reasonJson(clarifySys(locale), clarifyUser(action, space), 'secretary-quality-clarify')) || {};
    if (clarify.ask && Array.isArray(clarify.questions) && clarify.questions.length) {
      const questions = clarify.questions.slice(0, 5).map((q, i) => ({
        id: String(q.id || `q${i + 1}`).slice(0, 64),
        header: String(q.header || `Q${i + 1}`).slice(0, 80),
        prompt: String(q.prompt || '').slice(0, 2000),
        options: (Array.isArray(q.options) ? q.options : []).slice(0, 20).map((o, j) => ({ id: String(o.id || `o${j + 1}`).slice(0, 64), label: String(o.label || o.id || '').slice(0, 500) })).filter((o) => o.label),
        multiSelect: !!q.multiSelect,
        allowOther: q.allowOther !== false,
      })).filter((q) => q.prompt && q.options.length);
      if (questions.length) return { mode: 'clarify', questions, facts: space || '', cap };
    }
  }
  // 2. Gather (search the directory if triage asked) — grounding facts.
  let facts = space || '';
  let searched = false;
  if (triage.needsSearch && runDiscover) {
    const found = await runDiscover(triage.searchQuery || action.summary);
    if (found) { facts += `\n\nDirectory search ("${triage.searchQuery || action.summary}"):\n${found}`; searched = true; }
  }
  // 3. Produce (execution, task temperature) — grounded, no fabrication.
  const content = (await produce(produceSys(owner, contextName, locale), produceUser(action, facts), { temperature })) || action.summary;
  // 4. Verify (reasoning, temp 0) — fact-check against the gathered facts.
  const check = (await reasonJson(verifySys(locale), verifyUser(content, facts), 'secretary-quality-verify')) || { ok: true, issues: [] };
  return { mode: 'generated', content, taskType, temperature, searched, verify: check, cap };
}
