/**
 * @file src/services/publish-requests/door.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a service needs to ask the publish gate on a door's behalf, and the one way a
 *   door answers a filed request (plan doc-mvcn6c7e4e5q, V4). An organism, a board, a skill, a cortex
 *   and a workspace share each decide in their own service whether a change takes the target to
 *   public, because only the service knows the level the target resolves to (an organism's default,
 *   a cortex manifest's own metadata, a share merged with the stored one). The door hands the service
 *   its caller as a PublishGateInput; the service asks publishAskOf() before its first write and files
 *   the request with fileAskForDoor() after the target exists.
 *
 *   A service called without a PublishGateInput is not gated: the node's own internal writes (a
 *   bundle install, a restore, an approved request's applier) pass none.
 * @structure PublishGateInput · PublishRequestedBody · PublishNotAsked · DoorAsk · fileAskForDoor
 * @usage
 *   const ask = gate && isRaiseToPublic(from, to) ? publishAskOf(ctx, gate.caller, gate.app) : null;
 *   ... store at the level it had ...
 *   const asked = await fileAskForDoor(ctx, gate, ask.requester, draft, from);   // { publishRequest } | { warnings }
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial: organisms, boards, skills, cortexes, workspace shares (plan doc-mvcn6c7e4e5q, V4).
 */
import type { CallerContext } from '../caller-context.js';
import { fileAsk, publishRequestedBody } from './ask.js';
import type { PublishRequestDraft, PublishRequester, PublishStoreCtx } from './store.js';

/** The caller a door hands a service so the service can ask the publish gate. */
export interface PublishGateInput {
  caller: CallerContext;
  /** `owner/filename` of an app grant, so the request names the app that asked. */
  app?: string;
}

/** The `publish_request` block a door answers with. */
export type PublishRequestedBody = ReturnType<typeof publishRequestedBody>;

/** Stored at the level it had, and the request could not be filed (the owner's list is full). */
export interface PublishNotAsked { code: 'PUBLISH_NOT_ASKED'; message: string }

/** What a gated service adds to its success: the filed request, or the warning that none was filed. */
export interface DoorAsk { publishRequest?: PublishRequestedBody; warnings?: PublishNotAsked[] }

/**
 * File the request after the door stored the target at `keptAs`, and answer it the same on every
 * surface: the request body, or a PUBLISH_NOT_ASKED warning when the owner's list is full.
 */
export async function fileAskForDoor(
  ctx: PublishStoreCtx, gate: PublishGateInput, requester: PublishRequester,
  draft: Omit<PublishRequestDraft, 'requested_by'>, keptAs: string,
): Promise<DoorAsk> {
  const filed = await fileAsk(ctx, gate.caller.owner, requester, draft);
  if (filed.ok) return { publishRequest: publishRequestedBody(ctx, filed) };
  return { warnings: [{ code: 'PUBLISH_NOT_ASKED', message: `Saved as ${keptAs}, not public: ${filed.message}` }] };
}
