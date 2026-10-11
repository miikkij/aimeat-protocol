/**
 * @file cli/connect/forget-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Remove one agent from this connector home, because the node said the owner moved it
 *   to another connector, or deleted it.
 *
 *   A DELETED AGENT IS THE SAME CASE (2026-10-11). The node deletes the agent and sends
 *   `auth_revoked` with `reason: 'deleted'` (routes/agents/management.ts, closeForGaii). The
 *   connector reported the agent as refused and kept its key and its config: hours after an agent
 *   was deleted on production, its connector still held both and listed it, until somebody removed
 *   them by hand. An account that is deactivated sends no reason (closeForOwner), so its agents'
 *   files stay: that account can be enabled again.
 *
 *   WHY. Moving an agent pins a new key on the connector it goes to, and the key here stops
 *   working. The old connector was told (`auth_revoked`), reported the agent as refused, and kept
 *   its key and its config on disk. After the next restart it loaded the agent again, could mint
 *   nothing, and listed an agent that lives somewhere else (measured by a two-connector run,
 *   2026-10-11). An agent that is not this home's any more has no files in it.
 *
 *   ONLY ON THE NODE'S WORD. This runs when the revocation frame says `reason: 'moved'`, which the
 *   node sends from the enrolment that pinned the new key, or `reason: 'deleted'`, which it sends
 *   from the route that deleted the agent. It never runs on an inference: a refused
 *   mint, a failed attach or a restart that finds a dead key leave every file where it is, because
 *   a refusal can have another cause and a deleted key cannot be put back.
 *
 *   WHAT IS REMOVED, AND NOTHING ELSE: the agent's key file (`keys/<agent>@<owner>.key`), a stored
 *   bearer if it has one (`tokens/<agent>@<owner>.token`), its `config.yaml`, and the agent's own
 *   directory when that left it empty. Each is one file or one empty directory, never a recursive
 *   delete: a directory that holds anything else stays. What a runtime keeps elsewhere on this
 *   machine (crewaimeat's local_memory rows) is that runtime's, and stays.
 * @structure forgetLocalAgent(agent, owner) · forgetOnNodeWord(reason, agent, owner, detach)
 * @usage const gone = await forgetLocalAgent(entry.agent, entry.owner);   // { key, token, config }
 * @version-history
 *   v1.1.0 — 2026-10-11 — Also for an agent the node deleted (`reason: 'deleted'`). forgetOnNodeWord:
 *     the daemon's decision on the reason, moved here from mcp/local-server.ts.
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { existsSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { deleteAgentKey } from './agent-key.js';
import { deleteToken } from './keychain.js';
import { perAgentConfigPath } from './config.js';
import { logger } from '../../utils/logger.js';

/** Which of the agent's files were here and are gone now. */
export interface ForgottenAgent { key: boolean; token: boolean; config: boolean }

export async function forgetLocalAgent(agent: string, owner: string): Promise<ForgottenAgent> {
  const key = await deleteAgentKey(agent, owner);
  const token = await deleteToken(agent, owner);
  const configFile = perAgentConfigPath(agent, owner);
  let config = false;
  if (existsSync(configFile)) {
    unlinkSync(configFile);
    config = true;
    // The agent's own directory, when the config was all it held. rmdir refuses a directory with
    // anything in it, which is the behaviour wanted: whatever else is there is not ours to remove.
    try { rmdirSync(dirname(configFile)); } catch (err) {
      logger.debug('forget-agent: the agent directory holds other files and stays', { agent, owner, error: String(err) });
    }
  }
  return { key, token, config };
}

/**
 * What the serve daemon does when the node says WHY it cut an identity (`auth_revoked`, `reason`).
 * 'moved' and 'deleted' both mean the agent is not this home's any more: `detach` takes it off the
 * running daemon and its files are removed. Any other reason, and none, changes nothing here.
 */
export function forgetOnNodeWord(reason: string | undefined, agent: string, owner: string, detach: () => void): void {
  if (reason !== 'moved' && reason !== 'deleted') return;
  const what = reason === 'moved' ? 'moved to another connector' : 'deleted on the node';
  detach();
  void forgetLocalAgent(agent, owner).then(gone => console.error(
    `[serve] ${agent}@${owner}: ${what}, removed from this one (key ${gone.key ? 'removed' : 'absent'}, config ${gone.config ? 'removed' : 'absent'})`,
  )).catch(err => console.error(`[serve] ${agent}@${owner}: ${what}, but its files could not be removed: ${String(err)}`));
}
