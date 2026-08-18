/**
 * @file status.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description CLI subcommand: show agent status
 * @structure Loads connector config, verifies the stored token, and prints the current agent identity.
 * @usage Called by `aimeat connect status` and `aimeat connect whoami`.
 * @version-history
 *   v1.9.4 — 2026-05-28 — Update connector guidance and use the name-based inbox endpoint.
 *   v1.10.0 -- 2026-05-29 -- Detect token/agent-record desync (valid token but server has no agent record) and print a concrete re-add command instead of the generic "Token invalid".
 */
import { AimeatClient } from './api-client.js';
import { loadConfig } from './config.js';

export async function runStatus(): Promise<void> {
  const config = loadConfig();
  if (!config) { console.log('Not configured. Run: npx aimeat connect'); return; }
  console.log(`Agent: ${config.agent}`);
  console.log(`Owner: ${config.owner}`);
  console.log(`Node:  ${config.node_url}`);

  try {
    const client = await AimeatClient.fromConfig();
    const resp = await client.get('/v1/wallet');
    if (resp.ok) {
      const wallet = resp.data as { balance?: number };
      console.log(`Balance: ${wallet.balance ?? 'unknown'} morsels`);
    }
    const me = await client.get(`/v1/agents/${encodeURIComponent(config.agent)}/inbox`);
    if (me.ok) {
      console.log('Status: Connected');
      return;
    }
    // Inbox call failed. Distinguish the two failure modes that look the same
    // from outside: (a) token genuinely invalid -> 401 AUTH_REQUIRED; (b) token
    // valid but the agent record was deleted server-side -> 404 NOT_FOUND or
    // AGENT_NOT_REGISTERED. Case (b) is recoverable with a single connect-add
    // call; surfacing it here saves the operator a debug session.
    const errCode = (me.error as { code?: string } | undefined)?.code;
    const errMessage = (me.error as { message?: string } | undefined)?.message ?? 'unknown error';
    if (errCode === 'AGENT_NOT_REGISTERED' || errCode === 'NOT_FOUND') {
      console.log('Status: Token valid, but agent record is missing on the node.');
      console.log('Fix:    npx aimeat connect add --agent ' + config.agent + ' --owner ' + config.owner + ' --url ' + config.node_url);
      console.log('Detail: ' + errMessage);
    } else {
      console.log(`Status: Token invalid (${errCode ?? 'unknown'}: ${errMessage})`);
    }
  } catch { console.log('Status: Not connected'); }
}
