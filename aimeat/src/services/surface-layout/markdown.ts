/**
 * @file src/services/surface-layout/markdown.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node's front page says, for a reader that asked for markdown rather than a
 *   page: an agent, a crawler, an unfurler.
 *
 *   WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT. The authored landing document already
 *   describes this node — what it is, what it offers, how to connect. It stays the base. What it
 *   cannot know is the operator's OWN words, the passages they wrote into their layout, and those
 *   are exactly the part a reader would otherwise never see. So they are appended, in the order the
 *   layout puts them, with their headings.
 *
 *   The dynamic blocks — the app wall, the counters, the generator — are NOT re-rendered as prose.
 *   Their content is what the page fetches when a browser opens it, and a markdown rendering of "a
 *   wall of apps" is a sentence the landing document already contains. Restating them would be a
 *   second description of the same thing, drifting from the first.
 *
 *   THIS IS NOT SERVER-SIDE RENDERING. A markdown document is a document; the platform's rule is
 *   about not building HTML pages in a handler, and this builds neither.
 * @structure renderLayoutMarkdown
 * @usage
 *   const md = renderLayoutMarkdown(base, layout, freeform);
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { SurfaceBlockInstance, SurfaceLayout } from './types.js';

/** The operator's heading for a block, preferring the reader's language and falling back to English. */
function headingOf(block: SurfaceBlockInstance, locale: string): string {
    const titles = block.titles;
    if (!titles || typeof titles !== 'object') return '';
    return titles[locale] || titles[locale.split('-')[0]] || titles.en || '';
}

/** Every free-form block in the layout, in page order, one level deep. */
function freeformBlocks(blocks: SurfaceBlockInstance[]): SurfaceBlockInstance[] {
    const out: SurfaceBlockInstance[] = [];
    for (const b of blocks) {
        if (b.hidden) continue;
        if (b.id === 'common.freeform') out.push(b);
        if (Array.isArray(b.children)) out.push(...freeformBlocks(b.children));
    }
    return out;
}

/**
 * The authored landing document, plus whatever the operator wrote into this node's front page.
 * Returns `base` unchanged when they have written nothing, which is every node until one does.
 */
export function renderLayoutMarkdown(
    base: string,
    layout: SurfaceLayout | null,
    freeform: Record<string, string>,
    locale = 'en',
): string {
    if (!layout) return base;
    const passages = freeformBlocks(layout.blocks)
        .map(b => ({ heading: headingOf(b, locale), text: (freeform[b.key] ?? '').trim() }))
        .filter(p => p.text.length > 0);
    if (passages.length === 0) return base;

    const parts = passages.map(p => (p.heading ? `## ${p.heading}\n\n${p.text}` : p.text));
    return `${base.trimEnd()}\n\n${parts.join('\n\n')}\n`;
}
