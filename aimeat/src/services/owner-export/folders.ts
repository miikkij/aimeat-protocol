/**
 * @file src/services/owner-export/folders.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The folders a data export is written into on the node's disk: `<exportDir>/<owner>/<job>`.
 *   Every path is built here from names the node made (the account name and a job id it drew), and
 *   checked to stay inside the export folder, so no request can name a path of its own. Also how much
 *   the waiting exports take and how much the disk has free, which decide whether a new export starts.
 * @structure exportFolderPath · volumePath · ensureExportFolder · removeExportFolder · accountFolderName ·
 *   removeAccountFolder · exportDiskUse · freeDiskBytes · listJobFolders
 * @usage const dir = await ensureExportFolder(config, job.folder);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import { mkdir, readdir, rm, stat, statfs } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { AimeatConfig } from '../../config.js';

type FolderConfig = Pick<AimeatConfig, 'exportDir'>;

/** For a `.catch()`: null when the file or folder is not there; any other failure passes on. */
export function notThere(err: unknown): null {
  if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null;
  throw err;
}

/** A folder or file name the node made: letters, digits, dot, dash, underscore, `@`. */
const SAFE = /^[A-Za-z0-9._@-]+$/;

function root(config: FolderConfig): string {
  return resolve(config.exportDir);
}

/** The absolute path of a job's folder (`<owner>/<id>`), refused when it would leave the export folder. */
export function exportFolderPath(config: FolderConfig, folder: string): string {
  const parts = folder.split('/');
  if (parts.length !== 2 || !parts.every(p => SAFE.test(p) && p !== '.' && p !== '..')) throw new Error(`Not an export folder: ${folder}`);
  const base = root(config);
  const path = resolve(base, ...parts);
  if (!path.startsWith(base + sep)) throw new Error(`Not an export folder: ${folder}`);
  return path;
}

/** The path of one volume of a job, or null when the name is not a volume's. */
export function volumePath(config: FolderConfig, folder: string, file: string): string | null {
  if (!/^aimeat-export-[A-Za-z0-9._@-]+-\d{2,}\.zip$/.test(file)) return null;
  return join(exportFolderPath(config, folder), file);
}

export async function ensureExportFolder(config: FolderConfig, folder: string): Promise<string> {
  const path = exportFolderPath(config, folder);
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  return path;
}

/** Remove a job's folder with its files; an absent folder is not an error. */
export async function removeExportFolder(config: FolderConfig, folder: string): Promise<void> {
  await rm(exportFolderPath(config, folder), { recursive: true, force: true });
}

/** The folder name an account's exports are written under. */
export function accountFolderName(owner: string): string {
  return owner.replace(/[^A-Za-z0-9._@-]/g, '_');
}

/** Remove every export of one account (its erasure). */
export async function removeAccountFolder(config: FolderConfig, owner: string): Promise<void> {
  const name = accountFolderName(owner);
  if (!SAFE.test(name) || name === '.' || name === '..') return;
  await rm(join(root(config), name), { recursive: true, force: true });
}

/** Bytes every file under the export folder takes. */
export async function exportDiskUse(config: FolderConfig): Promise<number> {
  const walk = async (dir: string): Promise<number> => {
    let sum = 0;
    const names = (await readdir(dir).catch(notThere)) ?? [];
    for (const n of names) {
      const p = join(dir, n);
      // A file the sweep removed meanwhile is simply not counted.
      const s = await stat(p).catch(notThere);
      if (!s) continue;
      sum += s.isDirectory() ? await walk(p) : s.size;
    }
    return sum;
  };
  return walk(root(config));
}

/** Bytes free on the disk of the export folder (of its nearest existing parent). */
export async function freeDiskBytes(config: FolderConfig): Promise<number> {
  // The export folder may not exist yet (no export was made): the disk is its nearest existing parent's.
  let dir = root(config);
  for (;;) {
    const fs = await statfs(dir).catch(notThere);
    if (fs) return fs.bavail * fs.bsize;
    const up = resolve(dir, '..');
    if (up === dir) throw new Error(`No folder of ${root(config)} exists to measure its disk.`);
    dir = up;
  }
}

/** Every `<owner>/<id>` folder under the export folder, for the sweep. */
export async function listJobFolders(config: FolderConfig): Promise<string[]> {
  const out: string[] = [];
  const owners = (await readdir(root(config)).catch(notThere)) ?? [];
  for (const o of owners) {
    if (!SAFE.test(o)) continue;
    for (const id of (await readdir(join(root(config), o)).catch(notThere)) ?? []) {
      if (SAFE.test(id)) out.push(`${o}/${id}`);
    }
  }
  return out;
}
