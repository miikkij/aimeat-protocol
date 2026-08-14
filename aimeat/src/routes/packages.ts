/**
 * @file packages.ts
 * @description Package API routes — CRUD, versioning, export/import for AIMEAT packages.
 *   Packages are versioned bundles of AIMEAT components (CSM, Extension, Cortex, App, MSM, Memory, Translation).
 * @structure
 *   - packagesRouter() — main router factory
 *   - POST /v1/packages — create package (first version)
 *   - POST /v1/packages/:groupId/versions — publish new version
 *   - GET /v1/packages — list packages
 *   - GET /v1/packages/:groupId — get latest published
 *   - GET /v1/packages/:groupId/versions — list all versions
 *   - GET /v1/packages/:groupId/versions/:version — get specific version
 *   - PATCH /v1/packages/:groupId — update group metadata
 *   - PATCH /v1/packages/:groupId/versions/:version — update version status
 *   - DELETE /v1/packages/:groupId/versions/:version — archive version
 *   - GET /v1/packages/:groupId/export — export as ZIP bundle
 *   - POST /v1/packages/import — import from ZIP bundle
 * @usage
 *   import { packagesRouter } from '../routes/packages.js';
 *   app.use(packagesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 2)
 *   v1.1.0 — 2026-03-15 — rename routes from /v1/packages to /v1/bundles to avoid collision with knowledge system
 *   v1.5.0 — 2026-03-18 — rename routes back from /v1/bundles to /v1/packages (knowledge moved to /v1/knowledge)
 *   v1.2.0 — 2026-03-15 — GHII resolution, YAML export, import validation, duplicate detection
 *   v1.3.0 — 2026-03-15 — support YAML bundle string import (text/yaml Content-Type) for POST /v1/packages/import
 *   v1.4.0 — 2026-03-15 — enforce packageMaxSizeMb, packageMaxComponents limits; remove (config as any) casts
 *   v2.0.0 — 2026-03-20 — change export/import from YAML to ZIP format (buildZip/parseZip)
 *   v2.1.0 — 2026-03-20 — add POST /v1/packages/:groupId/propose endpoint for template gallery proposals
 */

import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import Busboy from 'busboy';
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord, PackageComponent, PackageComponentType, TemplateListingRecord } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { createPackagesTabService } from '../services/db/packages-tab-db-service.js';
import { emitChange } from '../services/event-bus.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { buildZip, parseZip, ZipValidationError } from '../services/package-zip.js';

/** Generate a date-based version string: v{YYYY}-{MM}-{DD}-{HHmm} */
function generateVersion(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `v${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** SHA-256 hash of content for change detection. */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Raw, client-supplied component shape from a request body (pre-validation). */
interface RawComponentInput {
  id: string;
  type: string;
  label?: string;
  content?: string;
  contentHash?: string;
  dependencies?: string[];
}

const MAX_PACKAGES_PER_AUTHOR = 100;
const VALID_STATUSES = ['draft', 'published', 'archived'] as const;
const VALID_VISIBILITIES = ['private', 'public'] as const;

export function packagesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── Static routes FIRST (before parameterized :groupId) ──────────

  // GET /v1/packages/tab — the Packages tab mount's THREE local reads (installed instances + owner's
  // packages + newest templates) in one read scope (PackagesTabService). The cross-node
  // federation-templates call stays separate (best-effort outbound). Owner-scope: requires 'owner' role.
  // MUST be registered before GET /v1/packages/:groupId. The individual endpoints stay for re-fetches.
  const packagesTabDb = createPackagesTabService(storage);
  router.get('/v1/packages/tab', requireAuth(), requireRole('owner'), async (req, res) => {
    const data = await packagesTabDb.overview(req.auth!.owner as string);
    res.json(success(config.nodeId, data));
  });

  // POST /v1/packages/import — import from ZIP bundle
  router.post('/v1/packages/import', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const roles = req.auth!.roles;

    // Role check: operator always allowed, owner only if configured
    const createRole = config.packageCreateRole ?? 'owner';
    if (!roles.includes('operator') && createRole === 'operator') {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only operators can import packages'));
      return;
    }

    // Collect uploaded ZIP file via busboy
    const maxBytes = config.packageMaxSizeMb * 1024 * 1024;
    let fileBuffer: Buffer | null = null;
    let fileReceived = false;
    let sizeLimitHit = false;

    try {
      await new Promise<void>((resolve, reject) => {
        const busboy = Busboy({
          headers: req.headers,
          limits: { files: 1, fileSize: maxBytes },
        });

        busboy.on('file', (_fieldname: string, stream: NodeJS.ReadableStream, _info: { filename: string; encoding: string; mimeType: string }) => {
          if (fileReceived) {
            stream.resume();
            return;
          }
          fileReceived = true;
          const chunks: Buffer[] = [];

          stream.on('data', (chunk: Buffer) => { chunks.push(chunk); });
          (stream as NodeJS.EventEmitter).on('limit', () => { sizeLimitHit = true; });
          stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
          stream.on('error', reject);
        });

        busboy.on('finish', () => resolve());
        busboy.on('error', reject);
        req.pipe(busboy);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', msg || 'Failed to parse multipart upload'));
      return;
    }

    if (!fileBuffer) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No file uploaded. Send a multipart/form-data request with a ZIP file.'));
      return;
    }

    if (sizeLimitHit) {
      res.status(413).json(error(config.nodeId, 'SIZE_EXCEEDED',
        `Uploaded file exceeds limit of ${config.packageMaxSizeMb}MB`));
      return;
    }

    // Parse and validate ZIP
    let parsed;
    try {
      parsed = await parseZip(fileBuffer, { maxSizeMb: config.packageMaxSizeMb });
    } catch (e: unknown) {
      if (e instanceof ZipValidationError) {
        const statusMap: Record<string, number> = {
          SIZE_EXCEEDED: 413,
        };
        const status = statusMap[e.code] ?? 400;
        res.status(status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', msg));
      return;
    }

    // Check max components
    if (parsed.components.length > config.packageMaxComponents) {
      res.status(413).json(error(config.nodeId, 'COMPONENT_LIMIT_EXCEEDED',
        `Package has ${parsed.components.length} components, max is ${config.packageMaxComponents}`));
      return;
    }

    // Check max packages per author
    const maxPerAuthor = config.packageMaxPerAuthor ?? MAX_PACKAGES_PER_AUTHOR;
    const existingCount = await storage.listPackages({ author: owner, limit: 1, offset: 0 });
    if (existingCount.total >= maxPerAuthor) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
        `Maximum ${maxPerAuthor} packages per author. Archive unused packages first.`));
      return;
    }

    // Check name conflicts — same name, different author = reject; same author = allow as new version
    const packageGroupId = `${parsed.name}::${owner}`;
    const existingGroup = await storage.listVersions(packageGroupId, 1, 0);
    if (existingGroup.total > 0) {
      const existingPkg = existingGroup.versions[0];
      if (existingPkg.author !== owner) {
        res.status(409).json(error(config.nodeId, 'CONFLICT',
          `Package "${parsed.name}" already exists by a different author`));
        return;
      }
      // Same author — will create as a new version
    }

    try {
      const now = new Date().toISOString();
      const id = randomUUID();
      const author = owner;
      const authorGhii = await resolveGhii(storage, owner, req.auth!.sub);
      const version = generateVersion();

      const components: PackageComponent[] = parsed.components.map(c => ({
        id: c.id,
        type: c.type as PackageComponent['type'],
        label: c.label ?? '',
        content: c.content ?? '',
        contentHash: c.contentHash ?? hashContent(c.content ?? ''),
        dependencies: c.dependencies ?? [],
      }));

      const record: PackageRecord = {
        id,
        packageGroupId,
        name: parsed.name,
        author,
        authorGhii,
        version,
        changelog: parsed.changelog ?? 'Imported from ZIP',
        description: parsed.description ?? '',
        category: parsed.category ?? 'other',
        tags: parsed.tags ?? [],
        visibility: 'private',
        status: 'published',
        components,
        manifest: '',
        createdAt: now,
        updatedAt: now,
      };

      const created = await storage.createPackage(record);
      res.status(201).json(success(config.nodeId, created, [
        { description: 'View package', method: 'GET', url: `/v1/packages/${encodeURIComponent(packageGroupId)}` },
      ]));
      emitChange('packages');
    } catch (e) {
      const err = e as { message?: string; code?: string };
      if (err.message === 'PACKAGE_EXISTS' || err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'P2002') {
        res.status(409).json(error(config.nodeId, 'CONFLICT', `Package "${parsed.name}" already exists for this author`));
        return;
      }
      res.status(500).json(error(config.nodeId, 'IMPORT_FAILED', err.message ?? 'Import failed'));
    }
  });

  // GET /v1/packages — list packages
  router.get('/v1/packages', async (req, res) => {
    const author = req.query.author as string | undefined;
    const category = req.query.category as string | undefined;
    const status = (req.query.status as string) ?? 'published';
    const visibility = (req.query.visibility as string) ?? 'public';
    const search = req.query.search as string | undefined;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string ?? '50', 10)));
    const offset = Math.max(0, parseInt(req.query.offset as string ?? '0', 10));

    // Authenticated users can see their own private packages
    const authOwner = req.auth?.owner;

    const result = await storage.listPackages({
      author,
      category,
      status,
      visibility: authOwner && author === authOwner ? undefined : visibility,
      search,
      limit,
      offset,
    });

    res.json(success(config.nodeId, { packages: result.packages, total: result.total }));
  });

  // POST /v1/packages — create package (first version)
  router.post('/v1/packages', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const roles = req.auth!.roles;

    // Role check: operator always allowed, owner only if configured
    const createRole = config.packageCreateRole ?? 'owner';
    if (!roles.includes('operator') && createRole === 'operator') {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only operators can create packages'));
      return;
    }

    const { name, description, category, tags, visibility, components, manifest } = req.body ?? {};

    // Validate required fields
    if (!name || typeof name !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name is required and must be a string'));
      return;
    }

    if (!Array.isArray(components) || components.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'components must be an array with at least 1 item'));
      return;
    }

    // Check max components
    if (components.length > config.packageMaxComponents) {
      res.status(413).json(error(config.nodeId, 'COMPONENT_LIMIT_EXCEEDED',
        `Package has ${components.length} components, max is ${config.packageMaxComponents}`));
      return;
    }

    // Check total size
    const totalSizeBytes = components.reduce((sum: number, c: RawComponentInput) =>
      sum + Buffer.byteLength(c.content ?? '', 'utf-8'), 0);
    const maxSizeBytes = config.packageMaxSizeMb * 1024 * 1024;
    if (totalSizeBytes > maxSizeBytes) {
      res.status(413).json(error(config.nodeId, 'SIZE_EXCEEDED',
        `Total component size ${(totalSizeBytes / 1024 / 1024).toFixed(1)}MB exceeds limit of ${config.packageMaxSizeMb}MB`));
      return;
    }

    // Check max packages per author
    const maxPerAuthor = config.packageMaxPerAuthor ?? MAX_PACKAGES_PER_AUTHOR;
    const existing = await storage.listPackages({ author: owner, limit: 1, offset: 0 });
    if (existing.total >= maxPerAuthor) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
        `Maximum ${maxPerAuthor} packages per author. Archive unused packages first.`));
      return;
    }

    // Check for duplicate package name by this author
    const packageGroupId = `${name}::${owner}`;
    const existingGroup = await storage.listVersions(packageGroupId, 1, 0);
    if (existingGroup.total > 0) {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Package "${name}" already exists for this author. Use POST /v1/packages/${encodeURIComponent(packageGroupId)}/versions to publish a new version.`));
      return;
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const version = generateVersion();
    const authorGhii = await resolveGhii(storage, owner, req.auth!.sub);

    const processedComponents: PackageComponent[] = components.map((c: RawComponentInput) => ({
      id: c.id,
      type: c.type as PackageComponentType,
      label: c.label ?? '',
      content: c.content ?? '',
      contentHash: hashContent(c.content ?? ''),
      dependencies: c.dependencies ?? [],
    }));

    const record: PackageRecord = {
      id,
      packageGroupId,
      name,
      author: owner,
      authorGhii,
      version,
      changelog: '',
      description: description ?? '',
      category: category ?? 'other',
      tags: tags ?? [],
      visibility: visibility ?? 'public',
      status: 'draft',
      components: processedComponents,
      manifest: manifest ?? '',
      createdAt: now,
      updatedAt: now,
    };

    try {
      const created = await storage.createPackage(record);
      res.status(201).json(success(config.nodeId, created, [
        { description: 'Publish new version', method: 'POST', url: `/v1/packages/${encodeURIComponent(packageGroupId)}/versions` },
        { description: 'View package', method: 'GET', url: `/v1/packages/${encodeURIComponent(packageGroupId)}` },
      ]));
      emitChange('packages');
    } catch (e) {
      if (e instanceof Error && e.message === 'PACKAGE_EXISTS') {
        res.status(409).json(error(config.nodeId, 'CONFLICT', `Package "${name}" already exists for this author`));
        return;
      }
      throw e;
    }
  });

  // POST /v1/packages/:groupId/propose — propose package as template for gallery
  router.post('/v1/packages/:groupId/propose', requireAuth(), requireRole('owner'), async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const ghii = await resolveGhii(storage, req.auth!.owner, req.auth!.sub);

    // Verify the package has at least one published version
    const pkg = await storage.getLatestPublished(groupId);
    if (!pkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or has no published version'));
      return;
    }

    // Verify ownership
    if (pkg.authorGhii !== ghii) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the package author can propose it as a template'));
      return;
    }

    // Check for existing listing
    const existing = await storage.getListingByPackage(groupId);
    if (existing) {
      if (existing.status === 'listed') {
        res.status(400).json(error(config.nodeId, 'ALREADY_LISTED', 'This package is already listed in the template gallery'));
        return;
      }
      // Re-propose a previously rejected/suspended listing
      await storage.updateTemplateListing(existing.id, {
        status: 'pending_review',
        proposedAt: new Date().toISOString(),
        proposedBy: ghii,
        updatedAt: new Date().toISOString(),
      });
      emitChange('templates');
      res.json(success(config.nodeId, { listingId: existing.id, status: 'pending_review' }));
      return;
    }

    // Create new listing with pending_review status
    const now = new Date().toISOString();
    const record: TemplateListingRecord = {
      id: randomUUID(),
      packageGroupId: groupId,
      packageName: pkg.name,
      packageAuthor: pkg.author,
      publishedBy: req.auth!.owner,
      publishedByGhii: ghii,
      title: pkg.name,
      description: pkg.description,
      screenshots: [],
      category: pkg.category,
      tags: pkg.tags,
      featured: false,
      installCount: 0,
      rating: 0,
      reviewCount: 0,
      status: 'pending_review',
      createdAt: now,
      updatedAt: now,
      proposedAt: now,
      proposedBy: ghii,
    };

    const created = await storage.createTemplateListing(record);
    emitChange('templates');
    res.status(201).json(success(config.nodeId, { listingId: created.id, status: 'pending_review' }));
  });

  // ── Parameterized routes ─────────────────────────────────────────

  // POST /v1/packages/:groupId/versions — publish new version
  router.post('/v1/packages/:groupId/versions', requireAuth(), async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const owner = req.auth!.owner;

    // Verify author owns this package
    const latest = await storage.getLatestPublished(groupId);
    const anyVersion = latest ?? (await storage.listVersions(groupId, 1, 0)).versions[0];
    if (!anyVersion) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Package group not found: ${groupId}`));
      return;
    }
    if (anyVersion.author !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the package author can publish new versions'));
      return;
    }

    const { changelog, components, manifest, status } = req.body ?? {};

    // Generate version, check for same-minute duplicates
    let version = generateVersion();
    const existingVersions = await storage.listVersions(groupId, 100, 0);
    const sameMinute = existingVersions.versions.filter(v => v.version.startsWith(version));
    if (sameMinute.length > 0) {
      version = `${version}-${sameMinute.length + 1}`;
    }

    const processedComponents: PackageComponent[] = (components ?? anyVersion.components).map((c: RawComponentInput) => ({
      id: c.id,
      type: c.type as PackageComponentType,
      label: c.label ?? '',
      content: c.content ?? '',
      contentHash: c.contentHash ?? hashContent(c.content ?? ''),
      dependencies: c.dependencies ?? [],
    }));

    // Check max components
    if (processedComponents.length > config.packageMaxComponents) {
      res.status(413).json(error(config.nodeId, 'COMPONENT_LIMIT_EXCEEDED',
        `Package has ${processedComponents.length} components, max is ${config.packageMaxComponents}`));
      return;
    }

    // Check total size
    const versionSizeBytes = processedComponents.reduce((sum, c) =>
      sum + Buffer.byteLength(c.content ?? '', 'utf-8'), 0);
    const versionMaxBytes = config.packageMaxSizeMb * 1024 * 1024;
    if (versionSizeBytes > versionMaxBytes) {
      res.status(413).json(error(config.nodeId, 'SIZE_EXCEEDED',
        `Total component size ${(versionSizeBytes / 1024 / 1024).toFixed(1)}MB exceeds limit of ${config.packageMaxSizeMb}MB`));
      return;
    }

    const now = new Date().toISOString();
    const record: PackageRecord = {
      id: randomUUID(),
      packageGroupId: groupId,
      name: anyVersion.name,
      author: anyVersion.author,
      authorGhii: anyVersion.authorGhii,
      version,
      changelog: changelog ?? '',
      description: anyVersion.description,
      category: anyVersion.category,
      tags: anyVersion.tags,
      visibility: anyVersion.visibility,
      status: status ?? 'draft',
      components: processedComponents,
      manifest: manifest ?? anyVersion.manifest,
      createdAt: now,
      updatedAt: now,
    };

    const created = await storage.createPackage(record);
    res.status(201).json(success(config.nodeId, created, [
      { description: 'View version', method: 'GET', url: `/v1/packages/${encodeURIComponent(groupId)}/versions/${version}` },
    ]));
    emitChange('packages');
  });

  // GET /v1/packages/:groupId/versions/:version — get specific version
  router.get('/v1/packages/:groupId/versions/:version', async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const version = req.params.version as string;

    const pkg = await storage.getPackageByGroupAndVersion(groupId, version);
    if (!pkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${version} not found for package ${groupId}`));
      return;
    }

    // Private packages only visible to author
    if (pkg.visibility === 'private' && req.auth?.owner !== pkg.author) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${version} not found for package ${groupId}`));
      return;
    }

    res.json(success(config.nodeId, pkg));
  });

  // GET /v1/packages/:groupId/versions — list all versions
  router.get('/v1/packages/:groupId/versions', async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string ?? '50', 10)));
    const offset = Math.max(0, parseInt(req.query.offset as string ?? '0', 10));

    const result = await storage.listVersions(groupId, limit, offset);

    // Filter private packages for non-authors
    const authOwner = req.auth?.owner;
    const filtered = result.versions.filter(v =>
      v.visibility === 'public' || v.author === authOwner
    );

    res.json(success(config.nodeId, { versions: filtered, total: result.total }));
  });

  // GET /v1/packages/:groupId/export — export as ZIP bundle
  router.get('/v1/packages/:groupId/export', async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const versionParam = req.query.version as string | undefined;

    let pkg: PackageRecord | null;
    if (versionParam) {
      pkg = await storage.getPackageByGroupAndVersion(groupId, versionParam);
    } else {
      pkg = await storage.getLatestPublished(groupId);
    }

    if (!pkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Package not found: ${groupId}`));
      return;
    }

    // Private packages only visible to author
    if (pkg.visibility === 'private' && req.auth?.owner !== pkg.author) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Package not found: ${groupId}`));
      return;
    }

    // Build ZIP bundle
    const zip = await buildZip(pkg);
    const filename = `${pkg.name}-${pkg.version}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename.replace(/["\\]/g, '_')}"`,
      'Content-Length': String(zip.length),
    });
    res.send(zip);
  });

  // GET /v1/packages/:groupId — get latest published version
  router.get('/v1/packages/:groupId', async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);

    const pkg = await storage.getLatestPublished(groupId);
    if (!pkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Package not found: ${groupId}`));
      return;
    }

    // Private packages only visible to author
    if (pkg.visibility === 'private' && req.auth?.owner !== pkg.author) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Package not found: ${groupId}`));
      return;
    }

    res.json(success(config.nodeId, pkg, [
      { description: 'List all versions', method: 'GET', url: `/v1/packages/${encodeURIComponent(groupId)}/versions` },
      { description: 'Export as ZIP', method: 'GET', url: `/v1/packages/${encodeURIComponent(groupId)}/export` },
    ]));
  });

  // PATCH /v1/packages/:groupId/versions/:version — update version status
  router.patch('/v1/packages/:groupId/versions/:version', requireAuth(), async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const version = req.params.version as string;
    const owner = req.auth!.owner;

    const pkg = await storage.getPackageByGroupAndVersion(groupId, version);
    if (!pkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${version} not found for package ${groupId}`));
      return;
    }
    if (pkg.author !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the package author can update version status'));
      return;
    }

    const { status } = req.body ?? {};
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `status must be one of: ${VALID_STATUSES.join(', ')}`));
      return;
    }

    const updated = await storage.updatePackage(pkg.id, {
      status: status ?? pkg.status,
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, updated));
    emitChange('packages');
  });

  // PATCH /v1/packages/:groupId — update group metadata (all versions)
  router.patch('/v1/packages/:groupId', requireAuth(), async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const owner = req.auth!.owner;

    // Get all versions in the group
    const allVersions = await storage.listVersions(groupId, 1000, 0);
    if (allVersions.versions.length === 0) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Package group not found: ${groupId}`));
      return;
    }

    // Verify author
    if (allVersions.versions[0].author !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the package author can update group metadata'));
      return;
    }

    const { description, tags, visibility } = req.body ?? {};
    if (visibility && !VALID_VISIBILITIES.includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`));
      return;
    }

    const updates: Partial<PackageRecord> = { updatedAt: new Date().toISOString() };
    if (description !== undefined) updates.description = description;
    if (tags !== undefined) updates.tags = tags;
    if (visibility !== undefined) updates.visibility = visibility;

    // Update ALL versions in the group
    for (const ver of allVersions.versions) {
      await storage.updatePackage(ver.id, updates);
    }

    // Return the latest version with updates applied
    const updated = await storage.getLatestPublished(groupId)
      ?? (await storage.listVersions(groupId, 1, 0)).versions[0];

    res.json(success(config.nodeId, updated));
    emitChange('packages');
  });

  // DELETE /v1/packages/:groupId — archive ALL versions of a package group
  // Used by the profile UI's "Delete" button on own packages. Author-only.
  // Does not touch installed instances; only removes the package source itself
  // from the gallery / browse listings.
  router.delete('/v1/packages/:groupId', requireAuth(), async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const owner = req.auth!.owner;

    // Find any version to verify ownership. Try the latest published first,
    // then fall back to any version (drafts/archived) in the group.
    let pkg = await storage.getLatestPublished(groupId);
    if (!pkg) {
      const list = await storage.listVersions(groupId, 1, 0);
      pkg = list.versions[0] ?? null;
    }
    if (!pkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Package not found: ${groupId}`));
      return;
    }
    if (pkg.author !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the package author can delete the package'));
      return;
    }

    const count = await storage.archivePackageGroup(groupId);
    res.json(success(config.nodeId, {
      archived: true,
      groupId,
      versionsArchived: count,
    }, [
      { description: 'Browse remaining packages', method: 'GET', url: '/v1/packages' },
    ]));
    emitChange('packages');
  });

  // DELETE /v1/packages/:groupId/versions/:version — archive version
  router.delete('/v1/packages/:groupId/versions/:version', requireAuth(), async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const version = req.params.version as string;
    const owner = req.auth!.owner;

    const pkg = await storage.getPackageByGroupAndVersion(groupId, version);
    if (!pkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${version} not found for package ${groupId}`));
      return;
    }
    if (pkg.author !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the package author can archive versions'));
      return;
    }

    const archived = await storage.archivePackage(pkg.id);
    if (!archived) {
      res.status(500).json(error(config.nodeId, 'ARCHIVE_FAILED', 'Failed to archive package version'));
      return;
    }

    res.json(success(config.nodeId, { archived: true, id: pkg.id, version }, [
      { description: 'List remaining versions', method: 'GET', url: `/v1/packages/${encodeURIComponent(groupId)}/versions` },
    ]));
    emitChange('packages');
  });

  return router;
}
