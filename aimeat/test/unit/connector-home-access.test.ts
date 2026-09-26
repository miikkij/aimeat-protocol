/**
 * @file connector-home-access.test.ts
 * @description The serve daemon's start-up check on its connector home: it warns when other
 *   accounts on the computer can read the daemon secret and the agent keys in it, and says nothing
 *   when only the owner can.
 *
 *   Each platform branch runs on its own platform and is skipped on the other. The Windows branch
 *   changes a real access list with icacls and reads it back by SID; the Unix branch uses modes.
 *   The access-list reader also runs everywhere on access lists measured on a Windows machine, and
 *   the Unix rule runs everywhere on modes the test gives it.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/connector-home-access.test.ts
 * @version-history
 *   v1.1.0 -- 2026-09-26 -- Unix: a 755 folder with 600 files gives no warning, and a 644 token
 *     gives one. Two cases run the Unix rule on every platform, on modes the test gives it.
 *   v1.0.0 -- 2026-09-26 -- Initial (secaudit 2026-09, N7).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkConnectorHome, readersInDacl } from '../../src/cli/connect/home-access.js';

/**
 * The modes the Unix rule is given in the cases that run on every platform, by path. A path with no
 * entry is read from the real file system, so every other case in this file sees real modes.
 */
const givenModes = vi.hoisted(() => new Map<string, number>());
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const statSync = (path: string, options?: unknown) => {
    const mode = givenModes.get(String(path));
    return mode === undefined ? fs.statSync(path, options as never) : { mode };
  };
  return { ...fs, statSync: statSync as unknown as typeof fs.statSync };
});

const SYSTEM32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const icacls = (...args: string[]): void => {
  execFileSync(join(SYSTEM32, 'icacls.exe'), args, { stdio: 'pipe' });
};

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

/** A connector home as the daemon leaves it: serve.json, a token and a key, readable by the owner only. */
function privateHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'aimeat-home-'));
  made.push(home);
  if (process.platform === 'win32') {
    // Owner only, whatever the temporary folder inherits: the account that runs the test, by SID.
    const whoami = execFileSync(join(SYSTEM32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    const sid = /"(S-1-5-[\d-]+)"/.exec(whoami)?.[1];
    if (!sid) throw new Error(`whoami named no SID: ${whoami}`);
    icacls(home, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`);
  }
  chmodSync(home, 0o700);
  mkdirSync(join(home, 'tokens'), { mode: 0o700 });
  mkdirSync(join(home, 'keys'), { mode: 0o700 });
  writeFileSync(join(home, 'serve.json'), '{"secret":"s"}', { mode: 0o600 });
  writeFileSync(join(home, 'tokens', 'concierge@alice.token'), 't', { mode: 0o600 });
  writeFileSync(join(home, 'keys', 'crew@alice.key'), '{}', { mode: 0o600 });
  return home;
}

/** Runs the command the warning prints, as the person reading it would. */
function runFix(fix: string[]): void {
  execFileSync(fix[0], fix.slice(1), { stdio: 'pipe' });
}

describe.runIf(process.platform === 'win32')('connector home on Windows', () => {
  it('gives no warning when only the owner can read the folder', () => {
    expect(checkConnectorHome(privateHome())).toBeNull();
  });

  it('warns, naming Users by SID, when the folder grants read to Users', () => {
    const home = privateHome();
    icacls(home, '/grant', '*S-1-5-32-545:(OI)(CI)R');

    const warning = checkConnectorHome(home);
    expect(warning).not.toBeNull();
    expect(warning!.readers).toEqual(['Users (S-1-5-32-545)']);
    expect(warning!.message).toContain(home);
    expect(warning!.message).toContain('Users (S-1-5-32-545)');
    expect(warning!.message).toMatch(/daemon secret and the agent keys/);
    expect(warning!.message).toMatch(/icacls "[^"]+" \/inheritance:r/);
    expect(warning!.message).not.toContain('\n');
  });

  it('gives no warning after the command the warning prints has run', () => {
    const home = privateHome();
    icacls(home, '/grant', '*S-1-5-32-545:(OI)(CI)R', '*S-1-5-11:(OI)(CI)M');
    const warning = checkConnectorHome(home);
    expect(warning!.readers).toEqual(['Authenticated Users (S-1-5-11)', 'Users (S-1-5-32-545)']);

    runFix(warning!.fix);
    expect(checkConnectorHome(home)).toBeNull();
  });

  it('says nothing when the access list cannot be read', () => {
    expect(checkConnectorHome(join(tmpdir(), 'aimeat-home-that-does-not-exist'))).toBeNull();
  });
});

describe.skipIf(process.platform === 'win32')('connector home on Unix', () => {
  it('gives no warning when the folder is 700 and its secret files 600', () => {
    expect(checkConnectorHome(privateHome())).toBeNull();
  });

  it('gives no warning when the folder is 755 and its secret files 600: others see the names, not the contents', () => {
    const home = privateHome();
    chmodSync(home, 0o755);
    expect(checkConnectorHome(home)).toBeNull();
  });

  it('warns when a token file is 644', () => {
    const home = privateHome();
    chmodSync(home, 0o755);
    chmodSync(join(home, 'tokens', 'concierge@alice.token'), 0o644);

    const warning = checkConnectorHome(home);
    expect(warning).not.toBeNull();
    expect(warning!.readers).toEqual(['the other members of its group', 'every other account']);
    expect(warning!.message).toContain(home);
    expect(warning!.message).toMatch(/daemon secret and the agent keys/);
    expect(warning!.message).toContain(`chmod -R go-rwx '${home}'`);
    expect(warning!.message).not.toContain('\n');
  });

  it('names every other account, and not the group, for a 604 key in a 755 folder', () => {
    const home = privateHome();
    chmodSync(home, 0o755);
    chmodSync(join(home, 'keys', 'crew@alice.key'), 0o604);
    expect(checkConnectorHome(home)?.readers).toEqual(['every other account']);
  });

  it('gives no warning after the command the warning prints has run', () => {
    const home = privateHome();
    chmodSync(home, 0o755);
    chmodSync(join(home, 'serve.json'), 0o644);
    const warning = checkConnectorHome(home);
    expect(warning).not.toBeNull();

    runFix(warning!.fix);
    expect(checkConnectorHome(home)).toBeNull();
  });

  it('says nothing when the folder cannot be read', () => {
    expect(checkConnectorHome(join(tmpdir(), 'aimeat-home-that-does-not-exist'))).toBeNull();
  });
});

describe('the Unix rule on every platform, on modes the test gives it', () => {
  // A real folder, so the check finds its files; the modes come from givenModes, because Windows
  // reports every file as readable by all.
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  beforeEach(() => { Object.defineProperty(process, 'platform', { ...platform, value: 'linux' }); });
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    givenModes.clear();
  });

  function homeWithModes(folder: number, files: Record<string, number>): string {
    const home = privateHome();
    givenModes.set(home, 0o040000 | folder);
    for (const [file, mode] of Object.entries(files)) givenModes.set(join(home, file), 0o100000 | mode);
    return home;
  }

  it('gives no warning for a 755 folder whose secret files are 600', () => {
    const home = homeWithModes(0o755, { 'serve.json': 0o600, 'tokens/concierge@alice.token': 0o600, 'keys/crew@alice.key': 0o600 });
    expect(checkConnectorHome(home)).toBeNull();
  });

  it('names only the group for a 640 token in a 755 folder', () => {
    const home = homeWithModes(0o755, { 'serve.json': 0o600, 'tokens/concierge@alice.token': 0o640, 'keys/crew@alice.key': 0o600 });
    expect(checkConnectorHome(home)?.readers).toEqual(['the other members of its group']);
  });
});

describe('reading a Windows access list by SID', () => {
  it('finds Authenticated Users and Users in a folder made below C:\\ (measured on C:\\dev\\crewaimeat\\.aimeat)', () => {
    const dacl = 'D:AI(A;OICIID;FA;;;BA)(A;OICIID;FA;;;SY)(A;OICIID;0x1200a9;;;BU)(A;ID;0x1301bf;;;AU)(A;OICIIOID;SDGXGWGR;;;AU)';
    expect(readersInDacl(dacl)).toEqual(['S-1-5-11', 'S-1-5-32-545']);
  });

  it('finds nobody else in a folder under the user profile (measured on a temporary folder)', () => {
    const dacl = 'D:(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;S-1-5-21-1085031214-1078081533-682003330-14192)';
    expect(readersInDacl(dacl)).toEqual([]);
  });

  it('reads a list with no access control as open to Everyone', () => {
    expect(readersInDacl('D:NO_ACCESS_CONTROL')).toEqual(['S-1-1-0']);
  });

  it('does not count a grant that only lets Everyone pass through the folder (measured: icacls /grant *S-1-1-0:(OI)(CI)(X))', () => {
    const dacl = 'D:AI(A;OICI;WP;;;WD)(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;S-1-5-21-1085031214-1078081533-682003330-14192)';
    expect(readersInDacl(dacl)).toEqual([]);
  });
});
