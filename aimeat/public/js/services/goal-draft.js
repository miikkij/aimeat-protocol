/**
 * @file public/js/services/goal-draft.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A goal's proposal from one sentence: the person's own model here writes the plan (who
 *   leads, who does each work, what is missing and why), the page shows it, and the person approves
 *   it with one press. Jouni, 2026-10-25: "nobody fills forms any more; the AI makes the decisions
 *   and advises, the person sees what happens and approves". The same call the new-agent page makes
 *   (POST /v1/ai/complete, app_id home-goals), so it costs what a draft of an agent costs.
 *
 *   WHAT THE MODEL IS TOLD. The person's agents with their tags and modes, which of them is the
 *   person's own AI in a conversation (mode workstation), and how many computers run agents. It plans
 *   with what exists: a work goes to an agent that fits, to open work for a skill, to the node's own
 *   model (runner "model": writing, summaries, research from what the model knows, with the person's
 *   key inside the spending limit), or to the person as a step. What would need an agent the person
 *   lacks is listed as missing, with the sentence that makes it and the skill tag its open work asks
 *   for (agent-new.js gives the new agent that tag).
 *
 *   WHAT IS CHECKED HERE. The answer is the model's word: an agent it names that does not exist, a
 *   step kind it invented or an `after` out of range is corrected or dropped before the person sees
 *   it, so the plan shown is the plan that would run.
 * @structure goalPlanContext() · draftGoal() · parseGoalPlan() · planToGoal() · ownAiGoalRequest()
 * @usage const plan = await draftGoal(sentence, ctx); await createGoal(planToGoal(plan, sentence));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { api } from '/js/api.js';

const STEP_KINDS = ['choose', 'approve', 'answer', 'do', 'provide'];
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);

/**
 * What the model is told about the person's setup.
 * @param {Array<{ name: string, tags?: string[], mode?: string, stopped?: boolean, platform?: string|null }>} agents
 * @param {number} computers
 */
export function goalPlanContext(agents, computers) {
  const live = (agents ?? []).filter((a) => !a.stopped);
  return {
    agents: live.filter((a) => a.mode !== 'workstation').map((a) => ({ name: a.name, tags: a.tags ?? [], platform: a.platform ?? null })),
    ownAi: live.filter((a) => a.mode === 'workstation').map((a) => a.name),
    computers: computers ?? 0,
  };
}

function planInstructions(ctx) {
  const agents = ctx.agents.length
    ? ctx.agents.map((a) => `- ${a.name}${a.tags.length ? ` (skills: ${a.tags.join(', ')})` : ''}${a.platform ? ` on ${a.platform}` : ''}`).join('\n')
    : '- none';
  return `You plan a goal for a person's AIMEAT from one sentence the person wrote, so the person only has to approve it.
Answer with one JSON object and nothing else, in this shape:
{
  "title": "a short name for the goal, at most eight words, in the person's language",
  "done_when": "one sentence: when the goal is done, in the person's language",
  "coordinator": null or the name of one agent below that leads the whole goal,
  "works": [
    {
      "title": "what this work is, in the person's language",
      "description": "what to do and what it builds on",
      "who": "agent:<name> | skill:<tag> | model | person:<choose|approve|answer|do|provide>",
      "options": ["only for person:choose, the choices"],
      "after": [the 1-based numbers of the works this one waits for]
    }
  ],
  "missing": [
    { "sentence": "one sentence that makes the agent this goal lacks", "tag": "the skill tag its work asks for", "why": "one sentence" }
  ],
  "limit_usd": a spending limit in US dollars for the model work, at least 1,
  "days": how many days the goal may run, 7 to 90,
  "why": "two or three sentences to the person: why this plan, what happens next, what they will be asked"
}

The person's agents:
${agents}
The person's own AI in a conversation (it answers for them when they say so): ${ctx.ownAi.length ? ctx.ownAi.join(', ') : 'none connected'}
Computers that run agents: ${ctx.computers}

Plan with what exists, and keep it short:
- A capable agent takes a big piece whole; do not cut the work into small steps. Two to five works is usual.
- who "agent:<name>": only a name from the list above, and only when its skills or name fit the work.
- who "skill:<tag>": open work any agent with that skill takes; use a tag an agent above has, or a tag from "missing".
- who "model": the node's own model does it with the person's key: writing, a summary, a comparison, research from what the model already knows. It has no tools: it cannot open web pages, search, post, send or buy. Use it when no agent above fits and none is needed.
- who "person:...": what only the person can do or decide: a choice, an approval, posting or sending in their own name, paying, giving a file. A "do" step says exactly what to do.
- When the goal needs something none of the above can do (watching the web every day, posting on a service, working on files on a computer), add it to "missing" with the sentence that makes such an agent, and give its work who "skill:<that tag>". With no computers, say in "why" that a new agent needs a computer to run on.
- The last work, when the person should see the result before it counts, is a person:approve step.
Write every text the person reads in the language of the person's sentence.`;
}

/** Ask the person's own model for the plan. Throws with `code` when no model answered. */
export async function draftGoal(sentence, ctx) {
  const resp = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt: sentence, systemPrompt: planInstructions(ctx), modelRole: 'execution', app_id: 'home-goals' }),
    timeoutMs: 300_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp?.error?.message || 'AI call failed'); e.code = resp?.error?.code; throw e; }
  return parseGoalPlan(resp?.data?.content, ctx);
}

/** The model's answer as a plan the node will accept; what it got wrong is corrected or dropped. */
export function parseGoalPlan(content, ctx) {
  const text = String(content || '');
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('NO_PLAN');
  let raw;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('NO_PLAN'); }
  const names = new Set(ctx.agents.map((a) => a.name));
  const missing = (Array.isArray(raw.missing) ? raw.missing : []).slice(0, 4)
    .map((m) => ({ sentence: String(m?.sentence || '').slice(0, 400), tag: slug(m?.tag), why: String(m?.why || '').slice(0, 300) }))
    .filter((m) => m.sentence && m.tag);
  const works = (Array.isArray(raw.works) ? raw.works : []).slice(0, 8).map((w) => {
    const who = String(w?.who || 'model');
    let doer = { kind: 'model' };
    if (who.startsWith('agent:')) {
      const name = who.slice(6).trim();
      doer = names.has(name) ? { kind: 'agent', agent: name } : { kind: 'model' };
    } else if (who.startsWith('skill:')) {
      const tag = slug(who.slice(6));
      doer = tag ? { kind: 'skill', tag } : { kind: 'model' };
    } else if (who.startsWith('person:')) {
      const step = who.slice(7).trim();
      doer = { kind: 'person', step: STEP_KINDS.includes(step) ? step : 'approve' };
    }
    const options = doer.kind === 'person' && doer.step === 'choose'
      ? (Array.isArray(w?.options) ? w.options : []).map(String).filter(Boolean).slice(0, 12) : [];
    if (doer.kind === 'person' && doer.step === 'choose' && options.length < 2) doer = { kind: 'person', step: 'answer' };
    return {
      title: String(w?.title || '').trim().slice(0, 200),
      description: String(w?.description || '').slice(0, 2000),
      doer, options,
      after: (Array.isArray(w?.after) ? w.after : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1),
    };
  }).filter((w) => w.title);
  // `after` may only name an earlier work.
  works.forEach((w, i) => { w.after = w.after.filter((n) => n <= i); });
  if (!works.length) throw new Error('NO_PLAN');
  const coordinator = names.has(String(raw.coordinator || '')) ? String(raw.coordinator) : null;
  const limit = Number(raw.limit_usd);
  const days = Number(raw.days);
  return {
    title: String(raw.title || '').trim().slice(0, 200),
    doneWhen: String(raw.done_when || '').slice(0, 1000),
    coordinator,
    works,
    missing,
    limitUsd: Number.isFinite(limit) && limit >= 1 ? Math.min(Math.round(limit * 100) / 100, 100) : 5,
    days: Number.isFinite(days) ? Math.min(Math.max(Math.round(days), 7), 90) : 30,
    why: String(raw.why || '').slice(0, 1200),
  };
}

/** The body POST /v1/goals takes for a plan. */
export function planToGoal(plan, sentence) {
  // A work the person left out goes, and `after` is renumbered to the works that stay.
  const newNumber = new Map();
  plan.works.forEach((w, i) => { if (!w.left) newNumber.set(i + 1, newNumber.size + 1); });
  const works = plan.works.filter((w) => !w.left).map((w) => {
    const after = w.after.map((n) => newNumber.get(n)).filter((n) => n !== undefined);
    const base = { title: w.title, ...(w.description ? { description: w.description } : {}), ...(after.length ? { after: after.map((n) => `#${n}`) } : {}) };
    if (w.doer.kind === 'agent') return { ...base, agent: w.doer.agent };
    if (w.doer.kind === 'skill') return { ...base, wants: [w.doer.tag] };
    if (w.doer.kind === 'person') {
      return { ...base, kind: 'human', human_kind: w.doer.step, ...(w.doer.step === 'choose' ? { options: w.options.map((label, i) => ({ id: `o${i + 1}`, label: label.slice(0, 200) })) } : {}) };
    }
    return { ...base, runner: 'model' };
  });
  return {
    statement: sentence,
    ...(plan.title ? { title: plan.title } : {}),
    ...(plan.doneWhen ? { done_when: plan.doneWhen } : {}),
    ...(plan.coordinator ? { mode: 'coordinator', coordinator: plan.coordinator } : {}),
    any_agent: true,
    limits: { usd: plan.limitUsd },
    ends_at: new Date(Date.now() + plan.days * 86_400_000).toISOString(),
    works,
    reason: 'planned from one sentence and approved on the home',
  };
}

/** What the person says to their own AI to have it propose the goal. English: an AI reads it. */
export function ownAiGoalRequest(sentence) {
  return `Make me a goal on my AIMEAT: ${sentence}

Read my agents first (aimeat_agents_list). Plan it with what I have: give each work to an agent that fits, as open work for a skill, to the node's own model (runner "model": writing, summaries, research from what the model knows, with my key), or to me as a step (choose, approve, answer, do, provide). If it needs an agent I do not have, tell me which and why. Then propose it with aimeat_goal_set action "propose", so it waits on my home for my approval, and tell me in two sentences what will happen.`;
}
