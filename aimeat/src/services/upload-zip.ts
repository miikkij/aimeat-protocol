/**
 * @file upload-zip.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ZIP parsing for extension and cortex uploads via presigned URL.
 *   Validates ZIP structure, extracts manifest + scripts/libs, applies security checks
 *   (magic bytes, zip bomb detection, path traversal prevention).
 * @structure
 *   - parseExtensionZip() — ZIP buffer -> ExtensionRecord
 *   - parseCortexZip() — ZIP buffer -> CortexExtensionRecord + libs
 *   - extractZipEntries() — internal secure ZIP extraction
 * @usage
 *   import { parseExtensionZip, parseCortexZip } from '../services/upload-zip.js';
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 *   v1.1.0 — 2026-07-05 — Adopt the shared isUnsafeName guard from safe-zip (adds backslash /
 *     drive-letter / null-byte rejection on top of ../ and absolute paths).
 *   v1.3.0 — 2026-08-23 — parseExtensionZip takes the installer instead of passing the literal
 *     'upload' to the shared builder. config.app compares the app's owner against the installer,
 *     so every extension that gates an app was refused on the presigned path, which is the path
 *     an author is told to use. parseCortexZip below has taken an ownerName from the start.
 *   v1.2.0 — 2026-07-26 — parseExtensionZip delegates validation + record building to the shared
 *     buildExtensionRecordFromManifest (routes/extensions/manifest.ts) instead of keeping a thinner
 *     third copy. The copy had drifted: per-action pricing (tollMorsels / commercial / ODPS), the
 *     pricing validator, instances validation and the `type: secret` config marker were all missing,
 *     so a priced EXCHANGE capability became free just by being installed as a ZIP.
 */

import yauzl from 'yauzl';
import type { AimeatConfig } from '../config.js';
import type { ExtensionRecord, CortexExtensionRecord } from '../storage/interface.js';
import { parseCortexManifest } from './cortex-manifest.js';
import { isUnsafeName } from './safe-zip.js';
import { buildExtensionRecordFromManifest } from '../routes/extensions/manifest.js';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MAX_FILES = 50;
const MAX_DEPTH = 5;
const DECOMPRESSION_RATIO = 10;

// ── Extension ZIP ──

interface ExtensionZipResult {
    ok: boolean;
    error?: string;
    /** Machine-readable reason from the shared manifest builder (INVALID_MANIFEST, MISSING_SCRIPT, …). */
    code?: string;
    record?: ExtensionRecord;
    /** Non-blocking sandbox-capability notes (crypto.subtle, Date.now, Math.random, eval). */
    warnings?: string[];
}

/**
 * @param installedBy The principal the presigned token was minted for: a bare owner name or a full
 *   GAII. REQUIRED and never defaulted. This used to be the literal string `upload`, which the
 *   route then overwrote on the record it got back, so the placeholder was invisible everywhere
 *   except the one gate that reads the installer while the record is still being built.
 */
export async function parseExtensionZip(
    buffer: Buffer, config: AimeatConfig, installedBy: string,
): Promise<ExtensionZipResult> {
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
        return { ok: false, error: 'Not a valid ZIP file (missing magic bytes)' };
    }

    const maxBytes = config.extensionMaxCodeSizeKb * 1024 * MAX_FILES;
    if (buffer.length > maxBytes) {
        return { ok: false, error: `ZIP exceeds maximum size of ${Math.round(maxBytes / 1024)}KB` };
    }

    let files: Map<string, Buffer>;
    try {
        files = await extractZipEntries(buffer);
    } catch (err) {
        return { ok: false, error: `ZIP extraction failed: ${(err as Error).message}` };
    }

    const manifestBuf = files.get('manifest.yaml');
    if (!manifestBuf) {
        return { ok: false, error: 'ZIP must contain manifest.yaml at root' };
    }

    // Extract scripts from scripts/ directory
    const scripts: Record<string, string> = {};
    for (const [path, buf] of files) {
        if (path.startsWith('scripts/') && path.length > 'scripts/'.length) {
            const filename = path.slice('scripts/'.length);
            scripts[filename] = buf.toString('utf-8');
        }
    }

    // Validation + record building is the SHARED builder the REST and MCP paths use. This function
    // used to carry its own thinner copy, and the copies drifted: the ZIP path silently dropped
    // per-action pricing (tollMorsels / commercial / ODPS), skipped validateActionPricing and
    // skipped the `type: secret` config marker, so an extension published as a priced EXCHANGE
    // provider became a free one purely by being installed as a ZIP. Only ZIP-shaped concerns
    // (magic bytes, entry extraction, the scripts/ layout) belong here.
    const built = buildExtensionRecordFromManifest(
        manifestBuf.toString('utf-8'), scripts, config, installedBy, new Date().toISOString(),
    );
    if (!built.ok) {
        return { ok: false, error: built.message, code: built.code };
    }

    return built.warnings?.length
        ? { ok: true, record: built.record, warnings: built.warnings }
        : { ok: true, record: built.record };
}

// ── Cortex ZIP ──

interface CortexZipResult {
    ok: boolean;
    error?: string;
    extension?: CortexExtensionRecord;
    libs?: Record<string, string>;
}

export async function parseCortexZip(
    buffer: Buffer, config: AimeatConfig, ownerName: string,
): Promise<CortexZipResult> {
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
        return { ok: false, error: 'Not a valid ZIP file (missing magic bytes)' };
    }

    const maxBytes = config.cortexMaxLibSizeKb * 1024 * MAX_FILES;
    if (buffer.length > maxBytes) {
        return { ok: false, error: 'ZIP exceeds maximum size' };
    }

    let files: Map<string, Buffer>;
    try {
        files = await extractZipEntries(buffer);
    } catch (err) {
        return { ok: false, error: `ZIP extraction failed: ${(err as Error).message}` };
    }

    const manifestBuf = files.get('manifest.yaml');
    if (!manifestBuf) {
        return { ok: false, error: 'ZIP must contain manifest.yaml at root' };
    }

    const manifestStr = manifestBuf.toString('utf-8');

    const manifestSizeKb = Buffer.byteLength(manifestStr, 'utf-8') / 1024;
    if (manifestSizeKb > config.cortexMaxLibSizeKb) {
        return { ok: false, error: `Manifest size ${Math.round(manifestSizeKb)}KB exceeds limit of ${config.cortexMaxLibSizeKb}KB` };
    }

    // Extract libs from libs/ directory
    const libs: Record<string, string> = {};
    for (const [path, buf] of files) {
        if (path.startsWith('libs/') && path.length > 'libs/'.length) {
            const filename = path.slice('libs/'.length);
            const content = buf.toString('utf-8');
            const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;
            if (sizeKb > config.cortexMaxLibSizeKb) {
                return { ok: false, error: `Lib "${filename}" is ${sizeKb.toFixed(1)}KB, max is ${config.cortexMaxLibSizeKb}KB` };
            }
            libs[filename] = content;
        }
    }

    const result = parseCortexManifest(manifestStr, ownerName, Object.keys(libs).length > 0 ? libs : undefined);

    if (!result.ok || !result.extension) {
        return { ok: false, error: result.errors?.join('; ') ?? 'Manifest validation failed' };
    }

    return { ok: true, extension: result.extension, libs: Object.keys(libs).length > 0 ? libs : undefined };
}

// ── Internal ZIP extraction ──

function extractZipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);

            const files = new Map<string, Buffer>();
            let totalDecompressed = 0;
            const maxDecompressed = buffer.length * DECOMPRESSION_RATIO;
            let fileCount = 0;

            zipfile!.on('error', reject);

            zipfile!.on('entry', (entry: yauzl.Entry) => {
                fileCount++;
                if (fileCount > MAX_FILES) {
                    zipfile!.close();
                    return reject(new Error(`ZIP contains more than ${MAX_FILES} files`));
                }

                const fileName: string = entry.fileName;

                if (isUnsafeName(fileName)) {
                    zipfile!.close();
                    return reject(new Error(`Dangerous path detected: ${fileName}`));
                }

                // Symlink check (Unix external attributes)
                const unixMode = (entry.externalFileAttributes >> 16) & 0xffff;
                if ((unixMode & 0o170000) === 0o120000) {
                    zipfile!.close();
                    return reject(new Error(`Symlink detected: ${fileName}`));
                }

                const depth = fileName.split('/').length - 1;
                if (depth > MAX_DEPTH) {
                    zipfile!.close();
                    return reject(new Error(`Directory depth exceeds ${MAX_DEPTH}: ${fileName}`));
                }

                if (fileName.endsWith('/')) {
                    zipfile!.readEntry();
                    return;
                }

                zipfile!.openReadStream(entry, (readErr, stream) => {
                    if (readErr) { zipfile!.close(); return reject(readErr); }
                    const chunks: Buffer[] = [];
                    stream!.on('data', (chunk: Buffer) => {
                        totalDecompressed += chunk.length;
                        if (totalDecompressed > maxDecompressed) {
                            zipfile!.close();
                            return reject(new Error('Decompression ratio exceeded (possible zip bomb)'));
                        }
                        chunks.push(chunk);
                    });
                    stream!.on('end', () => {
                        files.set(fileName, Buffer.concat(chunks));
                        zipfile!.readEntry();
                    });
                    stream!.on('error', (e) => { zipfile!.close(); reject(e); });
                });
            });

            zipfile!.on('end', () => resolve(files));
            zipfile!.readEntry();
        });
    });
}
