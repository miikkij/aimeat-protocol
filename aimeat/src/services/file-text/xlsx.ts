/**
 * @file src/services/file-text/xlsx.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A spreadsheet, as the CSV a person would have exported by hand.
 *
 *   WHY CSV AND NOT PROSE. This text is read by a model that is usually being asked to do one of two
 *   things with it: answer a question about the numbers, or turn them into rows for
 *   `aimeat_datapackage_publish`. Both want a table. A sheet described in sentences ("the first
 *   column holds dates...") is worse at both jobs than the table itself, and CSV is the one shape
 *   every model, every extension and every downstream tool already reads.
 *
 *   DATES ARE THE WHOLE DIFFICULTY. A date in a spreadsheet is a plain number wearing a format: 25
 *   December 2025 is stored as 46016. Hand that to a model unchanged and it will reason about
 *   forty-six thousand of something. So the styles part is read, the format behind each cell is
 *   looked up, and a cell whose format is a date is written out as a date. This is the difference
 *   between a file that works and a file that quietly answers wrong.
 *
 *   AND THE 1900 LEAP YEAR THAT NEVER WAS. Excel believes 1900 was a leap year, because Lotus 1-2-3
 *   did and files had to keep opening. Serial 1 is 1 January 1900, serial 60 is a day that did not
 *   exist, and every date after it is one day further along than arithmetic says. Anchoring the
 *   epoch at 30 December 1899 makes every date from 1 March 1900 onwards correct, which is every
 *   date anybody has in a real file.
 * @structure extractXlsxText(parts) -> string
 * @usage import { extractXlsxText } from './xlsx.js';
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: sheets to CSV, shared strings, inline strings, dates.
 */
import { attr, decodeXmlText, eachTag } from './xml.js';

/** Rows per sheet. Past this the file is a database and belongs in a data package, not a prompt. */
const MAX_ROWS_PER_SHEET = 2000;

/** Number formats Excel defines itself as dates or times. Everything else is looked up by code. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22]);
const BUILTIN_TIME_FORMATS = new Set([18, 19, 20, 21, 45, 46, 47]);

/** The parts of the ZIP this reader needs, by their path inside the file. */
export type OfficeParts = ReadonlyMap<string, Buffer>;

interface DateStyle { date: boolean; time: boolean }

/**
 * The sheets, in the order the workbook lists them, each as a CSV block under its own name.
 *
 * Sheet ORDER is taken from workbook.xml rather than from the file names, because a workbook whose
 * tabs were reordered keeps its original sheet1.xml/sheet2.xml names, and a person reading the
 * output expects their own tab order.
 */
export function extractXlsxText(parts: OfficeParts): string {
    const strings = readSharedStrings(parts.get('xl/sharedStrings.xml'));
    const styles = readCellStyles(parts.get('xl/styles.xml'));
    const epoch = readEpoch(parts.get('xl/workbook.xml'));
    const sheets = readSheetOrder(parts);

    const blocks: string[] = [];
    for (const sheet of sheets) {
        const xml = parts.get(sheet.path);
        if (!xml) continue;
        const csv = sheetToCsv(xml.toString('utf8'), strings, styles, epoch);
        if (!csv.trim()) continue;
        blocks.push(`## Sheet: ${sheet.name}\n\n${csv}`);
    }
    return blocks.join('\n\n');
}

/**
 * Where the sheets are and what they are called.
 *
 * The relationship id in workbook.xml points into workbook.xml.rels, which holds the real part path.
 * When either part is missing or unreadable, the worksheets are taken in file order instead: a
 * sheet under a made-up name is still worth more to somebody than no sheet at all.
 */
function readSheetOrder(parts: OfficeParts): Array<{ name: string; path: string }> {
    const workbook = parts.get('xl/workbook.xml');
    const rels = parts.get('xl/_rels/workbook.xml.rels');
    if (workbook && rels) {
        const target = new Map<string, string>();
        for (const tag of eachTag(rels.toString('utf8'))) {
            if (tag.name !== 'Relationship' || tag.kind === 'close') continue;
            const id = attr(tag.raw, 'Id');
            const to = attr(tag.raw, 'Target');
            if (id && to) target.set(id, to.replace(/^\/?(xl\/)?/, 'xl/'));
        }
        const found: Array<{ name: string; path: string }> = [];
        for (const tag of eachTag(workbook.toString('utf8'))) {
            if (tag.name !== 'sheet' || tag.kind === 'close') continue;
            const name = attr(tag.raw, 'name') ?? `Sheet ${found.length + 1}`;
            const rid = attr(tag.raw, 'r:id') ?? attr(tag.raw, 'id');
            const path = rid ? target.get(rid) : undefined;
            if (path && parts.has(path)) found.push({ name, path });
        }
        if (found.length) return found;
    }

    return [...parts.keys()]
        .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
        .sort((a, b) => sheetNumber(a) - sheetNumber(b))
        .map((path, i) => ({ name: `Sheet ${i + 1}`, path }));
}

function sheetNumber(path: string): number {
    return Number(/sheet(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/**
 * The shared string table, indexed as the cells index it.
 *
 * A single string can be split across several `<r>` runs when part of it is bold or coloured, and
 * the runs concatenate with nothing between them. Joining them with a space would put a space in
 * the middle of a word somebody bolded half of.
 */
function readSharedStrings(part: Buffer | undefined): string[] {
    if (!part) return [];
    const out: string[] = [];
    let current: string[] | null = null;
    for (const tag of eachTag(part.toString('utf8'))) {
        if (tag.name === 'si') {
            if (tag.kind === 'open') current = tag.selfClosing ? null : [];
            else if (current) { out.push(current.join('')); current = null; }
            if (tag.selfClosing) out.push('');
            continue;
        }
        if (current && tag.name === 't' && tag.kind === 'open' && !tag.selfClosing) current.push(tag.textAfter);
    }
    return out;
}

/**
 * For each cell style, whether the number behind it is a date, a time, or a number.
 *
 * `m` is the ambiguity: it means month in `dd/mm/yyyy` and minute in `hh:mm`. Resolved by what else
 * is in the format rather than by position, which is the rule that holds for the formats real files
 * carry; a format with an `h` in it is a time whatever the `m` is doing.
 */
function readCellStyles(part: Buffer | undefined): DateStyle[] {
    if (!part) return [];
    const custom = new Map<number, DateStyle>();
    const styles: DateStyle[] = [];
    let inCellXfs = false;

    for (const tag of eachTag(part.toString('utf8'))) {
        if (tag.name === 'numFmt' && tag.kind === 'open') {
            const id = Number(attr(tag.raw, 'numFmtId'));
            const code = attr(tag.raw, 'formatCode') ?? '';
            if (Number.isFinite(id)) custom.set(id, classifyFormat(code));
            continue;
        }
        if (tag.name === 'cellXfs') { inCellXfs = tag.kind === 'open' && !tag.selfClosing; continue; }
        if (!inCellXfs || tag.name !== 'xf' || tag.kind === 'close') continue;

        const id = Number(attr(tag.raw, 'numFmtId') ?? 0);
        styles.push(
            custom.get(id)
            ?? { date: BUILTIN_DATE_FORMATS.has(id), time: BUILTIN_TIME_FORMATS.has(id) },
        );
    }
    return styles;
}

/** A format code, reduced to the only question a cell asks of it. */
function classifyFormat(code: string): DateStyle {
    // Literal text inside a format is not a format token: "d" of the month in `0" days"` is not a day.
    const tokens = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').toLowerCase();
    const time = /[hs]/.test(tokens);
    const date = /[yd]/.test(tokens) || (/m/.test(tokens) && !time);
    return { date, time };
}

/** Serial-number day zero. 1904 workbooks exist and are still written by Excel for Mac. */
function readEpoch(part: Buffer | undefined): number {
    const xml = part?.toString('utf8') ?? '';
    const is1904 = /date1904\s*=\s*"(1|true)"/i.test(xml);
    return is1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
}

/** One worksheet as CSV, with empty columns held open so a column stays under its heading. */
function sheetToCsv(xml: string, strings: string[], styles: DateStyle[], epoch: number): string {
    const rows: string[] = [];
    let row: string[] | null = null;
    let cellColumn = 0;
    let cellType = '';
    let cellStyle = -1;
    let value: string | null = null;
    let inInlineString = false;
    let inlineParts: string[] = [];

    for (const tag of eachTag(xml)) {
        switch (tag.name) {
            case 'row':
                if (tag.kind === 'open' && !tag.selfClosing) { row = []; }
                else if (row) {
                    rows.push(row.map(csvField).join(','));
                    row = null;
                    if (rows.length >= MAX_ROWS_PER_SHEET) return rows.join('\n');
                }
                break;

            case 'c':
                if (tag.kind === 'open') {
                    cellColumn = columnIndex(attr(tag.raw, 'r') ?? '');
                    cellType = attr(tag.raw, 't') ?? 'n';
                    cellStyle = Number(attr(tag.raw, 's') ?? -1);
                    value = null;
                    inlineParts = [];
                    if (tag.selfClosing && row) placeCell(row, cellColumn, '');
                } else if (row) {
                    const text = inlineParts.length
                        ? inlineParts.join('')
                        : renderCell(value, cellType, cellStyle, strings, styles, epoch);
                    placeCell(row, cellColumn, text);
                }
                break;

            case 'v':
                if (tag.kind === 'open' && !tag.selfClosing) value = tag.textAfter;
                break;

            case 'is':
                inInlineString = tag.kind === 'open' && !tag.selfClosing;
                break;

            case 't':
                if (inInlineString && tag.kind === 'open' && !tag.selfClosing) inlineParts.push(tag.textAfter);
                break;

            default:
                break;
        }
    }
    return rows.join('\n');
}

/** `A1` → 0, `B7` → 1, `AA3` → 26. An absent reference means "the next column along". */
function columnIndex(ref: string): number {
    const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1];
    if (!letters) return -1;
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

function placeCell(row: string[], column: number, text: string): void {
    const at = column < 0 ? row.length : column;
    while (row.length < at) row.push('');
    row[at] = text;
}

/** One cell's stored value as the string a person would see in the sheet. */
function renderCell(
    value: string | null, type: string, styleIndex: number,
    strings: string[], styles: DateStyle[], epoch: number,
): string {
    if (value === null) return '';
    switch (type) {
        case 's': {
            const i = Number(value);
            return Number.isInteger(i) && i >= 0 && i < strings.length ? strings[i] : '';
        }
        case 'b': return value === '1' ? 'TRUE' : 'FALSE';
        case 'e': return decodeXmlText(value);
        case 'str':
        case 'inlineStr': return decodeXmlText(value);
        default: {
            const style = styles[styleIndex];
            const serial = Number(value);
            if (style && (style.date || style.time) && Number.isFinite(serial)) {
                return serialToText(serial, style, epoch);
            }
            return value;
        }
    }
}

/**
 * A serial number as a date, a time, or both.
 *
 * ISO-ish and space-separated rather than `T`-separated: this is read by a person as often as by a
 * machine, and `2026-08-17 09:30:00` is unambiguous to both.
 */
function serialToText(serial: number, style: DateStyle, epoch: number): string {
    const ms = epoch + Math.round(serial * 86_400_000);
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return String(serial);

    const date = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
    const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
    if (style.date && style.time) return `${date} ${time}`;
    if (style.date) return date;
    return time;
}

function two(n: number): string {
    return String(n).padStart(2, '0');
}

/** CSV as RFC 4180 writes it, which is what every reader on the other side expects. */
function csvField(text: string): string {
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
