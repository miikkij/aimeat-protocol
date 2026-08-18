/**
 * @file src/services/chat-attachments.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the person attached to this turn, turned into the two things a model takes:
 *   image blocks, and text quoted into the prompt.
 *
 *   PULLED OUT OF THE TURN SO IT CAN BE PROVED. This ran inside runChatTurn, which needs a live
 *   agent process before a single line of it executes, so the only way to test a file arriving was
 *   to have goose installed. The decisions here -- picture or text, readable or not, which sentence
 *   the agent is given about a file it never saw -- are the part that is worth asserting, and they
 *   need nothing but bytes and a storage.
 *
 *   THREE KINDS, AND A FOURTH THAT IS SAID OUT LOUD. A picture goes as an image block. Text goes as
 *   text. A spreadsheet, a Word document or a PDF goes through the extractor and becomes text.
 *   Anything left over is NAMED in the prompt rather than dropped, because the agent is the one who
 *   has to tell the person their file was not read, and it can only do that if it knows.
 * @structure ReadAttachments; readAttachments()
 * @usage const { images, quoted, notes, skipped } = await readAttachments(storage, gaii, keys);
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: pure extraction out of chat-session, plus office and PDF files.
 */
import type { Storage } from '../storage/interface.js';
import type { PromptImage } from './goose-acp.js';
import { extractFileText, extractableKind, isLegacyOfficeFile, NAME } from './file-text/index.js';
import { logger } from '../utils/logger.js';

/**
 * How many files one turn may carry.
 *
 * Each one is read whole and either base64-encoded or quoted into the prompt, so the ceiling is
 * about the model's context and the node's memory rather than about politeness. Four is more than
 * any real question needs and small enough that a mistake costs a request rather than a process.
 */
export const MAX_ATTACHMENTS_PER_TURN = 4;

/** How much of a text file is quoted into the prompt. Beyond this the model is told what it has. */
const MAX_TEXT_BYTES = 200 * 1024;

export interface ReadAttachments {
    /** Pictures, as the ACP image blocks the agent takes. */
    images: PromptImage[];
    /** File contents, each already labelled with what it is and where it came from. */
    quoted: string[];
    /** Things the agent has to SAY about a file rather than read from it. */
    notes: string[];
    /** Files nothing here could open, named so the agent can admit it. */
    skipped: string[];
}

/**
 * Can this be handed to a model as text with no parsing at all?
 *
 * By mime first, because that is what the upload declared, and by extension second, because a
 * browser hands `text/plain` or nothing at all to plenty of files it has no opinion about. A format
 * that needs parsing to become text -- pdf, docx, xlsx -- answers no here and goes to the extractor.
 */
export function readableAsText(mimeType: string, key: string): boolean {
    if (mimeType.startsWith('text/')) return true;
    if (/^application\/(json|xml|yaml|x-yaml|javascript|typescript|sql|toml|x-ndjson)$/.test(mimeType)) return true;
    if (/\+(json|xml|yaml)$/.test(mimeType)) return true;
    return /\.(txt|md|markdown|csv|tsv|json|ya?ml|toml|ini|conf|log|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|cs|sh|sql|env|srt|vtt)$/i.test(key);
}

/**
 * Read the attached files from the person's OWN namespace by key.
 *
 * The browser uploaded through the ordinary presigned path, so these are their files under their
 * quota, and the key is all that travelled through the request: bytes never go through a JSON body.
 * A key that resolves to nothing is logged and skipped rather than reported, because it is a bug on
 * our side and not something the person can act on.
 */
export async function readAttachments(
    storage: Storage, gaii: string, keys: string[],
): Promise<ReadAttachments> {
    const out: ReadAttachments = { images: [], quoted: [], notes: [], skipped: [] };

    for (const key of keys.slice(0, MAX_ATTACHMENTS_PER_TURN)) {
        const file = await storage.getStorageFile(gaii, key);
        if (!file) {
            logger.warn(`[chat] attachment not found for ${gaii}: ${key}`);
            continue;
        }
        const mimeType = file.mimeType || 'application/octet-stream';
        const bytes = Buffer.from(file.data);

        if (mimeType.startsWith('image/')) {
            out.images.push({ mimeType, base64: bytes.toString('base64') });
            continue;
        }

        if (readableAsText(mimeType, key)) {
            const clipped = bytes.length > MAX_TEXT_BYTES;
            const size = clipped
                ? ` (first ${Math.round(MAX_TEXT_BYTES / 1024)} kB of ${Math.round(bytes.length / 1024)} kB)`
                : '';
            out.quoted.push(`Attached file: ${key}${size}\n\n${bytes.subarray(0, MAX_TEXT_BYTES).toString('utf8')}`);
            continue;
        }

        // A spreadsheet, a Word document or a PDF becomes text here rather than being turned away.
        // A sheet arrives as CSV, which is the shape the person's next question usually wants it in.
        const kind = extractableKind(mimeType, key);
        if (kind) {
            const got = await extractFileText(bytes, mimeType, key);
            if (got?.text) {
                out.quoted.push(`Attached ${NAME[kind]}: ${key}${got.note ? ` (${got.note})` : ''}\n\n${got.text}`);
                continue;
            }
            if (got?.note) { out.notes.push(got.note); continue; }
        }

        // Named separately from the rest: a .xls or a .doc is one Save As away from working, and
        // that is a thing the person can act on the moment they are told.
        if (isLegacyOfficeFile(key)) {
            out.notes.push('An attached file is in an older Office format that cannot be read here. Tell the person to open it and save it again as .xlsx, .docx or .pdf, then attach that.');
            continue;
        }

        out.skipped.push(`${key} (${mimeType})`);
    }
    return out;
}
