/**
 * @file src/services/deprecation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node does when it still accepts a form that a later release removes (Core
 *   2026-11 HTTP-07 and HTTP-08, ruling decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l
 *   Q14).
 *
 *   ONE MECHANISM FOR EVERY REMOVAL. Each removal names its release in its own `*_REMOVED_IN`
 *   constant, beside the code it gates, and asks `removedFrom(CONSTANT)`: true when the running
 *   version (utils/version.ts getSoftwareVersion) is at or past it. From that release the old form is
 *   refused whatever the configuration says; a setting that kept it on has no effect. Before it, the
 *   setting decides, and each accepted use calls `noteDeprecatedUse`, which:
 *     - counts it in the stats counter family `deprecated_use` by kind (GET /v1/stats,
 *       `deprecated_use_by_type`), so an operator can see when the count reaches zero;
 *     - logs it at most once a day per kind, naming the release that removes it and what to use;
 *     - when the use happens inside an HTTP request, sets `Deprecation: true`, a `Link` with
 *       `rel="successor-version"` when there is a successor, and `X-AIMEAT-Removed-In` on that response
 *       (through the request context the request-id middleware opens, so a service does not need the
 *       Express response).
 *
 *   The WebSocket upgrade (auth/ws-upgrade.ts) and the MCP OAuth gate (mcp/oauth-binding.ts) keep
 *   their own counters, which predate this module and are read by name.
 * @structure removedFrom · DeprecatedUse · deprecationHeaders · noteDeprecatedUse ·
 *   resetDeprecationNoticesForTest
 * @usage
 *   if (removedFrom(OWNER_KEY_LOGIN_REMOVED_IN)) return refuse();
 *   noteDeprecatedUse({ kind: 'owner_key_login', removedIn: OWNER_KEY_LOGIN_REMOVED_IN,
 *     successor: '/v1/ghii/login', notice: 'An owner signed in with the account key.' });
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-4-0-0-n-poistot-koodiin-versioporttina-ei-kommenttina).
 */
import { getSoftwareVersion, versionAtLeast } from '../utils/version.js';
import { requestContext, logger } from '../utils/logger.js';
import { getStats } from './stats.js';

/** True when the running version (or `version`) is at or past `release`: the old form is gone. */
export function removedFrom(release: string, version: string = getSoftwareVersion()): boolean {
  return versionAtLeast(version, release);
}

/** One accepted use of a deprecated form. */
export interface DeprecatedUse {
  /** The counter key, snake_case: `owner_key_login`, `ws_query_token`, ... */
  kind: string;
  /** The release that removes it, from its own `*_REMOVED_IN` constant. */
  removedIn: string;
  /** The path or field to use instead, when there is one. Sent as the successor link. */
  successor?: string;
  /** One sentence saying what was accepted. The log adds the release and the successor. */
  notice: string;
}

/** The response headers that name a deprecated form (HTTP-07). */
export function deprecationHeaders(use: Pick<DeprecatedUse, 'removedIn' | 'successor'>): Record<string, string> {
  return {
    Deprecation: 'true',
    'X-AIMEAT-Removed-In': use.removedIn,
    ...(use.successor ? { Link: `<${use.successor}>; rel="successor-version"` } : {}),
  };
}

const lastNoticeDay = new Map<string, string>();

/** Count the use, log it once a day per kind, and name it on the current HTTP response if any. */
export function noteDeprecatedUse(use: DeprecatedUse, meta: Record<string, unknown> = {}): void {
  getStats()?.incrementTyped('deprecated_use', use.kind);
  const setHeader = requestContext.getStore()?.setHeader;
  if (setHeader) {
    for (const [name, value] of Object.entries(deprecationHeaders(use))) setHeader(name, value);
  }
  const day = new Date().toISOString().slice(0, 10);
  if (lastNoticeDay.get(use.kind) === day) return;
  lastNoticeDay.set(use.kind, day);
  logger.warn(
    `${use.notice} This is deprecated and removed in ${use.removedIn}; from that release it is refused whatever the configuration says.`
    + (use.successor ? ` Use ${use.successor} instead.` : '')
    + ` GET /v1/stats counts the uses (deprecated_use: ${use.kind}). Logged once a day.`,
    { kind: use.kind, removedIn: use.removedIn, ...meta },
  );
}

/** Tests only: forget which kinds were logged today. */
export function resetDeprecationNoticesForTest(): void {
  lastNoticeDay.clear();
}
