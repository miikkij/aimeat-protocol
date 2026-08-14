import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const CSM_DIR = join(import.meta.dirname, '../../docs/csm-examples');

describe('CSM Templates (docs/csm-examples/)', () => {
    it('contains expected YAML template files', () => {
        const files = readdirSync(CSM_DIR).filter(f => f.endsWith('.csm.yaml'));
        expect(files).toContain('hobby-directory.csm.yaml');
        expect(files).toContain('marketplace.csm.yaml');
        expect(files).toContain('dating-directory.csm.yaml');
        expect(files).toContain('news-feed.csm.yaml');
        expect(files).toContain('opinion-board.csm.yaml');
        expect(files).toContain('auction.csm.yaml');
        expect(files).toContain('video-directory.csm.yaml');
    });

    it('template count >= 7', () => {
        const files = readdirSync(CSM_DIR).filter(f => f.endsWith('.csm.yaml'));
        expect(files.length).toBeGreaterThanOrEqual(7);
    });

    it('hobby-directory.csm.yaml parses correctly', () => {
        const content = readFileSync(join(CSM_DIR, 'hobby-directory.csm.yaml'), 'utf-8');
        const parsed = parseYaml(content);

        expect(parsed.csm).toBe('1.0');
        expect(parsed.service).toBeDefined();
        expect(parsed.service.name).toBe('Harrastehakemisto');
        expect(parsed.service.type).toBe('directory');
        expect(parsed.data_schema).toBeDefined();
        expect(parsed.data_schema.required).toBeDefined();
        expect(parsed.data_schema.required.interests).toBeDefined();
        expect(parsed.consent_requirements).toBeDefined();
        expect(parsed.moderation).toBeDefined();
        expect(parsed.ui_hints).toBeDefined();
    });

    it('marketplace.csm.yaml parses correctly', () => {
        const content = readFileSync(join(CSM_DIR, 'marketplace.csm.yaml'), 'utf-8');
        const parsed = parseYaml(content);

        expect(parsed.csm).toBe('1.0');
        expect(parsed.service).toBeDefined();
        expect(parsed.service.name).toBe('marketplace');
        expect(parsed.service.type).toBe('marketplace');
        expect(parsed.data_schema).toBeDefined();
        expect(parsed.data_schema.required.title).toBeDefined();
        expect(parsed.data_schema.required.price).toBeDefined();
        expect(parsed.data_schema.required.category).toBeDefined();
        expect(parsed.economy).toBeDefined();
        expect(parsed.economy.listing_fee_morsels).toBe(5);
        expect(parsed.economy.escrow_enabled).toBe(true);
    });

    it('all CSM templates have required fields (csm, service.name, service.type)', () => {
        const files = readdirSync(CSM_DIR).filter(f => f.endsWith('.csm.yaml'));

        for (const file of files) {
            const content = readFileSync(join(CSM_DIR, file), 'utf-8');
            const parsed = parseYaml(content);

            expect(parsed.csm, `${file}: missing csm field`).toBeDefined();
            expect(parsed.service, `${file}: missing service field`).toBeDefined();
            expect(parsed.service.name, `${file}: missing service.name`).toBeTruthy();
            expect(parsed.service.type, `${file}: missing service.type`).toBeTruthy();
        }
    });

    it('all templates have data_schema and consent_requirements', () => {
        const files = readdirSync(CSM_DIR).filter(f => f.endsWith('.csm.yaml'));

        for (const file of files) {
            const content = readFileSync(join(CSM_DIR, file), 'utf-8');
            const parsed = parseYaml(content);

            expect(parsed.data_schema, `${file}: missing data_schema`).toBeDefined();
            expect(parsed.consent_requirements, `${file}: missing consent_requirements`).toBeDefined();
        }
    });
});
