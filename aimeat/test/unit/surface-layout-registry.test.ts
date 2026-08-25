/**
 * @file test/unit/surface-layout-registry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Proves the surface block registry is internally true before anything renders from
 *   it: the built-in layouts name blocks that exist and are allowed where they are used, every
 *   declared prop default satisfies its own declaration, and every live-update domain a block
 *   claims is one this node actually publishes.
 *
 *   THE DOMAIN CHECK SCANS SOURCE, AND THAT IS SAFE HERE ONLY BECAUSE IT SELF-CHECKS. emitChange()
 *   takes a plain string, so a typo in liveDomains is invisible to the compiler and would simply
 *   never fire — a block that quietly looks stale for reasons nobody can find. The scan collects
 *   the literals actually passed to emitChange and then asserts it found a plausible number of
 *   them; a regex that stops matching therefore fails loudly rather than passing an empty set,
 *   which is the failure mode a source scan is normally guilty of.
 * @structure registry shape · default layouts · prop defaults · live-update domains
 * @usage pnpm exec vitest run test/unit/surface-layout-registry.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ALL_BLOCKS,
    DEFAULT_BLOCKS,
    blockById,
    blockIsPresent,
    blocksForSurface,
    defaultLayout,
    operatorLabelKey,
} from '../../src/services/surface-layout/registry.js';
import { SURFACE_IDS, type SurfaceId } from '../../src/services/surface-layout/types.js';
import type { AimeatConfig } from '../../src/config.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** Every domain string this node actually broadcasts, read from the emitChange call sites. */
function publishedDomains(): Set<string> {
    const found = new Set<string>();
    const files = readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
        .filter(f => f.endsWith('.ts'));
    for (const rel of files) {
        const text = readFileSync(join(SRC, rel), 'utf-8');
        for (const m of text.matchAll(/emitChange\(\s*'([a-z0-9-]+)'/g)) found.add(m[1]);
    }
    return found;
}

describe('surface block registry', () => {
    it('declares each block once, with the fields a renderer and an operator both need', () => {
        const seen = new Set<string>();
        for (const def of ALL_BLOCKS) {
            expect(seen.has(def.id), `duplicate block id ${def.id}`).toBe(false);
            seen.add(def.id);
            expect(def.id, `${def.id} is not <group>.<name>`).toMatch(/^[a-z]+\.[a-z][a-z-]*$/);
            expect(def.surfaces.length, `${def.id} belongs to no surface`).toBeGreaterThan(0);
            for (const s of def.surfaces) expect(SURFACE_IDS).toContain(s);
            expect(def.localeStem.length, `${def.id} has no locale stem`).toBeGreaterThan(0);
            expect(def.summary.length, `${def.id} has no summary`).toBeGreaterThan(10);
            expect(def.maxPerSurface, `${def.id} may never be used`).toBeGreaterThan(0);
        }
        // A registry that collapsed to nothing must fail rather than pass every loop above.
        expect(ALL_BLOCKS.length).toBeGreaterThan(20);
    });

    it('gives the operator a label key that is its own, not one borrowed from the block content', () => {
        for (const def of ALL_BLOCKS) {
            expect(operatorLabelKey(def.id)).toBe(`surface.blocks.${def.id}.label`);
            expect(operatorLabelKey(def.id)).not.toBe(def.localeStem);
        }
    });

    it('every prop default satisfies the declaration it sits in', () => {
        for (const def of ALL_BLOCKS) {
            for (const [name, prop] of Object.entries(def.props)) {
                const where = `${def.id}.${name}`;
                expect(prop.description.length, `${where} has no description`).toBeGreaterThan(10);
                if (prop.default === undefined) continue;
                switch (prop.type) {
                    case 'string':
                        expect(typeof prop.default, where).toBe('string');
                        if (prop.maxLength !== undefined) {
                            expect((prop.default as string).length, where).toBeLessThanOrEqual(prop.maxLength);
                        }
                        break;
                    case 'number':
                        expect(typeof prop.default, where).toBe('number');
                        if (prop.min !== undefined) expect(prop.default as number, where).toBeGreaterThanOrEqual(prop.min);
                        if (prop.max !== undefined) expect(prop.default as number, where).toBeLessThanOrEqual(prop.max);
                        break;
                    case 'boolean':
                        expect(typeof prop.default, where).toBe('boolean');
                        break;
                    case 'enum':
                        expect(prop.values, where).toContain(prop.default);
                        break;
                    case 'string[]': {
                        const list = prop.default as readonly string[];
                        expect(Array.isArray(list), where).toBe(true);
                        if (prop.values) for (const v of list) expect(prop.values, `${where} default names ${v}`).toContain(v);
                        if (prop.maxItems !== undefined) expect(list.length, where).toBeLessThanOrEqual(prop.maxItems);
                        break;
                    }
                }
            }
        }
    });

    it('claims only live-update domains this node actually publishes', () => {
        const published = publishedDomains();
        // The scan itself is the thing most likely to break. If it stops matching, this fails here
        // rather than waving every block through against an empty set.
        expect(published.size, 'emitChange scan found almost nothing — the scan is broken, not the registry')
            .toBeGreaterThan(30);
        expect(published.has('memory')).toBe(true);
        for (const def of ALL_BLOCKS) {
            for (const domain of def.liveDomains) {
                expect(published.has(domain), `${def.id} listens for "${domain}", which nothing emits`).toBe(true);
            }
        }
    });
});

describe('default layouts', () => {
    it('cover every surface and name only blocks that exist there', () => {
        for (const surface of SURFACE_IDS) {
            const blocks = DEFAULT_BLOCKS[surface];
            expect(blocks.length, `${surface} has an empty default`).toBeGreaterThan(0);
            for (const inst of blocks) {
                const def = blockById(inst.id);
                expect(def, `${surface} default names unknown block ${inst.id}`).toBeDefined();
                expect(def!.surfaces, `${inst.id} is not allowed on ${surface}`).toContain(surface);
            }
        }
    });

    it('use each instance key once and stay inside maxPerSurface', () => {
        for (const surface of SURFACE_IDS) {
            const keys = new Set<string>();
            const counts = new Map<string, number>();
            for (const inst of DEFAULT_BLOCKS[surface]) {
                expect(keys.has(inst.key), `${surface} repeats key ${inst.key}`).toBe(false);
                keys.add(inst.key);
                counts.set(inst.id, (counts.get(inst.id) ?? 0) + 1);
            }
            for (const [id, n] of counts) {
                expect(n, `${surface} uses ${id} ${n} times`).toBeLessThanOrEqual(blockById(id)!.maxPerSurface);
            }
        }
    });

    it('give children only to a container', () => {
        for (const surface of SURFACE_IDS) {
            for (const inst of DEFAULT_BLOCKS[surface]) {
                if (!inst.children) continue;
                expect(blockById(inst.id)!.container, `${inst.id} holds children but is not a container`).toBe(true);
            }
        }
    });

    it('are handed out as fresh objects, so a caller editing one cannot change the built-in', () => {
        const cfg = {} as AimeatConfig;
        const a = defaultLayout('home', cfg);
        expect(a.blocks.length, 'the built-in home is not empty on a bare config').toBeGreaterThan(0);
        a.blocks.push({ id: 'home.trust', key: 'extra' });
        expect(defaultLayout('home', cfg).blocks.some(x => x.key === 'extra')).toBe(false);
        expect(a.meta.source).toBe('default');
        expect(a.binding).toEqual({ kind: 'node' });
    });

    // The built-in layout has to pass the write gate on the node it is served to, or "start from the
    // built-in one" is refused for naming a block this node does not have — the default failing its
    // own validator. That is what happened with the chat door on a node with no chat.
    it('hold only blocks the node can actually serve', () => {
        const cfg = {} as AimeatConfig;
        for (const surface of SURFACE_IDS) {
            for (const inst of defaultLayout(surface, cfg).blocks) {
                expect(blockIsPresent(blockById(inst.id)!, cfg), `${surface} offers ${inst.id} it cannot serve`).toBe(true);
            }
        }
    });

    it('drop a block this node cannot serve rather than offering it', () => {
        // The chat door is gated on a capability a bare config does not have.
        const declared = DEFAULT_BLOCKS.home.map(b => b.id);
        expect(declared, 'fixture assumption: the built-in home declares the chat door').toContain('home.chat-door');
        const served = defaultLayout('home', {} as AimeatConfig).blocks.map(b => b.id);
        expect(served).not.toContain('home.chat-door');
        expect(served).toContain('home.feed');
    });
});

describe('presence', () => {
    const cfg = (over: Partial<AimeatConfig> = {}) => ({ ...over } as AimeatConfig);

    it('offers an always-on block on a bare config', () => {
        expect(blockIsPresent(blockById('home.feed')!, cfg())).toBe(true);
    });

    it('closes a config-gated block when the field is absent or false, and never throws', () => {
        const def = { ...blockById('home.feed')!, presence: { kind: 'config' as const, configKey: 'commerceEnabled' as const } };
        expect(blockIsPresent(def, cfg())).toBe(false);
        expect(blockIsPresent(def, cfg({ commerceEnabled: false }))).toBe(false);
        expect(blockIsPresent(def, cfg({ commerceEnabled: true }))).toBe(true);
    });

    it('filters a surface without raising, whatever the config holds', () => {
        for (const surface of SURFACE_IDS as SurfaceId[]) {
            const offered = blocksForSurface(surface, cfg());
            expect(Array.isArray(offered)).toBe(true);
            for (const def of offered) expect(def.surfaces).toContain(surface);
        }
    });
});
