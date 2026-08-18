/**
 * @file src/services/task-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Task attachments: the create-time check and the read-time handle enrichment for
 *   `task.resources.files`. File-shaped work (read this invoice, fill this form, summarise this
 *   report) is naturally a TASK, but a task could only carry knowledge packages and memory keys, so
 *   the only way to hand an agent a document was a direct message. This is the missing half.
 *
 *   Two rules, and they are deliberately asymmetric:
 *     CREATE — the file must exist AND the CREATOR must be able to read it. This is what stops a task
 *              from becoming a way to launder a reference to someone else's data into an agent's queue.
 *              mime + size are taken from the stored file, never from the request body.
 *     READ   — authorized again, as the AGENT doing the reading, on every read. Assigning a task grants
 *              no bytes by itself: if the owner revokes access, the next read simply reports 'denied'
 *              instead of handing out a URL.
 * @structure resolveTaskFileInputs() · taskWithFileHandles()
 * @usage
 *   const r = await resolveTaskFileInputs(storage, config, body.resources?.files, creator);
 *   if ('error' in r) return res.status(r.error.status).json(...);
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial: attachments on agent tasks, riding the existing resources JSON.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord, AgentTaskFileRef } from '../storage/interface.js';
import { resolveFileRef, fileHandleFor, type FileRefAccessor, type FileHandle } from './file-refs.js';

export interface TaskFileInput {
    ref: string;
    name?: string;
}

/**
 * Validate the `resources.files` a caller supplied and turn them into stored descriptors. Returns a
 * typed error (never throws) so the route can answer 400 for a bad reference and 403 for one the
 * creator may not read — the distinction matters to whoever is building the task.
 */
export async function resolveTaskFileInputs(
    storage: Storage,
    config: AimeatConfig,
    inputs: TaskFileInput[] | undefined,
    creator: FileRefAccessor,
): Promise<{ files: AgentTaskFileRef[] } | { error: { status: number; code: string; message: string } }> {
    if (!inputs?.length) return { files: [] };

    const files: AgentTaskFileRef[] = [];
    for (const input of inputs) {
        const resolved = await resolveFileRef(storage, config, input.ref, creator);
        if (resolved.access === 'missing') {
            return {
                error: {
                    status: 400, code: 'FILE_NOT_FOUND',
                    message: `Attachment "${input.ref}" does not exist${resolved.reason === 'not_found_in_your_namespace'
                        ? '. A bare key is looked up in YOUR storage — for a file owned by someone else use "<owner@node>/<key>".' : '.'}`,
                },
            };
        }
        if (resolved.access === 'denied' || !resolved.file) {
            return {
                error: {
                    status: 403, code: 'FILE_ACCESS_DENIED',
                    message: `You may not attach "${resolved.ref}" (${resolved.reason}) — you cannot read it yourself.`,
                },
            };
        }
        files.push({
            ref: resolved.ref,
            // Server-side truth: a request that mislabels a 4 MB binary as a 10-byte text file changes nothing.
            mime: resolved.file.mimeType,
            size: resolved.file.size,
            ...(input.name ? { name: input.name } : resolved.file.key.includes('/')
                ? { name: resolved.file.key.slice(resolved.file.key.lastIndexOf('/') + 1) }
                : { name: resolved.file.key }),
        });
    }
    return { files };
}

/** A task file as the reader sees it: the stored descriptor plus a presigned URL, or a stated refusal. */
export type TaskFileHandle = AgentTaskFileRef & Omit<FileHandle, 'ref' | 'name'>;

/**
 * Return a copy of `task` whose `resources.files` entries each carry a presigned download_url (or an
 * `access`/`reason` saying why not), authorized as `reader`. The task record itself is untouched — the
 * handle is minted per read so it cannot outlive its TTL in the database.
 */
export async function taskWithFileHandles(
    storage: Storage,
    config: AimeatConfig,
    task: AgentTaskRecord,
    reader: FileRefAccessor,
): Promise<AgentTaskRecord> {
    const files = task.resources?.files;
    if (!files?.length) return task;

    const enriched: TaskFileHandle[] = [];
    for (const f of files) {
        const handle = await fileHandleFor(storage, config, f.ref, reader, { name: f.name });
        enriched.push({ ...f, ...handle, ref: f.ref, ...(f.name ? { name: f.name } : {}) });
    }
    return { ...task, resources: { ...task.resources, files: enriched } };
}
