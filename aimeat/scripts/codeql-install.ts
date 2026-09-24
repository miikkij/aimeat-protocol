/**
 * @file codeql-install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Puts the CodeQL CLI that CI uses where check:field-reach finds it, once per machine.
 *
 *   WHY IT EXISTS. check:field-reach needs CodeQL, and without it a workstation's `pnpm gate` could not
 *   see what CI would refuse. On 2026-09-16 the bundle was unpacked on the developer machine and
 *   pitfall 90 recorded an environment variable as naming it, but nothing set the variable: eight red
 *   CI periods followed in eight days, each a finding the machine could have shown before the push.
 *   An environment variable reaches only the shells started after it; the pointer this writes,
 *   `~/.aimeat/codeql.json`, is read by every process, worktree and session.
 *
 *   WHAT IT DOES, first match wins:
 *   1. `--from <codeql executable>`: registers a CLI already on disk, if its version is the pinned one.
 *   2. The pointer already names the pinned version: says so and stops.
 *   3. A `codeql` on CODEQL_CLI or PATH with the pinned version: registers it.
 *   4. Otherwise downloads the pinned bundle for this platform from github/codeql-action's release
 *      (about 660 MB), checks it against the release's own sha256, unpacks it under
 *      `~/.aimeat/tools/<tag>/` and registers it.
 *   The pin is CODEQL_BUNDLE in scripts/inventory/field-reach-facts.ts, the same release ci.yml uses.
 * @structure versionOf() · register() · download() · main()
 * @usage cd aimeat && pnpm codeql:install [--from <path to codeql executable>]
 *   (the download needs the GitHub CLI, signed in)
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { CODEQL_BUNDLE, CODEQL_POINTER } from './inventory/field-reach-facts.js';

const EXE = process.platform === 'win32' ? 'codeql.exe' : 'codeql';
const PLATFORM = process.platform === 'win32' ? 'win64'
    : process.platform === 'darwin' ? 'osx64'
    : process.arch === 'arm64' ? 'linux-arm64' : 'linux64';

/** The CLI's terse version, or null when it does not run. */
function versionOf(cli: string): string | null {
    try {
        return execFileSync(cli, ['version', '--format=terse'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

function register(cli: string): void {
    mkdirSync(dirname(CODEQL_POINTER), { recursive: true });
    writeFileSync(CODEQL_POINTER, JSON.stringify({ cli, version: CODEQL_BUNDLE.version }, null, 2) + '\n');
    console.log(`✓ CodeQL ${CODEQL_BUNDLE.version} registered: ${cli}`);
    console.log(`  (${CODEQL_POINTER}). pnpm gate now measures check:field-reach on this machine.`);
}

async function sha256(file: string): Promise<string> {
    const h = createHash('sha256');
    for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
    return h.digest('hex');
}

/** Download, verify and unpack the pinned bundle; returns the executable's path. */
async function download(): Promise<string> {
    const asset = `codeql-bundle-${PLATFORM}.tar.gz`;
    const target = join(homedir(), '.aimeat', 'tools', CODEQL_BUNDLE.tag);
    const tmp = mkdtempSync(join(tmpdir(), 'aimeat-codeql-'));
    try {
        console.log(`  downloading ${asset} from ${CODEQL_BUNDLE.tag} (about 660 MB)…`);
        execFileSync('gh', ['release', 'download', CODEQL_BUNDLE.tag, '--repo', 'github/codeql-action',
            '--pattern', asset, '--pattern', `${asset}.checksum.txt`, '--dir', tmp], { stdio: 'inherit' });
        const expected = readFileSync(join(tmp, `${asset}.checksum.txt`), 'utf-8').trim().split(/\s+/)[0].toLowerCase();
        const actual = await sha256(join(tmp, asset));
        if (actual !== expected) throw new Error(`${asset}: sha256 ${actual} is not the release's ${expected}`);
        console.log('  sha256 matches the release. Unpacking…');
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        // Windows' own bsdtar, not whichever tar a Git shell puts first on PATH: GNU tar reads `C:` as a host.
        const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
        execFileSync(tar, ['-xzf', join(tmp, asset), '-C', target], { stdio: 'inherit' });
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
    return join(target, 'codeql', EXE);
}

async function main(): Promise<void> {
    const want = CODEQL_BUNDLE.version;
    const fromArg = process.argv.indexOf('--from');
    if (fromArg >= 0) {
        // resolve() also folds the doubled backslashes pnpm hands a Windows path through as.
        const cli = process.argv[fromArg + 1] && resolve(process.argv[fromArg + 1]);
        const got = cli && existsSync(cli) ? versionOf(cli) : null;
        if (got !== want) {
            console.error(`✖ ${cli ?? '(no path)'} is ${got ? `CodeQL ${got}` : 'not a CodeQL CLI'}; check:field-reach is pinned to ${want}, the version CI measures with.`);
            process.exit(1);
        }
        register(cli);
        return;
    }

    if (existsSync(CODEQL_POINTER)) {
        try {
            const { cli } = JSON.parse(readFileSync(CODEQL_POINTER, 'utf-8')) as { cli?: string };
            if (cli && existsSync(cli) && versionOf(cli) === want) {
                console.log(`✓ CodeQL ${want} is already registered: ${cli}`);
                return;
            }
        } catch {
            console.log(`  ${CODEQL_POINTER} does not parse; installing again.`);
        }
    }

    const candidates = [process.env.CODEQL_CLI, ...(process.env.PATH ?? '').split(delimiter).map(d => d && join(d, EXE))];
    for (const cli of candidates) {
        if (cli && existsSync(cli) && versionOf(cli) === want) {
            register(cli);
            return;
        }
    }

    const cli = await download();
    const got = versionOf(cli);
    if (got !== want) {
        console.error(`✖ the unpacked ${cli} reports ${got ?? 'nothing'}, not ${want}.`);
        process.exit(1);
    }
    register(cli);
}

main().catch((err: unknown) => {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
