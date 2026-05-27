#!/usr/bin/env node
/**
 * @file index.ts
 * @description CLI entry point and command router for @aimeat/connect.
 */
import { runAuth } from './auth.js';
import { runInbox } from './inbox.js';
import { runTasks } from './tasks.js';
import { runSend } from './send.js';
import { runStatus } from './status.js';
import { runDocs } from './docs.js';
import { runServe } from '../mcp/server.js';

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return flags;
}

const flags = parseFlags(args);

async function main() {
  switch (command) {
    case 'serve':
      await runServe(flags);
      break;
    case 'inbox':
      await runInbox();
      break;
    case 'tasks':
      await runTasks();
      break;
    case 'send':
      await runSend(flags);
      break;
    case 'status':
    case 'whoami':
      await runStatus();
      break;
    case 'docs':
      await runDocs(args[1]);
      break;
    case 'refresh': {
      const { AimeatClient } = await import('../lib/api-client.js');
      const { downloadSkillBundle } = await import('../lib/skill-bundle.js');
      const { loadConfig, getConfigDir } = await import('../lib/config.js');
      const cfg = loadConfig();
      if (!cfg) { console.error('Not configured. Run: npx @aimeat/connect'); process.exit(1); }
      const cl = await AimeatClient.fromConfig();
      await downloadSkillBundle(cl, cfg.agent);
      console.log(`Skill bundle refreshed at ${getConfigDir()}/${cfg.agent}/`);
      break;
    }
    case 'logout': {
      const { deleteToken } = await import('../lib/keychain.js');
      const { loadConfig } = await import('../lib/config.js');
      const cfg = loadConfig();
      if (cfg) { await deleteToken(cfg.agent, cfg.owner); console.log('Credentials removed.'); }
      else console.log('Not configured.');
      break;
    }
    case 'config': {
      const { loadConfig, getConfigDir } = await import('../lib/config.js');
      const c = loadConfig();
      if (c) console.log(JSON.stringify(c, null, 2));
      else console.log(`No config found. Expected at: ${getConfigDir()}/config.yaml`);
      break;
    }
    default:
      await runAuth({ url: flags.url, owner: flags.owner, agent: flags.agent });
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
