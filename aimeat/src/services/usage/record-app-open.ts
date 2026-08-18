/**
 * @file src/services/usage/record-app-open.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Records that an app was opened, from the two places an app is actually served.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   WHAT THIS REPLACES. `AppDownload.count` is one lifetime integer per app: it can say an app has
 *   been opened 4 000 times and can never say whether that was last week or last year, by two
 *   people or by two hundred. It stays (the catalogue shows it); this adds the dimensions that make
 *   "is this app alive" answerable.
 *
 *   WHOSE CALL IT IS. `ownerGhii` is the VIEWER, because the question the owner cuts answer is
 *   "which apps does this person use". The app's author goes in `counterpartyGhii`, which is the
 *   same slot an exchange seller occupies, so an author reads their app's traffic through the same
 *   cut a capability provider reads theirs. An anonymous open carries no owner at all rather than
 *   being attributed to the author, which would make every public app look like its author's own use.
 * @structure
 *   - recordAppOpen({ appOwnerGaii, filename, viewer })
 * @usage
 *   recordAppOpen({ appOwnerGaii: app.ownerGaii, filename: app.filename, viewer: req.auth?.sub });
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: app opens become a measured, time-dimensioned surface.
 */
import { recordUsageCall } from './usage-buffer.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import type { UsageActorKind } from '../../storage/interface.js';

/** `undefined`, `''` and the literal 'anon' all mean nobody signed in. */
function isAnonymous(viewer?: string | null): boolean {
  return !viewer || viewer === 'anon';
}

function actorKindOf(principal: string): UsageActorKind {
  if (principal.startsWith('eco:')) return 'eco';
  if (principal.includes('#')) return 'agent';
  return 'owner';
}

export function recordAppOpen(args: {
  /** The app author's identity as stored on the app record. */
  appOwnerGaii: string;
  filename: string;
  /** The signed-in visitor, when there is one. */
  viewer?: string | null;
}): void {
  const anon = isAnonymous(args.viewer);
  const viewer = anon ? '' : args.viewer as string;
  recordUsageCall({
    ownerGhii: anon ? '' : ownerGhiiOf(viewer),
    actorGaii: viewer,
    actorKind: anon ? 'anon' : actorKindOf(viewer),
    surface: 'app',
    // The app id everywhere else in the node: `owner/filename`. Same string in the coordinate and
    // in appId, so a report can group by either without knowing which surface produced the row.
    coordinate: `${ownerGhiiOf(args.appOwnerGaii).split('@')[0]}/${args.filename}`,
    appId: `${ownerGhiiOf(args.appOwnerGaii).split('@')[0]}/${args.filename}`,
    counterpartyGhii: ownerGhiiOf(args.appOwnerGaii),
    outcome: 'ok',
  });
}
