/**
 * @file src/services/owner-export/build.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes one data export job as ZIP volumes (zip-volumes.ts) in its folder: README.txt,
 *   account.json (every section of account-sections.ts but the two large lists), then the parts the
 *   person chose: memory records and AI provenance records as NDJSON files of at most 64 MB, the code
 *   of every app version, and the contents of the files, each read a slice at a time from where it is
 *   kept (the database or a store). manifest.json is last: what each part holds and how many volumes.
 *
 *   NOTHING IS HELD WHOLE. A list is read in pages and written as it is read, a file in 8 MB slices, so
 *   the process holds at most one NDJSON file's 64 MB and one slice at a time, whatever the account.
 *
 *   IT STOPS when the person cancels (the signal, asked between entries and pages), and when the disk
 *   the folder is on has less than 512 MB free, so an export never fills the disk the node runs on.
 * @structure buildExport(deps, job, signal, onProgress) → ExportVolume[]
 * @usage const volumes = await buildExport(deps, job, controller.signal, p => ...);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import { statfs } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { readerFor } from '../classification/reader.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { ownerExportSections, ownerMemoryPages, memoryPages, provenancePages } from './account-sections.js';
import { sectionsAsJsonObject, ndjsonPieces } from './json-stream.js';
import { VolumeWriter, type ExportVolume } from './zip-volumes.js';
import { fileBelongsToPart, PART_WHAT, type ExportPartId } from './parts.js';
import type { ExportJob } from './job-store.js';
import { exportFolderPath } from './folders.js';

export interface BuildDeps { storage: Storage; config: AimeatConfig }

/** An NDJSON file of a list is closed at this size, and the next lines go to the next file. */
const NDJSON_FILE_BYTES = 64 * 1024 * 1024;
/** One read of a stored file. */
const FILE_SLICE = 8 * 1024 * 1024;
/** The export stops when the disk under its folder has less than this free. */
const DISK_RESERVE = 512 * 1024 * 1024;

export class ExportStopped extends Error {
  constructor(readonly reason: 'cancelled' | 'disk_full', message: string) { super(message); }
}

/** An agent's GAII as a folder name: its local name before `#`, made safe. */
function agentLabel(gaii: string): string {
  return gaii.split('#')[0].replace(/[^A-Za-z0-9._-]/g, '_') || 'agent';
}

/** A stored key or a file name as a path inside the ZIP: no leading slash, no `..`, no control characters. */
function safePath(key: string): string {
  const clean = (s: string): string => [...s].map(ch => (ch.charCodeAt(0) < 0x20 || '\\:*?"<>|'.includes(ch) ? '_' : ch)).join('');
  return key.split('/').filter(s => s && s !== '.' && s !== '..').map(clean).join('/') || '_';
}

/** Pieces of text as Buffers of about 64 kB, for a ZIP entry read as a stream. */
async function* asBuffers(pieces: AsyncIterable<string>): AsyncGenerator<Buffer> {
  let buf = '';
  for await (const p of pieces) {
    buf += p;
    if (buf.length >= 65_536) { yield Buffer.from(buf, 'utf8'); buf = ''; }
  }
  if (buf) yield Buffer.from(buf, 'utf8');
}

type Written = Partial<Record<ExportPartId | 'account', number>>;

/** Write the job's ZIP volumes; on any failure the open volume is aborted and the error passes on. */
export async function buildExport(
  deps: BuildDeps, job: ExportJob, signal: AbortSignal,
  onProgress: (part: string, bytes: number) => void,
): Promise<{ volumes: ExportVolume[]; written: Written }> {
  const dir = exportFolderPath(deps.config, job.folder);
  const writer = new VolumeWriter(dir, `aimeat-export-${job.owner}-${job.requested_at.slice(0, 10)}`, deps.config.exportVolumeMb * 1024 * 1024);
  try {
    return await writeParts(deps, job, signal, onProgress, dir, writer);
  } catch (err) {
    writer.abort();
    throw err;
  }
}

async function writeParts(
  deps: BuildDeps, job: ExportJob, signal: AbortSignal,
  onProgress: (part: string, bytes: number) => void, dir: string, writer: VolumeWriter,
): Promise<{ volumes: ExportVolume[]; written: Written }> {
  const { storage, config } = deps;
  const chosen = new Set(job.parts);
  const written: Written = {};
  const check = async (): Promise<void> => {
    if (signal.aborted) throw new ExportStopped('cancelled', 'The export was cancelled.');
    const fs = await statfs(dir);
    if (fs.bavail * fs.bsize < DISK_RESERVE) {
      throw new ExportStopped('disk_full', 'The node\'s disk is almost full, so the export stopped. Ask the operator, or choose fewer parts.');
    }
  };
  const counted = (part: ExportPartId | 'account', n = 1): void => { written[part] = (written[part] ?? 0) + n; };
  const progress = (part: string): void => { onProgress(part, writer.total()); };

  // The person reads their own export: the classification reader of the account holder in person.
  const reader = readerFor({ storage, config }, { sub: job.owner, owner: job.owner, roles: ['owner'], scopes: [] });
  const owner = await storage.getOwner(job.owner);
  if (!owner) throw new Error(`The account ${job.owner} is gone.`);

  /** One list as NDJSON files `<base>-0001.ndjson`…, each closed at NDJSON_FILE_BYTES. */
  const addNdjson = async (base: string, part: ExportPartId, items: AsyncIterable<unknown>): Promise<void> => {
    let n = 0;
    let lines: string[] = [];
    let size = 0;
    const flush = async (): Promise<void> => {
      if (!lines.length) return;
      await check();
      n += 1;
      await writer.add(`${base}-${String(n).padStart(4, '0')}.ndjson`, Buffer.from(lines.join(''), 'utf8'));
      lines = [];
      size = 0;
      progress(part);
    };
    for await (const line of ndjsonPieces(items)) {
      lines.push(line);
      size += line.length;
      counted(part);
      if (size >= NDJSON_FILE_BYTES) await flush();
    }
    await flush();
  };

  await writer.add('README.txt', [
    `AIMEAT data export of the account ${job.owner}, asked for on ${job.requested_at}.`,
    '',
    'account.json holds the account itself:',
    `  ${PART_WHAT.account}`,
    'The parts chosen for this export:',
    ...job.parts.map(p => `  ${p}: ${PART_WHAT[p]}`),
    '',
    'A large export is several ZIP files; each opens by itself. manifest.json, in the last one, says',
    'what each part holds. An .ndjson file has one JSON record per line.',
    'Organism content may be classified: keep these files as carefully as the organism asks.',
    '',
  ].join('\n'));

  // ── account.json: every section but the memory and provenance lists ──
  await check();
  progress('account');
  await writer.add('account.json', Readable.from(asBuffers(sectionsAsJsonObject(
    ownerExportSections(deps, { name: job.owner, owner, reader, memories: false, provenance: false })))));
  counted('account');

  const organismKeys: string[] = [];
  const organismKey = (k: string): void => { organismKeys.push(k); };
  const agents = await loadOwnerAgents(storage, job.owner);

  if (chosen.has('memories')) {
    progress('memories');
    await addNdjson('memories/you', 'memories', ownerMemoryPages(storage, reader, job.ghii, organismKey));
    for (const a of agents) {
      await addNdjson(`memories/agents/${agentLabel(a.gaii)}`, 'memories', memoryPages(storage, reader, a.gaii, organismKey));
    }
  }

  if (chosen.has('ai_provenance')) {
    progress('ai_provenance');
    await addNdjson('ai-provenance/records', 'ai_provenance', provenancePages(storage, job.ghii));
  }

  const principals = [{ gaii: job.ghii, label: 'you' }, ...agents.map(a => ({ gaii: a.gaii, label: `agents/${agentLabel(a.gaii)}` }))];

  if (chosen.has('app_code')) {
    progress('app_code');
    for (const p of principals) {
      const { apps } = await storage.listApps({ ownerGaii: p.gaii, limit: 100_000 });
      for (const app of apps) {
        for (const v of await storage.listAppVersionSizes(app.ownerGaii, app.filename)) {
          await check();
          const rec = await storage.getApp(app.ownerGaii, app.filename, v.versionNumber);
          if (!rec?.data) continue;
          const data = Buffer.isBuffer(rec.data) ? rec.data : Buffer.from(rec.data);
          await writer.add(`apps/${p.label}/${safePath(app.filename)}/v${v.versionNumber}/${safePath(app.filename)}`, data, { size: data.length, mimeType: rec.mimeType });
          counted('app_code');
          progress('app_code');
        }
      }
    }
  }

  if (chosen.has('files') || chosen.has('files_own_store')) {
    const lists = await storage.listStorageFilesForOwners(principals.map(p => p.gaii));
    for (const p of principals) {
      for (const f of lists[p.gaii] ?? []) {
        const part = fileBelongsToPart(f);
        if (!chosen.has(part)) continue;
        await check();
        progress(part);
        const slices = async function* (): AsyncGenerator<Buffer> {
          for (let start = 0; start < f.size; start += FILE_SLICE) {
            if (signal.aborted) throw new ExportStopped('cancelled', 'The export was cancelled.');
            const b = await storage.readStorageFileRange(p.gaii, f.key, start, Math.min(FILE_SLICE, f.size - start));
            if (!b) throw new Error(`The file ${f.key} disappeared while it was being exported.`);
            yield b;
          }
        };
        await writer.add(`files/${p.label}/${safePath(f.key)}`, Readable.from(slices()), { size: f.size, mimeType: f.mimeType });
        counted(part);
      }
    }
  }

  if (organismKeys.length) {
    await writer.add('classified_organism_content.json', JSON.stringify({
      count: organismKeys.length, keys: organismKeys,
      note: 'This export includes records of organisms you belong to that you or your agents hold, whatever their classification, because they are your own data. Organism content may be classified: keep the file as carefully as the organism asks.',
    }));
  }

  await writer.add('manifest.json', JSON.stringify({
    format: 'aimeat.owner-export/v1', account: job.owner, job: job.id, asked_at: job.requested_at,
    written_at: new Date().toISOString(), parts: job.parts, written,
    what: Object.fromEntries((['account', ...job.parts] as const).map(p => [p, PART_WHAT[p]])),
  }));
  return { volumes: await writer.finish(), written };
}
