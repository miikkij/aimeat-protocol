/**
 * @file src/services/datapackage/images.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The link between a row and the photograph it was read from.
 *
 *   THE PROBLEM THIS SOLVES. A person photographs thirty receipts and an agent turns them into a
 *   table. The table is the useful part, and it is also the part that cannot be checked: a total
 *   that reads 12.50 is either right or a misread 12,50, and the only way anybody settles that is by
 *   looking at the picture again. A dataset made from photographs without a way back to them is a
 *   set of claims nobody can audit, including the person who took them.
 *
 *   THE CONVENTION, AND WHY IT IS A CONVENTION RATHER THAN A PARAMETER. A column named
 *   `source_image` -- or `source_image_2`, `source_image_3` for a document that ran to several pages
 *   -- holds the picture. Nothing has to be declared, configured or passed, which matters because a
 *   tool parameter has to exist identically on three separate surfaces here and a column name has
 *   to exist in one place: the data. Two agents that never met produce tables that line up.
 *
 *   WHAT THE NODE GUARANTEES, AND WHAT IT REFUSES TO DECIDE. It rewrites a storage key into the
 *   permanent address of that file, so what lands in the CSV is something a reader can actually
 *   fetch rather than an identifier meaningful only inside this node. It refuses a key that does not
 *   exist, because a table of dead links is worse than no table. And it refuses a key belonging to
 *   somebody ELSE, because a published package is world-readable and putting another person's file
 *   address into it publishes the fact that their file exists.
 *
 *   IT DOES NOT TOUCH VISIBILITY, AND THAT IS THE WHOLE OWNERSHIP POSITION. The package bytes are
 *   public; the photograph keeps exactly the visibility its owner gave it. A receipt stays private
 *   and answers 403 to a stranger who follows the link, while its owner and anyone they consented
 *   gets the picture. The alternative -- quietly making the photos public because the table was
 *   published -- would turn publishing a spending summary into publishing thirty photographs of
 *   somebody's life, and no convenience is worth that.
 * @structure SOURCE_IMAGE_COLUMN; isImageColumn(); linkSourceImages()
 * @usage const linked = await linkSourceImages({ storage, config }, ownerGhii, input.resources);
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { publicUrl } from './contract.js';
import type { ResourceInput } from './contract.js';

/** The column a reader looks for first. Numbered siblings carry the later pages of one thing. */
export const SOURCE_IMAGE_COLUMN = 'source_image';

/** `source_image`, `source_image_2`, `source_image_3`. Nothing else, so no column is claimed by
 *  accident: a table with a `source_images_note` column keeps it as the text it is. */
const IMAGE_COLUMN_RE = /^source_image(_[1-9][0-9]?)?$/;

/**
 * How many DISTINCT pictures one package may point at.
 *
 * Each one costs a metadata lookup, and the point of the cap is not the lookups: a table with more
 * than this many separate photographs behind it is a photo library, and a library wants its own
 * package per period rather than one that grows without end.
 */
const MAX_DISTINCT_IMAGES = 2000;

export function isImageColumn(name: string): boolean {
    return IMAGE_COLUMN_RE.test(name);
}

interface Deps { storage: Storage; config: AimeatConfig }

export type LinkResult =
    | { ok: true; resources: ResourceInput[]; linked: number }
    | { ok: false; message: string };

/**
 * Resolve every picture reference in every resource, or refuse and say which one.
 *
 * Rows are COPIED rather than edited. The caller's array belongs to whoever built it -- an
 * extension, a route handler, a tool call -- and a publish that silently rewrote its input would
 * make a retry after an unrelated failure publish something different from what was asked.
 */
export async function linkSourceImages(
    deps: Deps, ownerGhii: string, resources: ResourceInput[],
): Promise<LinkResult> {
    const { storage, config } = deps;
    const ownPrefix = `${config.baseUrl.replace(/\/+$/, '')}/v1/pub/${encodeURIComponent(ownerGhii)}/`;

    /** value as written → what it should become, or the refusal it earned. */
    const seen = new Map<string, { url: string } | { refuse: string }>();
    let linked = 0;

    const out: ResourceInput[] = [];
    for (const res of resources) {
        const rows = Array.isArray(res.rows) ? res.rows : [];
        const columns = new Set<string>();
        for (const row of rows) for (const k of Object.keys(row)) if (isImageColumn(k)) columns.add(k);
        if (columns.size === 0) { out.push(res); continue; }

        const rewritten: Array<Record<string, unknown>> = [];
        for (const row of rows) {
            let copy: Record<string, unknown> | null = null;
            for (const column of columns) {
                const raw = row[column];
                if (typeof raw !== 'string' || !raw.trim()) continue;
                const value = raw.trim();

                let verdict = seen.get(value);
                if (!verdict) {
                    if (seen.size >= MAX_DISTINCT_IMAGES) {
                        return { ok: false, message: refusalTooMany(res.name) };
                    }
                    verdict = await resolve(storage, config, ownerGhii, ownPrefix, value);
                    seen.set(value, verdict);
                }
                if ('refuse' in verdict) return { ok: false, message: verdict.refuse };
                if (verdict.url === value) continue;

                copy ??= { ...row };
                copy[column] = verdict.url;
                linked++;
            }
            rewritten.push(copy ?? row);
        }
        out.push({ ...res, rows: rewritten });
    }
    return { ok: true, resources: out, linked };
}

/**
 * One reference, decided.
 *
 * An address on ANOTHER host is left exactly as written: a table may legitimately point at a picture
 * that lives somewhere else, and rewriting or refusing it would make this node the arbiter of links
 * it has nothing to do with. Everything that refers to THIS node is checked, because that is the
 * part it can be sure about.
 */
async function resolve(
    storage: Storage, config: AimeatConfig, ownerGhii: string, ownPrefix: string, value: string,
): Promise<{ url: string } | { refuse: string }> {
    if (/^https?:\/\//i.test(value)) {
        const here = `${config.baseUrl.replace(/\/+$/, '')}/v1/pub/`;
        if (!value.startsWith(here)) return { url: value };
        if (!value.startsWith(ownPrefix)) return { refuse: refusalNotYours(value) };
        return await verify(storage, ownerGhii, decodeKey(value.slice(ownPrefix.length)), value);
    }

    if (value.startsWith('/v1/pub/')) {
        const rest = value.slice('/v1/pub/'.length);
        const slash = rest.indexOf('/');
        const who = decodeURIComponent(rest.slice(0, slash < 0 ? rest.length : slash));
        if (who !== ownerGhii) return { refuse: refusalNotYours(value) };
        const key = decodeKey(rest.slice(slash + 1));
        return await verify(storage, ownerGhii, key, publicUrl(config.baseUrl, ownerGhii, key));
    }

    // Anything else is one of this person's own storage keys, which is what an agent that just
    // uploaded a photograph is holding.
    return await verify(storage, ownerGhii, value, publicUrl(config.baseUrl, ownerGhii, value));
}

async function verify(
    storage: Storage, ownerGhii: string, key: string, url: string,
): Promise<{ url: string } | { refuse: string }> {
    const meta = await storage.getStorageFileMeta(ownerGhii, key);
    if (!meta) return { refuse: refusalMissing(key) };
    return { url };
}

function decodeKey(encoded: string): string {
    return encoded.split('/').map(decodeURIComponent).join('/');
}

/* ── The refusals. Each names what is wrong and the one thing that fixes it. ─────────────── */

function refusalMissing(key: string): string {
    return `The picture "${key}" is not in your files, so the table would point at nothing. `
        + 'Upload it first, then publish, and the row will link straight to it.';
}

function refusalNotYours(value: string): string {
    return 'One row points at a file belonging to somebody else, and a published table is read by '
        + `anyone, so this one is not published: ${value}. Point it at your own copy of the picture instead.`;
}

function refusalTooMany(resource: string): string {
    return `"${resource}" points at more than ${MAX_DISTINCT_IMAGES} separate pictures. `
        + 'Split it into one package per month or per batch, which also makes each one quicker to open.';
}
