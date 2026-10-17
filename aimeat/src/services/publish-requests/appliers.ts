/**
 * @file src/services/publish-requests/appliers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an approved publish request does, per kind of content (plan doc-mvcn6c7e4e5q,
 *   V4.3). Each applier makes one target public AS THE OWNER, through the code path the owner's own
 *   change takes, after checking that the target is still what the owner was asked about: there,
 *   the owner's or one of their agents', and unchanged since the request. If it is not, it answers
 *   why, and the request is settled `outdated` (decide.ts).
 *
 *   A kind without an applier here cannot be approved; its door files no request either.
 *   Each applier lives in its own `apply-<kind>.ts` and takes the PublishApplier shape (store.ts).
 * @structure PUBLISH_APPLIERS
 * @usage const applied = await PUBLISH_APPLIERS[request.kind]?.(ctx, ownerGhii, request);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial: memory records (plan doc-mvcn6c7e4e5q, V4.3).
 */
import type { PublishApplier, PublishKind } from './store.js';
import { applyMemoryPublish } from './apply-memory.js';

/** One applier per kind of content a request can make public. */
export const PUBLISH_APPLIERS: Partial<Record<PublishKind, PublishApplier>> = {
  memory: applyMemoryPublish,
};
