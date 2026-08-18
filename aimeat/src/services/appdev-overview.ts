/**
 * @file appdev-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "big picture" research surface for AI agents building apps ON AIMEAT —
 *   one call returns compact INDEXES of everything relevant to framing a build: the owner's
 *   existing apps (best templates), library packs (with per-model AEB proof summaries),
 *   app-shell templates (T1/T2/T3), skills (the paved-path builder skill first), curated +
 *   learned pitfalls (model-faceted), and the owner's agent-proposed template proposals.
 *   Progressive disclosure by design: indexes only, hard caps per list, drill-down via the
 *   existing endpoints/tools each section names. Scope: app development on the platform only.
 * @structure buildAppdevOverview(storage, config, callerGaii, opts) → AppdevOverview
 * @usage
 *   import { buildAppdevOverview } from '../services/appdev-overview.js';
 *   const overview = await buildAppdevOverview(storage, config, identity, { model, sections });
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 5: each app carries its `ai_posture`, and the section
 *     states the disclosure contract. Research-first is the moment to learn this — an agent that
 *     sees which of its own apps already declare copies that wiring instead of re-deriving it.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { getLibraryPacks } from '../data/library-packs.js';
import { getAppTemplateIndex } from '../data/app-templates.js';
import { getAppdevPitfallIndex, getAppdevPitfallFacets } from '../data/appdev-pitfalls.js';
import { listSkills, type SkillAccessor } from './skills.js';
import { logger } from '../utils/logger.js';

const CAP = 25;

export const OVERVIEW_SECTIONS = [
    'apps', 'library_packs', 'app_templates', 'skills',
    'pitfalls_curated', 'pitfalls_learned', 'template_proposals',
] as const;
export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];

export interface AppdevOverviewOpts {
    /** Indicative model filter — marks matching pack proofs and filters learned pitfalls. */
    model?: string;
    /** Subset of sections to build (token economy); default all. */
    sections?: string[];
}

function capped<T>(items: T[]): { items: T[]; total: number; truncated: boolean } {
    return { items: items.slice(0, CAP), total: items.length, truncated: items.length > CAP };
}

/** Resolve the caller (GHII or GAII) to its owner name + owner GHII. */
function ownerOf(callerGaii: string, config: AimeatConfig): { owner: string | null; ownerGhii: string } {
    const parsed = parseGAII(callerGaii);
    if (parsed?.owner) return { owner: parsed.owner, ownerGhii: `${parsed.owner}@${config.nodeId}` };
    if (callerGaii.includes('@') && !callerGaii.includes('#')) {
        return { owner: callerGaii.split('@')[0], ownerGhii: callerGaii };
    }
    return { owner: null, ownerGhii: callerGaii };
}

/** Owner-scope memory aggregation (GHII + all same-owner agents), deduped by key. */
async function listOwnerScope(
    storage: Storage, config: AimeatConfig, callerGaii: string,
    opts: { prefix?: string; tags?: string[] },
): Promise<MemoryRecord[]> {
    const { owner, ownerGhii } = ownerOf(callerGaii, config);
    if (!owner) return storage.listMemory(callerGaii, opts);
    const agents = await storage.getAgentsByOwner(owner);
    const owners = [ownerGhii, ...agents.map(a => a.gaii)];
    const priority = new Map(owners.map((g, i) => [g, i]));
    const rows = await storage.listMemoryForOwners(owners, opts);
    rows.sort((x, y) => (priority.get(x.ownerGaii) ?? 0) - (priority.get(y.ownerGaii) ?? 0));
    const seen = new Set<string>();
    const out: MemoryRecord[] = [];
    for (const rec of rows) {
        if (!seen.has(rec.key)) { seen.add(rec.key); out.push(rec); }
    }
    return out;
}

export async function buildAppdevOverview(
    storage: Storage,
    config: AimeatConfig,
    callerGaii: string,
    opts: AppdevOverviewOpts = {},
): Promise<Record<string, unknown>> {
    const model = opts.model?.trim().toLowerCase();
    const wanted = new Set<string>(
        (opts.sections ?? []).length > 0
            ? opts.sections!.filter(s => (OVERVIEW_SECTIONS as readonly string[]).includes(s))
            : OVERVIEW_SECTIONS,
    );
    const { owner, ownerGhii } = ownerOf(callerGaii, config);
    const out: Record<string, unknown> = {
        scope_note: 'App development ON AIMEAT only. Flow: research (this) → frame (tier, packs, iam?) → propose to the user → build → publish + report learnings.',
        ...(model ? { model } : {}),
    };

    // ── The owner's existing apps — often the best starting template ──
    if (wanted.has('apps')) {
        const { apps, total } = await storage.listApps({
            limit: CAP + 1, offset: 0, ownerGaii: ownerGhii, viewerGhii: ownerGhii,
        });
        out.apps = {
            items: apps.slice(0, CAP).map(a => ({
                filename: a.filename,
                name: a.manifest?.name ?? a.filename,
                description: a.manifest?.description ?? null,
                category: a.manifest?.category ?? null,
                tags: a.manifest?.tags ?? [],
                version: a.versionNumber,
                forkable: a.forkable ?? false,
                forked_from: a.manifest?.forkedFrom ?? null,
                // TARGET-058: what this app says about the AI inside it. An agent researching
                // before a build reads this to find the apps that already do it right and copy
                // THAT, rather than re-deriving the disclosure wiring from the spec. These are the
                // owner's OWN apps, so the publish check's gap travels with them — it is a note to
                // the owner about their own work, and here it is exactly the useful part.
                ai_posture: a.manifest?.aiPosture ?? null,
            })),
            total,
            truncated: total > CAP,
            drill_down: 'aimeat_app_get {filename} for metadata; the app URL for source',
            ai_transparency: 'An app that generates text/images/audio/video calls '
                + 'AIMEAT.ai.disclose(r.provenance) so the reader sees the label, attaches the record '
                + 'to what it stores with AIMEAT.ai.declare(item, r.provenance), and declares '
                + '<meta name="aimeat-ai" content="generates=text; discloses=yes; public-interest=no">. '
                + 'Start from an app whose ai_posture below reads source:"declared" and copy how it '
                + 'wires that up. A gap here is the publish check telling you what is missing.',
        };
    }

    // ── Library packs (registry index + per-model proof summary) ──
    if (wanted.has('library_packs')) {
        const packs = getLibraryPacks().filter(p => p.status !== 'deprecated');
        out.library_packs = {
            ...capped(packs.map(p => ({
                id: p.id,
                kind: p.kind,
                title: p.title,
                category: p.category,
                status: p.status,
                model_tier: p.modelTier ?? 'any',
                proven_models: (p.proofs ?? []).filter(pr => pr.verdict === 'pass').map(pr => pr.model),
                ...(model ? { proven_for_model: (p.proofs ?? []).some(pr => pr.verdict === 'pass' && pr.model === model) } : {}),
                ...(p.apiCaveat ? { api_caveat: true } : {}),
            }))),
            drill_down: 'GET /v1/library-packs/{id} for the ai_doc + include lines',
        };
    }

    // ── App-shell templates (T1/T2/T3) + components ──
    if (wanted.has('app_templates')) {
        const idx = getAppTemplateIndex();
        out.app_templates = {
            ...capped(idx.map(t => ({
                id: t.id, kind: t.kind,
                ...('tier' in t && t.tier ? { tier: t.tier } : {}),
                title: (t as { title?: string }).title ?? t.id,
            }))),
            tier_guide: 'T1 pure client (auth+data) · T2 +cortex UI libs · T3 +extension (server-side work)',
            drill_down: 'GET /v1/app-templates/{id} for the scaffold content',
        };
    }

    // ── Skills — the paved-path builder skill first, then the owner's own ──
    if (wanted.has('skills')) {
        const accessor: SkillAccessor = { ownerName: owner, gaii: callerGaii };
        const [nodeSkills, userSkills] = await Promise.all([
            listSkills(storage, config, 'node', accessor).catch(err => { logger.warn('title: continuing after a suppressed failure', { error: String(err) }); return []; }),
            owner ? listSkills(storage, config, 'user', accessor, owner).catch(err => { logger.warn('title: continuing after a suppressed failure', { error: String(err) }); return []; }) : Promise.resolve([]),
        ]);
        const builderFirst = [...nodeSkills].sort((a, b) =>
            (a.name === 'aimeat-app-builder' ? -1 : 0) - (b.name === 'aimeat-app-builder' ? -1 : 0));
        out.skills = {
            builder_skill: 'node:aimeat-app-builder — load this FIRST (aimeat_skill_get)',
            node: capped(builderFirst.map(s => ({ ref: s.ref, description: s.description ?? null }))),
            user: capped(userSkills.map(s => ({ ref: s.ref, description: s.description ?? null, binding: s.binding ?? null }))),
            drill_down: 'aimeat_skill_get {ref}; app-bound skills via aimeat_skill_list binding=app:{owner}/{filename}',
        };
    }

    // ── Curated pitfalls (platform registry) ──
    if (wanted.has('pitfalls_curated')) {
        const idx = getAppdevPitfallIndex();
        out.pitfalls_curated = {
            ...capped(idx),
            facets: getAppdevPitfallFacets(),
            drill_down: 'GET /v1/appdev/pitfalls/{id} (filter: ?applies_to=&severity=)',
        };
    }

    // ── Learned pitfalls (owner scope, model-faceted) ──
    if (wanted.has('pitfalls_learned')) {
        const records = (await listOwnerScope(storage, config, callerGaii, {
            prefix: 'packages/appdev-pitfalls/', tags: ['pitfall'],
        })).filter(r => r.key !== 'packages/appdev-pitfalls/manifest');
        const modelFacets: Record<string, number> = {};
        const entries = records.map(r => {
            const v = r.value as { title?: string; category?: string; slug?: string; model?: string; severity?: string; status?: string } | null;
            if (v?.model) modelFacets[v.model] = (modelFacets[v.model] ?? 0) + 1;
            return {
                key: r.key, title: v?.title ?? r.key, category: v?.category ?? null,
                model: v?.model ?? null, severity: v?.severity ?? 'warn',
                status: v?.status ?? 'active', shared: r.visibility === 'public',
            };
        }).filter(e => e.status === 'active')
            .filter(e => !model || e.model === model);
        out.pitfalls_learned = {
            ...capped(entries),
            model_facets: modelFacets,
            drill_down: 'aimeat_appdev_pitfall_list (scope/category/model filters, pagination); full entries via aimeat_knowledge_get package_id=appdev-pitfalls',
        };
    }

    // ── Agent-proposed template proposals (owner scope) ──
    if (wanted.has('template_proposals')) {
        const records = (await listOwnerScope(storage, config, callerGaii, {
            prefix: 'template.catalog.', tags: ['template'],
        })).filter(r => /\.manifest$/.test(r.key));
        const entries = records.map(r => {
            const v = r.value as { id?: string; title?: string; tier?: string; tags?: string[]; model?: string; derivedFrom?: unknown; startMode?: string } | null;
            return {
                id: v?.id ?? r.key.replace(/^template\.catalog\./, '').replace(/\.manifest$/, ''),
                title: v?.title ?? null, tier: v?.tier ?? null, tags: v?.tags ?? [],
                model: v?.model ?? null, derived_from: v?.derivedFrom ?? null, start_mode: v?.startMode ?? null,
            };
        });
        out.template_proposals = {
            ...capped(entries),
            drill_down: 'aimeat_app_template_get {id} (fork-vs-scaffold guidance + source-app commerce fields)',
        };
    }

    return out;
}
