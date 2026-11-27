/**
 * @file test/unit/config-json-list.test.ts
 * @description The Config tab's JSON form of a list-of-objects setting (public/views/admin/config-json-list.js):
 *   the value the admin view answers, shown as text and parsed back, is the same list, and the page
 *   never sends text where the node expects a list. Written when agents.operator_services showed
 *   "[object Object]" in the one-item-per-line editor.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { jsonListText, jsonListFromText, errorPlace } from '../../public/views/admin/config-json-list.js';

const entries = [
    { id: 'desk-helper', display_name: 'Desk Helper', credential_agent: 'desk-service', scopes: ['memory:read'], enabled: true },
    { id: 'desk-writer', display_name: 'Desk Writer', credential_agent: 'writer-service', scopes: ['memory:write-as-owner'], write_prefixes: ['desk-writer.'], enabled: false },
];

describe('the Config tab JSON list', () => {
    it('keeps the value through the text and back', () => {
        const text = jsonListText(entries);
        expect(text).not.toContain('[object Object]');
        expect(jsonListFromText(text)).toEqual({ ok: true, value: entries });
    });
    it('shows no value as an empty list and saves an empty text as []', () => {
        expect(jsonListText(null)).toBe('[]');
        expect(jsonListFromText('')).toEqual({ ok: true, value: [] });
        expect(jsonListFromText('   \n')).toEqual({ ok: true, value: [] });
    });
    it('refuses text that is not JSON, and JSON that is not a list, and sends nothing', () => {
        const bad = jsonListFromText('[\n  { "id": "x", }\n]');
        expect(bad.ok).toBe(false);
        expect(bad.error).toBe('not-json');
        // Where the error is, as a line and a column, never the engine's sentence.
        expect(bad.at).toEqual({ line: 2, column: expect.any(Number) });
        expect(jsonListFromText('{"id":"x"}')).toEqual({ ok: false, error: 'not-a-list', at: null });
        expect(jsonListFromText('"[object Object]"')).toEqual({ ok: false, error: 'not-a-list', at: null });
    });
    it('reads the place from either form an engine gives', () => {
        expect(errorPlace('[1,\n2,]', 'Unexpected token ] in JSON at position 6')).toEqual({ line: 2, column: 3 });
        expect(errorPlace('x', 'JSON.parse: unexpected character at line 1 column 1 of the JSON data')).toEqual({ line: 1, column: 1 });
        expect(errorPlace('x', 'Something else')).toBeNull();
    });
});
