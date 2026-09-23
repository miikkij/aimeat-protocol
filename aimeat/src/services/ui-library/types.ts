/**
 * @file src/services/ui-library/types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of one entry in the component catalogue: what a part of this node's own
 *   interface is, the data it takes, when to use it, its variants, and one example data set.
 *
 *   TWO HALVES, WRITTEN BY TWO HANDS. What a part is FOR (summary, data, use, variants, example) is
 *   written by a person in the entries files, because no script can say it. What a part IS (the
 *   classes its sheet defines, the theme tokens it reads, the names its module exports, and the pages
 *   that draw it) is read from the files by scripts/build-ui-library.ts into facts.generated.ts, and
 *   `pnpm check:ui-library` refuses a stale copy. A fact written by hand goes stale the first time
 *   somebody edits the sheet; a purpose read by a script is not a purpose.
 *
 *   This is the node's OWN interface library. It is not Atelier's catalogue of app parts, and it
 *   shares no code, data or names with it (Jouni, 2026-09-23).
 * @structure UiEntryKind · UiEntryStatus · UiVariant · UiEntrySource · UiEntryFacts · UiEntry
 * @usage import type { UiEntry } from './types.js';
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */

/** A component has a module and a sheet of its own; a shape is a class in the shared poster.css. */
export type UiEntryKind = 'component' | 'shape';

/** `unused` is a part with a sheet that no page draws today: kept until Jouni says keep or delete. */
export type UiEntryStatus = 'active' | 'unused';

/** What a person does with a part. The check holds every entry to these words. */
export type UiUse = 'view' | 'edit' | 'list' | 'pick' | 'compare' | 'status' | 'navigate' | 'converse'
    | 'act' | 'copy' | 'explain' | 'count' | 'search' | 'notify' | 'wait' | 'layout' | 'open' | 'confirm';

/** One way the part can look, and the class or prop that selects it. */
export interface UiVariant {
    name: string;
    /** The modifier class that carries it, when there is one. The check holds it to the sheet. */
    class?: string;
    /** The prop that selects it on the component, when there is one. */
    prop?: string;
    when: string;
}

/** The half a person writes. */
export interface UiEntrySource {
    /** The sheet's base name for a component (`step-card`), a short name for a shape (`slab`). */
    id: string;
    name: string;
    kind: UiEntryKind;
    status: UiEntryStatus;
    summary: string;
    /** The public path of the JS module, or null when the part is a class put on markup. */
    module: string | null;
    /** The public path of the stylesheet that holds its look. */
    sheet: string;
    /**
     * For a shape: the classes that make it, all in poster.css. A component's are read from its
     * sheet; one without a module names here the class a page puts on markup to draw it.
     */
    classes?: string[];
    data: {
        /** The call, as a person would write it. */
        shape: string;
        /** Each prop or slot, and what it carries. */
        fields: Record<string, string>;
    };
    /** What a person does with it, in the fixed words (08-component-rules.md); a view filters by them. */
    use: UiUse[];
    /** When to reach for it, in a sentence. */
    useFor: string[];
    variants: UiVariant[];
    /** One data set that draws it. */
    example: Record<string, unknown>;
    /** Where an unused part's code still sits, or anything else a builder needs to know. */
    note?: string;
}

/** The half a script reads from the files. */
export interface UiEntryFacts {
    classes: string[];
    /** The theme custom properties its rules read, without the `var()`. */
    tokens: string[];
    exports: string[];
    /** Files that import the module directly, or write one of its classes as markup. */
    usedBy: string[];
    /** The page files that draw it, directly or through another component. */
    pages: string[];
}

export type UiEntry = UiEntrySource & UiEntryFacts;

/** An entry as the entries-*.ts files write it: its `use` words come from entries-use.ts. */
export type UiEntryWritten = Omit<UiEntrySource, 'use'>;
