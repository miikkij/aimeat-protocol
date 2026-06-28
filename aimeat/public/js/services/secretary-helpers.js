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
    "workspaces": [ { "name": "workspace name", "purpose": "what it holds and why" } ]
  },
  "quickActions": [ { "label": "short button label (<= 4 words)", "kind": "prompt", "prompt": "a canned message to send to the Secretary" } ]
}
\`\`\``;

/** Conversational interview the user runs in their own external AI chat. */
export function buildInterviewPrompt(owner) {
  return `I want to set up a context for my personal Secretary inside AIMEAT${owner ? ` (my username is "${owner}")` : ''}.

Act as that Secretary getting to know me for ONE area of my life or work. Interview me with a few focused questions about: what I'm trying to achieve in this area, the kinds of tasks I'd want help with, and how I like to communicate (tone, language, level of detail). Do NOT ask me about "organisms", "workspaces", folders or any technical structure — figure the right structure out yourself from what I tell you. Keep it conversational; ask, wait for my answers, then continue.

When you have enough, design two things and output them as ONE JSON object inside a single code block with EXACTLY this shape and nothing else:

${CONTRACT}

Constraints: 3–7 brain rules; 2–6 workspaces, each designed from my actual needs; 2–3 quickActions (role-specific shortcut buttons) — each "kind" is either "prompt" (a canned message to send me) or "compose" (focus an input; "target" is one of "plan"|"find"|"note"), never anything else. Output ONLY the JSON code block.`;
}

/** Single-shot design prompt for the in-app mode (runs on the owner's OpenRouter key). */
export function buildDesignPrompt(owner, needs) {
  return `You are setting up one context of ${owner || 'a user'}'s personal Secretary inside AIMEAT. Based ONLY on the needs described below, design two things and output them as ONE JSON object inside a single code block with EXACTLY this shape and nothing else:

${CONTRACT}

The user's needs:
"""
${needs}
"""

Constraints: 3–7 brain rules; 2–6 workspaces (you choose names + purposes from the needs); 2–3 quickActions (role-specific shortcut buttons) — each "kind" is either "prompt" (a canned message) or "compose" (focus an input; "target" is one of "plan"|"find"|"note"), never anything else. Output ONLY the JSON code block — no commentary.`;
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
