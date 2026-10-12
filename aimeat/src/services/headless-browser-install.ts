/**
 * @file headless-browser-install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installs the Chromium build the installed playwright-core is pinned to, and records
 *   on the Security page when the node's headless browser does not start.
 *
 *   WHY THE NODE INSTALLS IT. playwright-core starts only the build its own version names, so every
 *   playwright-core update needs a new download on every node. Until 2026-10-12 that was a command
 *   an operator had to know about: aimeat.io went from 1.62.1 to 1.63.0 (build 1234 to 1243), had
 *   only the old build, and took no app screenshot for two days with one log line to say so.
 *
 *   THE INSTALLER IS THE ONE IN node_modules. The command is the cli.js of the playwright-core this
 *   node imports, run with this node's own executable. `npx playwright install` resolves a package
 *   by name and can fetch a newer one, whose build is not the one this node starts.
 *
 *   THE SECOND ATTEMPT REFUSES IPv6. Playwright's downloader asks DNS for both families, tries the
 *   IPv6 addresses first and gives each at least five seconds, inside a 30-second socket timeout.
 *   On a machine with no IPv6 route whose DNS still answers with IPv6 addresses the download never
 *   reaches IPv4: on aimeat.io it failed three times with no bytes received. The second attempt
 *   runs the same installer with an import that refuses IPv6 lookups. The import is in the
 *   installer's execArgv, which child_process.fork copies to the process that downloads.
 * @structure isBrowserBuildMissing() · installCommand() · browserInstallHint() ·
 *   installPinnedBrowser() · reportBrowserFault() · clearBrowserFault()
 * @usage
 *   const out = await installPinnedBrowser(browserLaunchEnv(process.env));
 *   if (!out.ok) await reportBrowserFault(storage, config, { launchError, installError: out.error });
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';
import {
  listSecurityIncidents, recordSecurityIncident, resolveSecurityIncident, securityOwner,
} from './security-incident.js';

const require = createRequire(import.meta.url);

/** One installer run may download three archives on a slow line; past this it is stopped. */
const INSTALL_TIMEOUT_MS = 15 * 60_000;
/** How much of the installer's output an error message and an incident carry. */
const OUTPUT_TAIL = 1500;

export const BROWSER_INCIDENT_TYPE = 'headless_browser';

/** Where the installed playwright-core is, and its version; null on a node that does not have it. */
function playwrightCore(): { cli: string; version: string } | null {
  try {
    const manifest = require.resolve('playwright-core/package.json');
    const { version } = require(manifest) as { version: string };
    return { cli: path.join(path.dirname(manifest), 'cli.js'), version };
  } catch (err) {
    logger.debug('playwright-core is not installed on this node', { error: String(err) });
    return null;
  }
}

/** True when a launch failed because the build this playwright-core version names is not on disk. */
export function isBrowserBuildMissing(err: unknown): boolean {
  return /Executable doesn't exist/i.test((err as Error | undefined)?.message ?? '');
}

/**
 * An ES module that refuses IPv6 lookups and asks for IPv4 in every other one, as the `--import`
 * argument of the installer. A data: URL, so nothing is written to disk to be loaded as code.
 */
const IPV4_ONLY_SOURCE = `
import dns from 'node:dns';
const refused = () => Object.assign(new Error('IPv6 lookups are refused for this install'), { code: 'ENOTFOUND' });
const familyOf = (o) => (typeof o === 'number' ? o : o && o.family);
const v4 = (o) => ({ ...(typeof o === 'object' && o ? o : {}), family: 4 });
const lookupAsync = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = (host, o) => (familyOf(o) === 6 ? Promise.reject(refused()) : lookupAsync(host, v4(o)));
const lookup = dns.lookup.bind(dns);
dns.lookup = (host, o, cb) => {
  if (typeof o === 'function') return lookup(host, { family: 4 }, o);
  if (familyOf(o) === 6) { process.nextTick(cb, refused()); return {}; }
  return lookup(host, v4(o), cb);
};
`;
export const IPV4_ONLY_IMPORT = 'data:text/javascript,' + encodeURIComponent(IPV4_ONLY_SOURCE);

/** The installer of the installed playwright-core, as an executable and its arguments. */
export function installCommand(ipv4Only: boolean): { file: string; args: string[] } | null {
  const pw = playwrightCore();
  if (!pw) return null;
  return { file: process.execPath, args: [...(ipv4Only ? ['--import', IPV4_ONLY_IMPORT] : []), pw.cli, 'install', 'chromium'] };
}

/** The same command as one line an operator can run, with this installation's own paths. */
export function browserInstallHint(action: 'install' | 'install-deps' = 'install'): string {
  const pw = playwrightCore();
  if (!pw) return 'install the playwright-core package first (pnpm install in the node\'s directory)';
  return `"${process.execPath}" "${pw.cli}" ${action} chromium`;
}

export interface InstallRunResult { ok: boolean; output: string }
export type InstallRun = (ipv4Only: boolean, env: Record<string, string>) => Promise<InstallRunResult>;
export type InstallResult = { ok: true; ipv4Only: boolean } | { ok: false; error: string };

/** One run of the installer, with the end of what it printed. Never rejects. */
const runInstaller: InstallRun = (ipv4Only, env) => {
  const cmd = installCommand(ipv4Only);
  if (!cmd) return Promise.resolve({ ok: false, output: 'playwright-core is not installed on this node' });
  return new Promise((resolve) => {
    let output = '';
    const keep = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-OUTPUT_TAIL); };
    const child = spawn(cmd.file, cmd.args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stop = setTimeout(() => {
      output += `\nStopped after ${INSTALL_TIMEOUT_MS / 60_000} minutes.`;
      child.kill();
    }, INSTALL_TIMEOUT_MS);
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (err) => { clearTimeout(stop); resolve({ ok: false, output: String(err) }); });
    child.on('close', (code) => { clearTimeout(stop); resolve({ ok: code === 0, output: output.trim() }); });
  });
};

/**
 * Download the pinned build into the cache of the user the node runs as: once as Playwright does it,
 * and once more with IPv6 lookups refused when that fails. `env` is the environment a browser launch
 * gets (browserLaunchEnv), so the installer writes where the launch reads.
 */
export async function installPinnedBrowser(env: Record<string, string>, run: InstallRun = runInstaller): Promise<InstallResult> {
  const plain = await run(false, env);
  if (plain.ok) return { ok: true, ipv4Only: false };
  logger.info('Headless browser: the download failed, trying again over IPv4 only.', { error: plain.output });
  const ipv4 = await run(true, env);
  if (ipv4.ok) return { ok: true, ipv4Only: true };
  return { ok: false, error: ipv4.output || plain.output };
}

const openBrowserIncidents = async (storage: Storage, config: AimeatConfig) =>
  (await listSecurityIncidents(storage, config)).items.filter(i => i.type === BROWSER_INCIDENT_TYPE && i.status === 'open');

/**
 * Tell the operator that the node's browser does not start: one open incident on the Security page
 * (GET /v1/admin/security/incidents, aimeat_admin_security_overview), however many starts fail.
 * Never throws.
 */
export async function reportBrowserFault(
  storage: Storage, config: AimeatConfig, fault: { launchError: string; installError?: string },
): Promise<void> {
  try {
    if ((await openBrowserIncidents(storage, config)).length > 0) return;
    const version = playwrightCore()?.version ?? 'unknown';
    const effect = 'The server\'s own browser does not start, so it takes no app screenshot and runs no playtest or Design Book bench. ';
    const after = ' The server tries its browser again within an hour, and at once after a restart; this incident closes by itself when the browser starts.';
    const detail = fault.installError !== undefined
      ? `${effect}The Chromium build that playwright-core ${version} starts is not installed, and the server could not download it: `
        + `${fault.installError} Install it as the user the server runs as: ${browserInstallHint()}.${after}`
      : `${effect}Last error: ${fault.launchError} When the error names a missing system library on Linux, install the libraries `
        + `with sudo: ${browserInstallHint('install-deps')}.${after}`;
    const out = await recordSecurityIncident(storage, config, {
      type: BROWSER_INCIDENT_TYPE,
      code: fault.installError !== undefined ? 'BROWSER_INSTALL_FAILED' : 'BROWSER_LAUNCH_FAILED',
      actorGhii: securityOwner(config.nodeId), detail, source: 'start',
    });
    if (out.recorded) emitChange('security');
  } catch (err) {
    logger.warn('reportBrowserFault: the Security page entry is best-effort', { error: String(err) });
  }
}

/** The browser starts again: close the incident that said it did not. Never throws. */
export async function clearBrowserFault(storage: Storage, config: AimeatConfig): Promise<void> {
  try {
    for (const incident of await openBrowserIncidents(storage, config)) {
      await resolveSecurityIncident(storage, config, incident.id);
    }
  } catch (err) {
    logger.warn('clearBrowserFault: closing the Security page entry is best-effort', { error: String(err) });
  }
}
