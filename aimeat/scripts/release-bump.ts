/**
 * @file scripts/release-bump.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One command for a node version bump: it writes the version into every file that
 *   carries it, regenerates the files built from it, and runs the checks that read it, so the bump
 *   commit leaves main green. It never commits; it ends with the list of files to commit, or with the
 *   names of the checks that failed.
 *
 *   WHY. Four of the fifteen red periods on main from 2026-09-21 started at a version-bump commit,
 *   26.4 hours red together, each one a different way: 3.20.0 (two unit tests that follow the
 *   release demanded its changes, 28 pushes), 3.22.0 (THIRD-PARTY-NOTICES.md edited by hand and an
 *   entry lost), 4.1.0 (a unit test read a fixed version) and 4.1.1 (the capability map not rebuilt).
 *   Each bump was done by hand in a different set of files (wish-one-release-bump-command-that-leaves-main-green).
 *
 *   WHAT IT DOES, in order, and it stops at the first step that fails:
 *   1. Refuses a version that is not x.y.z or not newer than aimeat/package.json's, and a carrier
 *      file with uncommitted changes (the bump commit must hold the bump only).
 *   2. Writes the version into package.json, aimeat/package.json, openapi.yaml (info.version) and
 *      server.json, which publish-mcp.yml compares with the tag.
 *   3. Runs `pnpm gen:notices` (both THIRD-PARTY-NOTICES.md files name the version) and
 *      `pnpm build:everything` (the capability map's stamp names it).
 *   4. Runs the unit tests that read the node version, chosen by what their text reads (see
 *      VERSION_READERS), and `pnpm check:fast`.
 *   `--all-units` runs the whole unit suite in step 4 instead of the chosen files.
 *
 *   A test that follows the release (a `*_REMOVED_IN` constant the new version reaches) fails in step
 *   4 by design: the removal it names is due, and doing it is part of the release, not of this script.
 * @structure setPackageVersion · setOpenapiVersion · setServerVersion · isNewer · VERSION_READERS ·
 *   versionReaders(files) · porcelainPaths(out) · main()
 * @usage
 *   pnpm release:bump 4.1.2              # from the repository root or aimeat/
 *   pnpm release:bump 4.2.0 --all-units
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-one-release-bump-command-that-leaves-main-green).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(AIMEAT, '..');

/** The files that carry the node version by hand, relative to the repository root. */
export const CARRIERS = ['package.json', 'aimeat/package.json', 'openapi.yaml', 'server.json'] as const;
/** The files the regenerating steps rewrite from the version. */
export const GENERATED = [
    'THIRD-PARTY-NOTICES.md', 'aimeat/public/THIRD-PARTY-NOTICES.md',
    'aimeat/public/data/everything.json', 'aimeat/public/data/everything-meta.json',
    'aimeat/public/data/everything.html', 'aimeat/public/data/everything.md',
] as const;

const SEMVER = /^\d+\.\d+\.\d+$/;

/** True when `next` is a newer x.y.z than `current`. */
export function isNewer(next: string, current: string): boolean {
    const a = next.split('.').map(Number);
    const b = current.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

function replaceOnce(text: string, re: RegExp, to: string, what: string): string {
    if (!re.test(text)) throw new Error(`${what}: the version line was not found`);
    return text.replace(re, to);
}

/** The top-level `"version"` of a package.json, the first one in the file, formatting kept. */
export function setPackageVersion(text: string, version: string): string {
    return replaceOnce(text, /("version"\s*:\s*")[^"]*(")/, `$1${version}$2`, 'package.json');
}

/** `info.version` in openapi.yaml: the first two-space `version:` line after `info:`. */
export function setOpenapiVersion(text: string, version: string): string {
    const info = text.search(/^info:\s*$/m);
    if (info < 0) throw new Error('openapi.yaml: no info: block');
    const head = text.slice(0, info);
    return head + replaceOnce(text.slice(info), /^( {2}version:[ \t]*)\S+/m, `$1${version}`, 'openapi.yaml');
}

/** The top-level `"version"` of server.json (the MCP registry manifest). */
export function setServerVersion(text: string, version: string): string {
    return replaceOnce(text, /("version"\s*:\s*")[^"]*(")/, `$1${version}$2`, 'server.json');
}

/**
 * What a unit test's text reads when it depends on the node version: the version helper, a
 * `*_REMOVED_IN` or `*_FROM` release constant, the test override of the version, or package.json.
 * Chosen by text rather than by a hand-kept list, because the list is what went stale before.
 */
export const VERSION_READERS = /getSoftwareVersion|softwareVersion|AIMEAT_TEST_SOFTWARE_VERSION|_REMOVED_IN\b|_BY_DEFAULT_IN\b|_PEER_FROM\b|package\.json/;

/** The unit test files (paths relative to aimeat/) whose text reads the node version. */
export function versionReaders(files: { path: string; text: string }[]): string[] {
    return files.filter(f => VERSION_READERS.test(f.text)).map(f => f.path).sort();
}

function unitTestFiles(): { path: string; text: string }[] {
    const dir = path.join(AIMEAT, 'test', 'unit');
    const out: { path: string; text: string }[] = [];
    const walk = (d: string): void => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith('.test.ts')) out.push({ path: path.relative(AIMEAT, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf-8') });
        }
    };
    walk(dir);
    return out;
}

function run(label: string, cmd: string, args: string[]): boolean {
    const line = [cmd, ...args].join(' ');
    console.log(`\n▶ ${label}: ${line}`);
    // Windows finds pnpm only through a shell, and a shell takes one command line (an argument list
    // beside shell: true is deprecated, DEP0190). Every argument here is a script name or a tracked
    // file path, none with a space or a shell character.
    const r = process.platform === 'win32'
        ? spawnSync(line, { cwd: AIMEAT, stdio: 'inherit', shell: true })
        : spawnSync(cmd, args, { cwd: AIMEAT, stdio: 'inherit' });
    return r.status === 0;
}

/** The paths `git status --porcelain` names, each line's two status columns and space removed. */
export function porcelainPaths(out: string): string[] {
    return out.split('\n').map(l => l.trimEnd()).filter(Boolean).map(l => l.slice(3));
}

function fail(lines: string[]): never {
    console.error('\n✖ release:bump stopped.');
    for (const l of lines) console.error(`  ${l}`);
    console.error('');
    process.exit(1);
}

function main(): void {
    const args = process.argv.slice(2);
    const version = args.find(a => !a.startsWith('--'));
    const allUnits = args.includes('--all-units');
    const current = (JSON.parse(readFileSync(path.join(AIMEAT, 'package.json'), 'utf-8')) as { version: string }).version;
    if (!version || !SEMVER.test(version)) fail([`Give the new version as x.y.z, e.g. pnpm release:bump ${current.replace(/\d+$/, n => String(Number(n) + 1))}.`]);
    if (!isNewer(version, current)) fail([`${version} is not newer than the node's ${current}.`]);

    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...CARRIERS, ...GENERATED], { cwd: REPO, encoding: 'utf-8' }).trim();
    if (dirty) fail(['These files have uncommitted changes; commit or discard them first, so the bump commit holds the bump only:', ...dirty.split('\n')]);

    const edits: Array<[string, (t: string, v: string) => string]> = [
        ['package.json', setPackageVersion], ['aimeat/package.json', setPackageVersion],
        ['openapi.yaml', setOpenapiVersion], ['server.json', setServerVersion],
    ];
    for (const [file, set] of edits) {
        const full = path.join(REPO, file);
        writeFileSync(full, set(readFileSync(full, 'utf-8'), version));
        console.log(`  ✓ ${file}: ${current} → ${version}`);
    }

    if (!run('Third-party notices', 'pnpm', ['gen:notices'])) fail(['pnpm gen:notices failed; its output is above.']);
    if (!run('Capability map', 'pnpm', ['build:everything'])) fail(['pnpm build:everything failed; its output is above.']);

    const readers = versionReaders(unitTestFiles());
    const failed: string[] = [];
    if (!run(allUnits ? 'Every unit test' : `The ${readers.length} unit test files that read the node version`, 'pnpm', ['exec', 'vitest', 'run', ...(allUnits ? [] : readers)])) {
        failed.push(allUnits ? 'the unit suite' : 'unit tests that read the node version (the failing names are above)');
    }
    if (!run('Read-only gates', 'pnpm', ['check:fast'])) failed.push('pnpm check:fast (the failing check is above)');
    if (failed.length) {
        fail([
            `The version files say ${version}, and these failed: ${failed.join('; ')}.`,
            'A test that follows the release names a removal the new version makes due; do the removal in',
            'the same commit. Nothing was committed. To go back: git checkout -- ' + [...CARRIERS, ...GENERATED].join(' '),
        ]);
    }

    const changed = porcelainPaths(execFileSync('git', ['status', '--porcelain', '--', ...CARRIERS, ...GENERATED], { cwd: REPO, encoding: 'utf-8' }));
    console.log(`\n✓ node ${version}: the version files, the notices and the capability map agree, and the checks that read the version are green.`);
    console.log('  Commit these files together, then run pnpm gate before the push:');
    for (const f of changed) console.log(`    ${f}`);
    console.log('');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
