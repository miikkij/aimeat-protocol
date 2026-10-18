/**
 * @file src/services/closed-node-level.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The level a write asking for public gets on a node that shows its content to its own
 *   signed-in accounts only (config contentAccess 'signed-in', config-visibility.ts signedInOnly;
 *   plan doc-mvcn6c7e4e5q, V1.6, ruled by Jouni on 2026-10-18).
 *
 *   THE RULE. A NEW write or a change that asks for public is stored at the kind's signed-in level
 *   instead ('members' for a memory record, a stored file, a user skill, a package, a knowledge
 *   package and its entries, a data package; 'account' for a workspace share), and the success
 *   answer carries one warning, PUBLIC_IS_SIGNED_IN_HERE, saying so. The stored value then matches
 *   what the node serves, an app reading at that level keeps working (a signed-in account reads it),
 *   and opening the node later exposes nothing by accident.
 *
 *   WHAT IS NOT TOUCHED. Content that is public already (from === publicValue) keeps its value: it was
 *   made public while the node was open, and switching the node back to open restores it. A level
 *   other than public passes through as it came.
 *
 *   ORDER. Every caller asks this BEFORE the publish gate (services/publish-gate.ts): a write lowered
 *   to the signed-in level is not a raise to public, so no publish request is filed for it. A node
 *   content default of public (services/content-defaults.ts) is computed first and lowered here too.
 *
 *   Kinds with no signed-in level of their own (an organism, a board, an app listing, a cortex
 *   library, a welcome page, a company front page) do not call this: the node's content gate
 *   (middleware/content-access-gate.ts) already hides them from callers without an account.
 * @structure ClosedNodeWarning · PUBLIC_IS_SIGNED_IN_HERE · closedNodeLevel(config, requested,
 *   signedInValue, opts) · closedNodeWarnings(warning)
 * @usage
 *   const closed = closedNodeLevel(config, visibility, 'members', { from: existing?.visibility });
 *   visibility = closed.level;   // then the publish gate, then the write
 *   res.json(success(nodeId, { ...body, ...closedNodeWarnings(closed.warning) }));
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V1.6).
 */
import { signedInOnly, type ContentAccess } from '../config-visibility.js';

export const PUBLIC_IS_SIGNED_IN_HERE = 'PUBLIC_IS_SIGNED_IN_HERE' as const;

/** The warning a success answer carries when a public write was stored at the signed-in level. */
export interface ClosedNodeWarning {
  code: typeof PUBLIC_IS_SIGNED_IN_HERE;
  message: string;
}

const MESSAGE = 'This node shows its content to its signed-in accounts only, so this was saved for signed-in accounts and not as public.';

/** The one warning, worded once. */
export function closedNodeWarning(): ClosedNodeWarning {
  return { code: PUBLIC_IS_SIGNED_IN_HERE, message: MESSAGE };
}

/**
 * The level to store. On a closed node a request for `publicValue` (default 'public') on content that
 * is not public now (`from`, undefined for new content) becomes `signedInValue`, with the warning.
 * Anything else comes back as it was asked, with no warning.
 */
export function closedNodeLevel<R, S>(
  config: { contentAccess?: ContentAccess },
  requested: R,
  signedInValue: S,
  opts: { from?: unknown; publicValue?: unknown } = {},
): { level: R | S; warning: ClosedNodeWarning | null } {
  const publicValue = opts.publicValue ?? 'public';
  if (!signedInOnly(config) || requested !== publicValue || opts.from === publicValue) {
    return { level: requested, warning: null };
  }
  return { level: signedInValue, warning: closedNodeWarning() };
}

/**
 * `{ warnings: [warning] }` to spread into a success body, or nothing. It stands where a door's filed
 * publish request would, so its type names `publish_request` as absent.
 */
export function closedNodeWarnings(warning: ClosedNodeWarning | null | undefined): { warnings?: ClosedNodeWarning[]; publish_request?: undefined } {
  return warning ? { warnings: [warning] } : {};
}
