/**
 * @file src/routes/memory/files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description File-storage routes under /v1/memory/files: upload (presigned or inline base64),
 *   visibility/tags PATCH, list, download, delete. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-10 — Security audit H-12: upload, visibility and download enforce storage:write /
 *     storage:read, matching the /v1/storage twin over the same store. This route was the unscoped way in.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 *   v1.1.0 — 2026-07-31 — POST accepts `mode: 'presigned'` and mints an upload URL, so a file no
 *     longer has to fit inside a JSON body. Inline base64 was the ONLY way in, and this route is not
 *     on server.ts's large-body list, so every upload here died at security.json_body_limit_mb (5 MB
 *     of JSON = ~3.7 MB of file) with a bare 413 — while quota.storage_max_file_size_mb said 50.
 */

import type { Router } from 'express';
import type { StorageFileRecord } from '../../storage/interface.js';
import { normalizeWorkspaceRefs } from '../../utils/workspace-ref.js';
import { requireAuth, requireRole, requireExternalPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { checkStorageQuota, chargeOverage } from '../../services/quota.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../../services/doc-images.js';
import { emitChange } from '../../services/event-bus.js';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { sniffedContentType } from '../../utils/app-content-type.js';
import { generateUploadToken, buildUploadMeta } from '../../services/upload-token.js';
import type { MemoryRouteCtx } from './shared.js';

export function registerFilesRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, resolve } = ctx;

  // ── /v1/memory/files — File storage (MUST be before :key routes) ──

  // POST /v1/memory/files — upload file (presigned URL, or inline base64 JSON body)
  router.post('/v1/memory/files', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
    const gaii = resolve(req);
    const { key, content, mime_type, visibility, tags, workspaceRef, workspace_refs, mode, group_id } = req.body ?? {};

    // `content` is required only for the inline path; a presigned mint carries no bytes at all.
    if (!key || (mode !== 'presigned' && !content)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and content (base64) are required'));
      return;
    }

    // Files now share memory's full tier set. 'workspace' names one or more "<org>/<ws>" (a file can be
    // shared into several workspaces) so members of ANY of them can read it (authorizeRead/canReadWorkspace).
    const VIS = ['private', 'owner', 'group', 'workspace', 'members', 'public'];
    if (visibility !== undefined && !VIS.includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `visibility must be one of: ${VIS.join(', ')}`));
      return;
    }
    const wsRefStr = normalizeWorkspaceRefs(workspace_refs, workspaceRef);
    if (visibility === 'workspace' && !wsRefStr) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility "workspace" requires workspace_refs (or workspaceRef) as one or more "<organismId>/<workspaceId>"'));
      return;
    }

    // ── PRESIGNED MODE: mint a one-shot URL, the caller PUTs the raw bytes to /v1/upload/:token ──
    // The bytes then skip body parsing entirely (server.ts excludes /v1/upload/), so the only ceiling
    // left is the one the operator actually set: quota.storage_max_file_size_mb.
    if (mode === 'presigned') {
      const contentType = (mime_type as string) ?? 'application/octet-stream';
      const maxBytes = config.storageMaxFileSizeMb * 1024 * 1024;
      const token = await generateUploadToken({
        sub: gaii,
        utype: 'storage',
        meta: buildUploadMeta('storage', {
          key, mime_type: contentType, visibility: visibility ?? 'private',
          group_id, tags, workspace_refs: wsRefStr,
        }),
        maxBytes,
        contentType,
      });
      res.json(success(config.nodeId, {
        upload_url: `${config.baseUrl}/v1/upload/${token}`,
        upload_method: 'PUT',
        content_type: contentType,
        max_size_bytes: maxBytes,
        expires_in_seconds: 3600,
      }, [{ description: 'PUT the raw file bytes here', method: 'PUT', url: `/v1/upload/${token}` }]));
      return;
    }

    const fileData = decodeStrictBase64(content);
    if (!fileData) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content must be base64-encoded'));
      return;
    }

    // Per-file size limit
    if (fileData.length > config.storageMaxFileSizeMb * 1024 * 1024) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `File size exceeds ${config.storageMaxFileSizeMb}MB limit`));
      return;
    }

    // Total storage quota enforcement
    const storageQuota = await checkStorageQuota(config, storage, gaii, fileData.length);
    if (!storageQuota.allowed) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', storageQuota.reason!));
      return;
    }

    const parsedTags = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);
    const file = await storage.createStorageFile({
      key,
      ownerGaii: gaii,
      visibility: (visibility as StorageFileRecord['visibility']) ?? 'private',
      workspaceRef: visibility === 'workspace' ? wsRefStr : undefined,
      mimeType: mime_type ?? 'application/octet-stream',
      size: fileData.length,
      data: fileData,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      createdAt: new Date().toISOString(),
    });

    if (storageQuota.overageMorsels > 0) {
      await chargeOverage(storage, gaii, storageQuota.overageMorsels, 'storage_overage');
    }

    emitResourceUpdated(gaii, `aimeat://storage/${encodeURIComponent(key)}`);
    emitResourceListChanged(gaii);

    res.status(201).json(success(config.nodeId, {
      key: file.key,
      owner_gaii: file.ownerGaii,   // so a client can build the owner-addressed /v1/pub/<owner>/<key> embed URL
      size: file.size,
      mime_type: file.mimeType,
      visibility: file.visibility,
      tags: file.tags || [],
      created_at: file.createdAt,
      // Ready-to-embed, owner-addressed URL. Embedding this in a workspace document scopes the file to
      // that workspace's members on save (never the public internet) — use it, not /v1/memory/files/<key>.
      embed_url: pubEmbedUrl(file.ownerGaii, file.key),
      embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
    }));
    emitChange('memory');
  });

  // PATCH /v1/memory/files/:key/visibility — update file visibility
  // Registered BEFORE generic :key PATCH to avoid Express matching "key/visibility" as a single param
  router.patch('/v1/memory/files/:key/visibility', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    const { visibility, workspaceRef, workspace_refs } = req.body ?? {};

    // Full tier parity (was private/owner/public only). 'workspace' (re)binds the file to one or more
    // "<org>/<ws>" — this is how a file gets shared into an ADDITIONAL workspace: PATCH the full desired
    // list. requireExternalPrincipal (not requireRole('agent')) so an app/owner can rebind its OWN file.
    const VIS = ['private', 'owner', 'group', 'workspace', 'members', 'public'];
    if (!visibility || !VIS.includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `visibility must be one of: ${VIS.join(', ')}`));
      return;
    }
    const wsRefStr = normalizeWorkspaceRefs(workspace_refs, workspaceRef);
    if (visibility === 'workspace' && !wsRefStr) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility "workspace" requires workspace_refs (or workspaceRef) as one or more "<organismId>/<workspaceId>"'));
      return;
    }

    const updated = await storage.updateFileVisibility(gaii, key, visibility, visibility === 'workspace' ? wsRefStr : undefined);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
      return;
    }

    res.json(success(config.nodeId, {
      key: updated.key,
      visibility: updated.visibility,
    }));
    emitChange('memory');
  });

  // PATCH /v1/memory/files/:key — update file tags
  router.patch('/v1/memory/files/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    const { tags } = req.body ?? {};

    if (!Array.isArray(tags)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'tags must be an array of strings'));
      return;
    }

    if (tags.length > 20 || tags.some((t: unknown) => typeof t !== 'string' || (t as string).length > 64)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Max 20 tags, each max 64 characters'));
      return;
    }

    const updated = await storage.updateFileTagsByKey(gaii, key, tags);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
      return;
    }

    res.json(success(config.nodeId, {
      key: updated.key,
      size: updated.size,
      mime_type: updated.mimeType,
      visibility: updated.visibility,
      tags: updated.tags || [],
      created_at: updated.createdAt,
    }));
    emitChange('memory');
  });

  // GET /v1/memory/files — list files (owner sees all agents' files + GHII files)
  router.get('/v1/memory/files', requireAuth(), requireRole('agent'), async (req, res) => {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    let files: Awaited<ReturnType<typeof storage.listStorageFiles>>;
    if (isOwnerSession) {
      const callerOwner = req.auth!.owner as string;
      const ownerGhii = `${callerOwner}@${config.nodeId}`;
      const agents = await storage.getAgentsByOwner(callerOwner);
      files = [];
      // Include GHII's own files first
      files.push(...await storage.listStorageFiles(ownerGhii));
      for (const agent of agents) {
        files.push(...await storage.listStorageFiles(agent.gaii));
      }
    } else {
      files = await storage.listStorageFiles(req.auth!.sub);
    }

    if (req.query.count === 'true') {
      res.json(success(config.nodeId, {
        count: files.length,
        max_file_size_bytes: config.storageMaxFileSizeMb * 1024 * 1024,
      }));
      return;
    }

    res.json(success(config.nodeId, {
      files: files.map(f => ({
        key: f.key,
        owner_gaii: f.ownerGaii,
        size: f.size,
        mime_type: f.mimeType,
        visibility: f.visibility,
        tags: f.tags || [],
        created_at: f.createdAt,
      })),
      total: files.length,
      // So a client can state the REAL limit instead of a hardcoded one. The upload form said
      // "Max 10MB per file" on a node configured for 50, which is the same lie from the other side
      // as the 10 MB the MCP tool used to mint.
      max_file_size_bytes: config.storageMaxFileSizeMb * 1024 * 1024,
    }));
  });

  // GET /v1/memory/files/:key — download file
  router.get('/v1/memory/files/:key', requireAuth(), requireExternalPrincipal(), requireScope('storage:read'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    const file = await storage.getStorageFile(gaii, key);

    if (!file) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
      return;
    }

    res.setHeader('Content-Type', sniffedContentType(file.mimeType, file.data));
    res.setHeader('Content-Length', file.size);
    res.end(file.data);
  });

  // DELETE /v1/memory/files/:key — delete file
  router.delete('/v1/memory/files/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;

    const existing = await storage.getStorageFile(gaii, key);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
      return;
    }
    if (existing.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only delete your own files'));
      return;
    }

    await storage.deleteStorageFile(gaii, key);

    emitResourceUpdated(gaii, `aimeat://storage/${encodeURIComponent(key)}`);
    emitResourceListChanged(gaii);

    res.json(success(config.nodeId, { deleted: key }));
    emitChange('memory');
  });
}
