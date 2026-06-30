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
 *   v0.7.0 — 2026-06-30 — Sharpen the CONTRACT to state the rule plainly: DOCUMENTS ARE THE DEFAULT (most
 *     workspaces are flexible information → mostly/all document spaces); a RECORDS space is only for
 *     same-shaped, list-like data (actions/tasks/bugs/pipeline/tracker) and legitimately starts empty —
 *     so the user's AI stops over-producing rigid record spaces that the don't-invent fill leaves blank.
 *   v0.6.0 — 2026-06-30 — CONTRACT steers the design toward DOCUMENT spaces (free-form markdown, the
 *     default) and treats RECORDS spaces as the exception (only genuine lists/task-sets) — workspaces
 *     were coming out mostly as rigid record spaces.
 *   v0.5.0 — 2026-06-30 — Close the milestone↔goal linking gap: CONTRACT milestones now carry "goalRefs"
 *     (the AI links each gate to the goals it gates, by 1-based goal index) + linkMilestoneGoals() to
 *     resolve those indices to seeded goal ids, keepKnownGoalRefs() to validate re-plan id refs, and
 *     buildStrategyReplanPrompt() now lists existing goals so re-plans preserve/relink them. Removes the
 *     manual "tick the linked goals" step the owner used to face after setup.
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
- Organisms = spaces (personal or shared) that contain Workspaces (like folders) holding structured records. You keep each area of the user's stuff in its own organism.
- Agents: AI helpers the user connects (each scoped); you are one of them.
- Discover (the network search): finds what already exists across the node — agents, services, companies' offerings, knowledge, apps — so you never rebuild what's there. Always suggest discovering before building.
- Apps, extensions, capabilities: ways to extend AIMEAT; companies can publish offerings others order.
When the user asks how to do something in AIMEAT, explain clearly and concretely from these concepts, point them to the right area of their Profile, and offer to walk them through it step by step. If unsure, say so rather than inventing exact button names.`;

/** Shared JSON output contract both interview modes ask the AI to produce. */
export const CONTRACT = `\`\`\`json
{
  "brain": {
    "purpose": "1-3 sentences: who you are for me and how you help me in this context",
    "rules": [ { "id": "r1", "description": "a concrete operating rule" } ]
  },
  "organism": {
    "name": "a short name for this space",
    "description": "one line describing it",
    "workspaces": [ { "name": "workspace name", "purpose": "what it holds and why", "manifest": "OPTIONAL — see note below", "schemas": "OPTIONAL — see note below" } ]
  },
  "goals": [ { "title": "a concrete goal I'm working toward in this context", "why": "why it matters" } ],
  "quickActions": [ { "label": "short button label (<= 4 words)", "kind": "prompt", "prompt": "a ready message to send you" } ],
  "strategy": "OPTIONAL — see note below"
}
\`\`\`

A workspace's "manifest.objectTypes" are its SPACES, and each space is one of two kinds. DOCUMENTS ARE THE DEFAULT — most workspaces are flexible information and should be all (or mostly) document spaces:
- A DOCUMENT space — free-form markdown pages about a topic (guides, write-ups, notes, plans, analysis, anything). Declare it as { "name": "<type>", "namespace": "<ns>", "mode": "document" } with NO fields and NO schema. This is the DEFAULT: it holds any kind of information and can be shaped and edited freely. When in doubt, use a document space.
- A RECORDS space — a schema-locked list where every entry shares the SAME fixed fields. Use this ONLY for genuinely list-like, repeating data: actions, tasks, bugs, a sales pipeline, a tracker — the SAME shape over and over, that you add rows to over time. Declare it as { "name": "<type>", "namespace": "<ns>", "mode": "records", "fields": [ { "name": "<field>", "type": "text|number|date|select|boolean|reference" } ] } AND provide a matching JSON Schema under "schemas" keyed by its namespace. A records space legitimately starts empty and fills as real items occur — so do not use one for content you want written up now.
Default to document spaces; reach for a records space only when same-shaped, list-like rows clearly fit. A workspace may be entirely document spaces. Full manifest shape: { "manifestVersion": "1.0", "name": "<the workspace name>", "kind": "<short-slug>", "status": "active", "objectTypes": [ …the spaces above ] }.
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
    "milestones": [ { "title": "an ordered gate on the way to the target", "enables": "what reaching it unlocks / why it matters", "criterion": "an external/judgement condition to consider it reached (optional)", "goalRefs": [1, 2], "status": "not-started" } ]
  }
- Milestones are ORDERED and DATELESS; status is one of "not-started" | "in-progress" | "reached". A milestone is a checkpoint (a gate), NOT a task — the concrete tasks live in "goals". Base everything ONLY on what the user told you.
- "goalRefs" links each milestone to the goals it gates: list the 1-based positions of the goals (in the "goals" array above) whose completion moves this milestone toward "reached". Every goal should serve at least one milestone, and most milestones gate at least one goal — leave "goalRefs": [] only when a milestone genuinely maps to none. This linkage is what lets a milestone advance automatically as its goals get done, so fill it in — do not leave it empty by default.`;

/** When EVOLVING an existing context (re-run "reshape current"), the current setup fed back so the AI
 *  modifies it instead of starting over — and keeps the existing workspaces stable. Empty for a new context. */
function currentSetupText(current) {
  if (!current) return '';
  const rules = ((current.brain && current.brain.rules) || []).map((r) => `- ${r.description}`).join('\n');
  const ws = (current.workspaces || []).map((w) => `- ${w.name}: ${w.purpose || ''}`).join('\n');
  return `

This area already exists, so build on what is here and evolve it.
Current purpose: ${(current.brain && current.brain.purpose) || ''}
Current rules:
${rules || '(none)'}
Current workspaces:
${ws || '(none)'}
Keep the existing workspaces under their current names, add a new one only when the change genuinely calls for it, and update the brain, goals and direction to reflect what changes below.`;
}

/** Conversational interview the user runs in their own external AI chat. `current` (optional) = the
 *  context being re-run, so the AI EVOLVES it (reshape) instead of starting fresh. */
export function buildInterviewPrompt(owner, current) {
  return `I want to ${current ? 'evolve the' : 'set up an'} AI that works alongside me inside AIMEAT and helps me handle everything I have going on across my work and life${owner ? ` (my username is "${owner}")` : ''}.

You are that, and this is the start of us working together. You take things off my plate and move my work forward, and you become whatever I need you to be — there is no fixed job title here, only what helps me most. Treat it as a real, flowing conversation between two people. Your aim: genuinely understand my world and what I have going on, be useful to me from the very first message, and by the end arrive at genuinely good "brains" for yourself, so you clearly know how to help me across all of it, my goals are sharp, and you have spaces ready to fill with well-organized information as we go. You handle the whole picture and organize what I bring into its own spaces yourself, so I can hand you anything and trust it lands in the right place.

Take whatever I bring you in stride: it is all welcome, however much there is, and a big, busy picture is exactly where you are most useful. Stay calm and can-do, and meet a large scope with energy. Keep any concern for the moments when something is genuinely serious and worth my attention; right now we are getting to know things, so stay light, curious, and encouraging.

Begin by grounding yourself in what already exists. Your very first move, while you have AIMEAT tools available, is to look up what I already have — my organisms, their workspaces, and recent activity — and open the conversation from that real picture, naming only what you actually find there and building on it. When AIMEAT tools are out of reach, open instead by asking me for a quick picture of what I have going on. Either way, start from what is really there.

Lead with the conversation and let it lead everywhere. Talk the way a sharp, warm colleague talks: plain, simple, everyday language, in my own language. Stay curious and genuinely helpful: when I bring up an approach, a tool, or a question, take it seriously, build on it, and help me with it right there; and when you can move something forward in the moment (look something up, draft something, check whether something already exists), do it then. You have AIMEAT tools and knowledge available, so use them to help me and to ask sharper questions.

You know AIMEAT, so you can explain it and suggest how it helps here:
${SECRETARY_AIMEAT_PRIMER}

Follow me, and come to understand, in whatever order it surfaces: what I have going on across my work and life and where things honestly stand right now; what I need you for and how you can best help me; and, as it comes up, where I want to take things and how we get there. Keep your questions few and focused, one small batch at a time, and let my answers shape the next ones. Where you have a hunch, from what you know about me or what you can find, offer it as a suggestion I can shape ("maybe you're aiming at X, or is it something else?") and let me steer.

Keep your words to me human and plain, and work out any underlying structure quietly on your own from what I tell you, holding it in the background.${currentSetupText(current)}

As we talk, work toward one clear picture we both share, and say it back to me in plain words (your own, grounded in what we covered and what you looked up — a few sentences, not a labelled form): where things honestly stand now, where this is ultimately heading (the vision), and what success looks like for the near term (the target). Make that picture hang together as one coherent story, so each piece follows from the one before. Anything you then suggest doing is a step that plainly serves that target and connects to the rest, expressed as a real, concrete outcome a sharp colleague would immediately understand. Say everything plainly enough that I nod and recognize it as true; when a phrase would puzzle me, swap it for the plain thing you mean, and keep invented terms and strategy-speak out of it.

Hold the right altitude, and use your judgment to keep it there. The vision, target and milestones describe real outcomes — where this area is genuinely heading and what reaching it changes, in this area's own terms, whatever they are. The concrete to-dos (prepare a thing, send a message, make a list) are everyday work that belongs in the space, never a goal or a milestone. Before you settle on the picture, step back and judge it the way a thoughtful person would: is this the real shape of where we are going, or a list of tasks dressed up as strategy? If it reads as busywork, or it does not hang together sensibly, rework it until it earns its place.

Once that picture feels right to me — I will tell you when it clicks — capture everything we landed on as ONE JSON object inside a single code block in exactly this shape:

${CONTRACT}

Fill it from the picture we confirmed: the brain (who you are for me and how you help, written as clear operating rules), the space and what it will hold so information stays organized as it accumulates, the direction (the vision, where we are now, and the target we agreed), my goals (each one a concrete outcome that plainly serves that target and connects to the rest — never a list of disconnected tasks), and a couple of quick actions. Keep it to 3–7 brain rules, 2–6 workspaces drawn from my actual needs, 2–3 goals, and 2–3 quickActions, each kind being either "prompt" (a ready message to send me) or "compose" (focus an input, with "target" one of "plan"|"find"|"note"). Keep the JSON as one self-contained code block so the app can read it.

After the JSON, add one short line in my language: go back to AIMEAT → the Secretary page → paste this into the setup box → "Set up my Secretary".`;
}

/** Single-shot design prompt for the in-app mode (runs on the owner's OpenRouter key). `current`
 *  (optional) = the context being re-run, so the AI EVOLVES it (reshape) and keeps its workspaces. */
export function buildDesignPrompt(owner, needs, current) {
  return `You are setting up ${current ? 'and evolving ' : ''}one context of the AI that works alongside ${owner || 'a user'} inside AIMEAT (it takes things off their plate and moves their work forward — no fixed job title, only what helps most). Based ONLY on the needs described below${current ? ' and the current setup' : ''}, design these things and output them as ONE JSON object inside a single code block with EXACTLY this shape and nothing else:

${CONTRACT}
${currentSetupText(current)}

The user's needs:
"""
${needs}
"""

Constraints: 3–7 brain rules; 2–6 workspaces (you choose names + purposes from the needs); 2–3 goals (concrete things the user is working toward); 2–3 quickActions (role-specific shortcut buttons), each "kind" being either "prompt" (a ready message) or "compose" (focus an input, with "target" one of "plan"|"find"|"note"). Include the "strategy" object (vision/mission/principles/risks/current → target → ordered milestones, using the parts the needs support) when the needs describe a goal-driven area heading somewhere, and leave it out for areas that are ongoing upkeep. Hold the right altitude: the strategy and goals are real outcomes — where this area is heading and what reaching it changes, in its own terms — while concrete to-dos (prepare a thing, send a message, make a list) belong in a workspace, never as a goal or milestone. Before you output, judge the result the way a thoughtful person would: if a goal or milestone reads as busywork or a task dressed up as strategy, rework it until it is a real outcome that hangs together. Ground everything in the needs as given. Output the single JSON code block on its own.`;
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

/** Resolve milestone goalRefs the setup/design AI produced as 1-based indices into the same JSON's
 *  `goals` array (it cannot know the runtime goal ids, so it links by position) to the real goal ids
 *  assigned at seed time. `idsInOrder` is the seeded goal ids in goals[] order (null for any goal that
 *  was skipped or failed to persist). Refs that don't resolve to a real id are dropped; pass [] to strip
 *  every index ref (e.g. when goals were not seeded, so no link can be made). Returns a new strategy;
 *  non-strategy input passes through unchanged. Run this AFTER normalizeStrategy. */
export function linkMilestoneGoals(strategy, idsInOrder) {
  if (!strategy || typeof strategy !== 'object' || !Array.isArray(strategy.milestones)) return strategy;
  const ids = Array.isArray(idsInOrder) ? idsInOrder : [];
  return {
    ...strategy,
    milestones: strategy.milestones.map((m) => {
      const refs = Array.isArray(m && m.goalRefs) ? m.goalRefs : [];
      const mapped = refs
        .map((r) => { const n = Number(r); return Number.isInteger(n) && n >= 1 && n <= ids.length ? ids[n - 1] : null; })
        .filter(Boolean);
      return { ...m, goalRefs: mapped };
    }),
  };
}

/** Keep only the milestone goalRefs that point at a goal that actually exists (matched by id) — used
 *  after a re-plan, where the AI links milestones to EXISTING goal ids and could name one that's gone. */
export function keepKnownGoalRefs(strategy, validIds) {
  if (!strategy || typeof strategy !== 'object' || !Array.isArray(strategy.milestones)) return strategy;
  const ok = new Set((validIds || []).filter(Boolean).map((x) => String(x)));
  return {
    ...strategy,
    milestones: strategy.milestones.map((m) => ({
      ...m,
      goalRefs: (Array.isArray(m && m.goalRefs) ? m.goalRefs : []).filter((r) => ok.has(String(r))),
    })),
  };
}

/** Build a re-plan prompt: given the CURRENT strategy + what the owner just changed (e.g. a new target
 *  state), ask the AI to propose an UPDATED strategy that stays coherent — keep what still fits, adjust
 *  milestones/principles/risks toward the new target. Returns ONLY a `{ "strategy": {...} }` JSON object,
 *  so the same extractJson + normalizeStrategy path applies. Used by both the in-app (OpenRouter) re-plan
 *  and the copy-to-chat re-plan. `changeNote` is the human description of what changed. */
export function buildStrategyReplanPrompt(owner, strategy, changeNote, goals) {
  const cur = normalizeStrategy(strategy);
  const ms = (cur.milestones || []).map((m, i) => {
    const links = (m.goalRefs || []).length ? ` — gates goals: ${m.goalRefs.join(', ')}` : '';
    return `${i + 1}. [${m.status}] ${m.title}${m.enables ? ` — enables: ${m.enables}` : ''}${links}`;
  }).join('\n') || '(none)';
  const goalList = (Array.isArray(goals) ? goals : []).filter((g) => g && g.id && g.title)
    .map((g) => `- [${g.id}] ${g.title}${g.status ? ` (${g.status})` : ''}`).join('\n') || '(none)';
  return `You are helping ${owner || 'a user'} re-plan the strategy for one area of their work inside AIMEAT. The user just changed something and the rest of the strategy should be adjusted to stay coherent — KEEP whatever still fits, and only change what the change implies. Do not invent facts or progress; preserve the status of milestones that are still valid.

Current strategy:
- Vision: ${cur.vision || '(none)'}
- Mission: ${cur.mission || '(none)'}
- Principles: ${cur.principles.join(' | ') || '(none)'}
- Risks: ${cur.risks.join(' | ') || '(none)'}
- Current state: ${cur.current || '(none)'}
- Target state: ${cur.target || '(none)'}
- Milestones (in order):\n${ms}

The user's existing goals in this area (link milestones to these by their [id] in "goalRefs"):
${goalList}

What changed:
"""
${String(changeNote || '').slice(0, 2000)}
"""

Output ONE JSON object inside a single code block and nothing else, with this shape:
\`\`\`json
{ "strategy": { "enabled": true, "vision": "", "mission": "", "principles": [], "risks": [], "current": "", "target": "", "milestones": [ { "title": "", "enables": "", "criterion": "", "goalRefs": [], "status": "not-started|in-progress|reached" } ] } }
\`\`\`
Keep milestones ORDERED and dateless; carry over the status of milestones that still apply. Set each milestone's "goalRefs" to the [id]s (exact id strings from the goals list above) of the goals it gates — carry over the existing links shown next to each milestone, and [] only when a milestone gates none. Output ONLY the JSON code block.`;
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
