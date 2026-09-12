/**
 * @file stats-tab.data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Statistics page knows about the numbers before it has read any: which
 *   counters this node keeps, what each one counts in plain words, and which of them are a series
 *   with an identity colour. Plus the two readings every section does on the response.
 *
 *   WHY A CATALOGUE. The old page hard-coded a card per counter, so a counter nothing writes looked
 *   exactly like a counter at zero, and `requests_total` read 0 for two months without anybody being
 *   able to tell which of the two it was. Here every row is driven from one list, and the row's
 *   state comes from comparing the period against the whole life of the node: a counter with
 *   nothing behind it says so, and never draws a zero that looks like a measurement.
 *
 *   THE TYPED COUNTERS ARE NOT WHAT THEY LOOK LIKE. `email_sent` exists in the totals because the
 *   collector groups `email_sent:verification` and its siblings on the way out. The DAY maps keep
 *   the raw colon keys, so a per-day reading of `email_sent` has to sum the prefix. dayValue()
 *   does both and is the only place that knows.
 * @structure
 *   - COUNTERS — the catalogue: key, locale suffix, series role, the failure counter beside it
 *   - DELIVERY — the three channels of section 05
 *   - rangeFor(period) — a preset to { from, to }
 *   - daysInRange(from, to, daily) — the x axis, gaps filled with the days that had nothing
 *   - dayValue(day, key) — one counter on one day, typed families summed
 *   - seriesFor(daily, days, key) — that value across the axis
 *   - counterRows(period, life, daily, days) — the catalogue, read
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Statistics page in the poster face).
 */

/** How many days the page will draw at once. Beyond this the bars are thinner than the gaps. */
const MAX_DAYS = 60;

/**
 * Every counter this node keeps, in the order an operator reads them: what somebody is doing TO
 * the node first, then what people and their agents did with it, then what it sent out.
 *
 * `role` picks the bar's colour and means one of three things. `critical` is the reserved status
 * red and is used only where the number IS a refusal. `reads` and `writes` are the two series
 * colours of the memory chart, so the same counter is the same colour in section 02 and in
 * section 03. `plain` is ink, which is what a single unnamed series should be.
 *
 * `fail` names the counter that counts the failures of this one, when there is one. It is shown
 * beside the number rather than as a row of its own: "1 296 checked, 2 failed" is one fact.
 *
 * `lead: false` bars a counter from section 01's headline without hiding it anywhere else. The
 * headline names the largest counter, on the assumption that the largest number is the thing worth
 * knowing; that assumption breaks for a counter which counts a superset of the others, because it
 * wins every time and says nothing.
 */
export const COUNTERS = [
  { key: 'auth_failures_total', name: 'refused', role: 'critical' },
  { key: 'scope_denials_total', name: 'scopeDenied', role: 'critical' },
  { key: 'rate_limit_hits_total', name: 'slowed', role: 'plain' },
  { key: 'login_tarpit_blocked_total', name: 'signinBlocked', role: 'critical' },
  { key: 'login_tarpit_delayed_total', name: 'signinDelayed', role: 'plain' },
  { key: 'login_tarpit_shed_total', name: 'signinShed', role: 'plain' },
  // `lead: false` keeps it out of section 01's headline. It counts EVERY request, so it is a
  // superset of every other counter here and would win the ranking on any node that serves more
  // requests than it refuses — which is all of them. A denominator is not a finding, and the
  // headline exists to name the finding. It keeps its row, its chip and its sparkline.
  // Caught in browser verification on 2026-09-12, the day mounting its middleware made it the
  // largest number on the page for the first time.
  { key: 'requests_total', name: 'requests', role: 'plain', lead: false },
  { key: 'memory_reads', name: 'memRead', role: 'reads' },
  { key: 'memory_writes', name: 'memWrite', role: 'writes' },
  { key: 'memory_discover', name: 'memFind', role: 'plain' },
  { key: 'schema_validations', name: 'schema', role: 'plain', fail: 'schema_validation_failures' },
  { key: 'consent_grants', name: 'granted', role: 'plain' },
  { key: 'consent_revocations', name: 'revoked', role: 'plain' },
  { key: 'email_sent', name: 'emailSent', role: 'plain', fail: 'email_failed' },
  { key: 'push_sent', name: 'pushSent', role: 'plain', fail: 'push_failed' },
  { key: 'push_expired_subs', name: 'pushExpired', role: 'plain' },
  { key: 'mailbox_notif_sent', name: 'mboxSent', role: 'plain', fail: 'mailbox_notif_failed' },
];

/** Section 05: everything the node sent out, and the counter that says it did not arrive. */
export const DELIVERY = [
  { id: 'email', sent: 'email_sent', fail: 'email_failed', also: 'email_retried' },
  { id: 'push', sent: 'push_sent', fail: 'push_failed', also: 'push_expired_subs' },
  { id: 'mailbox', sent: 'mailbox_notif_sent', fail: 'mailbox_notif_failed', also: 'mailbox_notif_blocked' },
];

const iso = (d) => d.toISOString().split('T')[0];

/**
 * A preset period as the two dates the route wants, or null for "everything" — which is the
 * un-ranged call, and the only one that returns the counters of the node's whole life.
 * @param {string} period
 * @returns {{ from: string, to: string } | null}
 */
export function rangeFor(period) {
  const today = new Date();
  const to = iso(today);
  const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
  switch (period) {
    case 'today': return { from: to, to };
    case '7d': return { from: back(6), to };
    case '30d': return { from: back(29), to };
    default: return null;
  }
}

/**
 * The x axis: every day in the period, INCLUDING the ones with no activity.
 *
 * The response only carries days that have a tally, so drawing its keys would silently close the
 * gap over a quiet day and make a weekend look like a working day. A gap is data.
 * @param {string} [from]
 * @param {string} [to]
 * @param {Record<string, Record<string, number>>} [daily]
 * @returns {string[]}
 */
export function daysInRange(from, to, daily) {
  if (!from || !to) return Object.keys(daily || {}).sort().slice(-MAX_DAYS);
  const out = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end && out.length < MAX_DAYS) {
    out.push(iso(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * One counter on one day. An exact key when the counter is a plain one, and the sum of the typed
 * family when it is not: the day maps hold `email_sent:verification`, never `email_sent`.
 * @param {Record<string, number> | undefined} day
 * @param {string} key
 * @returns {number}
 */
export function dayValue(day, key) {
  const d = day || {};
  if (typeof d[key] === 'number') return d[key];
  const prefix = key + ':';
  let sum = 0;
  for (const [k, v] of Object.entries(d)) if (k.startsWith(prefix)) sum += v;
  return sum;
}

/**
 * One counter across the whole axis.
 * @param {Record<string, Record<string, number>>} daily
 * @param {string[]} days
 * @param {string} key
 * @returns {number[]}
 */
export function seriesFor(daily, days, key) {
  return days.map(d => dayValue(daily[d], key));
}

/**
 * The catalogue, read against one response — and the one judgement this page makes.
 *
 * THREE STATES, and the difference between the first two is the whole point. `never` means the
 * counter has not been written once in the life of this node: it draws no number, because a zero
 * there would read as a measurement when it is an absence. `quiet` means it has been written
 * before but not in the period you picked, and it says how many it has ever had, so you know the
 * period is the reason and not the node. `live` is a number with days behind it.
 *
 * @param {Record<string, unknown>} period — the ranged read (or the full snapshot for "everything")
 * @param {Record<string, unknown>} life — the un-ranged snapshot: the node's whole life
 * @param {Record<string, Record<string, number>>} daily
 * @param {string[]} days
 * @returns {{ key: string, name: string, role: string, total: number, ever: number, failed: number,
 *   series: number[], peak: number, state: string }[]}
 */
export function counterRows(period, life, daily, days) {
  return COUNTERS.map(c => {
    const total = Number(period?.[c.key] ?? 0);
    const ever = Number(life?.[c.key] ?? 0);
    const failed = c.fail ? Number(period?.[c.fail] ?? 0) : 0;
    const series = seriesFor(daily, days, c.key);
    const peak = series.reduce((a, b) => (b > a ? b : a), 0);
    const state = ever === 0 && total === 0 ? 'never' : total === 0 ? 'quiet' : 'live';
    return { ...c, total, ever, failed, series, peak, state };
  });
}
