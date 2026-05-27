/**
 * @file auth.ts
 * @description Device authorization flow for agent registration.
 * @structure Prompts for connection details, starts RFC 8628 device auth, stores the issued token, and downloads the skill bundle.
 * @usage Called by `aimeat connect`.
 * @version-history v1.9.4 — 2026-05-28 — Update connector guidance, name-based inbox checks, network errors, and lazy interactive prompts.
 */
import { AimeatClient } from './api-client.js';
import { storeToken, getToken } from './keychain.js';
import { saveConfig, getConfigDir } from './config.js';
import { downloadSkillBundle } from './skill-bundle.js';

type Prompts = typeof import('@clack/prompts');

interface AuthArgs {
  url?: string;
  owner?: string;
  agent?: string;
}

interface ProgressHandle {
  start(message: string): void;
  stop(message?: string): void;
}

function createProgress(interactive: boolean, prompts: Prompts | null): ProgressHandle {
  if (interactive && prompts) return prompts.spinner();
  return {
    start(message: string) { console.log(message); },
    stop(message?: string) { if (message) console.log(message); },
  };
}

export async function runAuth(args: AuthArgs): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const prompts = interactive ? await import('@clack/prompts') : null;
  const intro = (message: string) => { if (prompts) prompts.intro(message); else console.log(message); };
  const outro = (message: string) => { if (prompts) prompts.outro(message); else console.log(message); };
  const info = (message: string) => { if (prompts) prompts.log.info(message); else console.log(message); };
  const success = (message: string) => { if (prompts) prompts.log.success(message); else console.log(message); };
  const warn = (message: string) => { if (prompts) prompts.log.warn(message); else console.warn(message); };
  const fail = (message: string) => { if (prompts) prompts.log.error(message); else console.error(message); };

  intro('AIMEAT Agent Connector');

  if (!interactive && (!args.url || !args.owner || !args.agent)) {
    fail('Missing required options. Usage: npx aimeat connect --url <node-url> --owner <owner> --agent <agent-name>');
    process.exit(1);
  }

  const nodeUrlInput = args.url ?? await prompts!.text({ message: 'AIMEAT node URL:', placeholder: 'https://aimeat.io' });
  if (prompts?.isCancel(nodeUrlInput)) { prompts.cancel('Cancelled.'); process.exit(0); }
  const nodeUrl = nodeUrlInput as string;

  const ownerInput = args.owner ?? await prompts!.text({ message: 'Your owner handle:' });
  if (prompts?.isCancel(ownerInput)) { prompts.cancel('Cancelled.'); process.exit(0); }
  const owner = ownerInput as string;

  const agentInput = args.agent ?? await prompts!.text({ message: 'Agent name:', placeholder: 'claude' });
  if (prompts?.isCancel(agentInput)) { prompts.cancel('Cancelled.'); process.exit(0); }
  const agentName = agentInput as string;

  const client = new AimeatClient(nodeUrl);

  const existingToken = await getToken(agentName, owner);
  if (existingToken) {
    client.setToken(existingToken);
    try {
      const check = await client.get(`/v1/agents/${encodeURIComponent(agentName)}/inbox`);
      if (check.ok) {
        success('Already connected! Token is valid.');
        outro('Done.');
        return;
      }
    } catch {
      warn('Could not verify stored token. Starting fresh auth.');
    }
  }

  const s = createProgress(interactive, prompts);
  s.start('Requesting device authorization...');

  let authResp;
  try {
    authResp = await client.post('/v1/agents/device-authorize', {
      agent_name: agentName,
      owner,
    });
  } catch (e) {
    s.stop('Authorization request failed.');
    fail((e as Error).message);
    process.exit(1);
  }

  if (!authResp.ok) {
    s.stop('Authorization request failed.');
    fail((authResp.error as { message: string })?.message ?? 'Unknown error');
    process.exit(1);
  }

  const authData = authResp.data as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };

  s.stop(`Verification code: ${authData.user_code}`);
  info(`Open ${authData.verification_uri} to approve.`);

  s.start('Polling for approval (every 5s)...');
  const interval = (authData.interval ?? 5) * 1000;
  let tokenData: { access_token: string; gaii: string; name: string } | null = null;

  for (let i = 0; i < 360; i++) {
    await new Promise(r => setTimeout(r, interval));
    let pollResp;
    try {
      pollResp = await client.post('/v1/agents/device-token', {
        device_code: authData.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
    } catch (e) {
      s.stop('Polling failed.');
      fail((e as Error).message);
      process.exit(1);
    }
    if (pollResp.ok) {
      tokenData = pollResp.data as typeof tokenData;
      break;
    }
    const errCode = (pollResp as unknown as { error?: string }).error;
    if (errCode === 'access_denied') {
      s.stop('Authorization denied.');
      fail('The owner denied the authorization request.');
      process.exit(1);
    }
    if (errCode !== 'authorization_pending' && errCode !== 'slow_down') {
      s.stop('Unexpected error.');
      fail(JSON.stringify(pollResp));
      process.exit(1);
    }
  }

  if (!tokenData) {
    s.stop('Timed out waiting for approval.');
    process.exit(1);
  }

  const token = tokenData as { access_token: string; gaii: string; name: string };
  s.stop('Approved!');

  await storeToken(agentName, owner, token.access_token);
  success(`Token stored (aimeat:${agentName}@${owner})`);

  saveConfig({ node_url: nodeUrl, agent: agentName, owner });

  client.setToken(token.access_token);
  try {
    await downloadSkillBundle(client, agentName);
    success(`Skill bundle downloaded to ${getConfigDir()}/${agentName}/SKILL.md`);
  } catch {
    warn('Could not download skill bundle. Run: npx aimeat connect refresh');
  }

  outro('Done. Your agent is connected.');
}
