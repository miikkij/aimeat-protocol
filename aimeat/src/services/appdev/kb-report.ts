/**
 * @file src/services/appdev/kb-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Report (upsert) one learned AppDev pitfall: the ONE implementation behind the node's
 *   MCP tool aimeat_appdev_pitfall_report, POST /v1/appdev/pitfalls/learned and, through that route,
 *   both connector doors. Moved here from kb.ts on 2026-11-21, when the report gained the checks that
 *   keep the knowledge base from only growing (rules in kb-quality.ts):
 *   - a new entry is compared with every entry the reporter can read (own, other owners' shared,
 *     curated; active and outdated), and a close one refuses the report with the matches listed until
 *     the call says `supersedes` (update or replace that entry) or `confirm_new`;
 *   - the category is one of a fixed list for a new entry; topic words go to `tags`;
 *   - a learned entry is stored at most `warn`; `critical` waits as `requested_severity` until a
 *     curator (a node operator) raises it;
 *   - an entry about one app (app_ref, or an owner/file.html in its text) is kept private and the
 *     answer points to App Development Notes; a shared entry names no app;
 *   - status outdated takes `retired_by`; a report that brings a retired entry back says so;
 *   - `evidence` and `seen_version` are asked for (a warning, not a refusal: older clients omit them);
 *   - kind `platform-defect` hands back a ready wish text and tells the node's operator once.
 * @structure PitfallReportInput · PitfallReportResult · reportLearnedPitfall()
 * @usage import { reportLearnedPitfall } from '../services/appdev/kb-report.js';
 * @version-history
 *   v1.0.0 — 2026-11-21 — Moved from kb.ts and extended with the similarity check, the fixed
 *     categories, the severity cap, the app-specific rule, retired_by, evidence and seen_version, and
 *     kind platform-defect.
 */

import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { writeMemoryRecord } from '../memory/write.js';
import type { ContentReader } from '../classification/reader.js';
import { getAppdevPitfalls } from '../../data/appdev-pitfalls.js';
import { findOperatorGhii } from '../operators.js';
import { sendDirectMessage } from '../message/send.js';
import { logger } from '../../utils/logger.js';
import {
    PITFALL_PREFIX, PITFALL_SLUG_RE, slugifyKb, pitfallEntryKey, findOwnEntry,
    ownPitfallRecords, sharedPitfallRecords, upsertPitfallManifest, verificationStamp,
    type LearnedPitfallValue, type OwnerScopeViewer,
} from './kb.js';
import {
    PITFALL_CATEGORIES, isPitfallCategory, similarityScore, SIMILARITY_THRESHOLD, namesOneApp,
    APP_NOTES_POINTER, platformDefectWish,
} from './kb-quality.js';

export interface PitfallReportInput {
    model: string;
    category: string;
    title: string;
    symptom: string;
    resolution: string;
    slug?: string;
    applies_to?: string[];
    severity?: 'info' | 'warn' | 'critical';
    status?: 'active' | 'outdated';
    app_ref?: string;
    share?: boolean;
    /** A file:line, a doc URL or a reproduction. Asked for; a report without it carries a warning. */
    evidence?: string;
    /** The node version the reporter saw this on. Asked for, as evidence is. */
    seen_version?: string;
    /** Free topic words (the category is one of the fixed list). */
    tags?: string[];
    /** An entry this report replaces: an own entry's key (updated in place), a curated id, or another owner's shared key. */
    supersedes?: string;
    /** The reporter read the close matches and this is a different entry. */
    confirm_new?: boolean;
    /** platform-defect: the platform could prevent this; the answer carries a wish text. */
    kind?: 'pitfall' | 'platform-defect';
    /** With status outdated: what retired it (a commit hash, a lint rule id, an SDK/library version). */
    retired_by?: string;
}

/** One entry close to a report: what the refusal lists, so the reporter can choose. */
export interface PitfallMatch {
    ref: string;
    source: 'own' | 'shared' | 'curated';
    title: string;
    score: number;
    status: string;
    retired_by?: string;
    open: string;
}

export type PitfallReportResult =
    | {
        ok: true; key: string; category: string; slug: string; updated: boolean; version: number;
        visibility: string; verified_at: string; verified_version: string;
        severity: string; requested_severity?: 'critical';
        /** What the report should have carried and did not, said as what to add. */
        warnings: string[];
        /** What the node did beyond storing the words, and where something else belongs. */
        notes: string[];
        supersedes?: string;
        reactivated?: boolean;
        platform_defect?: { wish_text: string; how: string; operators_told: boolean };
    }
    | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

/** Every entry the reporter can read, as candidates for the similarity check and for `supersedes`. */
async function candidates(
    storage: Storage, config: AimeatConfig, reader: ContentReader, view: OwnerScopeViewer,
): Promise<Array<PitfallMatch & { symptom?: string }>> {
    const out: Array<PitfallMatch & { symptom?: string }> = [];
    // Read as this reporter may: the owner-scope view and the classification check, as every listing
    // that hands entries to a caller does, because the refusal lists what it found.
    for (const r of await ownPitfallRecords(storage, config, reader, view)) {
        const v = r.value as Partial<LearnedPitfallValue> | null;
        out.push({
            ref: r.key, source: 'own', title: v?.title ?? r.key, symptom: v?.symptom, score: 0, status: v?.status ?? 'active',
            ...(v?.retired_by ? { retired_by: v.retired_by } : {}),
            open: `aimeat_memory_read ${JSON.stringify({ key: r.key, owner_scope: true })}`,
        });
    }
    for (const r of await sharedPitfallRecords(storage, config, reader)) {
        const v = r.value as Partial<LearnedPitfallValue> | null;
        out.push({
            ref: r.key, source: 'shared', title: v?.title ?? r.key, symptom: v?.symptom, score: 0, status: v?.status ?? 'active',
            ...(v?.retired_by ? { retired_by: v.retired_by } : {}),
            open: `aimeat_memory_read_public ${JSON.stringify({ gaii: r.ownerGaii, key: r.key })}`,
        });
    }
    for (const p of getAppdevPitfalls({ includeOutdated: true })) {
        out.push({
            ref: p.id, source: 'curated', title: p.title, symptom: p.symptom, score: 0, status: p.status ?? 'active',
            open: `GET ${config.baseUrl.replace(/\/+$/, '')}/v1/appdev/pitfalls/${p.id}`,
        });
    }
    return out;
}

/** The key a `supersedes` value names among the candidates: a full key, `category/slug`, or a curated id. */
function resolveSupersedes<T extends { ref: string }>(ref: string, pool: T[]): T | undefined {
    const r = ref.trim();
    return pool.find(c => c.ref === r)
        ?? pool.find(c => c.ref === `${PITFALL_PREFIX}${r.replace(/^\/+/, '').toLowerCase()}`);
}

/** Tell the node's operator about a platform defect, once, as the node tells it about its own faults. Never throws. */
async function tellOperator(storage: Storage, config: AimeatConfig, reporter: string, wish: string): Promise<boolean> {
    try {
        const operator = await findOperatorGhii(storage, config);
        if (!operator) return false;
        const sent = await sendDirectMessage({ storage, config, peers: new Map() }, {
            senderGhii: operator,
            recipientGhii: operator,
            subject: 'A builder reported a platform defect',
            body: `${reporter} reported this through aimeat_appdev_pitfall_report with kind platform-defect.\n\n${wish}`,
            kind: 'system-fault',
            skipContactGate: true,
            sendLimit: 'exempt',
        });
        return sent.ok;
    } catch (err) {
        logger.warn('[appdev] the operator could not be told about a platform defect report', { error: String(err) });
        return false;
    }
}

/**
 * Report (upsert) one learned pitfall. Upserts by {category, slug}, or into the own entry `supersedes`
 * names, in whichever of the owner's identities already holds it, and stamps `verified_at` /
 * `verified_version`: a report is a claim about this node as it is now, so re-reporting an entry is
 * how it is re-verified.
 */
export async function reportLearnedPitfall(
    storage: Storage, config: AimeatConfig,
    who: { principal: string; scopes: string[]; roles: string[] },
    input: PitfallReportInput, softwareVersion: string,
    opts: {
        /** The caller's classification reader: the entries a report is compared with are read through it. */
        reader: ContentReader;
        /** Who reads the owner scope (ownerScopeView). Without it the reporter reads as not reading as the owner. */
        view?: OwnerScopeViewer;
        /** True for a node operator, the curator who may store `critical`. */
        curator?: boolean;
    },
): Promise<PitfallReportResult> {
    let cat = slugifyKb(input.category);
    let slg = input.slug ? input.slug.toLowerCase() : slugifyKb(input.title);
    if (!PITFALL_SLUG_RE.test(cat) || !PITFALL_SLUG_RE.test(slg)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Invalid category/slug — use kebab-case (a-z, 0-9, dashes)' };
    }
    let key = pitfallEntryKey(cat, slg);
    const now = new Date();
    let existing = await findOwnEntry(storage, config, who.principal, key);
    const warnings: string[] = [];
    const notes: string[] = [];

    const text = `${input.title}\n${input.symptom}\n${input.resolution}`;
    const aboutOneApp = !!input.app_ref?.trim() || namesOneApp(text);
    if (aboutOneApp && input.share === true) {
        return {
            ok: false, status: 400, code: 'INVALID_INPUT',
            message: 'A shared entry names no app: leave out app_ref and the app\'s file name, and write the trap as it bites any app, or keep it private (share false). '
                + APP_NOTES_POINTER.replace(' This entry was kept private to your owner scope.', ''),
        };
    }

    const view = opts.view ?? { principal: who.principal, readsAll: false };
    let supersededRef: string | undefined;
    let pool: Awaited<ReturnType<typeof candidates>> | undefined;
    if (input.supersedes?.trim()) {
        pool = await candidates(storage, config, opts.reader, view);
        const target = resolveSupersedes(input.supersedes, pool);
        // An own entry is updated in place: its key, its history and its identity stay. It is read
        // again for the write, unpresented, as every read-to-update here is (findOwnEntry).
        const ownRecord = target?.source === 'own' ? await findOwnEntry(storage, config, who.principal, target.ref) : null;
        if (!target || (target.source === 'own' && !ownRecord)) {
            return {
                ok: false, status: 404, code: 'NOT_FOUND',
                message: `supersedes names no entry you can read: "${input.supersedes}". Give an own entry's key (packages/appdev-pitfalls/<category>/<slug> or <category>/<slug>), a curated id, or a shared entry's key, as aimeat_appdev_pitfall_list shows them.`,
            };
        }
        if (ownRecord) {
            existing = ownRecord;
            key = ownRecord.key;
            const v = ownRecord.value as Partial<LearnedPitfallValue> | null;
            const parts = key.slice(PITFALL_PREFIX.length).split('/');
            cat = v?.category ?? parts[0];
            slg = v?.slug ?? parts.slice(1).join('/');
        } else {
            supersededRef = target.ref;
            notes.push(target.source === 'curated'
                ? `The curated entry ${target.ref} is changed by the node's maintainers; your entry records that it supersedes it.`
                : `The shared entry ${target.ref} belongs to another owner; your entry records that it supersedes it.`);
        }
    }

    if (!existing && !isPitfallCategory(cat)) {
        return {
            ok: false, status: 400, code: 'INVALID_INPUT',
            message: `category "${input.category}" is not one of the fixed list: ${PITFALL_CATEGORIES.join(', ')}. Choose the closest one and put topic words in tags.`,
            details: { categories: [...PITFALL_CATEGORIES] },
        };
    }

    // A new entry is compared with everything the reporter can read. An update of an own entry by its
    // own {category, slug} is not: the reporter named the entry.
    if (!existing && !input.confirm_new && !input.supersedes?.trim()) {
        pool ??= await candidates(storage, config, opts.reader, view);
        const matches: PitfallMatch[] = pool
            .map(c => ({ ...c, score: similarityScore({ title: input.title, symptom: input.symptom }, c) }))
            .filter(c => c.score >= SIMILARITY_THRESHOLD)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(c => ({
                ref: c.ref, source: c.source, title: c.title, score: c.score, status: c.status,
                ...(c.retired_by ? { retired_by: c.retired_by } : {}), open: c.open,
            }));
        if (matches.length > 0) {
            const list = matches.map(m => `${m.ref} (${m.source}, ${m.status}${m.retired_by ? `, retired by ${m.retired_by}` : ''}, score ${m.score}): ${m.title}`).join('; ');
            return {
                ok: false, status: 409, code: 'SIMILAR_ENTRY',
                message: `This report is close to ${matches.length === 1 ? 'an entry' : `${matches.length} entries`} already in the knowledge base: ${list}. `
                    + 'Open them first (each match\'s `open`). If one says the same thing, report again with supersedes: "<its ref>": an own entry is updated in place '
                    + '(a retired one comes back), another is recorded as replaced. If yours is a different trap, report again with confirm_new: true.',
                details: { matches, threshold: SIMILARITY_THRESHOLD },
            };
        }
    }

    const prior = existing?.value as Partial<LearnedPitfallValue> | null | undefined;
    const status = input.status ?? 'active';
    let reactivated: LearnedPitfallValue['reactivated'];
    if (prior?.status === 'outdated' && status === 'active') {
        reactivated = { at: now.toISOString(), version: softwareVersion, ...(prior.retired_by ? { retired_by: prior.retired_by } : {}) };
        warnings.push(`This entry had been marked outdated${prior.retired_by ? ` (retired by ${prior.retired_by})` : ''}. Your report brings it back to the active list; say in its evidence what still breaks${prior.retired_by ? ` after ${prior.retired_by}` : ''}.`);
    }
    // A re-report of a retired entry keeps what retired it unless it names something new.
    const retiredBy = status === 'outdated'
        ? (input.retired_by?.trim() || (prior?.status === 'outdated' ? prior.retired_by : undefined))
        : undefined;
    if (status === 'outdated' && !retiredBy) {
        warnings.push('An outdated entry says what retired it: pass retired_by (a commit hash, a lint rule id, or an SDK or library version).');
    }

    let severity: LearnedPitfallValue['severity'] = input.severity ?? 'warn';
    let requestedSeverity: 'critical' | undefined;
    let raisedBy: string | undefined;
    if (severity === 'critical') {
        if (opts.curator) raisedBy = who.principal;
        else if (prior?.severity === 'critical' && prior.severity_raised_by) raisedBy = prior.severity_raised_by;
        else {
            severity = 'warn';
            requestedSeverity = 'critical';
            notes.push('A learned entry is stored at most as warn. It keeps requested_severity critical, and a node operator raises it when the trap is critical for every builder.');
        }
    }

    if (!input.evidence?.trim()) warnings.push('Add evidence: a file and line, a documentation URL, or the steps that reproduce it. An entry without evidence cannot be checked against the code later.');
    if (!input.seen_version?.trim()) warnings.push(`Add seen_version: the node version you saw this on (this node runs ${softwareVersion}).`);

    const normModel = input.model.trim().toLowerCase();
    const stamp = verificationStamp(softwareVersion, now);
    const topicTags = [...new Set((input.tags ?? []).map(t => slugifyKb(t)).filter(t => t && t !== 'entry'))].slice(0, 8);
    const value: LearnedPitfallValue = {
        title: input.title, symptom: input.symptom, resolution: input.resolution,
        model: normModel,
        category: cat, slug: slg,
        applies_to: (input.applies_to ?? []).map(a => a.toLowerCase()),
        severity,
        status,
        ...(requestedSeverity ? { requested_severity: requestedSeverity } : {}),
        ...(raisedBy ? { severity_raised_by: raisedBy } : {}),
        ...(input.app_ref ? { app_ref: input.app_ref } : {}),
        ...(input.evidence?.trim() ? { evidence: input.evidence.trim() } : {}),
        ...(input.seen_version?.trim() ? { seen_version: input.seen_version.trim() } : {}),
        ...(topicTags.length ? { tags: topicTags } : {}),
        ...(input.kind === 'platform-defect' ? { kind: 'platform-defect' as const } : {}),
        ...(retiredBy ? { retired_by: retiredBy } : {}),
        ...(reactivated ? { reactivated } : {}),
        ...(supersededRef ? { supersedes: supersededRef } : {}),
        reported_by: who.principal,
        created: prior?.created ?? now.toISOString(),
        updated: now.toISOString(),
        ...stamp,
    };
    // An entry about one app stays with its owner unless the call says otherwise, and the answer says
    // where such a lesson belongs; share:true with an app was refused above.
    const visibility = aboutOneApp
        ? 'owner'
        : input.share === true ? 'public' : input.share === false ? 'owner' : (existing?.visibility ?? 'owner');
    if (aboutOneApp) notes.push(APP_NOTES_POINTER);
    const tags = ['knowledge-entry', 'pitfall', `model:${normModel}`, ...value.applies_to.map(a => `applies:${a}`)];

    // The entry is a memory record, so it answers to memory's rules: the archive guard, the key and
    // value-size ceilings, the byte quota. Written into whichever of the owner's identities already
    // holds the key, so an update never forks a second copy.
    const written = await writeMemoryRecord({ storage, config }, {
        principal: who.principal,
        targetGaii: existing?.ownerGaii ?? who.principal,
        scopes: who.scopes,
        roles: who.roles,
    }, {
        key, value, visibility: visibility as MemoryRecord['visibility'], tags,
        pipeline: 'appdev.pitfall_report',
        ownerScoped: true,
    });
    if (!written.ok) return { ok: false, status: written.status, code: written.code, message: written.message };
    await upsertPitfallManifest(storage, config, who.principal, key, input.title);

    let platformDefect: { wish_text: string; how: string; operators_told: boolean } | undefined;
    if (input.kind === 'platform-defect') {
        const wish = platformDefectWish({ ...input, key });
        // Told once, when the entry is new: a reworded re-report is not a second defect.
        const told = existing ? false : await tellOperator(storage, config, who.principal, wish);
        platformDefect = {
            wish_text: wish,
            how: 'The platform owner tracks defects as wishes. Hand wish_text to the person you work for, so it reaches the platform owner as a wish; '
                + (told ? 'this node\'s operator was told as well.' : existing ? 'this node\'s operator was told when the entry was first reported.' : 'no operator on this node could be told, so send it to support@operators with aimeat_dm_send.'),
            operators_told: told,
        };
    }

    return {
        ok: true, key, category: cat, slug: slg,
        updated: !!existing, version: (existing?.version ?? 0) + 1, visibility,
        ...stamp,
        severity,
        ...(requestedSeverity ? { requested_severity: requestedSeverity } : {}),
        warnings, notes,
        ...(supersededRef ? { supersedes: supersededRef } : {}),
        ...(reactivated ? { reactivated: true } : {}),
        ...(platformDefect ? { platform_defect: platformDefect } : {}),
    };
}
