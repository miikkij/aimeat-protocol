/**
 * @file secretary-routing.js
 * @description Pure, AI-free cross-context routing for the Secretary's intake (plan §22 Phase-4, P2-E).
 *   Classifies a piece of intake text against ALL of the user's Secretary contexts by cheap word
 *   overlap (context name + brain purpose + workspace names/purposes), biased by recorded CORRECTIONS
 *   (words the owner has previously associated with a context by moving a note there). The result drives
 *   the intake hook: a HIGH-confidence match to a NON-active context auto-routes the note there; a
 *   LOW-confidence match surfaces an Ask card; an item that belongs to the active context (or has no
 *   signal) returns null and is filed normally. Mirrors the backend helpers in
 *   src/services/secretary-tick.ts — the node behavior wins on any mismatch.
 * @structure tokenize · scoreContexts · routeIntake · learnCorrection
 * @usage import { routeIntake, learnCorrection } from '/js/services/secretary-routing.js';
 * @version-history v0.1.0 — 2026-06-24 — P2-E: cheap cross-context router + corrections-teach.
 */

/** Significant words (≥4 chars) from text, lowercased. */
export function tokenize(text) {
  return Array.from(new Set(String(text || '').toLowerCase().split(/[^a-z0-9äöå]+/i).filter((w) => w.length >= 4)));
}

const CORRECTION_BONUS = 5;

/** Score each context by word overlap (+ correction bias). Returns [{id,name,organismId,score}] sorted desc. */
export function scoreContexts(words, contexts, corrections) {
  const corr = corrections || {};
  return (contexts || []).map((ctx) => {
    const hay = [ctx.name, ctx.brain && ctx.brain.purpose, ...((ctx.workspaces || []).map((w) => w.name + ' ' + (w.purpose || '')))]
      .join(' ').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += 1;
      if (corr[w] === ctx.id) score += CORRECTION_BONUS;
    }
    return { id: ctx.id, name: ctx.name, organismId: ctx.organismId || null, score };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Route intake `text` across all `contexts`. Returns null when the text belongs to the active context
 * or carries no signal (caller files it normally); otherwise `{ contextId, confidence, score }` where
 * confidence is 'high' (auto-route into that non-active context) or 'low' (surface an Ask card).
 */
export function routeIntake(text, contexts, activeId, corrections) {
  const t = String(text || '').trim();
  if (t.length < 8 || !Array.isArray(contexts) || contexts.length < 2) return null;
  const words = tokenize(t);
  if (words.length === 0) return null;
  const scored = scoreContexts(words, contexts, corrections);
  const best = scored[0];
  const second = scored[1] || { score: 0 };
  if (!best || best.score === 0) return null;
  const activeScore = (scored.find((s) => s.id === activeId) || { score: 0 }).score;
  if (best.id === activeId) return null; // belongs to the active context → no routing needed
  const margin = best.score - second.score;
  const beatsActive = best.score - activeScore;
  if (best.score >= 2 && beatsActive >= 2 && margin >= 2) {
    return { contextId: best.id, confidence: 'high', score: best.score };
  }
  return { contextId: best.id, confidence: 'low', score: best.score };
}

/** Record a correction: associate the text's significant words with `toContextId` (bounded map). */
export function learnCorrection(corrections, text, toContextId) {
  const next = { ...(corrections || {}) };
  for (const w of tokenize(text)) next[w] = toContextId;
  const keys = Object.keys(next);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete next[k];
  return next;
}
