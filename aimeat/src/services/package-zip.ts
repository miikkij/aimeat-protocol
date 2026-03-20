/**
 * @file package-zip.ts
 * @description ZIP serialization/deserialization service for AIMEAT packages.
 *   Converts PackageRecord objects to ZIP buffers (buildZip) and validates/extracts
 *   ZIP buffers back into ParsedPackage objects (parseZip) with a multi-layer
 *   security validation chain (magic bytes, size limits, zip bomb detection,
 *   path traversal prevention, manifest validation).
 * @structure
 *   - ZipValidationError — typed error class with code field
 *   - ZipOptions — configuration for parseZip limits
 *   - ParsedComponent / ParsedPackage — output types from parseZip
 *   - buildZip(pkg) — PackageRecord → ZIP Buffer
 *   - parseZip(buffer, options) — ZIP Buffer → ParsedPackage (with validation)
 * @version-history
 *   v1.0.0 — 2026-03-20 — Initial implementation
 */

import { createHash } from 'node:crypto';
import archiver from 'archiver';
import yauzl from 'yauzl';
import YAML from 'yaml';
import type { PackageRecord, PackageComponentType } from '../storage/interface.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZipErrorCode =
  | 'INVALID_FORMAT'
  | 'SIZE_EXCEEDED'
  | 'DECOMPRESSION_BOMB'
  | 'PATH_TRAVERSAL'
  | 'MISSING_MANIFEST'
  | 'INVALID_MANIFEST'
  | 'MISSING_COMPONENT';

export class ZipValidationError extends Error {
  public readonly code: ZipErrorCode;
  constructor(code: ZipErrorCode, message: string) {
    super(message);
    this.name = 'ZipValidationError';
    this.code = code;
  }
}

export interface ZipOptions {
  maxSizeMb: number;
  maxFiles?: number;           // default 200
  maxDepth?: number;           // default 5
  maxFileSizeMb?: number;      // default 20
  decompressionRatio?: number; // default 10
}

export interface ParsedComponent {
  id: string;
  type: string;
  label: string;
  content: string;
  contentHash: string;
  dependencies: string[];
}

export interface ParsedPackage {
  name: string;
  author: string;
  authorGhii?: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  blueprint?: Record<string, unknown>;
  changelog?: string;
  components: ParsedComponent[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPONENT_EXTENSIONS: Record<PackageComponentType, string> = {
  csm: '.yaml',
  extension: '.yaml',
  cortex: '.yaml',
  app: '.html',
  msm: '.yaml',
  memory: '.json',
  translation: '.json',
};

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// ---------------------------------------------------------------------------
// buildZip
// ---------------------------------------------------------------------------

/**
 * Convert a PackageRecord into a ZIP buffer containing manifest.yaml
 * and all component files under components/.
 */
export async function buildZip(pkg: PackageRecord): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Build manifest object
    const manifest: Record<string, unknown> = {
      'aimeat-package': '1.0',
      name: pkg.name,
      author: pkg.author,
      authorGhii: pkg.authorGhii,
      version: pkg.version,
      description: pkg.description,
      category: pkg.category,
      tags: pkg.tags,
      components: pkg.components.map(c => ({
        id: c.id,
        type: c.type,
        label: c.label,
        file: `components/${c.id}${COMPONENT_EXTENSIONS[c.type]}`,
        dependencies: c.dependencies,
      })),
      changelog: pkg.changelog,
    };

    // Append manifest.yaml
    archive.append(YAML.stringify(manifest), { name: 'manifest.yaml' });

    // Append each component file
    for (const comp of pkg.components) {
      const ext = COMPONENT_EXTENSIONS[comp.type];
      archive.append(comp.content, { name: `components/${comp.id}${ext}` });
    }

    archive.finalize();
  });
}

// ---------------------------------------------------------------------------
// parseZip — internal helpers
// ---------------------------------------------------------------------------

/** Read all entries from a yauzl zipfile into a map of filename → Buffer. */
function readAllEntries(
  zipfile: yauzl.ZipFile,
  opts: Required<Pick<ZipOptions, 'maxFiles' | 'maxDepth' | 'maxFileSizeMb' | 'decompressionRatio'>>,
  zipSize: number,
): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const files = new Map<string, Buffer>();
    let totalDecompressed = 0;
    const maxDecompressed = zipSize * opts.decompressionRatio;
    let fileCount = 0;

    zipfile.on('error', reject);

    zipfile.on('entry', (entry: yauzl.Entry) => {
      fileCount++;

      // Max files
      if (fileCount > opts.maxFiles) {
        zipfile.close();
        return reject(new ZipValidationError('DECOMPRESSION_BOMB', `ZIP contains more than ${opts.maxFiles} files`));
      }

      const fileName: string = entry.fileName;

      // Path traversal checks
      if (fileName.includes('../') || fileName.startsWith('/')) {
        zipfile.close();
        return reject(new ZipValidationError('PATH_TRAVERSAL', `Dangerous path detected: ${fileName}`));
      }

      // Symlink check (Unix external attributes, upper 16 bits)
      const externalAttrs = entry.externalFileAttributes;
      const unixMode = (externalAttrs >> 16) & 0xffff;
      if ((unixMode & 0o170000) === 0o120000) {
        zipfile.close();
        return reject(new ZipValidationError('PATH_TRAVERSAL', `Symlink detected: ${fileName}`));
      }

      // Directory depth
      const depth = fileName.split('/').length - 1;
      if (depth > opts.maxDepth) {
        zipfile.close();
        return reject(new ZipValidationError('DECOMPRESSION_BOMB', `Directory depth exceeds ${opts.maxDepth}: ${fileName}`));
      }

      // Skip directories
      if (fileName.endsWith('/')) {
        zipfile.readEntry();
        return;
      }

      // Individual file size check (uncompressed)
      const maxFileBytes = opts.maxFileSizeMb * 1024 * 1024;
      if (entry.uncompressedSize > maxFileBytes) {
        zipfile.close();
        return reject(new ZipValidationError('DECOMPRESSION_BOMB', `File ${fileName} exceeds ${opts.maxFileSizeMb} MB`));
      }

      zipfile.openReadStream(entry, (err, stream) => {
        if (err) { zipfile.close(); return reject(err); }
        const chunks: Buffer[] = [];
        stream!.on('data', (chunk: Buffer) => {
          totalDecompressed += chunk.length;
          if (totalDecompressed > maxDecompressed) {
            zipfile.close();
            return reject(new ZipValidationError('DECOMPRESSION_BOMB', 'Decompression ratio exceeded'));
          }
          chunks.push(chunk);
        });
        stream!.on('end', () => {
          files.set(fileName, Buffer.concat(chunks));
          zipfile.readEntry();
        });
        stream!.on('error', (e) => { zipfile.close(); reject(e); });
      });
    });

    zipfile.on('end', () => resolve(files));
    zipfile.readEntry();
  });
}

/** Open a buffer with yauzl (promisified). */
function openZipBuffer(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      resolve(zipfile!);
    });
  });
}

// ---------------------------------------------------------------------------
// parseZip
// ---------------------------------------------------------------------------

/**
 * Validate and extract a ZIP buffer into a ParsedPackage.
 * Applies a multi-layer security validation chain in order.
 */
export async function parseZip(buffer: Buffer, options: ZipOptions): Promise<ParsedPackage> {
  // 1. Magic bytes
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    throw new ZipValidationError('INVALID_FORMAT', 'Buffer does not start with ZIP magic bytes (PK\\x03\\x04)');
  }

  // 2. ZIP size
  const maxBytes = options.maxSizeMb * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new ZipValidationError('SIZE_EXCEEDED', `ZIP size ${buffer.length} exceeds limit of ${maxBytes} bytes`);
  }

  // 3. Open and read entries with bomb protection + path traversal checks
  const opts = {
    maxFiles: options.maxFiles ?? 200,
    maxDepth: options.maxDepth ?? 5,
    maxFileSizeMb: options.maxFileSizeMb ?? 20,
    decompressionRatio: options.decompressionRatio ?? 10,
  };

  let zipfile: yauzl.ZipFile;
  try {
    zipfile = await openZipBuffer(buffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('relative path') || msg.includes('absolute path')) {
      throw new ZipValidationError('PATH_TRAVERSAL', msg);
    }
    throw new ZipValidationError('INVALID_FORMAT', `Failed to open ZIP: ${msg}`);
  }

  let files: Map<string, Buffer>;
  try {
    files = await readAllEntries(zipfile, opts, buffer.length);
  } catch (err: unknown) {
    if (err instanceof ZipValidationError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('relative path') || msg.includes('absolute path')) {
      throw new ZipValidationError('PATH_TRAVERSAL', msg);
    }
    throw err;
  }

  // 5. Manifest presence
  const manifestBuf = files.get('manifest.yaml');
  if (!manifestBuf) {
    throw new ZipValidationError('MISSING_MANIFEST', 'ZIP does not contain manifest.yaml at root');
  }

  // 6. Manifest validation
  let manifest: Record<string, unknown>;
  try {
    manifest = YAML.parse(manifestBuf.toString('utf-8')) as Record<string, unknown>;
  } catch {
    throw new ZipValidationError('INVALID_MANIFEST', 'manifest.yaml is not valid YAML');
  }

  const requiredFields = ['name', 'author', 'version', 'description', 'category'];
  for (const field of requiredFields) {
    if (!manifest[field]) {
      throw new ZipValidationError('INVALID_MANIFEST', `manifest.yaml missing required field: ${field}`);
    }
  }

  // 7. Component files exist + 8. Compute contentHash
  const manifestComponents = (manifest.components ?? []) as Array<{
    id: string;
    type: string;
    label: string;
    file: string;
    dependencies?: string[];
  }>;

  const components: ParsedComponent[] = [];
  for (const mc of manifestComponents) {
    const fileBuf = files.get(mc.file);
    if (!fileBuf) {
      throw new ZipValidationError('MISSING_COMPONENT', `Component file not found in ZIP: ${mc.file}`);
    }
    const content = fileBuf.toString('utf-8');
    const contentHash = createHash('sha256').update(content).digest('hex');

    components.push({
      id: mc.id,
      type: mc.type,
      label: mc.label,
      content,
      contentHash,
      dependencies: mc.dependencies ?? [],
    });
  }

  return {
    name: manifest.name as string,
    author: manifest.author as string,
    authorGhii: manifest.authorGhii as string | undefined,
    version: manifest.version as string,
    description: manifest.description as string,
    category: manifest.category as string,
    tags: (manifest.tags as string[]) ?? [],
    blueprint: manifest.blueprint as Record<string, unknown> | undefined,
    changelog: manifest.changelog as string | undefined,
    components,
  };
}
