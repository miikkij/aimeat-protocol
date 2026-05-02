# Presigned Upload URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable MCP tools to transfer files directly from agent's filesystem to AIMEAT server via presigned URLs, bypassing the AI context window.

**Architecture:** A new upload token service generates short-lived, single-use JWTs encoding upload metadata. A single `PUT /v1/upload/:token` endpoint receives raw file bodies, validates the token, and delegates processing to existing storage/app/extension logic. Each MCP tool gains dual-mode: inline content (old path) or metadata-only (returns upload URL).

**Tech Stack:** jose (JWT), Express raw body parser, yauzl (ZIP parsing), existing package-zip.ts security utilities

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/services/upload-token.ts` | Token generation, verification, single-use tracking |
| `src/routes/upload.ts` | `PUT /v1/upload/:token` endpoint |
| `src/mcp/apps.ts` | Dual-mode app publish (inline or upload URL) |
| `src/mcp/core.ts` | Dual-mode storage upload (inline or upload URL) |
| `src/mcp/extensions.ts` | Dual-mode extension install (inline or upload URL) |
| `src/mcp/cortex.ts` | Dual-mode cortex install (inline or upload URL) |
| `src/server-bootstrap/routes-loader.ts` | Mount upload router |
| `test/upload-token.ts` | E2E tests for the upload flow |

---

### Task 1: Upload Token Service

**Files:**
- Create: `aimeat/src/services/upload-token.ts`

- [ ] **Step 1: Write the upload token service**

```typescript
/**
 * @file upload-token.ts
 * @description Presigned upload token generation and verification. Tokens are single-use,
 *   time-limited JWTs that authorize a single file upload to PUT /v1/upload/:token.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

// Single-use tracking: hash -> expiry timestamp
const usedTokens = new Map<string, number>();

// Cleanup interval reference
let _cleanupInterval: ReturnType<typeof setInterval> | null = null;

export interface UploadTokenPayload {
  typ: 'upload';
  sub: string;          // Owner GHII or agent GAII
  utype: 'app' | 'storage' | 'extension' | 'cortex';
  meta: Record<string, unknown>;
  maxBytes: number;
  contentType: string;
}

export interface VerifiedUploadToken {
  sub: string;
  utype: 'app' | 'storage' | 'extension' | 'cortex';
  meta: Record<string, unknown>;
  maxBytes: number;
  contentType: string;
}

export function initUploadTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
  _privateKey = privateKey;
  _publicKey = publicKey;

  // Cleanup expired used-token entries every 5 minutes
  if (_cleanupInterval) clearInterval(_cleanupInterval);
  _cleanupInterval = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [hash, exp] of usedTokens) {
      if (exp < now) usedTokens.delete(hash);
    }
  }, 5 * 60 * 1000);
}

export async function generateUploadToken(payload: UploadTokenPayload, ttlSeconds: number = 3600): Promise<string> {
  if (!_privateKey) throw new Error('Upload token keys not initialized');

  return new SignJWT({
    typ: 'upload',
    utype: payload.utype,
    meta: payload.meta,
    maxBytes: payload.maxBytes,
    contentType: payload.contentType,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(_privateKey);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function verifyUploadToken(token: string): Promise<VerifiedUploadToken> {
  if (!_publicKey) throw new Error('Upload token keys not initialized');

  // Check single-use
  const hash = hashToken(token);
  if (usedTokens.has(hash)) {
    throw new UploadTokenError('TOKEN_USED', 'Upload token has already been used (single-use)');
  }

  let payload;
  try {
    const result = await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] });
    payload = result.payload;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('expired')) {
      throw new UploadTokenError('TOKEN_EXPIRED', 'Upload token has expired (60 min TTL)');
    }
    throw new UploadTokenError('TOKEN_INVALID', `Invalid upload token: ${msg}`);
  }

  if (payload.typ !== 'upload') {
    throw new UploadTokenError('TOKEN_INVALID', 'Token is not an upload token');
  }

  // Mark as used
  usedTokens.set(hash, payload.exp as number);

  return {
    sub: payload.sub as string,
    utype: payload.utype as VerifiedUploadToken['utype'],
    meta: payload.meta as Record<string, unknown>,
    maxBytes: payload.maxBytes as number,
    contentType: payload.contentType as string,
  };
}

export type UploadTokenErrorCode = 'TOKEN_EXPIRED' | 'TOKEN_USED' | 'TOKEN_INVALID';

export class UploadTokenError extends Error {
  public readonly code: UploadTokenErrorCode;
  constructor(code: UploadTokenErrorCode, message: string) {
    super(message);
    this.name = 'UploadTokenError';
    this.code = code;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors related to upload-token.ts)

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/upload-token.ts
git commit -m "feat(upload): add presigned upload token service"
```

---

### Task 2: Upload Endpoint

**Files:**
- Create: `aimeat/src/routes/upload.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Write the upload route handler**

```typescript
/**
 * @file upload.ts
 * @description Presigned upload endpoint. Receives raw file bodies at PUT /v1/upload/:token,
 *   validates the token, enforces size limits, and delegates processing based on upload type
 *   (app, storage, extension, cortex).
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import { Router, type Request, type Response } from 'express';
import { Buffer } from 'node:buffer';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest } from '../storage/interface.js';
import { verifyUploadToken, UploadTokenError } from '../services/upload-token.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { emitResourceListChanged } from '../mcp/index.js';
import { parseExtensionZip, parseCortexZip } from '../services/upload-zip.js';

export function uploadRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Raw body parser for upload endpoint only (no JSON parsing)
  router.put('/v1/upload/:token', async (req: Request, res: Response) => {
    const token = req.params.token as string;

    // Verify token
    let verified;
    try {
      verified = await verifyUploadToken(token);
    } catch (err) {
      if (err instanceof UploadTokenError) {
        res.status(err.code === 'TOKEN_EXPIRED' ? 410 : err.code === 'TOKEN_USED' ? 409 : 401)
          .json({ success: false, error: err.code, message: err.message });
        return;
      }
      res.status(401).json({ success: false, error: 'TOKEN_INVALID', message: 'Invalid upload token' });
      return;
    }

    // Collect raw body
    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
      totalSize += chunk.length;
      if (totalSize > verified.maxBytes) {
        res.status(413).json({
          success: false,
          error: 'FILE_TOO_LARGE',
          message: `Upload exceeds limit of ${verified.maxBytes} bytes`,
        });
        return;
      }
      chunks.push(chunk);
    }

    const data = Buffer.concat(chunks);

    if (data.length === 0) {
      res.status(400).json({ success: false, error: 'EMPTY_BODY', message: 'No file data received' });
      return;
    }

    try {
      switch (verified.utype) {
        case 'app':
          return await handleAppUpload(res, config, storage, verified.sub, verified.meta, data);
        case 'storage':
          return await handleStorageUpload(res, config, storage, verified.sub, verified.meta, data);
        case 'extension':
          return await handleExtensionUpload(res, config, storage, verified.sub, verified.meta, data);
        case 'cortex':
          return await handleCortexUpload(res, config, storage, verified.sub, verified.meta, data);
        default:
          res.status(400).json({ success: false, error: 'INVALID_TYPE', message: `Unknown upload type: ${verified.utype}` });
      }
    } catch (err) {
      logger.error('Upload processing failed', { error: (err as Error).message, type: verified.utype });
      res.status(500).json({ success: false, error: 'PROCESSING_FAILED', message: (err as Error).message });
    }
  });

  return router;
}

async function handleAppUpload(
  res: Response, config: AimeatConfig, storage: Storage,
  sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
  const parsed = parseGAII(sub);
  const ownerGaii = parsed ? `${parsed.owner}@${parsed.node}` : sub;
  const ownerName = parsed?.owner ?? sub;
  const filename = meta.filename as string;

  const existingVersion = await storage.getLatestVersionNumber(ownerGaii, filename);
  const newVersion = existingVersion + 1;
  const isUpdate = existingVersion > 0;

  const manifest: AppManifest = {
    name: meta.name as string,
    description: (meta.description as string) ?? '',
    version: (meta.version as string) ?? `1.0.${newVersion - 1}`,
    category: (meta.category as string) ?? 'tool',
    tags: (meta.tags as string[]) ?? [],
    authorDisplay: ownerName,
    usesCortex: [],
  };
  if (meta.icon) manifest.icon = meta.icon as string;

  await storage.createApp({
    ownerGaii,
    ownerName,
    filename,
    versionNumber: newVersion,
    manifest,
    mimeType: 'text/html',
    size: data.length,
    data,
    createdAt: new Date().toISOString(),
  });

  const downloadUrl = `/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}`;
  logger.info(`App ${isUpdate ? 'updated' : 'published'} via upload: ${filename} v${newVersion}`, { by: sub });
  emitResourceListChanged(sub);

  res.json({
    success: true,
    type: 'app',
    filename,
    version_number: newVersion,
    name: manifest.name,
    size: data.length,
    is_update: isUpdate,
    download_url: downloadUrl,
    inline_url: `${downloadUrl}?mode=inline`,
  });
}

async function handleStorageUpload(
  res: Response, _config: AimeatConfig, storage: Storage,
  sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
  const key = meta.key as string;
  const visibility = (meta.visibility as 'private' | 'owner' | 'public') ?? 'private';
  const mimeType = (meta.mime_type as string) ?? 'application/octet-stream';

  const file = await storage.createStorageFile({
    key,
    ownerGaii: sub,
    visibility,
    mimeType,
    size: data.length,
    data,
    createdAt: new Date().toISOString(),
  });

  emitResourceListChanged(sub);

  res.json({
    success: true,
    type: 'storage',
    key: file.key,
    size: file.size,
    mime_type: mimeType,
    visibility,
  });
}

async function handleExtensionUpload(
  res: Response, config: AimeatConfig, storage: Storage,
  sub: string, _meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
  const result = await parseExtensionZip(data, config);
  if (!result.ok) {
    res.status(400).json({ success: false, error: 'VALIDATION_FAILED', message: result.error });
    return;
  }

  const record = result.record!;
  record.installedBy = parseGAII(sub)?.owner ?? 'upload';
  record.installedAt = new Date().toISOString();

  const existing = await storage.getExtension(record.name);
  if (existing) {
    res.status(409).json({ success: false, error: 'ALREADY_EXISTS', message: `Extension "${record.name}" is already installed` });
    return;
  }

  const created = await storage.createExtension(record);
  logger.info(`Extension installed via upload: ${created.name}`, { version: created.version, by: sub });
  emitResourceListChanged(sub);

  res.json({
    success: true,
    type: 'extension',
    name: created.name,
    version: created.version,
    status: created.status,
    actions: created.actions.map(a => ({ id: a.id, method: a.method, path: a.path })),
  });
}

async function handleCortexUpload(
  res: Response, config: AimeatConfig, storage: Storage,
  sub: string, _meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
  const parsed = parseGAII(sub);
  const ownerName = parsed?.owner ?? sub;

  const result = await parseCortexZip(data, config, ownerName);
  if (!result.ok) {
    res.status(400).json({ success: false, error: 'VALIDATION_FAILED', message: result.error });
    return;
  }

  // Store lib files
  if (result.libs) {
    for (const [filename, content] of Object.entries(result.libs)) {
      await storage.setCortexLibFile(result.extension!.name, filename, content);
    }
  }

  const record = await storage.createCortexExtension(result.extension!);
  logger.info(`Cortex installed via upload: ${record.name}`, { version: record.version, by: sub });
  emitResourceListChanged(sub);

  res.json({
    success: true,
    type: 'cortex',
    name: record.name,
    namespace: record.namespace,
    version: record.version,
    status: record.status,
    component_count: record.components.length,
  });
}
```

- [ ] **Step 2: Mount the upload router in routes-loader.ts**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add the import and mount call. The upload endpoint needs raw body access, so it must be mounted BEFORE the global JSON body parser, OR it must use its own raw body parser. Since `server.ts` applies `express.json()` globally, the upload route must override content-type handling.

Add to imports (after existing route imports):
```typescript
import { uploadRouter } from '../routes/upload.js';
```

Add to the `mountRoutes` function, early in the mount order (before `app.use(setupRouter(...))` line):
```typescript
  // Presigned upload endpoint (raw body, no JSON parsing)
  app.use(uploadRouter(config, storage));
```

- [ ] **Step 3: Handle raw body parsing for upload endpoint**

The global `express.json({ limit: '15mb' })` in `server.ts` will consume the request body before our upload handler sees it. We need to exclude `/v1/upload/` from JSON parsing.

In `aimeat/src/server.ts`, modify the JSON body parser to skip the upload path:

```typescript
  app.use((req, res, next) => {
    if (req.path.startsWith('/v1/upload/')) return next();
    express.json({ limit: '15mb' })(req, res, next);
  });
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: Errors for missing `upload-zip.ts` (created in next task). Other code should be clean.

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/upload.ts aimeat/src/server-bootstrap/routes-loader.ts aimeat/src/server.ts
git commit -m "feat(upload): add PUT /v1/upload/:token endpoint and mount it"
```

---

### Task 3: Extension/Cortex ZIP Parser

**Files:**
- Create: `aimeat/src/services/upload-zip.ts`

- [ ] **Step 1: Write the ZIP parser service for extension and cortex uploads**

This reuses security patterns from `package-zip.ts` (magic bytes, bomb detection, path traversal) but extracts extension/cortex-specific structures.

```typescript
/**
 * @file upload-zip.ts
 * @description ZIP parsing for extension and cortex uploads via presigned URL.
 *   Validates ZIP structure, extracts manifest + scripts/libs, applies security checks.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import yauzl from 'yauzl';
import { parseDocument as parseYaml } from 'yaml';
import type { AimeatConfig } from '../config.js';
import type { ExtensionRecord } from '../storage/interface.js';
import { parseCortexManifest } from './cortex-manifest.js';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MAX_FILES = 50;
const MAX_DEPTH = 5;
const DECOMPRESSION_RATIO = 10;

interface ExtensionZipResult {
  ok: boolean;
  error?: string;
  record?: ExtensionRecord;
}

interface CortexZipResult {
  ok: boolean;
  error?: string;
  extension?: ReturnType<typeof parseCortexManifest> extends { extension: infer T } ? T : never;
  libs?: Record<string, string>;
}

export async function parseExtensionZip(buffer: Buffer, config: AimeatConfig): Promise<ExtensionZipResult> {
  // Magic bytes check
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    return { ok: false, error: 'Not a valid ZIP file (missing magic bytes)' };
  }

  // Size check
  const maxBytes = (config.extensionMaxCodeSizeKb * 1024) * MAX_FILES;
  if (buffer.length > maxBytes) {
    return { ok: false, error: `ZIP exceeds maximum size of ${Math.round(maxBytes / 1024)}KB` };
  }

  let files: Map<string, Buffer>;
  try {
    files = await extractZipEntries(buffer);
  } catch (err) {
    return { ok: false, error: `ZIP extraction failed: ${(err as Error).message}` };
  }

  // Find manifest.yaml
  const manifestBuf = files.get('manifest.yaml');
  if (!manifestBuf) {
    return { ok: false, error: 'ZIP must contain manifest.yaml at root' };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = parseYaml(manifestBuf.toString('utf-8')).toJSON() as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'manifest.yaml is not valid YAML' };
  }

  // Validate metadata
  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (!metadata?.name || !metadata?.version || !metadata?.description || !metadata?.author) {
    return { ok: false, error: 'metadata.name, metadata.version, metadata.description, and metadata.author are required' };
  }

  // Validate actions
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

  // Validate all action scripts exist
  for (const action of actions) {
    if (!action.id || !action.method || !action.path || !action.script) {
      return { ok: false, error: 'Each action must have id, method, path, and script fields' };
    }
    if (!scripts[action.script as string]) {
      return { ok: false, error: `Script "${action.script}" referenced in action "${action.id}" not found in scripts/ directory` };
    }
  }

  // Validate individual script sizes
  for (const [filename, content] of Object.entries(scripts)) {
    const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;
    if (sizeKb > config.extensionMaxCodeSizeKb) {
      return { ok: false, error: `Script "${filename}" (${Math.round(sizeKb)}KB) exceeds limit of ${config.extensionMaxCodeSizeKb}KB` };
    }
  }

  // Build ExtensionRecord
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

  return { ok: true, record };
}

export async function parseCortexZip(
  buffer: Buffer, config: AimeatConfig, ownerName: string,
): Promise<CortexZipResult> {
  // Magic bytes check
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    return { ok: false, error: 'Not a valid ZIP file (missing magic bytes)' };
  }

  // Size check
  const maxBytes = config.cortexMaxLibSizeKb * 1024 * MAX_FILES;
  if (buffer.length > maxBytes) {
    return { ok: false, error: `ZIP exceeds maximum size` };
  }

  let files: Map<string, Buffer>;
  try {
    files = await extractZipEntries(buffer);
  } catch (err) {
    return { ok: false, error: `ZIP extraction failed: ${(err as Error).message}` };
  }

  // Find manifest.yaml
  const manifestBuf = files.get('manifest.yaml');
  if (!manifestBuf) {
    return { ok: false, error: 'ZIP must contain manifest.yaml at root' };
  }

  const manifestStr = manifestBuf.toString('utf-8');

  // Validate manifest size
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

  // Parse manifest using existing cortex-manifest service
  const result = parseCortexManifest(manifestStr, ownerName, Object.keys(libs).length > 0 ? libs : undefined);

  if (!result.ok || !result.extension) {
    return { ok: false, error: result.errors?.join('; ') ?? 'Manifest validation failed' };
  }

  return { ok: true, extension: result.extension, libs: Object.keys(libs).length > 0 ? libs : undefined };
}

// --- Internal ZIP extraction ---

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

        // Path traversal checks
        if (fileName.includes('../') || fileName.startsWith('/')) {
          zipfile!.close();
          return reject(new Error(`Dangerous path detected: ${fileName}`));
        }

        // Directory depth
        const depth = fileName.split('/').length - 1;
        if (depth > MAX_DEPTH) {
          zipfile!.close();
          return reject(new Error(`Directory depth exceeds ${MAX_DEPTH}: ${fileName}`));
        }

        // Skip directories
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
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS. The `parseCortexManifest` import and `ExtensionRecord` type should resolve from existing code.

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/upload-zip.ts
git commit -m "feat(upload): add ZIP parser for extension and cortex uploads"
```

---

### Task 4: Initialize Upload Token Keys at Startup

**Files:**
- Modify: `aimeat/src/server-bootstrap/service-init.ts` (or wherever node keys are initialized)

- [ ] **Step 1: Find where node keys are initialized and add upload token init**

Search for `initNodeKeys` call site. The upload token service needs the same CryptoKey pair that JWT signing uses. The cleanest approach is to expose the keys after `initNodeKeys()` runs and pass them to `initUploadTokenKeys()`.

In `aimeat/src/auth/jwt.ts`, add a getter for the initialized keys:

```typescript
export function getNodeKeys(): { privateKey: CryptoKey; publicKey: CryptoKey } {
  if (!nodePrivateKey || !nodePublicKey) throw new Error('Node keys not initialized');
  return { privateKey: nodePrivateKey, publicKey: nodePublicKey };
}
```

Then in the startup code (find the file that calls `initNodeKeys`), add after that call:

```typescript
import { initUploadTokenKeys } from '../services/upload-token.js';
import { getNodeKeys } from '../auth/jwt.js';

// After initNodeKeys() succeeds:
const { privateKey, publicKey } = getNodeKeys();
initUploadTokenKeys(privateKey, publicKey);
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/auth/jwt.ts aimeat/src/server-bootstrap/service-init.ts
git commit -m "feat(upload): initialize upload token keys at server startup"
```

---

### Task 5: Dual-Mode aimeat_app_publish

**Files:**
- Modify: `aimeat/src/mcp/apps.ts`

- [ ] **Step 1: Add upload token import and make content_base64 optional**

```typescript
import { generateUploadToken } from '../services/upload-token.js';
```

Change the schema for `aimeat_app_publish`:
- Make `content_base64` optional: `z.string().optional()`
- Update the tool description

- [ ] **Step 2: Add dual-mode logic to the handler**

Replace the tool registration with:

```typescript
    mcp.tool(
        'aimeat_app_publish',
        `Publish or update an HTML app. Two modes:
UPLOAD MODE (recommended for files > 1 KB): Call with metadata only (omit content_base64). Returns an upload_url. PUT the raw HTML file to that URL. The PUT response contains the publish result as JSON.
INLINE MODE (for tiny files < 1 KB): Include content_base64 with the base64-encoded HTML content. Result returned directly.`,
        {
            filename: z.string().describe('App filename (e.g. "starwars.html"). Alphanumeric, dots, hyphens, underscores. Max 100 chars.'),
            content_base64: z.string().optional().describe('Base64-encoded HTML content. Omit to get an upload URL instead (recommended for files > 1KB).'),
            name: z.string().describe('Display name of the app'),
            description: z.string().optional().describe('Short description of the app'),
            category: z.string().optional().describe('App category (default: "tool")'),
            tags: z.array(z.string()).optional().describe('Array of tags for search/filtering'),
            icon: z.string().optional().describe('Emoji icon for the app'),
            version: z.string().optional().describe('Semver display version (e.g. "1.0.0"). Auto-generated if omitted.'),
        },
        async ({ filename, content_base64, name, description, category, tags, icon, version }) => {
            const agentGaii = getAgentGaii();
            const parsed = parseGAII(agentGaii);
            if (!parsed) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }

            // Validate filename
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(filename)) {
                return {
                    content: [{ type: 'text' as const, text: 'Invalid filename. Use alphanumeric, dots, hyphens, underscores. Max 100 chars.' }],
                    isError: true,
                };
            }

            // --- UPLOAD MODE: no content provided, return upload URL ---
            if (!content_base64) {
                const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
                const token = await generateUploadToken({
                    typ: 'upload',
                    sub: `${parsed.owner}@${config.nodeId}`,
                    utype: 'app',
                    meta: { filename, name, description, category, tags, icon, version },
                    maxBytes: MAX_APP_SIZE,
                    contentType: 'text/html',
                });

                const uploadUrl = `${config.baseUrl}/v1/upload/${token}`;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: uploadUrl,
                            upload_method: 'PUT',
                            content_type: 'text/html',
                            max_size_bytes: MAX_APP_SIZE,
                            expires_in_seconds: 3600,
                            note: 'PUT the raw HTML file to upload_url. The response contains the publish result as JSON.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE: content provided, process immediately ---
            const data = Buffer.from(content_base64, 'base64');
            const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
            if (data.length > MAX_APP_SIZE) {
                return {
                    content: [{ type: 'text' as const, text: `App file exceeds ${config.appMaxSizeMb}MB limit (${data.length} bytes)` }],
                    isError: true,
                };
            }

            const ownerGaii = `${parsed.owner}@${config.nodeId}`;
            const existingVersion = await storage.getLatestVersionNumber(ownerGaii, filename);
            const newVersion = existingVersion + 1;
            const isUpdate = existingVersion > 0;

            const manifest: AppManifest = {
                name,
                description: description ?? '',
                version: version ?? `1.0.${newVersion - 1}`,
                category: category ?? 'tool',
                tags: tags ?? [],
                authorDisplay: parsed.owner,
                usesCortex: [],
            };
            if (icon) manifest.icon = icon;

            try {
                await storage.createApp({
                    ownerGaii,
                    ownerName: parsed.owner,
                    filename,
                    versionNumber: newVersion,
                    manifest,
                    mimeType: 'text/html',
                    size: data.length,
                    data,
                    createdAt: new Date().toISOString(),
                });

                const downloadUrl = `/v1/apps/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(filename)}`;
                logger.info(`App ${isUpdate ? 'updated' : 'published'} via MCP: ${filename} v${newVersion}`, { by: agentGaii });
                emitResourceListChanged(agentGaii);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'inline',
                            filename,
                            version_number: newVersion,
                            name: manifest.name,
                            size: data.length,
                            is_update: isUpdate,
                            download_url: downloadUrl,
                            inline_url: `${downloadUrl}?mode=inline`,
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to publish app: ${(err as Error).message}` }], isError: true };
            }
        },
    );
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/mcp/apps.ts
git commit -m "feat(upload): dual-mode aimeat_app_publish (inline or presigned URL)"
```

---

### Task 6: Dual-Mode aimeat_storage_upload

**Files:**
- Modify: `aimeat/src/mcp/core.ts`

- [ ] **Step 1: Add import and make data_base64 optional**

Add to imports in `core.ts`:
```typescript
import { generateUploadToken } from '../services/upload-token.js';
```

- [ ] **Step 2: Replace the aimeat_storage_upload tool registration**

```typescript
    mcp.tool(
        'aimeat_storage_upload',
        `Upload a file to binary storage. Two modes:
UPLOAD MODE (recommended for files > 1 KB): Call with key and metadata only (omit data_base64). Returns an upload_url. PUT the raw file to that URL.
INLINE MODE (for tiny files < 1 KB): Include data_base64 with base64-encoded data. Result returned directly.`,
        {
            key: z.string().describe('Storage key (path-like identifier)'),
            data_base64: z.string().optional().describe('Base64-encoded file data. Omit to get an upload URL instead (recommended for files > 1KB).'),
            mime_type: z.string().optional().describe('MIME type (default: application/octet-stream)'),
            visibility: z.enum(['private', 'owner', 'public']).optional().describe('Access control (default: private)'),
        },
        async ({ key, data_base64, mime_type, visibility }) => {
            // --- UPLOAD MODE ---
            if (!data_base64) {
                const maxBytes = 10 * 1024 * 1024;
                const contentType = mime_type ?? 'application/octet-stream';
                const token = await generateUploadToken({
                    typ: 'upload',
                    sub: agentGaii,
                    utype: 'storage',
                    meta: { key, mime_type: contentType, visibility: visibility ?? 'private' },
                    maxBytes,
                    contentType,
                });

                const uploadUrl = `${config.baseUrl}/v1/upload/${token}`;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: uploadUrl,
                            upload_method: 'PUT',
                            content_type: contentType,
                            max_size_bytes: maxBytes,
                            expires_in_seconds: 3600,
                            note: 'PUT the raw file to upload_url. The response contains the result as JSON.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE ---
            const fileData = Buffer.from(data_base64, 'base64');
            if (fileData.length > 10 * 1024 * 1024) {
                return { content: [{ type: 'text' as const, text: 'File exceeds 10MB limit' }], isError: true };
            }
            const file = await storage.createStorageFile({
                key,
                ownerGaii: agentGaii,
                visibility: visibility ?? 'private',
                mimeType: mime_type ?? 'application/octet-stream',
                size: fileData.length,
                data: fileData,
                createdAt: new Date().toISOString(),
            });
            emitResourceUpdated(agentGaii, `aimeat://storage/${encodeURIComponent(key)}`);
            emitResourceListChanged(agentGaii);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({ mode: 'inline', key: file.key, size: file.size, uploaded: true }, null, 2) }],
            };
        },
    );
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/mcp/core.ts
git commit -m "feat(upload): dual-mode aimeat_storage_upload (inline or presigned URL)"
```

---

### Task 7: Dual-Mode aimeat_extension_install

**Files:**
- Modify: `aimeat/src/mcp/extensions.ts`

- [ ] **Step 1: Add import**

```typescript
import { generateUploadToken } from '../services/upload-token.js';
```

- [ ] **Step 2: Make manifest and scripts optional, add upload mode**

Change the schema:
```typescript
        {
            manifest: z.string().optional().describe('Extension manifest in YAML format. Omit both manifest and scripts to get an upload URL for a ZIP bundle.'),
            scripts: z.record(z.string(), z.string()).optional().describe('Map of script filename to JavaScript source code. Omit to use upload mode.'),
        },
```

Add upload mode at the start of the handler (before manifest parsing):
```typescript
        async ({ manifest: manifestYaml, scripts }) => {
            // --- UPLOAD MODE: no manifest provided, return upload URL ---
            if (!manifestYaml) {
                const maxBytes = config.extensionMaxCodeSizeKb * 1024 * 50; // 50 files max
                const token = await generateUploadToken({
                    typ: 'upload',
                    sub: getAgentGaii(),
                    utype: 'extension',
                    meta: {},
                    maxBytes,
                    contentType: 'application/zip',
                });

                const uploadUrl = `${config.baseUrl}/v1/upload/${token}`;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: uploadUrl,
                            upload_method: 'PUT',
                            content_type: 'application/zip',
                            max_size_bytes: maxBytes,
                            expires_in_seconds: 3600,
                            zip_structure: 'manifest.yaml at root, scripts in scripts/ directory',
                            note: 'Create a ZIP with manifest.yaml and scripts/*.js, then PUT it to upload_url.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE: manifest provided, process immediately ---
            // (existing code continues here unchanged)
```

Update the tool description:
```typescript
        'Install a new extension. Two modes:\nUPLOAD MODE (recommended): Call with no arguments to get an upload URL. Create a ZIP containing manifest.yaml at root and scripts in scripts/ directory, then PUT it to the URL.\nINLINE MODE: Provide manifest (YAML string) and scripts (filename-to-code map) directly.',
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/mcp/extensions.ts
git commit -m "feat(upload): dual-mode aimeat_extension_install (inline or presigned URL)"
```

---

### Task 8: Dual-Mode aimeat_cortex_install

**Files:**
- Modify: `aimeat/src/mcp/cortex.ts`

- [ ] **Step 1: Add import**

```typescript
import { generateUploadToken } from '../services/upload-token.js';
```

- [ ] **Step 2: Make manifest optional, add upload mode**

Change the schema:
```typescript
        {
            manifest: z.string().optional().describe('YAML manifest string. Omit to get an upload URL for a ZIP bundle.'),
            libs: z.record(z.string(), z.string()).optional().describe('Map of filename to JavaScript source code for lib files.'),
        },
```

Add upload mode at the start of the handler:
```typescript
        async ({ manifest, libs }) => {
            // --- UPLOAD MODE: no manifest provided, return upload URL ---
            if (!manifest) {
                const maxBytes = config.cortexMaxLibSizeKb * 1024 * 50;
                const token = await generateUploadToken({
                    typ: 'upload',
                    sub: getAgentGaii(),
                    utype: 'cortex',
                    meta: {},
                    maxBytes,
                    contentType: 'application/zip',
                });

                const uploadUrl = `${config.baseUrl}/v1/upload/${token}`;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: uploadUrl,
                            upload_method: 'PUT',
                            content_type: 'application/zip',
                            max_size_bytes: maxBytes,
                            expires_in_seconds: 3600,
                            zip_structure: 'manifest.yaml at root, lib files in libs/ directory',
                            note: 'Create a ZIP with manifest.yaml and libs/*.js, then PUT it to upload_url.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE: manifest provided, process immediately ---
            // (existing code continues here unchanged)
```

Update the tool description:
```typescript
        'Install a cortex extension. Two modes:\nUPLOAD MODE (recommended): Call with no arguments to get an upload URL. Create a ZIP containing manifest.yaml at root and lib files in libs/ directory, then PUT it to the URL.\nINLINE MODE: Provide manifest (YAML string) and optional libs (filename-to-code map) directly.',
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/mcp/cortex.ts
git commit -m "feat(upload): dual-mode aimeat_cortex_install (inline or presigned URL)"
```

---

### Task 9: E2E Tests

**Files:**
- Create: `aimeat/test/upload-presigned.ts`

- [ ] **Step 1: Write E2E test for the presigned upload flow**

This test exercises the full flow: call MCP-like tool endpoint to get upload URL, then PUT a file to it.

```typescript
/**
 * @file upload-presigned.ts
 * @description E2E tests for presigned upload URL mechanism.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial creation
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:40251';

let ownerToken = '';

describe('Presigned Upload', () => {
  before(async () => {
    // Register test owner and get JWT
    const regRes = await fetch(`${BASE}/v1/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'uploadtester', password: 'Test1234!' }),
    });
    const regData = await regRes.json() as { data?: { token?: string } };
    ownerToken = regData.data?.token ?? '';
    assert.ok(ownerToken, 'Should get owner token');
  });

  describe('App upload via presigned URL', () => {
    it('should return upload_url when content_base64 is omitted', async () => {
      const res = await fetch(`${BASE}/v1/apps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          filename: 'upload-test.html',
          name: 'Upload Test App',
          mode: 'presigned',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json() as { data?: { upload_url?: string } };
      assert.ok(data.data?.upload_url, 'Should return upload_url');
      assert.ok(data.data.upload_url.includes('/v1/upload/'), 'URL should contain /v1/upload/');
    });

    it('should accept file via PUT to upload URL', async () => {
      // Step 1: Get upload URL
      const prepRes = await fetch(`${BASE}/v1/apps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          filename: 'upload-test2.html',
          name: 'Upload Test 2',
          mode: 'presigned',
        }),
      });
      const prepData = await prepRes.json() as { data?: { upload_url?: string } };
      const uploadUrl = prepData.data?.upload_url;
      assert.ok(uploadUrl);

      // Step 2: PUT file
      const htmlContent = '<html><body><h1>Hello Upload</h1></body></html>';
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: htmlContent,
      });
      assert.equal(putRes.status, 200);
      const result = await putRes.json() as { success: boolean; filename?: string; version_number?: number };
      assert.equal(result.success, true);
      assert.equal(result.filename, 'upload-test2.html');
      assert.equal(result.version_number, 1);
    });

    it('should reject reuse of same upload token', async () => {
      // Get URL
      const prepRes = await fetch(`${BASE}/v1/apps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          filename: 'upload-reuse.html',
          name: 'Reuse Test',
          mode: 'presigned',
        }),
      });
      const prepData = await prepRes.json() as { data?: { upload_url?: string } };
      const uploadUrl = prepData.data?.upload_url!;

      // First PUT (succeeds)
      const put1 = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: '<html>first</html>',
      });
      assert.equal(put1.status, 200);

      // Second PUT (fails - token already used)
      const put2 = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: '<html>second</html>',
      });
      assert.equal(put2.status, 409);
      const err = await put2.json() as { error?: string };
      assert.equal(err.error, 'TOKEN_USED');
    });

    it('should reject oversized uploads', async () => {
      // Get URL (appMaxSizeMb is 5 by default, use a smaller custom token for testing)
      const prepRes = await fetch(`${BASE}/v1/apps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          filename: 'upload-big.html',
          name: 'Big Test',
          mode: 'presigned',
        }),
      });
      const prepData = await prepRes.json() as { data?: { upload_url?: string; max_size_bytes?: number } };
      const uploadUrl = prepData.data?.upload_url!;
      const maxSize = prepData.data?.max_size_bytes ?? 5 * 1024 * 1024;

      // Create oversized content (max + 1 byte)
      const oversized = 'x'.repeat(maxSize + 1);
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: oversized,
      });
      assert.equal(putRes.status, 413);
    });
  });

  describe('Storage upload via presigned URL', () => {
    it('should return upload_url for storage when data_base64 is omitted', async () => {
      const res = await fetch(`${BASE}/v1/storage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          key: 'test/presigned-file.txt',
          mode: 'presigned',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json() as { data?: { upload_url?: string } };
      assert.ok(data.data?.upload_url);
    });
  });

  // Cleanup
  describe('Cleanup', () => {
    it('should delete test owner', async () => {
      const res = await fetch(`${BASE}/v1/owners/uploadtester`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
      });
      assert.ok([200, 204].includes(res.status));
    });
  });
});
```

Note: The exact test API depends on how the REST routes expose the presigned mode (Task 10 covers the REST route modifications). The MCP tools are the primary interface, but these E2E tests go through REST. Adjust paths as needed once Task 10 is complete.

- [ ] **Step 2: Run E2E tests**

Run: `pnpm test:e2e`
Expected: All existing tests PASS. New upload tests may need adjustments based on REST route implementation.

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/upload-presigned.ts
git commit -m "test(upload): add E2E tests for presigned upload flow"
```

---

### Task 10: REST Route Presigned Mode for Apps and Storage

**Files:**
- Modify: `aimeat/src/routes/apps.ts`
- Modify: `aimeat/src/routes/storage-files.ts`

The MCP tools use the presigned flow natively, but the REST API should also support `mode: "presigned"` for consistency (so the same E2E test infrastructure works and browser-based tools can use it too).

- [ ] **Step 1: Add presigned mode to POST /v1/apps**

In `aimeat/src/routes/apps.ts`, in the POST handler, add a check at the top:

```typescript
import { generateUploadToken } from '../services/upload-token.js';

// Inside POST /v1/apps handler, before existing content processing:
if (req.body.mode === 'presigned') {
  const filename = req.body.filename as string;
  const name = req.body.name as string;

  // Validate filename
  if (!filename || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(filename)) {
    res.status(400).json(error(config.nodeId, 'INVALID_FILENAME', 'Invalid filename'));
    return;
  }
  if (!name) {
    res.status(400).json(error(config.nodeId, 'MISSING_NAME', 'name is required'));
    return;
  }

  const ownerGaii = resolveGhii(req.auth!, config.nodeId);
  const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;

  const token = await generateUploadToken({
    typ: 'upload',
    sub: ownerGaii,
    utype: 'app',
    meta: {
      filename,
      name,
      description: req.body.description,
      category: req.body.category,
      tags: req.body.tags,
      icon: req.body.icon,
      version: req.body.version,
    },
    maxBytes: MAX_APP_SIZE,
    contentType: 'text/html',
  });

  res.json(success(config.nodeId, {
    upload_url: `${config.baseUrl}/v1/upload/${token}`,
    upload_method: 'PUT',
    content_type: 'text/html',
    max_size_bytes: MAX_APP_SIZE,
    expires_in_seconds: 3600,
  }));
  return;
}
```

- [ ] **Step 2: Add presigned mode to POST /v1/storage**

In `aimeat/src/routes/storage-files.ts`, in the POST handler for JSON mode, add:

```typescript
import { generateUploadToken } from '../services/upload-token.js';

// At the start of JSON mode handler:
if (req.body.mode === 'presigned') {
  const key = req.body.key as string;
  if (!key) {
    res.status(400).json(error(config.nodeId, 'MISSING_KEY', 'key is required'));
    return;
  }

  const ownerGaii = resolveGhii(req.auth!, config.nodeId);
  const maxBytes = 10 * 1024 * 1024;
  const contentType = (req.body.mime_type as string) ?? 'application/octet-stream';

  const token = await generateUploadToken({
    typ: 'upload',
    sub: ownerGaii,
    utype: 'storage',
    meta: { key, mime_type: contentType, visibility: req.body.visibility ?? 'private' },
    maxBytes,
    contentType,
  });

  res.json(success(config.nodeId, {
    upload_url: `${config.baseUrl}/v1/upload/${token}`,
    upload_method: 'PUT',
    content_type: contentType,
    max_size_bytes: maxBytes,
    expires_in_seconds: 3600,
  }));
  return;
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Run E2E tests**

Run: `pnpm test:e2e`
Expected: PASS (both existing and new upload tests)

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/apps.ts aimeat/src/routes/storage-files.ts
git commit -m "feat(upload): add presigned mode to REST routes (POST /v1/apps, POST /v1/storage)"
```

---

### Task 11: OpenAPI Spec Update

**Files:**
- Modify: `openapi.yaml`

- [ ] **Step 1: Add PUT /v1/upload/{token} to openapi.yaml**

Add under paths:

```yaml
  /v1/upload/{token}:
    put:
      summary: Upload file via presigned token
      description: |
        Receives a raw file body. The token (from MCP tool or REST presigned mode)
        encodes the upload type, metadata, size limit, and authorization.
        Single-use. 60-minute TTL.
      operationId: uploadViaToken
      tags: [Upload]
      parameters:
        - name: token
          in: path
          required: true
          schema:
            type: string
          description: Presigned upload JWT token
      requestBody:
        required: true
        content:
          '*/*':
            schema:
              type: string
              format: binary
      responses:
        '200':
          description: Upload processed successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                    example: true
                  type:
                    type: string
                    enum: [app, storage, extension, cortex]
                additionalProperties: true
        '401':
          description: Invalid token
        '409':
          description: Token already used (single-use)
        '410':
          description: Token expired
        '413':
          description: File exceeds size limit
```

- [ ] **Step 2: Commit**

```bash
git add openapi.yaml
git commit -m "docs(openapi): add PUT /v1/upload/{token} endpoint"
```

---

### Task 12: Documentation

**Files:**
- Create: `docs/coding-guidelines/mcp-uploads.md`
- Modify: `CLAUDE.md` (add section about MCP upload pattern)

- [ ] **Step 1: Write the developer guide**

```markdown
# MCP Presigned Upload Guide

## Overview

AIMEAT MCP tools support presigned upload URLs to transfer files from the agent's
filesystem directly to the server without passing content through the AI context window.

## How It Works

1. Agent calls MCP tool with metadata only (omits file content parameter)
2. Server validates metadata, generates a single-use upload JWT (60 min TTL)
3. Returns `upload_url`, `upload_method` (PUT), `content_type`, `max_size_bytes`
4. Agent uploads file using any HTTP client (curl, PowerShell, Python, etc.)
5. Server validates token, processes file, returns JSON result

## Affected Tools

| Tool | Content parameter | Upload format |
|------|-------------------|---------------|
| `aimeat_app_publish` | `content_base64` (optional) | Raw HTML |
| `aimeat_storage_upload` | `data_base64` (optional) | Raw file |
| `aimeat_extension_install` | `manifest` + `scripts` (optional) | ZIP |
| `aimeat_cortex_install` | `manifest` + `libs` (optional) | ZIP |

## Inline Fallback

All tools retain backward-compatible inline parameters. If the agent provides
content inline, it works exactly as before. Upload mode activates only when
content parameters are omitted.

## ZIP Format (Extensions/Cortex)

### Extension ZIP:
```
manifest.yaml
scripts/
  init.js
  search.js
```

### Cortex ZIP:
```
manifest.yaml
libs/
  main.js
  helpers.js
```

## Upload Token Security

- **Single-use:** Token hash tracked in memory, reuse rejected with 409
- **60-min TTL:** Expired tokens rejected with 410
- **Type-bound:** App token cannot upload storage files
- **Size-capped:** max_size_bytes enforced during upload streaming
- **Same signing key:** Uses node Ed25519 keypair

## Adding Upload Support to New Tools

1. Import `generateUploadToken` from `src/services/upload-token.ts`
2. Make content parameters optional in the Zod schema
3. If content is omitted, generate token with appropriate `utype` and metadata
4. Add handler case in `src/routes/upload.ts` switch statement
5. Update tool description to document both modes
```

- [ ] **Step 2: Add brief section to CLAUDE.md**

Under the "## MCP" or architecture section, add:

```markdown
### MCP Presigned Upload (File Transfer)

MCP tools that accept file content (`aimeat_app_publish`, `aimeat_storage_upload`,
`aimeat_extension_install`, `aimeat_cortex_install`) support a presigned upload mode.
When content parameters are omitted, the tool returns an `upload_url`. The agent PUTs
the raw file to that URL. This avoids passing large base64 blobs through the AI context window.

Full guide: `docs/coding-guidelines/mcp-uploads.md`
```

- [ ] **Step 3: Commit**

```bash
git add docs/coding-guidelines/mcp-uploads.md CLAUDE.md
git commit -m "docs: add MCP presigned upload guide and CLAUDE.md section"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS (fix any issues)

- [ ] **Step 3: Run E2E tests on memory backend**

Run: `pnpm test:e2e`
Expected: All tests PASS

- [ ] **Step 4: Run E2E tests on MongoDB**

Run: `pnpm test:e2e:mongodb`
Expected: All tests PASS

- [ ] **Step 5: Run E2E tests on SQLite**

Run: `pnpm test:e2e:sqlite`
Expected: All tests PASS

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(upload): address test/lint findings"
```
