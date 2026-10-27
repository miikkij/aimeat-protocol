/**
 * @file test/unit/connect-runner-path-lookup.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A trusted runner or wake command runs the program the person approved, not a
 *   same-named file in the directory the daemon happens to run in (secaudit2026oct26,
 *   commandHash:home-bound-not-resolution-directory). On Windows spawn and cmd.exe look in the
 *   working directory before PATH; with AIMEAT_HOME set that directory is not the home's.
 *   The decision cases run on every platform with the platform given; the launch cases spawn real
 *   programs and run on Windows only.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-runner-path-lookup.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26, commandHash:home-bound-not-resolution-directory).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathPreferredProgram, wakeEnvPreferringPath } from '../../src/cli/connect/command-path.js';

vi.setConfig({ testTimeout: 60_000 });

let sandbox = '';
let pathDir = '';
let workDir = '';
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aimeat-path-lookup-'));
  pathDir = join(sandbox, 'bin');
  workDir = join(sandbox, 'received-folder');
  mkdirSync(pathDir); mkdirSync(workDir);
});
afterEach(() => { rmSync(sandbox, { recursive: true, force: true }); });

const winEnv = (extra: Record<string, string> = {}) => ({ PATH: pathDir, AIMEAT_HOME: join(sandbox, 'home'), PATHEXT: '.COM;.EXE;.BAT;.CMD', ...extra });

describe('which program a bare runner name runs', () => {
  it('the PATH program when the working directory holds a file of the same name', () => {
    writeFileSync(join(pathDir, 'python.exe'), '');
    writeFileSync(join(workDir, 'python.exe'), '');
    expect(pathPreferredProgram('python', { env: winEnv(), cwd: workDir, platform: 'win32' })).toBe(join(pathDir, 'python.exe'));
  });

  it('unchanged when the name is only in the working directory, so a command that ran from there keeps running', () => {
    writeFileSync(join(workDir, 'mytool.exe'), '');
    expect(pathPreferredProgram('mytool', { env: winEnv(), cwd: workDir, platform: 'win32' })).toBeNull();
  });

  it('unchanged without AIMEAT_HOME, off Windows, for a path, and when the system already skips the working directory', () => {
    writeFileSync(join(pathDir, 'python.exe'), '');
    writeFileSync(join(workDir, 'python.exe'), '');
    const { AIMEAT_HOME: _h, ...noHome } = winEnv();
    expect(pathPreferredProgram('python', { env: noHome, cwd: workDir, platform: 'win32' })).toBeNull();
    expect(pathPreferredProgram('python', { env: winEnv(), cwd: workDir, platform: 'linux' })).toBeNull();
    expect(pathPreferredProgram('.\\python', { env: winEnv(), cwd: workDir, platform: 'win32' })).toBeNull();
    expect(pathPreferredProgram('python', { env: winEnv({ NoDefaultCurrentDirectoryInExePath: '1' }), cwd: workDir, platform: 'win32' })).toBeNull();
  });

  it('a wake command whose first word both hold runs with the working-directory lookup off', () => {
    writeFileSync(join(pathDir, 'notify.cmd'), '');
    writeFileSync(join(workDir, 'notify.bat'), '');
    const env = wakeEnvPreferringPath('notify --agent x', { env: winEnv(), cwd: workDir, platform: 'win32' });
    expect(env?.NoDefaultCurrentDirectoryInExePath).toBe('1');
    expect(wakeEnvPreferringPath('onlyhere', { env: winEnv(), cwd: workDir, platform: 'win32' })).toBeNull();
  });
});

describe.runIf(process.platform === 'win32')('launching a runner on Windows', () => {
  const saved: Record<string, string | undefined> = {};
  let cwdBefore = '';
  beforeEach(() => {
    for (const k of ['AIMEAT_HOME', 'NoDefaultCurrentDirectoryInExePath']) saved[k] = process.env[k];
    process.env.AIMEAT_HOME = join(sandbox, 'home');
    // The system default: the working directory is searched first.
    delete process.env.NoDefaultCurrentDirectoryInExePath;
    cwdBefore = process.cwd();
    process.chdir(workDir);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.chdir(cwdBefore);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    vi.restoreAllMocks();
  });

  async function launch(command: string, marker: string): Promise<string[]> {
    vi.resetModules();
    const { launchTaskRunner } = await import('../../src/cli/connect/task-runner.js');
    const results: string[] = [];
    const client = {
      post: async (path: string, body: unknown) => {
        if (path.endsWith('/complete') || path.endsWith('/fail')) results.push(JSON.stringify(body));
        return { ok: true };
      },
      getBaseUrl: () => 'http://127.0.0.1:9',
      getTokenValue: () => '',
    };
    await launchTaskRunner({
      gaii: 'runner#alice@aimeat-test', agent: 'runner', owner: 'alice', client,
      config: { node_url: 'http://127.0.0.1:9', runner: { command, args: ['-e', `process.stdout.write("${marker}")`] } },
    } as never, { id: `t-${Math.random().toString(36).slice(2, 8)}`, title: 't' });
    for (let i = 0; i < 300 && results.length === 0; i++) await new Promise(r => setTimeout(r, 100));
    return results;
  }

  it('a file in the working directory named like a PATH program does not run', async () => {
    // tzutil.exe is in System32 on every Windows; the copy here is node under that name.
    copyFileSync(process.execPath, join(workDir, 'tzutil.exe'));
    const results = await launch('tzutil', 'FROM-THE-FOLDER');
    expect(results.length).toBeGreaterThan(0);
    expect(results.join('\n')).not.toContain('FROM-THE-FOLDER');
  });

  it('a program that is only in the working directory still runs from there', async () => {
    copyFileSync(process.execPath, join(workDir, 'aimeat-local-tool.exe'));
    const results = await launch('aimeat-local-tool', 'LOCAL-TOOL-RAN');
    expect(results.join('\n')).toContain('LOCAL-TOOL-RAN');
  });
});
