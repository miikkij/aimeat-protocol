/**
 * @file src/services/appdev/kb-quality.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules that keep the learned AppDev knowledge base from only growing: the fixed
 *   category list, the similarity score a new report is compared with, the staleness window, the
 *   check that a shared entry names no app, and the wish text a platform defect report hands back.
 *   Pure functions, no storage: services/appdev/kb.ts (the report) and services/appdev/overview.ts
 *   (the research list) call them.
 *
 *   WHY. An analysis of the production knowledge base on 2026-11-21 (195 active entries) found ten
 *   near-duplicate pairs and at least seven re-reports of entries already marked outdated, because a
 *   report was matched to an existing entry only by its exact {category, slug}; 31 free-text
 *   categories beside nine fixed areas; entries no one had re-checked for months still listed first;
 *   and 32 entries about one app in a list every builder reads.
 * @structure PITFALL_CATEGORIES · isPitfallCategory · STALE_MINOR_WINDOW · STAMPS_BEGAN ·
 *   needsRecheck · pitfallTokens · similarityScore · SIMILARITY_THRESHOLD · namesOneApp ·
 *   platformDefectWish · APP_NOTES_POINTER
 * @usage import { similarityScore, needsRecheck, PITFALL_CATEGORIES } from './kb-quality.js';
 * @version-history
 *   v1.0.0 — 2026-11-21 — initial: fixed categories, similarity score, staleness window, app-name
 *     check and the platform-defect wish text.
 */

/**
 * The categories a learned entry is filed under. The nine curated areas (data/appdev-pitfall-types.ts
 * AppdevPitfallScope) and the four free-text categories the learned entries used most on 2026-11-21
 * (data 13, ui 8, atelier 8; games stands for the three-world, phaser, rendering and games entries).
 * A topic word that is not one of these goes to `tags`.
 */
export const PITFALL_CATEGORIES = [
    'app', 'publish', 'auth', 'data', 'ext', 'cortex', 'ai', 'ui', 'mobile', 'atelier', 'realtime', 'iam', 'games',
] as const;
export type PitfallCategory = (typeof PITFALL_CATEGORIES)[number];

export function isPitfallCategory(value: string): value is PitfallCategory {
    return (PITFALL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * How many minor versions an entry may trail the node's own version before the research list leaves
 * it out as "needs re-check". 2: an entry checked on 4.1 is still listed on 4.3 and not on 4.4.
 */
export const STALE_MINOR_WINDOW = 2;

/**
 * The day the verification stamp began (kb.ts v1.3.0). An entry without a stamp that was created
 * before it has never been checked against the platform; one created after it was written as a raw
 * memory record, which says nothing either way, so it is kept.
 */
export const STAMPS_BEGAN = '2026-09-13';

function majorMinor(version: string | null | undefined): [number, number] | null {
    const m = /^(\d+)\.(\d+)/.exec(String(version ?? '').trim());
    return m ? [Number(m[1]), Number(m[2])] : null;
}

/** True when an entry is too old to list in the research overview without a re-check. */
export function needsRecheck(
    entry: { verified_version?: string | null; created?: string | null; updated?: string | null },
    nodeVersion: string,
): boolean {
    const node = majorMinor(nodeVersion);
    const seen = majorMinor(entry.verified_version);
    if (!seen) {
        const since = String(entry.created ?? entry.updated ?? '');
        return since !== '' && since < STAMPS_BEGAN;
    }
    if (!node) return false;
    if (seen[0] !== node[0]) return seen[0] < node[0];
    return node[1] - seen[1] > STALE_MINOR_WINDOW;
}

/* ── Similarity ──────────────────────────────────────────────────────────────────────────────
 * A token-overlap score, no model call: the Dice coefficient of the word sets of the titles, and
 * of the titles and symptoms together, averaged. Words that every entry here uses (app, page,
 * node, aimeat) and English function words carry no signal and are left out; a light suffix strip
 * lets "publishes", "published" and "publish" meet. */

const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'then', 'than', 'are', 'was',
    'were', 'not', 'but', 'its', 'your', 'you', 'has', 'have', 'had', 'can', 'cannot', 'does', 'did',
    'one', 'all', 'any', 'only', 'also', 'own', 'they', 'them', 'their', 'there', 'which', 'what', 'why',
    'how', 'after', 'before', 'without', 'instead', 'still', 'just', 'more', 'most', 'other', 'same',
    'each', 'every', 'never', 'always', 'should', 'must', 'will', 'would', 'could', 'been', 'being',
    'over', 'under', 'out', 'off', 'about', 'again', 'once', 'here', 'where', 'while', 'because', 'both',
    'either', 'nothing', 'something', 'thing', 'things', 'way', 'gets', 'get', 'set', 'sets', 'use',
    'uses', 'used', 'using', 'make', 'makes', 'made', 'app', 'apps', 'aimeat', 'node', 'page', 'pages',
    'builder', 'build', 'built', 'works', 'work', 'shows', 'show', 'does', 'doesn', 'isn', 'don',
]);

function stem(word: string): string {
    if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
    if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
    if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

/** The comparable words of a text: lower case, letters and digits, three characters or more. */
export function pitfallTokens(text: string | null | undefined): Set<string> {
    const out = new Set<string>();
    for (const raw of String(text ?? '').toLowerCase().split(/[^a-z0-9äöå]+/)) {
        if (raw.length < 3 || STOPWORDS.has(raw)) continue;
        const w = stem(raw);
        if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
    }
    return out;
}

function dice(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return (2 * shared) / (a.size + b.size);
}

/** 0..1: how close two entries are, read from their titles and symptoms. */
export function similarityScore(
    a: { title?: string | null; symptom?: string | null },
    b: { title?: string | null; symptom?: string | null },
): number {
    const ta = pitfallTokens(a.title), tb = pitfallTokens(b.title);
    const wa = pitfallTokens(`${a.title ?? ''} ${a.symptom ?? ''}`), wb = pitfallTokens(`${b.title ?? ''} ${b.symptom ?? ''}`);
    return Math.round(((dice(ta, tb) + dice(wa, wb)) / 2) * 1000) / 1000;
}

/**
 * At or above this score a report is close enough to an existing entry that it is refused until the
 * reporter says which it is: `supersedes` the existing one, or `confirm_new`. Set from real pairs of
 * the production knowledge base (test/unit/appdev-kb-similarity.test.ts holds them): two reports of
 * the same Atelier dialog trap score 0.39; the closest two distinct curated entries score up to 0.40
 * and the next 0.37, so a refusal is a question to the reporter, never a verdict. Below 0.35 the
 * score stops separating: an older suite's report that only resembles a curated entry scores 0.34.
 */
export const SIMILARITY_THRESHOLD = 0.35;

/** A file name of one app in the text (owner/file.html), which a shared entry does not carry. */
export function namesOneApp(text: string): boolean {
    return /\b[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_.-]*\.html\b/i.test(text);
}

/** Where a lesson about one app goes, said as an instruction because the place is a document space, not a key. */
export const APP_NOTES_POINTER = 'A lesson about one app belongs in that app\'s own document in App Development Notes '
    + '(the developer\'s document space with one document per app, in the organism where app development is recorded), '
    + 'not in the shared knowledge base. This entry was kept private to your owner scope.';

/** The ready text of a wish for a platform defect, which the reporter hands to the platform owner. */
export function platformDefectWish(input: {
    title: string; symptom: string; resolution: string; evidence?: string; seen_version?: string; key: string;
}): string {
    return [
        `Platform defect: ${input.title}`,
        '',
        `What a builder sees: ${input.symptom}`,
        `Workaround today: ${input.resolution}`,
        ...(input.evidence ? [`Evidence: ${input.evidence}`] : []),
        ...(input.seen_version ? [`Seen on node version: ${input.seen_version}`] : []),
        `Knowledge base entry: ${input.key}`,
        '',
        'Wanted: the platform prevents this (a check, a default or a refusal with its reason), so the entry can be retired.',
    ].join('\n');
}
