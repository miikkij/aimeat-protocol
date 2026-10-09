/**
 * @file src/services/docsign/files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads a file the caller stored on this node (aimeat_storage_upload, the Files tab), so
 *   an AI can validate or hash a document it uploaded without carrying the bytes through its own
 *   context. The same rule as GET /v1/storage/{key}: the caller's own namespace, through the
 *   classification reader, behind storage:read. A file the caller may not see answers as absent.
 * @structure readOwnFile · documentFromStorage
 * @usage const bytes = await readOwnFile(ctx, caller, 'contracts/lease.pdf');
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { createHash } from 'node:crypto';
import type { CallerContext } from '../caller-context.js';
import { readerFor } from '../classification/reader.js';
import { fileTarget } from '../classification/labels.js';
import { DocsignError, type DocsignCtx } from './records.js';
import { docsignMaxBytes } from '../../config-docsign.js';

export async function readOwnFile(ctx: DocsignCtx, caller: CallerContext, key: string): Promise<{ data: Buffer; name: string; mimeType: string }> {
  if (!caller.has('storage:read')) throw new DocsignError('SCOPE_DENIED', 403, 'Reading a stored file needs storage:read.');
  const gaii = caller.principal;
  const meta = await ctx.storage.getStorageFileMeta(gaii, key);
  const [file] = meta ? await readerFor(ctx, caller.auth).show([meta], () => fileTarget(gaii, key, meta.workspaceRef)) : [];
  if (!file) throw new DocsignError('NOT_FOUND', 404, `File not found in your namespace: ${key}`);
  const max = docsignMaxBytes(ctx.config);
  if (file.size > max) {
    throw new DocsignError('TOO_LARGE', 413, `The file is ${file.size} bytes; this node validates files up to ${max} bytes.`);
  }
  const whole = await ctx.storage.getStorageFile(gaii, key);
  if (!whole) throw new DocsignError('NOT_FOUND', 404, `File not found in your namespace: ${key}`);
  return { data: whole.data, name: key.split('/').pop() ?? key, mimeType: file.mimeType };
}

/** A signing request's document, named by a stored file: its hash, name, size and type. */
export async function documentFromStorage(ctx: DocsignCtx, caller: CallerContext, key: string): Promise<{ sha256: string; name: string; size: number; mediaType: string | null }> {
  const file = await readOwnFile(ctx, caller, key);
  return { sha256: createHash('sha256').update(file.data).digest('hex'), name: file.name, size: file.data.length, mediaType: file.mimeType };
}
