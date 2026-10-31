/**
 * @file src/services/overview/overview-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of the overview: one owner's machines, agents, apps, knowledge and
 *   offerings, with how much each was used in a chosen period and what ties them together.
 *
 *   FIVE LANES, READ LEFT TO RIGHT. A machine runs agents, an agent works in apps and writes into
 *   workspaces, an app shows its data in workspaces, and agents and apps offer things to others.
 *   The lanes are the model itself, so the page and an AI that reads this answer explain AIMEAT in
 *   the same order.
 *
 *   ONE ITEM LIST, NOT NESTED LANES. An agent names its machine and a workspace names its organism
 *   in `parent`; the page groups by it and an AI can follow it. A list keeps the answer the same
 *   size whatever the grouping a reader wants.
 *
 *   `use` IS A COUNT IN THE PERIOD, in the item's own `unit`: calls for machines, agents and
 *   offerings, opens for apps, writes for organisms and workspaces. A day-grained source (the usage
 *   roll-up) counts whole days, so "24h" there reaches back to the start of yesterday; `since` is
 *   the instant the rolling sources count from.
 * @structure OverviewRange · OVERVIEW_RANGES · OverviewLane · OverviewKind · OverviewItem ·
 *   OverviewEdge · OverviewView · QUIET_DAYS
 * @usage import type { OverviewView } from './overview-types.js';
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */

export const OVERVIEW_RANGES = ['24h', '7d', '30d'] as const;
export type OverviewRange = typeof OVERVIEW_RANGES[number];

/** Hours in each period. */
export const RANGE_HOURS: Record<OverviewRange, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

/** A thing unused this many days is quiet: shown so the owner can decide to archive or remove it. */
export const QUIET_DAYS = 30;

export type OverviewLane = 'machines' | 'agents' | 'apps' | 'knowledge' | 'offerings';

export type OverviewKind =
  | 'machine'      // a computer or server running `aimeat connect serve`
  | 'chat'         // an AI chat client (Claude, Codex …) that brings agents in over MCP
  | 'unplaced'     // agents the node knows no machine or chat client for
  | 'agent'
  | 'app'
  | 'organism'
  | 'workspace'
  | 'app-tools'    // the tools one app offers (every one a capability on the node)
  | 'agent-offer'; // one offer of one agent (a capability when public)

export type OverviewUnit = 'calls' | 'opens' | 'writes';

export interface OverviewItem {
  /** Stable per thing: `machine:<id>`, `chat:<client>`, `agent:<name>`, `app:<filename>`,
   *  `organism:<id>`, `workspace:<org>/<ws>`, `tools:<filename>`, `offer:<agent>/<offerId>`. */
  id: string;
  lane: OverviewLane;
  kind: OverviewKind;
  name: string;
  /** The group an item sits in: an agent's machine or chat client, a workspace's organism. */
  parent: string | null;
  use: number;
  unit: OverviewUnit;
  /** When it was last used or seen, as far as the node knows; null when never. */
  last_at: string | null;
  /** Days since it was last used, when that is QUIET_DAYS or more; null otherwise. */
  quiet_days: number | null;
  /** Where the person opens it: a node path (`/v1/...`) or an app's own address. */
  href: string;
  /** Machines and chat clients: connected right now. */
  online?: boolean;
  /** Machines, chat clients, the unplaced group: how many agents sit in it. */
  agents?: number;
  /** Organisms: how many workspaces the reader can see in it. */
  workspaces?: number;
  /** Agents: done tasks in the period, beside the calls `use` counts. */
  tasks_done?: number;
  /** Offerings. */
  tools?: number;
  free_tools?: number;
  priced_tools?: number;
  /** A capability on the node: every app tool, and an agent offer that is public. */
  capability?: boolean;
  /** Listed on EXCHANGE, the marketplace. */
  exchange?: boolean;
  /** Offerings: contracts other people hold on it, lifetime. */
  contracts?: number;
}

export type OverviewEdgeKind = 'runs' | 'uses' | 'writes' | 'watches' | 'shows' | 'offers';

export interface OverviewEdge {
  from: string;
  to: string;
  kind: OverviewEdgeKind;
  /** How much happened along it in the period; 0 for a tie that is stated but saw no use. */
  weight: number;
}

export interface OverviewView {
  range: OverviewRange;
  /** The instant the rolling counts start from. */
  since: string;
  generated_at: string;
  totals: {
    machines: number; agents: number; apps: number; organisms: number; offerings: number; quiet: number;
    /** Computers and chat clients connected right now. */
    online: number;
    /** Per lane: items with any use in the period (workspaces not counted; their organism is). */
    used: Record<OverviewLane, number>;
    /** Per lane: items quiet for QUIET_DAYS or more. */
    quiet_by_lane: Record<OverviewLane, number>;
  };
  items: OverviewItem[];
  edges: OverviewEdge[];
  /** Parts the node could not count this time, by name, so a zero is not read as "unused". */
  partial: string[];
}
