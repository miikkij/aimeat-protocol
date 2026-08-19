/**
 * @file src/storage/providers/sqlite/methods/apps-listing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalogue-listing query for the SQLite backend, extracted from methods/apps.ts
 *   (max-file-lines). One query serves both doors: listApps reads metadata only, listAppsWithContent
 *   adds the bytes, and the select clause is the single difference between them.
 * @structure SUMMARY_COLUMNS (every AppRecord column except `data`) · runAppListing(self, selectClause, opts, deserialize)
 * @usage import { SUMMARY_COLUMNS, runAppListing } from './apps-listing.js';
 * @version-history
 *   v1.0.0 — 2026-08-19 — Extracted with the listApps payload fix: a listing no longer reads the
 *     apps' bytes, which is what made the production catalogue a flat 3.5 s request.
 */
import type { AppListOptions } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

/**
 * The `apps` columns a LISTING selects — every AppRecord field except `data`, the app's own bytes.
 * A catalogue card renders a name, a description and some badges; carrying the payload of 130 apps
 * through the row mapper for that is pure cost. Kept as one string so the COUNT(*) rewrite in
 * listApps can swap the exact same select clause.
 */
export const SUMMARY_COLUMNS = [
  'a.ownerGaii', 'a.ownerName', 'a.filename', 'a.versionNumber', 'a.manifest', 'a.mimeType',
  'a.size', 'a.accessCode', 'a.parked', 'a.forkable', 'a.operatorHidden', 'a.operatorHiddenBy',
  'a.operatorHiddenAt', 'a.operatorHideReason', 'a.aiProvenanceId', 'a.createdAt',
].join(', ');

/**
 * One listing query, shared by listApps (metadata only) and listAppsWithContent (bytes included).
 * `selectClause` is the ONLY difference between them, and the COUNT(*) rewrite below swaps that
 * exact clause — so the two doors can never drift into two different filter sets.
 */
export async function runAppListing<T>(
  self: SqliteStorage,
  selectClause: string,
  opts: AppListOptions | undefined,
  deserialize: (row: Record<string, unknown>) => T,
): Promise<{ apps: T[]; total: number }> {
  // Get latest version of each app
  let query = `SELECT ${selectClause} FROM apps a
    INNER JOIN (SELECT ownerGaii, filename, MAX(versionNumber) as maxVer FROM apps GROUP BY ownerGaii, filename) latest
    ON a.ownerGaii = latest.ownerGaii AND a.filename = latest.filename AND a.versionNumber = latest.maxVer`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.ownerGaii) {
    conditions.push(`a.ownerGaii = ?`);
    params.push(opts.ownerGaii);
  }
  if (opts?.category) {
    conditions.push(`json_extract(a.manifest, '$.category') = ?`);
    params.push(opts.category);
  }
  if (opts?.tag) {
    conditions.push(`a.manifest LIKE ?`);
    params.push(`%"${opts.tag}"%`);
  }
  if (opts?.q) {
    conditions.push(`(a.filename LIKE ? OR json_extract(a.manifest, '$.name') LIKE ? OR json_extract(a.manifest, '$.description') LIKE ?)`);
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  if (opts?.freeOnly) {
    conditions.push(`(json_extract(a.manifest, '$.priceMorsels') IS NULL OR json_extract(a.manifest, '$.priceMorsels') = 0)`);
  }
  // Parked + operator-hidden apps are hidden from everyone EXCEPT their owner
  // (viewerGhii) — decided purely from who is authenticated. The owner sees their
  // own (operator-hidden ones carry operator_hidden=true so the client can badge
  // them); everyone else does not. An explicit ownerGaii filter already scopes to
  // one owner, so skip the clause there. adminView sees EVERYTHING.
  if (!opts?.ownerGaii && !opts?.adminView) {
    if (opts?.viewerGhii) {
      conditions.push(`(a.parked = 0 OR a.ownerGaii = ?)`);
      params.push(opts.viewerGhii);
      conditions.push(`(a.operatorHidden = 0 OR a.ownerGaii = ?)`);
      params.push(opts.viewerGhii);
    } else {
      conditions.push(`a.parked = 0`);
      conditions.push(`a.operatorHidden = 0`);
    }
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  // Count total before pagination
  const countQuery = query.replace(`SELECT ${selectClause}`, 'SELECT COUNT(*) as cnt');
  const countRow = self.db.prepare(countQuery).get(...params) as { cnt: number };
  const total = countRow.cnt;

  // Sort
  if (opts?.sort === 'popular') {
    query += ` ORDER BY (SELECT COALESCE(d.downloads, 0) FROM app_downloads d WHERE d.ownerGaii = a.ownerGaii AND d.filename = a.filename) DESC, a.createdAt DESC`;
  } else {
    query += ' ORDER BY a.createdAt DESC';
  }

  // Pagination
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = self.db.prepare(query).all(...params) as Record<string, unknown>[];
  return { apps: rows.map(deserialize), total };
}
