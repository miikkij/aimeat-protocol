/**
 * @file src/services/themes/fonts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The font manager: the node's operator adds a face to the running node, from the
 *   admin page or from an AI in chat, and the themes and the Design Book can use it at once. Before
 *   this, a face a theme could choose had to be vendored into the repository, with a gate, a commit
 *   and a production deploy for each one. Every door (the /v1/themes/fonts routes, aimeat_theme_list
 *   and aimeat_theme_font_save on three surfaces, the presigned upload) comes through here.
 *
 *   THE DATA. One record per family under the node's own `system@<node>`, key `ui.font.<slug>`,
 *   private, written `trackable` (font-registry.ts has its shape). The bytes are stored files under
 *   the same principal, `fonts/<slug>/<file>`, so they belong to the node and survive the account of
 *   whoever uploaded them. The registry this process holds is replaced after every write.
 *
 *   NO LIMITS (Jouni, 2026-10-03: "ei rajoja. älä laita rajoja."): no cap on a family's files or on
 *   the number of families; a file's size is bounded only by the node's existing upload setting. The
 *   one check on the bytes is that they are woff2 (the signature wOF2).
 *
 *   LICENCES (Jouni, 2026-10-03). What the node ships is free licences only. What the operator adds
 *   is theirs to answer for: it is always marked "added", never base setup, and it carries what the
 *   operator said about its licence. A family without a licence or a copyright holder is
 *   `licenceStatus: "unknown"`, which shows on the Fonts tab, on the libraries page and as a finding
 *   in the compliance report, so it is seen at an audit.
 *
 *   OWNERS DO NOT ADD THEME FACES ("ei saa"). An owner's own road for apps (a file in storage and an
 *   @font-face from the app's origin) is untouched; the operator only sees those files here, as an
 *   inventory, in one bounded query.
 * @structure FontError · FontInput · FontEntry · FontService · isWoff2
 * @usage const fonts = new FontService(config, storage, () => themes.listAll()); await fonts.load();
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial (font manager).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { emitChange } from '../event-bus.js';
import { generateUploadToken } from '../upload-token.js';
import { THEME_FACES, FACE_SLOTS, type FaceSlot } from './tokens.js';
import { FONT_KINDS, setAddedFaces, addedFaces, stackFor, fontsSheet, type FontKind, type FontFile, type FontRecord } from './font-registry.js';
import { baseFaces, type BaseFace } from './fonts-base.js';

export const FONT_KEY_PREFIX = 'ui.font.';
export const FONT_FILE_PREFIX = 'fonts/';
/** How long an upload address lasts, as a stored file's does. */
export const FONT_UPLOAD_TTL_SECONDS = 3600;
/** How many of the owners' font files the inventory lists; the total is always beside it. */
export const OWNER_FONTS_SHOWN = 200;

export class FontError extends Error {
    constructor(public readonly code: string, message: string, public readonly httpStatus: number, public readonly details?: unknown) {
        super(message);
        this.name = 'FontError';
    }
}

/** What a caller sends for a family. `files` may be left out to keep the files a family has. */
export interface FontInput {
    family?: string;
    kind?: string;
    files?: Array<{ weight?: unknown; style?: unknown; subset?: unknown; unicodeRange?: unknown }>;
    licence?: string | null;
    copyright?: string | null;
    source?: string | null;
}

/** A style of a theme that names a face, and in which of the three slots. */
export interface FaceUse { theme: string; themeName: string; style: string; styleName: string; retired: boolean; slots: FaceSlot[] }

/** One added family as the inventory and the doors show it. */
export type FontEntry = Omit<FontRecord, 'files'> & {
    stack: string;
    servable: boolean;
    weights: string[];
    styles: string[];
    files: Array<FontFile & { uploaded: boolean; url: string | null }>;
    usedBy: FaceUse[];
};

/** The minimum of a theme this file reads: who names which face. */
interface ThemeLike {
    id: string; name: string; css?: string | null; componentCss?: Record<string, string>;
    styles: Array<{ id: string; name: string; retired?: boolean; faces?: Partial<Record<FaceSlot, string>> }>;
}

/** woff2 files begin with the four bytes wOF2 (0x774F4632). */
export const isWoff2 = (data: Buffer): boolean => data.length >= 4 && data.readUInt32BE(0) === 0x774F4632;

/** A family's address: lower case letters, digits and hyphens. */
export const fontSlug = (name: string): string =>
    name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const FAMILY_RE = /^[\p{L}\p{N}][\p{L}\p{N} -]{0,59}$/u;
const WEIGHT_RE = /^([1-9]\d{0,3})( ([1-9]\d{0,3}))?$/;
const SUBSET_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const RANGE_RE = /^U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?(\s*,\s*U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?)*$/i;
const FILE_RE = /^[a-z0-9-]{1,80}\.woff2$/;

/** A free-text field: trimmed, without control characters or angle brackets; empty is null. */
function text(v: unknown, field: string, max: number, refused: string[]): string | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') { refused.push(`${field}: text`); return null; }
    const s = v.trim();
    if (!s) return null;
    if (s.length > max || /[<>]/.test(s) || [...s].some((c) => c.charCodeAt(0) < 32)) { refused.push(`${field}: up to ${max} characters, no angle brackets`); return null; }
    return s;
}

/** The file name a weight, a style and a subset are stored under. */
const fileNameOf = (weight: string, style: string, subset?: string) =>
    `${weight.replace(' ', '-')}${style === 'italic' ? '-italic' : ''}${subset ? `-${subset}` : ''}.woff2`;

/** One lock per family, so two uploads arriving together do not lose each other's write. */
const locks = new Map<string, Promise<void>>();
function withLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(slug) ?? Promise.resolve();
    const next = prev.then(fn);
    // What the next caller waits for: this step settled, whatever its outcome. The outcome itself,
    // a refusal included, goes back to this step's own caller through `next`; the map holds only a
    // promise that never rejects, so nothing in it is an unhandled rejection.
    const settled = next.then(() => undefined, () => undefined);
    locks.set(slug, settled);
    void settled.then(() => { if (locks.get(slug) === settled) locks.delete(slug); });
    return next;
}

/**
 * PUT /v1/upload/:token with utype 'font': the answer as the upload route renders every utype's,
 * `{ ok, ... }` or `{ success: false, error, message }`.
 */
export async function receiveFontUpload(config: AimeatConfig, storage: Storage, actor: string, meta: Record<string, unknown>, data: Buffer): Promise<{ status: number; body: Record<string, unknown> }> {
    try {
        const r = await new FontService(config, storage, async () => []).receive(meta, data, actor);
        return { status: 200, body: { ok: true, success: true, ...r } };
    } catch (err) {
        if (err instanceof FontError) return { status: err.httpStatus, body: { success: false, error: err.code, message: err.message } };
        throw err;
    }
}

export class FontService {
    constructor(private readonly config: AimeatConfig, private readonly storage: Storage, private readonly themes: () => Promise<ThemeLike[]>) {}

    private get systemGhii(): string { return `system@${this.config.nodeId}`; }

    // ── Reading ──

    /** Every added record in storage, served or not. */
    async records(): Promise<FontRecord[]> {
        const { items } = await this.storage.listAllMemoryMeta({ ownerPrefix: this.systemGhii, prefix: FONT_KEY_PREFIX, limit: 10000, excludeVersionRows: true });
        const out: FontRecord[] = [];
        for (const row of items) {
            const rec = await this.storage.getMemory(this.systemGhii, row.key);
            const v = rec?.value as FontRecord | undefined;
            if (v && typeof v === 'object' && Array.isArray(v.files) && typeof v.family === 'string') out.push(v);
        }
        return out;
    }

    /** Load the added faces into this process's registry: at boot, and after every write. */
    async load(): Promise<void> {
        setAddedFaces(await this.records());
    }

    private async record(slug: string): Promise<FontRecord | null> {
        if (!slug) return null;
        const rec = await this.storage.getMemory(this.systemGhii, FONT_KEY_PREFIX + slug);
        const v = rec?.value as FontRecord | undefined;
        return v && typeof v === 'object' && Array.isArray(v.files) ? v : null;
    }

    /** Which styles of which themes name a face, in which slots. */
    usesOf(family: string, themes: ThemeLike[]): FaceUse[] {
        const out: FaceUse[] = [];
        for (const t of themes) for (const s of t.styles) {
            const slots = (Object.keys(FACE_SLOTS) as FaceSlot[]).filter((slot) => s.faces?.[slot] === family);
            if (slots.length) out.push({ theme: t.id, themeName: t.name, style: s.id, styleName: s.name, retired: !!s.retired, slots });
        }
        return out;
    }

    /** An added record as the doors show it. */
    entry(r: FontRecord, themes: ThemeLike[]): FontEntry {
        const files = r.files.map((f) => ({ ...f, uploaded: !!f.sha256, url: f.sha256 ? `/v1/themes/fonts/${r.slug}/${f.file}?v=${f.sha256.slice(0, 8)}` : null }));
        const served = files.filter((f) => f.uploaded);
        return {
            ...r, stack: stackFor(r.family, r.kind), servable: served.length > 0 && !(r.family in THEME_FACES),
            weights: [...new Set(served.map((f) => f.weight))], styles: [...new Set(served.map((f) => f.style))],
            files, usedBy: this.usesOf(r.family, themes),
        };
    }

    /**
     * The inventory: every family, base and added, with its licence trail and the styles that use it.
     * For the operator, also the fonts in owners' storage (one bounded query, OWNER_FONTS_SHOWN rows
     * and the total), which are each owner's own and shown as an inventory only.
     */
    async inventory(opts: { operator: boolean; themes?: ThemeLike[] }): Promise<Record<string, unknown>> {
        const themes = opts.themes ?? await this.themes();
        const base = baseFaces().map((b: BaseFace) => ({ ...b, usedBy: this.usesOf(b.family, themes) }));
        const added = addedFaces().map((r) => this.entry(r, themes));
        const out: Record<string, unknown> = {
            base, added,
            unknownLicences: added.filter((a) => a.licenceStatus === 'unknown').map((a) => a.family),
            sheet: '/v1/themes/fonts.css',
        };
        if (opts.operator) {
            const found = await this.storage.listFontFilesAcrossOwners({ limit: OWNER_FONTS_SHOWN, excludeOwner: this.systemGhii });
            out.owners = {
                total: found.total, shown: found.items.length,
                files: found.items.map((f) => ({ owner: f.ownerGaii, key: f.key, size: f.size, mimeType: f.mimeType, visibility: f.visibility, createdAt: f.createdAt })),
                note: 'Fonts the owners of this node keep in their own storage for their apps. Each owner answers for their own files; they are not theme faces, and nothing here changes them.',
            };
        }
        return out;
    }

    /** The bytes of one served file, or null. */
    async file(slug: string, file: string): Promise<{ data: Buffer; sha256: string } | null> {
        if (!FILE_RE.test(file)) return null;
        const r = await this.record(fontSlug(slug));
        const f = r?.files.find((x) => x.file === file);
        if (!r || !f?.sha256) return null;
        const stored = await this.storage.getStorageFile(this.systemGhii, `${FONT_FILE_PREFIX}${r.slug}/${file}`);
        return stored ? { data: stored.data, sha256: f.sha256 } : null;
    }

    /** The faces sheet and its ETag. */
    sheet(): { css: string; etag: string } {
        const css = fontsSheet();
        return { css, etag: `"${createHash('sha1').update(css).digest('hex').slice(0, 16)}"` };
    }

    // ── Writing ──

    private async write(r: FontRecord, event: string): Promise<void> {
        const key = FONT_KEY_PREFIX + r.slug;
        const existing = await this.storage.getMemory(this.systemGhii, key);
        const now = new Date().toISOString();
        await this.storage.setMemory({
            key, ownerGaii: this.systemGhii, value: r, visibility: 'private', tags: ['themes', 'fonts', event], ttlHours: null,
            version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
            trackable: true,
        });
        await this.load();
        emitChange('themes');
    }

    /**
     * Register or replace a family: its name, kind, the files it will have and what is known of its
     * licence. Answers with one upload address per file. A file the family keeps keeps its bytes until
     * a new upload replaces them; a file it no longer lists is deleted.
     */
    async save(param: string, input: FontInput, by: string): Promise<{ font: FontEntry; uploads: Array<Record<string, unknown>>; created: boolean }> {
        const refused: string[] = [];
        const wanted = fontSlug(String(param || input.family || ''));
        const existing = await this.record(wanted);
        const family = input.family === undefined ? existing?.family : text(input.family, 'family', 60, refused);
        if (!family) throw new FontError('INVALID_FONT', 'family: the name a style will choose, for example "Space Mono" (1 to 60 letters, digits, spaces or hyphens).', 422);
        if (!FAMILY_RE.test(family)) throw new FontError('INVALID_FONT', `family: "${family}" is 1 to 60 letters, digits, spaces or hyphens.`, 422);
        const slug = fontSlug(family);
        if (!slug) throw new FontError('INVALID_FONT', `family: "${family}" has no letters or digits to make an address from.`, 422);
        if (param && fontSlug(param) !== slug) throw new FontError('INVALID_FONT', `The address names "${fontSlug(param)}" and the family is "${family}" (${slug}). A family keeps its name; a new name is a new family.`, 422);
        const base = Object.keys(THEME_FACES).find((n) => n.toLowerCase() === family.toLowerCase());
        if (base) throw new FontError('FAMILY_TAKEN', `"${base}" is a face this node ships with (base setup), so it cannot be added again. Choose another name.`, 409);
        const clash = addedFaces().find((r) => r.family.toLowerCase() === family.toLowerCase() && r.slug !== slug);
        if (clash) throw new FontError('FAMILY_TAKEN', `"${clash.family}" is already added. Change that family instead.`, 409);

        const kind = (input.kind === undefined ? existing?.kind ?? 'sans-serif' : input.kind) as FontKind;
        if (!(FONT_KINDS as readonly string[]).includes(kind)) refused.push(`kind: one of ${FONT_KINDS.join(', ')}`);

        let files: FontFile[];
        if (input.files === undefined) {
            if (!existing) throw new FontError('INVALID_FONT', 'files: a new family names at least one file, each with its weight and style, for example [{ "weight": "400" }].', 422);
            files = existing.files;
        } else {
            if (!Array.isArray(input.files) || input.files.length === 0) throw new FontError('INVALID_FONT', 'files: at least one file, each with its weight ("400", or "100 900" for a variable face) and its style (normal or italic).', 422);
            files = [];
            input.files.forEach((f, i) => {
                const weight = String(f?.weight ?? '').trim();
                const w = WEIGHT_RE.exec(weight);
                if (!w || Number(w[1]) > 1000 || (w[3] && (Number(w[3]) > 1000 || Number(w[3]) <= Number(w[1])))) { refused.push(`files[${i}].weight: "400", or a range "100 900", from 1 to 1000`); return; }
                const style = f?.style === undefined || f?.style === '' ? 'normal' : String(f.style);
                if (style !== 'normal' && style !== 'italic') { refused.push(`files[${i}].style: normal or italic`); return; }
                const subset = f?.subset === undefined || f?.subset === '' ? undefined : String(f.subset);
                if (subset !== undefined && !SUBSET_RE.test(subset)) { refused.push(`files[${i}].subset: lower case letters, digits and hyphens, such as latin-ext`); return; }
                const range = f?.unicodeRange === undefined || f?.unicodeRange === '' ? undefined : String(f.unicodeRange).trim();
                if (range !== undefined && (!RANGE_RE.test(range) || range.length > 4000)) { refused.push(`files[${i}].unicodeRange: as CSS writes it, for example "U+0000-00FF, U+0131"`); return; }
                const file = fileNameOf(weight, style, subset);
                if (files.some((x) => x.file === file)) { refused.push(`files[${i}]: twice the same weight, style and subset`); return; }
                const kept = existing?.files.find((x) => x.file === file);
                files.push({ file, weight, style, ...(subset ? { subset } : {}), ...(range ? { unicodeRange: range } : {}),
                    bytes: kept?.bytes ?? null, sha256: kept?.sha256 ?? null, ...(kept?.uploadedAt ? { uploadedAt: kept.uploadedAt } : {}) });
            });
        }

        const pick = (field: 'licence' | 'copyright' | 'source', max: number) =>
            input[field] === undefined ? existing?.[field] ?? null : text(input[field], field, max, refused);
        const licence = pick('licence', 200);
        const copyright = pick('copyright', 500);
        const source = pick('source', 500);
        if (source && !/^https?:\/\/[^\s]+$/i.test(source)) refused.push('source: the address the face came from, starting with https://');
        if (refused.length) throw new FontError('INVALID_FONT', refused.join('; '), 422, { refused });

        const now = new Date().toISOString();
        const record: FontRecord = {
            family, slug, origin: 'added', kind, files, licence, copyright, source,
            licenceStatus: licence && copyright ? 'stated' : 'unknown',
            addedBy: existing?.addedBy ?? by, addedAt: existing?.addedAt ?? now, updatedBy: by, updatedAt: now,
        };
        await withLock(slug, async () => {
            // A file the family no longer lists is not served, so its bytes go too.
            for (const old of existing?.files ?? []) {
                if (!files.some((f) => f.file === old.file)) await this.storage.deleteStorageFile(this.systemGhii, `${FONT_FILE_PREFIX}${slug}/${old.file}`);
            }
            await this.write(record, existing ? 'font-updated' : 'font-added');
        });

        const maxBytes = this.config.storageMaxFileSizeMb * 1024 * 1024;
        const uploads = [];
        for (const f of files) {
            const token = await generateUploadToken({ sub: by, actor: by, utype: 'font', meta: { family: slug, file: f.file }, maxBytes, contentType: 'font/woff2' }, FONT_UPLOAD_TTL_SECONDS);
            uploads.push({ file: f.file, weight: f.weight, style: f.style, ...(f.subset ? { subset: f.subset } : {}), uploaded: !!f.sha256,
                upload_url: `${this.config.baseUrl}/v1/upload/${token}`, method: 'PUT', content_type: 'font/woff2', max_bytes: maxBytes, expires_in_seconds: FONT_UPLOAD_TTL_SECONDS });
        }
        return { font: this.entry(record, await this.themes()), uploads, created: !existing };
    }

    /**
     * The bytes of one file, arriving through PUT /v1/upload/:token. Refused unless they are woff2,
     * and unless the family still lists the file the address was made for.
     */
    async receive(meta: Record<string, unknown>, data: Buffer, by: string): Promise<{ family: string; file: string; bytes: number; sha256: string; url: string }> {
        if (!isWoff2(data)) throw new FontError('NOT_WOFF2', 'These bytes are not a woff2 font (a woff2 file begins with wOF2). Convert the face to woff2 and ask for a new upload address with the same family.', 422);
        const slug = fontSlug(String(meta.family ?? ''));
        const file = String(meta.file ?? '');
        return withLock(slug, async () => {
            const r = await this.record(slug);
            const f = r?.files.find((x) => x.file === file);
            if (!r || !f) throw new FontError('NOT_FOUND', `The family "${slug}" no longer has the file ${file}. Ask for a new upload address.`, 404);
            const sha256 = createHash('sha256').update(data).digest('hex');
            const now = new Date().toISOString();
            await this.storage.createStorageFile({
                key: `${FONT_FILE_PREFIX}${slug}/${file}`, ownerGaii: this.systemGhii, visibility: 'public', mimeType: 'font/woff2',
                size: data.length, data, tags: ['theme-font', slug], createdAt: now,
            });
            const next: FontRecord = { ...r, files: r.files.map((x) => (x.file === file ? { ...x, bytes: data.length, sha256, uploadedAt: now } : x)), updatedBy: by, updatedAt: now };
            await this.write(next, 'font-uploaded');
            return { family: r.family, file, bytes: data.length, sha256, url: `/v1/themes/fonts/${slug}/${file}?v=${sha256.slice(0, 8)}` };
        });
    }

    /**
     * Remove a family and its files. Refused while any style of any theme names it, with the themes
     * and styles named. A theme's CSS that mentions the family by name is a warning, not a refusal.
     */
    async remove(param: string): Promise<{ removed: true; family: string; warnings: string[] }> {
        const slug = fontSlug(param);
        const base = Object.keys(THEME_FACES).find((n) => fontSlug(n) === slug);
        if (base) throw new FontError('BASE_FACE', `"${base}" is a face this node ships with (base setup); only a face the operator added can be removed.`, 409);
        const r = await this.record(slug);
        if (!r) throw new FontError('NOT_FOUND', `No added face "${param}". GET /v1/themes/fonts names them.`, 404);
        const themes = await this.themes();
        const uses = this.usesOf(r.family, themes);
        if (uses.length) {
            const named = uses.map((u) => `"${u.themeName}" style "${u.styleName}" (${u.slots.join(', ')})${u.retired ? ', retired' : ''}`).join('; ');
            throw new FontError('FONT_IN_USE', `"${r.family}" is the face of ${named}. Choose another face there first, then remove it.`, 409, { usedBy: uses });
        }
        const warnings = themes.filter((t) => [t.css ?? '', ...Object.values(t.componentCss ?? {})].some((css) => css.includes(r.family)))
            .map((t) => `The CSS of the theme "${t.name}" mentions "${r.family}" by name; there it falls back to the next face in its stack.`);
        await withLock(slug, async () => {
            for (const f of r.files) await this.storage.deleteStorageFile(this.systemGhii, `${FONT_FILE_PREFIX}${slug}/${f.file}`);
            await this.storage.deleteMemory(this.systemGhii, FONT_KEY_PREFIX + slug);
            await this.load();
            emitChange('themes');
        });
        return { removed: true, family: r.family, warnings };
    }
}
