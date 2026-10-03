/**
 * @file src/services/themes/fonts-base.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The base faces as the font manager's inventory shows them: every family a theme may
 *   choose from code (THEME_FACES), with the weights and styles /lib/aimeat-fonts.css declares for it
 *   and the licence trail /lib/fonts/LICENSE.md holds for it (version, copyright holder, source). Read
 *   from those two files once, the way styles.ts reads the built-in styles from theme.css, so the
 *   inventory never carries a second copy of either.
 *
 *   What the repository ships is free licences only (pnpm check:licenses holds that); LICENSE.md
 *   says every family there is SIL OFL 1.1, so a base face's licence is "OFL-1.1" and its status is
 *   "stated". A family the trail has no row for still shows, with what the trail could not say left
 *   empty and its status "unknown", so a gap in the trail is visible instead of filled in.
 * @structure BaseFace · baseFaces · kindOfStack
 * @usage import { baseFaces } from './fonts-base.js';
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial (font manager).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetDir } from '../../server-bootstrap/asset-dirs.js';
import { logger } from '../../utils/logger.js';
import { THEME_FACES } from './tokens.js';
import type { FontKind } from './font-registry.js';

export interface BaseFace {
    family: string;
    origin: 'base';
    kind: FontKind;
    stack: string;
    weights: string[];
    styles: string[];
    files: Array<{ file: string; weight: string; style: string; url: string }>;
    version: string | null;
    licence: string | null;
    copyright: string | null;
    source: string | null;
    licenceStatus: 'stated' | 'unknown';
}

/** The generic family a stack ends in, as the kind of face it is. */
export function kindOfStack(stack: string): FontKind {
    const last = stack.split(',').map((s) => s.trim()).pop() ?? '';
    return last === 'monospace' ? 'monospace' : last === 'serif' ? 'serif' : last === 'cursive' ? 'cursive' : 'sans-serif';
}

let cache: BaseFace[] | null = null;

/** Every base face, in THEME_FACES order. */
export function baseFaces(): BaseFace[] {
    if (cache) return cache;
    const pub = resolveAssetDir('public', join(dirname(fileURLToPath(import.meta.url)), '..'), process.cwd());
    // A file that cannot be read leaves its half of the trail empty, and the faces show as "unknown"
    // rather than taking the inventory down; the log says which file.
    const read = (rel: string) => {
        try { return pub ? readFileSync(join(pub, rel), 'utf8') : ''; } catch (err) {
            logger.warn('[fonts] base face trail not readable', { file: rel, error: (err as Error).message });
            return '';
        }
    };
    const sheet = read(join('lib', 'aimeat-fonts.css'));
    const trail = read(join('lib', 'fonts', 'LICENSE.md'));

    const declared = new Map<string, BaseFace['files']>();
    for (const m of sheet.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        const body = m[1];
        const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
        const src = /url\('(\/lib\/fonts\/[^']+)'\)/.exec(body)?.[1];
        if (!family || !src) continue;
        const weight = /font-weight:\s*([0-9 ]+);/.exec(body)?.[1]?.trim() ?? '400';
        const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? 'normal';
        const list = declared.get(family) ?? [];
        list.push({ file: src.split('/').pop()!, weight, style, url: src });
        declared.set(family, list);
    }
    const allOfl = /SIL Open Font License 1\.1/.test(trail);
    const rows = new Map<string, { version: string; copyright: string; source: string }>();
    for (const line of trail.split('\n')) {
        const cells = line.split('|').map((c) => c.trim());
        if (cells.length < 7 || cells[1] === 'Family' || /^-+$/.test(cells[1])) continue;
        rows.set(cells[1], { version: cells[2], copyright: cells[4], source: cells[5] });
    }

    cache = Object.entries(THEME_FACES).map(([family, stack]) => {
        const files = declared.get(family) ?? [];
        const row = rows.get(family);
        const licence = row && allOfl ? 'OFL-1.1' : null;
        return {
            family, origin: 'base' as const, kind: kindOfStack(stack), stack,
            weights: [...new Set(files.map((f) => f.weight))], styles: [...new Set(files.map((f) => f.style))], files,
            version: row?.version ?? null, licence, copyright: row?.copyright ?? null, source: row?.source ?? null,
            licenceStatus: licence && row?.copyright ? 'stated' as const : 'unknown' as const,
        };
    });
    return cache;
}
