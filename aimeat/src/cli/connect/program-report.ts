/**
 * @file src/cli/connect/program-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector tells the node which programs it may start for one agent, and acts on
 *   the owner's decision (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 *
 *   WHY. command-trust.ts decides on the machine which runner and wake command run, and until now said
 *   so only on the machine's console. So a command that came with a folder waited in silence, and the
 *   owner and their AI could not see what a computer may start. The daemon now reports each agent's
 *   commands to PUT /v1/agents/:name/programs after the agent attaches, on every reconnect, and when
 *   the node says a decision was made (the `connector.programs_decided` delivery).
 *
 *   WHAT THE ANSWER CAN DO. The node answers the owner's decision on the reported hash, and nothing
 *   else: it sends no command. An `allowed` decision takes into use only the commands this machine
 *   holds under that same hash; a `declined` one stops commands this machine runs under that hash,
 *   and only when it is newer than this machine's own record of them, because a connect at the
 *   machine after a "no" on the node is the person changing their mind there. Both are written into
 *   the machine's record (command-trust.ts recordOwnerDecision), so a restart keeps them.
 *
 *   A node older than this answers 404 and the daemon says nothing; a report that fails changes
 *   nothing on the machine.
 * @structure ProgramsBody · programsBodyOf · reportPrograms
 * @usage void reportPrograms(entry);
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 */
import { resolve } from 'node:path';
import type { RegisteredAgent } from './agent-registry.js';
import { displayName } from './agent-registry.js';
import { getConfigDir } from './config.js';
import { commandHash, trustEntryOf, recordOwnerDecision } from './command-trust.js';
import { logger } from '../../utils/logger.js';

/** What PUT /v1/agents/:name/programs takes. `hash` null: the agent has no runner and no wake command. */
export interface ProgramsBody {
  hash: string | null;
  status?: 'allowed' | 'waiting';
  runner?: string | null;
  wake?: string | null;
  source?: string | null;
  since?: string | null;
}

const runnerText = (r: { command: string; args?: string[] } | undefined) => r ? [r.command, ...(r.args ?? [])].join(' ') : null;

/** The report for one agent: the commands it holds, or the ones it runs with how this machine came to trust them. */
export function programsBodyOf(entry: RegisteredAgent, home: string = getConfigDir(), env: NodeJS.ProcessEnv = process.env, dir: string = process.cwd()): ProgramsBody {
  const held = entry.heldCommands;
  if (held) return { hash: held.hash, status: 'waiting', runner: runnerText(held.runner), wake: held.wakeCommand ?? null };
  const runner = entry.config.runner?.command ? entry.config.runner : undefined;
  const wake = entry.config.wake?.command || undefined;
  if (!runner && !wake) return { hash: null };
  const hash = commandHash(home, runner, wake, dir);
  const t = trustEntryOf(hash, env);
  return { hash, status: 'allowed', runner: runnerText(runner), wake: wake ?? null, source: t?.how ?? null, since: t?.at ?? null };
}

interface Answer { hash: string | null; decision: 'allowed' | 'declined' | null; decided_at: string | null }

/**
 * Report one agent's programs and act on the owner's decision in the answer. Never throws. After a
 * change on the machine it reports once more, so the node shows what the machine does now.
 */
export async function reportPrograms(entry: RegisteredAgent, home: string = getConfigDir(), env: NodeJS.ProcessEnv = process.env, dir: string = process.cwd(), again = true): Promise<void> {
  try {
    const body = programsBodyOf(entry, home, env, dir);
    const res = await entry.client.put(`/v1/agents/${encodeURIComponent(entry.agent)}/programs`, body);
    if (!res.ok) {
      // A node without this list (404), or an agent not on a connected socket yet: nothing to act on.
      logger.debug?.('connector: the programs report was not taken', { agent: entry.gaii, code: res.error?.code ?? null });
      return;
    }
    const a = (res.data ?? {}) as Partial<Answer>;
    if (!body.hash || a.hash !== body.hash) return;
    const held = entry.heldCommands;
    if (held && a.decision === 'allowed') {
      recordOwnerDecision(held.hash, 'approved', env);
      entry.config = {
        ...entry.config,
        ...(held.runner ? { runner: held.runner } : {}),
        ...(held.wakeCommand ? { wake: { ...(entry.config.wake ?? {}), command: held.wakeCommand } } : {}),
      };
      entry.heldCommands = null;
      console.error(`[serve] ${displayName(entry)}: the owner allowed ${[body.runner, body.wake].filter(Boolean).join(' and ')} on the node; it runs from now on.`);
      logger.info('connector: the owner allowed held commands on the node', { gaii: entry.gaii, hash: held.hash });
    } else if (!held && a.decision === 'declined' && a.decided_at && (!body.since || a.decided_at > body.since)) {
      const runner = entry.config.runner?.command ? entry.config.runner : undefined;
      const wakeCommand = entry.config.wake?.command || undefined;
      recordOwnerDecision(body.hash, 'stopped', env);
      entry.heldCommands = { hash: body.hash, home: resolve(home), ...(runner ? { runner } : {}), ...(wakeCommand ? { wakeCommand } : {}) };
      entry.config = { ...entry.config, runner: undefined, ...(entry.config.wake ? { wake: { ...entry.config.wake, command: undefined } } : {}) };
      console.error(`[serve] ${displayName(entry)}: the owner stopped ${[body.runner, body.wake].filter(Boolean).join(' and ')} on the node; it does not run until it is allowed again.`);
      logger.info('connector: the owner stopped commands on the node', { gaii: entry.gaii, hash: body.hash });
    } else {
      return;
    }
    if (again) await reportPrograms(entry, home, env, dir, false);
  } catch (err) {
    logger.warn('connector: the programs report failed; nothing changed on this machine', { agent: entry.gaii, error: String(err) });
  }
}
