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
 *   v1.1.1 — 2026-09-26 — The app author's account name comes from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.1.0 — 2026-09-18 — `anonymous`: the node's synthetic anonymous principal is nobody, and an
 *     open it carries is an anonymous open. It had been counted as a signed-in one.
 *   v1.0.0 — 2026-08-14 — Initial: app opens become a measured, time-dimensioned surface.
 */
import { recordUsageCall } from './usage-buffer.js';
import { ownerGhiiOf, localAccountName } from '../../utils/gaii.js';
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
  /**
   * True when the principal on the request is the node's stand-in for nobody (`req.auth.anonymous`).
   * A node in anonymous mode gives every unauthenticated request a synthetic principal with a real
   * looking `sub`, so the viewer alone cannot say whether anybody was signed in. Until 2026-09-18
   * nobody passed this, and on such a node every anonymous open was filed as a signed-in person
   * named after the anonymous account (found by e2e-app-visitors, which read 5 signed-in of 5).
   */
  anonymous?: boolean;
}): void {
  const anon = !!args.anonymous || isAnonymous(args.viewer);
  const viewer = anon ? '' : args.viewer as string;
  recordUsageCall({
    ownerGhii: anon ? '' : ownerGhiiOf(viewer),
    actorGaii: viewer,
    actorKind: anon ? 'anon' : actorKindOf(viewer),
    surface: 'app',
    // The app id everywhere else in the node: `owner/filename`. Same string in the coordinate and
    // in appId, so a report can group by either without knowing which surface produced the row.
    coordinate: `${localAccountName(args.appOwnerGaii)}/${args.filename}`,
    appId: `${localAccountName(args.appOwnerGaii)}/${args.filename}`,
    counterpartyGhii: ownerGhiiOf(args.appOwnerGaii),
    outcome: 'ok',
  });
}
