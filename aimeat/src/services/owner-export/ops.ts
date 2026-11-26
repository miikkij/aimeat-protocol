/**
 * @file src/services/owner-export/ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data export operations every surface calls: the plan (which parts, how large on
 *   this account, what is running), start, status, cancel, and the download of one ZIP file. REST:
 *   routes/owners/exports.ts; MCP: aimeat_account_export (mcp/owner-export.ts).
 *
 *   WHO. The account holder and their agents, for their own account; the operator for any account,
 *   which writes the operator trail in the person's feed, as the JSON export does. A visitor from
 *   another node, an app grant, an ecosystem app and an anonymous caller are refused.
 *
 *   THE DOWNLOAD LINK GOES TO THE PERSON ONLY (Jouni, 2026-11-26). An agent may start an export and
 *   read its state, and is told it is ready; the links are given to the account holder in person (a
 *   signed-in session or their own personal token) and to the operator in person. An agent holding a link would
 *   hold the whole account. A link is signed by the node, names one file of one job, and works for an
 *   hour; the page asks for new ones each time it shows them.
 *
 *   BEFORE A START. One export per account at a time: a second is refused while one waits or runs,
 *   and a new one replaces a finished one (its files are removed). The sizes are measured, and the
 *   export is refused before it starts when it does not fit: the free disk under the export folder
 *   less a reserve, and the operator's limit on all waiting exports together.
 * @structure exportPlanFor · startExportFor · exportStatusFor · cancelExportFor · resolveDownload
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import { isOperatorCaller, operatorOverride } from '../operator/override.js';
import { generateDownloadToken, verifyDownloadToken } from '../download-token.js';
import { UNCHANGED } from '../record-cas.js';
import { EXPORT_PARTS, DEFAULT_PARTS, PART_WHAT, exportPrincipals, measureExport, partsOf, type ExportPartId } from './parts.js';
import { changeExportJob, claimExportJob, dequeue, enqueue, readExportJob, readQueue, type ExportJob } from './job-store.js';
import { accountFolderName, exportDiskUse, freeDiskBytes, notThere, removeExportFolder, volumePath } from './folders.js';
import { cancelRunning, kickExports, EXPORT_DOMAIN } from './runner.js';
import { emitChange } from '../event-bus.js';

export interface ExportDeps { storage: Storage; config: AimeatConfig }
type Outcome = { ok: true; status?: number; data: Record<string, unknown> } | { ok: false; status: number; code: string; message: string };

const refuse = (status: number, code: string, message: string): Outcome => ({ ok: false, status, code, message });
/** Kept free on the disk beside what an export is estimated to take. */
const DISK_RESERVE = 1024 * 1024 * 1024;
/** What the account section itself is counted as before a start (its lists are small). */
const ACCOUNT_ESTIMATE = 64 * 1024 * 1024;
/** How long a download link works. */
const LINK_SECONDS = 3600;
const KEY_PREFIX = 'export:';

interface Allowed { name: string; ghii: string; byOperator: boolean; links: boolean }

/** May this caller act on `name`'s export, and may it hold the download links? */
async function allowed(deps: ExportDeps, c: CallerContext, name: string, act: 'read' | 'start' | 'cancel'): Promise<Allowed | Outcome> {
  if (c.visitor || c.kind === 'app' || c.kind === 'ecosystem' || c.kind === 'anonymous') {
    return refuse(403, 'ACCESS_DENIED', 'A data export belongs to an account: its holder, their agents or the operator asks for it.');
  }
  // The words the routes ask (requireScope), asked here too, because the one MCP tool reads and writes.
  const word = act === 'read' ? 'memory:read' : 'memory:write';
  if (!c.has(word)) return refuse(403, 'SCOPE_DENIED', `This needs the permission ${word}.`);
  const own = c.owner === name;
  if (!own && !(await isOperatorCaller(deps.storage, c.auth))) return refuse(403, 'ACCESS_DENIED', 'You can only export your own data');
  const ghii = (await deps.storage.getGHIIByOwner(name))?.ghii;
  if (!ghii || !(await deps.storage.getOwner(name))) return refuse(404, 'NOT_FOUND', `Owner not found: ${name}`);
  if (!own && !(await operatorOverride(deps.storage, deps.config, c.auth, { ownerOf: name, area: 'account', action: act === 'read' ? 'export-read' : `export-${act}`, subject: name }))) {
    return refuse(403, 'ACCESS_DENIED', 'You can only export your own data');
  }
  // A person in person holds the links: the account holder, or the operator for another's account.
  return { name, ghii, byOperator: !own, links: c.isPerson };
}

/** The job as every surface shows it; the links only to a caller that may hold them. */
async function jobView(deps: ExportDeps, job: ExportJob | null, links: boolean): Promise<Record<string, unknown> | null> {
  if (!job) return null;
  const place = job.state === 'queued' ? (await readQueue(deps.storage, deps.config.nodeId)).findIndex(e => e.id === job.id) + 1 : undefined;
  const files = job.state === 'ready' ? await Promise.all((job.volumes ?? []).map(async v => ({
    n: v.n, file: v.file, bytes: v.bytes, sha256: v.sha256,
    ...(links ? { url: `${deps.config.baseUrl}/v1/exports/download/${await generateDownloadToken({
      sub: job.ghii, key: `${KEY_PREFIX}${job.id}:${v.n}`, mimeType: 'application/zip', size: v.bytes, version: v.sha256, filename: v.file,
    }, LINK_SECONDS)}` } : {}),
  }))) : undefined;
  return {
    id: job.id, state: job.state, parts: job.parts, requested_at: job.requested_at,
    ...(job.by_operator ? { by_operator: true } : {}),
    ...(place ? { place_in_queue: place } : {}),
    ...(job.started_at ? { started_at: job.started_at } : {}),
    ...(job.progress && job.state === 'running' ? { progress: job.progress } : {}),
    estimate_bytes: job.estimate_bytes,
    ...(job.finished_at ? { finished_at: job.finished_at } : {}),
    ...(job.expires_at && job.state === 'ready' ? { expires_at: job.expires_at } : {}),
    ...(job.written ? { written: job.written } : {}),
    ...(files ? { files, ...(links ? { links_valid_seconds: LINK_SECONDS } : { links: 'The download links go to the account holder only. Tell them the export is ready on the Data wallet page.' }) } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

/** GET …/exports/plan: the parts with their sizes on this account, and the current export. */
export async function exportPlanFor(deps: ExportDeps, c: CallerContext, name: string): Promise<Outcome> {
  const a = await allowed(deps, c, name, 'read');
  if ('ok' in a) return a;
  const p = await exportPrincipals(deps.storage, a.name);
  if (!p) return refuse(404, 'NOT_FOUND', `Owner not found: ${name}`);
  const sizes = await measureExport(deps.storage, p);
  return {
    ok: true,
    data: {
      account: { what: PART_WHAT.account, always: true },
      parts: EXPORT_PARTS.map(id => ({ id, what: PART_WHAT[id], count: sizes[id].count, bytes: sizes[id].bytes, default: DEFAULT_PARTS.includes(id) })),
      current: await jobView(deps, await readExportJob(deps.storage, a.ghii), a.links),
      file_mb: deps.config.exportVolumeMb, keep_days: deps.config.exportKeepDays,
      one_at_a_time: 'The node writes one export at a time; another waits in the queue.',
    },
  };
}

/** POST …/exports { parts? }: queue an export of the chosen parts. */
export async function startExportFor(deps: ExportDeps, c: CallerContext, name: string, body: unknown): Promise<Outcome> {
  const a = await allowed(deps, c, name, 'start');
  if ('ok' in a) return a;
  const parts = partsOf((body as { parts?: unknown } | null)?.parts);
  if (!parts) return refuse(400, 'INVALID_INPUT', `parts is a list of: ${EXPORT_PARTS.join(', ')}.`);
  const { storage, config } = deps;
  const prior = await readExportJob(storage, a.ghii);
  if (prior && (prior.state === 'queued' || prior.state === 'running')) {
    return refuse(409, 'EXPORT_RUNNING', 'An export of this account is already waiting or being written. Wait for it, or cancel it first.');
  }
  const p = await exportPrincipals(storage, a.name);
  if (!p) return refuse(404, 'NOT_FOUND', `Owner not found: ${name}`);
  const sizes = await measureExport(storage, p);
  const estimate: Partial<Record<ExportPartId, { count: number; bytes: number }>> = {};
  let bytes = 0;
  for (const id of parts) { estimate[id] = sizes[id]; bytes += sizes[id].bytes; }

  // The account section is not measured before; the disk checks count it at ACCOUNT_ESTIMATE.
  const priorBytes = prior?.state === 'ready' ? (prior.volumes ?? []).reduce((s, v) => s + v.bytes, 0) : 0;
  const free = await freeDiskBytes(config);
  const gb = (n: number): string => (n / 1e9).toFixed(1);
  if (bytes + ACCOUNT_ESTIMATE + DISK_RESERVE > free + priorBytes) {
    return refuse(507, 'EXPORT_TOO_LARGE', `This export would take about ${gb(bytes)} GB and the node has ${gb(free)} GB free for it. Choose fewer parts, or ask the operator.`);
  }
  if (config.exportMaxDiskGb > 0) {
    const used = (await exportDiskUse(config)) - priorBytes;
    const cap = config.exportMaxDiskGb * 1e9;
    if (used + bytes + ACCOUNT_ESTIMATE > cap) {
      return refuse(507, 'EXPORT_TOO_LARGE', `This export would take about ${gb(bytes)} GB, and the exports waiting for their download on this node may take ${gb(cap)} GB together (${gb(used)} GB now). Choose fewer parts, try again later, or ask the operator.`);
    }
  }

  const id = `exp-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const folderOwner = accountFolderName(a.name);
  const job: ExportJob = {
    id, owner: a.name, ghii: a.ghii, parts, state: 'queued', requested_by: c.principal,
    ...(a.byOperator ? { by_operator: true } : {}),
    requested_at: new Date().toISOString(), estimate, estimate_bytes: bytes, folder: `${folderOwner}/${id}`, attempts: 0,
  };
  if (!await claimExportJob(storage, job)) {
    return refuse(409, 'EXPORT_RUNNING', 'An export of this account is already waiting or being written. Wait for it, or cancel it first.');
  }
  // A finished export is replaced: its files go now, not with the sweep.
  if (prior?.state === 'ready') await removeExportFolder(config, prior.folder);
  await enqueue(storage, config.nodeId, { ghii: a.ghii, id, at: job.requested_at });
  emitChange(EXPORT_DOMAIN, a.ghii);
  kickExports(deps);
  return { ok: true, status: 202, data: { export: await jobView(deps, job, a.links), next: 'Read the state with GET /v1/owners/:name/exports/current; the account holder is told when it is ready.' } };
}

/** GET …/exports/current: the account's export, with the download links for a caller that may hold them. */
export async function exportStatusFor(deps: ExportDeps, c: CallerContext, name: string): Promise<Outcome> {
  const a = await allowed(deps, c, name, 'read');
  if ('ok' in a) return a;
  const job = await readExportJob(deps.storage, a.ghii);
  if (!job) return refuse(404, 'NO_EXPORT', 'This account has no data export. Start one with POST /v1/owners/:name/exports.');
  return { ok: true, data: { export: await jobView(deps, job, a.links) } };
}

/** DELETE …/exports/current: stop a waiting or running export, or remove a finished one's files. */
export async function cancelExportFor(deps: ExportDeps, c: CallerContext, name: string): Promise<Outcome> {
  const a = await allowed(deps, c, name, 'cancel');
  if ('ok' in a) return a;
  const { storage, config } = deps;
  const job = await readExportJob(storage, a.ghii);
  if (!job || !['queued', 'running', 'ready'].includes(job.state)) return refuse(404, 'NO_EXPORT', 'This account has no export waiting, running or ready.');
  const was = job.state;
  const done = await changeExportJob(storage, a.ghii, job.id, j => (['queued', 'running', 'ready'].includes(j.state)
    ? { ...j, state: 'cancelled', finished_at: new Date().toISOString(), progress: undefined, volumes: [] } : UNCHANGED));
  if (!done) return refuse(404, 'NO_EXPORT', 'This account has no export waiting, running or ready.');
  await dequeue(storage, config.nodeId, job.id);
  // A running export stops at its next check here; in another process it reads the record.
  cancelRunning(config, job.id);
  if (was !== 'running') await removeExportFolder(config, job.folder);
  emitChange(EXPORT_DOMAIN, a.ghii);
  return { ok: true, data: { export: { id: job.id, state: 'cancelled', was } } };
}

/** The file one download link names, while its export is ready and the file is the one signed. */
export async function resolveDownload(deps: ExportDeps, token: string): Promise<
  { ok: true; path: string; file: string; bytes: number; sha256: string; finishedAt: string } | { ok: false; status: number; code: string; message: string }
> {
  let v;
  try { v = await verifyDownloadToken(token); } catch (err) {
    const code = (err as { code?: string }).code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    return { ok: false, status: code === 'TOKEN_EXPIRED' ? 410 : 401, code, message: code === 'TOKEN_EXPIRED' ? 'This download link has expired. Open the export again for new links.' : 'This is not a download link of a data export.' };
  }
  const m = /^export:(exp-[a-z0-9]+-[0-9a-f]+):(\d+)$/.exec(v.key);
  if (!m) return { ok: false, status: 401, code: 'TOKEN_INVALID', message: 'This is not a download link of a data export.' };
  const job = await readExportJob(deps.storage, v.sub);
  const vol = job?.id === m[1] && job.state === 'ready' ? (job.volumes ?? []).find(x => x.n === Number(m[2])) : undefined;
  if (!job || !vol || vol.sha256 !== v.version || vol.bytes !== v.size) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'This export is gone: it expired, was cancelled or was replaced by a newer one.' };
  }
  const path = volumePath(deps.config, job.folder, vol.file);
  const s = path ? await stat(path).catch(notThere) : null;
  if (!path || !s || s.size !== vol.bytes) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'This export\'s file is not on the node any more.' };
  return { ok: true, path, file: vol.file, bytes: vol.bytes, sha256: vol.sha256, finishedAt: job.finished_at ?? job.requested_at };
}
