/**
 * @file src/services/node-update-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is a newer AIMEAT on npm than the one this node runs, when was it released, and what
 *   is new in it. ONE IMPLEMENTATION, called by GET /v1/admin/node-update (the operator's header
 *   notice and its dialog) and by the aimeat_admin_node_update MCP tool.
 *
 *   WHAT LEAVES THE NODE. Three reads, none of which carries anything about this node:
 *     1. `<registry>/aimeat/latest`, a few kB: the newest version.
 *     2. The release date: npm's search endpoint answers it in a few hundred bytes. Its index can lag
 *        a fresh publish, and then the full package document is read once instead (1.5 MB in
 *        September 2026, 136 versions) for its `time` map.
 *     3. `<files>/aimeat@<version>/dist/public/changelog.json`, the newer version's own change log,
 *        about 140 kB. jsDelivr refuses this package (it holds more files than jsDelivr serves), so
 *        the default is unpkg.
 *   Reads 2 and 3 happen only when a newer version exists. Every result is kept for six hours and a
 *   failure for thirty minutes, and nothing runs on a timer: the check happens when an operator opens
 *   a page, so a node nobody operates from a browser makes no requests at all.
 *
 *   WHAT IS NEW is the newer change log minus the entries this node's own change log already has,
 *   matched on date and title. The change log is written per feature rather than per version (the
 *   `version` field is optional and mostly absent), so a diff is the only reading that is right for
 *   a node one version behind and for one ten versions behind alike.
 *
 *   THE INSTALL GUESS reads the package's own path: `resources/server` is the desktop app's bundle,
 *   `_npx` is npx's cache, `node_modules` is an npm install, a `.git` beside the package is a clone,
 *   and `/.dockerenv` is a container. The prompt names it as a guess for the AI to confirm.
 * @structure getNodeUpdateStatus(config, opts) · detectInstall() · whatsNew() · NodeUpdateStatus
 * @usage const status = await getNodeUpdateStatus(config, { refresh: false });
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import { getSoftwareVersion } from '../utils/version.js';
import { safeFetch } from '../utils/url-validator.js';
import { readBodyCapped } from '../utils/read-capped.js';
import { logger } from '../utils/logger.js';
import { compareVersions } from './federation-overview.js';
import { readChangelog, type ChangelogEntry } from './page-body-live.js';
import { buildNodeUpdatePrompt, type InstallMethod } from './node-update-prompt.js';

const PACKAGE = 'aimeat';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_FILES = 'https://unpkg.com';
const OK_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;
/** At most this many new entries: a node years behind would otherwise get the whole history. */
const WHATS_NEW_MAX = 40;

/** The config path the operator switches the check off with. The dialog links to it. */
export const UPDATE_CHECK_SETTING = 'node.update_check';

export interface NodeUpdateStatus {
  /** False when the operator switched the check off: nothing was asked and nothing is shown. */
  enabled: boolean;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  /** ISO time the newer version was published on npm, or null when that could not be read. */
  releasedAt: string | null;
  /** Change-log entries the newer version has and this node does not. Null when it could not be read. */
  whatsNew: ChangelogEntry[] | null;
  checkedAt: string | null;
  /** Why the check could not answer, in one sentence; null when it answered. */
  error: string | null;
  install: { method: InstallMethod; packageDir: string | null; workingDir: string };
  /** The copy-prompt for Claude Code or Codex; present only when an update is available. */
  prompt: string | null;
  setting: typeof UPDATE_CHECK_SETTING;
}

interface Checked {
  source: string;
  at: number;
  latest: string | null;
  releasedAt: string | null;
  remoteLog: ChangelogEntry[] | null;
  error: string | null;
}

let cached: Checked | null = null;
let inflight: Promise<Checked> | null = null;

const here = dirname(fileURLToPath(import.meta.url));

/** The directory holding the running package's package.json: aimeat/ in a clone, the package root once installed. */
function packageDir(): string | null {
  for (const p of [join(here, '..', '..'), join(here, '..', '..', '..')]) {
    const pj = join(p, 'package.json');
    if (!existsSync(pj)) continue;
    try {
      if ((JSON.parse(readFileSync(pj, 'utf-8')) as { name?: string }).name === PACKAGE) return p;
    // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable package.json is the next candidate's turn
    } catch { /* next candidate */ }
  }
  return null;
}

export function detectInstall(): NodeUpdateStatus['install'] {
  const dir = packageDir();
  const path = (dir ?? here).replace(/\\/g, '/');
  let method: InstallMethod = 'unknown';
  if (/\/resources\/server(\/|$)/.test(path)) method = 'desktop';
  else if (existsSync('/.dockerenv')) method = 'docker';
  else if (path.includes('/_npx/')) method = 'npx';
  else if (path.includes('/node_modules/')) method = 'npm';
  else if (dir && existsSync(join(dir, '..', '.git'))) method = 'source';
  return { method, packageDir: dir, workingDir: process.cwd() };
}

/** GET a URL as JSON with a size cap. Null body on a non-200, a timeout or a body past the cap. */
async function getJson<T>(url: string, maxBytes: number): Promise<T | null> {
  const resp = await safeFetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) {
    // The status is the answer; a body that fails to close changes nothing about it.
    await resp.body?.cancel().catch((err: unknown) => logger.debug('node-update-check: cancel after a refusal failed', { error: String(err) }));
    return null;
  }
  const buf = await readBodyCapped(resp, maxBytes);
  return buf ? JSON.parse(buf.toString('utf-8')) as T : null;
}

async function releaseDate(registry: string, version: string): Promise<string | null> {
  try {
    const found = await getJson<{ objects?: Array<{ package?: { name?: string; version?: string; date?: string } }> }>(
      `${registry}/-/v1/search?text=${PACKAGE}&size=5`, 256 * 1024);
    const hit = found?.objects?.find(o => o.package?.name === PACKAGE && o.package?.version === version);
    if (hit?.package?.date) return hit.package.date;
  } catch (err) {
    logger.debug('node-update-check: the search endpoint did not answer; reading the package document', { error: String(err) });
  }
  const doc = await getJson<{ time?: Record<string, string> }>(`${registry}/${PACKAGE}`, 16 * 1024 * 1024);
  return doc?.time?.[version] ?? null;
}

async function check(source: string): Promise<Checked> {
  const registry = (source || DEFAULT_REGISTRY).replace(/\/+$/, '');
  const files = (source || DEFAULT_FILES).replace(/\/+$/, '');
  const at = Date.now();
  try {
    const latestDoc = await getJson<{ version?: string }>(`${registry}/${PACKAGE}/latest`, 512 * 1024);
    const latest = typeof latestDoc?.version === 'string' ? latestDoc.version : null;
    if (!latest) return { source, at, latest: null, releasedAt: null, remoteLog: null, error: 'The package registry did not name a latest version.' };
    if (compareVersions(getSoftwareVersion(), latest) >= 0) {
      return { source, at, latest, releasedAt: null, remoteLog: null, error: null };
    }
    // The date and the change log are extras: either failing leaves the version answer standing.
    const [releasedAt, log] = await Promise.all([
      releaseDate(registry, latest).catch((err: unknown) => {
        logger.warn('node-update-check: release date unavailable', { error: String(err) });
        return null;
      }),
      getJson<{ entries?: ChangelogEntry[] }>(`${files}/${PACKAGE}@${latest}/dist/public/changelog.json`, 4 * 1024 * 1024)
        .catch((err: unknown) => {
          logger.warn('node-update-check: the newer change log is unavailable', { error: String(err) });
          return null;
        }),
    ]);
    return { source, at, latest, releasedAt, remoteLog: Array.isArray(log?.entries) ? log.entries : null, error: null };
  } catch (err) {
    logger.warn('node-update-check: the version check failed', { error: String(err) });
    return { source, at, latest: null, releasedAt: null, remoteLog: null, error: `The version check could not reach ${registry}.` };
  }
}

const entryKey = (e: ChangelogEntry): string => `${e.date}|${JSON.stringify(e.title)}`;

/** The newer change log's entries this node's own change log does not have, newest first. */
export function whatsNew(remote: ChangelogEntry[], local: ChangelogEntry[]): ChangelogEntry[] {
  const have = new Set(local.map(entryKey));
  return remote.filter(e => e && typeof e.date === 'string' && !have.has(entryKey(e))).slice(0, WHATS_NEW_MAX);
}

export async function getNodeUpdateStatus(config: AimeatConfig, opts: { refresh?: boolean } = {}): Promise<NodeUpdateStatus> {
  const current = getSoftwareVersion();
  const install = detectInstall();
  const base: NodeUpdateStatus = {
    enabled: config.updateCheck, current, latest: null, updateAvailable: false, releasedAt: null,
    whatsNew: null, checkedAt: null, error: null, install, prompt: null, setting: UPDATE_CHECK_SETTING,
  };
  if (!config.updateCheck) return base;

  const source = config.updateCheckSource;
  const fresh = cached && cached.source === source
    && Date.now() - cached.at < (cached.error ? FAIL_TTL_MS : OK_TTL_MS);
  if (!fresh || opts.refresh) {
    inflight ??= check(source).finally(() => { inflight = null; });
    cached = await inflight;
  }
  const c = cached!;
  const updateAvailable = !!c.latest && /^\d+\.\d+\.\d+/.test(current) && compareVersions(current, c.latest) < 0;
  return {
    ...base,
    latest: c.latest,
    updateAvailable,
    releasedAt: updateAvailable ? c.releasedAt : null,
    whatsNew: updateAvailable && c.remoteLog ? whatsNew(c.remoteLog, readChangelog()) : null,
    checkedAt: new Date(c.at).toISOString(),
    error: c.error,
    prompt: updateAvailable && c.latest ? buildNodeUpdatePrompt({
      current, latest: c.latest, releasedAt: c.releasedAt, baseUrl: config.baseUrl, install,
      storage: config.storageProvider, sqlitePath: config.sqlitePath,
    }) : null,
  };
}
