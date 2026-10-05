/**
 * @file tool-loader.test.ts
 * @description The chat surface's search by purpose (src/mcp/tool-loader.ts rankTools), against the
 *   real catalog: a model that asks in plain words for an action gets the tool for that action
 *   first, not every tool whose description mentions one of the words.
 * @usage cd aimeat && pnpm exec vitest run test/unit/tool-loader.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { rankTools, type ToolEntry } from '../../src/mcp/tool-loader.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/tool-catalog/definitions.js';

const catalog: ToolEntry[] = CLI_FALLBACK_TOOL_DEFINITIONS.map((d) => ({ name: d.name, description: d.description, enabled: false }));
const top = (purpose: string, n = 3) => rankTools(purpose, catalog, n).map((t) => t.name);

describe('rankTools', () => {
    it('puts the tool named for the action first', () => {
        expect(top('add a contact')[0]).toBe('aimeat_contact_add');
        expect(top('publish an app')).toContain('aimeat_app_publish');
        expect(top('schedule a task every morning')).toContain('aimeat_schedule_create');
        expect(top('write to a workspace')).toContain('aimeat_workspace_write');
        expect(top('send a direct message')).toContain('aimeat_dm_send');
    });

    it('meets a word in another form: plural, -ing and -ed', () => {
        expect(top('contacts')[0]).toMatch(/^aimeat_contact_/);
        expect(top('scheduling', 5)).toContain('aimeat_schedule_create');
    });

    it('finds nothing for words that say nothing, and keeps to the limit', () => {
        expect(rankTools('the of a to', catalog, 6)).toEqual([]);
        expect(rankTools('memory', catalog, 4)).toHaveLength(4);
    });
});
