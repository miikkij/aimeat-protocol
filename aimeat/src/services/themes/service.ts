/**
 * @file src/services/themes/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles (07-themes-and-styles.md): the node's themes, the styles each holds,
 *   the operator's component CSS and theme CSS, who chooses, and a person's own choice. Every door (the
 *   HTTP routes, the MCP tools on three surfaces, the SPA shell) comes through here, so the checks,
 *   the warnings and the refusals are written once.
 *
 *   TWO LEVELS. Jouni: "Tyyli kuuluu teemaan ... AIMEAT default teema, siinä on tyyleinä AIMEAT,
 *   CIrcuit, paper, voltage jne." A theme holds styles (styles.ts), its default style, which styles the
 *   pill offers, its component CSS ({ componentId: css }) and its theme CSS. The built-in AIMEAT
 *   theme holds the six built-in styles, read from the sheets; it is read only and can be copied. A
 *   custom theme is one memory record under the node's own `system@<node>`, key `ui.theme.<id>`,
 *   private, written `trackable`, so every save keeps the one before ("Back to the version of").
 *
 *   FREE CSS (Q2). Only CSS that does not parse and style values that do not parse are refused.
 *   Everything else is a warning that goes back with the save: contrast, hidden controls, motion,
 *   literal colours, faces, a selector outside its component.
 *
 *   WHO CHOOSES: three config rows, themes.personal_choice, themes.offered (theme ids) and
 *   themes.default (a theme id); an id that names no live theme is dropped where it is read. A
 *   person's choice is `{ theme, style }` on their account (`settings.theme`), as the start page is.
 *
 *   THE SNAPSHOT is what the SPA shell writes into the page before its first paint (portal-spa.ts):
 *   the offered themes with their offered styles and the address of each theme's sheet. It is kept in
 *   this process and rebuilt on every write and every config change, because the shell is served
 *   synchronously.
 * @structure ThemeError · Theme · ThemeInput · ThemeService · themeSnapshot · INNER_PATHS
 * @usage const svc = new ThemeService(config, storage); await svc.offered();
 * @version-history
 *   v2.1.0 — 2026-09-24 — One name, one theme: a name another theme has (built-in and retired
 *     included) is refused with 409 NAME_TAKEN, on a new theme and on a rename. setPolicy.
 *   v2.0.0 — 2026-09-24 — The two-level model of 07 (a theme holds styles), component CSS, theme CSS,
 *     versions and restore, warnings instead of refusals, the lifecycle of component CSS.
 *   v1.0.0 — 2026-09-24 — Initial (one level; what it called a theme is a style now).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { emitChange } from '../event-bus.js';
import { getUiComponent } from '../ui-library/catalogue.js';
import { THEME_TOKENS, CORE_TOKENS, THEME_FACES } from './tokens.js';
import { lintCss, type CssWarning } from './css-lint.js';
import { builtinStyles, prepareStyle, swatchOf, STYLE_ID_RE, type Style, type StyleInput } from './styles.js';
import { themeSheet, componentCssState, catalogueHooks, servedFaces, type ComponentCssState } from './sheet.js';
import type { ContrastResult } from './contrast.js';
import type { ConfigProvenance } from '../config-provenance.js';
import { applyConfigChanges } from '../config-apply.js';
import { isSealed, sealRefusal } from '../config-sealing.js';

export const THEME_KEY_PREFIX = 'ui.theme.';
export const THEME_CHOICE_KEY = 'settings.theme';
export const BUILTIN_THEME = 'aimeat';
/**
 * AIMEAT's own interface: the pages a theme reaches. Everything else the shell serves (the front
 * page, help, members, the change log, the showroom pages) keeps behaving as it did before themes
 * (Jouni, Q3 and 2026-09-24: "keep the public pages as they behave today").
 */
export const INNER_PATHS = ['/v1/home', '/v1/chat', '/v1/profile', '/v1/admin', '/v1/fleet'];

export class ThemeError extends Error {
    constructor(public readonly code: string, message: string, public readonly httpStatus: number, public readonly details?: unknown) {
        super(message);
        this.name = 'ThemeError';
    }
}

export interface Theme {
    id: string;
    name: string;
    builtin: boolean;
    styles: Style[];
    defaultStyle: string;
    offeredStyles: string[];
    componentCss: Record<string, string>;
    css: string | null;
    retired: boolean;
    basedOn: string | null;
    createdBy: string | null;
    createdAt: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
}

/** What a caller may change on a theme (its styles and its component CSS have their own doors). */
export interface ThemeInput { name?: string; css?: string | null; defaultStyle?: string; offeredStyles?: string[]; retired?: boolean }

/** The warnings that go back with a save or a check. */
export interface ThemeWarnings { css: CssWarning[]; components: Record<string, ComponentCssState>; contrast: Record<string, ContrastResult[]> }

export interface OfferedStyle { id: string; name: string; onlyMode: string | null; swatch: ReturnType<typeof swatchOf> }
export interface OfferedTheme { id: string; name: string; builtin: boolean; defaultStyle: string; sheet: string | null; styles: OfferedStyle[] }
export interface ThemePolicy { personalChoice: boolean; offered: string[]; default: string }
/** `builtin`: the built-in style ids, which the pages outside the inner interface keep offering as before. */
export interface ThemeSnapshot { policy: ThemePolicy; themes: OfferedTheme[]; inner: string[]; builtin: string[] }

let snapshotCache: ThemeSnapshot | null = null;
/** The last snapshot this process built, or null before the first read. */
export const themeSnapshot = (): ThemeSnapshot | null => snapshotCache;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const hash = (s: string, n = 12) => createHash('sha1').update(s).digest('hex').slice(0, n);

function builtinTheme(): Theme {
    const styles = builtinStyles();
    return {
        id: BUILTIN_THEME, name: 'AIMEAT', builtin: true, styles, defaultStyle: 'aimeat', offeredStyles: styles.map((s) => s.id),
        componentCss: {}, css: null, retired: false, basedOn: null, createdBy: null, createdAt: null, updatedBy: null, updatedAt: null,
    };
}

const slug = (name: string, fallback: string) => {
    const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    return s.length >= 2 ? s : fallback;
};

/** A theme with its own fields changed (name, theme CSS, default and offered styles, retired), checked. */
function applyInput(t: Theme, input: ThemeInput): Theme {
    const next: Theme = { ...t };
    if (input.name !== undefined) {
        const name = String(input.name).trim();
        if (!name || name.length > 60 || /[<>]/.test(name)) throw new ThemeError('INVALID_THEME', 'name: 1 to 60 characters, no angle brackets', 422);
        next.name = name;
    }
    if (input.css !== undefined) {
        const css = input.css ? String(input.css) : null;
        const err = css ? lintCss(css).error : null;
        if (err) throw new ThemeError('CSS_DOES_NOT_PARSE', `Theme CSS, line ${err.line}: ${err.text}`, 422, { line: err.line });
        next.css = css;
    }
    const ids = t.styles.map((s) => s.id);
    if (input.defaultStyle !== undefined) {
        if (!ids.includes(input.defaultStyle)) throw new ThemeError('INVALID_THEME', `defaultStyle: "${input.defaultStyle}" is not a style of this theme (${ids.join(', ')})`, 422);
        next.defaultStyle = input.defaultStyle;
    }
    if (input.offeredStyles !== undefined) {
        if (!Array.isArray(input.offeredStyles) || input.offeredStyles.some((s) => !ids.includes(s))) throw new ThemeError('INVALID_THEME', `offeredStyles: styles of this theme only (${ids.join(', ')})`, 422);
        next.offeredStyles = [...new Set(input.offeredStyles)];
    }
    if (input.retired !== undefined) next.retired = !!input.retired;
    return next;
}

export class ThemeService {
    constructor(private readonly config: AimeatConfig, private readonly storage: Storage) {}

    private get systemGhii(): string { return `system@${this.config.nodeId}`; }

    // ── Reading ──

    /** Every theme: the built-in first, then the node's own by name. */
    async listAll(): Promise<Theme[]> {
        const { items } = await this.storage.listAllMemoryMeta({ ownerPrefix: this.systemGhii, prefix: THEME_KEY_PREFIX, limit: 500, excludeVersionRows: true });
        const custom: Theme[] = [];
        for (const row of items) {
            const rec = await this.storage.getMemory(this.systemGhii, row.key);
            const v = rec?.value as Theme | undefined;
            if (v && typeof v === 'object' && Array.isArray(v.styles)) custom.push(v);
        }
        custom.sort((a, b) => a.name.localeCompare(b.name));
        return [builtinTheme(), ...custom];
    }

    async get(id: string): Promise<Theme | null> {
        if (id === BUILTIN_THEME) return builtinTheme();
        if (!ID_RE.test(id)) return null;
        const rec = await this.storage.getMemory(this.systemGhii, THEME_KEY_PREFIX + id);
        const v = rec?.value as Theme | undefined;
        return v && typeof v === 'object' && Array.isArray(v.styles) ? v : null;
    }

    private async must(id: string): Promise<Theme> {
        const t = await this.get(id);
        if (!t) throw new ThemeError('NOT_FOUND', `There is no theme "${id}".`, 404);
        return t;
    }

    /** The operator's choices, every id checked against the live themes. */
    policyFrom(themes: Theme[]): ThemePolicy {
        const live = themes.filter((t) => !t.retired).map((t) => t.id);
        const listed = String(this.config.themesOffered || '').split(',').map((s) => s.trim()).filter((id) => live.includes(id));
        const offered = listed.length ? listed : [BUILTIN_THEME];
        const def = offered.includes(String(this.config.themesDefault)) ? String(this.config.themesDefault) : offered[0];
        return { personalChoice: this.config.themesPersonalChoice !== false, offered, default: def };
    }

    /** A theme's offered, live styles, its default first when it is among them. */
    private offeredStylesOf(t: Theme): Style[] {
        const live = t.styles.filter((s) => !s.retired);
        const offered = live.filter((s) => t.offeredStyles.includes(s.id));
        return offered.length ? offered : live.filter((s) => s.id === t.defaultStyle);
    }

    /** What the pill offers and the shell needs before its first paint; refreshes the snapshot. */
    async offered(): Promise<ThemeSnapshot> {
        const themes = await this.listAll();
        const policy = this.policyFrom(themes);
        const shown = policy.personalChoice ? policy.offered : [policy.default];
        snapshotCache = {
            policy,
            inner: INNER_PATHS,
            builtin: builtinStyles().map((s) => s.id),
            themes: shown.map((id) => themes.find((t) => t.id === id)!).filter(Boolean).map((t) => ({
                id: t.id, name: t.name, builtin: t.builtin, defaultStyle: t.defaultStyle,
                sheet: t.builtin ? null : `/v1/themes/${t.id}/theme.css?v=${hash(themeSheet(t))}`,
                styles: (policy.personalChoice ? this.offeredStylesOf(t) : t.styles.filter((s) => s.id === t.defaultStyle))
                    .map((s) => ({ id: s.id, name: s.name, onlyMode: s.onlyMode, swatch: swatchOf(s) })),
            })),
        };
        return snapshotCache;
    }

    /** One theme's stylesheet and its ETag. */
    async stylesheet(id: string): Promise<{ css: string; etag: string }> {
        const t = await this.must(id);
        const css = t.builtin || t.retired ? `/* Theme "${t.name}": nothing of its own to serve. */\n` : themeSheet(t);
        return { css, etag: `"${hash(css, 16)}"` };
    }

    /** Every warning a theme carries now: its theme CSS, each component's CSS, each style's contrast. */
    warningsOf(t: Pick<Theme, 'css' | 'componentCss' | 'styles'>): ThemeWarnings {
        const components: Record<string, ComponentCssState> = {};
        for (const [c, css] of Object.entries(t.componentCss || {})) components[c] = componentCssState(c, css);
        const contrast: Record<string, ContrastResult[]> = {};
        for (const s of t.styles) contrast[s.id] = prepareStyle({}, s).contrast;
        return { css: t.css ? lintCss(t.css, { faces: servedFaces() }).warnings : [], components, contrast };
    }

    /** Themes, choices and what a theme may set: one answer for the route and both MCP surfaces. */
    async catalogue(summary: boolean): Promise<Record<string, unknown>> {
        const themes = await this.listAll();
        const snap = await this.offered();
        return {
            policy: snap.policy,
            themes: themes.map((t) => {
                const w = this.warningsOf(t);
                const styles = t.styles.map((s) => ({ ...(summary ? { id: s.id, name: s.name, builtin: s.builtin, retired: s.retired, onlyMode: s.onlyMode, faces: s.faces,
                    core: { light: Object.fromEntries(CORE_TOKENS.map((k) => [k, s.light[k]])), dark: Object.fromEntries(CORE_TOKENS.map((k) => [k, s.dark[k]])) } } : s),
                    swatch: swatchOf(s), contrastMissing: w.contrast[s.id].filter((r) => !r.ok) }));
                return { ...(summary ? { id: t.id, name: t.name, builtin: t.builtin, retired: t.retired, defaultStyle: t.defaultStyle, offeredStyles: t.offeredStyles, basedOn: t.basedOn,
                    componentCss: Object.keys(t.componentCss || {}), hasThemeCss: !!t.css } : t), styles, componentCssState: w.components, cssWarnings: w.css };
            }),
            vocabulary: { tokens: THEME_TOKENS, core: CORE_TOKENS, faces: Object.keys(THEME_FACES), hooks: catalogueHooks() },
        };
    }

    /** The themes that carry CSS for one component (for aimeat_ui_component_get). */
    async themesWithCss(componentId: string): Promise<Array<{ theme: string; status: string }>> {
        return (await this.listAll()).filter((t) => t.componentCss?.[componentId])
            .map((t) => ({ theme: t.id, status: componentCssState(componentId, t.componentCss[componentId]).status }));
    }

    async callerIsOperator(ownerName: string | null | undefined): Promise<boolean> {
        if (!ownerName) return false;
        const owner = await this.storage.getOwner(ownerName);
        return !!owner && owner.roles.includes('operator');
    }

    // ── Writing ──

    private async write(theme: Theme, event: string): Promise<void> {
        const key = THEME_KEY_PREFIX + theme.id;
        const existing = await this.storage.getMemory(this.systemGhii, key);
        const now = new Date().toISOString();
        await this.storage.setMemory({
            key, ownerGaii: this.systemGhii, value: theme, visibility: 'private', tags: ['themes', event], ttlHours: null,
            version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
            // Every save keeps the one before: "Back to the version of <date>" (07 "Recovery").
            trackable: true,
        });
        emitChange('themes');
        await this.offered();
    }

    private editable(t: Theme): void {
        if (t.builtin) throw new ThemeError('READ_ONLY', `"${t.name}" is built in and read only; make a copy of it and change the copy.`, 409);
    }

    private async allStyleIds(): Promise<Set<string>> {
        return new Set((await this.listAll()).flatMap((t) => t.styles.map((s) => s.id)));
    }

    /**
     * One name, one theme (Jouni, 2026-09-24): a name another theme has is refused, the built-in and the
     * retired ones included, so the list and the look picker never show two themes the same. Compared
     * without case and outer spaces. `self` is the theme being renamed, which keeps its own name.
     */
    private async nameFree(name: string, self?: string): Promise<void> {
        const want = name.trim().toLowerCase();
        const other = (await this.listAll()).find((t) => t.id !== self && t.name.trim().toLowerCase() === want);
        if (other) {
            throw new ThemeError('NAME_TAKEN', `Another theme is already called "${other.name}"${other.retired ? ' (it is retired)' : ''}. Choose another name.`, 409);
        }
    }

    private async freeThemeId(name: string): Promise<string> {
        const stem = slug(name, 'theme');
        for (let n = 1; n < 100; n++) {
            const id = n === 1 ? stem : `${stem}-${n}`;
            if (id !== BUILTIN_THEME && ID_RE.test(id) && !(await this.get(id))) return id;
        }
        throw new ThemeError('CONFLICT', 'No free id for a theme of that name; choose another name.', 409);
    }

    private freeStyleId(stem: string, taken: Set<string>): string {
        const base = slug(stem, 'style').slice(0, 36);
        for (let n = 1; n < 100; n++) {
            const id = n === 1 ? base : `${base}-${n}`;
            if (STYLE_ID_RE.test(id) && !taken.has(id)) { taken.add(id); return id; }
        }
        throw new ThemeError('CONFLICT', 'No free id for a style of that name; choose another name.', 409);
    }

    /**
     * A new theme, a copy of `basedOn` (the AIMEAT theme by default): its styles, CSS and choices. The
     * theme's own fields may come in the same call; a style id there may name the copied style by its
     * old id (`paper`), since the caller cannot know the copy's new ids yet.
     */
    async create(input: ThemeInput & { basedOn?: string }, by: string): Promise<{ theme: Theme; warnings: ThemeWarnings }> {
        const base = await this.must(input.basedOn || BUILTIN_THEME);
        const name = (input.name ?? `${base.name} copy`).trim();
        if (!name || name.length > 60 || /[<>]/.test(name)) throw new ThemeError('INVALID_THEME', 'name: 1 to 60 characters, no angle brackets', 422);
        await this.nameFree(name);
        const id = await this.freeThemeId(name);
        const taken = await this.allStyleIds();
        const map = new Map<string, string>();
        const styles = base.styles.map((s) => {
            const sid = this.freeStyleId(`${id}-${s.id}`, taken);
            map.set(s.id, sid);
            return { ...s, id: sid, builtin: false };
        });
        const now = new Date().toISOString();
        const theme: Theme = {
            id, name, builtin: false, styles, defaultStyle: map.get(base.defaultStyle) ?? styles[0].id,
            offeredStyles: base.offeredStyles.map((s) => map.get(s)).filter((s): s is string => !!s),
            componentCss: { ...(base.componentCss || {}) }, css: base.css ?? null, retired: false, basedOn: base.id,
            createdBy: by, createdAt: now, updatedBy: by, updatedAt: now,
        };
        const own: ThemeInput = {
            ...(input.css !== undefined ? { css: input.css } : {}),
            ...(input.defaultStyle !== undefined ? { defaultStyle: map.get(input.defaultStyle) ?? input.defaultStyle } : {}),
            ...(input.offeredStyles !== undefined ? { offeredStyles: Array.isArray(input.offeredStyles) ? input.offeredStyles.map((s) => map.get(s) ?? s) : input.offeredStyles } : {}),
            ...(input.retired !== undefined ? { retired: input.retired } : {}),
        };
        const made = applyInput(theme, own);
        await this.write(made, 'created');
        return { theme: made, warnings: this.warningsOf(made) };
    }

    /** A theme's own fields changed: name, theme CSS, default and offered styles, retired. */
    async update(id: string, input: ThemeInput, by: string, dryRun = false): Promise<{ theme: Theme; warnings: ThemeWarnings }> {
        const t = await this.must(id);
        this.editable(t);
        const next = applyInput(t, input);
        if (input.name !== undefined) await this.nameFree(next.name, t.id);
        next.updatedBy = by;
        next.updatedAt = new Date().toISOString();
        if (!dryRun) await this.write(next, 'updated');
        return { theme: next, warnings: this.warningsOf(next) };
    }

    /**
     * A style made or changed inside a theme. `styleId` null makes a new style, a copy of `basedOn`
     * (a style of this theme, its default by default). Contrast comes back as warnings.
     */
    async saveStyle(themeId: string, styleId: string | null, input: StyleInput & { basedOn?: string }, by: string, dryRun = false): Promise<{ theme: Theme; style: Style; warnings: ThemeWarnings }> {
        const t = await this.must(themeId);
        this.editable(t);
        const current = styleId ? t.styles.find((s) => s.id === styleId) : null;
        if (styleId && !current) throw new ThemeError('NOT_FOUND', `The theme "${t.name}" has no style "${styleId}".`, 404);
        const base = current ?? t.styles.find((s) => s.id === (input.basedOn || t.defaultStyle)) ?? builtinStyles()[0];
        const prepared = prepareStyle({ ...input, name: input.name ?? (current ? undefined : `${base.name} copy`) }, base);
        if (prepared.refused.length) throw new ThemeError('INVALID_STYLE', prepared.refused.join('; '), 422, { reasons: prepared.refused });
        const id = current ? current.id : this.freeStyleId(`${t.id}-${prepared.style.name}`, await this.allStyleIds());
        const style: Style = { ...prepared.style, id };
        const next: Theme = { ...t, styles: current ? t.styles.map((s) => (s.id === id ? style : s)) : [...t.styles, style], updatedBy: by, updatedAt: new Date().toISOString() };
        if (!dryRun) await this.write(next, current ? 'style-updated' : 'style-created');
        return { theme: next, style, warnings: this.warningsOf(next) };
    }

    /** Component CSS for one component in one theme; empty or null removes it. */
    async setComponentCss(themeId: string, componentId: string, css: string | null, by: string, dryRun = false): Promise<{ theme: Theme; state: ComponentCssState }> {
        const t = await this.must(themeId);
        this.editable(t);
        const text = css && css.trim() ? String(css) : null;
        if (text && !getUiComponent(componentId) && !(componentId in (t.componentCss || {}))) {
            throw new ThemeError('NOT_FOUND', `This server's interface has no component "${componentId}". aimeat_ui_component_list names them.`, 404);
        }
        if (text) {
            const err = lintCss(text).error;
            if (err) throw new ThemeError('CSS_DOES_NOT_PARSE', `Line ${err.line}: ${err.text}`, 422, { line: err.line });
        }
        const componentCss = { ...(t.componentCss || {}) };
        if (text) componentCss[componentId] = text; else delete componentCss[componentId];
        const next: Theme = { ...t, componentCss, updatedBy: by, updatedAt: new Date().toISOString() };
        if (!dryRun) await this.write(next, 'component-css');
        return { theme: next, state: text ? componentCssState(componentId, text) : { component: componentId, status: 'empty', reason: 'Removed.', warnings: [] } };
    }

    /** The versions a theme was saved as, newest first (the current one is not in the list). */
    async versions(themeId: string): Promise<Array<{ version: number; at: string; name: string }>> {
        const t = await this.must(themeId);
        if (t.builtin) return [];
        const rows = await this.storage.listMemoryHistory(this.systemGhii, THEME_KEY_PREFIX + themeId, { limit: 50 });
        return rows.map((r) => ({ version: r.version, at: r.recordedAt, name: (r.value as Theme | null)?.name ?? '' }));
    }

    /** Put an earlier version back; the version it replaces is kept too, so this can be undone. */
    async restore(themeId: string, version: number, by: string): Promise<{ theme: Theme; warnings: ThemeWarnings }> {
        const t = await this.must(themeId);
        this.editable(t);
        const rows = await this.storage.listMemoryHistory(this.systemGhii, THEME_KEY_PREFIX + themeId, { limit: 50 });
        const row = rows.find((r) => r.version === version);
        const old = row?.value as Theme | undefined;
        if (!old || !Array.isArray(old.styles)) throw new ThemeError('NOT_FOUND', `The theme "${t.name}" has no saved version ${version}.`, 404);
        const next: Theme = { ...old, id: t.id, builtin: false, updatedBy: by, updatedAt: new Date().toISOString() };
        await this.write(next, 'restored');
        return { theme: next, warnings: this.warningsOf(next) };
    }

    /**
     * The stylesheet and the warnings of a draft that is not saved: the editor's live frames (S5, S6,
     * S7). The draft is a whole theme as the editor holds it; nothing of it is stored.
     */
    preview(draft: Partial<Theme>): { stylesheet: string; warnings: ThemeWarnings; refused: string[] } {
        const refused: string[] = [];
        const styles: Style[] = [];
        for (const s of Array.isArray(draft.styles) ? draft.styles : []) {
            if (!s || typeof s !== 'object' || !STYLE_ID_RE.test(String(s.id))) { refused.push('a style without a valid id'); continue; }
            const base = builtinStyles().find((b) => b.id === s.id) ?? { ...builtinStyles()[0], id: s.id };
            const p = prepareStyle({ name: s.name, light: s.light, dark: s.dark, faces: s.faces, onlyMode: s.onlyMode, retired: s.retired }, base);
            refused.push(...p.refused.map((r) => `${s.id}: ${r}`));
            styles.push({ ...p.style, id: s.id, builtin: !!s.builtin && builtinStyles().some((b) => b.id === s.id) });
        }
        const componentCss: Record<string, string> = {};
        for (const [c, css] of Object.entries(draft.componentCss || {})) if (typeof css === 'string') componentCss[c] = css;
        const css = typeof draft.css === 'string' ? draft.css : null;
        const theme = { id: 'draft', name: String(draft.name || 'draft'), styles, componentCss, css };
        return { stylesheet: themeSheet(theme), warnings: this.warningsOf(theme), refused };
    }

    // ── Who chooses ──

    /**
     * The operator's choices, changed through the same code the admin Config tab saves with
     * (services/config-apply.ts): whether people choose, which themes are available (live theme ids,
     * at least one), and the default theme (one of them). Every id is checked before anything is written.
     */
    async setPolicy(input: { personalChoice?: boolean; offered?: string[]; default?: string }, provenance?: ConfigProvenance): Promise<ThemeSnapshot> {
        const themes = await this.listAll();
        const live = themes.filter((t) => !t.retired).map((t) => t.id);
        const current = this.policyFrom(themes);
        const offered = input.offered === undefined ? current.offered : input.offered;
        if (!Array.isArray(offered) || !offered.length || offered.some((id) => typeof id !== 'string' || !live.includes(id))) {
            throw new ThemeError('INVALID_POLICY', `offered: one or more themes that are not retired (${live.join(', ')})`, 422);
        }
        const def = input.default === undefined ? (offered.includes(current.default) ? current.default : offered[0]) : input.default;
        if (!offered.includes(def)) throw new ThemeError('INVALID_POLICY', `default: one of the available themes (${offered.join(', ')})`, 422);
        if (input.personalChoice !== undefined && typeof input.personalChoice !== 'boolean') throw new ThemeError('INVALID_POLICY', 'personalChoice: true or false', 422);
        const changes = [
            ...(input.personalChoice !== undefined ? [{ path: 'themes.personal_choice', value: input.personalChoice }] : []),
            // Only the AIMEAT theme available is written as empty, the node's own default.
            { path: 'themes.offered', value: offered.length === 1 && offered[0] === BUILTIN_THEME ? '' : [...new Set(offered)].join(',') },
            { path: 'themes.default', value: def },
        ];
        const sealed = changes.map((c) => c.path).filter((p) => isSealed(this.config, p));
        if (sealed.length) throw new ThemeError('SEALED_CONFIG', sealRefusal(sealed[0]).message, 403);
        const { errors } = await applyConfigChanges({ config: this.config, storage: this.storage, provenance }, changes);
        if (errors.length) throw new ThemeError('NOT_SAVED', errors.map((e) => `${e.path}: ${e.reason}`).join('; '), 500);
        emitChange('config');
        return this.offered();
    }

    // ── A person's choice ──

    async choiceGet(ghii: string): Promise<{ theme: string | null; style: string | null }> {
        const rec = await this.storage.getMemory(ghii, THEME_CHOICE_KEY);
        const v = (rec?.value ?? null) as { theme?: string; style?: string } | null;
        return { theme: typeof v?.theme === 'string' ? v.theme : null, style: typeof v?.style === 'string' ? v.style : null };
    }

    /** Save a person's choice to their account; refused when the operator decides for everybody. */
    async choiceSet(ghii: string, theme: string, style: string | undefined): Promise<{ theme: string; style: string }> {
        const snap = await this.offered();
        if (!snap.policy.personalChoice) throw new ThemeError('FIXED', 'This server shows one theme to everybody, so there is nothing to choose.', 409);
        const t = snap.themes.find((x) => x.id === theme);
        if (!t) throw new ThemeError('NOT_OFFERED', `"${theme}" is not a theme this server offers (${snap.themes.map((x) => x.id).join(', ')}).`, 422);
        const chosen = style ?? t.defaultStyle;
        if (!t.styles.some((s) => s.id === chosen)) throw new ThemeError('NOT_OFFERED', `"${chosen}" is not a style the theme "${t.name}" offers (${t.styles.map((s) => s.id).join(', ')}).`, 422);
        const existing = await this.storage.getMemory(ghii, THEME_CHOICE_KEY);
        const now = new Date().toISOString();
        await this.storage.setMemory({
            key: THEME_CHOICE_KEY, ownerGaii: ghii, value: { theme, style: chosen, at: now }, visibility: 'owner', tags: ['settings'], ttlHours: null,
            version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
        });
        return { theme, style: chosen };
    }
}
