/**
 * @file src/services/surface-layout/types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of a configured surface: which blocks a node's front page and its members'
 *   home are built from, in what order, with what settings. One record per surface, written whole.
 *
 *   WHY ONE RECORD AND NOT A KEY PER BLOCK. The LB mirror never propagates a deletion — the origin
 *   emits an empty `deleted_memory_keys` array on every sync (routes/site.ts) — so a block stored
 *   under its own key would be removable on the origin and immortal on every mirror. With the whole
 *   layout in one value, removing a block is an update, and the mirror gets it like any other. It is
 *   also what the platform's own rule asks for: a memory value is a record, not a cell.
 *
 *   WHY `binding` EXISTS WHEN ONLY ONE VALUE IS EVER WRITTEN. Node-level is the whole of today's
 *   feature. Organism-level is the obvious next ask (a department inside one node rather than a node
 *   per department), and a record that already carries the question can answer it later by adding a
 *   member to the union. A record that does not would need every stored layout migrated.
 *
 *   ONE NESTING LEVEL, AND NO MORE. The home is not a flat list today: the "what you have made" band
 *   takes the apps row as its child, and the playbooks and the achievements strip share one band
 *   whose presence depends on both. A flat schema cannot express either, and would have earned a v2
 *   in its first week. Deeper than one level buys nothing and costs a renderer that can loop forever.
 * @structure SurfaceId · SurfaceBinding · BlockPropValue · SurfaceBlockInstance · SurfaceLayout ·
 *   ResolvedLayout · FreeformRef
 * @usage
 *   import type { SurfaceLayout, SurfaceId } from './types.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial: the record, its binding, the block instance and what a read
 *     returns when the stored value had to be repaired.
 */

/**
 * The three surfaces one engine drives. `home` is the finished home; `home-onboarding` is what a
 * person sees until their account is initialized, and it is a separate layout rather than a mode
 * because the two show almost nothing in common.
 */
export type SurfaceId = 'portal' | 'home' | 'home-onboarding';

/** Every surface id, for validation and for iterating the set. */
export const SURFACE_IDS: readonly SurfaceId[] = ['portal', 'home', 'home-onboarding'];

/**
 * What this layout is bound to. NODE-LEVEL ONLY is written today; the organism member is declared
 * so adding that scope later is a new case rather than a migration of every record.
 */
export type SurfaceBinding =
    | { kind: 'node' }
    | { kind: 'organism'; id: string };

/** What a block setting may be. Scalars, a string list, and one flat string map. Nothing deeper. */
export type BlockPropValue = string | number | boolean | string[] | Record<string, string> | null;

/** Where a free-form block's words live. The body is its own memory record, not inline. */
export interface FreeformRef {
    /** Key suffix under the private free-form prefix. */
    ref: string;
    format: 'markdown';
}

export interface SurfaceBlockInstance {
    /** Registry id, e.g. 'home.mailbox' or 'portal.gallery'. The free-form block is 'common.freeform'. */
    id: string;
    /**
     * Unique within the layout, and the address a prop patch or a free-form body points at. Equals
     * `id` for a block that may appear once; a free-form block gets its own. Without it, reordering
     * would re-target someone else's content.
     */
    key: string;
    props?: Record<string, BlockPropValue>;
    /**
     * The operator's own words for this block's heading, per language. Absent means the registry's
     * locale key wins, which is the localized default and the recommended state. A bare string was
     * rejected on purpose: it would silently end localization for that block.
     */
    titles?: Record<string, string>;
    /** Kept in the layout but not rendered, so parking a block does not lose its settings. */
    hidden?: boolean;
    /** Only a container block carries these. One level deep. */
    children?: SurfaceBlockInstance[];
}

export interface SurfaceLayout {
    /** Record schema version. A reader that meets a higher number serves the default instead. */
    v: 1;
    surface: SurfaceId;
    binding: SurfaceBinding;
    /** The array IS the order. A separate order field would be a second truth to drift from. */
    blocks: SurfaceBlockInstance[];
    /** Instance key → where its words are stored. */
    freeform?: Record<string, FreeformRef>;
    meta: {
        updatedAt: string;
        updatedBy: string;
        /** Which door wrote it. 'default' means nobody has: this is the built-in. */
        source: 'admin' | 'import' | 'mcp' | 'default';
        /** The operator's or the AI's one line about what this change was for. */
        note?: string;
    };
}

/**
 * What a read returns. `degraded` is the "we repaired this" signal: the operator sees it, the
 * visitor never does, and the page renders either way.
 */
export interface ResolvedLayout {
    layout: SurfaceLayout;
    /** true when the stored record was missing, unparseable, or partially dropped. */
    degraded: boolean;
    /** One line per repair, in the operator's direction. Never shown to a visitor. */
    problems: string[];
    source: 'stored' | 'default';
}
