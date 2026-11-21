/**
 * @file test/unit/appdev-kb-similarity.test.ts
 * @description The rules of services/appdev/kb-quality.ts: the similarity score a new pitfall report
 *   is compared with, read on real pairs of the production knowledge base (2026-11-21); the
 *   staleness window; the fixed category list; the check that a text names one app. And what a
 *   builder reads about it: the finish step's four questions, the verification checklist, and the
 *   Classic move that names its traps itself.
 * @usage pnpm test -- appdev-kb-similarity
 * @version-history
 *   v1.1.0 — 2026-11-21 — nearestPitfallCategory: the category a free-text word files under.
 *   v1.0.0 — 2026-11-21 — initial.
 */
import { describe, it, expect } from 'vitest';
import {
    similarityScore, SIMILARITY_THRESHOLD, pitfallTokens, needsRecheck, isPitfallCategory, namesOneApp,
    PITFALL_CATEGORIES, platformDefectWish, nearestPitfallCategory,
} from '../../src/services/appdev/kb-quality.js';
import { getAppdevPitfalls } from '../../src/data/appdev-pitfalls.js';
import { buildFinishChecklist, PITFALL_FOUR_QUESTIONS } from '../../src/services/appdev/flow-constants.js';
import { AFTER_PUBLISH_SECTION } from '../../src/data/builtin-skills.app-builder-common.js';
import { APP_BUILDER_ATELIER_SKILL_ENTRY } from '../../src/data/builtin-skills.app-builder-atelier.js';
import { atelierPlatformPiece } from '../../src/services/builder/atelier-platform.js';

// Two reports of the same Atelier dialog trap, by two models, three days apart.
const dialogA = {
    title: 'AIMEAT.atelier.dialog closes only on its ✕: every action button must close it in its run',
    symptom: 'A dialog built with actions such as [{ id: \'cancel\', label: \'Cancel\' }] or a confirm action whose run saves something stays open after the button is pressed; only the ✕ closes it, and the person presses the button again.',
};
const dialogB = {
    title: 'Give an Atelier dialog action a run function, and leave an empty list badge out',
    symptom: 'A button in AIMEAT.atelier.dialog({ actions: [{ id, label, tone }] }) did nothing when pressed: the build expected onClose(id) to receive the action id, but onClose receives a close reason. Separately, a list row with badge: \'\' drew an empty coloured dot beside the row.',
};
const langEntry = {
    title: 'Set aimeat-lang before aimeat-boot.js to force a default UI language',
    symptom: 'An Atelier app meant to be Finnish-first showed English to every visitor whose browser locale was en-US: the language resolver falls back to navigator.language.',
};

describe('similarityScore', () => {
    it('scores two reports of one trap at or above the threshold', () => {
        expect(similarityScore(dialogA, dialogB)).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    });

    it('scores unrelated entries far below it, and is symmetric', () => {
        const s = similarityScore(dialogA, langEntry);
        expect(s).toBeLessThan(0.1);
        expect(similarityScore(langEntry, dialogA)).toBe(s);
    });

    it('scores an entry against itself 1, and an empty text 0', () => {
        expect(similarityScore(dialogA, dialogA)).toBe(1);
        expect(similarityScore({ title: '', symptom: '' }, dialogA)).toBe(0);
        expect(similarityScore({ title: null, symptom: undefined }, { title: null })).toBe(0);
    });

    it('meets word forms and ignores words every entry uses', () => {
        expect([...pitfallTokens('Publishes the app page')]).toEqual(['publish']);
        expect(similarityScore({ title: 'publishing breaks' }, { title: 'published breaks' })).toBe(1);
    });

    it('keeps the curated registry apart: no two curated entries reach the threshold but the two closest', () => {
        // The curated entries are distinct by definition, so this is how often the threshold would
        // ask a question it did not need to. Two pairs reach it today (0.40 and 0.37).
        const cur = getAppdevPitfalls({ includeOutdated: true });
        let over = 0;
        for (let i = 0; i < cur.length; i++) {
            for (let j = i + 1; j < cur.length; j++) if (similarityScore(cur[i], cur[j]) >= SIMILARITY_THRESHOLD) over++;
        }
        expect(over).toBeLessThanOrEqual(2);
    });
});

describe('needsRecheck', () => {
    it('keeps an entry checked within two minor versions, and drops one three behind', () => {
        expect(needsRecheck({ verified_version: '4.1.2' }, '4.3.1')).toBe(false);
        expect(needsRecheck({ verified_version: '4.3.1' }, '4.3.1')).toBe(false);
        expect(needsRecheck({ verified_version: '4.0.3' }, '4.3.1')).toBe(true);
        expect(needsRecheck({ verified_version: '3.9.0' }, '4.0.0')).toBe(true);
    });

    it('drops an unstamped entry only when it was created before the stamp existed', () => {
        expect(needsRecheck({ created: '2026-08-01T00:00:00.000Z' }, '4.3.1')).toBe(true);
        expect(needsRecheck({ created: '2026-11-20T00:00:00.000Z' }, '4.3.1')).toBe(false);
        expect(needsRecheck({}, '4.3.1')).toBe(false);
    });

    it('treats a version it cannot read as nothing to judge', () => {
        expect(needsRecheck({ verified_version: '4.0.0' }, 'dev')).toBe(false);
        expect(needsRecheck({ verified_version: '5.0.0' }, '4.3.1')).toBe(false);
    });
});

describe('what a finished build reads', () => {
    it('asks the four questions in order where it used to say "report what bit you"', () => {
        const finish = buildFinishChecklist();
        const order = ['platform-defect', 'App Development Notes', 'general web craft', 'search the knowledge base first'].map(s => finish.indexOf(s));
        expect(order.every(i => i > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(finish).not.toMatch(/report what bit you with/);
        expect(AFTER_PUBLISH_SECTION).toContain(PITFALL_FOUR_QUESTIONS);
    });

    it('serves one verification checklist and names it from the skill', () => {
        const verify = atelierPlatformPiece('verify', 'https://node.example')!.text;
        for (const s of ['Name the browser', 'visible path', 'Log.entryAdded', 'consent window', 'requestFullscreen', 'data-ak-field']) expect(verify).toContain(s);
        expect(APP_BUILDER_ATELIER_SKILL_ENTRY.skillMd).toContain('build-app-atelier/verify');
    });

    it('moves a Classic app without sending the builder to a private entry', () => {
        const text = atelierPlatformPiece('from-classic', 'https://node.example')!.text;
        expect(text).not.toContain('aimeat_appdev_pitfall_list');
        expect(text).toContain('patternProperties');
    });
});

describe('categories, app names and the wish text', () => {
    it('accepts the fixed list and refuses a free-text category', () => {
        for (const c of PITFALL_CATEGORIES) expect(isPitfallCategory(c)).toBe(true);
        expect(isPitfallCategory('three-world')).toBe(false);
        expect(isPitfallCategory('')).toBe(false);
    });

    it('files a free-text category under the nearest fixed one', () => {
        // A fixed name stays itself, an alias and a dash-separated part name their category.
        for (const c of PITFALL_CATEGORIES) expect(nearestPitfallCategory(c)).toBe(c);
        expect(nearestPitfallCategory('build')).toBe('app');
        expect(nearestPitfallCategory('rendering')).toBe('games');
        expect(nearestPitfallCategory('three-world')).toBe('games');
        expect(nearestPitfallCategory('ui-layout')).toBe('ui');
        expect(nearestPitfallCategory('storage')).toBe('data');
        // A word that names nothing files under app, never under a category it merely contains
        // ("build" holds the letters "ui").
        expect(nearestPitfallCategory('zzz-unknown')).toBe('app');
        expect(nearestPitfallCategory('builder')).toBe('app');
        expect(nearestPitfallCategory('')).toBe('app');
    });

    it('finds an app file name, and not a library path', () => {
        expect(namesOneApp('Seen in alice/notes.html after a reload')).toBe(true);
        expect(namesOneApp('Load /v1/libs/aimeat-auth.js first')).toBe(false);
        expect(namesOneApp('the page.html of any app')).toBe(false);
    });

    it('writes a wish that names the entry and leaves out what was not given', () => {
        const w = platformDefectWish({ title: 'T', symptom: 'S', resolution: 'R', key: 'packages/appdev-pitfalls/app/t' });
        expect(w).toContain('Platform defect: T');
        expect(w).toContain('packages/appdev-pitfalls/app/t');
        expect(w).not.toContain('Evidence:');
    });
});
