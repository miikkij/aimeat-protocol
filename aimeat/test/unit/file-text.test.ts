/**
 * @file test/unit/file-text.test.ts
 * @description Proves the spreadsheet, document and PDF readers against files written by OTHER
 *   programs -- openpyxl, python-docx and pdfkit -- rather than against XML this repo authored. A
 *   reader tested on its own output proves only that it is self-consistent, and the defects that
 *   matter here (a date stored as 46016, a word split across two runs, a shared string reused, a
 *   tracked deletion still in the file) all come from what a real producer writes.
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractFileText, extractableKind, isLegacyOfficeFile } from '../../src/services/file-text/index.js';

const dir = fileURLToPath(new URL('../fixtures/file-text/', import.meta.url));
const load = (name: string): Buffer => readFileSync(dir + name);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('which files this reads', () => {
    it('recognises the three formats by extension even when the browser said nothing useful', () => {
        expect(extractableKind('application/octet-stream', 'a.xlsx')).toBe('spreadsheet');
        expect(extractableKind('application/octet-stream', 'a.docx')).toBe('document');
        expect(extractableKind('application/octet-stream', 'a.pdf')).toBe('pdf');
    });

    it('recognises them by mime when the name says nothing', () => {
        expect(extractableKind(XLSX_MIME, 'download')).toBe('spreadsheet');
        expect(extractableKind(DOCX_MIME, 'download')).toBe('document');
        expect(extractableKind('application/pdf', 'download')).toBe('pdf');
    });

    it('leaves plain text and pictures alone, because another path already handles them', () => {
        expect(extractableKind('text/csv', 'rows.csv')).toBeNull();
        expect(extractableKind('image/png', 'shot.png')).toBeNull();
    });

    it('names the pre-2007 formats rather than treating them as unknown', () => {
        expect(extractableKind('application/vnd.ms-excel', 'old.xls')).toBeNull();
        expect(isLegacyOfficeFile('old.xls')).toBe(true);
        expect(isLegacyOfficeFile('old.doc')).toBe(true);
        expect(isLegacyOfficeFile('new.xlsx')).toBe(false);
    });
});

describe('a spreadsheet', () => {
    it('comes out as CSV, one block per sheet, in the workbook order', async () => {
        const got = await extractFileText(load('sales.xlsx'), XLSX_MIME, 'sales.xlsx');
        expect(got?.kind).toBe('spreadsheet');
        expect(got!.text.indexOf('## Sheet: Myynti')).toBeLessThan(got!.text.indexOf('## Sheet: Kulut'));
        expect(got!.text).toContain('Asiakas,Päivä,Summa,Maksettu,Huomio');
        expect(got!.text).toContain('Kohde,Euroa');
    });

    it('turns a date back into a date, which is the whole reason this file exists', async () => {
        const got = await extractFileText(load('sales.xlsx'), XLSX_MIME, 'sales.xlsx');
        // Stored as 46251. A reader without the styles part hands the model that number.
        expect(got!.text).toContain('2026-08-17');
        expect(got!.text).toContain('2026-12-25');
        expect(got!.text).not.toMatch(/\b4[0-9]{4}\b/);
    });

    it('keeps the time on a cell that has one', async () => {
        const got = await extractFileText(load('sales.xlsx'), XLSX_MIME, 'sales.xlsx');
        expect(got!.text).toContain('2026-03-01 09:30:00');
    });

    it('decodes entities, so a company with an ampersand keeps its name', async () => {
        const got = await extractFileText(load('sales.xlsx'), XLSX_MIME, 'sales.xlsx');
        expect(got!.text).toContain('Smith & Co');
        expect(got!.text).not.toContain('&amp;');
    });

    it('carries non-ASCII through unharmed', async () => {
        const got = await extractFileText(load('sales.xlsx'), XLSX_MIME, 'sales.xlsx');
        expect(got!.text).toContain('Kärkkäinen Oy');
        expect(got!.text).toContain('Ääkkös-Testi');
    });

    it('holds an empty cell open so the next column stays under its own heading', async () => {
        const got = await extractFileText(load('sales.xlsx'), XLSX_MIME, 'sales.xlsx');
        // Row 5 has A and C filled and B empty: the 42 must be the THIRD field, not the second.
        const row = got!.text.split('\n').find((l) => l.startsWith('Reikä'));
        expect(row).toBeDefined();
        expect(row!.split(',')[2]).toBe('42');
    });

    it('writes booleans as words rather than as 1 and 0', async () => {
        const got = await extractFileText(load('sales.xlsx'), XLSX_MIME, 'sales.xlsx');
        expect(got!.text).toContain('TRUE');
        expect(got!.text).toContain('FALSE');
    });

    it('resolves a shared string used by more than one row', async () => {
        const got = await extractFileText(load('sales.xlsx'), XLSX_MIME, 'sales.xlsx');
        expect(got!.text.match(/ensimmäinen/g)?.length).toBe(2);
    });
});

describe('a Word document', () => {
    it('comes out as its paragraphs', async () => {
        const got = await extractFileText(load('contract.docx'), DOCX_MIME, 'contract.docx');
        expect(got?.kind).toBe('document');
        expect(got!.text).toContain('Sopimus 2026');
        expect(got!.text).toContain('Loppu.');
    });

    it('rejoins a word that formatting split across two runs', async () => {
        const got = await extractFileText(load('contract.docx'), DOCX_MIME, 'contract.docx');
        expect(got!.text).toContain('Tämä on erittäin tärkeä sopimus & liite.');
    });

    it('keeps a table as rows, so a number stays with its column', async () => {
        const got = await extractFileText(load('contract.docx'), DOCX_MIME, 'contract.docx');
        expect(got!.text).toContain('Rivi\tMäärä\tHinta');
        expect(got!.text).toContain('Kahvi\t3\t12,50');
    });

    it('returns the document as it is now, not as it was before the tracked edits', async () => {
        const got = await extractFileText(load('tracked.docx'), DOCX_MIME, 'tracked.docx');
        expect(got!.text).toContain('250');
        expect(got!.text).not.toContain('vanha hinta 100');
    });
});

describe('a PDF', () => {
    it('comes out as its text, across every page', async () => {
        const got = await extractFileText(load('invoice.pdf'), 'application/pdf', 'invoice.pdf');
        expect(got?.kind).toBe('pdf');
        expect(got!.text).toContain('Lasku 2026-114');
        expect(got!.text).toContain('Smith & Co');
        expect(got!.text).toContain('Toinen sivu');
    });
});

describe('when a file cannot be read', () => {
    it('says so instead of throwing, because the person has to be told', async () => {
        const got = await extractFileText(Buffer.from('this is not a spreadsheet'), XLSX_MIME, 'broken.xlsx');
        expect(got?.text).toBe('');
        expect(got?.note).toContain('spreadsheet');
        expect(got?.note).toContain('broken.xlsx');
    });

    it('tells the person a text-free PDF is a picture of a page', async () => {
        // A valid PDF with no text operators at all: pdf.js returns an empty string, not an error.
        const blank = Buffer.from(
            '%PDF-1.4\n'
            + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
            + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
            + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n'
            + 'trailer<</Root 1 0 R>>\n',
            'latin1',
        );
        const got = await extractFileText(blank, 'application/pdf', 'scan.pdf');
        expect(got?.text).toBe('');
        expect(got?.note).toMatch(/scan|picture/i);
    });
});
