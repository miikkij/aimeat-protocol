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
 *   ServeDiscovery · serveDiscoveryPath() · pidAlive() · exitIfAnotherDaemonOwns() ·
 *   writeDiscoveryFile()
 * @usage import { serveDiscoveryPath, type ServeDiscovery } from './local-discovery.js';
 * @version-history
 *   v1.1.0 — 2026-09-07 — The two operations ON the file follow the file's own contract here:
 *     refusing to start when a live pid still owns it, and the atomic write. Pure extraction from
 *     local-server.ts, which passed the cap again; nothing changed but where the lines live.
 *   v1.0.0 — 2026-09-03 — Extracted from local-server.ts (max-file-lines).
 */
import { join } from 'node:path';
import { writeFileSync, renameSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
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

/**
 * A live daemon OWNS this file; a dead pid's is overwritten. Exits the process when somebody else
 * still holds it, because two daemons on one home would race for the same port record and the
 * second one's clients would be told to talk to a port that is not its own.
 */
export function exitIfAnotherDaemonOwns(discoveryFile: string): void {
  if (!existsSync(discoveryFile)) return;
  try {
    const prev = JSON.parse(readFileSync(discoveryFile, 'utf-8')) as ServeDiscovery;
    if (prev.pid && prev.pid !== process.pid && pidAlive(prev.pid)) {
      console.error(`Another serve daemon appears to be running (pid ${prev.pid}, port ${prev.port}).`);
      console.error(`Stop it first, or delete ${discoveryFile} if it is stale.`);
      process.exit(1);
    }
  // eslint-disable-next-line aimeat/no-silent-catch -- unreadable file — treat as stale and overwrite
  } catch { /* unreadable file — treat as stale and overwrite */ }
}

/**
 * What this file needs to know about one served identity. Structural on purpose: `RegisteredAgent`
 * satisfies it, and stating it this way keeps the contract module free of the daemon's registry.
 */
export interface DiscoverySource {
  agent: string;
  gaii: string;
  owner: string;
  config: { node_url: string };
}

/**
 * The document, from the identities a daemon is serving. `transportOf` is asked per identity rather
 * than read from a map here, because on a shared socket an identity's transport is its own and not
 * its socket's — the distinction that made a deleted agent read `online` until 2026-09-03.
 */
export function buildDiscoveryDoc(
  port: number,
  startedAt: string,
  entries: DiscoverySource[],
  transportOf: (gaii: string) => ServeDiscoveryAgent['transport'],
): ServeDiscovery {
  return {
    schema_version: SERVE_DISCOVERY_SCHEMA_VERSION,
    port,
    pid: process.pid,
    started_at: startedAt,
    // Neutral principal list — an `eco:`-prefixed id is type 'ecosystem', else 'agent'.
    principals: entries.map(e => ({
      type: e.agent.startsWith('eco:') ? 'ecosystem' as const : 'agent' as const,
      // The FULL identity, which is what this field has always said it was. It carried the bare
      // name, so two owners' `concierge` were one row and the file described a daemon that does
      // not exist.
      id: e.gaii,
      owner: e.owner,
      node_url: e.config.node_url,
      transport: transportOf(e.gaii),
    })),
    // Transitional alias (agent-typed only) for sidecars that still read `agents`.
    agents: entries.filter(e => !e.agent.startsWith('eco:')).map(e => ({
      agent: e.agent,
      gaii: e.gaii,
      owner: e.owner,
      node_url: e.config.node_url,
      transport: transportOf(e.gaii),
    })),
  };
}

/** Write it whole or not at all: a reader must never catch this file half-written. */
export function writeDiscoveryFile(discoveryFile: string, doc: ServeDiscovery): void {
  mkdirSync(getConfigDir(), { recursive: true });
  const tmp = `${discoveryFile}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tmp, discoveryFile); // atomic replace on the same volume
}
