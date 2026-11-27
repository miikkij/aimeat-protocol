/**
 * @file test/unit/template-recipe.test.ts
 * @description The recipe an owner's app template carries (models/template-recipe.ts): the one schema
 *   the catalog entry, both MCP surfaces, POST /v1/appdev/templates and PATCH /v1/appdev/templates/:id
 *   validate with, and the how_to_start text GET /v1/appdev/templates/:id and aimeat_app_template_get
 *   both answer (services/appdev/template-start.ts), with and without a recipe.
 * @usage pnpm exec vitest run test/unit/template-recipe.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-omistaja-tekee-omia-sovelluspohjia-ja-aloittaa-seuraavan-app).
 */
import { describe, it, expect } from 'vitest';
import { TemplateRecipeSchema } from '../../src/models/template-recipe.js';
import { templateHowToStart } from '../../src/services/appdev/template-start.js';
import type { AppRecord } from '../../src/storage/interface.js';

const FULL = {
    look: 'kit-mappi',
    genre: 'genre-workbench',
    frame: 'tool',
    screens: [{ name: 'List', from: 'genre-workbench', note: 'The day\'s errands, newest first.' }, { name: 'Detail' }],
    needs: ['session', 'ai', 'member:use'],
    moments: ['ask:signIn', 'propose:draft', 'handoff:say'],
    data: [{ what: 'errands', where: 'memory key errands.list' }],
    scopes: ['memory:read', 'memory:write'],
    criteria: [{ text: 'The list shows a new errand without a reload.', check: 'scenario' }],
};

const app = (toll = 0) => ({ versionNumber: 2, manifest: toll ? { tollMorsels: toll } : {} }) as unknown as AppRecord;

describe('TemplateRecipeSchema', () => {
    it('accepts a full recipe, and an empty one', () => {
        expect(TemplateRecipeSchema.safeParse(FULL).success).toBe(true);
        expect(TemplateRecipeSchema.safeParse({}).success).toBe(true);
    });

    it('refuses an unknown key, at the top and inside a list entry', () => {
        expect(TemplateRecipeSchema.safeParse({ ...FULL, colour: 'red' }).success).toBe(false);
        expect(TemplateRecipeSchema.safeParse({ screens: [{ name: 'List', layout: 'grid' }] }).success).toBe(false);
    });

    it('refuses an over-long list', () => {
        const needs = Array.from({ length: 13 }, (_, i) => `need${String.fromCharCode(97 + i)}`);
        expect(TemplateRecipeSchema.safeParse({ needs }).success).toBe(false);
        const screens = Array.from({ length: 21 }, (_, i) => ({ name: `Screen ${i}` }));
        expect(TemplateRecipeSchema.safeParse({ screens }).success).toBe(false);
    });

    it('refuses a moment that is not ask, propose or handoff, and a malformed need', () => {
        expect(TemplateRecipeSchema.safeParse({ moments: ['wait:forever'] }).success).toBe(false);
        expect(TemplateRecipeSchema.safeParse({ moments: ['ask:'] }).success).toBe(false);
        expect(TemplateRecipeSchema.safeParse({ needs: ['Session'] }).success).toBe(false);
        expect(TemplateRecipeSchema.safeParse({ frame: 'poster' }).success).toBe(false);
        expect(TemplateRecipeSchema.safeParse({ criteria: [{ text: 'x', check: 'vibes' }] }).success).toBe(false);
    });
});

describe('templateHowToStart', () => {
    it('without a recipe answers the sentences it always did', () => {
        expect(templateHowToStart({ startMode: 'either' }, null)).toBe('Source app is gone — scaffold from reuse_notes.');
        expect(templateHowToStart({ startMode: 'scaffold' }, app())).toBe('Scaffold a fresh app from reuse_notes (do not fork).');
        expect(templateHowToStart({ startMode: 'fork' }, app())).toBe('Fork the source app (aimeat_app_fork) and adapt per reuse_notes.');
        expect(templateHowToStart({ startMode: 'fork' }, app(5))).toContain('5 morsels of pacing');
    });

    it('with a recipe keeps the start sentence and adds how to build from the recipe', () => {
        const text = templateHowToStart({ startMode: 'fork', recipe: FULL as never }, app());
        expect(text.startsWith('Fork the source app (aimeat_app_fork) and adapt per reuse_notes.')).toBe(true);
        expect(text).toContain('kit-mappi');
        expect(text).toContain('genre-workbench');
        expect(text).toContain('AIMEAT.atelier.app()');
        expect(text).toContain('"tool"');
        expect(text).toContain('AIMEAT.atelier.requires({ needs');
        expect(text).toContain('member:use');
        expect(text).toContain('AIMEAT.atelier.ask');
        expect(text).toContain('propose:draft');
        expect(text).toContain('memory key errands.list');
        expect(text).toContain('criteria_set');
    });

    it('names only the parts the recipe carries', () => {
        const text = templateHowToStart({ startMode: 'scaffold', recipe: { frame: 'game' } }, app());
        expect(text).toContain('"game"');
        expect(text).not.toContain('requires(');
        expect(text).not.toContain('criteria_set');
    });
});
