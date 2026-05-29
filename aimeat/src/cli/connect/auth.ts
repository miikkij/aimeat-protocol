/**
 * @file auth.ts
 * @description Device authorization flow for agent registration.
 * @structure Prompts for connection details, starts RFC 8628 device auth, stores the issued token, and downloads the skill bundle.
 * @usage Called by `aimeat connect`.
 * @version-history v1.9.4 — 2026-05-28 — Update connector guidance, name-based inbox checks, network errors, and lazy interactive prompts.
 * @version-history v1.9.5 — 2026-05-28 — Validate and default the interactive node URL prompt.
 * @version-history v1.9.6 — 2026-05-28 — Accept raw OAuth token responses and avoid logging credentials.
 * @version-history v1.9.7 — 2026-05-28 — Print post-connection MCP and onboarding next steps.
 * @version-history v1.9.8 — 2026-05-28 — Include a paste-ready Hello Integration instruction for agents.
 * @version-history v1.9.9 — 2026-05-28 — Report the actual extracted SKILL.md path after bundle download.
 * @version-history v1.9.10 — 2026-05-28 — Clarify that skill bundles are downloaded and extracted locally.
 * @version-history v1.9.11 — 2026-05-28 — Print the extracted BUNDLE.md guide after download.
 * @version-history v1.9.12 — 2026-05-28 — Give agents the concrete Hello Integration MCP sequence.
 * @version-history v1.9.13 — 2026-05-28 — Print serve and Hello Integration next steps even when already connected.
 * @version-history v1.9.14 — 2026-05-28 — Default missing non-interactive agent names so the short connect command works.
 * @version-history v1.9.15 — 2026-05-28 — Clarify MCP tool names are not terminal commands.
 * @version-history v1.9.16 — 2026-05-28 — Include required telemetry reporting in Hello Integration guidance.
 * @version-history v1.9.17 — 2026-05-28 — State that Hello Integration is required first-run onboarding.
 * @version-history v1.9.18 -- 2026-05-28 -- Add correct post-onboarding setup instruction for actual commands, config, and knowledge artifacts.
 * @version-history v1.9.19 -- 2026-05-28 -- Add shared owner-memory tag guidance after onboarding.
 * @version-history v1.9.20 -- 2026-05-28 -- Move Hello Integration instruction into shared onboarding-prompt.ts to remove duplication with skill-bundle.ts.
 * @version-history v2.0.0 -- 2026-05-29 -- Write per-agent config alongside token + token table; mark first agent as primary so multi-agent serve has a sensible default.
 */
import { AimeatClient } from './api-client.js';
import { storeToken, getToken, listAllTokens } from './keychain.js';
import { saveConfig, savePerAgentConfig, loadPerAgentConfig } from './config.js';
import { downloadSkillBundle, readSkillBundleGuide } from './skill-bundle.js';
import { buildAgentOnboardingInstruction } from './onboarding-prompt.js';

type Prompts = typeof import('@clack/prompts');

type AgentMode = 'autonomous' | 'interactive' | 'task-runner' | 'coordinator';
const VALID_MODES: ReadonlyArray<AgentMode> = ['autonomous', 'interactive', 'task-runner', 'coordinator'];

interface AuthArgs {
  url?: string;
  owner?: string;
  agent?: string;
  mode?: string;
}

interface ProgressHandle {
  start(message: string): void;
  stop(message?: string): void;
}

interface DeviceTokenResponse {
  access_token: string;
  gaii: string;
  name: string;
}

interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

const DEFAULT_NODE_URL = 'https://aimeat.io';
const DEFAULT_AGENT_NAME = 'assistant';

function normalizeNodeUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDeviceTokenResponse(value: unknown): value is DeviceTokenResponse {
  return isRecord(value)
    && typeof value.access_token === 'string'
    && typeof value.gaii === 'string'
    && typeof value.name === 'string';
}

function getOAuthError(value: unknown): OAuthErrorResponse | null {
  if (!isRecord(value) || typeof value.error !== 'string') return null;
  return {
    error: value.error,
    error_description: typeof value.error_description === 'string' ? value.error_description : undefined,
  };
}

function buildNextStepsMessage(agentInstruction: string): string {
  return `Done. Your agent is connected.

NEXT TERMINAL COMMAND FOR THE AGENT
For AI runtimes that can attach an MCP stdio server (Claude Desktop, MCP-aware
IDEs, OpenClaw with mcp config, etc.), run this and leave it running:

  aimeat connect serve

After that MCP server is attached to the AI runtime, paste this instruction
into the connected agent:

${agentInstruction}

IF YOUR RUNTIME CANNOT ATTACH MCP VIA STDIO
(e.g. you are a CLI-only agent, a shell-driven assistant, or a runtime where
"aimeat connect serve" would just block without exposing tools to you):
use the shell fallback instead. Every MCP tool is also callable directly:

  aimeat connect tools                              # list available tool names
  aimeat connect schema <tool-name>                 # show the tool's input schema
  aimeat connect call <tool-name> --json '<input>'  # invoke a tool

Walk through the same Hello Integration sequence with these commands. Start
with: aimeat connect call aimeat_handbook_get --json '{}'`;
}

async function downloadAndPrintBundleGuide(
  client: AimeatClient,
  agentName: string,
  success: (message: string) => void,
  info: (message: string) => void,
  warn: (message: string) => void,
): Promise<void> {
  try {
    const bundle = await downloadSkillBundle(client, agentName);
    success(`Skill bundle downloaded and extracted to ${bundle.bundleDir}`);
    info(`Main skill file: ${bundle.skillPath}`);
    info(readSkillBundleGuide(bundle));
  } catch {
    warn('Could not download skill bundle. Run: npx aimeat connect refresh');
  }
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

  if (!interactive && (!args.url || !args.owner)) {
    fail('Missing required options. Usage: npx aimeat connect --url <node-url> --owner <owner> [--agent <agent-name>]');
    process.exit(1);
  }

  const nodeUrlInput = args.url ?? await prompts!.text({
    message: 'AIMEAT node URL:',
    placeholder: DEFAULT_NODE_URL,
    defaultValue: DEFAULT_NODE_URL,
    validate(value) {
      return normalizeNodeUrl(value) ? undefined : 'Enter a valid AIMEAT node URL, for example https://aimeat.io';
    },
  });
  if (prompts?.isCancel(nodeUrlInput)) { prompts.cancel('Cancelled.'); process.exit(0); }
  const nodeUrl = normalizeNodeUrl(nodeUrlInput as string);
  if (!nodeUrl) {
    fail('Missing or invalid node URL. Usage: npx aimeat connect --url https://aimeat.io --owner <owner> [--agent <agent-name>]');
    process.exit(1);
  }

  const ownerInput = args.owner ?? await prompts!.text({ message: 'Your owner handle:' });
  if (prompts?.isCancel(ownerInput)) { prompts.cancel('Cancelled.'); process.exit(0); }
  const owner = (ownerInput as string).trim();
  if (!owner) {
    fail('Missing owner handle. Usage: npx aimeat connect --url https://aimeat.io --owner <owner> [--agent <agent-name>]');
    process.exit(1);
  }

  const agentInput = args.agent ?? (interactive
    ? await prompts!.text({ message: 'Agent name:', placeholder: DEFAULT_AGENT_NAME, defaultValue: DEFAULT_AGENT_NAME })
    : (process.env.AIMEAT_AGENT_NAME || DEFAULT_AGENT_NAME));
  if (prompts?.isCancel(agentInput)) { prompts.cancel('Cancelled.'); process.exit(0); }
  const agentName = (agentInput as string).trim();
  if (!agentName) {
    fail('Missing agent name. Usage: npx aimeat connect --url https://aimeat.io --owner <owner> [--agent <agent-name>]');
    process.exit(1);
  }
  if (!args.agent && !interactive) {
    info(`No --agent provided; using agent name "${agentName}". To choose another name, rerun with --agent <name>.`);
  }

  const client = new AimeatClient(nodeUrl);

  const existingToken = await getToken(agentName, owner);
  if (existingToken) {
    client.setToken(existingToken);
    try {
      const check = await client.get(`/v1/agents/${encodeURIComponent(agentName)}/inbox`);
      if (check.ok) {
        success('Already connected! Token is valid.');
        saveConfig({ node_url: nodeUrl, agent: agentName, owner });
        await downloadAndPrintBundleGuide(client, agentName, success, info, warn);
        outro(buildNextStepsMessage(buildAgentOnboardingInstruction()));
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
  let tokenData: DeviceTokenResponse | null = null;

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
    if (isDeviceTokenResponse(pollResp)) {
      tokenData = pollResp;
      break;
    }
    if (pollResp.ok && isDeviceTokenResponse(pollResp.data)) {
      tokenData = pollResp.data;
      break;
    }
    const oauthError = getOAuthError(pollResp);
    const errCode = oauthError?.error;
    if (errCode === 'access_denied') {
      s.stop('Authorization denied.');
      fail('The owner denied the authorization request.');
      process.exit(1);
    }
    if (errCode !== 'authorization_pending' && errCode !== 'slow_down') {
      s.stop('Unexpected error.');
      fail(oauthError?.error_description ?? 'Token endpoint returned an unrecognized response. No credentials were printed.');
      process.exit(1);
    }
  }

  if (!tokenData) {
    s.stop('Timed out waiting for approval.');
    process.exit(1);
  }

  const token = tokenData;
  s.stop('Approved!');

  // Before storing the new token, check whether this is the first agent (so it
  // gets marked as `primary: true` in its per-agent config -- multi-agent serve
  // resolves to the primary agent when no agent_name is given).
  const tokensBefore = await listAllTokens();
  const sameAlreadyExists = tokensBefore.some(t => t.agent === agentName && t.owner === owner);
  const isFirstAgent = tokensBefore.filter(t => !(t.agent === agentName && t.owner === owner)).length === 0;

  await storeToken(agentName, owner, token.access_token);
  success(`Token stored (aimeat:${agentName}@${owner})`);

  // Per-agent config (~/.aimeat/agents/{agent}/config.yaml). Preserve any
  // existing runner/wake/poll_interval if the agent is being re-connected.
  const existingPerAgent = loadPerAgentConfig(agentName);
  savePerAgentConfig(agentName, {
    agent: agentName,
    owner,
    node_url: nodeUrl,
    primary: existingPerAgent?.primary ?? isFirstAgent,
    poll_interval: existingPerAgent?.poll_interval,
    wake: existingPerAgent?.wake,
    runner: existingPerAgent?.runner,
  });

  // Legacy global config -- kept so older single-agent code paths
  // (`loadConfig().agent`) keep working. The first-registered agent becomes the
  // global's `agent`; later agents do not overwrite it.
  if (isFirstAgent || sameAlreadyExists) {
    saveConfig({ node_url: nodeUrl, agent: agentName, owner });
  }

  client.setToken(token.access_token);
  await downloadAndPrintBundleGuide(client, agentName, success, info, warn);

  outro(buildNextStepsMessage(buildAgentOnboardingInstruction()));
}
