/**
 * @file cli/connect/mcp/local-discovery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `serve.json` — the file a serve daemon writes so anything else on the machine can
 *   find it: which port it listens on, which pid holds it, and which identities it is serving.
 *
 *   PURE EXTRACTION from local-server.ts, which passed the 800-line cap. Its own unit: this is a
 *   CONTRACT with other processes, read by crew runtimes and sidecars that never import the daemon,
 *   and its schema version moves for reasons that have nothing to do with how the daemon is built.
 *   Nothing changed in the move; local-server.ts re-exports every name so no importer notices.
 *
 * @structure SERVE_DISCOVERY_SCHEMA_VERSION · ServeDiscoveryAgent · ServeDiscoveryPrincipal ·
 *   ServeDiscovery · serveDiscoveryPath() · pidAlive()
 * @usage import { serveDiscoveryPath, type ServeDiscovery } from './local-discovery.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Extracted from local-server.ts (max-file-lines).
 */
import { join } from 'node:path';
import { getConfigDir } from '../config.js';

/**
 * 2 since 2026-09-01: `principals[].id` is the GAII it was always documented to be (it carried the
 * bare agent name instead), and every `agents[]` row gained a `gaii`. Two owners with one agent
 * name were one indistinguishable row before that, so the file described a daemon that does not
 * exist.
 */
export const SERVE_DISCOVERY_SCHEMA_VERSION = 2;

export interface ServeDiscoveryAgent {
  /** The bare name, kept for sidecars that read it. Not unique across owners — use `gaii`. */
  agent: string;
  /** `agent#owner@node`. The identity, and what tells two owners' `concierge` apart. */
  gaii: string;
  owner: string;
  node_url: string;
  /** How this agent's API calls reach the node right now. */
  transport: 'tunnel' | 'direct' | 'auth_failed';
}

/**
 * Neutral principal entry (connector profile §2.1) — covers both agent (GAII) and ecosystem (GEAI)
 * principals. `id` is the full identity (`agent#owner@node` or `eco:{app}#{owner}@{node}`).
 */
export interface ServeDiscoveryPrincipal {
  type: 'agent' | 'ecosystem';
  id: string;
  owner: string;
  node_url: string;
  transport: 'tunnel' | 'direct' | 'auth_failed';
}

export interface ServeDiscovery {
  schema_version: number;
  port: number;
  pid: number;
  /** Neutral principal list (agents + ecosystem apps). Prefer this over `agents`. */
  principals: ServeDiscoveryPrincipal[];
  /** Transitional alias of the agent-typed principals — kept so existing sidecars keep working. */
  agents: ServeDiscoveryAgent[];
  started_at: string;
}

export function serveDiscoveryPath(): string {
  return join(getConfigDir(), 'serve.json');
}

/** Is the pid recorded in an existing discovery file still alive? */
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}
