/**
 * @file ecosystem-automation.ts
 * @description The ecosystem-app automation-recipe trigger (feature B4). Observed at the memory-write
 *   site (the same hook as the ecosystem event plane): when a memory key is written for an owner, this
 *   checks the owner's ENABLED automation recipes and, for every recipe whose `trigger.keyGlob` matches
 *   the written key, materialises an agent task for each configured agent so the owner's agents reason
 *   over the freshly published data. It reuses the Scheduler's materialiseAgentTask() wake fan-out — it
 *   does NOT invent a parallel task type. The downstream recipe fields (organism/email/requireApproval)
 *   are passed through as context (organism) but their enforcement is deferred (B5/B6/B7).
 *
 *   Best-effort + fully isolated: a recipe/agent failure is logged and never propagates, so a recipe
 *   problem can never break a memory write.
 * @structure
 *   - runAutomationRecipesForWrite(storage, config, writerIdentity, key) — the entry point hooked into PUT memory
 *   - matchesKeyGlob(glob, key) — the tiny prefix/`*` matcher (reuses the workflow globToRegExp)
 * @usage import { runAutomationRecipesForWrite } from '../services/ecosystem-automation.js';
 * @version-history
 *   v1.0.0 — 2026-06-15 — Created for ecosystem-app automation recipes (feature B4): data-published →
 *     materialise an agent task per configured agent.
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { globToRegExp } from './workflow/signal-eval.js';
import { getActiveScheduler } from './scheduler.js';
import { parseGaiiLoose, buildGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** A recipe's keyGlob matches a written key using the same glob grammar the event plane uses. */
export function matchesKeyGlob(glob: string, key: string): boolean {
  if (!glob) return false;
  try {
    return globToRegExp(glob).test(key);
  } catch {
    return false;
  }
}

/**
 * Observe a successful memory write and fire any matching automation recipes for the writer's owner.
 *
 * Loop guard: the recipe's `trigger.keyGlob` is scoped to the app's deposit keys (e.g.
 * `feedback.stats.*`), and the triggered agents write their analysis elsewhere — so an agent's own
 * write does not normally re-fire the recipe. As an extra cheap guard, we never materialise a task for
 * an agent that is itself the writer (so a triggered agent writing into a watched glob can't re-trigger
 * itself). Cross-owner writes can't match (recipes are owner-scoped). All work is best-effort.
 */
export async function runAutomationRecipesForWrite(
  storage: Storage,
  config: AimeatConfig,
  writerIdentity: string,
  key: string,
): Promise<void> {
  const owner = parseGaiiLoose(writerIdentity).owner;
  if (!owner) return;

  let recipes;
  try {
    recipes = await storage.listAutomationRecipesByOwner(owner);
  } catch (err) {
    logger.error('automation recipe lookup failed', { owner, key, error: String(err) });
    return;
  }
  if (!recipes.length) return;

  const matching = recipes.filter(r => r.enabled && r.trigger?.kind === 'data-published' && matchesKeyGlob(r.trigger.keyGlob, key));
  if (!matching.length) return;

  const scheduler = getActiveScheduler();
  if (!scheduler) {
    logger.warn('automation recipe matched but scheduler unavailable — cannot wake agents', { owner, key });
    return;
  }

  const ownerGhii = `${owner}@${config.nodeId}`;
  // Resolve the owner's agents once (name → GAII), so an unknown agent name is skipped, not a crash.
  let agentsByName: Map<string, string>;
  try {
    const agents = await storage.getAgentsByOwner(owner);
    agentsByName = new Map(agents.map(a => [a.name, a.gaii]));
  } catch (err) {
    logger.error('automation recipe agent lookup failed', { owner, key, error: String(err) });
    return;
  }

  for (const recipe of matching) {
    for (const agentName of recipe.agents ?? []) {
      try {
        const agentGaii = agentsByName.get(agentName) ?? buildGAII(agentName, owner, config.nodeId);
        // Skip unknown agents (not one of the owner's) and self-writes (loop guard).
        if (!agentsByName.has(agentName)) {
          logger.warn('automation recipe names an unknown agent — skipping', { owner, recipe: recipe.id, agentName });
          continue;
        }
        if (agentGaii === writerIdentity) continue;

        const organismHint = recipe.organism
          ? ` Store your analysis/advisories in the "${recipe.organism}" organism workspace.`
          : '';
        const description =
          `The connected app "${recipe.app}" just published fresh data at memory key \`${key}\` ` +
          `(owner ${ownerGhii}). Read it and produce your analysis/advisories.${organismHint}`;

        await scheduler.materialiseAgentTask({
          owner: ownerGhii,
          agentGaii,
          agentName,
          parentRef: recipe.id,
          title: `Process ${recipe.app} data: ${key}`,
          description,
          scope: [
            { name: 'recipe', value: recipe.id, type: 'text', description: `Automation recipe for ${recipe.app}` },
            { name: 'source_key', value: key, type: 'memory_key' },
          ],
          resources: { memoryKeys: [key] },
        });
        logger.info('automation recipe materialised agent task', { owner, recipe: recipe.id, agentName, key });
      } catch (err) {
        // Never let one agent/recipe failure break the write or the other agents.
        logger.error('automation recipe task materialisation failed', { owner, recipe: recipe.id, agentName, key, error: String(err) });
      }
    }
  }
}
