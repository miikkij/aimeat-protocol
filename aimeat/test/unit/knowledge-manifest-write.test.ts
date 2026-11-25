/**
 * @file test/unit/knowledge-manifest-write.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which memory writes are checked as knowledge package manifests, and which are refused
 *   (src/services/knowledge/manifest-write.ts): the key alone does not decide, a data package's
 *   catalogue manifest is left alone, and a manifest already stored that fails stays writable.
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-tietopaketin-manifesti-tarkistetaan-muistin-kirjoituksessa-j).
 */
import { describe, expect, it } from 'vitest';
import { isKnowledgeManifestWrite, knowledgeManifestWriteRefusal } from '../../src/services/knowledge/manifest-write.js';
import { KNOWLEDGE_SEEDS } from '../../src/services/prompt-defaults/knowledge.js';

const KEY = 'packages/0d2ad8dd-1111-4222-8333-944445555666/manifest';

const valid = () => ({
    type: 'knowledge-package', name: 'Field notes', version: '1.0.0', author: 'alice', content_type: 'research',
    tags: ['notes'], entries: [{ key: 'packages/x/summary', title: 'Summary', visibility: 'owner' }],
    sharing: { catalog_listed: false, allow_clone: false, toll_morsels: 0 },
    synthesis: { level: 'ai-generated', description: 'Notes an agent wrote.' },
});

describe('a knowledge package manifest written as memory', () => {
    it('is recognised by its type or its tag, never by the key alone', () => {
        expect(isKnowledgeManifestWrite(KEY, { type: 'knowledge-package' }, undefined)).toBe(true);
        expect(isKnowledgeManifestWrite(KEY, { name: 'x' }, ['knowledge-package'])).toBe(true);
        // A data package's catalogue manifest has the same key shape and is not checked here.
        expect(isKnowledgeManifestWrite(KEY, { name: 'x', resources: [] }, ['dataset'])).toBe(false);
        expect(isKnowledgeManifestWrite('packages/x/summary', { type: 'knowledge-package' }, ['knowledge-package'])).toBe(false);
        expect(isKnowledgeManifestWrite('notes.packages/x/manifest', { type: 'knowledge-package' }, undefined)).toBe(false);
    });

    it('passes a manifest the import would accept', () => {
        expect(knowledgeManifestWriteRefusal(KEY, valid(), ['knowledge-package'], undefined)).toBeNull();
    });

    it('refuses one with no entries, naming the part', () => {
        const refused = knowledgeManifestWriteRefusal(KEY, { ...valid(), entries: [] }, ['knowledge-package'], undefined);
        expect(refused).toMatchObject({ ok: false, status: 422, code: 'SCHEMA_VALIDATION_FAILED' });
        expect(refused!.message).toContain('/entries');
    });

    it('refuses a content type outside the list, and a missing sharing block', () => {
        expect(knowledgeManifestWriteRefusal(KEY, { ...valid(), content_type: 'gossip' }, undefined, undefined)?.code).toBe('SCHEMA_VALIDATION_FAILED');
        const noSharing: Record<string, unknown> = valid();
        delete noSharing.sharing;
        expect(knowledgeManifestWriteRefusal(KEY, noSharing, undefined, undefined)?.code).toBe('SCHEMA_VALIDATION_FAILED');
    });

    it('refuses turning a valid stored manifest into an invalid one', () => {
        expect(knowledgeManifestWriteRefusal(KEY, { ...valid(), name: '' }, ['knowledge-package'], valid())?.code).toBe('SCHEMA_VALIDATION_FAILED');
    });

    it('accepts the manifest the MCP packager prompt tells an AI to write, its placeholders filled', () => {
        const seed = KNOWLEDGE_SEEDS.find(s => s.id === 'knowledge-packager-mcp')!;
        const block = /## The manifest[\s\S]*?```json\n([\s\S]*?)\n```/.exec(seed.content)?.[1];
        expect(block, 'the prompt has no manifest example').toBeTruthy();
        const filled = block!.replace(/<ISO timestamp>/g, '2026-11-25T10:00:00.000Z').replace(/\{\{owner_name\}\}/g, 'alice');
        expect(knowledgeManifestWriteRefusal(KEY, JSON.parse(filled), ['knowledge-package'], undefined)).toBeNull();
    });

    it('leaves a manifest already stored that fails the schema writable', () => {
        const old = { type: 'knowledge-package', name: 'Older package', entries: [{ key: 'a', title: 'A', visibility: 'owner' }] };
        const withLine = { ...old, entries: [...old.entries, { key: 'b', title: 'B', visibility: 'owner' }] };
        expect(knowledgeManifestWriteRefusal(KEY, withLine, ['knowledge-package'], old)).toBeNull();
    });
});
