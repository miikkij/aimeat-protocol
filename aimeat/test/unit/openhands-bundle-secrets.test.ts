/**
 * @file test/unit/openhands-bundle-secrets.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The OpenHands bundle (tools/aimeat-openhands) keeps its secrets out of git and out
 *   of process arguments (secaudit2026oct26):
 *   - rendered-config-toml-not-gitignored: render-config.sh writes config.toml with the OpenRouter
 *     key and the agent token beside docker-compose.yml, so git must ignore it; the template stays
 *     tracked.
 *   - ui-published-all-interfaces-default: a .env made from .env.example binds the UI, which has
 *     no login and holds the agent token, to 127.0.0.1; a .env without the line keeps its bind and
 *     setup.sh warns.
 *   - secrets-on-curl-argv: on a shared host every account can read a process's arguments, so the
 *     device_code, the return proof, the agent token and the OpenRouter key reach curl on stdin.
 *   The scripts run in a temp copy of the bundle under Git's bash with stub curl, python3 and
 *   docker programs first on PATH; the stubs record what curl was given and answer as the node and
 *   the OpenHands UI would. Enrolment must still write the token and the key, and post-up must
 *   still send the same request bodies.
 * @usage cd aimeat && pnpm exec vitest run test/unit/openhands-bundle-secrets.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Each case runs a whole script under bash; its JSON helper may start node once per field.
vi.setConfig({ testTimeout: 180_000 });

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const BUNDLE = join(REPO, 'tools', 'aimeat-openhands');

describe('the rendered config.toml stays out of git', () => {
  it('git ignores tools/aimeat-openhands/config.toml and tracks the template', () => {
    const ignored = spawnSync('git', ['-c', 'core.fsmonitor=false', 'check-ignore', '-q', 'tools/aimeat-openhands/config.toml'], { cwd: REPO });
    expect(ignored.status).toBe(0);
    const template = spawnSync('git', ['-c', 'core.fsmonitor=false', 'check-ignore', '-q', 'tools/aimeat-openhands/config.toml.template'], { cwd: REPO });
    expect(template.status).toBe(1);
  });
});

describe('a new .env publishes the UI on this computer only', () => {
  it('.env.example binds the UI to 127.0.0.1:3000, which post-up and http://localhost:3000 still reach', () => {
    const lines = readFileSync(join(BUNDLE, '.env.example'), 'utf8').split(/\r?\n/);
    expect(lines).toContain('OPENHANDS_PORT_BIND=127.0.0.1:3000');
    // The compose fallback for a .env without the line is unchanged: existing installs keep their bind.
    expect(readFileSync(join(BUNDLE, 'docker-compose.yml'), 'utf8')).toContain('"${OPENHANDS_PORT_BIND:-3000}:3000"');
    // setup.sh names the open bind when a .env still has none.
    expect(readFileSync(join(BUNDLE, 'scripts', 'setup.sh'), 'utf8')).toContain('will listen on every network interface');
  });
});

/** Git's bash on Windows (System32's bash.exe starts WSL); `bash` elsewhere. */
function bashPath(): string | null {
  if (process.platform !== 'win32') return 'bash';
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!existsSync(join(dir, 'git.exe'))) continue;
    for (const c of [join(dir, '..', 'bin', 'bash.exe'), join(dir, '..', 'usr', 'bin', 'bash.exe'), join(dir, 'bash.exe')]) {
      if (existsSync(c) && !c.toLowerCase().includes('system32')) return c;
    }
  }
  const fallback = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return existsSync(fallback) ? fallback : null;
}

const DEVICE_CODE = 'DEVCODE-SECRET-4711';
const AGENT_TOKEN = 'AGENT-TOKEN-SECRET-4711';
const OPENROUTER_KEY = 'sk-or-SECRET-4711';

const CURL_STUB = `#!/usr/bin/env bash
# Records its arguments and its stdin, answers as the node or the OpenHands UI would.
printf '%s\\n' "$*" >> "$STUB_LOG/argv.log"
for a in "$@"; do
  if [ "$a" = "@-" ]; then printf '%s\\n' "$(cat)" >> "$STUB_LOG/stdin.log"; fi
done
case "$*" in
  *device-authorize*) printf '{"device_code":"${DEVICE_CODE}","user_code":"ABCD-EFGH","verification_uri_complete":"http://node/v?code=ABCD","status":"approved"}' ;;
  *device-token*) printf '{"access_token":"${AGENT_TOKEN}","gaii":"openhands#alice@node-one","expires_at":"2030-01-01","privateKey":"%s"}' "$STUB_KEY" ;;
  */activate*) printf '{"model":"%s"}' "$LLM_MODEL" ;;
esac
exit 0
`;

// Stands in for python3 in post-up: builds the same JSON the script's heredocs build.
const PYTHON_STUB = `#!/usr/bin/env bash
if [ "$1" = "-c" ]; then sed -n 's/.*"model":"\\([^"]*\\)".*/\\1/p'; exit 0; fi
cat > /dev/null
if [ -n "\${MCP_URL:-}" ]; then
  printf '{"agent_settings_diff": {"mcp_config": {"mcpServers": {"aimeat": {"url": "%s", "auth": "%s"}}}}}\\n' "$MCP_URL" "$AIMEAT_AGENT_TOKEN"
else
  printf '{"agent_settings_diff": {"llm": {"model": "%s", "api_key": "%s", "base_url": "%s", "temperature": 0.0}}}\\n' "$LLM_MODEL" "$OPENROUTER_API_KEY" "$LLM_BASE_URL"
fi
`;

const DOCKER_STUB = '#!/usr/bin/env bash\nexit 0\n';

const bash = bashPath();
let work = '';
let bundle = '';
let stubs = '';
let logs = '';

/** `stubDir` first on PATH: the connect script gets only the curl stub (its JSON helper runs a real python3, jq or node). */
function runScript(script: string, stubDir: string, env: Record<string, string>) {
  // Windows names it Path; one key only, or the child may see the other one.
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  // The stubs go first on PATH inside bash: Git's bin/bash.exe puts its own folders in front of
  // whatever PATH it is started with.
  const prepend = 'd="$STUB_DIR"; if command -v cygpath >/dev/null 2>&1; then d="$(cygpath -u "$d")"; fi; PATH="$d:$PATH" exec bash "$0"';
  return spawnSync(bash!, ['-c', prepend, join(bundle, 'scripts', script)], {
    cwd: bundle,
    env: { ...base, PATH: process.env.PATH ?? '', STUB_DIR: stubDir, STUB_LOG: logs, ...env },
    encoding: 'utf8',
    timeout: 120_000,
  });
}

const argvLog = () => existsSync(join(logs, 'argv.log')) ? readFileSync(join(logs, 'argv.log'), 'utf8') : '';
const stdinLog = () => existsSync(join(logs, 'stdin.log')) ? readFileSync(join(logs, 'stdin.log'), 'utf8') : '';

describe.runIf(bash !== null)('the bundle scripts give curl their secrets on stdin', () => {
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'aimeat-openhands-'));
    bundle = join(work, 'bundle');
    stubs = join(work, 'stubs');
    logs = join(work, 'logs');
    mkdirSync(join(bundle, 'scripts'), { recursive: true });
    mkdirSync(join(stubs, 'connect'), { recursive: true }); mkdirSync(join(stubs, 'postup'), { recursive: true }); mkdirSync(logs);
    for (const f of readdirSync(join(BUNDLE, 'scripts'))) copyFileSync(join(BUNDLE, 'scripts', f), join(bundle, 'scripts', f));
    writeFileSync(join(stubs, 'connect', 'curl'), CURL_STUB, { mode: 0o755 });
    writeFileSync(join(stubs, 'postup', 'curl'), CURL_STUB, { mode: 0o755 });
    writeFileSync(join(stubs, 'postup', 'python3'), PYTHON_STUB, { mode: 0o755 });
    writeFileSync(join(stubs, 'postup', 'docker'), DOCKER_STUB, { mode: 0o755 });
  });
  afterAll(() => { rmSync(work, { recursive: true, force: true }); });

  it('enrolment: no device_code, return proof or token on curl\'s command line, and the token and key are still written', () => {
    const key = randomBytes(32).toString('base64');
    // A reconnect: the key of the last approval is there, so the request carries a signed proof.
    mkdirSync(join(bundle, 'secrets'), { recursive: true });
    writeFileSync(join(bundle, 'secrets', 'openhands@alice.key'), `${key}\n`);
    const r = runScript('aimeat-connect.sh', join(stubs, 'connect'), {
      AIMEAT_BASE_URL: 'http://node.invalid', AIMEAT_OWNER: 'alice', AIMEAT_AGENT_NAME: 'openhands', AIMEAT_SCOPES: '*',
      STUB_KEY: key,
    });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const argv = argvLog();
    expect(argv).toContain('device-authorize');
    expect(argv).toContain('device-token');
    expect(argv).not.toContain(DEVICE_CODE);
    expect(argv).not.toContain('signature');
    expect(argv).not.toContain('"owner"');
    // The same bodies as before, now on stdin.
    const stdin = stdinLog();
    expect(stdin).toContain(`"device_code":"${DEVICE_CODE}"`);
    expect(stdin).toContain('"owner":"alice","agent_name":"openhands"');
    expect(stdin).toContain('"scopes":["*"]');
    // The reconnect still proves it is the same agent, where openssl 3 can sign.
    if (/^OpenSSL 3/.test(spawnSync('openssl', ['version'], { encoding: 'utf8' }).stdout ?? '')) expect(stdin).toContain('"proof":{"signed_at":"');
    const secrets = readFileSync(join(bundle, 'secrets', 'aimeat.env'), 'utf8');
    expect(secrets).toContain(`AIMEAT_AGENT_TOKEN=${AGENT_TOKEN}`);
    expect(readFileSync(join(bundle, 'secrets', 'openhands@alice.key'), 'utf8').trim()).toBe(key);
  });

  it('post-up: no OpenRouter key or agent token on curl\'s command line, and the same settings are sent', () => {
    rmSync(join(logs, 'argv.log'), { force: true });
    rmSync(join(logs, 'stdin.log'), { force: true });
    writeFileSync(join(bundle, '.env'), `OPENROUTER_API_KEY=${OPENROUTER_KEY}\nLLM_MODEL=openrouter/test-model\nLLM_BASE_URL=https://openrouter.example/api/v1\nOPENHANDS_PORT_BIND=127.0.0.1:3000\n`);
    writeFileSync(join(bundle, 'secrets', 'aimeat.env'), `AIMEAT_BASE_URL=http://node.invalid\nAIMEAT_AGENT_TOKEN=${AGENT_TOKEN}\n`);
    const r = runScript('postup.sh', join(stubs, 'postup'), {});
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const argv = argvLog();
    expect(argv).toContain('http://127.0.0.1:3000/api/v1/settings');
    expect(argv).not.toContain(OPENROUTER_KEY);
    expect(argv).not.toContain(AGENT_TOKEN);
    const stdin = stdinLog();
    expect(stdin).toContain(`"api_key": "${OPENROUTER_KEY}"`);
    expect(stdin).toContain(`"auth": "${AGENT_TOKEN}"`);
    expect(stdin).toContain('"url": "http://node.invalid/v2/mcp/appdev"');
  });
});
