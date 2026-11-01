/**
 * @file src/services/dataproduct/list-facts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the list of data products says about each product beside its definition: the
 *   package it builds (audience, newest version, withdrawn), its freshness against its own promise
 *   (services/datapackage/freshness.ts), the named shares live on it now and the served reads of those
 *   shares in the last seven days (services/parties/read-stats.ts). The owner's Offers page draws one
 *   row per product from this, and an AI answers "what data do I offer" and "is any of it stale" from
 *   the same list (plan doc-mvwxcas3dom3, D1.1, D6.1, D3.5).
 *
 *   ONE READ OF EACH SHARED LIST. The consents and the read log are read once for the whole list, not
 *   once per product; the pointer and the freshness are per product, as the package's own answer reads
 *   them.
 * @structure ProductListFacts · productListFacts
 * @usage const facts = await productListFacts(deps, ownerGhii, defs.map(d => d.name));
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, WP9a: the Offers page's data products list).
 */
import type { StoreDeps } from '../datapackage/store.js';
import { readPointer } from '../datapackage/version-audience.js';
import { packageFreshness } from '../datapackage/freshness-read.js';
import { isLiveShare, packageOfPattern } from '../parties/shares.js';
import { shareReadStats } from '../parties/read-stats.js';

export interface ProductListFacts {
    /** The package the product builds, or null before its first successful run. */
    package: { content_hash: string | null; updated_at: string; visibility: string; withdrawn: boolean } | null;
    /** fresh, late, stale or unscheduled; null while no version is published. */
    freshness: { state: string; due_at: string | null; stale_at: string | null; reason_code: string } | null;
    /** Named shares live on the package now. */
    shares: number;
    /** Served reads through those shares in the last seven days. */
    reads_7d: number;
}

/** The list facts of each named product of one owner. */
export async function productListFacts(deps: StoreDeps, ownerGhii: string, names: string[]): Promise<Map<string, ProductListFacts>> {
    const out = new Map<string, ProductListFacts>();
    if (!names.length) return out;
    const now = Date.now();
    const active = await deps.storage.listConsents(ownerGhii, { status: 'active' });
    const live = active.filter(c => c.recipient.startsWith('party:') && isLiveShare(c, now));
    const stats = await shareReadStats(deps.storage, ownerGhii);
    for (const name of names) {
        const pointer = await readPointer(deps, ownerGhii, name);
        const fresh = pointer?.contentHash ? await packageFreshness(deps, ownerGhii, name, { pointer }) : null;
        const mine = live.filter(c => packageOfPattern(c.dataPattern) === name);
        out.set(name, {
            package: pointer ? {
                content_hash: pointer.contentHash || null, updated_at: pointer.updatedAt,
                visibility: pointer.visibility ?? 'public', withdrawn: pointer.status === 'withdrawn',
            } : null,
            freshness: fresh ? { state: fresh.state, due_at: fresh.due_at, stale_at: fresh.stale_at, reason_code: fresh.reason_code } : null,
            shares: mine.length,
            reads_7d: mine.reduce((n, c) => n + (stats.get(c.id)?.reads_7d ?? 0), 0),
        });
    }
    return out;
}
