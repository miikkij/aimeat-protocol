/**
 * @file ecosystem-automation.ts
 * @description The ecosystem-app automation-recipe trigger (feature B4). Observed at the memory-write
 *   site (the same hook as the ecosystem event plane): when a memory key is written for an owner, this
 *   checks the owner's ENABLED automation recipes and, for every recipe whose `trigger.keyGlob` matches
 *   the written key, materialises an agent task for each configured agent so the owner's agents reason
 *   over the freshly published data. It reuses the Scheduler's materialiseAgentTask() wake fan-out — it
 *   does NOT invent a parallel task type. B5 (organism routing) is now enforced: the recipe's organism
 *   is resolved (id or name) to one the owner controls, the triggered agent is attached to it (the same
 *   `agentGaiis` grant the owner makes by hand via POST /organisms/:id/agents) so it passes the workspace
 *   gate, and the task is stamped with the recipe provenance + organism + email/approval toggles so the
 *   completion hook (B6, in agent-tasks.ts) can email the owner. B7 (approval) is still deferred.
 *
 *   Best-effort + fully isolated: a recipe/agent failure is logged and never propagates, so a recipe
 *   problem can never break a memory write.
 * @structure
 *   - runAutomationRecipesForWrite(storage, config, writerIdentity, key) — the entry point hooked into PUT memory
 *   - resolveAndGrantOrganism(...) — B5: resolve the organism + attach the agent for report routing
 *   - matchesKeyGlob(glob, key) — the tiny prefix/`*` matcher (reuses the workflow globToRegExp)
 * @usage import { runAutomationRecipesForWrite } from '../services/ecosystem-automation.js';
 * @version-history
 *   v1.0.0 — 2026-06-15 — Created for ecosystem-app automation recipes (feature B4): data-published →
 *     materialise an agent task per configured agent.
 *   v1.1.0 — 2026-06-15 — B5 organism routing: resolve the recipe organism, grant the agent access,
 *     and stamp the task with recipe provenance + organism + email/approval (consumed by B6).
 */
import type { Storage, OrganismRecord } from '../storage/interface.js';
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
  } catch (err) {
    logger.warn('ecosystem-automation: suppressed failure, continuing', { error: String(err) });
    return false;
  }
}

/**
 * B5 — resolve the recipe's `organism` (an id or a name) to one the owner can write to, and ensure
 * the triggered agent is attached so it passes the organism's workspace membership gate in its own
 * right (the same `agentGaiis` grant the owner makes manually via POST /organisms/:id/agents).
 *
 * Resolution: try the value as an organism id first; else match by name among the organisms the
 * owner created or is an active member of. The owner must be creator/admin/member (we only attach an
 * agent the owner already controls to an organism the owner already belongs to — no privilege jump).
 *
 * Best-effort: any failure is logged and returns the resolved record (or null) without throwing —
 * the organism is still passed to the agent in its task, and a contract-driven agent can write via
 * the owner's credentials even if the auto-attach didn't happen.
 */
async function resolveAndGrantOrganism(
  storage: Storage,
  ownerGhii: string,
  ownerName: string,
  organismRef: string,
  agentGaii: string,
): Promise<OrganismRecord | null> {
  try {
    // Organism membership/creator is keyed by the bare owner name (per CLAUDE.md), but historic
    // records may store the full GHII — accept either form when checking control.
    const ownerForms = new Set([ownerName, ownerGhii]);
    let org = await storage.getOrganism(organismRef);
    if (!org) {
      // Fall back to a name lookup among the owner's own organisms (created or member of).
      const mine = await storage.listOrganisms({ member: ownerName, perPage: 200 }).catch(() => [] as OrganismRecord[]);
      org = mine.find(o => o.name === organismRef || o.id === organismRef) ?? null;
    }
    if (!org) {
      logger.warn('automation recipe organism not found — passing the ref to the agent anyway', { organismRef, owner: ownerName });
      return null;
    }
    // The owner must control this organism before we attach their agent to it.
    let controlled =
      ownerForms.has(org.creatorGhii) ||
      org.admins.some(a => ownerForms.has(a)) ||
      org.members.some(m => ownerForms.has(m));
    if (!controlled) {
      for (const form of ownerForms) {
        const membership = await storage.getMembership(org.id, form).catch(err => { logger.warn('resolveAndGrantOrganism: continuing after a suppressed failure', { error: String(err) }); return null; });
        if (membership && membership.status === 'active') { controlled = true; break; }
      }
    }
    if (!controlled) {
      logger.warn('automation recipe organism not owned/joined by the recipe owner — not attaching the agent', { organism: org.id, owner: ownerName });
      return org;
    }
    if (!org.agentGaiis.includes(agentGaii)) {
      await storage.updateOrganism(org.id, {
        agentGaiis: [...org.agentGaiis, agentGaii],
        updatedAt: new Date().toISOString(),
      });
      logger.info('automation recipe attached agent to organism for report routing', { organism: org.id, agentGaii });
    }
    return org;
  } catch (err) {
    logger.error('automation recipe organism resolution/grant failed', { organismRef, owner: ownerName, error: String(err) });
    return null;
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

        // B5 — organism routing: resolve the recipe's organism and ensure the agent can write
        // its report there. We pass the organism through to the task regardless of whether the
        // auto-attach succeeded (the agent's workspace contract performs the actual write).
        let organismRef: string | null = recipe.organism ?? null;
        if (organismRef) {
          const org = await resolveAndGrantOrganism(storage, ownerGhii, owner, organismRef, agentGaii);
          if (org) organismRef = org.id; // prefer the canonical id once resolved
        }

        const organismHint = organismRef
          ? ` Write your report and any \`support-advisory@1\` records into the "${organismRef}" organism ` +
            `(use the workspace your contract assigns). You have been granted access to it.`
          : '';
        const description =
          `The connected app "${recipe.app}" just published fresh data at memory key \`${key}\` ` +
          `(owner ${ownerGhii}). Read it and produce your analysis/advisories.${organismHint}`;

        const scope = [
          { name: 'recipe', value: recipe.id, type: 'text' as const, description: `Automation recipe for ${recipe.app}` },
          { name: 'source_key', value: key, type: 'memory_key' as const },
          ...(organismRef ? [{ name: 'organism', value: organismRef, type: 'text' as const, description: 'Where to write the report' }] : []),
        ];

        await scheduler.materialiseAgentTask({
          owner: ownerGhii,
          agentGaii,
          agentName,
          parentRef: recipe.id,
          title: `Process ${recipe.app} data: ${key}`,
          description,
          scope,
          resources: { memoryKeys: [key] },
          automation: {
            recipeId: recipe.id,
            app: recipe.app,
            organism: organismRef,
            email: !!recipe.email,
            requireApproval: !!recipe.requireApproval,
          },
        });
        logger.info('automation recipe materialised agent task', { owner, recipe: recipe.id, agentName, key });
      } catch (err) {
        // Never let one agent/recipe failure break the write or the other agents.
        logger.error('automation recipe task materialisation failed', { owner, recipe: recipe.id, agentName, key, error: String(err) });
      }
    }
  }
}
