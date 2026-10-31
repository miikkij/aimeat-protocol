/**
 * @file src/services/connector-programs-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The programs a connector may start for its agents, as stored on the connector's row
 *   and as the owner reads them (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 *
 *   WHAT THE MACHINE REPORTS. Each agent on a connector names at most two programs: its runner
 *   (started for each task) and its wake command (started on new work). The connector holds them
 *   under one hash (cli/connect/command-trust.ts commandHash: the connector home, the runner and the
 *   wake command), and says whether that hash is trusted on the machine (`allowed`) or held
 *   (`waiting`). The node never runs a program and never sends a command text to a machine.
 *
 *   WHAT THE OWNER DECIDES. A decision is kept per hash in `program_asks`, apart from the report, so
 *   a report that replaces an agent's row keeps it. The machine reads the decision back and acts on a
 *   hash it holds itself; a decision for a hash no machine reports does nothing.
 *
 *   WHICH ACT WINS. The later one. A decision to stop a program the machine trusts takes effect only
 *   when it is newer than the machine's own trust of it (`since`): a person who runs `aimeat connect`
 *   at the machine after saying no on the node has changed their mind there.
 *
 *   Pure: no storage, no request. connector-registry.ts stores the fields and calls programViewsOf.
 * @structure StoredAgentPrograms · ProgramAsk · ProgramView · programStatusOf · programViewsOf
 * @usage const views = programViewsOf(rec.programs, rec.program_asks, liveAgents, approveUrl);
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 */

/** How the machine came to trust a hash, as its own record says. */
export type ProgramSource = 'connected' | 'adopted' | 'approved';

/** One agent's programs, as its connector last reported them. */
export interface StoredAgentPrograms {
  /** The hash the machine holds the agent's runner and wake command under. */
  hash: string;
  /** What the machine does with them now: runs them, or holds them. */
  status: 'allowed' | 'waiting';
  runner: string | null;
  wake: string | null;
  /** For an allowed hash: how the machine came to trust it, and when. */
  source: ProgramSource | null;
  since: string | null;
  reported_at: string;
}

/** The owner's decision on one hash, and the request that asked it. */
export interface ProgramAsk {
  decision: 'allowed' | 'declined' | null;
  decided_at: string | null;
  /** The approval request that asked the owner, while one is filed. */
  request_id: string | null;
}

/** One program as the owner and their agents read it. */
export interface ProgramView {
  agent: string;
  use: 'runner' | 'wake';
  command: string;
  hash: string;
  /** allowed: it runs, or runs from the next connection. waiting: the owner has not decided. declined: it does not run. */
  status: 'allowed' | 'waiting' | 'declined';
  /** False while the machine has not yet acted on the owner's decision; it does at its next connection. */
  applied: boolean;
  source: ProgramSource | null;
  since: string | null;
  reported_at: string;
  /** The approval request that waits for the owner, when one does. */
  request_id: string | null;
}

/** The status of one agent's programs, and whether the machine already acts on it. */
export function programStatusOf(p: StoredAgentPrograms, ask: ProgramAsk | undefined): { status: ProgramView['status']; applied: boolean } {
  if (p.status === 'allowed') {
    // A "no" newer than the machine's own trust stops it at the next connection; an older one was
    // overruled at the machine.
    const newer = ask?.decision === 'declined' && ask.decided_at && (!p.since || ask.decided_at > p.since);
    return newer ? { status: 'declined', applied: false } : { status: 'allowed', applied: true };
  }
  if (ask?.decision === 'allowed') return { status: 'allowed', applied: false };
  if (ask?.decision === 'declined') return { status: 'declined', applied: true };
  return { status: 'waiting', applied: true };
}

/**
 * The programs of the agents that live on one connector, one row per program, agents by name.
 * An agent that moved to another connector is not in `agents`, and its old report is not shown.
 */
export function programViewsOf(
  programs: Record<string, StoredAgentPrograms> | undefined,
  asks: Record<string, ProgramAsk> | undefined,
  agents: readonly string[],
): ProgramView[] {
  const out: ProgramView[] = [];
  for (const agent of [...agents].sort()) {
    const p = programs?.[agent];
    if (!p) continue;
    const ask = asks?.[p.hash];
    const { status, applied } = programStatusOf(p, ask);
    const base = { agent, hash: p.hash, status, applied, source: p.source, since: p.since, reported_at: p.reported_at, request_id: status === 'waiting' ? ask?.request_id ?? null : null };
    if (p.runner) out.push({ ...base, use: 'runner', command: p.runner });
    if (p.wake) out.push({ ...base, use: 'wake', command: p.wake });
  }
  return out;
}
