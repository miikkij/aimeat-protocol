/**
 * @file src/services/appdev/overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "big picture" research surface for AI agents building apps ON AIMEAT —
 *   one call returns compact INDEXES of everything relevant to framing a build: the owner's
 *   existing apps (best templates), library packs (with per-model AEB proof summaries),
 *   the Atelier shells and genres a build starts from, skills (the paved-path builder skill first), curated +
 *   learned pitfalls (model-faceted), and the owner's agent-proposed template proposals.
 *   Progressive disclosure by design: indexes only, hard caps per list, drill-down via the
 *   existing endpoints/tools each section names. Scope: app development on the platform only.
 * @structure buildAppdevOverview(storage, config, reader, opts) → AppdevOverview
 * @usage
 *   import { buildAppdevOverview } from './overview.js';
 *   const overview = await buildAppdevOverview(storage, config, readerFor({ storage, config }, req.auth), { model, sections });
 * @version-history
 *   2026-11-26 — A curated entry verified more than two minor versions before the node carries
 *     needs_recheck: true, and pitfalls_curated counts them (the learned entries' rule, kb-quality.ts).
 *   2026-11-21 — pitfalls_curated.enforced names each enforced entry (id, title, enforced_by), narrowed
 *     by the areas like the items, and enforced_at_publish counts that list.
 *   2026-11-21 — opts.areas (the areas a draft uses) narrows both pitfall sections; a curated entry a
 *     publish check enforces (enforcedBy) leaves the curated list, counted as enforced_at_publish; a
 *     learned entry not re-checked within STALE_MINOR_WINDOW minor versions leaves the learned list,
 *     counted under needs_recheck with the call that re-checks it.
 *   2026-11-19 — Atelier is the only build guide: app_templates leaves out the Classic track's tiered
 *     shells and lists the Atelier shells, then the genres; `tier` and tier_guide give way to
 *     start_guide, which names the level, the genre or shell, and the platform sections. builder_skill
 *     names the Atelier skill for every app and section from-classic for a Classic one.
 *   2026-11-15 — The skills section puts aimeat-app-builder second after the Atelier skill, so the
 *     cap of 25 never drops the Classic builder skill that builder_skill names.
 *   2026-11-07 — `microservices` (appdev/microservices.ts): the Microservices Central of the person or
 *     the node, and when an app's server-side work belongs in a service there instead of an extension.
 *   (2026-11-04) A new app is sent to the Atelier track; Classic stays for an app already on it.
 *   2026-10-21 — secrets_note: a key is stored for the host the extension calls, which the extension declares in uses_secrets.
 *   2026-10-20 — SECURITY: opts.view (the caller's principal and readsAsOwner). The learned-pitfall
 *     and template-proposal sections read the owner's GHII and every agent of the owner with no
 *     visibility rule, so an agent without memory:read-as-owner read its owner's and its siblings'
 *     private records here (secaudit 2026-10, the v56 shape). Both now go through ownerScopeView; the
 *     template section keeps the owner GHII's proposal store, which the template tools read for any
 *     memory:read caller. No view reads as not reading as the owner.
 *   2026-10-05 — OVERVIEW_SECTIONS moved unchanged to models/tool-input-vocabulary.ts and is
 *     re-exported: the tool catalog states it (secaudit 2026-10, M3).
 *   v1.4.1 — 2026-10-05 — The skills section lists through the caller's reader too, so a skill hidden
 *     from AI stays hidden from an AI on a personal access token (secaudit 2026-10, DATA-2).
 *   v1.4.0 — 2026-09-29 — TARGET-082 V4: takes the caller's classification reader instead of an
 *     identity. The learned pitfalls and the template proposals are read through it (appdev-kb.ts
 *     listLearnedPitfalls, listOwnerScopeShown), so a record the caller may not see is left out and
 *     a learned entry shown under a warning label carries `classificationWarning`.
 *   v1.3.1 — 2026-09-26 — ownerOf() names the caller's account with localAccountOf, so a visitor from
 *     another node has no owner here instead of the local namesake's (secaudit 2026-09, A3-1).
 *   v1.3.0 — 2026-09-13 — The learned-pitfall section lists every active entry the caller can read,
 *     own and shared by other owners, critical first; `model` orders it and marks `same_model`
 *     instead of filtering to the entries that model wrote. The drill-down names the doors that can
 *     open one entry (aimeat_knowledge_get cannot: it reads only the calling agent's namespace). The
 *     owner-scope listing is appdev-kb's, not a copy kept here.
 *   2026-09-20 — `decision_model.rules` (the owner's decision rules an app may run) and
 *     `decision_model.setup_order` (the one order, from services/decide/setup-order.ts).
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

import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { isGEAI, localAccountOf } from '../../utils/gaii.js';
import { getLibraryPacks } from '../../data/library-packs.js';
import { getAppTemplateIndex } from '../../data/app-templates.js';
import { getAppdevPitfalls, getAppdevPitfallIndex, getAppdevPitfallFacets } from '../../data/appdev-pitfalls.js';
import { filterPitfalls, listLearnedPitfalls, listOwnerScopeShown, type OwnerScopeViewer } from './kb.js';
import { needsRecheck, STALE_MINOR_WINDOW } from './kb-quality.js';
import { getSoftwareVersion } from '../../utils/version.js';
import { ownerScopeView } from '../owner/scope-read.js';
import type { ContentReader } from '../classification/reader.js';
import { listSkills, type SkillAccessor } from '../skills.js';
import { dependencyIndex, appRef as depAppRef } from '../dependency-map.js';
import { decideAvailableFor } from '../decide/settings.js';
import { rulesRunnableBy } from '../decide/rules.js';
import { decideSetupOrderText } from '../decide/setup-order.js';
import { microservicesFor } from './microservices.js';
import { logger } from '../../utils/logger.js';

const CAP = 25;

// In models/ since 2026-10-05: the tool catalog states them (secaudit 2026-10, M3).
import { OVERVIEW_SECTIONS } from '../../models/tool-input-vocabulary.js';
export { OVERVIEW_SECTIONS };
export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];

export interface AppdevOverviewOpts {
    /** The builder's own model, indicative: marks matching pack proofs and orders learned pitfalls. Never hides one. */
    model?: string;
    /** Subset of sections to build (token economy); default all. */
    sections?: string[];
    /**
     * The areas the draft uses (app, auth, data, ext, ...). The pitfall sections then list only the
     * entries whose areas or category name one of them. Without it every entry is a candidate.
     */
    areas?: string[];
    /**
     * Who reads the owner-scope sections, for ownerScopeView: the caller's principal and whether it
     * reads as the owner (services/owner/scope-read.ts readsAsOwner). Without it the caller is read
     * as not reading as the owner, so a surface that forgets it shows less, never more.
     */
    view?: OwnerScopeViewer;
}

function capped<T>(items: T[]): { items: T[]; total: number; truncated: boolean } {
    return { items: items.slice(0, CAP), total: items.length, truncated: items.length > CAP };
}

/**
 * Resolve the caller (GHII or GAII) to its owner name + owner GHII. An ecosystem app has no owner
 * here, as before, and neither has an identity of another node: a visitor sees its own, never the
 * local namesake's apps, skills and pitfalls.
 */
function ownerOf(callerGaii: string, config: AimeatConfig): { owner: string | null; ownerGhii: string } {
    const owner = isGEAI(callerGaii) ? null : localAccountOf(callerGaii);
    return owner ? { owner, ownerGhii: `${owner}@${config.nodeId}` } : { owner: null, ownerGhii: callerGaii };
}

export async function buildAppdevOverview(
    storage: Storage,
    config: AimeatConfig,
    /** The caller's classification reader: its identity is the caller, and it decides what is shown. */
    reader: ContentReader,
    opts: AppdevOverviewOpts = {},
): Promise<Record<string, unknown>> {
    const callerGaii = reader.identity;
    const model = opts.model?.trim().toLowerCase();
    const wanted = new Set<string>(
        (opts.sections ?? []).length > 0
            ? opts.sections!.filter(s => (OVERVIEW_SECTIONS as readonly string[]).includes(s))
            : OVERVIEW_SECTIONS,
    );
    const { owner, ownerGhii } = ownerOf(callerGaii, config);
    // THE OWNER-SCOPE SECTIONS READ AS THE CALLER MAY. Both read the owner's GHII and every agent of
    // the owner, and until 2026-10-20 they applied no visibility rule, so an agent without
    // memory:read-as-owner read the private records of its owner and its siblings here, as the MCP
    // knowledge tools did (secaudit 2026-10, v56 shape). A surface that passes no view shows less.
    const view: OwnerScopeViewer = opts.view ?? { principal: callerGaii, readsAll: false };
    const out: Record<string, unknown> = {
        scope_note: 'App development ON AIMEAT only. Flow: research (this) → frame (the level, the genre or shell, the platform sections the app needs, packs, iam?) → propose to the user → build → publish + report learnings.',
        secrets_note: 'A key for an outside service is never held by an app or typed into one. The call is made in an extension whose header names it as {{secret:NAME}}; the node fills it from the signed-in person\'s vault when the request is sent, and a missing name fails as SECRET_UNKNOWN naming it. The person stores it FOR THE HOST the extension calls ("store NAME for host api.example.com") on their Access page (Secrets section) or via an agent holding secrets:manage (aimeat_secret_set { name, value, host }); aimeat_secret_list shows names, addresses and who used them, never a value. The extension declares the name and host in its manifest\'s uses_secrets, so a first use to that host binds by itself; any other first use is refused with SECRET_HOST and names a page where the owner allows it with one press.',
        ...(model ? { model } : {}),
    };

    // ── Can this owner's apps use the decision model? Answered before anything is designed, so no
    //    app is built around a model its owner cannot reach (TARGET-080). Always included: one read.
    const decide = await decideAvailableFor(storage, config, ownerGhii);
    // The decision rules an APP may run, so a builder reuses the owner's rule instead of shipping a
    // second copy of its questions, and the one order everything is set up in.
    const appRules = await rulesRunnableBy(storage, ownerGhii, 'app');
    out.decision_model = decide.available
        ? { available: true, library: 'aimeat-decide', skill: 'node:aimeat-decide', rules: appRules, setup_order: decideSetupOrderText(), note: 'Classify, screen, route, gate: typed questions, answers with probabilities, no text. Read skill node:aimeat-decide for when it fits and the recipes before designing a feature on it. When one of `rules` decides what the app needs decided, run it with AIMEAT.decide.rule(id) and send only the fields it lists under `sends`; otherwise tell the owner which rule to write.' }
        : { available: false, reason: decide.reason, setup_order: decideSetupOrderText(), note: 'Do not build a feature on the decision model for this owner. Tell them what to set up, in the order under setup_order, or design the feature without it.' };

    // ── Where server-side work goes when it outgrows an extension: a Microservices Central of the
    //    person's own or the node's, and when to suggest one. Always included: one read.
    out.microservices = await microservicesFor(storage, config, ownerGhii, view, reader);

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

    // ── Where a build starts: the Atelier shells, then the genres, then components and use cases ──
    if (wanted.has('app_templates')) {
        // THE SHELLS FIRST, and the cap is why: the index carries every genre and component, and a
        // cap of 25 in its own order once returned no shell at all (e2e-appdev-overview, 2026-09-19).
        // Since 2026-11-19 the shells are the Atelier ones: the Classic track's three tiered shells
        // (T1/T2/T3) are retired and gone from the registry (decision-atelier-is-the-only-app-build-
        // guide-classic-and-t1-t2-t3-are), so a builder is never handed a tier to choose.
        const idx = getAppTemplateIndex();
        const rank = (t: { kind: string }) => (t.kind === 'app-shell' ? 0 : t.kind === 'genre' ? 1 : 2);
        const ordered = [...idx].sort((a, b) => rank(a) - rank(b));
        out.app_templates = {
            ...capped(ordered.map(t => ({
                id: t.id, kind: t.kind,
                title: (t as { title?: string }).title ?? t.id,
            }))),
            start_guide: 'On the level fine a new app forks a genre (genre-<id>); on proto or plain it starts from shell-atelier; a game starts from shell-phaser-game. What only some apps need (a team, files, AI, intake, server-side work) is a platform section of the Atelier spec: aimeat_handbook_get { tier: "build-app-atelier/platform" }.',
            // Both doors: the tool read agent proposals only until 2026-09-18, so a chat connected
            // over MCP was pointed at a call it could not make.
            drill_down: 'The scaffold content of one: aimeat_app_template_get { id } over MCP, or GET /v1/app-templates/{id}.',
        };
    }

    // ── Skills — the paved-path builder skill first, then the owner's own ──
    if (wanted.has('skills')) {
        // The caller's own reader: without it the skill listing rebuilt one from the owner's name, so
        // an AI on a personal access token was read as the owner and saw the skills hidden from AI
        // (secaudit 2026-10, DATA-2).
        const accessor: SkillAccessor = { ownerName: owner, gaii: callerGaii, reader };
        const [nodeSkills, userSkills] = await Promise.all([
            listSkills(storage, config, 'node', accessor).catch(err => { logger.warn('title: continuing after a suppressed failure', { error: String(err) }); return []; }),
            owner ? listSkills(storage, config, 'user', accessor, owner).catch(err => { logger.warn('title: continuing after a suppressed failure', { error: String(err) }); return []; }) : Promise.resolve([]),
        ]);
        // The builder skill ahead of the cap: builder_skill below names it, and with more node skills
        // than CAP a named skill fell past the cut whenever the store listed it late, which
        // PostgreSQL does in no fixed order (nightly 43700514021).
        const BUILDERS = ['aimeat-app-builder-atelier'];
        const rank = (n: string): number => { const i = BUILDERS.indexOf(n); return i < 0 ? BUILDERS.length : i; };
        const builderFirst = [...nodeSkills].sort((a, b) => rank(a.name) - rank(b.name));
        out.skills = {
            builder_skill: 'node:aimeat-app-builder-atelier — load this FIRST (aimeat_skill_get), for a new app and for changing one; an app built on the retired Classic track is moved with section from-classic of the Atelier spec',
            node: capped(builderFirst.map(s => ({ ref: s.ref, description: s.description ?? null }))),
            user: capped(userSkills.map(s => ({ ref: s.ref, description: s.description ?? null, binding: s.binding ?? null }))),
            drill_down: 'aimeat_skill_get {ref}; app-bound skills via aimeat_skill_list binding=app:{owner}/{filename}',
        };
    }

    // ── Curated pitfalls (platform registry) ──
    // The areas the draft uses, when the caller named them: the pitfall sections keep what touches one.
    const areas = new Set((opts.areas ?? []).map(a => a.trim().toLowerCase()).filter(Boolean));
    if (areas.size > 0) out.areas = [...areas];

    if (wanted.has('pitfalls_curated')) {
        // An entry a publish check enforces is shown where the check fires, at publish, so it leaves
        // the list a builder reads before building (AppdevPitfallEntry.enforcedBy).
        const inAreas = (appliesTo: readonly string[]) => areas.size === 0 || appliesTo.some(a => areas.has(a));
        const enforcedEntries = getAppdevPitfalls().filter(p => p.enforcedBy);
        const enforced = new Set(enforcedEntries.map(p => p.id));
        // A curated entry is held to the rule a learned one is (kb-quality.ts needsRecheck): verified more
        // than STALE_MINOR_WINDOW minor versions before this node's own version, it is marked, so a
        // builder reads it as a lead to check rather than as how the node behaves today.
        const curatedVersion = getSoftwareVersion();
        const idx = getAppdevPitfallIndex()
            .filter(p => !enforced.has(p.id))
            .filter(p => inAreas(p.appliesTo))
            .map(p => (needsRecheck({ verified_version: p.verifiedVersion }, curatedVersion) ? { ...p, needs_recheck: true } : p));
        const curatedStale = idx.filter(p => 'needs_recheck' in p).length;
        // Still named, apart: what the publish answer will name when its check fires.
        const enforcedList = enforcedEntries.filter(p => inAreas(p.appliesTo))
            .map(p => ({ id: p.id, title: p.title, enforced_by: p.enforcedBy as string }));
        out.pitfalls_curated = {
            ...capped(idx),
            facets: getAppdevPitfallFacets(),
            ...(curatedStale > 0 ? {
                needs_recheck: curatedStale,
                needs_recheck_note: `${curatedStale} entries were last verified more than ${STALE_MINOR_WINDOW} minor versions before this node (${curatedVersion}); each carries needs_recheck: true. Read them as leads and check them against what the node does now.`,
            } : {}),
            ...(enforcedList.length > 0 ? {
                enforced_at_publish: enforcedList.length,
                enforced: enforcedList,
                enforced_note: 'Entries a publish check enforces are listed here under enforced, not in items: the publish answer names the entry (pitfall and url) when the check fires. GET /v1/appdev/pitfalls/{id} opens one.',
            } : {}),
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
        const all = await listLearnedPitfalls(storage, config, reader, { includeShared: true, view });
        // An entry not re-checked within STALE_MINOR_WINDOW minor versions of this node leaves the
        // list and is counted below with the call that re-checks it. Nothing is deleted.
        const nodeVersion = getSoftwareVersion();
        const stale = all.filter(e => (e.status ?? 'active') === 'active' && needsRecheck(e, nodeVersion));
        const staleKeys = new Set(stale.map(e => e.key));
        const entries = all.filter(e => !staleKeys.has(e.key));
        const page = filterPitfalls(entries, {
            status: 'active', sort: 'severity', preferModel: model, limit: CAP, ...(areas.size > 0 ? { areas: [...areas] } : {}),
        });
        const ownStale = stale.filter(e => e.source === 'own');
        out.pitfalls_learned = {
            needs_recheck: {
                count: stale.length,
                ...(ownStale.length > 0 ? { own: ownStale.slice(0, CAP).map(e => e.key) } : {}),
                window: `${STALE_MINOR_WINDOW} minor versions behind ${nodeVersion}`,
                recheck: 'Read the entry and check it against this node. Still true: report it again with the same category and slug '
                    + '(aimeat_appdev_pitfall_report, which stamps it with this version), or PATCH /v1/appdev/pitfalls/learned/{category}/{slug} { "verified": true }. '
                    + 'No longer true: report it with status outdated and retired_by.',
            },
            items: page.pitfalls.map(e => ({
                key: e.key, title: e.title, category: e.category ?? null, model: e.model ?? null,
                severity: e.severity, status: e.status, shared: e.shared, source: e.source,
                verified_at: e.verified_at ?? null, verified_version: e.verified_version ?? null,
                // A shared entry lives under another identity, and its body is read by naming it.
                ...(e.source === 'shared' ? { owner: e.owner } : {}),
                ...(model ? { same_model: e.model === model } : {}),
                ...(e.classificationWarning ? { classificationWarning: e.classificationWarning } : {}),
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
        // The proposal store is the owner's GHII: proposeTemplate writes every proposal there, kept
        // private from other accounts, and aimeat_app_template_list and GET /v1/appdev/templates read
        // it for any caller with memory:read. So its rows stay, as those read them. What another
        // identity of the owner keeps under the same prefix (a sibling agent's own namespace) is read
        // through ownerScopeView, as every owner-scope listing is (secaudit 2026-10, v56 shape).
        const records = (await listOwnerScopeShown(storage, config, reader, {
            prefix: 'template.catalog.', tags: ['template'],
        })).filter(r => /\.manifest$/.test(r.key))
            .filter(r => r.ownerGaii === ownerGhii || ownerScopeView([r], view.principal, view.readsAll).length > 0);
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
