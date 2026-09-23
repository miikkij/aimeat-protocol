/**
 * @file src/services/ui-library/catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The component catalogue of this node's own interface: each part's data shape, when
 *   to use it, its variants, one example data set, the theme tokens it reads and the pages that draw
 *   it. The public route GET /v1/ui/components and the tools aimeat_ui_component_list and
 *   aimeat_ui_component_get all read it from here, so the three doors cannot tell three stories.
 *
 *   It is read-only and the same for everyone: it describes code this node ships, not anybody's
 *   data. Not Atelier's catalogue of app parts, and sharing nothing with it (Jouni, 2026-09-23).
 * @structure listUiComponents(filter) · getUiComponent(id) · UiComponentFilter
 * @usage import { listUiComponents } from '../services/ui-library/catalogue.js';
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { UiEntry, UiEntryKind, UiEntryStatus } from './types.js';
import { UI_ENTRY_SOURCES } from './entries.js';
import { UI_FACTS } from './facts.generated.js';

const EMPTY_FACTS = { classes: [], tokens: [], exports: [], usedBy: [], pages: [] };

const ENTRIES: UiEntry[] = UI_ENTRY_SOURCES.map(src => ({ ...src, ...(UI_FACTS[src.id] ?? EMPTY_FACTS) }));

export interface UiComponentFilter {
    kind?: UiEntryKind;
    status?: UiEntryStatus;
    /** Words to find in the name, summary, use or classes. Every word must match. */
    q?: string;
}

/** The summary row: enough to choose, without the example and the token list. */
export interface UiComponentRow {
    id: string;
    name: string;
    kind: UiEntryKind;
    status: UiEntryStatus;
    summary: string;
    module: string | null;
    sheet: string;
    shape: string;
    pages: string[];
}

export function listUiComponents(filter: UiComponentFilter = {}): UiComponentRow[] {
    const words = (filter.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return ENTRIES
        .filter(e => !filter.kind || e.kind === filter.kind)
        .filter(e => !filter.status || e.status === filter.status)
        .filter(e => {
            if (!words.length) return true;
            const hay = [e.id, e.name, e.summary, ...e.use, ...e.classes].join(' ').toLowerCase();
            return words.every(w => hay.includes(w));
        })
        .map(e => ({
            id: e.id, name: e.name, kind: e.kind, status: e.status, summary: e.summary,
            module: e.module, sheet: e.sheet, shape: e.data.shape, pages: e.pages,
        }));
}

/** One entry, whole: data shape, use, variants, example, tokens, users and pages. */
export function getUiComponent(id: string): UiEntry | null {
    return ENTRIES.find(e => e.id === id || e.name === id) ?? null;
}

export const UI_COMPONENT_KINDS: readonly UiEntryKind[] = ['component', 'shape'];
export const UI_COMPONENT_STATUSES: readonly UiEntryStatus[] = ['active', 'unused'];
