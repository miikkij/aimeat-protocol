/**
 * @file src/services/app-owner-scope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which owner an app write lands under, for a caller that came through MCP. Moved here
 *   WHOLE from app-lifecycle.ts, which still re-exports it, and changed in nothing.
 *
 *   WHY IT IS A FILE OF ITS OWN. app-lifecycle.ts imports app-publish.ts (publishing a draft is a
 *   publish). The app-ui and Design Book services asked app-lifecycle for this one function, so
 *   both of them depended, through it, on the publish. The day a publish needed the Design Book
 *   (app-book-parts.ts: a publish records the parts a page names) that was a cycle, and
 *   dependency-cruiser refused it. This function needs the identity parser and the grant lookup and
 *   nothing about drafts or publishing, so it sits below both.
 * @structure AppOwnerScope · resolveAppOwnerScope(storage, config, principal)
 * @usage const scope = await resolveAppOwnerScope(storage, config, principal);
 * @version-history
 *   v1.0.0 — 2026-09-20 — Extracted from app-lifecycle.ts, unchanged.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { ownAppScope } from './app-dev-grant.js';

/** The owner an app write lands under: the display/URL name, and the bucket key. */
export interface AppOwnerScope {
  ownerName: string;
  ownerGhii: string;
}

/**
 * Resolve an MCP principal to the owner scope its app writes belong to.
 *
 * Apps are OWNER-scoped whoever publishes them, and the bucket key is the owner's canonical GHII
 * from the identity table — the same key routes/apps.ts resolves through its `canonicalOwner`
 * closure and the same key the startup `mergeForkedAppBuckets()` migration consolidates onto. The
 * MCP tools composed `owner@nodeId` by hand instead, which agrees for a locally registered owner and
 * addresses a different bucket for anyone whose GHII record says otherwise. Two doors that disagree
 * about where an app lives is how the same owner ends up with two version counters.
 *
 * Returns null when the principal is not a GAII, which is the tools' existing "Failed to parse" case.
 */
export async function resolveAppOwnerScope(
  storage: Storage, config: AimeatConfig, principal: string,
): Promise<AppOwnerScope | null> {
  const parsed = parseGAII(principal);
  if (!parsed) return null;
  // The parse stays here, because it is this door's own rule about what a principal may look like and
  // the REST door's rule is a different one. Where the app LANDS is the part both doors share, and it
  // now lives in services/app-dev-grant.ts so that opening it to a second owner is one change.
  return ownAppScope(storage, config, parsed.owner);
}
