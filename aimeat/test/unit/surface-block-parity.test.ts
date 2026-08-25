/**
 * @file test/unit/surface-block-parity.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two halves of the block registry have to agree, and this proves it by CALLING the
 *   browser's loader for every block the server declares — not by scanning either file's source.
 *
 *   WHY NOT A SOURCE SCAN. This repo tried gating a two-sided registry by reading handler source on
 *   2026-08-16 and it was wrong in both directions inside an hour: an id built by concatenation is
 *   invisible to a regex, and an id in a comment is a false positive. Calling the loader is immune to
 *   both, and it catches three more things a scan never could — a path that does not resolve, an
 *   export that was renamed, and a module that throws while being imported.
 *
 *   WHAT IT DOES NOT PROVE. There is no DOM in this project and no server-side Preact renderer, so
 *   this cannot mount a block and watch it draw. That half is proved where this repo proves every
 *   frontend change: by driving a real browser. What is checked here is that every declared block
 *   HAS a component, that no component is unreachable, and that the operator has words for each one.
 *
 *   The self-check comes first: if the registry or the map ever comes back empty, that fails on its
 *   own line rather than waving every loop below through against nothing.
 * @structure declared-vs-mapped · loader invocation · operator labels
 * @usage pnpm check:surface-blocks
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_BLOCKS, operatorLabelKey } from '../../src/services/surface-layout/registry.js';
// The browser's half. It has no static imports of its own — every component is behind a loader — so
// importing it here costs nothing until a loader is called.
import { BLOCKS, blockFor } from '../../public/views/surface/block-map.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Blocks the browser deliberately has no component for, each with the reason. This list may only
 * shrink: an entry is a decision, not a place to park a block somebody forgot to draw.
 */
const NOT_A_COMPONENT: Record<string, string> = {
    'common.band': 'A band is the renderer\'s own grouping of the blocks inside it, drawn by the renderer rather than by a component of its own.',
};

const declared = ALL_BLOCKS.map(b => b.id);
const mapped = Object.keys(BLOCKS);

function enJson(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(ROOT, 'locales', 'en.json'), 'utf-8'));
}

/** Read a dotted key out of the locale tree. */
function localeValue(tree: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => {
        if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
            return (node as Record<string, unknown>)[part];
        }
        return undefined;
    }, tree);
}

describe('the two halves of the block registry', () => {
    it('are both non-empty, so nothing below passes against an empty set', () => {
        expect(declared.length, 'the server declares no blocks — the registry import is broken').toBeGreaterThan(20);
        expect(mapped.length, 'the browser maps no blocks — the block-map import is broken').toBeGreaterThan(20);
    });

    it('every block the server declares has a component the browser can load', async () => {
        const missing: string[] = [];
        for (const id of declared) {
            if (id in NOT_A_COMPONENT) continue;
            const Cmp = await blockFor(id);
            if (typeof Cmp !== 'function') missing.push(id);
        }
        expect(missing, 'declared blocks with no component: an operator could add these and see nothing').toEqual([]);
    });

    it('every component the browser maps is a block the server declares', () => {
        const orphans = mapped.filter(id => !declared.includes(id));
        expect(orphans, 'components no layout can ever reach').toEqual([]);
    });

    it('lists no block as component-less without a written reason, and the list only shrinks', () => {
        for (const [id, why] of Object.entries(NOT_A_COMPONENT)) {
            expect(declared, `${id} is exempted but not declared`).toContain(id);
            expect(why.length, `${id} is exempted with no reason`).toBeGreaterThan(30);
        }
        expect(Object.keys(NOT_A_COMPONENT).length, 'the exemption list grew').toBeLessThanOrEqual(1);
    });

    it('gives the operator words for every block, in the source language', () => {
        const en = enJson();
        const missing = declared.filter(id => typeof localeValue(en, operatorLabelKey(id)) !== 'string');
        expect(missing, 'blocks whose picker row would show a raw key to the operator').toEqual([]);
    });
});
