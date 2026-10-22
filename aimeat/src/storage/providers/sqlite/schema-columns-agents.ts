/**
 * @file sqlite/schema-columns-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agents table's added columns for existing SQLite databases, from the push layer
 *   to the v2 identity: webhook delivery, platform and model, tags, mode, concurrency, console
 *   address, who registered it, run mode, runtime source, the key-and-card identity, and the MCP
 *   client it last spoke from. Called by initializeSchema at the point where these ALTERs always
 *   ran.
 * @structure applyAgentRuntimeColumns(safeAddColumn)
 * @usage applyAgentRuntimeColumns(safeAddColumn) from sqlite/schema.ts initializeSchema.
 * @version-history
 *   v1.2.0 — 2026-10-22 — ecosystem_apps.capabilityApprovals, the outside-app principal's twin of an
 *     agent's granted permissions (migration 0112; secaudit 2026-10, capability-invoke ecosystem source).
 *   v1.1.0 — 2026-10-18 — agents.clearance (migration 0107, plan doc-mvdipuyqraas L2).
 *   v1.0.0 — 2026-10-11 — Moved out of schema.ts unchanged (max-file-lines).
 */
import type { SafeAddColumn } from './schema-columns-scheduler.js';

export function applyAgentRuntimeColumns(safeAddColumn: SafeAddColumn): void {
  // Push Layer Phase A — webhook delivery fields
  safeAddColumn('agents', 'webhookUrl', 'TEXT');
  safeAddColumn('agents', 'webhookSecret', 'TEXT');
  safeAddColumn('agents', 'webhookEnabled', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('agents', 'webhookLastSuccess', 'TEXT');
  safeAddColumn('agents', 'webhookLastFailure', 'TEXT');
  safeAddColumn('agents', 'webhookFailCount', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('agents', 'platform', 'TEXT');
  safeAddColumn('agents', 'platformVersion', 'TEXT');
  safeAddColumn('agents', 'platformDetectedBy', 'TEXT');
  safeAddColumn('agents', 'model', 'TEXT');
  safeAddColumn('agents', 'modelDetectedBy', 'TEXT');
  safeAddColumn('agents', 'tags', 'TEXT');

  // Agent operational mode (autonomous | interactive | task-runner | coordinator | workstation)
  // Default 'interactive' = backward-compatible: all existing agents went through
  // the full 13-step Hello Integration which matches interactive semantics.
  safeAddColumn('agents', 'mode', "TEXT DEFAULT 'interactive'");

  // Max concurrent tasks the agent's runner may process. Default 1 = serial
  // (backward-compatible). >1 requires a concurrency-capable engine (read by the
  // runner; not enforced server-side).
  safeAddColumn('agents', 'maxConcurrentTasks', 'INTEGER NOT NULL DEFAULT 1');

  // Where the agent's HOST manages it (a cockpit settings page). Reported by the owner or a
  // same-owner sibling; the node stores and links it and never fetches it.
  safeAddColumn('agents', 'consoleUrl', 'TEXT');

  // Who authorized this agent's registration: the owner's name, or the approving sibling's GAII.
  // The creation ledger, and the fence on agent-initiated deletion. See migration 0035.
  safeAddColumn('agents', 'registeredBy', 'TEXT');

  // ── Agent v2 identity (migration 0058) ──
  // How the agent is meant to be run: 'spawn' (data here until work arrives) or 'resident'. Stored
  // and shown, never enforced — the runtime is the only party that can honour it, same rule as
  // maxConcurrentTasks. NULL = nobody has said, which is not the same as 'spawn'.
  safeAddColumn('agents', 'runMode', 'TEXT');
  // What code backs the agent, as its runtime reports it. JSON in a TEXT column, like every
  // other structured field here: it is read whole and never queried into.
  safeAddColumn('agents', 'runtimeSource', 'TEXT');
  // 1 (or NULL) = device-authorization agent with a long-lived JWT; 2 = brings its own Ed25519 key,
  // pinned at enrolment, and exchanges a signed assertion for a short-lived token per use.
  safeAddColumn('agents', 'identityVersion', 'INTEGER');
  // The agent's own JWS-signed card, verifiable against the published JWKS without asking this node.
  safeAddColumn('agents', 'cardJws', 'TEXT');
  safeAddColumn('agents', 'cardIssuedAt', 'TEXT');
  safeAddColumn('agents', 'enrolledAt', 'TEXT');
  // Which AI tool the agent last spoke from over MCP, and when (migration 0063 on Postgres).
  safeAddColumn('agents', 'mcpClient', 'TEXT');
  safeAddColumn('agents', 'mcpLastSeen', 'TEXT');
  // The highest classification label the agent may read; NULL = no limit (migration 0107).
  safeAddColumn('agents', 'clearance', 'TEXT');

  // The other principal kind beside agents: an outside (ecosystem) app. Which capabilities of other
  // accounts the owner allowed to run one of its actions, and the requests waiting for an answer.
  // JSON list, '[]' when none. Mirrors Postgres migration 0112.
  safeAddColumn('ecosystem_apps', 'capabilityApprovals', "TEXT NOT NULL DEFAULT '[]'");
}
