/**
 * @file src/services/connections/attachment-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fetch one attachment of a connected mailbox's message and store it as a private file
 *   of the caller's owner, instead of answering its bytes.
 *
 *   WHY. A read answers the provider's JSON, and one read is capped at 4 MB of it
 *   (OUTBOUND_READ_MAX_BYTES), which is about 3 MB of attachment after base64. A scanned PDF is often
 *   larger, and an app or an agent that wants to hand the file to a model or keep it has no use for
 *   base64 in a JSON answer anyway. Here the read is allowed up to the node's per-file storage limit
 *   (config.storageMaxFileSizeMb) plus the base64 and JSON overhead, the bytes are decoded, and the
 *   file is written through writeStorageFile, so the per-file ceiling, the account quota and the
 *   overage charge are the same ones every other upload meets.
 *
 *   TWO PROVIDERS, TWO SHAPES. Gmail answers `{ size, data }` with `data` in base64url and names
 *   neither the file nor its type (those are on the message's parts, so the caller passes them).
 *   Microsoft Graph answers a fileAttachment with `name`, `contentType` and `contentBytes` in base64.
 * @structure StoreAttachmentInput · StoreAttachmentResult · decodeAttachment() · storeMailAttachment()
 * @usage const out = await storeMailAttachment(ctx, deps, ownerGhii, connectionId, { message_id, attachment_id, filename });
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import type { ConnectContext } from './oauth.js';
import { readResource } from './read.js';
import { writeStorageFile, type StorageWriteDeps } from '../storage-file-write.js';

/** As a request body arrives: every field is checked here, so none is trusted to be present. */
export interface StoreAttachmentInput {
    message_id?: unknown;
    attachment_id?: unknown;
    /** Where to store it. Defaults to mail/<provider>/<message id>/<file name>. */
    key?: unknown;
    /** The file name, from the message's parts. Gmail's attachment answer does not carry one. */
    filename?: unknown;
    mime_type?: unknown;
}

export type StoreAttachmentResult =
    | { ok: true; provider: string; key: string; filename: string; mime_type: string; size: number }
    | { ok: false; status: number; code: string; message: string };

/** The JSON and base64 overhead on top of the file itself: base64 is 4/3, plus the envelope. */
function readCeiling(fileMaxBytes: number): number {
    return Math.ceil(fileMaxBytes * 4 / 3) + 256 * 1024;
}

const MIME_BY_EXTENSION: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', txt: 'text/plain', csv: 'text/csv',
    xml: 'application/xml', json: 'application/json', html: 'text/html',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** A file name safe inside a storage key: letters, digits, dot, dash and underscore. */
function safeName(value: string): string {
    const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 120);
    return cleaned || 'attachment';
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * The bytes, file name and type out of a provider's attachment answer, or null when the answer is
 * not an attachment this code knows how to read (an Outlook item attachment is a message, not a file).
 */
export function decodeAttachment(data: unknown): { bytes: Buffer; name: string; type: string } | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (typeof d.contentBytes === 'string') {
        return { bytes: Buffer.from(d.contentBytes, 'base64'), name: text(d.name), type: text(d.contentType) };
    }
    if (typeof d.data === 'string') {
        return { bytes: Buffer.from(d.data, 'base64url'), name: '', type: '' };
    }
    return null;
}

/** Fetch one attachment and store it as a private file of `ownerGhii`. */
export async function storeMailAttachment(
    ctx: ConnectContext,
    deps: StorageWriteDeps,
    ownerGhii: string,
    connectionId: string,
    input: StoreAttachmentInput,
): Promise<StoreAttachmentResult> {
    const messageId = text(input.message_id);
    const attachmentId = text(input.attachment_id);
    if (!messageId || !attachmentId) {
        return { ok: false, status: 400, code: 'BAD_PARAMETERS', message: 'Name the message (message_id) and the attachment (attachment_id).' };
    }

    const fileMax = deps.config.storageMaxFileSizeMb * 1024 * 1024;
    const read = await readResource(ctx, connectionId, 'attachment',
        { message_id: messageId, attachment_id: attachmentId }, { maxBytes: readCeiling(fileMax) });
    if (!read.ok) {
        const status = read.code === 'TOO_LARGE' ? 413
            : read.code === 'NO_SUCH_RESOURCE' || read.code === 'BAD_PARAMETERS' ? 400
                : read.code === 'MISSING_PERMISSION' || read.code === 'REFUSED_BY_PROVIDER' ? 403
                    : read.code === 'NOT_FOUND' ? 404
                        : read.code === 'REVOKED' || read.code === 'UNREADABLE' ? 409 : 502;
        const message = read.code === 'TOO_LARGE'
            ? `The attachment is larger than this node stores in one file (${deps.config.storageMaxFileSizeMb} MB).`
            : read.message;
        return { ok: false, status, code: read.code, message };
    }

    const decoded = decodeAttachment(read.data);
    if (!decoded) {
        return {
            ok: false, status: 422, code: 'NOT_A_FILE',
            message: 'That attachment is not a file (it may be an attached message or a link), so there is nothing to store.',
        };
    }

    const filename = safeName(text(input.filename) || decoded.name || attachmentId.slice(0, 40));
    const extension = (filename.split('.').pop() || '').toLowerCase();
    const mimeType = text(input.mime_type) || decoded.type || MIME_BY_EXTENSION[extension] || 'application/octet-stream';
    const key = text(input.key) || `mail/${read.provider}/${safeName(messageId)}/${filename}`;

    const written = await writeStorageFile(deps, ownerGhii, { key, data: decoded.bytes, mimeType, visibility: 'private' });
    if (!written.ok) return { ok: false, status: written.status, code: written.code, message: written.message };
    return { ok: true, provider: read.provider, key, filename, mime_type: mimeType, size: decoded.bytes.length };
}
