/**
 * @file atelier-guide.js
 * @description What the prompt builder does with the node's answer to
 *   GET /v1/prompts/build-app-atelier: use it, fall back to Classic, or keep Atelier and say the
 *   load failed. One decision in one place, so every answer the node or the network can give has
 *   a test (test/unit/app-catalog-atelier-guide.test.ts).
 *
 *   WHY ONLY 404 MEANS "NO ATELIER". The route is public and exists on every node that has the
 *   Atelier track, so a 404 is the one answer that says the node predates it. A 401, 403, 500, a
 *   network failure or a body that is not the guide says the load failed, not that the track is
 *   missing; switching a new app to Classic on those turned a passing fault into a different build
 *   track with no word to the person (instruction audit re-check, 2026-11-08).
 * @usage import { atelierGuideOutcome } from './atelier-guide.js'
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */

/**
 * @param {number} status  the HTTP status, or 0 when the request never got an answer
 * @param {unknown} body   the parsed JSON body, or null when it did not parse
 * @returns {'ok' | 'absent' | 'error'}
 *   ok: the body carries the guide · absent: the node has no Atelier track (404) · error: anything else
 */
export function atelierGuideOutcome(status, body) {
  var prompt = body && typeof body === 'object' && body.data && typeof body.data === 'object' ? body.data.prompt : null;
  if (status >= 200 && status < 300 && typeof prompt === 'string' && prompt.trim()) return 'ok';
  if (status === 404) return 'absent';
  return 'error';
}
