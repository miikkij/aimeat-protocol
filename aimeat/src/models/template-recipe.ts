/**
 * @file src/models/template-recipe.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The recipe an owner's app template carries: what the next build starts from, as
 *   structured fields instead of prose (the look, the genre to fork, the Atelier frame, the screens,
 *   the needs, the moments, where the data is kept, the permission words and the acceptance
 *   criteria). One schema for every caller: the aimeat_app_template_propose catalog entry (so both
 *   MCP surfaces and POST /v1/appdev/templates through zodShapeFor) and PATCH /v1/appdev/templates/:id.
 *   Every part is optional and bounded, and an unknown key is refused at every level.
 * @structure RECIPE_FRAMES, RECIPE_CHECKS, TemplateRecipeSchema, TemplateRecipe
 * @usage import { TemplateRecipeSchema, type TemplateRecipe } from '../models/template-recipe.js';
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-omistaja-tekee-omia-sovelluspohjia-ja-aloittaa-seuraavan-app).
 */
import { z } from 'zod';

/** The frames AIMEAT.atelier.app() takes. */
export const RECIPE_FRAMES = ['pages', 'tool', 'stage', 'reading', 'game', 'story'] as const;
/** How one acceptance criterion is checked, as aimeat_app_manage action criteria_set takes it. */
export const RECIPE_CHECKS = ['lint', 'scenario', 'screenshot', 'eval', 'person'] as const;

/** A need AIMEAT.atelier.requires() takes: a word, optionally with a qualifier ("member:use"). */
const NEED_RE = /^[a-z][a-zA-Z]*(:[a-zA-Z0-9_.-]+)?$/;
/** A moment: AIMEAT.atelier.ask, propose or handoff, and the kind ("ask:signIn"). */
const MOMENT_RE = /^(ask|propose|handoff):[a-zA-Z]+$/;

const id80 = z.string().min(1).max(80);

export const TemplateRecipeSchema = z.object({
    look: id80.optional().describe('A Design Book style kit id, e.g. "kit-mappi".'),
    genre: id80.optional().describe('The genre template id the next app forks, e.g. "genre-workbench".'),
    frame: z.enum(RECIPE_FRAMES).optional().describe('The frame AIMEAT.atelier.app() is given.'),
    screens: z.array(z.object({
        name: id80,
        from: id80.optional(),
        note: z.string().max(300).optional(),
    }).strict()).max(20).optional().describe('The screens, each with the part it starts from and a note.'),
    needs: z.array(z.string().min(1).max(40).regex(NEED_RE, 'a need, e.g. "session" or "member:use"')).max(12).optional()
        .describe('What AIMEAT.atelier.requires({ needs }) declares, e.g. "session", "ai", "member:use".'),
    moments: z.array(z.string().min(1).max(40).regex(MOMENT_RE, 'a moment, e.g. "ask:signIn", "propose:draft" or "handoff:say"')).max(20).optional()
        .describe('The Atelier moments the app uses: AIMEAT.atelier.ask, propose or handoff with a kind.'),
    data: z.array(z.object({
        what: z.string().min(1).max(160),
        where: z.string().min(1).max(160),
    }).strict()).max(20).optional().describe('What the app keeps and where it is kept.'),
    scopes: z.array(z.string().min(1).max(60)).max(20).optional().describe('The permission words the app asks for.'),
    criteria: z.array(z.object({
        text: z.string().min(1).max(300),
        check: z.enum(RECIPE_CHECKS),
    }).strict()).max(20).optional().describe('Acceptance criteria the next app carries (aimeat_app_manage action criteria_set).'),
}).strict();

export type TemplateRecipe = z.infer<typeof TemplateRecipeSchema>;
