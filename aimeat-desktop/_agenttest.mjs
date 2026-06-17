// Throwaway E2E test of the LOCAL agent auto-approve chain against the running desktop node.
// Goal: owner login -> register+auto-approve a crew agent (no manual device-auth) -> agent token.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const BASE = 'http://localhost:40050';
// research_crew.py hardcodes AGENT_NAME="research-crew" — the connector token name MUST match.
const OWNER = 'testagent', PASS = 'Test1234!', AGENT = 'research-crew';

async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data; try { data = await r.json(); } catch { data = { _status: r.status }; }
  return { status: r.status, data };
}

// 1) ensure owner exists (ignore 409) + login
await j('POST', '/v1/ghii', { username: OWNER, display_name: 'Test Agent Owner', password: PASS });
const login = await j('POST', '/v1/ghii/login', { username: OWNER, password: PASS });
const ownerToken = login.data?.data?.token;
console.log('1) owner login:', ownerToken ? 'OK (len ' + ownerToken.length + ')' : JSON.stringify(login.data).slice(0, 200));
if (!ownerToken) process.exit(1);

// 2) device-authorize the crew agent
const da = await j('POST', '/v1/agents/device-authorize', { agent_name: AGENT, owner: OWNER, mode: 'task-runner' });
const deviceCode = da.data?.data?.device_code, userCode = da.data?.data?.user_code;
console.log('2) device-authorize:', deviceCode ? ('device_code+user_code OK (' + userCode + ')') : JSON.stringify(da.data).slice(0, 250));
if (!deviceCode) process.exit(1);

// 3) AUTO-APPROVE as the owner (no manual dashboard step) — this is the key for local installs
const ver = await j('POST', '/v1/agents/verify', { user_code: userCode, action: 'approve', owner_token: ownerToken });
console.log('3) auto-approve:', ver.data?.ok === true ? 'OK' : JSON.stringify(ver.data).slice(0, 250));

// 4) poll device-token -> the agent access_token
const tok = await j('POST', '/v1/agents/device-token', { device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
const agentToken = tok.data?.data?.access_token || tok.data?.data?.token || tok.data?.access_token;
console.log('4) agent token:', agentToken ? ('OK (len ' + agentToken.length + ')') : JSON.stringify(tok.data).slice(0, 300));

if (!agentToken) process.exit(1);

// 5) Place the token + per-agent config exactly where the connector (`aimeat connect serve`) +
//    the crew (`_aimeat_read_token`) read them: ~/.aimeat/tokens/<agent>@<owner>.token and
//    ~/.aimeat/agents/<agent>/config.yaml. This is what `aimeat connect add` would have written.
const HOME = join(homedir(), '.aimeat');
mkdirSync(join(HOME, 'tokens'), { recursive: true });
mkdirSync(join(HOME, 'agents', AGENT), { recursive: true });
writeFileSync(join(HOME, 'tokens', `${AGENT}@${OWNER}.token`), agentToken, { mode: 0o600 });
writeFileSync(join(HOME, 'agents', AGENT, 'config.yaml'),
  `agent: ${AGENT}\nowner: ${OWNER}\nnode_url: ${BASE}\nprimary: false\nmode: task-runner\n`);
console.log('5) wrote token + config to ~/.aimeat for', AGENT + '@' + OWNER, '-> node', BASE);
console.log('DONE: agent registered + auto-approved + token stored. Now start serve + run the crew.');

