/**
 * @file security-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Security page in one read: what is happening at the door right now,
 *   who was turned away and with what, what was refused and kept, who holds the keys, and what the
 *   doors are set to. One implementation behind GET /v1/admin/security/overview and the
 *   aimeat_admin_security_overview tool, so both surfaces say the same thing.
 *
 *   THE NUMBERS EXPLAIN THEMSELVES OR THEY ARE NOT SHOWN. Every count carries a zone (healthy,
 *   watch, critical) decided HERE, from this instance's own readable history rather than from a
 *   constant somebody guessed for another node: refusals in the window are compared with the mean
 *   per day over the lines the log still holds. A window that is busier than twice its own mean is
 *   worth a look; a walled address or an open incident is the one thing that needs a person.
 *
 *   THE WINDOW IS THE LAST 24 HOURS, NOT "TODAY". Midnight is a timezone, and the operator, the
 *   server and the attacker rarely share one. A rolling day has one meaning everywhere.
 *
 *   HONEST ABOUT WHAT IT CANNOT SEE. The refusal log rotates at a byte ceiling and the reader takes
 *   at most one megabyte per generation, so the "mean per day" is over what is readable and says
 *   how many hours that covers; when the readable span is under a day, there is no mean and the
 *   row says so instead of inventing one.
 * @structure
 *   - summariseRefusals(lines, now)   -- pure: window counts, groupings, readable span, mean
 *   - zones(...)                       -- pure: the zone of each headline number
 *   - buildSecurityOverview(config, storage) -- the composed read the route and the tool serve
 * @usage
 *   const overview = await buildSecurityOverview(config, storage);
 * @version-history
 *   v1.0.0 -- 2026-09-05 -- Initial: the Security page in the poster face (wish
 *     wish-admin-security-view-direction-a, design canvas "AIMEAT Admin Security").
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { readRecentAuthFailures, authLogStatus, type AuthFailureLine } from './auth-audit.js';
import { listSecurityIncidents, type SecurityIncidentValue } from './security-incident.js';
import { getStats } from './stats.js';

/** The rolling window the headline counts cover. */
export const REFUSAL_WINDOW_HOURS = 24;
/** How many of the newest lines the page shows at once; the door reads up to READ_LINES. */
export const TAIL_LINES = 200;
export const READ_LINES = 1000;
/** How many entries each grouping keeps: enough to see a pattern, few enough to read. */
const TOP_N = 8;
/** Below this many refusals in the window nothing is a surge, whatever the mean says. */
const SURGE_FLOOR = 20;
/** Since-restart counters that are ordinary on a node with agents; past this they earn a look. */
const COUNTER_WATCH_AT = 100;

export type Zone = 'healthy' | 'watch' | 'critical';
export type SecurityStatus = 'quiet' | 'watch' | 'open';

export interface CountRow { key: string; count: number }
/** One credential fingerprint: how often, what kind, and whether it was turned away for being
 *  unusable (401, a dead token being retried) or for lacking authority (403, a real credential at
 *  doors it may not open). The two are different stories and the page tells them apart. */
export interface DigestRow extends CountRow { kind: string; refused_401: number; refused_403: number }

export interface RefusalSummary {
  window_hours: number;
  in_window: number;
  sources_in_window: number;
  /** Lines the tarpit wrote when it answered 429 without trying: a campaign that hit the wall. */
  walled_in_window: number;
  walled_sources: string[];
  by_door: CountRow[];
  by_source: CountRow[];
  by_credential: CountRow[];
  by_digest: DigestRow[];
  readable_lines: number;
  readable_from: string | null;
  readable_hours: number | null;
  /** Mean refusals per day over the readable span; null while that span is under a day. */
  mean_per_day: number | null;
  tail: AuthFailureLine[];
}

export interface HeadlineNumber { value: number; zone: Zone }

export interface SecurityOverview {
  generated_at: string;
  now: {
    status: SecurityStatus;
    refusals: HeadlineNumber & { window_hours: number; mean_per_day: number | null; readable_hours: number | null };
    sources: HeadlineNumber & { top_source: string | null; top_share: number | null };
    rate_limit_hits: HeadlineNumber;
    scope_denials: HeadlineNumber;
    auth_failures_total: number;
    open_incidents: HeadlineNumber;
    counters_since: string | null;
    uptime_seconds: number | null;
    log: { enabled: boolean; path: string; bytes: number; max_bytes: number; rotated_bytes: number };
  };
  refusals: RefusalSummary;
  incidents: { items: SecurityIncidentValue[]; open: number; total: number };
  accounts: {
    owners_total: number;
    operators: string[];
    deactivated: Array<{ name: string; since: string | null; by: string | null }>;
    managed_by_directory: number;
    two_step_on: number;
    registration_mode: AimeatConfig['registrationMode'];
    sso_enabled: boolean;
  };
  settings: {
    login_rate_limit: { max: number; window_ms: number };
    registration_rate_limit: { max: number; window_ms: number };
    admin_auth_rate_limit: { max: number; window_ms: number };
    password_lockout: { attempts: number; minutes: number };
    tarpit: { enabled: boolean; free_failures: number; step_ms: number; max_delay_ms: number; block_after: number; window_ms: number; max_concurrent: number };
    totp: { enabled: boolean; issuer: string; backup_codes: number; max_failed: number; lockout_seconds: number };
    passkeys_enabled: boolean;
    cors_origins: number;
    federation_auth_policy: AimeatConfig['federationAuthPolicy'];
    body_limit_mb: number;
    body_limit_large_mb: number;
    auth_log: { path: string; max_bytes: number };
  };
}

function topOf(lines: AuthFailureLine[], pick: (l: AuthFailureLine) => string | undefined, n = TOP_N): CountRow[] {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const key = pick(l);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

/**
 * The refusal log read as a story: the window's counts and groupings, and how much history the
 * log can still vouch for. Pure, so the thresholds are testable without a file.
 */
export function summariseRefusals(lines: AuthFailureLine[], now: Date = new Date()): RefusalSummary {
  const newestFirst = [...lines].sort((a, b) => b.ts.localeCompare(a.ts));
  const since = now.getTime() - REFUSAL_WINDOW_HOURS * 3_600_000;
  const inWindow = newestFirst.filter(l => {
    const t = Date.parse(l.ts);
    return Number.isFinite(t) && t >= since && t <= now.getTime() + 60_000;
  });
  const walled = inWindow.filter(l => l.code === 'ATTEMPTS_REFUSED');

  const oldest = newestFirst.length ? newestFirst[newestFirst.length - 1].ts : null;
  const newest = newestFirst.length ? newestFirst[0].ts : null;
  let readableHours: number | null = null;
  if (oldest && newest) {
    const span = Date.parse(newest) - Date.parse(oldest);
    readableHours = Number.isFinite(span) ? Math.round((span / 3_600_000) * 10) / 10 : null;
  }
  const meanPerDay = readableHours != null && readableHours >= 24
    ? Math.round((newestFirst.length / (readableHours / 24)) * 10) / 10
    : null;

  const digests = new Map<string, { count: number; kind: string; refused_401: number; refused_403: number }>();
  for (const l of inWindow) {
    if (!l.credential_digest) continue;
    const cur = digests.get(l.credential_digest) ?? { count: 0, kind: l.credential, refused_401: 0, refused_403: 0 };
    cur.count++;
    if (l.status === 403) cur.refused_403++; else cur.refused_401++;
    digests.set(l.credential_digest, cur);
  }

  return {
    window_hours: REFUSAL_WINDOW_HOURS,
    in_window: inWindow.length,
    sources_in_window: new Set(inWindow.map(l => l.ip || '?')).size,
    walled_in_window: walled.length,
    walled_sources: [...new Set(walled.map(l => l.ip || '?'))],
    by_door: topOf(inWindow, l => `${l.method} ${l.path}`),
    by_source: topOf(inWindow, l => l.ip || '?'),
    by_credential: topOf(inWindow, l => l.credential || 'none'),
    by_digest: [...digests.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, TOP_N)
      .map(([key, v]) => ({ key, count: v.count, kind: v.kind, refused_401: v.refused_401, refused_403: v.refused_403 })),
    readable_lines: newestFirst.length,
    readable_from: oldest,
    readable_hours: readableHours,
    mean_per_day: meanPerDay,
    tail: newestFirst.slice(0, TAIL_LINES),
  };
}

/** A window busier than twice its own mean earns a look; under the floor nothing does. */
export function refusalZone(inWindow: number, meanPerDay: number | null): Zone {
  if (inWindow < SURGE_FLOOR || meanPerDay == null) return 'healthy';
  return inWindow > 2 * meanPerDay ? 'watch' : 'healthy';
}

/** One address behind more than half of a busy window is a script or a person, not weather. */
export function sourcesZone(inWindow: number, topShare: number | null): Zone {
  if (inWindow < SURGE_FLOOR || topShare == null) return 'healthy';
  return topShare > 0.5 ? 'watch' : 'healthy';
}

export function counterZone(value: number): Zone {
  return value > COUNTER_WATCH_AT ? 'watch' : 'healthy';
}

export function statusOf(input: { open_incidents: number; walled: number; zones: Zone[] }): SecurityStatus {
  if (input.open_incidents > 0 || input.walled > 0) return 'open';
  return input.zones.includes('watch') || input.zones.includes('critical') ? 'watch' : 'quiet';
}

export async function buildSecurityOverview(config: AimeatConfig, storage: Storage): Promise<SecurityOverview> {
  const now = new Date();
  const log = authLogStatus();
  const refusals = summariseRefusals(log.enabled ? readRecentAuthFailures(READ_LINES).items : [], now);
  const incidents = await listSecurityIncidents(storage, config);

  const stats = getStats();
  const snap = stats ? stats.snapshot() : null;
  const rateLimitHits = Number(snap?.rate_limit_hits_total ?? 0);
  const scopeDenials = Number(snap?.scope_denials_total ?? 0);

  const owners = await storage.listOwners();
  const ghiis = await storage.listGHIIs();

  const topSource = refusals.by_source[0] ?? null;
  const topShare = topSource && refusals.in_window > 0 ? topSource.count / refusals.in_window : null;
  const zones = {
    refusals: refusalZone(refusals.in_window, refusals.mean_per_day),
    sources: sourcesZone(refusals.in_window, topShare),
    rateLimit: counterZone(rateLimitHits),
    scope: counterZone(scopeDenials),
    open: (incidents.open > 0 ? 'critical' : 'healthy') as Zone,
  };

  return {
    generated_at: now.toISOString(),
    now: {
      status: statusOf({ open_incidents: incidents.open, walled: refusals.walled_in_window, zones: Object.values(zones) }),
      refusals: { value: refusals.in_window, zone: zones.refusals, window_hours: refusals.window_hours, mean_per_day: refusals.mean_per_day, readable_hours: refusals.readable_hours },
      sources: { value: refusals.sources_in_window, zone: zones.sources, top_source: topSource?.key ?? null, top_share: topShare },
      rate_limit_hits: { value: rateLimitHits, zone: zones.rateLimit },
      scope_denials: { value: scopeDenials, zone: zones.scope },
      auth_failures_total: Number(snap?.auth_failures_total ?? 0),
      open_incidents: { value: incidents.open, zone: zones.open },
      counters_since: snap?.started_at ?? null,
      uptime_seconds: snap?.uptime_seconds ?? null,
      log,
    },
    refusals,
    incidents,
    accounts: {
      owners_total: owners.length,
      operators: owners.filter(o => o.roles.includes('operator')).map(o => o.name).sort(),
      deactivated: owners.filter(o => o.disabledAt).map(o => ({ name: o.name, since: o.disabledAt ?? null, by: o.disabledBy ?? null })),
      managed_by_directory: owners.filter(o => o.managedBy).length,
      two_step_on: ghiis.filter(g => g.totpEnabled === true).length,
      registration_mode: config.registrationMode,
      sso_enabled: config.ssoEnabled,
    },
    settings: {
      login_rate_limit: { max: config.loginRateLimitMax, window_ms: config.loginRateLimitWindowMs },
      registration_rate_limit: { max: config.registrationRateLimitMax, window_ms: config.registrationRateLimitWindowMs },
      admin_auth_rate_limit: { max: config.adminAuthRateLimitMax, window_ms: config.adminAuthRateLimitWindowMs },
      password_lockout: { attempts: config.passwordLockoutAttempts, minutes: config.passwordLockoutMinutes },
      tarpit: {
        enabled: config.loginTarpitEnabled, free_failures: config.loginTarpitFreeFailures, step_ms: config.loginTarpitStepMs,
        max_delay_ms: config.loginTarpitMaxDelayMs, block_after: config.loginTarpitBlockAfter,
        window_ms: config.loginTarpitWindowMs, max_concurrent: config.loginTarpitMaxConcurrent,
      },
      totp: { enabled: config.totpEnabled, issuer: config.totpIssuer, backup_codes: config.totpBackupCodeCount, max_failed: config.totpMaxFailedAttempts, lockout_seconds: config.totpLockoutSeconds },
      passkeys_enabled: config.passkeyEnabled,
      cors_origins: (config.corsAllowedOrigins ?? []).length,
      federation_auth_policy: config.federationAuthPolicy,
      body_limit_mb: config.jsonBodyLimitMb,
      body_limit_large_mb: config.jsonBodyLimitLargeMb,
      auth_log: { path: config.authLogPath, max_bytes: config.authLogMaxBytes },
    },
  };
}
