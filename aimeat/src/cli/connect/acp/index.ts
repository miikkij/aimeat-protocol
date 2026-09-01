/**
 * @file src/cli/connect/acp/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat connect acp` — run this connector as an Agent Client Protocol agent, so a
 *   code editor can hand work to one of the owner's AIMEAT agents.
 *
 *   AN EDITOR SPAWNS THIS PROCESS and speaks ACP to it over stdin and stdout. That is the whole
 *   transport, and it is why this command prints NOTHING to stdout that is not a protocol message:
 *   one stray console.log on that stream corrupts the frame the editor is parsing. Everything a
 *   person needs to read goes to stderr, which the editor shows in its log panel.
 *
 *   WHICH AGENT. `--agent <name>` names one; without it the connector's primary is used, which is
 *   the same rule every other `aimeat connect` command follows. The editor is told which one it
 *   got, in the agent name it displays, because an editor pointed at the wrong agent looks exactly
 *   like an agent that is not answering.
 *
 * @structure runAcp(flags)
 * @usage aimeat connect acp --agent claude
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6b).
 */
import { Readable, Writable } from 'node:stream';
import { ndJsonStream } from '@agentclientprotocol/sdk';
import { AimeatClient } from '../api-client.js';
import { loadConfig, loadAgentByName } from '../config.js';
import { buildAimeatAcpAgent } from './agent.js';

/** stderr, because stdout belongs to the protocol. */
function note(line: string): void {
  process.stderr.write(`${line}\n`);
}

export async function runAcp(flags: Record<string, string>): Promise<void> {
  let client: AimeatClient;
  let agentName: string;
  let owner: string;
  let nodeUrl: string;

  if (flags.agent) {
    const loaded = await loadAgentByName(flags.agent, flags.owner || undefined);
    if (!loaded) {
      note(`Agent "${flags.agent}" is not connected here. Run: aimeat connect list`);
      process.exit(1);
    }
    agentName = loaded.agent;
    owner = loaded.config.owner;
    nodeUrl = loaded.config.node_url;
    client = new AimeatClient(nodeUrl, loaded.token);
  } else {
    const cfg = loadConfig();
    if (!cfg) {
      note('Not configured. Run: npx aimeat connect');
      process.exit(1);
    }
    agentName = cfg.agent;
    owner = cfg.owner;
    nodeUrl = cfg.node_url;
    client = await AimeatClient.fromConfig();
  }

  // The node id is in the GAII the node itself hands back, so it is read rather than guessed: a
  // guessed one would make every task assignment miss by a suffix.
  const me = await client.get('/v1/agents/me');
  const gaii = (me.data as { agent?: { gaii?: string } })?.agent?.gaii;
  if (!gaii) {
    note(`Could not read this agent's identity from ${nodeUrl}. Is the credential still good? Run: aimeat connect status`);
    process.exit(1);
  }

  note(`AIMEAT ACP agent: ${agentName} (${gaii}) on ${nodeUrl}. Work from this editor becomes tasks on that node.`);

  const app = buildAimeatAcpAgent({
    client,
    agentGaii: gaii,
    agentLabel: agentName,
    nodeLabel: new URL(nodeUrl).host,
  });

  const stream = ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
  app.connect(stream);

  // The editor owns the lifetime: it closes stdin when it is done with the agent.
  await new Promise<void>(resolve => process.stdin.on('close', () => resolve()));
  void owner;
}
