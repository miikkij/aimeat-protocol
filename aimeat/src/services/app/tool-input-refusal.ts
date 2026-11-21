/**
 * @file src/services/app/tool-input-refusal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The input check of an app tool as both callers run it: aimeat_app_tool_invoke
 *   (mcp/exchange-run.ts) and POST /v1/apps/:owner/:filename/webmcp/tools/:tool (routes/webmcp.ts).
 *
 *   WHY A SECOND FILE. checkAppToolInput (tool-input.ts) is a pure function of the schema and the
 *   input. A refusal needs two things that read storage, and both callers need both, so they live
 *   here once instead of twice:
 *
 *   - THE BOUND SKILL. An app's operating guide is a skill bound to it (metadata.binding
 *     `app:<owner>/<filename>`). An agent that guesses at a tool's input has usually not read that
 *     guide, and the refusal is the moment it is reading closely, so the refusal names the skills the
 *     caller can load. Asked only on a refusal, because the listing reads every skill manifest.
 *   - THE COUNT. A refusal here happened before the metered gate (services/metered/access.ts), which
 *     is where every other app-tool call is recorded on the `apptool` usage surface. So the app's
 *     own tools showed no refusals while one call in seven to aimeat_app_tool_invoke failed, and
 *     nobody could tell which tool's schema was being missed. Each refusal is recorded on the tool's
 *     own coordinate as `refused`, reason INVALID_INPUT, the way the gate records its refusals.
 * @structure checkAppToolInputOrRefuse(deps, args) → AppToolInputCheck
 * @usage
 *   const check = await checkAppToolInputOrRefuse({ storage, config }, { ownerName, filename, tool: toolDef, input, callerGaii });
 *   if (!check.ok) return fail(`INVALID_INPUT: ${check.message}`);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-app-ty-kalujen-skeemavirheet-ly-korjaa-kutsun-yhdell-yrityks).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { listSkillsByBinding } from '../skills.js';
import { recordUsageCall } from '../usage/usage-buffer.js';
import { usageActorOfPrincipal } from '../caller-facts.js';
import { localAccountName, ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { isAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { appDisplayName } from './app-ref.js';
import { checkAppToolInput, type AppToolInputCheck } from './tool-input.js';

export interface AppToolInputArgs {
  /** The app owner's account name. */
  ownerName: string;
  /** The app's stored filename (`lifecycle-central.html`). */
  filename: string;
  tool: { name: string; inputSchema?: Record<string, unknown> };
  /** The input already merged with the tool's locked input. */
  input: Record<string, unknown>;
  /** The caller's principal, or null for a call without a session. */
  callerGaii: string | null;
}

/** The refs of the skills bound to the app that `callerGaii` can load. Empty when the listing fails. */
async function boundSkillRefs(
  deps: { storage: Storage; config: AimeatConfig }, ownerName: string, filename: string, callerGaii: string | null,
): Promise<string[]> {
  try {
    // A caller of this node reads what its account may read (a `members` skill among them); a visitor
    // from another node and a call without a session read the public skills only, as on GET /v1/skills.
    // The shared anonymous principal is no account either (mcp/skills.ts reads it the same way).
    const ownerGhii = callerGaii ? ownerGhiiOf(callerGaii) : '';
    const local = ownerGhii.endsWith(`@${deps.config.nodeId}`) && !isAnonymousPrincipal({ sub: callerGaii ?? '' });
    const accessor = callerGaii && local
      ? { ownerName: localAccountName(ownerGhii), sub: callerGaii, gaii: callerGaii }
      : { ownerName: null };
    const skills = await listSkillsByBinding(deps.storage, deps.config, `app:${ownerName}/${filename}`, accessor);
    return skills.map(s => s.ref);
  } catch (err) {
    // The skill line is a hint on a refusal that already says what was wrong; the refusal stands without it.
    logger.warn('app tool input refusal: bound skills not listed', { app: `${ownerName}/${filename}`, error: String(err) });
    return [];
  }
}

/**
 * Check an app tool's input. On a refusal, name the skills bound to the app and record the refusal on
 * the tool's usage coordinate; an input that passes reads nothing and records nothing.
 */
export async function checkAppToolInputOrRefuse(
  deps: { storage: Storage; config: AimeatConfig }, args: AppToolInputArgs,
): Promise<AppToolInputCheck> {
  const first = checkAppToolInput(args.tool, args.input);
  if (first.ok) return first;

  if (args.callerGaii) {
    recordUsageCall({
      ownerGhii: ownerGhiiOf(args.callerGaii),
      actorGaii: args.callerGaii,
      actorKind: usageActorOfPrincipal(args.callerGaii),
      surface: 'apptool',
      coordinate: `apptool:${args.ownerName}/${args.filename}/${args.tool.name}`,
      appId: `${args.ownerName}/${args.filename}`,
      counterpartyGhii: `${args.ownerName}@${deps.config.nodeId}`,
      outcome: 'refused',
      reason: 'INVALID_INPUT',
    });
  }

  const skills = await boundSkillRefs(deps, args.ownerName, args.filename, args.callerGaii);
  return checkAppToolInput(args.tool, args.input, {
    skills,
    app: { owner: args.ownerName, name: appDisplayName(args.filename) },
  });
}
