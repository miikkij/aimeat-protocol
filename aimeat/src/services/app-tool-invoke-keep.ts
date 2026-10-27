/**
 * @file src/services/app-tool-invoke-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every agent and approved ecosystem app that called a published
 *   app tool over HTTP (POST /v1/apps/:owner/:filename/webmcp/tools/:tool) before that route started
 *   to ask exchange:write keeps calling it.
 *
 *   WHY. secaudit 2026-10 (routes/webmcp.ts, POST-webmcp-tools:no-scope-word-on-contract-draw-and-invoke)
 *   made the route ask exchange:write of an agent or ecosystem caller, the word its MCP twin
 *   aimeat_app_tool_invoke always asked, because such a call spends the person's contract budget or
 *   pacing and runs the provider's capability. The connector MCP (`aimeat connect`) and the CLI
 *   dispatch post to this route with the agent's own token, so an agent connected that way without
 *   exchange:write worked until the change. The developer's rule for the round: every use that worked
 *   before keeps working.
 *
 *   WHICH PRINCIPALS. An agent or an approved or active ecosystem app that existed before the step,
 *   does not hold exchange:write (scopeIsCovered, so `*` and `exchange:*` already pass), and has at
 *   least one call on the `apptool` usage surface in the hot usage table (services/metered-access.ts
 *   records every signed-in call of the route there, refused ones included; the table keeps 90 days,
 *   services/usage/archive-job.ts). Anonymous mode's shared agent is left out: anyone may hold it.
 *
 *   WHAT IT KEEPS. Nothing is written onto a scope list, because exchange:write also accepts contracts
 *   and places bids, which these principals never could. The step's record lists each kept principal
 *   with the scope list it held at the step, and the route lets a listed principal through while its
 *   current token still covers every word of that list (appToolInvokeKept). A word the person removes
 *   later ends the allowance; a word they add keeps it.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (APP_TOOL_INVOKE_KEEP_KEY), on any version, claimed
 *   before the work (services/once-only-step.ts). Awaited before the node serves
 *   (server-bootstrap/once-only-keep-steps.ts).
 * @structure APP_TOOL_INVOKE_KEEP_KEY · APP_TOOL_INVOKE_WORD · KeptInvoker · keepAppToolInvokeOnce(storage, config, opts?) ·
 *   appToolInvokeKept(storage, nodeId, principal, scopes)
 * @usage
 *   await keepAppToolInvokeOnce(storage, config, { existedBefore });            // boot
 *   if (await appToolInvokeKept(storage, config.nodeId, auth.sub, auth.scopes)) // routes/webmcp-invoke-gate.ts
 * @version-history
 *   2026-10-27 — secaudit2026oct26: the cutoff is never later than the rule's first try (keptBefore).
 *   v1.1.0 — 2026-10-27 — appToolInvokeKept also asks that the principal under the listed id is the
 *     one the step listed: same owner, and made before the step's time. A new agent under a released
 *     name is a new principal (secaudit2026oct26, keep-matched-by-reusable-identifier).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v72).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { claimOnceOnlyStep, keptBefore } from './once-only-step.js';
import { isSharedAnonymous } from './rest-scope-gates-migration.js';

/** The record under `system@<nodeId>` that lists the kept principals. */
export const APP_TOOL_INVOKE_KEEP_KEY = 'migrations.app-tool-invoke-exchange-write.keep';
/** The word the route asks of an agent or an ecosystem caller. */
export const APP_TOOL_INVOKE_WORD = 'exchange:write';

/** One principal the step kept, and the scope list it held then. */
export interface KeptInvoker { id: string; owner: string; kind: 'agent' | 'ecosystem'; scopes: string[] }

export interface AppToolInvokeKeepResult { ran: boolean; kept: KeptInvoker[] }

/** Created before `cutoff`; a record without a readable time is taken as existing. */
function existed(createdAt: string | undefined, cutoff: number): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isNaN(t) || t < cutoff;
}

const ownerGhii = (owner: string, nodeId: string) => (owner.includes('@') ? owner : `${owner}@${nodeId}`);

/** True when `principal` called the app-tool route at least once in the hot usage table. */
async function calledAppTools(storage: Storage, principal: string, owner: string, nodeId: string): Promise<boolean> {
  return (await storage.countUsageCalls({ ownerGhii: ownerGhii(owner, nodeId), actorGaii: principal, surface: 'apptool' })) > 0;
}

/**
 * List every agent and ecosystem app that called the route before this step without exchange:write,
 * once. Throws when a read or the record write fails, and then leaves no record, so the next start
 * tries again.
 */
export async function keepAppToolInvokeOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, opts: { existedBefore?: string } = {},
): Promise<AppToolInvokeKeepResult> {
  const result: AppToolInvokeKeepResult = { ran: false, kept: [] };
  const system = `system@${config.nodeId}`;
  const claim = await claimOnceOnlyStep(storage, system, APP_TOOL_INVOKE_KEEP_KEY);
  if (!claim) return result;
  const cutoff = keptBefore(claim, opts.existedBefore);   // never later than the rule's first try (secaudit2026oct26)
  try {
    for (const agent of await storage.listAgents()) {
      if (!existed(agent.createdAt, cutoff) || isSharedAnonymous(agent.owner)) continue;
      const scopes = agent.defaultScopes ?? [];
      if (scopeIsCovered(scopes, APP_TOOL_INVOKE_WORD)) continue;
      if (!await calledAppTools(storage, agent.gaii, agent.owner, config.nodeId)) continue;
      result.kept.push({ id: agent.gaii, owner: agent.owner, kind: 'agent', scopes: [...scopes] });
    }
    for (const owner of await storage.listOwners()) {
      if (isSharedAnonymous(owner.name)) continue;
      for (const app of await storage.getEcosystemAppsByOwner(owner.name)) {
        if (app.status !== 'approved' && app.status !== 'active') continue;
        if (!existed(app.createdAt, cutoff)) continue;
        const scopes = app.scopes ?? [];
        if (scopeIsCovered(scopes, APP_TOOL_INVOKE_WORD)) continue;
        if (!await calledAppTools(storage, app.geai, app.owner, config.nodeId)) continue;
        result.kept.push({ id: app.geai, owner: app.owner, kind: 'ecosystem', scopes: [...scopes] });
      }
    }
    await claim.finish({ at: new Date().toISOString(), word: APP_TOOL_INVOKE_WORD, principals: result.kept });
  } catch (err) {
    await claim.release();
    throw err;
  }
  result.ran = true;
  if (result.kept.length > 0) {
    logger.info(`App-tool invoke: ${result.kept.length} agent(s) and ecosystem app(s) that called app tools over HTTP `
      + `without ${APP_TOOL_INVOKE_WORD} keep calling them`, { principals: result.kept.map(p => p.id) });
  }
  return result;
}

/**
 * True when the step kept `principal` and the token it calls with still covers every word it held at
 * the step. A read failure answers false, so the route refuses as it would without the allowance.
 */
export async function appToolInvokeKept(
  storage: Storage, nodeId: string, principal: string, scopes: readonly string[],
): Promise<boolean> {
  const rec = await storage.getMemory(`system@${nodeId}`, APP_TOOL_INVOKE_KEEP_KEY).catch((err: unknown) => {
    logger.warn('app-tool invoke: the keep record could not be read; the call is asked for the word', { error: String(err) });
    return null;
  });
  const value = rec?.value as { principals?: unknown; at?: unknown } | undefined;
  const listed = value?.principals;
  if (!Array.isArray(listed)) return false;
  const kept = listed.find((p): p is KeptInvoker => !!p && typeof p === 'object' && (p as KeptInvoker).id === principal);
  if (!kept || !Array.isArray(kept.scopes)) return false;
  if (!kept.scopes.every((w) => scopeIsCovered(scopes, w))) return false;
  return isTheKeptPrincipal(storage, kept, typeof value?.at === 'string' ? value.at : undefined);
}

/**
 * Is the principal under this id now the one the step listed? An agent name and an ecosystem app
 * name are released with the principal, and a new one under the same name is made later than the
 * step, so a record made after the step's time is a new principal and the allowance is not its
 * (secaudit2026oct26, keep-matched-by-reusable-identifier). A record without a readable time, or a
 * step record without one, is taken as the kept principal, as the step itself took it.
 */
async function isTheKeptPrincipal(storage: Storage, kept: KeptInvoker, stepAt: string | undefined): Promise<boolean> {
  const current = kept.kind === 'ecosystem' ? await storage.getEcosystemApp(kept.id) : await storage.getAgent(kept.id);
  if (!current || current.owner !== kept.owner) return false;
  const step = stepAt ? Date.parse(stepAt) : NaN;
  return Number.isNaN(step) || existed(current.createdAt, step);
}
