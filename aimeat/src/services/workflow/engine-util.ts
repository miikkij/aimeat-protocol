/**
 * @file src/services/workflow/engine-util.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Small pure helpers shared across the workflow engine modules — localized-string
 *   display (loc), key-template substitution (template) and a run's variables (resolveRunVars).
 *   Extracted from engine.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-09-26 — resolveRunVars(): the body of WorkflowEngine.resolveVars, moved here
 *     unchanged (max-file-lines).
 *   v1.1.0 — 2026-08-01 — runDateIn(): the run date is resolved in the SCHEDULE's timezone.
 *     It was UTC while the cron was not, so any workflow firing between midnight and the UTC
 *     offset was stamped with yesterday — and with skip_done that is a silent no-op run.
 *   v1.0.0 — 2026-07-13 — Extracted from engine.ts (max-file-lines)
 */
import type { LocalizedString, WorkflowDef } from '../../models/workflow-schemas.js';

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
    // Intl as a CALENDAR, not a formatter: this is the KEY a run is filed under, and `en-CA` is
    // simply the tag that writes a plain ISO day. No person reads this string.
    // eslint-disable-next-line aimeat/no-raw-locale-format -- a day key, not a display
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return utc();
  }
}

/**
 * A run's variables: each declared variable's override, else its default (`<run-date>` is the run
 * date), plus the built-in `{run}` and `{date}`. The engine's resolveVars, which preflight.ts calls
 * too, answers with this.
 */
export function resolveRunVars(def: WorkflowDef, overrides: Record<string, string> | undefined, runId: string): Record<string, string> {
  // The run date belongs to the zone the SCHEDULE is in, not the server's — see runDateIn(), which
  // carries the why. Only a schedule trigger has a zone; manual/event runs stay on UTC as before.
  const today = runDateIn(def.trigger.kind === 'schedule' ? def.trigger.timezone : undefined);
  const out: Record<string, string> = {};
  for (const v of def.vars) {
    const override = overrides?.[v.name];
    const def0 = v.default === '<run-date>' ? today : v.default;
    out[v.name] = override ?? def0 ?? '';
  }
  // Built-in run-scoping vars (available to key templates WITHOUT declaration; a declared var of the
  // same name wins). `{run}` = this run's id (unique per invocation); `{date}` = the run date. Templating
  // deliverable keys with one of these gives each run its OWN keyspace — so a re-run never sees a prior
  // run's output (no stale false-green, no wasted crew re-run over already-present keys) and history is
  // preserved. See docs — this is the recommended alternative to the destructive `fresh` clear.
  if (!('run' in out)) out.run = runId;
  if (!('date' in out)) out.date = today;
  return out;
}
