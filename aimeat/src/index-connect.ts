/**
 * @file src/index-connect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat connect` subcommand dispatch (agent connector: auth, serve, inbox, tasks, tools, list, remove, refresh, logout). Extracted from index.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from index.ts (max-file-lines)
 */

import { CONNECT_HELP_TEXT } from './index-help.js';
import { getConfigDir } from './cli/connect/config.js';
import { logger } from './utils/logger.js';

/**
 * Handle the `aimeat connect ...` subcommand family. Parses connector flags from raw
 * argv, dispatches to the matching connector CLI action, and (except for `serve`)
 * drains async handles and exits the process. Preserves the exact dispatch order and
 * exit semantics of the original inline block in index.ts.
 */
export async function runConnectCli(positionals: string[]): Promise<void> {
  const connectAction = positionals[1];
  let shouldExitAfterConnect = true;
  const connectExitDelayMs = 250;
  // Parse connector flags from raw argv. Boolean flags are stored as "true".
  const rawArgs = process.argv.slice(2);
  const connectFlags: Record<string, string> = {};
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith('--')) {
      if (rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--')) {
        connectFlags[rawArgs[i].slice(2)] = rawArgs[++i];
      } else {
        connectFlags[rawArgs[i].slice(2)] = 'true';
      }
    }
  }

  if (connectAction === 'help') {
    console.log(CONNECT_HELP_TEXT);
  } else if (connectAction === 'client') {
    const { runConnectClient } = await import('./cli/connect/clients/index.js');
    await runConnectClient(positionals[2], connectFlags);
  } else if (connectAction === 'serve') {
    const { runServe } = await import('./cli/connect/mcp/server.js');
    await runServe(connectFlags);
    shouldExitAfterConnect = false;
  } else if (connectAction === 'acp') {
    // An editor spawns this and speaks the Agent Client Protocol to it over stdio. Like `serve`, it
    // runs until the other side closes the pipe, so it must not be exited after dispatch.
    const { runAcp } = await import('./cli/connect/acp/index.js');
    await runAcp(connectFlags);
    shouldExitAfterConnect = false;
  } else if (connectAction === 'inbox') {
    const { runInbox } = await import('./cli/connect/inbox.js');
    await runInbox();
  } else if (connectAction === 'tasks') {
    const { runTasks } = await import('./cli/connect/tasks.js');
    await runTasks();
  } else if (connectAction === 'send') {
    const { runSend } = await import('./cli/connect/send.js');
    await runSend(connectFlags);
  } else if (connectAction === 'status' || connectAction === 'whoami') {
    const { runStatus } = await import('./cli/connect/status.js');
    await runStatus();
  } else if (connectAction === 'docs') {
    const { runDocs } = await import('./cli/connect/docs.js');
    await runDocs(positionals[2]);
  } else if (connectAction === 'tools') {
    const { runToolList } = await import('./cli/connect/tool-call.js');
    runToolList(connectFlags);
  } else if (connectAction === 'schema') {
    const { runToolSchema } = await import('./cli/connect/tool-call.js');
    runToolSchema(positionals[2]);
  } else if (connectAction === 'call') {
    const { runToolCall } = await import('./cli/connect/tool-call.js');
    await runToolCall(positionals[2], connectFlags);
  } else if (connectAction === 'refresh') {
    const { AimeatClient } = await import('./cli/connect/api-client.js');
    const { downloadSkillBundle, readSkillBundleGuide } = await import('./cli/connect/skill-bundle.js');
    const { loadConfig, loadAgentByName } = await import('./cli/connect/config.js');
    // Per-agent refresh: if --agent is given, refresh THAT agent's bundle using
    // that agent's token + node URL. Without --agent, fall back to the global
    // primary config (single-agent installs work unchanged). The previous
    // behaviour silently routed every `refresh --agent X` through the primary,
    // so multi-agent installs never got per-agent bundle updates.
    let bundleAgent: string;
    let cl: InstanceType<typeof AimeatClient>;
    if (connectFlags.agent) {
      const loaded = await loadAgentByName(connectFlags.agent, connectFlags.owner || undefined);
      if (!loaded) {
        console.error(`Agent "${connectFlags.agent}" not found in connector. Run: aimeat connect list`);
        process.exit(1);
      }
      bundleAgent = loaded.agent;
      cl = new AimeatClient(loaded.config.node_url, loaded.token);
    } else {
      const cfg = loadConfig();
      if (!cfg) { console.error('Not configured. Run: npx aimeat connect'); process.exit(1); }
      bundleAgent = cfg.agent;
      cl = await AimeatClient.fromConfig();
    }
    try {
      const bundle = await downloadSkillBundle(cl, bundleAgent);
      console.log(`Skill bundle for ${bundleAgent} downloaded and extracted to ${bundle.bundleDir}/`);
      console.log(`Main skill file: ${bundle.skillPath}`);
      console.log('');
      console.log(readSkillBundleGuide(bundle));
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  } else if (connectAction === 'logout') {
    const { deleteToken } = await import('./cli/connect/keychain.js');
    const { loadConfig } = await import('./cli/connect/config.js');
    const cfg = loadConfig();
    if (cfg) { await deleteToken(cfg.agent, cfg.owner); console.log('Credentials removed.'); }
    else console.log('Not configured.');
  } else if (connectAction === 'config') {
    const { loadConfig, getConfigDir } = await import('./cli/connect/config.js');
    const c = loadConfig();
    if (c) console.log(JSON.stringify(c, null, 2));
    else console.log(`No config found. Expected at: ${getConfigDir()}/config.yaml`);
  } else if (connectAction === 'list') {
    const { loadAllAgents, agentsOnLegacyLayout } = await import('./cli/connect/config.js');
    const { listAllTokens } = await import('./cli/connect/keychain.js');
    const { AimeatClient: ListClient } = await import('./cli/connect/api-client.js');
    const loaded = await loadAllAgents();
    if (loaded.length === 0) {
      // NAME THE HOME IT LOOKED IN. The connector home is <cwd>/.aimeat, so running this from the
      // wrong directory finds an empty one and the old message — "Run: aimeat connect" — told the
      // person to enrol a NEW agent when their fifty were one directory away. Measured on
      // 2026-09-03: `aimeat connect list` in the protocol checkout said none, and the same command
      // in the crew checkout said fifty.
      console.log(`No agents connected in ${getConfigDir()}`);
      console.log('The connector home is <this directory>/.aimeat, so agents enrolled elsewhere are');
      console.log('not visible from here. Either change to that directory, or point AIMEAT_HOME at it:');
      console.log('  AIMEAT_HOME=/path/to/project/.aimeat aimeat connect list');
      console.log('To enrol a new agent instead: aimeat connect');
    }
    else {
      // MODE COMES FROM THE NODE, which holds AgentRecord.mode and serves it with run_mode,
      // identity_version and card_enrolled in one listing. The local mirror is gone: it was a
      // second statement of the node's fact and could disagree with it.
      //
      // One call per (owner, node), best effort. This command used to make no network call at all
      // and must keep working without one, so an unreachable node degrades to the runner-derived
      // label with `?` beside it rather than failing the listing.
      const modes = new Map<string, string>();
      const asked = new Set<string>();
      for (const a of loaded) {
        const key = `${a.owner}|${a.config.node_url}`;
        if (asked.has(key)) continue;
        asked.add(key);
        try {
          const cl = new ListClient(a.config.node_url, a.token);
          const r = await cl.get(`/v1/agents?owner=${encodeURIComponent(a.owner)}`);
          for (const rec of ((r.data as { agents?: Array<{ name?: string; mode?: string }> })?.agents ?? [])) {
            if (rec.name && rec.mode) modes.set(`${rec.name}@${a.owner}`, rec.mode);
          }
          // Being offline IS an answer here: the label falls back to the local guess, is
          // printed with a `?`, and the note below says so. This listing must keep working
          // with no network at all.
          // eslint-disable-next-line aimeat/no-silent-catch -- see the three lines above
        } catch { /* offline */ }
      }

      console.log(`Connected agents (${loaded.length}):`);
      for (const a of loaded) {
        const pa = a.config;
        const fromNode = modes.get(`${a.agent}@${a.owner}`);
        const mode = fromNode ?? `${pa.runner?.command ? 'task-runner' : 'interactive'}?`;
        // Runner readiness: task-runner mode alone is not enough; the connector
        // needs a `runner:` block to actually spawn the subprocess.
        const needsRunner = mode.startsWith('task-runner') && !pa.runner?.command;
        const primary = pa.primary ? ' (primary)' : '';
        const warn = needsRunner ? '  [missing runner: block]' : '';
        console.log(`  - ${a.agent}@${a.owner} [${mode}]${primary}${warn}  ->  ${pa.node_url}`);
        if (pa.runner) console.log(`      runner: ${pa.runner.command} ${(pa.runner.args ?? []).join(' ')}`);
      }
      if (modes.size === 0 && loaded.length > 0) {
        console.log('  (a mode marked ? was guessed locally: the node could not be reached)');
      }
      const stale = agentsOnLegacyLayout(await listAllTokens());
      if (stale.length > 0) {
        console.log(`\n${stale.length} agent(s) still keep settings in the old shared layout: ${stale.join(', ')}`);
        console.log('They are read from there and copied forward on first use. Nothing is deleted for you.');
      }
    }
  } else if (connectAction === 'remove') {
    const target = positionals[2];
    if (!target) {
      console.error('Usage: aimeat connect remove <agent-name> [--owner <owner>]');
      process.exit(1);
    }
    const ownerHint = connectFlags.owner;
    const { listAllTokens, deleteToken } = await import('./cli/connect/keychain.js');
    const { perAgentConfigPath, legacyPerAgentConfigPath } = await import('./cli/connect/config.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tokens = await listAllTokens();
    const matches = tokens.filter(t => t.agent === target && (!ownerHint || t.owner === ownerHint));
    if (matches.length === 0) { console.error(`Agent '${target}' not found.`); process.exit(1); }
    if (matches.length > 1) {
      console.error(`Multiple agents named '${target}' found under different owners. Re-run with --owner to disambiguate:`);
      for (const m of matches) console.error(`  - owner: ${m.owner}`);
      process.exit(1);
    }
    const m = matches[0];
    await deleteToken(m.agent, m.owner);
    // Remove per-agent config directory (best-effort)
    try {
      // Both layouts: this owner's own directory always, and the old SHARED one only when no
      // other owner still has an agent of that name — that file may be their settings too.
      const dir = path.dirname(perAgentConfigPath(m.agent, m.owner));
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      const stillShared = tokens.some(t => t.agent === m.agent && t.owner !== m.owner);
      if (!stillShared) {
        const legacyDir = path.dirname(legacyPerAgentConfigPath(m.agent));
        if (fs.existsSync(legacyDir)) fs.rmSync(legacyDir, { recursive: true, force: true });
      }
    } catch (err) { logger.warn('runConnectCli: ignore', { error: String(err) }); }
    console.log(`Removed ${m.agent}@${m.owner}.`);
  } else if (connectAction === 'add') {
    // Alias for the default `aimeat connect` flow -- explicit subcommand for clarity in docs.
    const { runAuth } = await import('./cli/connect/auth.js');
    await runAuth({
      url: connectFlags.url,
      owner: connectFlags.owner,
      agent: connectFlags.agent,
      mode: connectFlags.mode,
    });
  } else {
    // Default: run auth
    const { runAuth } = await import('./cli/connect/auth.js');
    await runAuth({
      url: connectFlags.url,
      owner: connectFlags.owner,
      agent: connectFlags.agent,
      mode: connectFlags.mode,
    });
  }
  if (shouldExitAfterConnect) {
    if (connectExitDelayMs > 0) await new Promise(resolve => setTimeout(resolve, connectExitDelayMs));
    process.exit(process.exitCode ?? 0);
  }
}
