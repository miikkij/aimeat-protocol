/**
 * @file src/middleware/ai-call-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account's AI call limit (services/account-limits.ts takeAiCall) as route
 *   middleware, for the AI routes whose service no MCP tool calls: POST /v1/ai/complete, POST
 *   /v1/openrouter/complete, POST /v1/llm/chat/completions and the decision key tests. Those
 *   services (completeForOwner, the chat proxy, testDecideKey) also serve schedules, workflow steps,
 *   the classifier and the refinery, so the count sits on the route rather than in the service.
 *
 *   It replaces the per-principal path limiter these routes had, so an owner and every agent and app
 *   acting for them draw on the one allowance the AI services and MCP tools count. Placed after
 *   requireAuth(); keyed on resolveIdentity(), never on a value from the request body.
 * @structure aiCallLimit(config)
 * @usage router.post('/v1/ai/complete', requireAuth(), aiCallLimit(config), handler)
 * @version-history
 *   v1.0.0 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import { resolveIdentity } from '../utils/gaii.js';
import { takeAiCall } from '../services/account-limits.js';
import { error } from './envelope.js';

export function aiCallLimit(config: AimeatConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return next();
    const turn = takeAiCall(config, resolveIdentity(req.auth, config.nodeId));
    if (turn.ok) return next();
    res.setHeader('Retry-After', String(turn.retryAfterSec));
    res.status(429).json(error(config.nodeId, turn.code, turn.message, 429, { retry_after_sec: turn.retryAfterSec }));
  };
}
