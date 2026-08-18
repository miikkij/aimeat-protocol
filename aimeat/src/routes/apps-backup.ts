/**
 * @file apps-backup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Owner app-catalog backup endpoints:
 *   GET  /v1/apps/backup          — streamed ZIP of every app (every version) + own cortex extensions
 *   POST /v1/apps/backup/inspect  — parse an uploaded backup, report contents/conflicts, write NOTHING
 *   POST /v1/apps/backup/restore  — selectively restore (per-app versions + conflict mode)
 *   Inspect caches the parsed backup under a short-lived token so restore does
 *   not need a second upload; restore also accepts { zip_base64 } directly.
 *   Mirrors the organism import hardening: safeUnzip + ZIP_REJECTED (422) +
 *   security-incident quarantine. Owner role required; restore always writes to
 *   the caller's own account regardless of the backup's source owner.
 * @structure appsBackupRouter(config, storage) — mount BEFORE appsRouter.
 * @version-history
 *   v1.0.0 — 2026-06-12 — Initial: app-catalog backup export + selective import
 */
import { Router, raw } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { recordSecurityIncident } from '../services/security-incident.js';
import { exportAppsBackup } from '../services/apps-backup-export.js';
import {
  parseAppsBackup, inspectAppsBackup, restoreAppsBackup,
  type ParsedAppsBackup, type AppSelection, type ExtSelection,
} from '../services/apps-backup-import.js';
import { randomBytes } from 'node:crypto';
import { logger } from '../utils/logger.js';

// Parsed-backup cache: inspect → token → restore without re-uploading the ZIP.
const TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED = 20;
interface CachedBackup { parsed: ParsedAppsBackup; ownerGhii: string; expires: number }
const backupCache = new Map<string, CachedBackup>();

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of backupCache) if (v.expires < now) backupCache.delete(k);
  while (backupCache.size > MAX_CACHED) {
    const oldest = backupCache.keys().next().value as string | undefined;
    if (!oldest) break;
    backupCache.delete(oldest);
  }
}

export function appsBackupRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Same canonicalization as appsRouter — apps live in the owner's GHII bucket.
  const canonicalOwner = async (req: Express.Request): Promise<{ owner: string; ownerGhii: string }> => {
    const rawOwner = req.auth!.owner;
    const owner = rawOwner.includes('@') ? rawOwner.split('@')[0] : rawOwner;
    const ownerGhii = await resolveGhii(storage, owner, `${owner}@${config.nodeId}`);
    return { owner, ownerGhii };
  };

  // Raw ZIP body for inspect (JSON bodies pass through the global parser instead)
  const zipBody = raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '128mb' });

  const readZipBody = (req: Request): Buffer | null => {
    if (Buffer.isBuffer(req.body)) return req.body.length > 0 ? req.body : null;
    const b64 = (req.body as { zip_base64?: string } | undefined)?.zip_base64;
    return typeof b64 === 'string' && b64.length > 0 ? Buffer.from(b64, 'base64') : null;
  };

  const zipRejected = async (req: Request, res: Response, e: ZipSecurityError, buf: Buffer, source: string) => {
    const inc = await recordSecurityIncident(storage, config, {
      type: 'zip_import', code: e.code,
      actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string,
      detail: e.message, source, blob: buf,
    });
    res.status(422).json(error(config.nodeId, 'ZIP_REJECTED',
      `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
  };

  // ── GET /v1/apps/backup — streamed ZIP of the caller's whole catalog ──
  router.get('/v1/apps/backup', requireAuth(), requireRole('owner'), async (req, res) => {
    const { owner, ownerGhii } = await canonicalOwner(req);
    const exportedAt = new Date().toISOString();
    const date = exportedAt.slice(0, 10);
    const safeOwner = owner.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'owner';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="aimeat-apps-${safeOwner}-${date}.zip"`);
    try {
      await exportAppsBackup(storage, config, { owner, ownerGhii, exportedAt }, res);
      res.end();
    } catch (e) {
      logger.error('Apps backup export failed', { error: (e as Error).message, owner });
      if (!res.headersSent) {
        res.removeHeader('Content-Disposition');
        res.status(500).json(error(config.nodeId, 'EXPORT_FAILED', 'Could not build the backup archive'));
      } else {
        res.destroy();
      }
    }
  });

  // ── POST /v1/apps/backup/inspect — parse + report, write nothing ──
  router.post('/v1/apps/backup/inspect', requireAuth(), requireRole('owner'), zipBody, async (req, res) => {
    const buf = readZipBody(req);
    if (!buf) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'Send the backup ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }'));
      return;
    }
    const { ownerGhii } = await canonicalOwner(req);
    try {
      const parsed = await parseAppsBackup(buf);
      const inspection = await inspectAppsBackup(storage, ownerGhii, parsed);
      pruneCache();
      const token = randomBytes(16).toString('hex');
      backupCache.set(token, { parsed, ownerGhii, expires: Date.now() + TOKEN_TTL_MS });
      res.json(success(config.nodeId, {
        backup_token: token,
        expires_in_seconds: TOKEN_TTL_MS / 1000,
        ...inspection,
      }));
    } catch (e) {
      if (e instanceof ZipSecurityError) { await zipRejected(req, res, e, buf, 'apps_backup_inspect'); return; }
      res.status(400).json(error(config.nodeId, 'INVALID_BACKUP', (e as Error).message || 'Could not parse the backup'));
    }
  });

  // ── POST /v1/apps/backup/restore — selective restore ──
  router.post('/v1/apps/backup/restore', requireAuth(), requireRole('owner'), async (req, res) => {
    const body = (req.body ?? {}) as {
      backup_token?: string;
      zip_base64?: string;
      selections?: AppSelection[];
      extensions?: ExtSelection[];
    };
    const { owner, ownerGhii } = await canonicalOwner(req);

    let parsed: ParsedAppsBackup | null = null;
    if (typeof body.backup_token === 'string') {
      pruneCache();
      const cached = backupCache.get(body.backup_token);
      if (cached && cached.ownerGhii === ownerGhii) parsed = cached.parsed;
    }
    if (!parsed && typeof body.zip_base64 === 'string' && body.zip_base64.length > 0) {
      const buf = Buffer.from(body.zip_base64, 'base64');
      try {
        parsed = await parseAppsBackup(buf);
      } catch (e) {
        if (e instanceof ZipSecurityError) { await zipRejected(req, res, e, buf, 'apps_backup_restore'); return; }
        res.status(400).json(error(config.nodeId, 'INVALID_BACKUP', (e as Error).message || 'Could not parse the backup'));
        return;
      }
    }
    if (!parsed) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'Provide a valid backup_token from /v1/apps/backup/inspect (or zip_base64). Tokens expire after 30 minutes.'));
      return;
    }

    const selections = Array.isArray(body.selections) ? body.selections : [];
    const extSelections = Array.isArray(body.extensions) ? body.extensions : [];
    if (selections.length === 0 && extSelections.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'selections is empty — nothing to restore'));
      return;
    }
    for (const s of selections) {
      if (s.conflict !== undefined && !['skip', 'append', 'copy'].includes(s.conflict)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid conflict mode "${String(s.conflict)}" for "${s.filename}"`));
        return;
      }
    }

    const summary = await restoreAppsBackup(storage, { owner, ownerGhii, parsed, selections, extensions: extSelections });
    res.json(success(config.nodeId, summary));
  });

  return router;
}
