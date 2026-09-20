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
 *   v1.3.0 — 2026-09-13 — The learned-pitfall section lists every active entry the caller can read,
 *     own and shared by other owners, critical first; `model` orders it and marks `same_model`
 *     instead of filtering to the entries that model wrote. The drill-down names the doors that can
 *     open one entry (aimeat_knowledge_get cannot: it reads only the calling agent's namespace). The
 *     owner-scope listing is appdev-kb's, not a copy kept here.
 *   2026-09-19 — `decision_model`: whether this owner's apps can use the decision model, and the
 *     skill to read if so, so nothing is built around a model its owner cannot reach (TARGET-080).
 *   2026-09-06 — `secrets_note` beside `scope_note`: a key for an outside service is named as
 *     `{{secret:NAME}}` in an extension's header and filled from the person's vault, never held
 *     by the app; the note says where the person stores it and which tools an agent uses.
 *   v1.2.0 — 2026-09-03 — App items carry `requires` (the dependency map), so an agent sees what exists before rebuilding it.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 5: each app carries its `ai_posture`, and the section
 *     states the disclosure contract. Research-first is the moment to learn this — an agent that
 *     sees which of its own apps already declare copies that wiring instead of re-deriving it.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { getLibraryPacks } from '../data/library-packs.js';
import { getAppTemplateIndex } from '../data/app-templates.js';
import { getAppdevPitfallIndex, getAppdevPitfallFacets } from '../data/appdev-pitfalls.js';
import { filterPitfalls, listLearnedPitfalls, listOwnerScopeMemory } from './appdev-kb.js';
import { listSkills, type SkillAccessor } from './skills.js';
import { dependencyIndex, appRef as depAppRef } from './dependency-map.js';
import { decideAvailableFor } from './decide/settings.js';
import { logger } from '../utils/logger.js';

const CAP = 25;

export const OVERVIEW_SECTIONS = [
    'apps', 'library_packs', 'app_templates', 'skills',
    'pitfalls_curated', 'pitfalls_learned', 'template_proposals',
] as const;
export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];

export interface AppdevOverviewOpts {
    /** The builder's own model, indicative: marks matching pack proofs and orders learned pitfalls. Never hides one. */
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
        secrets_note: 'A key for an outside service is never held by an app or typed into one. The call lives in an extension whose header names it as {{secret:NAME}}; the node fills it from the signed-in person\'s vault on the way out, and a missing name fails as SECRET_UNKNOWN naming it. The person stores it on their Access page (section 04 Secrets) or via an agent holding secrets:manage (aimeat_secret_set); aimeat_secret_list shows names and who used them, never a value.',
        ...(model ? { model } : {}),
    };

    // ── Can this owner's apps use the decision model? Answered before anything is designed, so no
    //    app is built around a model its owner cannot reach (TARGET-080). Always included: one read.
    const decide = await decideAvailableFor(storage, config, ownerGhii);
    out.decision_model = decide.available
        ? { available: true, library: 'aimeat-decide', skill: 'node:aimeat-decide', note: 'Classify, screen, route, gate: typed questions, answers with probabilities, no text. Read skill node:aimeat-decide for when it fits and the recipes before designing a feature on it.' }
        : { available: false, reason: decide.reason, note: 'Do not build a feature on the decision model for this owner. Tell them what to set up, or design the feature without it.' };

    // ── The owner's existing apps — often the best starting template ──
    if (wanted.has('apps')) {
        const { apps, total } = await storage.listApps({
            limit: CAP + 1, offset: 0, ownerGaii: ownerGhii, viewerGhii: ownerGhii,
        });
        // What each app loads and calls, from the dependency map: an agent about to build reads
        // here which cortexes and extensions its owner's apps already lean on, and reuses them.
        const deps = await dependencyIndex(storage);
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
                requires: deps.byApp.get(depAppRef(a.ownerName, a.filename)) ?? { cortex: [], extensions: [] },
                // TARGET-058: what this app says about the AI inside it. An agent researching
                // before a build reads this to find the apps that already do it right and copy
                // THAT, rather than re-deriving the disclosure wiring from the spec. These are the
                // owner's OWN apps, so the publish check's gap travels with them — it is a note to
                // the owner about their own work, and here it is exactly the useful part.
                ai_posture: a.manifest?.aiPosture ?? null,
            })),
            total,
            truncated: total > CAP,
            drill_down: 'aimeat_app_get {filename} for metadata; the app URL for source; GET /v1/dependencies for who uses which cortex and extension',
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
        // THE SHELLS FIRST, and the cap is why. This section is named for T1/T2/T3, and they are
        // what a build starts from, but the index also carries every genre and component: 54
        // entries on 2026-09-20, of which exactly three have a tier, all behind 51 that do not. A
        // cap of 25 in the index's own order therefore returned no shell at all, and an agent
        // asking where to start was handed components. e2e-appdev-overview has said so since
        // 2026-09-19 ("T1 shell missing") on both backends.
        const idx = getAppTemplateIndex();
        const tiered = (t: { tier?: string }) => Boolean(t.tier);
        const ordered = [...idx.filter(tiered), ...idx.filter(t => !tiered(t))];
        out.app_templates = {
            ...capped(ordered.map(t => ({
                id: t.id, kind: t.kind,
                ...('tier' in t && t.tier ? { tier: t.tier } : {}),
                title: (t as { title?: string }).title ?? t.id,
            }))),
            tier_guide: 'T1 pure client (auth+data) · T2 +cortex UI libs · T3 +extension (server-side work)',
            // Both doors: the tool read agent proposals only until 2026-09-18, so a chat connected
            // over MCP was pointed at a call it could not make.
            drill_down: 'The scaffold content of one: aimeat_app_template_get { id } over MCP, or GET /v1/app-templates/{id}.',
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

    // ── Learned pitfalls: every active entry the caller can read, critical first ──
    // The caller's owner scope plus what other owners shared platform-wide, through the same
    // filter-and-sort step the list tool and the AppDev page use. The named model only ORDERS the
    // list. It used to filter it to entries that model had written, and only in the caller's own
    // scope: on aimeat.io on 2026-09-13 a builder naming gemini-2.5-pro got 0 of 123 entries, and
    // no other owner saw any of the 118 shared ones. An entry is about the platform far more often
    // than about the model that happened to meet it.
    if (wanted.has('pitfalls_learned')) {
        const entries = await listLearnedPitfalls(storage, config, callerGaii, { includeShared: true });
        const page = filterPitfalls(entries, { status: 'active', sort: 'severity', preferModel: model, limit: CAP });
        out.pitfalls_learned = {
            items: page.pitfalls.map(e => ({
                key: e.key, title: e.title, category: e.category ?? null, model: e.model ?? null,
                severity: e.severity, status: e.status, shared: e.shared, source: e.source,
                verified_at: e.verified_at ?? null, verified_version: e.verified_version ?? null,
                // A shared entry lives under another identity, and its body is read by naming it.
                ...(e.source === 'shared' ? { owner: e.owner } : {}),
                ...(model ? { same_model: e.model === model } : {}),
            })),
            total: page.total,
            truncated: page.total > CAP,
            sources: page.filtered_facets.source,
            model_facets: page.filtered_facets.model,
            order: 'critical first; inside a severity, entries written by the model you named first, then newest',
            drill_down: 'aimeat_appdev_pitfall_list (paging, category/applies_to/model filters). One full entry: '
                + 'aimeat_memory_read {key, owner_scope: true} for your own, aimeat_memory_read_public {gaii: owner, key} for a shared one',
        };
    }

    // ── Agent-proposed template proposals (owner scope) ──
    if (wanted.has('template_proposals')) {
        const records = (await listOwnerScopeMemory(storage, config, callerGaii, {
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
