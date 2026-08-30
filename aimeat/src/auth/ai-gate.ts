/**
 * @file src/auth/ai-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may spend an owner's AI budget.
 *
 *   One rule, on every door that calls a model: an owner session, or a token carrying `ai:use`.
 *   It lived inside routes/ai.ts as a closure until the chat proxy needed the same answer, and a
 *   second copy of this test is precisely the shape the August 2026 audit kept finding — a
 *   permission word enforced on one door and not the next.
 * @structure assertAiUseAllowed(req, res, nodeId) — true when the caller may, and answers 403 when not
 * @usage if (!assertAiUseAllowed(req, res, config.nodeId)) return;
 * @version-history
 *   v1.1.0 — 2026-08-31 — The scope test is ASKED of scope-coverage.ts instead of restated here, so
 *     `ai:*` is honoured the way every other door honours a domain wildcard. Found auditing the AI
 *     jobs branch: its routes use requireScope('ai:use'), which asks, and this gate did not, so two
 *     doors onto the same money disagreed about one principal shape. test/unit/ai-gate.test.ts now
 *     asserts the equivalence over every shape rather than leaving two files to agree by
 *     inspection. Widens admission by exactly `ai:*`; nothing is narrowed.
 *   v1.0.0 — 2026-08-16 — Extracted verbatim from routes/ai.ts so the chat proxy shares it.
 */
import type { Request, Response } from 'express';
import { error } from '../middleware/envelope.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';

/**
 * True when this caller may spend the owner's AI budget; otherwise answers 403 and returns false.
 *
 * The owner branch is requireScope's owner branch, exclusions and all: an agent or ecosystem
 * session is scoped, and reaches an AI endpoint through `ai:use` or not at all. Testing
 * roles.includes('owner') on its own let a mirrored agent token (POST /v1/auth/token copied the
 * owner's roles onto it until 2026-08-11, audit H-2) spend the owner's AI budget without the word
 * the owner would have had to grant for it.
 */
export function assertAiUseAllowed(req: Request, res: Response, nodeId: string): boolean {
  const roles = req.auth?.roles ?? [];
  if (roles.includes('owner') && !roles.includes('agent') && !roles.includes('ecosystem')) return true;
  // ASKED, NEVER RESTATED. "Does this principal hold that word" is one rule and it lives in
  // scope-coverage.ts: the exact string, `{domain}:*`, `*` — and, for the words in
  // SCOPES_OUTSIDE_WILDCARD, the exact string alone. Written out by hand here it read
  // `includes('ai:use') || includes('*')`, which quietly refused the DOMAIN wildcard that every
  // other door on this node honours. So an owner who granted an agent `ai:*` got one that could
  // start an AI job (requireScope, which asks) and could not generate an image (this, which did
  // not), told to grant the AI permission they had just granted. If AI spend should be
  // wildcard-proof, that is one line in SCOPES_OUTSIDE_WILDCARD and every door inherits it —
  // which is the point of asking rather than restating.
  const scopes = (req.auth as { scopes?: string[] } | undefined)?.scopes ?? [];
  if (scopeIsCovered(scopes, 'ai:use')) return true;
  res.status(403).json(error(nodeId, 'FORBIDDEN',
    'AI completion requires an owner session or a token with the ai:use scope.'));
  return false;
}
