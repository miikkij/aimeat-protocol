/**
 * @file packages.ts
 * @description Package API routes — CRUD, versioning, export/import for AIMEAT packages.
 *   Packages are versioned bundles of AIMEAT components (CSM, Extension, Cortex, App, MSM, Memory, Translation).
 * @structure
 *   - packagesRouter() — main router factory
 *   - POST /v1/bundles — create package (first version)
 *   - POST /v1/bundles/:groupId/versions — publish new version
 *   - GET /v1/bundles — list packages
 *   - GET /v1/bundles/:groupId — get latest published
 *   - GET /v1/bundles/:groupId/versions — list all versions
 *   - GET /v1/bundles/:groupId/versions/:version — get specific version
 *   - PATCH /v1/bundles/:groupId — update group metadata
 *   - PATCH /v1/bundles/:groupId/versions/:version — update version status
 *   - DELETE /v1/bundles/:groupId/versions/:version — archive version
 *   - GET /v1/bundles/:groupId/export — export as YAML bundle
 *   - POST /v1/bundles/import — import from YAML bundle
 * @usage
 *   import { packagesRouter } from '../routes/packages.js';
 *   app.use(packagesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 2)
 *   v1.1.0 — 2026-03-15 — rename routes from /v1/packages to /v1/bundles to avoid collision with knowledge system
 */

import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord, PackageComponent } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';

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

const MAX_PACKAGES_PER_AUTHOR = 100;
const VALID_STATUSES = ['draft', 'published', 'archived'] as const;
const VALID_VISIBILITIES = ['private', 'public'] as const;

export function packagesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── Static routes FIRST (before parameterized :groupId) ──────────

  // POST /v1/bundles/import — import from YAML bundle
  router.post('/v1/bundles/import', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const roles = req.auth!.roles;

    // Role check: operator always allowed, owner only if configured
    const createRole = (config as any).packageCreateRole ?? 'owner';
    if (!roles.includes('operator') && createRole === 'operator') {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only operators can import packages'));
      return;
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Request body must be a valid package object'));
      return;
    }

    try {
      const now = new Date().toISOString();
      const id = randomUUID();
      const name = body.name as string;
      const author = owner;
      // TODO: resolve owner's GHII via identity system when integration is confirmed
      const authorGhii = req.auth!.sub;
      const packageGroupId = `${name}::${author}`;
      const version = generateVersion();

      const components: PackageComponent[] = (body.components ?? []).map((c: any) => ({
        id: c.id,
        type: c.type,
        label: c.label ?? '',
        content: c.content ?? '',
        contentHash: hashContent(c.content ?? ''),
        dependencies: c.dependencies ?? [],
      }));

      const record: PackageRecord = {
        id,
        packageGroupId,
        name,
        author,
        authorGhii,
        version,
        changelog: body.changelog ?? 'Imported package',
        description: body.description ?? '',
        category: body.category ?? 'other',
        tags: body.tags ?? [],
        visibility: body.visibility ?? 'private',
        status: body.status ?? 'draft',
        components,
        manifest: body.manifest ?? '',
        createdAt: now,
        updatedAt: now,
      };

      const created = await storage.createPackage(record);
      res.status(201).json(success(config.nodeId, created, [
        { description: 'View package', method: 'GET', url: `/v1/bundles/${encodeURIComponent(packageGroupId)}` },
      ]));
      emitChange('packages');
    } catch (e: any) {
      res.status(500).json(error(config.nodeId, 'IMPORT_FAILED', e.message ?? 'Import failed'));
    }
  });

  // GET /v1/bundles — list packages
  router.get('/v1/bundles', async (req, res) => {
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

  // POST /v1/bundles — create package (first version)
  router.post('/v1/bundles', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const roles = req.auth!.roles;

    // Role check: operator always allowed, owner only if configured
    const createRole = (config as any).packageCreateRole ?? 'owner';
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

    // Check max packages per author
    const maxPerAuthor = (config as any).packageMaxPerAuthor ?? MAX_PACKAGES_PER_AUTHOR;
    const existing = await storage.listPackages({ author: owner, limit: 1, offset: 0 });
    if (existing.total >= maxPerAuthor) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
        `Maximum ${maxPerAuthor} packages per author. Archive unused packages first.`));
      return;
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const version = generateVersion();
    const packageGroupId = `${name}::${owner}`;
    // TODO: resolve owner's GHII via identity system when integration is confirmed
    const authorGhii = req.auth!.sub;

    const processedComponents: PackageComponent[] = components.map((c: any) => ({
      id: c.id,
      type: c.type,
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
        { description: 'Publish new version', method: 'POST', url: `/v1/bundles/${encodeURIComponent(packageGroupId)}/versions` },
        { description: 'View package', method: 'GET', url: `/v1/bundles/${encodeURIComponent(packageGroupId)}` },
      ]));
      emitChange('packages');
    } catch (e: any) {
      if (e.message === 'PACKAGE_EXISTS') {
        res.status(409).json(error(config.nodeId, 'CONFLICT', `Package "${name}" already exists for this author`));
        return;
      }
      throw e;
    }
  });

  // ── Parameterized routes ─────────────────────────────────────────

  // POST /v1/bundles/:groupId/versions — publish new version
  router.post('/v1/bundles/:groupId/versions', requireAuth(), async (req, res) => {
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

    const processedComponents: PackageComponent[] = (components ?? anyVersion.components).map((c: any) => ({
      id: c.id,
      type: c.type,
      label: c.label ?? '',
      content: c.content ?? '',
      contentHash: c.contentHash ?? hashContent(c.content ?? ''),
      dependencies: c.dependencies ?? [],
    }));

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
      { description: 'View version', method: 'GET', url: `/v1/bundles/${encodeURIComponent(groupId)}/versions/${version}` },
    ]));
    emitChange('packages');
  });

  // GET /v1/bundles/:groupId/versions/:version — get specific version
  router.get('/v1/bundles/:groupId/versions/:version', async (req, res) => {
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

  // GET /v1/bundles/:groupId/versions — list all versions
  router.get('/v1/bundles/:groupId/versions', async (req, res) => {
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

  // GET /v1/bundles/:groupId/export — export as YAML bundle
  router.get('/v1/bundles/:groupId/export', async (req, res) => {
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

    // YAML placeholder — returns JSON stringified for now; full YAML export can be enhanced later
    res.setHeader('Content-Type', 'text/yaml');
    res.send(JSON.stringify(pkg, null, 2));
  });

  // GET /v1/bundles/:groupId — get latest published version
  router.get('/v1/bundles/:groupId', async (req, res) => {
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
      { description: 'List all versions', method: 'GET', url: `/v1/bundles/${encodeURIComponent(groupId)}/versions` },
      { description: 'Export as YAML', method: 'GET', url: `/v1/bundles/${encodeURIComponent(groupId)}/export` },
    ]));
  });

  // PATCH /v1/bundles/:groupId/versions/:version — update version status
  router.patch('/v1/bundles/:groupId/versions/:version', requireAuth(), async (req, res) => {
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

  // PATCH /v1/bundles/:groupId — update group metadata (all versions)
  router.patch('/v1/bundles/:groupId', requireAuth(), async (req, res) => {
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

  // DELETE /v1/bundles/:groupId/versions/:version — archive version
  router.delete('/v1/bundles/:groupId/versions/:version', requireAuth(), async (req, res) => {
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
      { description: 'List remaining versions', method: 'GET', url: `/v1/bundles/${encodeURIComponent(groupId)}/versions` },
    ]));
    emitChange('packages');
  });

  return router;
}
