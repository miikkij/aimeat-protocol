/**
 * @file readiness-gate.ts
 * @description Middleware that checks agent readiness level before allowing operations.
 *   Readiness levels (basic/standard/full/expert) determine what the agent can do.
 *   Owners always bypass readiness gates.
 * @structure
 *   - requireReadiness(minLevel, config, storage) -- middleware factory
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Governance Phase C
 */

import type { Request, Response, NextFunction } from 'express';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { error } from './envelope.js';

const LEVEL_ORDER = ['basic', 'standard', 'full', 'expert'] as const;
type ReadinessLevel = typeof LEVEL_ORDER[number];

function levelIndex(level: string): number {
  const idx = LEVEL_ORDER.indexOf(level as ReadinessLevel);
  return idx >= 0 ? idx : 0;
}

/**
 * The same rule without an Express request, so a surface that has none can apply it.
 *
 * The MCP task tools had no readiness gate at all: an agent below the standard bar was refused by
 * POST /v1/agent-tasks/:id/events and wrote the same events freely through aimeat_task_event. The
 * gate was middleware, and middleware does not reach the other door — which is what
 * aimeat/no-express-in-service exists to stop.
 *
 * Returns a refusal message, or null when the agent may proceed. A non-agent principal, an agent
 * with no onboarding record, and one still onboarding all pass, exactly as the middleware lets them.
 */
export async function readinessRefusal(
  storage: Storage,
  agentGaii: string,
  minLevel: ReadinessLevel,
): Promise<string | null> {
  const onboarding = await storage.getOnboarding(agentGaii);
  if (!onboarding || onboarding.status !== 'completed') return null;

  if (onboarding.readinessOverride) {
    const now = new Date().toISOString();
    if (onboarding.readinessOverride.expiresAt > now
      && levelIndex(onboarding.readinessOverride.level) >= levelIndex(minLevel)) return null;
  }

  const effectiveLevel = onboarding.readinessLevel ?? 'basic';
  return levelIndex(effectiveLevel) < levelIndex(minLevel)
    ? `Agent readiness level '${minLevel}' required, current level is '${effectiveLevel}'.`
    : null;
}

export function requireReadiness(
  minLevel: ReadinessLevel,
  config: AimeatConfig,
  storage: Storage,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const isAgent = req.auth?.roles.includes('agent') ?? false;
    if (!isAgent) {
      next();
      return;
    }

    const agentGaii = req.auth!.sub;
    const onboarding = await storage.getOnboarding(agentGaii);

    // No onboarding record or still in progress: allow through
    // (readiness gates only enforce after onboarding completes)
    if (!onboarding || onboarding.status !== 'completed') {
      next();
      return;
    }

    // Check for non-expired override first
    if (onboarding.readinessOverride) {
      const now = new Date().toISOString();
      if (onboarding.readinessOverride.expiresAt > now) {
        if (levelIndex(onboarding.readinessOverride.level) >= levelIndex(minLevel)) {
          next();
          return;
        }
      }
    }

    const effectiveLevel = onboarding.readinessLevel ?? 'basic';
    if (levelIndex(effectiveLevel) < levelIndex(minLevel)) {
      res.status(403).json(error(config.nodeId, 'READINESS_INSUFFICIENT',
        `Agent readiness level '${minLevel}' required, current level is '${effectiveLevel}'.`));
      return;
    }

    next();
  };
}
