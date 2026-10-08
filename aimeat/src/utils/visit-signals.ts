/**
 * @file src/utils/visit-signals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads, off one request, the few things the AI visibility counter classifies: the
 *   User-Agent, the Referer, `utm_source`, whether the visitor asked not to be followed, and the
 *   hosts that belong to this place. The counter turns them into a channel and an AI name and keeps
 *   nothing else (services/visibility/visibility-counter.ts).
 *
 *   A getter rather than an Express request, the same shape utils/geo-headers.ts takes, so a
 *   service can be handed the result without importing the web framework.
 * @structure VisitSignals · optedOut · visitSignals
 * @usage countVisit(storage, config, { ownerGaii, target, ...visitSignals((n) => req.get(n), req.query.utm_source, req.hostname, config.baseUrl) });
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */

export interface VisitSignals {
  userAgent: string | null;
  referer: string | null;
  utmSource: string | null;
  optedOut: boolean;
  selfHosts: string[];
}

/**
 * Whether the visitor asked not to be followed: `Sec-GPC: 1` (Global Privacy Control, which the
 * CCPA treats as an opt-out) or `DNT: 1`. Such a request counts in the day's total and nowhere else.
 */
export function optedOut(get: (name: string) => string | undefined | null): boolean {
  return (get('sec-gpc') ?? '').trim() === '1' || (get('dnt') ?? '').trim() === '1';
}

export function visitSignals(
  get: (name: string) => string | undefined | null,
  /** The request's `utm_source` query value, as the route read it. */
  utmSource: unknown,
  host: string | undefined | null,
  baseUrl: string | undefined | null,
): VisitSignals {
  const utm = typeof utmSource === 'string' ? utmSource.slice(0, 100) : null;
  const selfHosts: string[] = [];
  if (host) selfHosts.push(host.toLowerCase());
  const apex = baseUrl ? URL.parse(baseUrl)?.hostname : null;
  if (apex) selfHosts.push(apex.toLowerCase());
  return {
    userAgent: get('user-agent') ?? null,
    referer: get('referer') ?? null,
    utmSource: utm,
    optedOut: optedOut(get),
    selfHosts,
  };
}
