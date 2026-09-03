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
 *   v1.0.1 — 2026-09-01 — The session's owner comes from the CREDENTIAL, not from the per-agent
 *     config file. That file is keyed by the bare agent name, so two owners with a `concierge`
 *     share one and its `owner` field is whichever enrolled last: an ACP session for one of them
 *     was attributed to the other.
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6b).
 */
import { Readable, Writable } from 'node:stream';
import { resolveToken } from '../agent-key.js';
import { getConfigDir } from '../config.js';
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
      // "here" is a DIRECTORY, and saying so is the whole difference. The connector home is
      // <cwd>/.aimeat, so this fires when somebody runs the command from the wrong checkout —
      // which is what happened the first time it was tried, with fifty agents one directory away.
      note(`Agent "${flags.agent}" is not in the connector home at ${getConfigDir()}.`);
      note('Agents live in <this directory>/.aimeat. Change to the directory they were enrolled in,');
      note('or set AIMEAT_HOME to it. `aimeat connect list` there shows what is available.');
      process.exit(1);
    }
    agentName = loaded.agent;
    // FROM THE CREDENTIAL, not from the config file. `agents/<name>/config.yaml` is keyed by the
    // bare agent name, so two owners with a `concierge` share one file and its `owner` field is
    // whichever of them enrolled last — an ACP session for B would have been attributed to A.
    // `loaded.owner` comes from the credential filename, which is owner-qualified. Same shape as
    // the CLI dispatch at tool-call.ts.
    owner = loaded.owner;
    // `node_url` is a genuine setting and legitimately lives in the config. It is shared by the
    // same file, so two owners on DIFFERENT nodes would both be sent to whichever enrolled last;
    // that is the config-directory problem, scoped in the spec rather than papered over here.
    nodeUrl = loaded.config.node_url;
    // resolveToken, NOT `loaded.token`. A v2 agent has no stored bearer at all — it holds a key and
    // mints a credential per use — so reading the stored one gave an empty string, and the identity
    // read below answered 401 with "is the credential still good?" about a credential that was fine.
    // Found on 2026-09-03, the first time this door was opened for a migrated agent. Same shape as
    // the enrolment invoke a few hours earlier: a path written before v2 existed and never told.
    const token = await resolveToken(loaded.agent, loaded.owner, nodeUrl);
    if (!token) {
      note(`No usable credential for "${loaded.agent}" here. Run: aimeat connect status`);
      process.exit(1);
    }
    client = new AimeatClient(nodeUrl, token);
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
  // `GET /v1/agents/:gaii` answers with the profile at the TOP of `data`, so the identity is
  // `data.gaii`. This read `data.agent.gaii` and had never been right — it could not be caught,
  // because the route it asks answered 404 for every agent until 2026-09-03 (the `/me` rewrite
  // resolved the caller to a bare name). Two defects stacked: fixing the first only revealed the
  // second. `data.agent.gaii` is kept as a fallback for a node that answers the other shape.
  const meData = me.data as { gaii?: string; agent?: { gaii?: string } } | undefined;
  const gaii = meData?.gaii ?? meData?.agent?.gaii;
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
