/**
 * @file check-view-sheet-lines.ts
 * @description Ratchet for per-page CSS. Every signed-in page is composed from the one shared set
 *   (components/poster-parts.js, css/poster.css, css/parts.css), so a page sheet under
 *   public/css/views/ is migration debt: it may shrink or disappear, never grow, and a NEW sheet is
 *   refused unless the baseline's `exceptions` names it with the reason it cannot be a shared part.
 *   Lines are counted as the file has them, comments included, because a sheet that is only
 *   comments is still a sheet somebody keeps.
 * @usage pnpm check:view-sheet-lines [--report | --record]
 * @version-history
 *   v1.0.0 -- 2026-09-22 -- Initial (wish "Tyylit järkeen", brief section 8: the line ratchet).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'security/view-sheet-lines-baseline.json');
const DIR = 'public/css/views';

interface Baseline {
    _note: string;
    _measured: { date: string; files: number; lines: number };
    /** A sheet that may exist although no page should have one, with the reason. */
    exceptions: Record<string, string>;
    files: Record<string, number>;
}

/** Lines in a sheet as a person scrolling it sees them; a final newline does not add a line. */
export function lineCount(source: string): number {
    if (!source) return 0;
    return source.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

/** What grew or appeared since the baseline; an empty list passes. */
export function findGrowth(files: Record<string, number>, baseline: Baseline): string[] {
    const out: string[] = [];
    for (const [file, lines] of Object.entries(files)) {
        const was = baseline.files[file];
        if (was === undefined) {
            if (!baseline.exceptions?.[file]) out.push(`${file}: a new page sheet (${lines} lines)`);
        } else if (lines > was) {
            out.push(`${file}: ${was} -> ${lines} lines`);
        }
    }
    return out;
}

function main(): void {
    const record = process.argv.includes('--record');
    const report = process.argv.includes('--report');
    const files: Record<string, number> = {};
    for (const entry of readdirSync(path.join(ROOT, DIR), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
        files[`${DIR}/${entry.name}`] = lineCount(readFileSync(path.join(ROOT, DIR, entry.name), 'utf8'));
    }
    const total = Object.values(files).reduce((sum, n) => sum + n, 0);
    if (record) {
        const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline : null;
        const baseline: Baseline = {
            _note: 'Per-page stylesheets, recorded as debt rather than approval: every page is composed from the shared set, so this '
                + 'map may only shrink. Lower a count or remove a file as its page migrates. A new sheet needs an entry in exceptions '
                + 'with the reason it cannot be a shared part. Only an explicit developer decision permits pnpm check:view-sheet-lines --record.',
            _measured: { date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), files: Object.keys(files).length, lines: total },
            exceptions: previous?.exceptions ?? {},
            files,
        };
        writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
        console.log(`Recorded ${Object.keys(files).length} page sheets, ${total} lines.`);
    }
    if (!existsSync(BASELINE)) throw new Error('View-sheet line baseline missing. Seed only with the developer\'s decision.');
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    if (!baseline.files || typeof baseline.files !== 'object' || Object.values(baseline.files).some(n => !Number.isInteger(n) || n < 0)) {
        throw new Error('Invalid view-sheet line baseline.');
    }
    const growth = findGrowth(files, baseline);
    const recorded = Object.values(baseline.files).reduce((sum, n) => sum + n, 0);
    console.log(`Page sheets: ${Object.keys(files).length} sheets, ${total} lines (baseline ${Object.keys(baseline.files).length} sheets, ${recorded} lines); ${growth.length} grew or appeared.`);
    if (report) for (const [file, lines] of Object.entries(files).sort((a, b) => b[1] - a[1])) console.log(`${String(lines).padStart(6)}  ${file}`);
    if (!record && !report && growth.length) {
        for (const finding of growth) console.error(finding);
        console.error('Compose the page from components/poster-parts.js; a missing part goes into the shared set, not into a page sheet.');
        process.exitCode = 1;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
