/**
 * @file connect-onboard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One-time setup for using AIMEAT from Dify (Direction 1). Registers a named
 *   agent via device authorization (RFC 8628), waits for the OWNER to approve it in the
 *   AIMEAT profile (Agents tab), then runs the full Hello Integration onboarding to
 *   "completed" and prints the agent token to paste into Dify's Custom Tool auth.
 *   Every call here was verified against the AIMEAT reference node.
 * @structure main() drives: device-authorize -> poll device-token -> onboarding steps -> print token.
 * @usage
 *   AIMEAT_BASE_URL=http://127.0.0.1:40050 OWNER=happyadmin AGENT_NAME=dify \
 *   pnpm exec node --import tsx tools/dify-bridge/src/connect-onboard.ts
 *   The token and the agent's private key of the approval are kept in AIMEAT_DIFY_HOME (default
 *   <cwd>/.aimeat-dify) as <agent>@<owner>.token and .key at 0600. A later run signs its device
 *   request with that key (`proof`), so the owner sees the agent coming back and not a new device
 *   taking it over (src/services/device-return-proof.ts). No stored token is sent with the device
 *   request: the node refuses a dead one.
 * @version-history
 *   v1.1.0 - 2026-10-26 - Keep the token and the agent's key, and sign a reconnect with the key
 *     (secaudit2026oct22, unbound-reapproval-of-existing-agent).
 *   v1.0.0 - 2026-06-05 - Initial (Dify integration prototype).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sign } from '../../../src/auth/keypair.js';
import { returnProofMessage } from '../../../src/services/device-return-proof.js';

const env = (k: string, d = ''): string => process.env[k] ?? d;
const BASE = env('AIMEAT_BASE_URL', 'http://127.0.0.1:40050').replace(/\/+$/, '');
const OWNER = env('OWNER');
const AGENT = env('AGENT_NAME', 'dify');
const PLATFORM = env('PLATFORM', 'dify');
const POLL_TIMEOUT_SEC = parseInt(env('POLL_TIMEOUT_SEC', '600'), 10);
const HOME = env('AIMEAT_DIFY_HOME', join(process.cwd(), '.aimeat-dify'));
const keyFile = () => join(HOME, `${AGENT}@${OWNER}.key`);
const tokenFile = () => join(HOME, `${AGENT}@${OWNER}.token`);

/** A file only its owner reads (0600), in a folder only its owner opens (0700). */
function writePrivate(path: string, text: string): void {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { encoding: 'utf-8', mode: 0o600 });
  chmodSync(path, 0o600);
}

/** The proof that this run is the agent coming back, signed with the key its last approval gave it. */
async function returnProof(): Promise<{ signed_at: string; signature: string } | undefined> {
  if (!existsSync(keyFile())) return undefined;
  const key = readFileSync(keyFile(), 'utf-8').trim();
  if (!key) return undefined;
  const signedAt = new Date().toISOString();
  try {
    return { signed_at: signedAt, signature: await sign(key, returnProofMessage(OWNER, AGENT, signedAt)) };
  } catch (e) {
    console.warn(`  The key in ${keyFile()} could not sign (${(e as Error).message}); connecting without proof that this is the same agent.`);
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json: unknown = null;
  try { json = await resp.json(); } catch { /* no body */ }
  return { status: resp.status, json };
}

async function main(): Promise<void> {
  if (!OWNER) { console.error('ERROR: OWNER is required (the AIMEAT owner username).'); process.exit(1); }

  // 1) Agent connect — device authorization
  console.log(`\n[1/3] Registering agent "${AGENT}" for owner "${OWNER}" via device authorization...`);
  const proof = await returnProof();
  const da = await call('POST', '/v1/agents/device-authorize', {
    agent_name: AGENT, display_name: 'Dify', description: 'Dify workflow runtime', owner: OWNER, mode: 'task-runner',
    ...(proof ? { proof } : {}),
  });
  if (da.status !== 200) { console.error('device-authorize failed:', da.json?.error ?? da.json); process.exit(1); }
  const { device_code, user_code, verification_uri_complete, verification_uri } = da.json.data;
  console.log('\n  ┌────────────────────────────────────────────────────────────┐');
  console.log('  │  ACTION REQUIRED — approve this agent in AIMEAT             │');
  console.log('  └────────────────────────────────────────────────────────────┘');
  console.log(`  Code: ${user_code}`);
  console.log(`  Open: ${verification_uri_complete ?? verification_uri}`);
  console.log('  (Log in as the owner, go to Profile -> Agents, approve the request.)\n');

  // 2) Poll for approval
  console.log('[2/3] Waiting for owner approval...');
  const deadline = Date.now() + POLL_TIMEOUT_SEC * 1000;
  let token = '', gaii = '';
  while (Date.now() < deadline) {
    await sleep(5000);
    const tk = await call('POST', '/v1/agents/device-token', {
      device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (tk.status === 200 && tk.json?.access_token) {
      token = tk.json.access_token; gaii = tk.json.gaii;
      writePrivate(tokenFile(), token);
      if (typeof tk.json.privateKey === 'string' && tk.json.privateKey) writePrivate(keyFile(), tk.json.privateKey);
      console.log(`  Approved. GAII = ${gaii}`);
      console.log(`  Scopes = ${(tk.json.scopes ?? []).join(', ')}`);
      break;
    }
    const err = tk.json?.error;
    if (err === 'access_denied') { console.error('  Owner denied the request.'); process.exit(1); }
    if (err === 'expired_token') { console.error('  Request expired before approval.'); process.exit(1); }
    process.stdout.write('.');
  }
  if (!token) { console.error('\n  Timed out waiting for approval.'); process.exit(1); }

  // 3) Hello Integration onboarding
  console.log('\n[3/3] Running Hello Integration onboarding...');
  const log = (label: string, r: { status: number; json: any }) =>
    console.log(`  ${label}: ${r.status}${r.status >= 400 ? ' ' + JSON.stringify(r.json?.error ?? r.json) : ''}`);

  log('identify_platform', await call('POST', `/v1/agents/${AGENT}/onboarding/step/identify_platform`, { platform: PLATFORM, platform_version: '1.x' }, token));
  log('install_skill', await call('POST', `/v1/agents/${AGENT}/onboarding/step/install_skill`, { version: '1.0.0', platform: PLATFORM }, token));
  log('report_capabilities', await call('PUT', `/v1/agents/${AGENT}/capabilities`, {
    technical: [{ name: 'aimeat-tools', type: 'mcp' }],
    domain: ['workflow-automation'], languages: ['en'],
  }, token));

  // test task: propose a todo, re-check (auto-activates), complete
  const ob = await call('GET', `/v1/agents/${AGENT}/onboarding`, undefined, token);
  const testTaskId = ob.json?.data?.onboarding?.steps?.find((s: any) => s.id === 'accept_test_task')?.details?.testTaskId;
  if (testTaskId) {
    log('propose_todos', await call('POST', `/v1/agents/${AGENT}/tasks/${testTaskId}/propose-todos`, {
      todos: [{ title: 'Verify AIMEAT connectivity', description: 'Confirm the Dify runtime can reach AIMEAT', environment: 'agent', verification: 'memory write/read succeeded' }],
    }, token));
    await call('GET', `/v1/agents/${AGENT}/onboarding`, undefined, token); // flips queued->active
    log('complete_test_task', await call('POST', `/v1/agents/${AGENT}/tasks/${testTaskId}/complete`, { message: 'Connectivity verified' }, token));
  }
  log('publish_config', await call('POST', '/v1/memory', {
    key: `agents.config.${AGENT}.connector`,
    value: { runtime: PLATFORM, transport: 'http-rest', notes: 'Dify workflow calling AIMEAT via HTTP node / custom tool' },
    visibility: 'owner',
  }, token));

  const fin = await call('GET', `/v1/agents/${AGENT}/onboarding`, undefined, token);
  console.log(`\n  Onboarding status: ${fin.json?.data?.onboarding?.status}`);

  // Output
  console.log('\n========================= DONE =========================');
  console.log(`GAII : ${gaii}`);
  console.log(`TOKEN: ${token}`);
  console.log('\nPaste TOKEN into Dify: Tools -> Custom -> (your AIMEAT tool) -> Authorization method');
  console.log('  = Header, Bearer, Key "Authorization", Value = the RAW TOKEN above');
  console.log('  (do NOT prefix with "Bearer " -- Dify adds it in Bearer mode).');
  console.log('Note: agent JWTs expire; for a long-lived credential create a PAT in');
  console.log('AIMEAT Profile -> Access and use that instead.');
  console.log('========================================================\n');
}

main().catch((e) => { console.error('ERROR:', (e as Error).message); process.exit(1); });
