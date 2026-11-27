/**
 * @file src/services/appdev/template-start.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `how_to_start` text of an owner's app template: how the next build starts from it.
 *   GET /v1/appdev/templates/:id and the aimeat_app_template_get MCP tool both answer it from here, so
 *   the two say the same (CLAUDE.md, Backend: one capability, one implementation). The fork, scaffold
 *   and toll sentences are the ones the MCP tool answered before; a template with a recipe
 *   (models/template-recipe.ts) adds, after them, how to build from the recipe's parts.
 * @structure templateHowToStart, recipeSteps
 * @usage const how_to_start = templateHowToStart(manifest, await templateSourceApp(...));
 * @version-history
 *   v1.0.0 — 2026-11-27 — Moved out of the aimeat_app_template_get handler, with the recipe's sentences
 *     added (wish-omistaja-tekee-omia-sovelluspohjia-ja-aloittaa-seuraavan-app).
 */
import type { AppRecord } from '../../storage/interface.js';
import type { TemplateRecipe } from '../../models/template-recipe.js';
import type { TemplateProposalManifest } from '../app/template-proposals.js';
import { appToll } from '../app/pacing.js';

const q = (s: string): string => JSON.stringify(s);

/** The sentences that say how to build from a recipe, one per part it carries; none for an empty recipe. */
export function recipeSteps(recipe: TemplateRecipe | undefined): string[] {
    if (!recipe) return [];
    const steps: string[] = [];
    if (recipe.look && recipe.genre) steps.push(`Start from the look ${q(recipe.look)} (aimeat_designbook_kit) and fork the genre ${q(recipe.genre)} (aimeat_app_template_get).`);
    else if (recipe.look) steps.push(`Start from the look ${q(recipe.look)} (aimeat_designbook_kit).`);
    else if (recipe.genre) steps.push(`Fork the genre ${q(recipe.genre)} (aimeat_app_template_get).`);
    if (recipe.frame) steps.push(`Give AIMEAT.atelier.app() the frame ${q(recipe.frame)}.`);
    if (recipe.screens?.length) {
        const screens = recipe.screens.map(s => `${s.name}${s.from ? ` (from ${s.from})` : ''}${s.note ? `: ${s.note}` : ''}`);
        steps.push(`Build these screens: ${screens.join('; ')}.`);
    }
    if (recipe.needs?.length) steps.push(`Declare what the app needs with AIMEAT.atelier.requires({ needs: ${JSON.stringify(recipe.needs)} }).`);
    if (recipe.moments?.length) steps.push(`Use these moments with AIMEAT.atelier.ask, AIMEAT.atelier.propose and AIMEAT.atelier.handoff: ${recipe.moments.join(', ')}.`);
    if (recipe.data?.length) steps.push(`Keep the data where the recipe says: ${recipe.data.map(d => `${d.what} in ${d.where}`).join('; ')}.`);
    if (recipe.scopes?.length) steps.push(`Ask for these permissions: ${recipe.scopes.join(', ')}.`);
    if (recipe.criteria?.length) {
        steps.push(`Write the ${recipe.criteria.length} carried criteria with aimeat_app_manage action criteria_set: ${recipe.criteria.map(c => `${q(c.text)} (${c.check})`).join('; ')}.`);
    }
    return steps;
}

/** How the next build starts from this template, given its source app's live record (null when it is gone). */
export function templateHowToStart(
    manifest: Pick<TemplateProposalManifest, 'startMode' | 'recipe'>, app: AppRecord | null,
): string {
    // The source's pacing amount: morsels taking the app once moves, never a price.
    const tollMorsels = appToll(app?.manifest);
    // v1 proposals are owner-scoped, so the reader IS the source owner (same-owner fork
    // always passes the gate). The note covers future/other-party readers: an app with a
    // pacing amount is taken once (POST /v1/app-store/purchase) before the fork gate opens.
    const start = !app
        ? 'Source app is gone — scaffold from reuse_notes.'
        : manifest.startMode === 'scaffold'
            ? 'Scaffold a fresh app from reuse_notes (do not fork).'
            : tollMorsels > 0
                ? `Fork the source app (aimeat_app_fork) and adapt per reuse_notes. Another owner takes the app first (POST /v1/app-store/purchase, ${tollMorsels} morsels of pacing) — the fork gate enforces it.`
                : 'Fork the source app (aimeat_app_fork) and adapt per reuse_notes.';
    const steps = recipeSteps(manifest.recipe);
    return steps.length ? `${start} To build from its recipe: ${steps.join(' ')}` : start;
}
