/**
 * @file src/services/themes/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles: the node's themes, the operator's choices about them, and a person's
 *   own choice. Every door (the HTTP routes, the MCP tools, the SPA shell) comes through here, so the
 *   checks and the refusals are written once.
 *
 *   A THEME is a light token set and a dark token set, both complete, plus its three faces, an
 *   optional theme CSS that reaches components only through their catalogued hooks, and an optional
 *   single mode. The six built-in palettes are read-only built-in themes (builtin.ts); a custom theme
 *   is one memory record per theme under the node's own `system@<node>` owner, key `ui.theme.<id>`,
 *   visibility private: the node's own configuration, never in a person's listing or quota.
 *
 *   SAVING fills a partial token set from the theme it is based on (a copy's source, or AIMEAT), then
 *   holds the whole to the value grammar (values.ts), the hooks (css.ts) and the contrast rules
 *   (contrast.ts) in both modes. A theme that fails any of them is refused with every reason, so an
 *   AI or a person fixes all of it in one round.
 *
 *   THE OPERATOR'S CHOICES are four config rows (themes.personal_choice, .fixed, .offered, .default),
 *   written through the admin config door like every other setting; this service reads them and
 *   drops an id that names no theme, so a stale setting can never offer a theme that does not exist.
 *
 *   A PERSON'S CHOICE is saved to their account (Jouni, 2026-09-24): `settings.theme` under their
 *   GHII, as the start page is, so it follows them to every device.
 *
 *   THE SNAPSHOT is what the SPA shell needs before its first paint (which themes, which is fixed,
 *   the stylesheet's stamp); it is kept in this process and refreshed on every write, because the
 *   shell is served synchronously.
 * @structure ThemeError · Theme · ThemeInput · ThemeService · themeSnapshot · THEME_KEY_PREFIX ·
 *   THEME_CHOICE_KEY
 * @usage const svc = new ThemeService(config, storage); await svc.offered();
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { resolveAssetDir } from '../../server-bootstrap/asset-dirs.js';
import { emitChange } from '../event-bus.js';
import { THEME_TOKENS, CORE_TOKENS, THEME_FACES, FACE_SLOTS, tokenKind, isThemeToken, type FaceSlot } from './tokens.js';
import { checkValue } from './values.js';
import { builtinThemes, BUILTIN_IDS, type BuiltinTheme, type TokenMap, type ThemeFaces } from './builtin.js';
import { checkThemeCss, catalogueHooks, themeStylesheet } from './css.js';
import { checkContrast, modeColours, type ContrastResult } from './contrast.js';
import { toCss } from './values.js';

export const THEME_KEY_PREFIX = 'ui.theme.';
export const THEME_CHOICE_KEY = 'settings.theme';
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export class ThemeError extends Error {
    constructor(public readonly code: string, message: string, public readonly httpStatus: number, public readonly details?: unknown) {
        super(message);
        this.name = 'ThemeError';
    }
}

export type OnlyMode = 'light' | 'dark' | null;

export interface Theme {
    id: string;
    name: string;
    builtin: boolean;
    light: TokenMap;
    dark: TokenMap;
    faces: ThemeFaces;
    css: string | null;
    onlyMode: OnlyMode;
    retired: boolean;
    basedOn: string | null;
    createdBy: string | null;
    createdAt: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
}

/** What a caller may send: every field optional on an edit; a copy names its source in `basedOn`. */
export interface ThemeInput {
    name?: string;
    light?: TokenMap;
    dark?: TokenMap;
    faces?: ThemeFaces;
    css?: string | null;
    onlyMode?: OnlyMode;
    retired?: boolean;
    basedOn?: string;
}

/** A theme as the pill offers it: its name and the three colours a chip shows per mode. */
export interface OfferedTheme {
    id: string;
    name: string;
    builtin: boolean;
    onlyMode: OnlyMode;
    swatch: { light: { bg: string; card: string; accent: string }; dark: { bg: string; card: string; accent: string } };
}

export interface ThemePolicy { personalChoice: boolean; fixed: string; default: string; offered: string[] }

/** What the SPA shell reads before its first paint. */
export interface ThemeSnapshot { policy: ThemePolicy; themes: OfferedTheme[]; stamp: string; onlyMode: Record<string, 'light' | 'dark'> }

let snapshotCache: ThemeSnapshot | null = null;
/** The last snapshot this process built, or null before the first read. */
export const themeSnapshot = (): ThemeSnapshot | null => snapshotCache;

let builtinCache: BuiltinTheme[] | null = null;
function builtins(): BuiltinTheme[] {
    if (builtinCache) return builtinCache;
    const pub = resolveAssetDir('public', join(dirname(fileURLToPath(import.meta.url)), '..'), process.cwd());
    if (!pub) throw new ThemeError('THEMES_UNAVAILABLE', 'This node was started without its public files, so it cannot read its built-in themes.', 503);
    builtinCache = builtinThemes(readFileSync(join(pub, 'css', 'theme.css'), 'utf8'), readFileSync(join(pub, 'lib', 'aimeat-theme.css'), 'utf8'));
    return builtinCache;
}

const asTheme = (b: BuiltinTheme): Theme => ({
    ...b, css: null, onlyMode: null, retired: false, basedOn: null, createdBy: null, createdAt: null, updatedBy: null, updatedAt: null,
});

const swatchOf = (t: Theme): OfferedTheme['swatch'] => {
    const pick = (map: TokenMap) => {
        const c = modeColours(map);
        const hex = (n: string) => (c[n] ? toCss({ ...c[n]!, a: 1 }) : '#888888');
        return { bg: hex('--bg'), card: hex('--card-bg'), accent: hex('--accent') };
    };
    return { light: pick(t.light), dark: pick(t.dark) };
};

export class ThemeService {
    constructor(private readonly config: AimeatConfig, private readonly storage: Storage) {}

    private get systemGhii(): string { return `system@${this.config.nodeId}`; }

    /** Every theme: the built-ins first, in the pill's order, then the node's own by name. */
    async listAll(): Promise<Theme[]> {
        const { items } = await this.storage.listAllMemoryMeta({ ownerPrefix: this.systemGhii, prefix: THEME_KEY_PREFIX, limit: 500, excludeVersionRows: true });
        const custom: Theme[] = [];
        for (const row of items) {
            const rec = await this.storage.getMemory(this.systemGhii, row.key);
            if (rec?.value && typeof rec.value === 'object') custom.push(rec.value as Theme);
        }
        custom.sort((a, b) => a.name.localeCompare(b.name));
        return [...builtins().map(asTheme), ...custom];
    }

    async get(id: string): Promise<Theme | null> {
        const b = builtins().find((t) => t.id === id);
        if (b) return asTheme(b);
        if (!ID_RE.test(id)) return null;
        const rec = await this.storage.getMemory(this.systemGhii, THEME_KEY_PREFIX + id);
        return rec?.value && typeof rec.value === 'object' ? rec.value as Theme : null;
    }

    /** The operator's choices, with every id checked against the themes that exist and are not retired. */
    policyFrom(themes: Theme[]): ThemePolicy {
        const live = themes.filter((t) => !t.retired).map((t) => t.id);
        const known = (id: string | undefined) => !!id && live.includes(id);
        const listed = String(this.config.themesOffered || '').split(',').map((s) => s.trim()).filter(known);
        const offered = listed.length ? listed : live;
        const fixed = known(this.config.themesFixed) ? this.config.themesFixed : 'aimeat';
        const def = known(this.config.themesDefault) && offered.includes(this.config.themesDefault) ? this.config.themesDefault : (offered[0] ?? 'aimeat');
        const personalChoice = this.config.themesPersonalChoice !== false;
        return { personalChoice, fixed, default: def, offered: personalChoice ? offered : [fixed] };
    }

    /** What the pill offers, and what the shell needs before its first paint; refreshes the snapshot. */
    async offered(): Promise<ThemeSnapshot> {
        const themes = await this.listAll();
        const policy = this.policyFrom(themes);
        const offered = policy.offered.map((id) => themes.find((t) => t.id === id)!).filter(Boolean);
        const sheet = this.stylesheetOf(themes);
        const onlyMode: Record<string, 'light' | 'dark'> = {};
        for (const t of offered) if (t.onlyMode) onlyMode[t.id] = t.onlyMode;
        snapshotCache = {
            policy,
            themes: offered.map((t) => ({ id: t.id, name: t.name, builtin: t.builtin, onlyMode: t.onlyMode, swatch: swatchOf(t) })),
            stamp: createHash('sha1').update(sheet).digest('hex').slice(0, 12),
            onlyMode,
        };
        return snapshotCache;
    }

    private stylesheetOf(themes: Theme[]): string {
        const hooks = catalogueHooks();
        const custom = themes.filter((t) => !t.builtin && !t.retired);
        const head = '/* The node\'s own themes (Themes & Styles). Generated from their records; the built-in palettes are /lib/aimeat-theme.css. */\n';
        return head + custom.map((t) => themeStylesheet(t, hooks)).join('\n');
    }

    /** Every custom theme that is not retired, as one stylesheet, and its stamp. */
    async stylesheet(): Promise<{ css: string; etag: string }> {
        const css = this.stylesheetOf(await this.listAll());
        return { css, etag: `"${createHash('sha1').update(css).digest('hex').slice(0, 16)}"` };
    }

    /** True when the named account is this node's operator. */
    async callerIsOperator(ownerName: string | null | undefined): Promise<boolean> {
        if (!ownerName) return false;
        const owner = await this.storage.getOwner(ownerName);
        return !!owner && owner.roles.includes('operator');
    }

    /** A theme with every check applied: the stored form, or ThemeError('INVALID_THEME') with each reason. */
    private async prepare(input: ThemeInput, current: Theme | null): Promise<Omit<Theme, 'id' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'>> {
        const reasons: string[] = [];
        const baseId = input.basedOn ?? current?.basedOn ?? 'aimeat';
        const base = current ?? await this.get(baseId);
        if (!base) throw new ThemeError('NOT_FOUND', `There is no theme "${baseId}" to base a new one on.`, 404);
        const name = (input.name ?? (current ? current.name : `${base.name} copy`)).trim();
        if (!name || name.length > 60 || /[<>]/.test(name) || [...name].some((c) => c.charCodeAt(0) < 32)) reasons.push('name: 1 to 60 characters, no angle brackets');
        const merge = (mode: 'light' | 'dark', given: TokenMap | undefined): TokenMap => {
            const out: TokenMap = { ...base[mode] };
            if (given !== undefined && (typeof given !== 'object' || given === null || Array.isArray(given))) { reasons.push(`${mode}: an object of token → value`); return out; }
            for (const [token, value] of Object.entries(given ?? {})) {
                if (!isThemeToken(token)) { reasons.push(`${mode} ${token}: not a token a theme may set (see the token list)`); continue; }
                const bad = checkValue(value, tokenKind(token)!);
                if (bad) reasons.push(`${mode} ${token}: ${bad}`); else out[token] = String(value).trim();
            }
            for (const t of THEME_TOKENS) if (out[t.name] === undefined) reasons.push(`${mode} ${t.name}: missing`);
            return out;
        };
        const light = merge('light', input.light);
        const dark = merge('dark', input.dark);
        const faces: ThemeFaces = { ...base.faces };
        if (input.faces !== undefined) {
            for (const [slot, face] of Object.entries(input.faces ?? {})) {
                if (!(slot in FACE_SLOTS)) { reasons.push(`faces.${slot}: the slots are headline, body and mono`); continue; }
                if (face && !THEME_FACES[face]) { reasons.push(`faces.${slot}: "${face}" is not a face this node serves (${Object.keys(THEME_FACES).join(', ')})`); continue; }
                faces[slot as FaceSlot] = face || undefined;
            }
        }
        const css = input.css === undefined ? (current?.css ?? null) : (input.css ? String(input.css) : null);
        if (css) { const c = checkThemeCss(css, catalogueHooks()); if ('error' in c) reasons.push(`css: ${c.error}`); }
        const onlyMode = input.onlyMode === undefined ? (current?.onlyMode ?? null) : input.onlyMode;
        if (onlyMode !== null && onlyMode !== 'light' && onlyMode !== 'dark') reasons.push('onlyMode: light, dark or null');
        if (reasons.length) throw new ThemeError('INVALID_THEME', reasons.join('; '), 422, { reasons });
        const contrast = checkContrast(light, dark).filter((r) => !r.ok);
        if (contrast.length) {
            // The draft goes with the refusal, so an editor can still show what it would look like.
            throw new ThemeError('CONTRAST', contrast.map((r) => `${r.mode}: ${r.what} (${r.words} on ${r.ground}) is ${r.ratio}:1, at least ${r.min}:1`).join('; '), 422,
                { contrast, draft: { name, light, dark, faces, css } });
        }
        return { name, builtin: false, light, dark, faces, css, onlyMode, retired: input.retired ?? current?.retired ?? false, basedOn: current?.basedOn ?? baseId };
    }

    /**
     * A draft with every check applied and nothing saved: the editor's live check, and an AI's dry
     * run. `id` names the custom theme being edited, or null for a new one.
     */
    async draft(input: ThemeInput, id: string | null): Promise<Omit<Theme, 'id' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'>> {
        const current = id ? await this.get(id) : null;
        if (id && !current) throw new ThemeError('NOT_FOUND', `There is no theme "${id}".`, 404);
        return this.prepare(input, current && !current.builtin ? current : null);
    }

    /**
     * Every theme, the operator's choices and what a theme may set: one answer for the route and both
     * MCP surfaces. `summary` gives each theme its core colours and only its failing contrast lines,
     * which is what a chat needs; without it every value and every line, which is what the editor needs.
     */
    async catalogue(summary: boolean): Promise<Record<string, unknown>> {
        const themes = await this.listAll();
        const snap = await this.offered();
        return {
            policy: snap.policy,
            themes: themes.map((t) => {
                const contrast = checkContrast(t.light, t.dark);
                if (!summary) return { ...t, contrast, swatch: swatchOf(t) };
                const core = (map: TokenMap) => Object.fromEntries(CORE_TOKENS.map((k) => [k, map[k]]));
                return {
                    id: t.id, name: t.name, builtin: t.builtin, retired: t.retired, basedOn: t.basedOn, onlyMode: t.onlyMode, faces: t.faces,
                    core: { light: core(t.light), dark: core(t.dark) }, contrastFailing: contrast.filter((r) => !r.ok),
                };
            }),
            vocabulary: { tokens: THEME_TOKENS, core: CORE_TOKENS, faces: Object.keys(THEME_FACES), hooks: catalogueHooks() },
        };
    }

    /** The contrast of a theme or of a draft, both modes, every rule (for the editor and an AI). */
    contrastOf(light: TokenMap, dark: TokenMap): ContrastResult[] { return checkContrast(light, dark); }

    private async write(theme: Theme): Promise<void> {
        const key = THEME_KEY_PREFIX + theme.id;
        const existing = await this.storage.getMemory(this.systemGhii, key);
        const now = new Date().toISOString();
        await this.storage.setMemory({
            key, ownerGaii: this.systemGhii, value: theme, visibility: 'private', tags: ['themes'], ttlHours: null,
            version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
        });
        emitChange('themes');
        await this.offered();
    }

    private async freeId(name: string): Promise<string> {
        const stem = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'theme';
        const start = /^[a-z0-9]/.test(stem) && stem.length >= 2 ? stem : `theme-${stem}`.slice(0, 32);
        for (let n = 1; n < 100; n++) {
            const id = n === 1 ? start : `${start}-${n}`;
            if ((BUILTIN_IDS as readonly string[]).includes(id)) continue;
            if (!(await this.get(id))) return id;
        }
        throw new ThemeError('CONFLICT', 'No free id for a theme of that name; choose another name.', 409);
    }

    /** A new theme, from scratch on AIMEAT or as a copy of `basedOn`. */
    async create(input: ThemeInput, by: string): Promise<Theme> {
        const prepared = await this.prepare(input, null);
        const now = new Date().toISOString();
        const theme: Theme = { ...prepared, id: await this.freeId(prepared.name), createdBy: by, createdAt: now, updatedBy: by, updatedAt: now };
        await this.write(theme);
        return theme;
    }

    /** An edit of a custom theme; a built-in is read only and is copied instead. */
    async update(id: string, input: ThemeInput, by: string): Promise<Theme> {
        if ((BUILTIN_IDS as readonly string[]).includes(id)) throw new ThemeError('READ_ONLY', `"${id}" is a built-in theme and is read only; make a copy of it (basedOn) and change the copy.`, 409);
        const current = await this.get(id);
        if (!current) throw new ThemeError('NOT_FOUND', `There is no theme "${id}".`, 404);
        const prepared = await this.prepare(input, current);
        const theme: Theme = { ...current, ...prepared, id, createdBy: current.createdBy, createdAt: current.createdAt, updatedBy: by, updatedAt: new Date().toISOString() };
        await this.write(theme);
        return theme;
    }

    /** A person's own choice: the theme id, or null when they have not chosen. */
    async choiceGet(ghii: string): Promise<string | null> {
        const rec = await this.storage.getMemory(ghii, THEME_CHOICE_KEY);
        const v = (rec?.value ?? null) as { theme?: string } | null;
        return typeof v?.theme === 'string' ? v.theme : null;
    }

    /** Save a person's choice to their account; refused when the operator fixed the theme or does not offer it. */
    async choiceSet(ghii: string, id: string): Promise<{ theme: string }> {
        const snap = await this.offered();
        if (!snap.policy.personalChoice) throw new ThemeError('FIXED', 'This node shows one theme to everybody, so there is nothing to choose.', 409);
        if (!snap.policy.offered.includes(id)) throw new ThemeError('NOT_OFFERED', `"${id}" is not a theme this node offers (${snap.policy.offered.join(', ')}).`, 422);
        const existing = await this.storage.getMemory(ghii, THEME_CHOICE_KEY);
        const now = new Date().toISOString();
        await this.storage.setMemory({
            key: THEME_CHOICE_KEY, ownerGaii: ghii, value: { theme: id, at: now }, visibility: 'owner', tags: ['settings'], ttlHours: null,
            version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
        });
        return { theme: id };
    }
}
