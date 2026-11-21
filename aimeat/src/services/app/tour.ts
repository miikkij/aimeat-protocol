/**
 * @file src/services/app/tour.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's guided tour as the node knows it: read from the app's own
 *   `<script type="application/json" id="aimeat-tour">` block at every publish, checked, and kept on
 *   the manifest (`manifest.tour`). The Atelier kit reads the same block in the browser and draws the
 *   tour (src/static/sdk-libs/atelier/tour.js); the node reads it for two reasons:
 *   - App Catalog shows the owner's switch for the tour's invitation only for an app that has a tour
 *     (`manifest.tourInviteOff`, services/app/settings.ts `tour_invite`);
 *   - the person's own AI reads the steps through the app's record (aimeat_app_get), so it can
 *     explain the app in chat with the same words the screen uses.
 *
 *   THE BYTES ARE THE SOURCE, as for the config block (services/app/config.ts): a version without
 *   the block has no tour, and nothing is carried forward. A block that does not parse is refused at
 *   publish with what is wrong, so a served app never meets a broken one.
 * @structure AppTourDecl · parseAppTour(html) → null | { tour } | { error } · tourSummary(decl)
 * @usage const parsed = parseAppTour(html); if (parsed && 'tour' in parsed) manifest.tour = parsed.tour;
 * @version-history
 *   v1.0.0 — 2026-11-22 — Initial (wish-opastettu-kierros-sovelluksiin-monikielinen-tutorial-ja-oma-).
 */

/** Words in one language, or one string for every language. */
export type TourWords = string | Record<string, string>;

export interface AppTourStep {
    help?: string;
    target?: string;
    title?: TourWords;
    text?: TourWords;
    do?: 'click' | 'input' | 'change';
}

export interface AppTour {
    id: string;
    title?: TourWords;
    version: number;
    steps: AppTourStep[];
}

export interface AppTourDecl {
    tours: AppTour[];
    /** The languages the words are written in, besides plain strings. */
    languages: string[];
}

const TOUR_BLOCK_RE = /<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])(?=[^>]*\bid\s*=\s*["']aimeat-tour["'])[^>]*>([\s\S]*?)<\/script>/i;
/** A tour is prose-sized; the ceiling keeps a pathological app from making every publish parse megabytes. */
const MAX_BLOCK_BYTES = 32 * 1024;
const MAX_TOURS = 10;
const MAX_STEPS = 20;
const MAX_WORDS = 1200;
const MAX_TARGET = 300;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const DO_KINDS = new Set(['click', 'input', 'change']);

type Checked<T> = { ok: T } | { error: string };

function words(v: unknown, where: string, langs: Set<string>): Checked<TourWords | undefined> {
    if (v === undefined || v === null) return { ok: undefined };
    if (typeof v === 'string') {
        if (v.length > MAX_WORDS) return { error: `${where} is over ${MAX_WORDS} characters` };
        return { ok: v };
    }
    if (typeof v !== 'object' || Array.isArray(v)) return { error: `${where} must be a string or an object per language ({ "en": "…", "fi": "…" })` };
    const out: Record<string, string> = {};
    for (const [lang, s] of Object.entries(v as Record<string, unknown>)) {
        if (!LANG_RE.test(lang)) return { error: `${where}: "${lang}" is not a language code (en, fi, es, …)` };
        if (typeof s !== 'string') return { error: `${where}.${lang} must be a string` };
        if (s.length > MAX_WORDS) return { error: `${where}.${lang} is over ${MAX_WORDS} characters` };
        out[lang] = s;
        langs.add(lang);
    }
    if (Object.keys(out).length === 0) return { error: `${where} names no language` };
    return { ok: out };
}

function step(raw: unknown, where: string, langs: Set<string>): Checked<AppTourStep> {
    if (typeof raw === 'string') {
        if (!ID_RE.test(raw)) return { error: `${where}: "${raw}" is not a data-ak-help id (letters, digits and _ . : -, at most 64)` };
        return { ok: { help: raw } };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${where} must be an object or a data-ak-help id` };
    const r = raw as Record<string, unknown>;
    const out: AppTourStep = {};
    if (r.help !== undefined) {
        if (typeof r.help !== 'string' || !ID_RE.test(r.help)) return { error: `${where}.help must be a data-ak-help id (letters, digits and _ . : -, at most 64)` };
        out.help = r.help;
    }
    if (r.target !== undefined) {
        if (typeof r.target !== 'string' || !r.target.trim() || r.target.length > MAX_TARGET) return { error: `${where}.target must be a CSS selector of at most ${MAX_TARGET} characters` };
        out.target = r.target;
    }
    for (const key of ['title', 'text'] as const) {
        const w = words(r[key] ?? (key === 'text' ? r.body : undefined), `${where}.${key}`, langs);
        if ('error' in w) return w;
        if (w.ok !== undefined) out[key] = w.ok;
    }
    if (r.do !== undefined && r.do !== false) {
        const kind = r.do === true ? 'click' : String(r.do);
        if (!DO_KINDS.has(kind)) return { error: `${where}.do must be "click", "input" or "change"` };
        if (!out.help && !out.target) return { error: `${where}.do needs a place: give the step a help id or a target` };
        out.do = kind as AppTourStep['do'];
    }
    if (!out.help && !out.target && out.title === undefined && out.text === undefined) {
        return { error: `${where} says nothing: give it a title or a text, or a place (help or target)` };
    }
    return { ok: out };
}

/**
 * The tour an app declares, checked. `null` when the app declares none; `{ error }` names what is
 * wrong, so publish can refuse with it.
 */
export function parseAppTour(html: string): { tour: AppTourDecl } | { error: string } | null {
    const m = TOUR_BLOCK_RE.exec(html);
    if (!m) return null;
    const raw = (m[1] ?? '').trim();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BLOCK_BYTES) return { error: `the aimeat-tour block is over ${MAX_BLOCK_BYTES / 1024} kB` };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (err) {
        return { error: `the aimeat-tour block is not JSON: ${(err as Error).message}` };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'the aimeat-tour block must be an object: { "tours": [...] } or { "steps": [...] }' };
    }
    const decl = parsed as Record<string, unknown>;
    const list: unknown[] = Array.isArray(decl.tours) ? decl.tours
        : (Array.isArray(decl.steps) ? [{ id: 'main', steps: decl.steps }] : []);
    if (list.length === 0) return { error: 'the aimeat-tour block has no tours: give it "tours": [...] or "steps": [...]' };
    if (list.length > MAX_TOURS) return { error: `the aimeat-tour block has ${list.length} tours; at most ${MAX_TOURS}` };
    const langs = new Set<string>();
    const ids = new Set<string>();
    const tours: AppTour[] = [];
    for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t || typeof t !== 'object' || Array.isArray(t)) return { error: `tour ${i + 1} must be an object with "steps"` };
        const tr = t as Record<string, unknown>;
        const id = tr.id === undefined ? `tour-${i + 1}` : tr.id;
        if (typeof id !== 'string' || !ID_RE.test(id)) return { error: `tour ${i + 1}: the id must hold letters, digits and _ . : - (at most 64)` };
        if (ids.has(id)) return { error: `two tours have the id "${id}"` };
        ids.add(id);
        const where = `tour "${id}"`;
        const title = words(tr.title, `${where}.title`, langs);
        if ('error' in title) return title;
        const version = tr.version === undefined ? 1 : Number(tr.version);
        if (!Number.isInteger(version) || version < 1 || version > 100000) return { error: `${where}.version must be a whole number from 1` };
        if (!Array.isArray(tr.steps) || tr.steps.length === 0) return { error: `${where} has no steps` };
        if (tr.steps.length > MAX_STEPS) return { error: `${where} has ${tr.steps.length} steps; at most ${MAX_STEPS} (3 to 5 read best)` };
        const steps: AppTourStep[] = [];
        for (let n = 0; n < tr.steps.length; n++) {
            const s = step(tr.steps[n], `${where} step ${n + 1}`, langs);
            if ('error' in s) return s;
            steps.push(s.ok);
        }
        tours.push({ id, ...(title.ok !== undefined ? { title: title.ok } : {}), version, steps });
    }
    return { tour: { tours, languages: [...langs].sort() } };
}

/** What a listing says about an app's tour: how many tours and steps, in which languages. */
export function tourSummary(decl: AppTourDecl | undefined | null): { tours: number; steps: number; languages: string[] } | null {
    if (!decl || !Array.isArray(decl.tours) || decl.tours.length === 0) return null;
    return {
        tours: decl.tours.length,
        steps: decl.tours.reduce((n, t) => n + (Array.isArray(t.steps) ? t.steps.length : 0), 0),
        languages: Array.isArray(decl.languages) ? decl.languages : [],
    };
}
