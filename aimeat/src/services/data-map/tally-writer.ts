/**
 * @file src/services/data-map/tally-writer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The hand a memory write door records for its caller in the write tally
 *   (./write-tally-buffer.ts recordMemoryTouch).
 *
 *   WHY. An app grant stores and reads as its owner, so its principal is the owner's GHII and its
 *   write was recorded as the owner's own. The living-document pulse decides whose permission an AI
 *   spend runs under by the latest writer of the config (services/living-pulse-spend.ts), and an app
 *   without ai:use that wrote a config read as the owner (secaudit2026oct31w2 round 10,
 *   f-2026aug-ai-paths-3). An app grant is now recorded as the app, `eco:<app>#<owner>@<node>`
 *   (callerPrincipal in utils/gaii.ts), the name the node already gives it for "who did this".
 *   Every other caller is recorded as the principal the door names, as before.
 * @structure tallyWriterOf(caller, nodeId, app?)
 * @usage recordMemoryTouch({ ownerGaii, key, writerPrincipal: tallyWriterOf(callerOf(req, nodeId, storage), nodeId, req.auth?.app), kind: 'write' });
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10, f-2026aug-ai-paths-3).
 */
import { callerPrincipal, localAccountName } from '../../utils/gaii.js';

/**
 * The tally's writer for a caller (a route's callerOf(req), or the memory-write service's caller): the
 * app for an app grant that names its app (`app`, the token's `owner/filename`), else `principal`.
 */
export function tallyWriterOf(c: { principal: string; roles: readonly string[] }, nodeId: string, app?: string): string {
  if (!c.roles.includes('app') || !app) return c.principal;
  return callerPrincipal({ sub: c.principal, owner: localAccountName(c.principal), roles: [...c.roles], app }, nodeId);
}
