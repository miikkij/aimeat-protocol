/**
 * @file src/services/file-text/docx.ts
 * @description A Word document as its text, with the paragraph and table structure that carries
 *   meaning and none of the styling that does not.
 *
 *   WHAT IS KEPT AND WHY. Paragraph breaks, line breaks, tabs, and table cell boundaries. A table
 *   in a contract or an invoice is DATA, and flattening it into a run-on sentence loses which
 *   number belonged to which row; kept as tab-separated rows it stays a table to a reader and to a
 *   model. Everything else -- fonts, colours, the tracked-change history, the comments in the
 *   margin -- is dropped, because none of it is what the person attaching the file is asking about.
 *
 *   DELETED TEXT STAYS DELETED. A document with tracked changes carries the removed words in
 *   `w:delText`, and a reader that takes every text node returns the document as it was BEFORE the
 *   edits, mixed in with how it is now. That is a wrong answer that looks like a right one, so
 *   `w:delText` is skipped and only `w:t` is read.
 * @structure extractDocxText(parts) -> string
 * @usage import { extractDocxText } from './docx.js';
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: paragraphs, breaks, tabs and tables.
 */
import { eachTag } from './xml.js';
import type { OfficeParts } from './xlsx.js';

/** Paragraphs. Past this the file is a book, and a prompt is not where a book goes. */
const MAX_PARAGRAPHS = 5000;

/**
 * The document body as text.
 *
 * Headers, footers and footnotes are separate parts and are left out: they repeat on every page and
 * would bury the body under the same line forty times.
 */
export function extractDocxText(parts: OfficeParts): string {
    const body = parts.get('word/document.xml');
    if (!body) return '';

    const paragraphs: string[] = [];
    let run: string[] = [];
    let cells: string[] = [];
    let cellParagraphs: string[] | null = null;

    /**
     * A paragraph ends. Inside a cell it is held rather than emitted, because a cell may contain
     * several paragraphs and it is still ONE field of the row: flushing per paragraph would put a
     * tab in the middle of a cell and push every later column one place along.
     */
    const endParagraph = (): void => {
        const text = run.join('').replace(/[ \t]+$/g, '');
        run = [];
        if (cellParagraphs) { if (text) cellParagraphs.push(text); return; }
        if (text.trim() || paragraphs[paragraphs.length - 1]?.trim()) paragraphs.push(text);
    };

    for (const tag of eachTag(body.toString('utf8'))) {
        if (paragraphs.length >= MAX_PARAGRAPHS) break;
        switch (tag.name) {
            case 'w:t':
                if (tag.kind === 'open' && !tag.selfClosing) run.push(tag.textAfter);
                break;

            case 'w:tab':
                if (tag.kind === 'open') run.push('\t');
                break;

            case 'w:br':
            case 'w:cr':
                if (tag.kind === 'open') run.push('\n');
                break;

            case 'w:p':
                if (tag.kind === 'close' || tag.selfClosing) endParagraph();
                break;

            case 'w:tc':
                if (tag.kind === 'open' && !tag.selfClosing) cellParagraphs = [];
                else if (tag.kind === 'close') {
                    endParagraph();
                    cells.push((cellParagraphs ?? []).join(' ').replace(/\s+/g, ' ').trim());
                    cellParagraphs = null;
                }
                break;

            case 'w:tr':
                if (tag.kind === 'open' && !tag.selfClosing) cells = [];
                else if (tag.kind === 'close') {
                    paragraphs.push(cells.join('\t'));
                    cells = [];
                }
                break;

            default:
                break;
        }
    }
    endParagraph();

    // Three or more blank lines in a row are the document's own spacing, not the author's meaning.
    return paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
