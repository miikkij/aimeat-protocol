/**
 * @file safe-zip.ts
 * @description Hardened ZIP extraction. Every untrusted ZIP entering the system MUST go through
 *   safeUnzip() rather than reading entries blindly: it enforces a file-count cap, a per-file and
 *   total decompressed-size cap, a compression-ratio cap (zip-bomb / "endless unpacking" defence),
 *   rejects path-traversal / absolute / backslash / null-byte names, and — when a format allowlist
 *   is given — rejects ANY entry whose name doesn't match the expected layout ("doesn't follow the
 *   format → reject"). On any violation it throws a typed ZipSecurityError so the caller can log a
 *   security incident + quarantine the file instead of processing it.
 *
 *   Note: callers must still never write entries to the filesystem using their names — this returns
 *   an in-memory name→bytes map; the workspace/organism import writes to storage under COMPUTED keys.
 * @structure ZipSecurityError; SafeZipLimits; safeUnzip(buffer, limits) -> Map<string, Buffer>
 * @usage import { safeUnzip, ZipSecurityError } from '../services/safe-zip.js';
 * @version-history
 *   v1.1.0 -- 2026-07-05 -- Reject symlink entries (unix mode check); export isUnsafeName +
 *     isSymlinkEntry so the hand-rolled extractors (upload-zip, package-zip) share the guards.
 *   v1.0.0 -- 2026-06-09 -- Initial: hardened extractor with bomb + traversal + format guards.
 */
import yauzl from 'yauzl';
import { logger } from '../utils/logger.js';

export type ZipSecurityCode =
  | 'NOT_A_ZIP' | 'TOO_MANY_FILES' | 'FILE_TOO_LARGE' | 'TOTAL_TOO_LARGE'
  | 'RATIO_EXCEEDED' | 'PATH_TRAVERSAL' | 'SYMLINK' | 'BAD_FORMAT' | 'READ_ERROR';

export class ZipSecurityError extends Error {
  constructor(public readonly code: ZipSecurityCode, message: string, public readonly entry?: string) {
    super(message);
    this.name = 'ZipSecurityError';
  }
}

export interface SafeZipLimits {
  /** Max number of entries. */
  maxFiles: number;
  /** Max decompressed bytes for a single entry. */
  maxFileBytes: number;
  /** Max decompressed bytes across all entries. */
  maxTotalBytes: number;
  /** Max decompressed/compressed ratio (zip-bomb guard). */
  maxRatio: number;
  /** If given, every entry name MUST satisfy this — otherwise BAD_FORMAT. */
  allowName?: (name: string) => boolean;
}

/** Sensible defaults for workspace/organism backups (text + a few images). */
export const BACKUP_ZIP_LIMITS: SafeZipLimits = {
  maxFiles: 4000,
  maxFileBytes: 30 * 1024 * 1024,    // 30 MB per entry
  maxTotalBytes: 300 * 1024 * 1024,  // 300 MB total decompressed
  maxRatio: 200,                     // decompressed may be at most 200× the zip size
};

/** Whether a ZIP entry is a symlink (unix mode in the high 16 bits of externalFileAttributes). */
export function isSymlinkEntry(entry: { externalFileAttributes: number }): boolean {
  const unixMode = entry.externalFileAttributes >>> 16;
  return (unixMode & 0o170000) === 0o120000;
}

/** A name is hostile if it escapes its root, is absolute, uses backslashes, or contains a null byte. */
export function isUnsafeName(name: string): boolean {
  if (name.includes('\0') || name.includes('\\')) return true;
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return true;          // absolute / drive-letter
  const parts = name.split('/');
  return parts.some(p => p === '..') || name.includes('../') || name.startsWith('../');
}

/**
 * Safely read a ZIP into a name → Buffer map, enforcing the limits + (optional) format allowlist.
 * Throws ZipSecurityError on the FIRST violation — the file is then hostile/malformed and must not
 * be processed.
 */
export function safeUnzip(buffer: Buffer, limits: SafeZipLimits): Promise<Map<string, Buffer>> {
  const zipSize = buffer.length;
  const maxDecompressed = Math.min(limits.maxTotalBytes, zipSize * limits.maxRatio);

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) { reject(new ZipSecurityError('NOT_A_ZIP', 'Not a valid ZIP archive')); return; }
      const files = new Map<string, Buffer>();
      let fileCount = 0;
      let total = 0;
      let settled = false;
      const fail = (e: ZipSecurityError) => { if (!settled) { settled = true; try { zipfile.close(); } catch (err) { logger.warn('fail: noop', { error: String(err) }); } reject(e); } };

      zipfile.on('error', () => fail(new ZipSecurityError('READ_ERROR', 'Corrupt ZIP')));
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (settled) return;
        const name = entry.fileName;
        if (/\/$/.test(name)) { zipfile.readEntry(); return; }   // directory entry — skip
        if (++fileCount > limits.maxFiles) { fail(new ZipSecurityError('TOO_MANY_FILES', `Archive has more than ${limits.maxFiles} files`)); return; }
        if (isUnsafeName(name)) { fail(new ZipSecurityError('PATH_TRAVERSAL', `Unsafe entry name: ${name}`, name)); return; }
        if (isSymlinkEntry(entry)) { fail(new ZipSecurityError('SYMLINK', `Symlink entries are not allowed: ${name}`, name)); return; }
        if (limits.allowName && !limits.allowName(name)) { fail(new ZipSecurityError('BAD_FORMAT', `Unexpected entry for this format: ${name}`, name)); return; }
        if (entry.uncompressedSize > limits.maxFileBytes) { fail(new ZipSecurityError('FILE_TOO_LARGE', `Entry ${name} exceeds the per-file size cap`, name)); return; }

        zipfile.openReadStream(entry, (e, stream) => {
          if (e || !stream) { fail(new ZipSecurityError('READ_ERROR', 'Could not read an entry')); return; }
          const chunks: Buffer[] = [];
          let entryBytes = 0;
          stream.on('data', (c: Buffer) => {
            entryBytes += c.length;
            total += c.length;
            if (entryBytes > limits.maxFileBytes) { stream.destroy(); fail(new ZipSecurityError('FILE_TOO_LARGE', `Entry ${name} exceeds the per-file size cap`, name)); return; }
            if (total > maxDecompressed) { stream.destroy(); fail(new ZipSecurityError(total > limits.maxTotalBytes ? 'TOTAL_TOO_LARGE' : 'RATIO_EXCEEDED', 'Decompressed size / ratio exceeded (possible zip bomb)', name)); return; }
            chunks.push(c);
          });
          stream.on('error', () => fail(new ZipSecurityError('READ_ERROR', 'Stream error while reading an entry')));
          stream.on('end', () => { if (settled) return; files.set(name, Buffer.concat(chunks)); zipfile.readEntry(); });
        });
      });
      zipfile.on('end', () => { if (!settled) { settled = true; resolve(files); } });
      zipfile.readEntry();
    });
  });
}
