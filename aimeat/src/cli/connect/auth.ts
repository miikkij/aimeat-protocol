/**
 * @file auth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 * @version-history v2.1.0 -- 2026-09-30 -- `--scopes a,b,c`: the permissions the agent asks for go into the device authorization request.
 * @version-history v2.1.1 -- 2026-10-14 -- Print the approval address with the user code (approvalUrl); the bare verification_uri opened the consent page on "Missing code parameter".
 * @version-history v2.3.0 -- 2026-10-25 -- The agent's private key of each approval is kept beside its token, and a reconnect signs the device-authorize request with it (`proof`), so the owner sees the agent coming back rather than a new device taking it over (services/device-return-proof.ts; secaudit2026oct22, lead 2150).
 * @version-history v2.3.1 -- 2026-10-26 -- A stored token the node answers 401 is not sent with the device-authorize request: the node refuses a dead bearer, so a reconnect after the token expired (the path aimeat-crewai names for an expired token) failed with "Authorization request failed" before the owner saw anything (secaudit2026oct22, lead 2150 follow-up).
 * @version-history v2.3.2 -- 2026-10-27 -- The return proof is the v2 text, which names the node's id (read from GET /.well-known/aimeat), so a proof made for one node verifies on no other one; without the id the request goes without proof (secaudit2026oct26, device-return-proof:return-proof-unbound-to-node-and-request).
 * @version-history v2.2.0 -- 2026-10-25 -- The per-agent config is written with saveConnectedAgentConfig: connecting records the runner and wake command it keeps as trusted (command-trust.ts; secaudit2026oct22, lead 4763).
 * @version-history v2.3.2 -- 2026-10-27 -- ownerHandleFrom accepts only one plain path segment as the owner handle and runAuth stops before writing anything otherwise: the handle names the token, key and config files and is read back into generated scripts (secaudit2026oct26, node-owner-handle-in-local-paths).
 */
import { AimeatClient } from './api-client.js';
import { storeToken, getToken, listAllTokens, storeAgentKey, getAgentKey } from './keychain.js';
import { sign } from '../../auth/keypair.js';
import { returnProofMessageV2 } from '../../services/device-return-proof.js';
import { saveConfig, saveConnectedAgentConfig, loadPerAgentConfig } from './config.js';
import { downloadSkillBundle, readSkillBundleGuide } from './skill-bundle.js';
import { buildAgentOnboardingInstruction } from './onboarding-prompt.js';

type Prompts = typeof import('@clack/prompts');

type AgentMode = 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
const VALID_MODES: ReadonlyArray<AgentMode> = ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'];

interface AuthArgs {
  url?: string;
  owner?: string;
  agent?: string;
  mode?: string;
  /**
   * The permissions this agent asks for, comma-separated (`task:read,task:write,agent:write`). Sent
   * as `scopes` in the device authorization request, so the owner's consent screen shows them and an
   * approval that names none grants them. Without it the node's default set applies, which cannot
   * take work, and the refusals come later as SCOPE_DENIED.
   */
  scopes?: string;
}

interface ProgressHandle {
  start(message: string): void;
  stop(message?: string): void;
}

interface DeviceTokenResponse {
  access_token: string;
  gaii: string;
  name: string;
  owner?: string;
  /** The agent's private key of this approval (base64 Ed25519). */
  privateKey?: string;
}

/**
 * The canonical, '@'-free owner HANDLE for this agent — taken from the device-token response, NEVER the
 * raw `--owner` the user typed (which may be an email, e.g. when connecting by email). The account is
 * resolved server-side (the browser login), and the handle comes back in the response, so keying local
 * artifacts (token filename, per-agent config) by it keeps `{agent}@{owner}.token` unambiguous and lets
 * the serve daemon parse it correctly. Prefer the gaii's owner segment (`agent#owner@node`), fall back to
 * the response `owner`, then to the CLI value with any '@'-suffix stripped.
 */
export function ownerHandleFrom(tokenData: DeviceTokenResponse, cliOwner: string): string {
  const fromGaii = /#([^@]+)@/.exec(tokenData.gaii);
  let handle: string;
  if (fromGaii) handle = fromGaii[1];
  else if (typeof tokenData.owner === 'string' && tokenData.owner && !tokenData.owner.includes('@')) handle = tokenData.owner;
  else handle = cliOwner.includes('@') ? cliOwner.split('@')[0] : cliOwner;
  // The handle names files under the connector home and is read back into generated scripts, so
  // it must be one plain path segment. Every node issues owner names inside this set (utils/gaii.ts
  // OWNER_RE is a subset of it); anything else is refused before a file is written.
  if (!SAFE_OWNER_SEGMENT.test(handle)) {
    throw new Error(`The node answered with the owner name "${handle.replace(/[\r\n]/g, ' ')}", which is not a valid account name. Nothing was stored.`);
  }
  return handle;
}

/** One path segment: letters, digits, dot, underscore and hyphen, not starting with a dot. */
const SAFE_OWNER_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

/**
 * The address the owner opens to approve the agent. The consent page at /v1/agents/verify reads the
 * user code from `?code=` and shows only an error without it, so the bare `verification_uri` is never
 * printed. The node sends `verification_uri_complete`; when it does not, the code is added here.
 */
export function approvalUrl(d: { user_code: string; verification_uri: string; verification_uri_complete?: string }): string {
  if (d.verification_uri_complete) return d.verification_uri_complete;
  const url = new URL(d.verification_uri);
  url.searchParams.set('code', d.user_code);
  return url.toString();
}

interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

/** The node's id as its discovery document says it, for the return proof; null when it does not answer. */
async function nodeIdAt(client: AimeatClient, warn: (msg: string) => void): Promise<string | null> {
  try {
    const res = await client.get('/.well-known/aimeat');
    const id = (res.data as { node_id?: unknown } | undefined)?.node_id;
    return res.ok && typeof id === 'string' && id ? id : null;
  } catch (e) {
    // No answer is no id: the request then goes without proof, and the owner sees what it is.
    warn(`The node's discovery document could not be read (${(e as Error).message}).`);
    return null;
  }
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
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
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

  let mode: AgentMode | undefined;
  if (args.mode !== undefined) {
    if (!VALID_MODES.includes(args.mode as AgentMode)) {
      fail(`Invalid --mode: ${args.mode}. Must be one of: ${VALID_MODES.join(', ')}`);
      process.exit(1);
    }
    mode = args.mode as AgentMode;
  }

  const existingToken = await getToken(agentName, owner);
  if (existingToken) {
    client.setToken(existingToken);
    try {
      const check = await client.get(`/v1/agents/${encodeURIComponent(agentName)}/inbox`);
      if (check.ok) {
        success('Already connected! Token is valid.');
        saveConfig({ node_url: nodeUrl, agent: agentName, owner });
        // `--mode` used to be mirrored into the local per-agent config so `connect list` could
        // label the agent without a REST call. It is not written any more: the node holds
        // AgentRecord.mode and serves it in GET /v1/agents alongside run_mode, identity_version
        // and card_enrolled, so the local copy was a second statement of the node's fact that
        // could disagree with it. Server-side mode still changes only through the owner's own
        // door (Profile → Agents, or PATCH /v1/agents/:name/mode).
        if (mode) {
          info(`--mode is set on the node, not locally; this connector reads it from GET /v1/agents.`);
        }
        await downloadAndPrintBundleGuide(client, agentName, success, info, warn);
        outro(buildNextStepsMessage(buildAgentOnboardingInstruction()));
        return;
      }
      // A stored token the node refused (expired or revoked) is not sent with the device request.
      // The node refuses a dead bearer on every route (auth/middleware.ts), so the reconnect after
      // an expired token failed before the owner saw a request. The request goes without it, with
      // the proof below signed by the key this machine kept.
      if (client.lastStatus === 401) client.setToken('');
    } catch {
      warn('Could not verify stored token. Starting fresh auth.');
    }
  }

  const scopes = typeof args.scopes === 'string'
    ? args.scopes.split(',').map(x => x.trim()).filter(Boolean)
    : [];
  if (typeof args.scopes === 'string' && scopes.length === 0) {
    fail('Invalid --scopes: give the permissions comma-separated, e.g. --scopes task:read,task:write');
    process.exit(1);
  }

  const s = createProgress(interactive, prompts);
  s.start('Requesting device authorization...');

  // An agent this machine connected before proves it is coming back with the key its last approval
  // gave it, so the owner sees a return rather than a new device taking it over
  // (services/device-return-proof.ts). No key here: the request goes without proof, as before.
  // The proof names the node it goes to (v2), so a proof made for this node verifies on no other one
  // (secaudit2026oct26).
  const heldKey = await getAgentKey(agentName, owner);
  let proof: { signed_at: string; signature: string } | undefined;
  const nodeId = heldKey ? await nodeIdAt(client, warn) : null;
  if (heldKey && !nodeId) warn('The node did not say its id; connecting without proof that it is the same agent.');
  if (heldKey && nodeId) {
    const signedAt = new Date().toISOString();
    try {
      proof = { signed_at: signedAt, signature: await sign(heldKey, returnProofMessageV2(nodeId, owner, agentName, signedAt)) };
    } catch {
      warn('The key this machine kept for the agent could not sign; connecting without proof that it is the same agent.');
    }
  }

  let authResp;
  try {
    authResp = await client.post('/v1/agents/device-authorize', {
      agent_name: agentName,
      owner,
      ...(mode ? { mode } : {}),
      ...(scopes.length ? { scopes } : {}),
      ...(proof ? { proof } : {}),
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
    verification_uri_complete?: string;
    interval: number;
  };

  s.stop(`Verification code: ${authData.user_code}`);
  info(`Open ${approvalUrl(authData)} to approve.`);

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

  // Key ALL local artifacts by the resolved owner HANDLE, not the raw `--owner` (which may be an email).
  // This keeps `{agent}@{owner}.token` unambiguous so the serve daemon derives the right agent name.
  let ownerHandle: string;
  try {
    ownerHandle = ownerHandleFrom(token, owner);
  } catch (e) {
    fail((e as Error).message);
    process.exit(1);
  }

  // Before storing the new token, check whether this is the first agent (so it
  // gets marked as `primary: true` in its per-agent config -- multi-agent serve
  // resolves to the primary agent when no agent_name is given).
  const tokensBefore = await listAllTokens();
  const sameAlreadyExists = tokensBefore.some(t => t.agent === agentName && t.owner === ownerHandle);
  // PER OWNER: "the first agent" means the first of THIS owner's. A second person connecting on a
  // shared machine is not joining the first person's account, and marking their agent non-primary
  // because somebody else already had one would make "the default" mean nothing inside either.
  const isFirstAgentOfOwner = tokensBefore
    .filter(t => t.owner === ownerHandle && t.agent !== agentName).length === 0;

  await storeToken(agentName, ownerHandle, token.access_token);
  // The key of this approval, so the next reconnect from this machine proves it is this agent.
  if (typeof token.privateKey === 'string' && token.privateKey) await storeAgentKey(agentName, ownerHandle, token.privateKey);
  success(`Token stored (aimeat:${agentName}@${ownerHandle})`);

  // Per-agent config (<home>/agents/{owner}/{agent}/config.yaml). Preserve any existing
  // runner/wake/poll_interval if the agent is being re-connected. `agent`, `owner` and `mode` are
  // NOT written: identity comes from the credential and the mode is the node's.
  // Connecting is the approval of the runner and wake command this folder's settings name: they are
  // recorded as trusted as they are written (command-trust.ts; developer decision 2026-10-25).
  const existingPerAgent = loadPerAgentConfig(agentName, ownerHandle);
  saveConnectedAgentConfig(agentName, ownerHandle, {
    node_url: nodeUrl,
    primary: existingPerAgent?.primary ?? isFirstAgentOfOwner,
    poll_interval: existingPerAgent?.poll_interval,
    wake: existingPerAgent?.wake,
    runner: existingPerAgent?.runner,
  });

  // Legacy global config -- kept so older single-agent code paths
  // (`loadConfig().agent`) keep working. The first-registered agent becomes the
  // global's `agent`; later agents do not overwrite it. This one stays install-wide rather than
  // per-owner: it is the single-agent layout's own file, and there is exactly one of it.
  const isFirstOnThisMachine = tokensBefore.filter(t => !(t.agent === agentName && t.owner === ownerHandle)).length === 0;
  if (isFirstOnThisMachine || sameAlreadyExists) {
    saveConfig({ node_url: nodeUrl, agent: agentName, owner: ownerHandle });
  }

  client.setToken(token.access_token);
  await downloadAndPrintBundleGuide(client, agentName, success, info, warn);

  if (mode === 'task-runner') {
    info(`Mode set to task-runner. Hello Integration will be the reduced 7-step flow (the test-task pair is kept so onboarding doubles as a smoke test for your subprocess).`);
    info(`To make this agent actually run tasks, edit ~/.aimeat/agents/${agentName}/config.yaml`);
    info(`and add a "runner:" block (command/args/cwd/env). See: aimeat connect docs task-runner`);
  }

  outro(buildNextStepsMessage(buildAgentOnboardingInstruction()));
}
