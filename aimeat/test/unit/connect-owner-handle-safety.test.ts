/**
 * @file connect-owner-handle-safety.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner handle the device-token answer carries names local files (tokens/,
 *   keys/, agents/<owner>/) and is read back into the launcher and header-helper scripts that
 *   `aimeat connect client` generates. These tests hold the handle to one safe path segment and
 *   the generated scripts to one quoted literal per embedded path, and check that the scripts for
 *   an ordinary home are exactly what they were before.
 * @structure ownerHandleFrom refusals · ownerHandleFrom keeps every real handle · launcher and
 *   header-helper quoting · ordinary scripts unchanged.
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial creation (secaudit2026oct26, node-owner-handle-in-local-paths).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownerHandleFrom } from '../../src/cli/connect/auth.js';
import { writeLauncher, writeHeadersHelper } from '../../src/cli/connect/clients/launcher.js';
import type { ClientTarget } from '../../src/cli/connect/clients/types.js';

const base = { access_token: 'jwt', name: 'goose' };

describe('ownerHandleFrom refuses a handle that is not one safe path segment', () => {
  it('refuses a gaii owner segment with dot segments and separators', () => {
    expect(() => ownerHandleFrom({ ...base, gaii: 'goose#../../outside@node-1' }, 'alice')).toThrow(/owner/i);
    expect(() => ownerHandleFrom({ ...base, gaii: 'goose#a\\b@node-1' }, 'alice')).toThrow(/owner/i);
  });

  it('refuses a gaii owner segment that holds quotes or shell text', () => {
    expect(() => ownerHandleFrom({ ...base, gaii: "goose#a'b@node-1" }, 'alice')).toThrow(/owner/i);
    expect(() => ownerHandleFrom({ ...base, gaii: 'goose#a$(id)@node-1' }, 'alice')).toThrow(/owner/i);
    expect(() => ownerHandleFrom({ ...base, gaii: 'goose#a\nb@node-1' }, 'alice')).toThrow(/owner/i);
  });

  it('refuses a response owner field that is not a safe segment', () => {
    expect(() => ownerHandleFrom({ ...base, gaii: 'garbage', owner: '../x' }, 'alice')).toThrow(/owner/i);
    expect(() => ownerHandleFrom({ ...base, gaii: 'garbage', owner: '..' }, 'alice')).toThrow(/owner/i);
  });
});

describe('ownerHandleFrom keeps every handle a real node issues', () => {
  it('grammar-valid gaiis, legacy-looking handles and the email fallback still resolve', () => {
    expect(ownerHandleFrom({ ...base, gaii: 'goose#jounidude@aimeat-finland-001-genesis' }, 'mail@x.com')).toBe('jounidude');
    expect(ownerHandleFrom({ ...base, gaii: 'garbage', owner: 'Old_Name.1' }, 'x')).toBe('Old_Name.1');
    expect(ownerHandleFrom({ ...base, gaii: 'garbage' }, 'carol@example.com')).toBe('carol');
  });
});

let sandbox: string;
function targetIn(home: string, workdir: string, tokenFile: string): ClientTarget {
  return {
    nodeUrl: 'https://aimeat.io', mcpUrl: 'https://aimeat.io/v1/mcp', agent: 'goose', owner: 'alice',
    home, tokenFile, serverName: 'aimeat', workdir,
  };
}

beforeEach(() => { sandbox = mkdtempSync(join(tmpdir(), 'aimeat-owner-safety-')); });
afterEach(() => { rmSync(sandbox, { recursive: true, force: true }); });

describe('generated scripts keep every embedded path one quoted literal', () => {
  it('a single quote in a path is doubled in the PowerShell scripts', () => {
    const t = targetIn(sandbox, join(sandbox, "o'brien"), join(sandbox, "tok'en.token"));
    const h = writeHeadersHelper(t);
    const ps1 = readFileSync(h.ps1, 'utf8');
    expect(ps1).toContain(`(Get-Content '${join(sandbox, "tok''en.token")}' -Raw)`);
    const [launch] = writeLauncher(t, 'probe', 'probe').filter((p) => p.endsWith('.ps1'));
    const text = readFileSync(launch, 'utf8');
    expect(text).toContain(`$tokenFile = '${join(sandbox, "tok''en.token")}'`);
    expect(text).toContain(`$workdir = '${join(sandbox, "o''brien")}'`);
  });

  it('$, backtick, double quote and backslash are escaped in the bash scripts', () => {
    const t = targetIn(sandbox, join(sandbox, 'w$(id)'), join(sandbox, 'a"b`c$d.token'));
    const h = writeHeadersHelper(t);
    const sh = readFileSync(h.sh, 'utf8');
    const fwd = sandbox.replace(/\\/g, '/');
    expect(sh).toContain(`< "${fwd}/a\\"b\\\`c\\$d.token"`);
    const [launch] = writeLauncher(t, 'probe', 'probe').filter((p) => p.endsWith('.sh'));
    const text = readFileSync(launch, 'utf8');
    expect(text).toContain(`TOKEN_FILE="${fwd}/a\\"b\\\`c\\$d.token"`);
    expect(text).toContain(`cd "${fwd}/w\\$(id)"`);
  });

  it('line breaks in the agent or owner do not leave the comment line', () => {
    const t = { ...targetIn(sandbox, sandbox, join(sandbox, 'x.token')), owner: 'a\nrm -rf x' };
    const [sh] = writeLauncher(t, 'probe', 'probe').filter((p) => p.endsWith('.sh'));
    const lines = readFileSync(sh, 'utf8').split('\n');
    expect(lines.some((l) => l.startsWith('rm -rf'))).toBe(false);
  });
});

describe('ordinary homes get the same scripts as before', () => {
  it('launcher and header helper text for a plain path', () => {
    const tok = join(sandbox, 'tokens', 'goose@alice.token');
    const work = join(sandbox, 'work');
    const t = targetIn(sandbox, work, tok);
    const h = writeHeadersHelper(t);
    expect(readFileSync(h.ps1, 'utf8')).toBe([
      '# Prints the AIMEAT Authorization header for an MCP client that asks for one.',
      '# Generated by: aimeat connect client',
      `$t = (Get-Content '${tok}' -Raw).Trim()`,
      'Write-Output "Authorization: Bearer $t"',
      '',
    ].join('\r\n'));
    expect(readFileSync(h.sh, 'utf8')).toBe([
      '#!/usr/bin/env bash',
      '# Prints the AIMEAT Authorization header for an MCP client that asks for one.',
      '# Generated by: aimeat connect client',
      'set -euo pipefail',
      `echo "Authorization: Bearer $(tr -d '\\r\\n' < "${tok.replace(/\\/g, '/')}")"`,
      '',
    ].join('\n'));
    const paths = writeLauncher(t, 'goose', 'goose', ['run']);
    const sh = readFileSync(paths.find((p) => p.endsWith('.sh'))!, 'utf8');
    expect(sh).toBe([
      '#!/usr/bin/env bash',
      '# Starts goose with the AIMEAT agent "goose@alice" attached.',
      '# Generated by: aimeat connect client goose',
      'set -euo pipefail',
      `export AIMEAT_HOME="${sandbox.replace(/\\/g, '/')}"`,
      `TOKEN_FILE="${tok.replace(/\\/g, '/')}"`,
      '[ -f "$TOKEN_FILE" ] || { echo "No token at $TOKEN_FILE. Run: aimeat connect client goose" >&2; exit 1; }',
      'export AIMEAT_AGENT_TOKEN="$(tr -d "\\r\\n" < "$TOKEN_FILE")"',
      `mkdir -p "${work.replace(/\\/g, '/')}"`,
      `cd "${work.replace(/\\/g, '/')}"`,
      'exec goose run "$@"',
      '',
    ].join('\n'));
    const ps1 = readFileSync(paths.find((p) => p.endsWith('.ps1'))!, 'utf8');
    expect(ps1).toBe([
      '# Starts goose with the AIMEAT agent "goose@alice" attached.',
      '# Generated by: aimeat connect client goose',
      "$ErrorActionPreference = 'Stop'",
      `$env:AIMEAT_HOME = '${sandbox}'`,
      `$tokenFile = '${tok}'`,
      'if (-not (Test-Path $tokenFile)) { Write-Error "No token at $tokenFile. Run: aimeat connect client goose"; exit 1 }',
      '$env:AIMEAT_AGENT_TOKEN = (Get-Content $tokenFile -Raw).Trim()',
      `$workdir = '${work}'`,
      'if (-not (Test-Path $workdir)) { New-Item -ItemType Directory -Force $workdir | Out-Null }',
      'Set-Location $workdir',
      'goose run @args',
      '',
    ].join('\r\n'));
  });
});
