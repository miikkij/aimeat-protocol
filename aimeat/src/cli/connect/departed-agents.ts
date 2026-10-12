/**
 * @file cli/connect/departed-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agents that left this connector home because the node said so, and why: the
 *   record a runtime on the same machine reads (`GET /local/departed`, ./mcp/local-departed.ts).
 *
 *   WHY. The node says why it cut an identity exactly once, on the `auth_revoked` frame
 *   (`reason: 'moved'` or `'deleted'`). The serve daemon acts on it (./forget-agent.ts) and then
 *   holds nothing that says the agent was ever here: the key, the config and the registry entry
 *   are gone, and the reason went to stderr. A runtime that manages agents on this machine
 *   (crewaimeat's spawner) saw an agent missing from its roster and could not tell a deleted agent
 *   from a moved one, or from an agent the daemon had lost for a moment. It asked the node, one
 *   `GET /v1/agents` per agent that left, through another agent of the same owner. When the node
 *   could not be reached it learned nothing, and when the agent that left was its owner's last one
 *   on the machine there was no caller left to ask with. The files that runtime keeps for the agent
 *   then stayed for good (measured 2026-10-12, crewaimeat eae447f).
 *
 *   ONLY THE NODE'S OWN REASON IS RECORDED. 'moved' and 'deleted' are the two the node sends. A
 *   revocation with no reason is a deactivated account (closeForOwner), which an operator can
 *   enable again: its agents have not left, so no record is written for them. A refused mint, a
 *   failed attach and a daemon restart write nothing either. The values in a record come from the
 *   daemon's own registry entry and from the frame's reason, never from a loopback caller.
 *
 *   ON DISK, IN THE CONNECTOR HOME (`departed.json`). The frame arrives once, and the runtime that
 *   needs it may not be running then, or may start after the daemon restarted.
 *
 *   HOW A RECORD GOES STALE. Two ways, and no acknowledgement:
 *     1. AGE. A record older than DEPARTED_MAX_AGE_DAYS is dropped at the next read or write.
 *     2. THE AGENT IS BACK. A record whose identity the daemon carries again is dropped at the next
 *        read: an agent deleted and created again under the same name, or moved away and moved
 *        back, has not departed.
 *   An acknowledgement was the other option and is the wrong one here: more than one runtime reads
 *   one home (a process that starts a worker per job, one that keeps agents running, a command a
 *   person runs), and the first to acknowledge would hide the record from the rest. What a reader
 *   does with a record is delete files that may already be gone, so reading it twice costs nothing.
 *   A reader that wants only what is new passes `since`.
 * @structure isDepartureReason · departedAgentsPath · recordDeparted(who, reason) ·
 *   readDeparted(carried) · DEPARTED_MAX_AGE_DAYS
 * @usage recordDeparted({ gaii, agent, owner }, frame.reason);   // null unless the node gave a reason
 *        readDeparted(registry.list().map(e => e.gaii));          // what a runtime is told
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';
import { prepareConnectorHome } from './home-dir.js';

/** The two reasons the node sends with `auth_revoked` (services/connect-tunnel-revocation.ts). */
export type DepartureReason = 'moved' | 'deleted';

export interface DepartedAgent {
  gaii: string;
  agent: string;
  owner: string;
  reason: DepartureReason;
  /** When this daemon received the node's word, ISO 8601. */
  at: string;
}

/** A record older than this is dropped. A month covers a machine that was off over a holiday. */
export const DEPARTED_MAX_AGE_DAYS = 30;
const MAX_AGE_MS = DEPARTED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 1;

export function isDepartureReason(reason: unknown): reason is DepartureReason {
  return reason === 'moved' || reason === 'deleted';
}

export function departedAgentsPath(): string {
  return join(getConfigDir(), 'departed.json');
}

function isRecord(row: unknown): row is DepartedAgent {
  const r = row as Partial<DepartedAgent> | null;
  return !!r && typeof r.gaii === 'string' && typeof r.agent === 'string' && typeof r.owner === 'string'
    && isDepartureReason(r.reason) && typeof r.at === 'string' && Number.isFinite(Date.parse(r.at));
}

/** Every well-formed record in the file. A missing, unreadable or foreign file holds none. */
function readFile(file: string): DepartedAgent[] {
  if (!existsSync(file)) return [];
  try {
    const doc = JSON.parse(readFileSync(file, 'utf-8')) as { departed?: unknown };
    return Array.isArray(doc?.departed) ? doc.departed.filter(isRecord) : [];
  } catch (err) {
    // The next record written replaces it. Nothing here is worth stopping the daemon for.
    console.error(`[serve] ${file} could not be read (${String(err)}); it is treated as empty`);
    return [];
  }
}

function writeFile(file: string, departed: DepartedAgent[]): void {
  prepareConnectorHome(getConfigDir());
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ schema_version: SCHEMA_VERSION, departed }, null, 2), { encoding: 'utf-8', mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file); // atomic replace on the same volume, as serve.json is written
}

const withinAge = (now: Date) => (r: DepartedAgent): boolean => now.getTime() - Date.parse(r.at) <= MAX_AGE_MS;

/**
 * Write down that `who` left on the node's word. Returns the record, or null when the node gave no
 * reason this home records (none, or a word it does not know). One record per identity: a later
 * departure of the same identity replaces the earlier one.
 */
export function recordDeparted(
  who: { gaii: string; agent: string; owner: string },
  reason: string | undefined,
  now: Date = new Date(),
  file: string = departedAgentsPath(),
): DepartedAgent | null {
  if (!isDepartureReason(reason)) return null;
  const record: DepartedAgent = { gaii: who.gaii, agent: who.agent, owner: who.owner, reason, at: now.toISOString() };
  const kept = readFile(file).filter(withinAge(now)).filter(r => r.gaii !== who.gaii);
  writeFile(file, [...kept, record]);
  return record;
}

/**
 * The agents that left and have not come back, oldest first. `carried` is every identity the
 * daemon holds a working credential for now: a record of one of those is dropped, and so is a
 * record past the age limit. The file is rewritten only when something was dropped.
 */
export function readDeparted(
  carried: Iterable<string> = [],
  now: Date = new Date(),
  file: string = departedAgentsPath(),
): DepartedAgent[] {
  const all = readFile(file);
  const back = new Set(carried);
  const live = all.filter(withinAge(now)).filter(r => !back.has(r.gaii));
  if (live.length !== all.length) {
    try { writeFile(file, live); } catch (err) {
      console.error(`[serve] ${file} could not be rewritten (${String(err)}); the answer is still right`);
    }
  }
  return live.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
