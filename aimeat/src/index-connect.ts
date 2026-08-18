/**
 * @file src/index-connect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat connect` subcommand dispatch (agent connector: auth, serve, inbox, tasks, tools, list, remove, refresh, logout). Extracted from index.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from index.ts (max-file-lines)
 */

import { CONNECT_HELP_TEXT } from './index-help.js';
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
    const { listAllTokens } = await import('./cli/connect/keychain.js');
    const { loadPerAgentConfig } = await import('./cli/connect/config.js');
    const tokens = await listAllTokens();
    if (tokens.length === 0) { console.log('No agents connected. Run: aimeat connect'); }
    else {
      console.log(`Connected agents (${tokens.length}):`);
      for (const t of tokens) {
        const pa = loadPerAgentConfig(t.agent);
        // Server-side mode (what AIMEAT thinks this agent is) -- written by
        // `connect add --mode <mode>`. Falls back to deriving from runner block
        // for agents registered before the mode field existed.
        const mode = pa?.mode ?? (pa?.runner?.command ? 'task-runner' : 'interactive');
        // Runner readiness: task-runner mode alone is not enough; the connector
        // needs a `runner:` block to actually spawn the subprocess.
        const runnerReady = Boolean(pa?.runner?.command);
        const needsRunner = mode === 'task-runner' && !runnerReady;
        const primary = pa?.primary ? ' (primary)' : '';
        const nodeUrl = pa?.node_url ?? '(no per-agent config)';
        const warn = needsRunner ? '  [missing runner: block]' : '';
        console.log(`  - ${t.agent}@${t.owner} [${mode}]${primary}${warn}  ->  ${nodeUrl}`);
        if (pa?.runner) console.log(`      runner: ${pa.runner.command} ${(pa.runner.args ?? []).join(' ')}`);
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
    const { perAgentConfigPath } = await import('./cli/connect/config.js');
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
      const dir = path.dirname(perAgentConfigPath(m.agent));
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
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
