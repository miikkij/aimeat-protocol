import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function storageFilesRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/storage — upload file (agent auth)
  router.post('/v1/storage', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;

    // Accept raw body or JSON with base64 data
    const contentType = req.headers['content-type'] ?? '';
    let key: string;
    let visibility: string;
    let fileData: Buffer;
    let mimeType: string;

    if (contentType.includes('application/json')) {
      const { key: k, visibility: v, data, mime_type } = req.body ?? {};
      if (!k || !data) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and data (base64) are required'));
        return;
      }
      key = k;
      visibility = v ?? 'private';
      fileData = Buffer.from(data, 'base64');
      mimeType = mime_type ?? 'application/octet-stream';
    } else {
      // Raw body upload
      key = req.query.key as string ?? `file-${Date.now()}`;
      visibility = req.query.visibility as string ?? 'private';
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      fileData = Buffer.concat(chunks);
      mimeType = contentType || 'application/octet-stream';
    }

    // 10MB limit
    if (fileData.length > 10 * 1024 * 1024) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', 'File size exceeds 10MB limit'));
      return;
    }

    const file = await storage.createStorageFile({
      key,
      ownerGaii: gaii,
      visibility: visibility as 'private' | 'owner' | 'public',
      mimeType,
      size: fileData.length,
      data: fileData,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      key: file.key,
      size: file.size,
      mime_type: file.mimeType,
      visibility: file.visibility,
      created_at: file.createdAt,
    }, [
      { description: 'Download this file', method: 'GET', url: `/v1/storage/${encodeURIComponent(key)}` },
      { description: 'List all files', method: 'GET', url: '/v1/storage' },
    ]));
  });

  // GET /v1/storage — list storage items (agent auth)
  router.get('/v1/storage', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const files = await storage.listStorageFiles(gaii);

    res.json(success(config.nodeId, {
      files: files.map(f => ({
        key: f.key,
        size: f.size,
        mime_type: f.mimeType,
        visibility: f.visibility,
        created_at: f.createdAt,
      })),
      total: files.length,
    }));
  });

  // GET /v1/storage/:key — download file (agent auth)
  router.get('/v1/storage/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const key = decodeURIComponent(req.params.key as string);
    const file = await storage.getStorageFile(gaii, key);
    if (!file) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
      return;
    }

    // Range header support
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : file.size - 1;
        const chunk = file.data.subarray(start, end + 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
        res.setHeader('Content-Length', chunk.length);
        res.setHeader('Content-Type', file.mimeType);
        res.end(chunk);
        return;
      }
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size);
    res.end(file.data);
  });

  // HEAD /v1/storage/:key — file metadata (agent auth)
  router.head('/v1/storage/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const key = decodeURIComponent(req.params.key as string);
    const file = await storage.getStorageFile(gaii, key);
    if (!file) {
      res.status(404).end();
      return;
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size);
    res.setHeader('X-AIMEAT-Visibility', file.visibility);
    res.setHeader('X-AIMEAT-Created', file.createdAt);
    res.status(200).end();
  });

  // DELETE /v1/storage/:key — delete file (agent auth)
  router.delete('/v1/storage/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const key = decodeURIComponent(req.params.key as string);
    const deleted = await storage.deleteStorageFile(gaii, key);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
      return;
    }

    res.json(success(config.nodeId, { deleted: true, key }));
  });

  return router;
}
