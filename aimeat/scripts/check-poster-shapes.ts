/**
 * @file check-poster-shapes.ts
 * @description Ratchet for design-language shapes copied into view and component sheets.
 *   Counts declarations, not lines. Comments and strings are excluded; a label needs both
 *   .1em tracking and the accent colour in the same declaration block. The baseline records
 *   debt, never approval. Only an explicit decision permits --record; migrations shrink it.
 * @usage pnpm check:poster-shapes [--report | --record]
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- Each weight and offset also matches its shape token (var(--rule-heavy),
 *     var(--offset-m), ...), so a copy written with the token is still a copy.
 *   v1.0.0 -- 2026-09-13 -- V0: eleven patterns, file/count baseline and read-only gate.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'security/poster-shapes-baseline.json');
// A weight or an offset matches its literal value and its shape token (theme.css), because a copy
// spelled with the token is the same copy.
const W2 = '(?:2px|var\\(--rule-thing\\))';
const W3 = '(?:3px|var\\(--rule-heavy\\))';
const OS = '(?:4px|var\\(--offset-s\\))';
const OM = '(?:8px|var\\(--offset-m\\))';
const OL = '(?:12px|var\\(--offset-l\\))';
const re = (body: string) => new RegExp(`(?:^|[;{])\\s*${body}`, 'gi');
const PATTERNS = {
    headline: re('font-family:\\s*var\\(--font-poster\\)'),
    rule: re(`border-top:\\s*${W3}\\s+solid\\s+var\\(--text\\)`),
    action: re(`border-bottom:\\s*${W3}\\s+solid\\s+var\\(--text\\)`),
    sun: re('background:\\s*var\\(--sun\\)'),
    box2: re(`border:\\s*${W2}\\s+solid\\s+var\\(--text\\)`),
    frame3: re(`border:\\s*${W3}\\s+solid\\s+var\\(--text\\)`),
    record: re(`box-shadow:\\s*${OM}\\s+${OM}\\s+0\\s+var\\(--sun\\)`),
    aside: re(`border:\\s*${W3}\\s+dashed\\s+var\\(--accent\\)`),
    slab: re(`box-shadow:\\s*${OS}\\s+${OS}\\s+0\\s+var\\(--sun\\)`),
    dialog: re(`box-shadow:\\s*${OL}\\s+${OL}\\s+0\\s+var\\(--sun\\)`),
};
type Counts = Record<string, number>;
interface Baseline { _note: string; _measured: { date: string; files: number; declarations: number; patterns: Counts }; files: Record<string, Counts> }

export function countShapes(source: string): Counts {
    const css = source.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    const counts: Counts = {};
    for (const [name, pattern] of Object.entries(PATTERNS)) {
        const count = [...css.matchAll(pattern)].length;
        if (count) counts[name] = count;
    }
    let labels = 0;
    for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
        if (/(?:^|;)\s*color:\s*var\(--accent\)\s*(?:!important\s*)?(?=;|$)/i.test(block[1])) {
            labels += [...block[1].matchAll(/(?:^|;)\s*letter-spacing:\s*(?:0?\.1)em\s*(?:!important\s*)?(?=;|$)/gi)].length;
        }
    }
    if (labels) counts.label = labels;
    return counts;
}

export function newCopies(files: Record<string, Counts>, baseline: Record<string, Counts>): string[] {
    return Object.entries(files).flatMap(([file, counts]) => Object.entries(counts)
        .filter(([name, count]) => count > (baseline[file]?.[name] ?? 0))
        .map(([name, count]) => `${file}: ${name} ${baseline[file]?.[name] ?? 0} -> ${count}`));
}

function main(): void {
    const record = process.argv.includes('--record');
    const report = process.argv.includes('--report');
    const files: Record<string, Counts> = {};
    const patterns: Counts = {};
    let scanned = 0;
    for (const dir of ['public/css/views', 'public/css/components']) {
        for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isFile() || !entry.name.endsWith('.css') || entry.name === 'static-page.css') continue;
            scanned++;
            const file = `${dir}/${entry.name}`;
            const counts = countShapes(readFileSync(path.join(ROOT, file), 'utf8'));
            if (Object.keys(counts).length) files[file] = counts;
            for (const [name, count] of Object.entries(counts)) patterns[name] = (patterns[name] ?? 0) + count;
        }
    }
    const declarations = Object.values(patterns).reduce((sum, n) => sum + n, 0);
    if (record) {
        const baseline: Baseline = {
            _note: 'Copied design-language declarations, recorded debt rather than approval. This files map may only shrink. '
                + 'After migration, lower the affected counts or remove cleared files. '
                + 'Only an explicit developer decision permits re-seeding with pnpm check:poster-shapes --record.',
            _measured: { date: new Date().toISOString(), files: Object.keys(files).length, declarations, patterns },
            files,
        };
        writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
        console.log(`Recorded ${declarations} declarations in ${Object.keys(files).length} files.`);
    }
    if (!existsSync(BASELINE)) throw new Error('Poster-shape baseline missing. Seed only with the developer\'s decision.');
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    if (!baseline.files || typeof baseline.files !== 'object' || Array.isArray(baseline.files)) throw new Error('Invalid poster-shape baseline files map.');
    for (const counts of Object.values(baseline.files)) {
        if (!counts || typeof counts !== 'object' || Object.values(counts).some(n => !Number.isInteger(n) || n < 0)) {
            throw new Error('Invalid poster-shape baseline count.');
        }
    }
    const fresh = newCopies(files, baseline.files);
    console.log(`Poster shapes: ${scanned} sheets scanned; ${Object.keys(files).length} files, ${declarations} declarations, ${fresh.length} new file/pattern increases.`);
    console.log(Object.entries(patterns).map(([name, count]) => `${name}=${count}`).join(' '));
    if (report) for (const [file, counts] of Object.entries(files)) console.log(`${file}: ${JSON.stringify(counts)}`);
    if (!record && !report && fresh.length) {
        for (const finding of fresh) console.error(finding);
        console.error('Compose a class from public/css/poster.css; keep only the view layout in its sheet.');
        process.exitCode = 1;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
