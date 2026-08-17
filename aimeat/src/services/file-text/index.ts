/**
 * @file src/services/file-text/index.ts
 * @description Turns the three file formats people actually attach -- a spreadsheet, a Word
 *   document, a PDF -- into text a model can read.
 *
 *   WHY THIS EXISTS AT ALL. Every path into this node that accepts a file already handles text: a
 *   .csv, a .log, a piece of code go straight into a prompt and work. A .xlsx does not, and it is
 *   the single most common thing a person has when they say "I have data". Asking them to open
 *   Excel and Save As CSV first is the step where an ordinary person stops, and it is the only step
 *   between them and everything the node can do with a table.
 *
 *   ONE HOME, BECAUSE THERE IS MORE THAN ONE DOOR. Chat attachments are the first caller and not
 *   the last: an agent downloading a stored file, an extension handed an upload and an import
 *   surface all face the same question about the same bytes. The extraction lives here so that
 *   answer is written once.
 *
 *   WHAT IT DOES NOT DO. The pre-2007 binary formats -- .xls, .doc, .ppt -- are a different file
 *   format wearing a similar name, and nothing here reads them. They are NAMED as unsupported
 *   rather than failing quietly, because "nothing happened" is the worst answer and a person who is
 *   told to save it again as .xlsx can act.
 * @structure ExtractedText; extractableKind(); extractFileText()
 * @usage
 *   const got = await extractFileText(bytes, mimeType, filename);
 *   if (got) prompt.push(`Attached file: ${filename}\n\n${got.text}`);
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: xlsx, docx and pdf.
 */
import { extractText as extractPdfText } from 'unpdf';
import { safeUnzip, ZipSecurityError, type SafeZipLimits } from '../safe-zip.js';
import { logger } from '../../utils/logger.js';
import { extractXlsxText } from './xlsx.js';
import { extractDocxText } from './docx.js';

/** What came out, and anything the reader has to be told about it. */
export interface ExtractedText {
    text: string;
    kind: ExtractableKind;
    /** Said out loud in the prompt when present: clipped, empty, or a format that failed. */
    note?: string;
}

export type ExtractableKind = 'spreadsheet' | 'document' | 'pdf';

/** What to call each one in a sentence a person will hear. */
export const NAME: Record<ExtractableKind, string> = {
    spreadsheet: 'spreadsheet',
    document: 'Word document',
    pdf: 'PDF',
};

/** How much text one file may contribute. The same ceiling a plain text attachment has. */
const MAX_TEXT_BYTES = 200 * 1024;

/**
 * Limits for an office file, which is a ZIP written by a program that is usually not hostile.
 *
 * Tighter than the backup limits because the whole archive is decompressed into memory here to
 * reach three parts inside it, and a chat turn holds four of these at once.
 */
const OFFICE_ZIP_LIMITS: SafeZipLimits = {
    maxFiles: 2000,
    maxFileBytes: 24 * 1024 * 1024,
    maxTotalBytes: 64 * 1024 * 1024,
    maxRatio: 300,
};

/** The old binary formats, which look close enough to their successors to be worth naming. */
const LEGACY = /\.(xls|doc|ppt)$/i;

/**
 * Which reader this file needs, or null when it needs none of them.
 *
 * By extension first and mime second, the opposite way round from plain text, because a browser
 * hands `application/octet-stream` for an .xlsx often enough that trusting the mime alone would
 * turn the most common case away.
 */
export function extractableKind(mimeType: string, filename: string): ExtractableKind | null {
    if (/\.(xlsx|xlsm)$/i.test(filename)) return 'spreadsheet';
    if (/\.docx$/i.test(filename)) return 'document';
    if (/\.pdf$/i.test(filename)) return 'pdf';

    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.includes('spreadsheetml.sheet')) return 'spreadsheet';
    if (mimeType.includes('wordprocessingml.document')) return 'document';
    return null;
}

/** Whether this is one of the pre-2007 formats, which is worth saying differently from "no". */
export function isLegacyOfficeFile(filename: string): boolean {
    return LEGACY.test(filename);
}

/**
 * The file as text, or null when nothing here can read it.
 *
 * Every failure returns rather than throws. A file that cannot be read is a thing the person needs
 * telling about, not a chat turn that dies: the caller puts the note in the prompt and the agent
 * says it out loud.
 */
export async function extractFileText(
    bytes: Buffer, mimeType: string, filename: string,
): Promise<ExtractedText | null> {
    const kind = extractableKind(mimeType, filename);
    if (!kind) return null;

    try {
        const text = kind === 'pdf'
            ? await readPdf(bytes)
            : await readOffice(bytes, kind);
        return finish(text, kind);
    } catch (err) {
        const why = err instanceof ZipSecurityError
            ? 'it does not open as one'
            : 'it could not be read';
        logger.warn(`[file-text] ${kind} extraction failed for ${filename}: ${(err as Error).message}`);
        // The person's own file name never reaches this node -- an attachment is stored under a
        // generated key -- so the sentence leads with WHAT the file is and carries the key only as
        // the identifier it is. The agent has the person's own name for it from the conversation.
        return {
            text: '', kind,
            note: `An attached ${NAME[kind]} (${filename}) was not read because ${why}. Say so, and offer to try it again.`,
        };
    }
}

async function readOffice(bytes: Buffer, kind: ExtractableKind): Promise<string> {
    const parts = await safeUnzip(bytes, OFFICE_ZIP_LIMITS);
    return kind === 'spreadsheet' ? extractXlsxText(parts) : extractDocxText(parts);
}

/**
 * A PDF's text layer.
 *
 * A scan has no text layer at all, and pdf.js answers that with an empty string rather than an
 * error. That case is caught by the emptiness check below and reported, because a person who
 * photographed a document needs to hear "this is a picture of text" and not silence.
 */
async function readPdf(bytes: Buffer): Promise<string> {
    const { text } = await extractPdfText(new Uint8Array(bytes), { mergePages: true });
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function finish(text: string, kind: ExtractableKind): ExtractedText {
    if (!text.trim()) {
        return {
            text: '', kind,
            note: kind === 'pdf'
                ? 'This PDF holds no text, which usually means it is a scan or a photograph of a page. Say so, and offer to read it as a picture instead.'
                : 'This file opened but held no text at all.',
        };
    }

    const buffer = Buffer.from(text, 'utf8');
    if (buffer.length <= MAX_TEXT_BYTES) return { text, kind };

    // Cut on a character boundary rather than a byte one: a multi-byte character split in half
    // arrives as a replacement character, and in a table that lands mid-value.
    const clipped = new TextDecoder('utf8').decode(buffer.subarray(0, MAX_TEXT_BYTES)).replace(/�$/, '');
    return {
        text: clipped,
        kind,
        note: `Only the first ${Math.round(MAX_TEXT_BYTES / 1024)} kB of this file is shown, out of ${Math.round(buffer.length / 1024)} kB.`,
    };
}
