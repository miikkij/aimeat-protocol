#!/usr/bin/env node
/**
 * @file scripts/check-no-nul.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a raw NUL byte (0x00) in a tracked source text file under aimeat/src,
 *   aimeat/test, aimeat/scripts and aimeat/public.
 *
 *   WHY. GNU grep treats any file holding a NUL as binary: it prints `Binary file X matches`, exits 0
 *   and prints no line, so the hit falls out of every pipeline that reads `path:line:text`. A
 *   dead-code inventory built that way (2026-09-09) listed seven live storage methods as having no
 *   caller, because the four files calling them joined a composite key on a NUL written into the
 *   source as the byte itself. Seventeen source files were in that state on 2026-11-21. A NUL
 *   delimiter is a fine choice for a key; written as the escape sequence backslash-zero it is the
 *   same string at run time and the file stays text for every tool that opens it.
 * @structure trackedTextFiles() · main
 * @usage pnpm check:no-nul   (in check:fast, so pnpm gate and CI)
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial; replaces docs/pitfalls.md §69.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'test', 'scripts', 'public'];
/** Source text: what grep, an editor or a reviewer reads as lines. Images, fonts and fixtures in binary formats are not. */
const TEXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx|css|html|htm|json|md|txt|ya?ml|sql|sh|py|svg|xml|csv)$/i;

function trackedTextFiles() {
    const out = execFileSync('git', ['ls-files', '-z', '--', ...DIRS], { cwd: AIMEAT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(f => f && TEXT.test(f));
}

const offenders = [];
let read = 0;
for (const file of trackedTextFiles()) {
    let bytes;
    try { bytes = readFileSync(join(AIMEAT, file)); } catch { continue; } // tracked but deleted in the working tree
    read++;
    let at = bytes.indexOf(0);
    if (at < 0) continue;
    const lines = new Set();
    while (at >= 0) {
        let line = 1;
        for (let i = 0; i < at; i++) if (bytes[i] === 0x0a) line++;
        lines.add(line);
        at = bytes.indexOf(0, at + 1);
    }
    offenders.push(`aimeat/${file}:${[...lines].join(',')}`);
}

if (offenders.length) {
    console.error(`\n✖ ${offenders.length} source file(s) hold a raw NUL byte:\n`);
    for (const o of offenders) console.error(`  ${o}`);
    console.error([
        '',
        '  grep calls such a file binary: it prints "Binary file X matches" with no line and exits 0, so every',
        '  search pipeline that reads path:line:text drops the hit. A dead-code inventory once listed seven live',
        '  methods as uncalled this way. Write the delimiter as the escape sequence \\0 (or \\u0000) inside the',
        '  string; the run-time value is the same, and a hash built from it does not change.',
        '  To search a tree that may still hold one: grep -a / rg -a, and confirm a deletion with the compiler.',
        '',
    ].join('\n'));
    process.exit(1);
}
console.log(`✓ no raw NUL byte in ${read} tracked source text file(s) (${DIRS.join(', ')})`);
