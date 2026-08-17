/**
 * @file test/unit/datapackage-images.test.ts
 * @description The row-to-photograph link, and the two things it refuses.
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { linkSourceImages, isImageColumn } from '../../src/services/datapackage/images.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const OWNER = 'alice@node-1';
const config = { baseUrl: 'https://node.example' } as AimeatConfig;

/** A storage that knows about a fixed set of files, and nothing else. */
function storageWith(keysByOwner: Record<string, string[]>): Storage {
    return {
        getStorageFileMeta: async (owner: string, key: string) =>
            (keysByOwner[owner]?.includes(key) ? { key, ownerGaii: owner, mimeType: 'image/jpeg', size: 1 } : null),
    } as unknown as Storage;
}

const deps = (keys: Record<string, string[]>) => ({ storage: storageWith(keys), config });

describe('which column holds the picture', () => {
    it('takes source_image and its numbered siblings', () => {
        expect(isImageColumn('source_image')).toBe(true);
        expect(isImageColumn('source_image_2')).toBe(true);
        expect(isImageColumn('source_image_10')).toBe(true);
    });

    it('claims nothing else, so a column that merely mentions images stays text', () => {
        expect(isImageColumn('source_images_note')).toBe(false);
        expect(isImageColumn('image')).toBe(false);
        expect(isImageColumn('source_image_')).toBe(false);
        expect(isImageColumn('my_source_image')).toBe(false);
    });
});

describe('linking a row to its photograph', () => {
    it('turns a storage key into the permanent address a reader can fetch', async () => {
        const got = await linkSourceImages(deps({ [OWNER]: ['photos/receipt-1.jpg'] }), OWNER, [
            { name: 'receipts', schema: 'infer', rows: [{ total: 12.5, source_image: 'photos/receipt-1.jpg' }] },
        ]);

        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(got.resources[0].rows[0].source_image)
            .toBe('https://node.example/v1/pub/alice%40node-1/photos/receipt-1.jpg');
        expect(got.linked).toBe(1);
    });

    it('leaves the caller own rows untouched, so a retry publishes what was asked', async () => {
        const rows = [{ total: 1, source_image: 'photos/receipt-1.jpg' }];
        await linkSourceImages(deps({ [OWNER]: ['photos/receipt-1.jpg'] }), OWNER, [
            { name: 'receipts', schema: 'infer', rows },
        ]);
        expect(rows[0].source_image).toBe('photos/receipt-1.jpg');
    });

    it('resolves several pages of one document', async () => {
        const got = await linkSourceImages(deps({ [OWNER]: ['p1.jpg', 'p2.jpg'] }), OWNER, [
            { name: 'contracts', schema: 'infer', rows: [{ source_image: 'p1.jpg', source_image_2: 'p2.jpg' }] },
        ]);
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(got.resources[0].rows[0].source_image).toContain('/p1.jpg');
        expect(got.resources[0].rows[0].source_image_2).toContain('/p2.jpg');
        expect(got.linked).toBe(2);
    });

    it('looks a repeated picture up once, however many rows name it', async () => {
        let lookups = 0;
        const storage = {
            getStorageFileMeta: async (owner: string, key: string) => {
                lookups++;
                return { key, ownerGaii: owner, mimeType: 'image/jpeg', size: 1 };
            },
        } as unknown as Storage;

        await linkSourceImages({ storage, config }, OWNER, [{
            name: 'lines', schema: 'infer',
            rows: [
                { line: 1, source_image: 'invoice.jpg' },
                { line: 2, source_image: 'invoice.jpg' },
                { line: 3, source_image: 'invoice.jpg' },
            ],
        }]);
        expect(lookups).toBe(1);
    });

    it('accepts an address it already wrote itself, and checks it is still there', async () => {
        const url = 'https://node.example/v1/pub/alice%40node-1/photos/receipt-1.jpg';
        const got = await linkSourceImages(deps({ [OWNER]: ['photos/receipt-1.jpg'] }), OWNER, [
            { name: 'receipts', schema: 'infer', rows: [{ source_image: url }] },
        ]);
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(got.resources[0].rows[0].source_image).toBe(url);
    });

    it('leaves a picture on another host alone, because that is not its business', async () => {
        const got = await linkSourceImages(deps({}), OWNER, [
            { name: 'r', schema: 'infer', rows: [{ source_image: 'https://example.org/photo.jpg' }] },
        ]);
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(got.resources[0].rows[0].source_image).toBe('https://example.org/photo.jpg');
    });

    it('passes a table with no picture column through unchanged', async () => {
        const got = await linkSourceImages(deps({}), OWNER, [
            { name: 'r', schema: 'infer', rows: [{ a: 1, note: 'no pictures here' }] },
        ]);
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(got.linked).toBe(0);
        expect(got.resources[0].rows[0]).toEqual({ a: 1, note: 'no pictures here' });
    });

    it('ignores an empty cell rather than publishing a link to nothing', async () => {
        const got = await linkSourceImages(deps({ [OWNER]: ['a.jpg'] }), OWNER, [
            { name: 'r', schema: 'infer', rows: [{ source_image: 'a.jpg' }, { source_image: '' }, { source_image: null }] },
        ]);
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(got.resources[0].rows[1].source_image).toBe('');
        expect(got.resources[0].rows[2].source_image).toBeNull();
    });
});

describe('what it refuses, before anything is written', () => {
    it('refuses a picture that is not in the person files', async () => {
        const got = await linkSourceImages(deps({ [OWNER]: [] }), OWNER, [
            { name: 'r', schema: 'infer', rows: [{ source_image: 'photos/gone.jpg' }] },
        ]);
        expect(got.ok).toBe(false);
        if (got.ok) return;
        expect(got.message).toContain('photos/gone.jpg');
        expect(got.message).toContain('Upload it first');
    });

    it('refuses a file belonging to somebody else, whichever way it is written', async () => {
        const other = 'https://node.example/v1/pub/bob%40node-1/private.jpg';
        const absolute = await linkSourceImages(deps({ 'bob@node-1': ['private.jpg'] }), OWNER, [
            { name: 'r', schema: 'infer', rows: [{ source_image: other }] },
        ]);
        expect(absolute.ok).toBe(false);

        const relative = await linkSourceImages(deps({ 'bob@node-1': ['private.jpg'] }), OWNER, [
            { name: 'r', schema: 'infer', rows: [{ source_image: '/v1/pub/bob%40node-1/private.jpg' }] },
        ]);
        expect(relative.ok).toBe(false);
        if (relative.ok) return;
        expect(relative.message).toContain('somebody else');
    });

    it('never looks up another owner file at all, so the refusal leaks nothing about it', async () => {
        let asked: string[] = [];
        const storage = {
            getStorageFileMeta: async (owner: string, key: string) => { asked.push(`${owner}:${key}`); return null; },
        } as unknown as Storage;

        await linkSourceImages({ storage, config }, OWNER, [
            { name: 'r', schema: 'infer', rows: [{ source_image: '/v1/pub/bob%40node-1/private.jpg' }] },
        ]);
        expect(asked).toEqual([]);
    });
});
