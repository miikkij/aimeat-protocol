/**
 * @file secretary-helpers.js
 * @description Pure helpers for the Secretary view (kept out of the view module so it stays small):
 *   the interview/design prompt builders + their shared JSON output contract, robust JSON extraction
 *   from AI text, a brain version-snapshot, a context id generator, and the secretary.config migration
 *   from the old single-context layout to the multi-context `{contexts[], activeContextId}` shape.
 *   See docs/plans/2026-06-23-secretary-feature.md (§5 hire, §22 multi-context).
 * @structure CONTRACT · buildInterviewPrompt · buildDesignPrompt · extractJson · snapshotOf · genCtxId · migrateConfig
 * @usage import { buildInterviewPrompt, extractJson, migrateConfig } from '/js/services/secretary-helpers.js';
 * @version-history v0.1.0 — 2026-06-23 — Extracted from views/secretary.js (Phase 2, keep view < 500 lines).
 */
import { defaultPolicy } from '/js/services/secretary-policy.js';

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
  }
}
\`\`\``;

/** Conversational interview the user runs in their own external AI chat. */
export function buildInterviewPrompt(owner) {
  return `I want to set up a context for my personal Secretary inside AIMEAT${owner ? ` (my username is "${owner}")` : ''}.

Act as that Secretary getting to know me for ONE area of my life or work. Interview me with a few focused questions about: what I'm trying to achieve in this area, the kinds of tasks I'd want help with, and how I like to communicate (tone, language, level of detail). Do NOT ask me about "organisms", "workspaces", folders or any technical structure — figure the right structure out yourself from what I tell you. Keep it conversational; ask, wait for my answers, then continue.

When you have enough, design two things and output them as ONE JSON object inside a single code block with EXACTLY this shape and nothing else:

${CONTRACT}

Constraints: 3–7 brain rules; 2–6 workspaces, each designed from my actual needs. Output ONLY the JSON code block.`;
}

/** Single-shot design prompt for the in-app mode (runs on the owner's OpenRouter key). */
export function buildDesignPrompt(owner, needs) {
  return `You are setting up one context of ${owner || 'a user'}'s personal Secretary inside AIMEAT. Based ONLY on the needs described below, design two things and output them as ONE JSON object inside a single code block with EXACTLY this shape and nothing else:

${CONTRACT}

The user's needs:
"""
${needs}
"""

Constraints: 3–7 brain rules; 2–6 workspaces (you choose names + purposes from the needs). Output ONLY the JSON code block — no commentary.`;
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
