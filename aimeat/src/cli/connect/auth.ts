/**
 * @file auth.ts
 * @description Device authorization flow for agent registration.
 */
import * as p from '@clack/prompts';
import { AimeatClient } from './api-client.js';
import { storeToken, getToken } from './keychain.js';
import { saveConfig, getConfigDir } from './config.js';
import { downloadSkillBundle } from './skill-bundle.js';

interface AuthArgs {
  url?: string;
  owner?: string;
  agent?: string;
}

export async function runAuth(args: AuthArgs): Promise<void> {
  p.intro('AIMEAT Agent Connector');

  const nodeUrl = args.url ?? await p.text({ message: 'AIMEAT node URL:', placeholder: 'https://aimeat.io' }) as string;
  if (p.isCancel(nodeUrl)) { p.cancel('Cancelled.'); process.exit(0); }

  const owner = args.owner ?? await p.text({ message: 'Your owner handle:' }) as string;
  if (p.isCancel(owner)) { p.cancel('Cancelled.'); process.exit(0); }

  const agentName = args.agent ?? await p.text({ message: 'Agent name:', placeholder: 'claude' }) as string;
  if (p.isCancel(agentName)) { p.cancel('Cancelled.'); process.exit(0); }

  const client = new AimeatClient(nodeUrl);

  const existingToken = await getToken(agentName, owner);
  if (existingToken) {
    client.setToken(existingToken);
    const check = await client.get('/v1/agents/me/inbox');
    if (check.ok) {
      p.log.success('Already connected! Token is valid.');
      p.outro('Done.');
      return;
    }
    p.log.warn('Stored token is expired or invalid. Starting fresh auth.');
  }

  const s = p.spinner();
  s.start('Requesting device authorization...');

  const authResp = await client.post('/v1/agents/device-authorize', {
    agent_name: agentName,
    owner,
  });

  if (!authResp.ok) {
    s.stop('Authorization request failed.');
    p.log.error((authResp.error as { message: string })?.message ?? 'Unknown error');
    process.exit(1);
  }

  const authData = authResp.data as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };

  s.stop(`Verification code: ${authData.user_code}`);
  p.log.info(`Open ${authData.verification_uri} to approve.`);

  s.start('Polling for approval (every 5s)...');
  const interval = (authData.interval ?? 5) * 1000;
  let tokenData: { access_token: string; gaii: string; name: string } | null = null;

  for (let i = 0; i < 360; i++) {
    await new Promise(r => setTimeout(r, interval));
    const pollResp = await client.post('/v1/agents/device-token', {
      device_code: authData.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (pollResp.ok) {
      tokenData = pollResp.data as typeof tokenData;
      break;
    }
    const errCode = (pollResp as unknown as { error?: string }).error;
    if (errCode === 'access_denied') {
      s.stop('Authorization denied.');
      p.log.error('The owner denied the authorization request.');
      process.exit(1);
    }
    if (errCode !== 'authorization_pending' && errCode !== 'slow_down') {
      s.stop('Unexpected error.');
      p.log.error(JSON.stringify(pollResp));
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
  p.log.success(`Token stored (aimeat:${agentName}@${owner})`);

  saveConfig({ node_url: nodeUrl, agent: agentName, owner });

  client.setToken(token.access_token);
  try {
    await downloadSkillBundle(client, agentName);
    p.log.success(`Skill bundle downloaded to ${getConfigDir()}/${agentName}/SKILL.md`);
  } catch {
    p.log.warn('Could not download skill bundle. Run: npx @aimeat/connect refresh');
  }

  p.outro('Done. Your agent is connected.');
}
