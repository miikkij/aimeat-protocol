/**
 * @file secretary-rules.js
 * @description Pure, dependency-FREE Secretary rules shared across the browser. Two security/behaviour
 *   boundaries that also exist server-side and MUST stay identical:
 *     - routeRoutineStep(step, bands)          — band-gate a Routine step (act → run · draft|ask → confirm · off → skip).
 *     - sanitizeProposedQuickActions(raw, …)   — the dynamic-quick-action security gate (only prompt|compose, never run).
 *   These MIRROR `src/services/secretary-tick.ts` (the browser can't import the TS server module, and the
 *   server can't import an importmap `/js/...` module). Because this file has ZERO imports, the E2E harness
 *   (run via tsx, which doesn't type-check `test/`) imports it DIRECTLY and runs the same vectors through it
 *   AND the TS helpers — so e2e-secretary's parity test PROVES the two copies agree (gap G6). Keep both
 *   sides byte-equivalent; if you change one, change the other and the parity vectors will confirm it.
 * @structure BANDS · routeRoutineStep · sanitizeProposedQuickActions
 * @usage import { routeRoutineStep, sanitizeProposedQuickActions } from '/js/services/secretary-rules.js';
 * @version-history
 *   v0.1.0 — 2026-06-28 — G6: extract the cross-runtime rules to a pure shared module + parity test.
 */

/** Autonomy bands, least → most restrictive. */
export const BANDS = ['act', 'draft', 'ask', 'off'];

/** Inputs a `compose` quick action may focus (must match the working cards the view renders). */
const QUICK_COMPOSE_TARGETS = new Set(['plan', 'find', 'note']);

/**
 * Band-gate a Routine step. A valid step-level `band` override wins, else the policy band, else the
 * conservative 'ask'. act → run · draft|ask → confirm · off → skip. (Mirror of secretary-tick.ts.)
 */
export function routeRoutineStep(step, bands) {
  const capability = String((step && step.capability) != null ? step.capability : '').trim();
  const override = (step && typeof step.band === 'string' && BANDS.includes(step.band)) ? step.band : null;
  const band = override != null ? override
    : ((bands && typeof bands[capability] === 'string') ? bands[capability] : 'ask');
  const disposition = band === 'off' ? 'skip' : band === 'act' ? 'run' : 'confirm';
  return { band, disposition };
}

/**
 * Sanitize brain-seeded / secretary-proposed quick actions — the SECURITY boundary: a non-core action may
 * ONLY be 'prompt' (a canned chat message) or 'compose' (focus an input) — never a 'run' verb. Malformed
 * entries are dropped. Returns normalized actions WITHOUT id/createdAt (callers stamp those). (Mirror of
 * secretary-tick.ts::sanitizeProposedQuickActions.)
 */
export function sanitizeProposedQuickActions(raw, source, status = 'proposed') {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const label = String(r.label != null ? r.label : '').trim().slice(0, 40);
    const kind = String(r.kind != null ? r.kind : '').trim();
    if (!label) continue;
    if (kind === 'compose') {
      const target = String(r.target != null ? r.target : '').trim();
      if (!QUICK_COMPOSE_TARGETS.has(target)) continue;
      out.push({ label, kind: 'compose', target, source, status });
    } else if (kind === 'prompt') {
      const prompt = String(r.prompt != null ? r.prompt : '').trim().slice(0, 500);
      if (!prompt) continue;
      out.push({ label, kind: 'prompt', prompt, source, status });
    }
    // kind === 'run' (or anything else) → dropped: the explicit security boundary.
  }
  return out.slice(0, 6);
}
