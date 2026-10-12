/**
 * @file test/unit/headless-browser-install.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node installs the Chromium build its playwright-core version is pinned to, and
 *   tells the operator when its browser does not start.
 *
 *   playwright-core starts only the build its own version names. A dependency update moved 1.62.1 to
 *   1.63.0 (build 1234 to 1243), production had only the old build, and aimeat.io took no app
 *   screenshot from 2026-10-10 to 2026-10-12 with one log line to say so. The download then failed
 *   three times by hand: the machine has no IPv6 route, DNS answers with IPv6 addresses, and the
 *   downloader spends its socket timeout on them. The fix that worked was the same installer with
 *   IPv6 lookups refused, which is the second attempt here.
 * @usage cd aimeat && pnpm exec vitest run test/unit/headless-browser-install.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';
import {
  isBrowserBuildMissing, installCommand, installPinnedBrowser, reportBrowserFault, clearBrowserFault,
  BROWSER_INCIDENT_TYPE, IPV4_ONLY_IMPORT, type InstallRun,
} from '../../src/services/headless-browser-install.js';
import { ensureHeadlessBrowser, type LaunchOutcome } from '../../src/services/screenshot-capture.js';

const config = { nodeId: 'node-test', baseUrl: 'http://node.test' } as never;
/** The line production logged on 2026-10-12. */
const MISSING = 'browserType.launch: Executable doesn\'t exist at /home/miikkij/.cache/ms-playwright/'
  + 'chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
/** The line production logged on 2026-09-19, when the build was there and died at start. */
const CRASHED = 'browser.newContext: Target page, context or browser has been closed';

let storage: Storage;
beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

const browser = () => ({ close: async () => {}, newContext: async () => ({}) });
const launches = (...outcomes: LaunchOutcome[]) => {
  let n = 0;
  const launch = async () => outcomes[Math.min(n++, outcomes.length - 1)]!;
  return { launch, count: () => n };
};
const openIncidents = async () =>
  (await listSecurityIncidents(storage, config)).items.filter(i => i.type === BROWSER_INCIDENT_TYPE && i.status === 'open');

describe('isBrowserBuildMissing', () => {
  it('reads a missing build from the launch error, and nothing else as one', () => {
    expect(isBrowserBuildMissing(new Error(MISSING))).toBe(true);
    expect(isBrowserBuildMissing(new Error(CRASHED))).toBe(false);
    expect(isBrowserBuildMissing(undefined)).toBe(false);
  });
});

describe('installCommand', () => {
  it('runs the installer of the installed playwright-core, never one fetched by name', () => {
    const cmd = installCommand(false)!;
    expect(cmd.file).toBe(process.execPath);
    expect(cmd.args.slice(-2)).toEqual(['install', 'chromium']);
    expect(cmd.args.at(-3)).toMatch(/playwright-core[\\/]cli\.js$/);
    expect(cmd.args).toHaveLength(3);
  });

  it('puts the IPv4-only import before the installer on the second attempt', () => {
    const cmd = installCommand(true)!;
    expect(cmd.args.slice(0, 2)).toEqual(['--import', IPV4_ONLY_IMPORT]);
    expect(cmd.args.slice(-2)).toEqual(['install', 'chromium']);
  });
});

describe('installPinnedBrowser', () => {
  const runner = (...results: boolean[]) => {
    const calls: boolean[] = [];
    const run: InstallRun = async (ipv4Only) => {
      calls.push(ipv4Only);
      const ok = results[calls.length - 1]!;
      return { ok, output: ok ? 'done' : `failed ${calls.length}` };
    };
    return { run, calls };
  };

  it('stops after the plain attempt when it works', async () => {
    const r = runner(true);
    expect(await installPinnedBrowser({}, r.run)).toEqual({ ok: true, ipv4Only: false });
    expect(r.calls).toEqual([false]);
  });

  it('tries again over IPv4 only when the plain attempt fails', async () => {
    const r = runner(false, true);
    expect(await installPinnedBrowser({}, r.run)).toEqual({ ok: true, ipv4Only: true });
    expect(r.calls).toEqual([false, true]);
  });

  it('answers with the last error when both attempts fail', async () => {
    const r = runner(false, false);
    expect(await installPinnedBrowser({}, r.run)).toEqual({ ok: false, error: 'failed 2' });
  });
});

describe('the IPv4-only import', () => {
  it('refuses IPv6 lookups in the installer and in the process it forks to download', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aimeat-ipv4-'));
    const script = path.join(dir, 'probe.cjs');
    writeFileSync(script, [
      'const dns = require("dns");',
      'if (process.argv[2] === "child") {',
      '  Promise.allSettled([',
      '    dns.promises.lookup("localhost", { all: true, family: 6 }),',
      '    dns.promises.lookup("localhost", { all: true }),',
      '  ]).then(([six, any]) => {',
      '    process.send({ six: six.status, families: (any.value || []).map(a => a.family) });',
      '    process.exit(0);',
      '  });',
      '} else {',
      '  const cp = require("child_process").fork(__filename, ["child"]);',
      '  cp.on("message", m => { console.log(JSON.stringify(m)); });',
      '}',
    ].join('\n'));
    try {
      const out = spawnSync(process.execPath, ['--import', IPV4_ONLY_IMPORT, script], { encoding: 'utf8' });
      expect(out.stderr).toBe('');
      const seen = JSON.parse(out.stdout) as { six: string; families: number[] };
      expect(seen.six).toBe('rejected');
      expect(seen.families.length).toBeGreaterThan(0);
      expect(seen.families.every(f => f === 4)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ensureHeadlessBrowser', () => {
  it('installs the missing build, starts the browser and records nothing', async () => {
    const l = launches({ browser: null, error: new Error(MISSING) }, { browser: browser() });
    let installs = 0;
    const ok = await ensureHeadlessBrowser(config, storage, {
      launch: l.launch, install: async () => { installs++; return { ok: true, ipv4Only: true }; },
    });
    expect(ok).toBe(true);
    expect(installs).toBe(1);
    expect(l.count()).toBe(2);
    expect(await openIncidents()).toEqual([]);
  });

  it('tells the operator when the download fails, with the command for this installation', async () => {
    const l = launches({ browser: null, error: new Error(MISSING) });
    const ok = await ensureHeadlessBrowser(config, storage, {
      launch: l.launch, install: async () => ({ ok: false, error: 'Request to https://cdn.playwright.dev/x timed out after 30000ms' }),
    });
    expect(ok).toBe(false);
    const [incident, ...rest] = await openIncidents();
    expect(rest).toEqual([]);
    expect(incident!.code).toBe('BROWSER_INSTALL_FAILED');
    expect(incident!.detail).toContain('timed out after 30000ms');
    expect(incident!.detail).toContain(installCommand(false)!.args.at(-3)!);
    expect(incident!.detail).not.toContain('npx');
  });

  it('does not download anything when the browser is there and fails to start', async () => {
    const l = launches({ browser: null, error: new Error(CRASHED) });
    let installs = 0;
    const ok = await ensureHeadlessBrowser(config, storage, {
      launch: l.launch, install: async () => { installs++; return { ok: true, ipv4Only: false }; },
    });
    expect(ok).toBe(false);
    expect(installs).toBe(0);
    const [incident] = await openIncidents();
    expect(incident!.code).toBe('BROWSER_LAUNCH_FAILED');
    expect(incident!.detail).toContain(CRASHED);
  });

  it('closes its incident at the first start the browser works again', async () => {
    await ensureHeadlessBrowser(config, storage, {
      launch: launches({ browser: null, error: new Error(CRASHED) }).launch, install: async () => ({ ok: false, error: 'unused' }),
    });
    expect(await openIncidents()).toHaveLength(1);

    const ok = await ensureHeadlessBrowser(config, storage, {
      launch: launches({ browser: browser() }).launch, install: async () => ({ ok: false, error: 'unused' }),
    });
    expect(ok).toBe(true);
    expect(await openIncidents()).toEqual([]);
  });
});

describe('reportBrowserFault', () => {
  it('keeps one open incident however many starts fail', async () => {
    await reportBrowserFault(storage, config, { launchError: CRASHED });
    await reportBrowserFault(storage, config, { launchError: CRASHED });
    expect(await openIncidents()).toHaveLength(1);

    await clearBrowserFault(storage, config);
    expect(await openIncidents()).toEqual([]);
    await reportBrowserFault(storage, config, { launchError: CRASHED });
    expect(await openIncidents()).toHaveLength(1);
  });
});
