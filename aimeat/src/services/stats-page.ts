/**
 * @file src/services/stats-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one read behind the Statistics page: the counters over a period or over the
 *   whole life of this node, the day-by-day tallies, and the gauges that are neither.
 *
 *   ONE IMPLEMENTATION, called by GET /v1/stats and by the aimeat_admin_statistics tool. Extracted
 *   from the route on 2026-09-12, when the tool was written: the tool building the same payload a
 *   second time is how `aimeat_admin_stats` came to mean three different things on three surfaces
 *   (agents and morsels on the node MCP, trust buckets over the connector, and neither of those on
 *   the page), and the drift was invisible because each surface was right about itself.
 *
 *   WHAT A CALLER HAS TO KNOW, because the shape does not say it. Three kinds of number share this
 *   payload and only one of them is affected by `range`:
 *     - COUNTERS (requests_total, memory_reads, auth_failures_total …) are summed over the period
 *       when a range is given, and are the node's lifetime totals when it is not. A counter reading
 *       0 for a period may have a large lifetime total; a counter reading 0 both ways has never
 *       been written at all, and those two are different facts.
 *     - GAUGES (uptime, owners, agents, open connections, the mailboxes, the cache) are read at the
 *       moment of the call. They are not summable and a range does not touch them.
 *     - DERIVED blocks (consent_permissions, workflows) are counted off storage right now, also
 *       regardless of the range.
 * @structure
 *   - buildStatsSnapshot(config, storage, stats, range?) — the whole payload, either shape
 * @usage
 *   import { buildStatsSnapshot } from '../services/stats-page.js';
 *   const data = await buildStatsSnapshot(config, storage, stats, { from, to });
 * @version-history
 *   v1.0.0 — 2026-09-12 — Pure extraction from routes/stats.ts, so the MCP tool can make the same
 *     read the page makes.
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { StatsCollector } from './stats.js';
import { readActiveRuns, readEventTriggers } from './workflow/lifecycle.js';
import { cacheStats } from './cache.js';
import { logger } from '../utils/logger.js';

/** A period, as two inclusive ISO dates. Absent means the node's whole life. */
export interface StatsRange {
  from: string;
  to: string;
}

/**
 * Every consent rule on this node, grouped by the kind of recipient it names.
 *
 * One query per owner, which is why this is the expensive half of the read. Left as it was: a
 * cheaper shape is a storage change, and this extraction changes nothing.
 */
async function consentBreakdown(config: AimeatConfig, storage: Storage, owners: unknown[]) {
  const perm = {
    active_rules: 0, by_gaii: 0, by_ghii: 0, by_organism: 0,
    by_domain: 0, by_node: 0, by_wildcard: 0,
    unique_patterns: new Set<string>(),
  };
  for (const o of owners) {
    const gaii = (o as { gaii?: string }).gaii || `${(o as { name?: string }).name || ''}@${config.nodeId}`;
    try {
      const consents = await storage.listConsents(gaii, { status: 'active' });
      for (const c of consents) {
        perm.active_rules++;
        const r = c.recipient || '';
        if (r === '*') perm.by_wildcard++;
        else if (r.startsWith('ghii:')) perm.by_ghii++;
        else if (r.startsWith('organism.')) perm.by_organism++;
        else if (r.startsWith('domain:')) perm.by_domain++;
        else if (r.startsWith('node:')) perm.by_node++;
        else perm.by_gaii++;
        perm.unique_patterns.add(c.dataPattern);
      }
    } catch (err) { logger.warn('gaii: skip owners without consents', { error: String(err) }); }
  }
  return {
    active_rules: perm.active_rules,
    by_gaii: perm.by_gaii,
    by_ghii: perm.by_ghii,
    by_organism: perm.by_organism,
    by_domain: perm.by_domain,
    by_node: perm.by_node,
    by_wildcard: perm.by_wildcard,
    unique_patterns: perm.unique_patterns.size,
  };
}

/**
 * The Statistics payload, in whichever of its two shapes the caller asked for.
 *
 * A range returns the same FLAT field names as the lifetime read, so a surface renders one shape
 * either way. Every counter is zeroed first and then overwritten from the range's day tallies, so
 * a counter with no activity in the period reads 0 rather than falling through to its lifetime
 * total, which would be the same number wearing a period's label.
 */
export async function buildStatsSnapshot(
  config: AimeatConfig,
  storage: Storage,
  stats: StatsCollector,
  range?: StatsRange,
): Promise<Record<string, unknown>> {
  const snap = stats.snapshot();
  const owners = await storage.listOwners();
  const agents = await storage.listAgents();

  // Agent Workflows — node-global gauges, cheaply read from the system-namespace indexes
  // (in-flight runs + registered event triggers). Best-effort: never block the stats response.
  let workflowStats = { runs_active: 0, event_triggers: 0 };
  try {
    const [activeRuns, eventTriggers] = await Promise.all([
      readActiveRuns(storage, config.nodeId),
      readEventTriggers(storage, config.nodeId),
    ]);
    workflowStats = { runs_active: activeRuns.length, event_triggers: eventTriggers.length };
    // eslint-disable-next-line aimeat/no-silent-catch -- indexes absent / unreadable — leave zeros
  } catch { /* indexes absent / unreadable — leave zeros */ }

  const shared = {
    active_owners: owners.length,
    active_agents: agents.length,
    workflows: workflowStats,
    push_notifications: {
      enabled: config.pushEnabled && !!config.vapidPublicKey,
      personal_node_support: config.personalNodesEnabled,
    },
    consent_permissions: await consentBreakdown(config, storage, owners),
  };

  // Point-in-time gauges (always from the current snapshot, never summed over a period).
  const cache = cacheStats();
  const gauges = {
    tunnel_connections_active: snap.tunnel.connections_active,
    mailbox_items_total: snap.mailbox.items_total,
    mailbox_bytes_total: snap.mailbox.bytes_total,
    mailbox_oldest_item_age_seconds: snap.mailbox.oldest_item_age_seconds,
    // Generic read-cache health (services/cache.ts): live entry/tag counts + lifetime evictions.
    cache_entries: cache.entries,
    cache_tags: cache.tags,
    cache_evictions_total: cache.evictions,
  };

  if (range) {
    const summed = stats.snapshotForRange(range.from, range.to);

    // The same flat shape as the full snapshot so a surface renders both identically. Counter
    // fields default to 0 for the range (no activity = 0, NOT the cumulative total). Live state
    // (tunnel, mailbox, uptime) comes from the full snapshot.
    const rangeCounters: Record<string, unknown> = {
      requests_total: 0,
      memory_writes: 0,
      memory_reads: 0,
      consent_grants: 0,
      consent_revocations: 0,
      schema_validations: 0,
      schema_validation_failures: 0,
      auth_failures_total: 0,
      rate_limit_hits_total: 0,
      scope_denials_total: 0,
      ...summed.totals,
    };

    return {
      node_id: config.nodeId,
      from: range.from,
      to: range.to,
      uptime_seconds: snap.uptime_seconds,
      started_at: snap.started_at,
      requests_by_method: snap.requests_by_method,
      requests_by_status: snap.requests_by_status,
      tunnel: snap.tunnel,
      mailbox: snap.mailbox,
      ...rangeCounters,
      daily_history: summed.daily,
      daily: summed.daily,
      gauges,
      ...shared,
    };
  }

  // The whole life of the node, with the last thirty days of tallies beside it.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const daily: Record<string, Record<string, number>> = {};
  for (const [day, counters] of Object.entries(snap.daily_history)) {
    if (day >= cutoffStr) daily[day] = counters;
  }

  return {
    node_id: config.nodeId,
    ...snap,
    gauges,
    daily,
    ...shared,
  };
}
