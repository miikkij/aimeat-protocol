/**
 * @file secretary-helpers.js
 * @description Pure helpers for the Secretary view (kept out of the view module so it stays small):
 *   the interview/design prompt builders + their shared JSON output contract, robust JSON extraction
 *   from AI text, a brain version-snapshot, a context id generator, and the secretary.config migration
 *   from the old single-context layout to the multi-context `{contexts[], activeContextId}` shape.
 *   See docs/plans/2026-06-23-secretary-feature.md (§5 hire, §22 multi-context).
 * @structure CONTRACT · buildInterviewPrompt · buildDesignPrompt · extractJson · snapshotOf · genCtxId · sanitizeQuickActions · migrateConfig · buildDecisionRecord
 * @usage import { buildInterviewPrompt, extractJson, sanitizeQuickActions, migrateConfig } from '/js/services/secretary-helpers.js';
 * @version-history
 *   v0.4.0 — 2026-06-28 — Setup interview reworked: deeper questions (current state, target, ordered
 *     milestones, who's involved), a mandatory reflect-back-and-confirm step before any JSON, and a
 *     closing "paste it back into AIMEAT" instruction. CONTRACT gains an OPTIONAL `direction` block
 *     (where-we-are → where-we're-going + milestones) + normalizeDirection().
 *   v0.3.0 — 2026-06-27 — B3: CONTRACT gains quickActions (2–3 role-specific shortcuts) + sanitizeQuickActions
 *     — the frontend security mirror (brain/secretary may only seed prompt|compose, never a run verb).
 *   v0.2.0 — 2026-06-24 — P3-B: buildDecisionRecord — the single source of the decision-log contract
 *     shape, shared by the manual log form (use-learning), answered Ask cards (use-intake), and
 *     approved guided plans (use-guided-plan) so real choices feed the learning loop.
 *   v0.1.0 — 2026-06-23 — Extracted from views/secretary.js (Phase 2, keep view < 500 lines).
 */
import { defaultPolicy } from '/js/services/secretary-policy.js';
import { sanitizeProposedQuickActions } from '/js/services/secretary-rules.js';
import { t } from '/js/i18n.js';

/** G10: a human day label for a feed timestamp — Today / Yesterday / locale date. */
export function feedDayLabel(ts) {
  const d = new Date(ts);
  const startOf = (x) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime(); };
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diffDays === 0) return t('secretary.feed.today');
  if (diffDays === 1) return t('secretary.feed.yesterday');
  return d.toLocaleDateString();
}

/** G10: group a newest-first feed list into consecutive day buckets [{ key, label, items }]. The key is
 *  the LOCAL midnight timestamp (NOT the UTC date) so it matches the local-day label — otherwise items
 *  straddling UTC midnight on the same local day would split into two same-labelled groups. */
export function groupFeedByDay(feed) {
  const groups = [];
  let cur = null;
  for (const it of (feed || [])) {
    let key = 'unknown';
    if (it.ts) { const d = new Date(it.ts); d.setHours(0, 0, 0, 0); key = String(d.getTime()); }
    if (!cur || cur.key !== key) { cur = { key, label: it.ts ? feedDayLabel(it.ts) : '—', items: [] }; groups.push(cur); }
    cur.items.push(it);
  }
  return groups;
}

/** Concise, accurate AIMEAT primer fed to the chat so the Secretary can teach/guide the user
 *  ("tutustuta AIMEATiin"). Concept-level (avoids brittle exact UI paths so it doesn't drift). */
export const SECRETARY_AIMEAT_PRIMER = `AIMEAT is the user's own AI-agent platform. Key ideas you can explain:
- The user owns everything under their identity (GHII). "Morsels" (❤️) are the usage/credit meter — they're spent on actions, not cashable.
- Memory: the user's private key-value knowledge store.
- Organisms = spaces (personal or shared) that contain Workspaces (like folders) holding structured records. The user's Secretary keeps each context's info in its own organism.
- Agents: AI helpers the user connects (each scoped); the Secretary is one of them.
- Discover (the network search): finds what already exists across the node — agents, services, companies' offerings, knowledge, apps — so you never rebuild what's there. Always suggest discovering before building.
- Apps, extensions, capabilities: ways to extend AIMEAT; companies can publish offerings others order.
When the user asks how to do something in AIMEAT, explain clearly and concretely from these concepts, point them to the right area of their Profile, and offer to walk them through it step by step. If unsure, say so rather than inventing exact button names.`;

/** Shared JSON output contract both interview modes ask the AI to produce. */
export const CONTRACT = `\`\`\`json
{
  "brain": {
    "purpose": "1-3 sentences: who my Secretary is and how it helps me in this context",
    "rules": [ { "id": "r1", "description": "a concrete operating rule" } ]
  },
  "organism": {
    "name": "a short name for this space",
    "description": "one line describing it",
    "workspaces": [ { "name": "workspace name", "purpose": "what it holds and why", "manifest": "OPTIONAL — see note below", "schemas": "OPTIONAL — see note below" } ]
  },
  "goals": [ { "title": "a concrete goal I'm working toward in this context", "why": "why it matters" } ],
  "quickActions": [ { "label": "short button label (<= 4 words)", "kind": "prompt", "prompt": "a canned message to send to the Secretary" } ],
  "strategy": "OPTIONAL — see note below"
}
\`\`\`

Each workspace MAY include a ready-to-use schema so it is useful immediately (recommended when you can design it well):
- "manifest": { "manifestVersion": "1.0", "name": "<the workspace name>", "kind": "<short-slug>", "status": "active", "objectTypes": [ { "name": "<type>", "namespace": "<ns>", "fields": [ { "name": "<field>", "type": "text|number|date|select|boolean|reference" } ] } ] }
- "schemas": a JSON-Schema object per objectType, keyed by its namespace.
If you are NOT confident you can produce a VALID manifest + schemas, OMIT both fields for that workspace — they will be designed automatically afterward. Never output an invalid or half-finished manifest.

"strategy" is the OPTIONAL steering frame for this area: where we are, where we're going, and how. Include it ONLY when the user wants this area steered that way (many goal-driven areas benefit; some areas are just ongoing upkeep — then OMIT the field entirely). EVERY sub-field is itself optional — include only the ones the user gave you real material for; never invent vision/mission/progress/names. When included:
- "strategy": {
    "enabled": true,
    "vision": "the long-term aspirational picture — where this could ultimately go (optional)",
    "mission": "what we do / our ongoing purpose in this area (optional)",
    "principles": [ "a short guardrail that should steer decisions" ],
    "risks": [ "something that could derail this, to watch for" ],
    "current": "where this area honestly stands right now (the current state)",
    "target": "the target state — what 'done well' looks like for this strategy cycle (no dates)",
    "milestones": [ { "title": "an ordered gate on the way to the target", "enables": "what reaching it unlocks / why it matters", "criterion": "an external/judgement condition to consider it reached (optional)", "status": "not-started" } ]
  }
- Milestones are ORDERED and DATELESS; status is one of "not-started" | "in-progress" | "reached". A milestone is a checkpoint (a gate), NOT a task — the concrete tasks live in "goals". Base everything ONLY on what the user told you.`;

/** When EVOLVING an existing context (re-run "reshape current"), the current setup fed back so the AI
 *  modifies it instead of starting over — and keeps the existing workspaces stable. Empty for a new context. */
function currentSetupText(current) {
  if (!current) return '';
  const rules = ((current.brain && current.brain.rules) || []).map((r) => `- ${r.description}`).join('\n');
  const ws = (current.workspaces || []).map((w) => `- ${w.name}: ${w.purpose || ''}`).join('\n');
  return `

This context ALREADY EXISTS — EVOLVE it, do not start over.
Current purpose: ${(current.brain && current.brain.purpose) || ''}
Current rules:
${rules || '(none)'}
Current workspaces:
${ws || '(none)'}
KEEP the existing workspaces (same names) and only ADD a new one if the change truly needs it — never drop or rename an existing workspace. Update the brain, goals and quick actions to reflect the requested change below.`;
}

/** Conversational interview the user runs in their own external AI chat. `current` (optional) = the
 *  context being re-run, so the AI EVOLVES it (reshape) instead of starting fresh. */
export function buildInterviewPrompt(owner, current) {
  return `I want to ${current ? 'adjust an existing' : 'set up a'} context for my personal Secretary inside AIMEAT${owner ? ` (my username is "${owner}")` : ''}.

Act as that Secretary ${current ? 'helping me evolve this area of my life or work' : 'getting to know me for ONE area of my life or work'}.

HOW TO BE IN this conversation — read this first, it matters more than the output:
You are a real collaborator and thinking partner, NOT a form-filler. The JSON at the end is the BY-PRODUCT of a genuinely useful conversation — it is not the goal, and you must not rush to it. ENGAGE with whatever I bring up: if I propose an approach, suggest a tool, or ask a question (for example "can we find out what AIMEAT can already do for this", or "I can run a prompt in Claude Code to help"), take it seriously, build on it, and actually help me think it through right now — do not ignore it or defer everything to "later". If I raise something you can help with, help. Be warm, peer-level, and direct; no corporate filler, no em-dashes.

You know AIMEAT, so you can answer my questions about it and suggest how it helps here:
${SECRETARY_AIMEAT_PRIMER}

Interview me properly — ask a few focused questions, ONE small batch at a time, and WAIT for my answers between batches. Do NOT ask me about "organisms", "workspaces", folders or any technical structure — figure the right structure out yourself from what I tell you.

Across the conversation, get to know (only push on what's relevant to my area):
1. The area itself — what it is, what I'm trying to achieve, the kinds of tasks I'd want help with, and how I like to communicate (tone, language, level of detail).
2. Whether I want this area STEERED with a strategy — i.e. tracking where we are → where we're going. Some areas want that, some are just ongoing upkeep. If I don't want it, skip the whole strategy structure.
3. If I do: the strategy pieces — VISION (long-term aspiration), MISSION (what we do), PRINCIPLES (guardrails that should steer decisions), RISKS (what could derail), the CURRENT STATE (where it honestly stands now) and the TARGET STATE (what "done well" looks like this cycle), and the big MILESTONES between them in order (each a checkpoint/gate, not a task — what reaching it unlocks). Don't force every piece; capture what I actually have material for.
4. WHO is involved in what (people, partners, projects).${currentSetupText(current)}

BEFORE you produce any JSON: reflect your understanding back to me in plain language — the strategy (current → target, the milestones in order, vision/mission/principles/risks if we covered them) and who's involved — and ask me to CONFIRM or CORRECT it. Do NOT output JSON until I have confirmed. This is the most important step: I need to see you understood me before anything is built.

ONLY after I confirm, design these and output them as ONE JSON object inside a single code block with EXACTLY this shape:

${CONTRACT}

Constraints: 3–7 brain rules; 2–6 workspaces, each designed from my actual needs; 2–3 goals (concrete things I'm working toward — distinct from strategy milestones, which are gates); 2–3 quickActions (role-specific shortcut buttons) — each "kind" is either "prompt" (a canned message to send me) or "compose" (focus an input; "target" is one of "plan"|"find"|"note"), never anything else. Include the "strategy" object only if I wanted this area steered that way, and only the sub-fields we actually covered.

After the JSON code block, add ONE short line in my language telling me exactly what to do next: go back to AIMEAT → the Secretary page → paste this JSON into the setup box → click "Set up my Secretary". (The JSON must still be a single self-contained code block so the app can read it.)`;
}

/** Single-shot design prompt for the in-app mode (runs on the owner's OpenRouter key). `current`
 *  (optional) = the context being re-run, so the AI EVOLVES it (reshape) and keeps its workspaces. */
export function buildDesignPrompt(owner, needs, current) {
  return `You are setting up ${current ? 'and evolving ' : ''}one context of ${owner || 'a user'}'s personal Secretary inside AIMEAT. Based ONLY on the needs described below${current ? ' and the current setup' : ''}, design these things and output them as ONE JSON object inside a single code block with EXACTLY this shape and nothing else:

${CONTRACT}
${currentSetupText(current)}

The user's needs:
"""
${needs}
"""

Constraints: 3–7 brain rules; 2–6 workspaces (you choose names + purposes from the needs); 2–3 goals (concrete things the user is working toward); 2–3 quickActions (role-specific shortcut buttons) — each "kind" is either "prompt" (a canned message) or "compose" (focus an input; "target" is one of "plan"|"find"|"note"), never anything else. Include the "strategy" object (vision/mission/principles/risks/current → target → ordered milestones — only the parts the needs support) when the needs describe a goal-driven area heading somewhere; OMIT it for areas that are just ongoing upkeep. Base everything ONLY on the needs — never invent progress. Output ONLY the JSON code block — no commentary.`;
}

/** Pull a JSON object out of an AI's text (may be fenced / surrounded by prose). */
export function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== '{') {
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
  }
  return JSON.parse(s);
}

/** A version snapshot of a context brain (purpose + rules), or null if unset. */
export function snapshotOf(brain) {
  if (!brain || !brain.purpose) return null;
  const rules = Array.isArray(brain.rules) ? brain.rules.map((r) => ({ id: r.id, description: r.description })) : [];
  return { ts: new Date().toISOString(), purpose: brain.purpose, rules };
}

export function genCtxId() {
  return 'ctx-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function genActionId() { return 'qa-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

/**
 * Sanitize brain-seeded / secretary-proposed dynamic quick actions (B3). The SECURITY boundary (only
 * prompt|compose, never a 'run' verb) lives in the shared, dependency-free rules module
 * (/js/services/secretary-rules.js), which MIRRORS the server's secretary-tick.ts and is proven equal by
 * e2e-secretary's G6 parity test. Here we just stamp an id + createdAt onto each sanitized action.
 */
export function sanitizeQuickActions(raw, source, status = 'proposed') {
  return sanitizeProposedQuickActions(raw, source, status).map((a) => ({ id: genActionId(), ...a, createdAt: new Date().toISOString() }));
}

/** Cheap, AI-free context routing (plan §22 step 2): score `text` against each context's name +
 *  purpose + workspaces by word overlap. Returns {id,name} of a NON-active context only when it
 *  clearly beats the active one — so the view can SUGGEST a switch. Null otherwise (no nagging). */
export function suggestContextId(text, contexts, activeId) {
  const t = String(text || '').toLowerCase();
  if (t.trim().length < 8 || !Array.isArray(contexts) || contexts.length < 2) return null;
  const words = new Set(t.split(/[^a-z0-9äöå]+/i).filter((w) => w.length >= 4));
  if (words.size === 0) return null;
  const score = (ctx) => {
    const hay = [ctx.name, ctx.brain && ctx.brain.purpose, ...((ctx.workspaces || []).map((w) => w.name + ' ' + (w.purpose || '')))].join(' ').toLowerCase();
    let s = 0;
    for (const w of words) if (hay.includes(w)) s++;
    return s;
  };
  let best = null;
  let bestScore = 0;
  for (const c of contexts) {
    const s = score(c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  const activeCtx = contexts.find((c) => c.id === activeId);
  const activeScore = activeCtx ? score(activeCtx) : 0;
  if (best && best.id !== activeId && bestScore >= 2 && bestScore > activeScore) return { id: best.id, name: best.name };
  return null;
}

/** P1-C: remaining autonomous morsel budget for a context today, or null when no limit is set.
 *  `budget` is the context's policy.dailyMorselBudget (number|null); reads the per-day spend ledger
 *  the tick maintains on `config.autonomousLedger[contextId]`. */
export function computeBudgetInfo(budget, config, contextId) {
  if (budget == null) return null;
  const today = new Date().toISOString().slice(0, 10);
  const led = (config && config.autonomousLedger && config.autonomousLedger[contextId]) || null;
  const spent = (led && led.date === today && typeof led.morsels === 'number') ? led.morsels : 0;
  return { budget, spent, remaining: Math.max(0, budget - spent) };
}

/** P1-D: self-facing reliability = mean score over REVIEWED decisions (not the marketplace trustScore).
 *  Returns { count, score } where score is null until at least one decision has been reviewed. */
export function computeReliability(decisions) {
  const reviewed = (decisions || []).filter((d) => d && d.status === 'reviewed' && typeof d.score === 'number');
  if (reviewed.length === 0) return { count: 0, score: null };
  return { count: reviewed.length, score: Math.round(reviewed.reduce((s, d) => s + d.score, 0) / reviewed.length) };
}

/** Normalize secretary.config to the multi-context shape, migrating the old single-context layout.
 *  `directives` (merged) seeds the brain for a migrated legacy context. Returns {config, changed}. */
export function migrateConfig(cfg, directives) {
  if (cfg && Array.isArray(cfg.contexts)) return { config: cfg, changed: false };
  const dirRules = (directives && Array.isArray(directives.rules))
    ? directives.rules.filter((r) => r.source !== 'system').map((r) => ({ id: r.id, description: r.description }))
    : [];
  const dirPurpose = (directives && directives.purpose) || '';
  if (cfg && (cfg.selfOrganismId || cfg.organismName)) {
    const ctx = {
      id: 'ctx-legacy',
      name: cfg.organismName || 'My space',
      brain: { purpose: dirPurpose, rules: dirRules },
      organismId: cfg.selfOrganismId || null,
      organismName: cfg.organismName || null,
      workspaces: cfg.workspaces || [],
      policy: cfg.policy || defaultPolicy(),
      brainHistory: cfg.brainHistory || [],
    };
    return { config: { contexts: [ctx], activeContextId: ctx.id }, changed: true };
  }
  if (!cfg && dirPurpose) {
    const ctx = { id: 'ctx-legacy', name: 'My space', brain: { purpose: dirPurpose, rules: dirRules }, organismId: null, organismName: null, workspaces: [], policy: defaultPolicy(), brainHistory: [] };
    return { config: { contexts: [ctx], activeContextId: ctx.id }, changed: true };
  }
  return { config: { contexts: [], activeContextId: null }, changed: false };
}

/** Valid milestone statuses for the optional "strategy" steering structure. */
export const MILESTONE_STATUSES = ['not-started', 'in-progress', 'reached'];

let _msSeq = 0;
/** Stable-ish id for a milestone (needed so goals can reference it + for list keys). */
function genMilestoneId() { return 'ms-' + Date.now().toString(36) + (_msSeq++).toString(36) + Math.random().toString(36).slice(2, 4); }

/** Coerce a free-form list field (principles/risks) to an array of non-empty short strings. */
function strList(v) {
  const arr = Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v] : []);
  return arr.map((x) => String((x && x.text) || x || '').trim().slice(0, 400)).filter(Boolean).slice(0, 20);
}

/** Normalize a context's optional `strategy` (from interview/design JSON or stored config) into the
 *  canonical shape: `{ enabled, vision, mission, principles[], risks[], current, target, milestones[] }`
 *  where each milestone is `{ id, title, enables, goalRefs[], criterion, status }`. A missing object, a
 *  non-object, or `enabled:false` yields a disabled (hidden) strategy. Every sub-field is optional; the
 *  card shows only the filled ones. Milestones keep their order (a gate; reach one before the next),
 *  empty-title ones are dropped, ids are stamped if absent, and statuses are coerced to a valid value. */
export function normalizeStrategy(s) {
  const empty = { enabled: false, vision: '', mission: '', principles: [], risks: [], current: '', target: '', milestones: [] };
  if (!s || typeof s !== 'object' || s.enabled === false) return empty;
  const ms = Array.isArray(s.milestones) ? s.milestones : [];
  return {
    enabled: true,
    vision: String(s.vision || '').slice(0, 4000),
    mission: String(s.mission || '').slice(0, 4000),
    principles: strList(s.principles),
    risks: strList(s.risks),
    current: String(s.current || '').slice(0, 4000),
    target: String(s.target || '').slice(0, 4000),
    milestones: ms.map((m) => ({
      id: (m && typeof m.id === 'string' && m.id) ? m.id : genMilestoneId(),
      title: String((m && m.title) || '').slice(0, 300),
      enables: String((m && (m.enables || m.who)) || '').slice(0, 600),
      goalRefs: Array.isArray(m && m.goalRefs) ? m.goalRefs.map((g) => String(g)).filter(Boolean).slice(0, 50) : [],
      criterion: String((m && m.criterion) || '').slice(0, 600),
      status: MILESTONE_STATUSES.includes(m && m.status) ? m.status : 'not-started',
    })).filter((m) => m.title),
  };
}

/** Suggested milestone status from its linked goals (Phase-2 helper): all linked goals done → "reached";
 *  any linked goal exists and at least one is done/in-flight → "in-progress"; otherwise unchanged. Pure;
 *  the owner confirms (some milestones also carry an external `criterion` that is a judgement call). */
export function suggestMilestoneStatus(milestone, goalsById) {
  const refs = (milestone && milestone.goalRefs) || [];
  if (!refs.length) return milestone.status || 'not-started';
  const linked = refs.map((id) => goalsById[id]).filter(Boolean);
  if (!linked.length) return milestone.status || 'not-started';
  const done = linked.filter((g) => g.status === 'done').length;
  if (done === linked.length) return 'reached';
  if (done > 0) return 'in-progress';
  return milestone.status || 'not-started';
}

/** Build a re-plan prompt: given the CURRENT strategy + what the owner just changed (e.g. a new target
 *  state), ask the AI to propose an UPDATED strategy that stays coherent — keep what still fits, adjust
 *  milestones/principles/risks toward the new target. Returns ONLY a `{ "strategy": {...} }` JSON object,
 *  so the same extractJson + normalizeStrategy path applies. Used by both the in-app (OpenRouter) re-plan
 *  and the copy-to-chat re-plan. `changeNote` is the human description of what changed. */
export function buildStrategyReplanPrompt(owner, strategy, changeNote) {
  const cur = normalizeStrategy(strategy);
  const ms = (cur.milestones || []).map((m, i) => `${i + 1}. [${m.status}] ${m.title}${m.enables ? ` — enables: ${m.enables}` : ''}`).join('\n') || '(none)';
  return `You are helping ${owner || 'a user'} re-plan the strategy for one area of their personal Secretary inside AIMEAT. The user just changed something and the rest of the strategy should be adjusted to stay coherent — KEEP whatever still fits, and only change what the change implies. Do not invent facts or progress; preserve the status of milestones that are still valid.

Current strategy:
- Vision: ${cur.vision || '(none)'}
- Mission: ${cur.mission || '(none)'}
- Principles: ${cur.principles.join(' | ') || '(none)'}
- Risks: ${cur.risks.join(' | ') || '(none)'}
- Current state: ${cur.current || '(none)'}
- Target state: ${cur.target || '(none)'}
- Milestones (in order):\n${ms}

What changed:
"""
${String(changeNote || '').slice(0, 2000)}
"""

Output ONE JSON object inside a single code block and nothing else, with this shape:
\`\`\`json
{ "strategy": { "enabled": true, "vision": "", "mission": "", "principles": [], "risks": [], "current": "", "target": "", "milestones": [ { "title": "", "enables": "", "criterion": "", "status": "not-started|in-progress|reached" } ] } }
\`\`\`
Keep milestones ORDERED and dateless; carry over the status of milestones that still apply. Output ONLY the JSON code block.`;
}

/** Path to the decision-log Memory Contract spec (mirrors use-learning.js). */
export const DECISION_SPEC = 'docs/specs/secretary-decision-contract.md';

/** Build one `secretary.decision.{id}` Memory Contract value (see docs/specs/secretary-decision-contract.md).
 *  The SINGLE source of the decision shape — used by the manual log form, answered Ask cards, and
 *  approved guided plans, so every real choice enters the learning loop the same way. Stays `open`
 *  (revisitWhen = now + revisitDays) until the tick's review sweep scores it. `active` is the current
 *  context ({id,name}) for tagging; `options` is an array; goalRef is optional.
 *  @param {{ decision?: string, options?: string[], chosen?: string, rationale?: string, expectedOutcome?: string, goalRef?: string|null, revisitDays?: number|string, active?: { id?: string, name?: string }|null }} [opts]
 */
export function buildDecisionRecord(opts = {}) {
  const { decision, options, chosen, rationale, expectedOutcome, goalRef, revisitDays, active } = opts;
  const id = 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const days = Number(revisitDays) || 7;
  const revisitWhen = new Date(Date.now() + days * 86400000).toISOString();
  return {
    type: 'secretary.decision', spec: DECISION_SPEC, id,
    decision: String(decision || '').trim(),
    goalRef: goalRef || null,
    options: Array.isArray(options) ? options.filter(Boolean) : [],
    chosen: String(chosen || '').trim(),
    rationale: String(rationale || '').trim(),
    expectedOutcome: String(expectedOutcome || '').trim(),
    revisitWhen,
    actualOutcome: null, score: null, verdict: null, status: 'open',
    reviewedAt: null, attempts: 0, lastError: null,
    contextId: (active && active.id) || '', contextName: (active && active.name) || '',
    createdAt: new Date().toISOString(),
  };
}
