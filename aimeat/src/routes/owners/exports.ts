/**
 * @file src/routes/owners/exports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data export as a background job, for an account of any size:
 *   - GET    /v1/owners/:name/exports/plan     the parts with their sizes, and the current export (memory:read)
 *   - POST   /v1/owners/:name/exports          queue an export of the chosen parts (memory:write)
 *   - GET    /v1/owners/:name/exports/current  its state; the download links to the account holder only (memory:read)
 *   - DELETE /v1/owners/:name/exports/current  cancel it, or remove a finished one's files (memory:write)
 *   - GET    /v1/exports/download/:token       one ZIP file; the signed link is the credential, Range works
 *   The rules and the work are in services/owner-export/ops.ts, which the MCP tool calls too.
 * @structure registerOwnerExportJobRoutes(router, config, storage)
 * @usage registerOwnerExportJobRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import { open, stat } from 'node:fs/promises';
import type { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { validateBody } from '../../models/schemas.js';
import { serveStoredFile, type StoredFileReader } from '../../utils/http-range.js';
import { EXPORT_PARTS } from '../../services/owner-export/parts.js';
import { notThere } from '../../services/owner-export/folders.js';
import { cancelExportFor, exportPlanFor, exportStatusFor, resolveDownload, startExportFor } from '../../services/owner-export/ops.js';

const StartBody = z.object({ parts: z.array(z.enum(EXPORT_PARTS)).max(EXPORT_PARTS.length).optional() });

/** Bytes of a file on disk, a range at a time: the reader serveStoredFile takes. */
function diskReader(path: string): StoredFileReader {
  const range = async (start: number, length: number): Promise<Buffer | null> => {
    const fh = await open(path, 'r').catch(notThere);
    if (!fh) return null;
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, start);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  };
  // serveStoredFile asks for the whole file only when it is shorter than one slice; a longer one goes
  // out a range at a time.
  const all = async (): Promise<Buffer | null> => {
    const s = await stat(path).catch(notThere);
    return s ? range(0, s.size) : null;
  };
  return { range, all };
}

export function registerOwnerExportJobRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const deps = { storage, config };
  const send = (res: Response, out: { ok: true; status?: number; data: Record<string, unknown> } | { ok: false; status: number; code: string; message: string }) => {
    if (out.ok) res.status(out.status ?? 200).json(success(config.nodeId, out.data));
    else res.status(out.status).json(error(config.nodeId, out.code, out.message));
  };
  const name = (req: Request) => String(req.params.name ?? '');

  router.get('/v1/owners/:name/exports/plan', requireAuth(), requireScope('memory:read'), async (req, res) => {
    send(res, await exportPlanFor(deps, callerOf(req, config.nodeId, storage), name(req)));
  });
  router.post('/v1/owners/:name/exports', requireAuth(), requireScope('memory:write'), validateBody(StartBody, config.nodeId), async (req, res) => {
    send(res, await startExportFor(deps, callerOf(req, config.nodeId, storage), name(req), req.body));
  });
  router.get('/v1/owners/:name/exports/current', requireAuth(), requireScope('memory:read'), async (req, res) => {
    send(res, await exportStatusFor(deps, callerOf(req, config.nodeId, storage), name(req)));
  });
  router.delete('/v1/owners/:name/exports/current', requireAuth(), requireScope('memory:write'), async (req, res) => {
    send(res, await cancelExportFor(deps, callerOf(req, config.nodeId, storage), name(req)));
  });

  // The signed link is the capability: it names one file of one ready export of one account and works
  // for an hour, so the browser can save it straight to disk and resume it, with no session header.
  router.get('/v1/exports/download/:token', async (req, res) => {
    const found = await resolveDownload(deps, String(req.params.token ?? ''));
    if (!found.ok) {
      res.status(found.status).json(error(config.nodeId, found.code, found.message));
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    // A reverse proxy that buffers responses (nginx by default, up to 1 GB on disk) passes this one on
    // as it comes; without it a large file stalls until the proxy's buffer is full.
    res.setHeader('X-Accel-Buffering', 'no');
    const ok = await serveStoredFile(res, {
      key: found.file, mimeType: 'application/zip', size: found.bytes, createdAt: found.finishedAt, downloadName: found.file,
    }, req.headers.range, diskReader(found.path), { headOnly: req.method === 'HEAD', conditionals: req.headers });
    if (!ok) res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'This export\'s file is not on the node any more.'));
  });
}
