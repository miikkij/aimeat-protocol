/**
 * @file test/unit/chat-attachments.test.ts
 * @description What a turn does with the files a person attached, proved without an agent process.
 *   This ran inside runChatTurn until 2026-08-17, where the first line of it needs goose installed,
 *   so the routing -- picture, text, spreadsheet, or a sentence saying it was not read -- had never
 *   been asserted at all.
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readAttachments } from '../../src/services/chat-attachments.js';
import type { Storage } from '../../src/storage/interface.js';

const dir = fileURLToPath(new URL('../fixtures/file-text/', import.meta.url));
const GAII = 'alice@node-1';

/** A storage that answers only getStorageFile, which is all this path touches. */
function storageWith(files: Record<string, { mimeType: string; data: Buffer }>): Storage {
    return {
        getStorageFile: async (owner: string, key: string) =>
            (owner === GAII && files[key] ? { key, ownerGaii: owner, ...files[key] } : null),
    } as unknown as Storage;
}

describe('reading what was attached', () => {
    it('sends a picture as an image block and never as text', async () => {
        const got = await readAttachments(storageWith({
            'chat-files/1.png': { mimeType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
        }), GAII, ['chat-files/1.png']);

        expect(got.images).toHaveLength(1);
        expect(got.images[0].mimeType).toBe('image/png');
        expect(got.quoted).toHaveLength(0);
    });

    it('quotes a text file under its own name', async () => {
        const got = await readAttachments(storageWith({
            'chat-files/2.csv': { mimeType: 'text/csv', data: Buffer.from('a,b\n1,2\n') },
        }), GAII, ['chat-files/2.csv']);

        expect(got.quoted[0]).toContain('Attached file: chat-files/2.csv');
        expect(got.quoted[0]).toContain('a,b');
    });

    it('turns a spreadsheet into CSV in the prompt, which is the whole point of this change', async () => {
        const got = await readAttachments(storageWith({
            'chat-files/3.xlsx': {
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                data: readFileSync(dir + 'sales.xlsx'),
            },
        }), GAII, ['chat-files/3.xlsx']);

        expect(got.quoted).toHaveLength(1);
        expect(got.quoted[0]).toContain('Attached spreadsheet:');
        expect(got.quoted[0]).toContain('Asiakas,Päivä,Summa');
        expect(got.quoted[0]).toContain('2026-08-17');
        expect(got.skipped).toHaveLength(0);
    });

    it('reads a spreadsheet the browser gave no useful type for', async () => {
        const got = await readAttachments(storageWith({
            'chat-files/4.xlsx': { mimeType: 'application/octet-stream', data: readFileSync(dir + 'sales.xlsx') },
        }), GAII, ['chat-files/4.xlsx']);

        expect(got.quoted[0]).toContain('Asiakas,Päivä,Summa');
    });

    it('reads a PDF and a Word document the same way', async () => {
        const got = await readAttachments(storageWith({
            'chat-files/5.pdf': { mimeType: 'application/pdf', data: readFileSync(dir + 'invoice.pdf') },
            'chat-files/6.docx': { mimeType: 'application/octet-stream', data: readFileSync(dir + 'contract.docx') },
        }), GAII, ['chat-files/5.pdf', 'chat-files/6.docx']);

        expect(got.quoted[0]).toContain('Attached PDF:');
        expect(got.quoted[0]).toContain('Lasku 2026-114');
        expect(got.quoted[1]).toContain('Attached Word document:');
        expect(got.quoted[1]).toContain('Sopimus 2026');
    });

    it('gives the agent a sentence for an older Office file instead of silence', async () => {
        const got = await readAttachments(storageWith({
            'chat-files/7.xls': { mimeType: 'application/vnd.ms-excel', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) },
        }), GAII, ['chat-files/7.xls']);

        expect(got.quoted).toHaveLength(0);
        expect(got.skipped).toHaveLength(0);
        expect(got.notes[0]).toContain('.xlsx');
        expect(got.notes[0]).toMatch(/save it again|save it as/i);
    });

    it('names a file nothing can open rather than dropping it', async () => {
        const got = await readAttachments(storageWith({
            'chat-files/8.zip': { mimeType: 'application/zip', data: Buffer.from([0x50, 0x4b]) },
        }), GAII, ['chat-files/8.zip']);

        expect(got.skipped[0]).toContain('chat-files/8.zip');
    });

    it('stops at four files, whatever the request asked for', async () => {
        const files: Record<string, { mimeType: string; data: Buffer }> = {};
        const keys: string[] = [];
        for (let i = 0; i < 7; i++) {
            const key = `chat-files/many-${i}.txt`;
            files[key] = { mimeType: 'text/plain', data: Buffer.from(`file ${i}`) };
            keys.push(key);
        }
        const got = await readAttachments(storageWith(files), GAII, keys);
        expect(got.quoted).toHaveLength(4);
    });

    it('reads from the person own namespace and nobody elses', async () => {
        const got = await readAttachments(storageWith({
            'chat-files/9.csv': { mimeType: 'text/csv', data: Buffer.from('secret') },
        }), 'mallory@node-1', ['chat-files/9.csv']);

        expect(got.quoted).toHaveLength(0);
        expect(got.images).toHaveLength(0);
    });
});
