/**
 * @file src/services/internet-opening/opening-door.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the REST routes and the MCP tools do with a caller, once: build the actor from the
 *   caller object, and send an agent's or an app's opening through the owner first. Opening an app to
 *   the internet is making something public, so the node's publish gate (services/publish-gate.ts)
 *   decides whether an agent or an app may do it on its own; when it may not, the opening becomes a
 *   request the owner approves (kind 'internet-opening', publish-requests/apply-internet-opening.ts),
 *   and after the owner's approval it goes the way the owner's own opening would.
 * @structure actorOf · openingDoor
 * @usage const r = await openingDoor(ctx, caller, { filename, reason, days });
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import type { CallerContext } from '../caller-context.js';
import { publishAskOf, fileAsk, publishRequestedBody } from '../publish-requests/ask.js';
import { requestOpening, ineligible, type OpeningActor, type OpeningResult, type OpeningOutcome } from './opening-service.js';
import { openingMode } from './opening-policy.js';
import type { OpeningCtx } from './opening-store.js';
import type { InternetOpening } from './opening-types.js';

/** The actor an opening records, from the caller object (services/caller-context.ts). */
export async function actorOf(caller: CallerContext): Promise<OpeningActor> {
  return { principal: caller.principal, owner: caller.owner, operator: await caller.operator() };
}

export type OpeningDoorAnswer =
  | { outcome: OpeningOutcome; opening: InternetOpening }
  | { outcome: 'owner_asked'; publish_request: ReturnType<typeof publishRequestedBody> };

/** Open the caller's own app, ask an operator, or ask the owner first when an agent may not on its own. */
export async function openingDoor(
  ctx: OpeningCtx, caller: CallerContext, input: { filename: string; reason: unknown; days?: unknown },
): Promise<OpeningResult<OpeningDoorAnswer>> {
  if (caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'A session from another node has no app here to open.' };
  const actor = await actorOf(caller);
  if (!caller.inPerson) {
    const ask = publishAskOf(ctx, caller);
    if (ask.kind === 'refused') return { ok: false, status: ask.status, code: ask.code, message: ask.message };
    if (ask.kind === 'ask') {
      // The same refusals the opening itself would give, before the owner is asked anything.
      const mode = openingMode(ctx.config);
      if (mode === 'not-needed') return { ok: false, status: 409, code: 'NOT_NEEDED', message: 'This node shows its content to anyone already, so an app needs no opening.' };
      if (mode === 'off') return { ok: false, status: 403, code: 'OPENING_OFF', message: 'The operators of this node have switched opening apps to the internet off.' };
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (reason.length < 3) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Give the reason the app is opened to the internet: who it is for and what they do there.' };
      const app = await ctx.storage.getApp(`${caller.owner}@${ctx.config.nodeId}`, input.filename);
      const bad = ineligible(app);
      if (bad) return bad;
      const filed = await fileAsk(ctx, caller.owner, ask.requester, {
        kind: 'internet-opening',
        target: {
          owner: caller.owner, filename: input.filename, version: app!.versionNumber, reason: reason.slice(0, 500),
          ...(input.days !== undefined && input.days !== null ? { days: Number(input.days) } : {}),
        },
        title: `the app ${input.filename} open to the internet`,
        name: input.filename,
        change: { field: 'internet_opening', from: 'closed', to: 'open' },
      });
      if (!filed.ok) return { ok: false, status: filed.status, code: filed.code, message: filed.message };
      return { ok: true, data: { outcome: 'owner_asked', publish_request: publishRequestedBody(ctx, filed) } };
    }
  }
  return requestOpening(ctx, actor, input);
}
