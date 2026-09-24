/**
 * @file check-shape-tokens.ts
 * @description Ratchet for shape literals in the component sheets (public/css/poster.css and
 *   public/css/components/*.css): a corner, a frame width, a shadow or a letter case written as a
 *   value where a theme's shape value exists (src/services/themes/shapes.ts). A component that
 *   writes its own corner or shadow keeps the built-in look inside every other theme, which is what
 *   Jouni ruled against on 2026-09-24: "katsoo että pebble syntyy myös niille uusille tehdyille
 *   komponenteille mitä tullaan tekemään kun tehdään settings & controls kirjastoon."
 *
 *   Counted, per declaration (comments and strings excluded):
 *   - corner: a border-radius (or a corner longhand) with no var(), except 50% (a circle is the
 *     thing's own shape, not a theme's corner);
 *   - frame: a border, outline or *-width whose width is 2px or 3px written out (a 1px hairline and a
 *     thicker bar have no shape value);
 *   - shadow: a box-shadow that is not `none` and does not start from var();
 *   - case: a text-transform of uppercase, lowercase or capitalize.
 *   The baseline records debt, never approval: a file may only go down. Seeded 2026-09-24 on Jouni's
 *   word ("a ratchet seeded at today's count that only falls"); re-seeding needs his decision.
 * @usage pnpm check:shape-tokens [--report | --record]
 * @version-history
 *   v1.0.0 -- 2026-09-24 -- Initial (07 "New components follow the theme", item 4).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'security/shape-tokens-baseline.json');

export type ShapeCounts = Partial<Record<'corner' | 'frame' | 'shadow' | 'case', number>>;
interface Baseline { _note: string; _measured: { date: string; files: number; literals: number; kinds: ShapeCounts }; files: Record<string, ShapeCounts> }

/** The shape literals of one sheet, by kind. */
export function countShapeLiterals(source: string): ShapeCounts {
    const css = source.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    const counts: ShapeCounts = {};
    const add = (k: keyof ShapeCounts) => { counts[k] = (counts[k] ?? 0) + 1; };
    for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
        for (const decl of block[1].split(';')) {
            const i = decl.indexOf(':');
            if (i < 0) continue;
            const prop = decl.slice(0, i).trim().toLowerCase();
            const value = decl.slice(i + 1).replace(/!important/i, '').trim();
            if (!prop || !value || prop.startsWith('--')) continue;
            if (/^border(-(top|bottom)-(left|right))?-radius$/.test(prop)) {
                if (!/var\(/.test(value) && value !== '50%') add('corner');
            } else if (/^(border|outline)(-(top|right|bottom|left))?(-width)?$/.test(prop)) {
                if (!/^var\(/.test(value) && /(^|\s)(2|3)px(\s|$)/.test(value)) add('frame');
            } else if (prop === 'box-shadow') {
                if (value !== 'none' && !/^var\(/.test(value)) add('shadow');
            } else if (prop === 'text-transform') {
                if (/^(uppercase|lowercase|capitalize)$/.test(value)) add('case');
            }
        }
    }
    return counts;
}

/** Every file and kind whose count went up against the baseline. */
export function rises(files: Record<string, ShapeCounts>, baseline: Record<string, ShapeCounts>): string[] {
    return Object.entries(files).flatMap(([file, counts]) => Object.entries(counts)
        .filter(([k, n]) => (n ?? 0) > (baseline[file]?.[k as keyof ShapeCounts] ?? 0))
        .map(([k, n]) => `${file}: ${k} ${baseline[file]?.[k as keyof ShapeCounts] ?? 0} -> ${n}`));
}

function scan(): Record<string, ShapeCounts> {
    const files: Record<string, ShapeCounts> = {};
    const sheets = ['public/css/poster.css', ...readdirSync(path.join(ROOT, 'public/css/components')).filter((f) => f.endsWith('.css')).sort().map((f) => `public/css/components/${f}`)];
    for (const file of sheets) {
        const counts = countShapeLiterals(readFileSync(path.join(ROOT, file), 'utf8'));
        if (Object.keys(counts).length) files[file] = counts;
    }
    return files;
}

function main(): void {
    const record = process.argv.includes('--record');
    const report = process.argv.includes('--report');
    const files = scan();
    const kinds: ShapeCounts = {};
    for (const counts of Object.values(files)) for (const [k, n] of Object.entries(counts)) kinds[k as keyof ShapeCounts] = (kinds[k as keyof ShapeCounts] ?? 0) + (n ?? 0);
    const literals = Object.values(kinds).reduce((a, b) => a + (b ?? 0), 0);
    if (record) {
        const baseline: Baseline = {
            _note: 'Shape literals in the component sheets where a theme shape value exists (src/services/themes/shapes.ts): recorded debt, not approval. '
                + 'A count may only go down: after a component reads the shape values, lower its counts or remove the file. '
                + 'Seeded 2026-09-24 on Jouni\'s word; only his decision permits re-seeding with pnpm check:shape-tokens --record.',
            _measured: { date: new Date().toISOString(), files: Object.keys(files).length, literals, kinds },
            files,
        };
        writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
        console.log(`Recorded ${literals} shape literals in ${Object.keys(files).length} sheets.`);
        return;
    }
    if (!existsSync(BASELINE)) throw new Error('Shape-token baseline missing. Seed only with the developer\'s decision.');
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    const fresh = rises(files, baseline.files);
    console.log(`Shape literals: ${literals} in ${Object.keys(files).length} sheets (${Object.entries(kinds).map(([k, n]) => `${k}=${n}`).join(' ')}); ${fresh.length} rises.`);
    if (report) for (const [file, counts] of Object.entries(files)) console.log(`${file}: ${JSON.stringify(counts)}`);
    if (fresh.length) {
        for (const f of fresh) console.error(f);
        console.error('Read the shape value instead (var(--shape-corner), var(--shape-frame), var(--shape-shadow-…), var(--shape-case-…)); see src/services/themes/shapes.ts.');
        process.exitCode = 1;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
