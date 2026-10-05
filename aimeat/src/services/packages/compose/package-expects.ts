/**
 * @file services/packages/compose/package-expects.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a package needs the installing node to have already: the cortexes the node
 *   ships, the extensions its apps call, and the library packs the node serves.
 *
 *   WHY THIS EXISTS. package-compose.ts names these as `expects` on the package record, because
 *   they are not copied into the package. But the list stopped there: the ZIP did not carry it, an
 *   import reset it, a pull from another node lost it with the ZIP, and no install read it. So a
 *   package whose app calls an extension this node does not have installed cleanly and then broke
 *   in the browser. Install packages, phase 2 (wish-asennuspaketit-uusille-nodeille-ja-keskitetty-
 *   pakettireposit): the list travels, and an install checks it before anything registers.
 * @structure PackageExpects · expectsOf(manifest) · manifestWithExpects(expects) · missingExpects()
 *   · expectsMissingMessage()
 * @usage
 *   const missing = await missingExpects(storage, expectsOf(pkg.manifest));
 *   if (missing) return { ok: false, status: 409, code: 'EXPECTS_MISSING', message: expectsMissingMessage(missing) };
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 2).
 */
import type { Storage } from '../../../storage/interface.js';
import { getLibraryPack } from '../../../data/library-packs.js';

export interface PackageExpects {
    cortex: string[];
    extensions: string[];
    packs: string[];
}

const EMPTY: PackageExpects = { cortex: [], extensions: [], packs: [] };

const names = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200).slice(0, 100) : [];

function parseJson(s: string): unknown {
    try { return JSON.parse(s); }
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: a manifest that is not JSON declares nothing
    catch { return null; }
}

/** The expectations in any shape a package carries them: the record's manifest string, or a parsed object. */
export function expectsOf(manifest: unknown): PackageExpects {
    let raw: unknown = manifest;
    if (typeof manifest === 'string') {
        if (!manifest.trim()) return EMPTY;
        raw = parseJson(manifest);
    }
    const e = raw && typeof raw === 'object' ? (raw as { expects?: unknown }).expects : undefined;
    if (!e || typeof e !== 'object') return EMPTY;
    const x = e as Record<string, unknown>;
    return { cortex: names(x.cortex), extensions: names(x.extensions), packs: names(x.packs) };
}

/** The record's manifest string for these expectations, or '' when there are none. */
export function manifestWithExpects(expects: PackageExpects): string {
    const any = expects.cortex.length + expects.extensions.length + expects.packs.length > 0;
    return any ? JSON.stringify({ expects }) : '';
}

/** What this node lacks of the expectations, or null when it has all of them. */
export async function missingExpects(storage: Storage, expects: PackageExpects): Promise<PackageExpects | null> {
    const missing: PackageExpects = { cortex: [], extensions: [], packs: [] };
    for (const name of expects.cortex) {
        if (!await storage.getCortexExtension(name)) missing.cortex.push(name);
    }
    for (const name of expects.extensions) {
        if (!await storage.getExtension(name)) missing.extensions.push(name);
    }
    for (const id of expects.packs) {
        if (!getLibraryPack(id)) missing.packs.push(id);
    }
    return missing.cortex.length + missing.extensions.length + missing.packs.length > 0 ? missing : null;
}

/** The refusal, naming each thing the node lacks and what to do about it. */
export function expectsMissingMessage(missing: PackageExpects): string {
    const parts: string[] = [];
    if (missing.extensions.length) parts.push(`the extension${missing.extensions.length > 1 ? 's' : ''} ${missing.extensions.join(', ')} (install ${missing.extensions.length > 1 ? 'them' : 'it'} first)`);
    if (missing.cortex.length) parts.push(`the cortex${missing.cortex.length > 1 ? 'es' : ''} ${missing.cortex.join(', ')}`);
    if (missing.packs.length) parts.push(`the library pack${missing.packs.length > 1 ? 's' : ''} ${missing.packs.join(', ')}`);
    return `This package needs what this node does not have: ${parts.join('; ')}. Nothing was installed.`;
}
