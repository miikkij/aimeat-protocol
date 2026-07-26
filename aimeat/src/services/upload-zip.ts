/**
 * @file upload-zip.ts
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
 */

import yauzl from 'yauzl';
import YAML from 'yaml';
import type { AimeatConfig } from '../config.js';
import type { ExtensionRecord, CortexExtensionRecord } from '../storage/interface.js';
import { parseCortexManifest } from './cortex-manifest.js';
import { isUnsafeName } from './safe-zip.js';
import { scanSandboxCapabilityWarnings } from '../routes/extensions/manifest.js';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MAX_FILES = 50;
const MAX_DEPTH = 5;
const DECOMPRESSION_RATIO = 10;

// ── Extension ZIP ──

interface ExtensionZipResult {
    ok: boolean;
    error?: string;
    record?: ExtensionRecord;
    /** Non-blocking sandbox-capability notes (crypto.subtle, Date.now, Math.random, eval). */
    warnings?: string[];
}

export async function parseExtensionZip(buffer: Buffer, config: AimeatConfig): Promise<ExtensionZipResult> {
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

    let manifest: Record<string, unknown>;
    try {
        manifest = YAML.parse(manifestBuf.toString('utf-8')) as Record<string, unknown>;
    } catch {
        return { ok: false, error: 'manifest.yaml is not valid YAML' };
    }

    const metadata = manifest.metadata as Record<string, unknown> | undefined;
    if (!metadata?.name || !metadata?.version || !metadata?.description || !metadata?.author) {
        return { ok: false, error: 'metadata.name, metadata.version, metadata.description, and metadata.author are required' };
    }

    const actions = manifest.actions as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(actions) || actions.length === 0) {
        return { ok: false, error: 'actions array is required and must not be empty' };
    }

    // Extract scripts from scripts/ directory
    const scripts: Record<string, string> = {};
    for (const [path, buf] of files) {
        if (path.startsWith('scripts/') && path.length > 'scripts/'.length) {
            const filename = path.slice('scripts/'.length);
            scripts[filename] = buf.toString('utf-8');
        }
    }

    for (const action of actions) {
        if (!action.id || !action.method || !action.path || !action.script) {
            return { ok: false, error: 'Each action must have id, method, path, and script fields' };
        }
        if (!scripts[action.script as string]) {
            return { ok: false, error: `Script "${action.script}" referenced in action "${action.id}" not found in scripts/ directory` };
        }
    }

    for (const [filename, content] of Object.entries(scripts)) {
        const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;
        if (sizeKb > config.extensionMaxCodeSizeKb) {
            return { ok: false, error: `Script "${filename}" (${Math.round(sizeKb)}KB) exceeds limit of ${config.extensionMaxCodeSizeKb}KB` };
        }
    }

    const name = metadata.name as string;
    const manifestConfig = manifest.config as Record<string, unknown> | undefined;
    const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
    const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
    const manifestSchedules = manifest.schedules as Array<Record<string, unknown>> | undefined;
    const manifestInstances = manifest.instances as Record<string, unknown> | undefined;

    const record: ExtensionRecord = {
        name,
        version: metadata.version as string,
        description: metadata.description as string,
        author: metadata.author as string,
        status: 'inactive',
        requiredApis: (manifest.required_apis as string[]) ?? [],
        actions: actions.map(a => ({
            id: a.id as string,
            method: (a.method as string).toUpperCase(),
            path: a.path as string,
            inputSchema: (a.input as Record<string, unknown>) ?? {},
            outputSchema: (a.output as Record<string, unknown>) ?? {},
            scriptContent: scripts[a.script as string],
        })),
        config: {
            ...(manifestConfig
                ? Object.fromEntries(
                    Object.entries(manifestConfig).map(([k, v]) => {
                        if (v && typeof v === 'object' && 'default' in (v as Record<string, unknown>)) {
                            return [k, (v as Record<string, unknown>).default];
                        }
                        return [k, v];
                    }),
                )
                : {}),
            ...(manifestSchedules ? { __schedules: manifestSchedules } : {}),
        },
        limits: {
            memoryMb: Math.min(
                (manifestLimits?.memory_mb as number) ?? config.extensionMaxMemoryMb,
                config.extensionMaxMemoryMb,
            ),
            timeoutMs: Math.min(
                (manifestLimits?.timeout_ms as number) ?? config.extensionTimeoutMs,
                config.extensionTimeoutMs,
            ),
            maxApiCalls: Math.min(
                (manifestLimits?.max_api_calls as number) ?? config.extensionMaxApiCalls,
                config.extensionMaxApiCalls,
            ),
        },
        federation: {
            advertise: (manifestFederation?.advertise as boolean) ?? false,
            capabilities: (manifestFederation?.capabilities as string[]) ?? [],
        },
        ...(manifestInstances?.supported ? {
            instances: {
                supported: true,
                configSchema: (manifestInstances.config_per_instance as Record<string, unknown>) ?? undefined,
            },
        } : {}),
        installedBy: 'upload',
        installedAt: new Date().toISOString(),
    };

    // Same sandbox-capability scan the inline install path runs, so a ZIP upload is not a way
    // to skip the warning.
    const warnings = scanSandboxCapabilityWarnings(scripts);
    return warnings.length ? { ok: true, record, warnings } : { ok: true, record };
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
