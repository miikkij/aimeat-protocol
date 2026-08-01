/**
 * @file src/services/workflow/engine-util.ts
 * @description Small pure helpers shared across the workflow engine modules — localized-string
 *   display (loc) and key-template substitution (template). Extracted from engine.ts to satisfy
 *   max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-01 — runDateIn(): the run date is resolved in the SCHEDULE's timezone.
 *     It was UTC while the cron was not, so any workflow firing between midnight and the UTC
 *     offset was stamped with yesterday — and with skip_done that is a silent no-op run.
 *   v1.0.0 — 2026-07-13 — Extracted from engine.ts (max-file-lines)
 */
import type { LocalizedString } from '../../models/workflow-schemas.js';

/** Pick a display string from a localized value (prefers en_US, else fi_FI, else first). */
export function loc(s: LocalizedString | undefined): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.en_US ?? s.fi_FI ?? Object.values(s)[0] ?? '';
}

/** Substitute `{name}` template vars from the provided map; unknown names are left literal. */
export function template(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, n: string) => vars[n] ?? `{${n}}`);
}

/**
 * Today's date (`YYYY-MM-DD`) in the zone the SCHEDULE is expressed in, falling back to UTC.
 *
 * A workflow's cron is evaluated in `trigger.timezone`, and its `<run-date>` used to be computed in
 * UTC. Those agree for most of the day and disagree precisely at night: a 00:17 Europe/Helsinki
 * trigger fires at 21:17 UTC on the previous date, so the run was stamped with YESTERDAY. Keys
 * templated with `{date}` then addressed the previous run's output, which `skip_done` finds already
 * present — so every step greens without dispatching and the run reports success having produced
 * nothing. A pipeline can go quietly dead this way with no error anywhere.
 *
 * `en-CA` is not a locale preference, it is the one common locale whose short date format IS
 * ISO 8601 (`2026-08-02`). An unknown zone throws in Intl, and the catch keeps the previous UTC
 * behaviour rather than failing a run over a bad config string.
 */
export function runDateIn(timezone: string | undefined): string {
  const utc = () => new Date().toISOString().slice(0, 10);
  if (!timezone) return utc();
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return utc();
  }
}
