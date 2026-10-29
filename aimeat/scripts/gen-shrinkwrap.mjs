#!/usr/bin/env node
/**
 * @file scripts/gen-shrinkwrap.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes aimeat/npm-shrinkwrap.json, the lock the published npm package carries, from
 *   pnpm-lock.yaml's production dependencies. `npx aimeat` and `npm install -g aimeat` then install
 *   exactly the versions pnpm-lock.yaml pins, each checked against pnpm's integrity hash, with every
 *   rule in pnpm.overrides applied (secaudit2026oct26, operator-01).
 *
 *   WHY. npm reads neither pnpm-lock.yaml nor the package.json `pnpm` block. Without a shrinkwrap the
 *   package resolved every range fresh at install time and applied none of the advisory overrides,
 *   while every pnpm path (CI, Docker, the checkout) installed the reviewed set.
 *
 *   HOW. Two package managers each do the part they own:
 *     1. pnpm installs the production dependencies from pnpm-lock.yaml (--frozen-lockfile, so the
 *        lock decides every version and the overrides apply) into a throwaway directory with the
 *        hoisted linker, which lays node_modules out the way npm does. No install script runs.
 *     2. npm reads that tree (`npm shrinkwrap`) and writes the lock in its own format, with each
 *        package's bin, engines and install-script flags taken from the package itself.
 *     3. This script adds each package's registry address and pnpm-lock.yaml's integrity, copies
 *        `gypfile: false` from a package that ships prebuilt binaries (npm reads a shrinkwrapped
 *        package's manifest from its entry and would otherwise run node-gyp), takes the
 *        removed dependencies out of their parents' entries (`cbor-x>cbor-extract: "-"`), and refuses
 *        to write the file unless it holds every override and resolves exactly as pnpm-lock.yaml does
 *        (scripts/lib/npm-shrinkwrap.mjs).
 *   The file is not tracked: prepublishOnly writes it before every publish, and pack-smoke refuses a
 *   tarball without it.
 * @usage
 *   pnpm gen:shrinkwrap            # write aimeat/npm-shrinkwrap.json
 *   pnpm check:shrinkwrap          # check the file already there against pnpm-lock.yaml and the overrides
 * @version-history
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, operator-01).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { entryName, npm, parseOverrides, pnpmProduction, shrinkwrapProblems, tarballUrl } from './lib/npm-shrinkwrap.mjs';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(AIMEAT, 'npm-shrinkwrap.json');
const CHECK = process.argv.includes('--check');

function fail(message) {
    console.error(`\n✖ gen-shrinkwrap: ${message}`);
    process.exit(1);
}

/** pnpm, which Windows finds only through a shell. The command line is a constant. */
function pnpmInstall(cwd) {
    const args = ['install', '--frozen-lockfile', '--prod', '--ignore-scripts', '--config.node-linker=hoisted', '--prefer-offline'];
    const r = process.platform === 'win32'
        ? spawnSync(`pnpm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
        : spawnSync('pnpm', args, { cwd, stdio: 'inherit' });
    if (r.status !== 0) fail(`pnpm ${args.join(' ')} failed in ${cwd} (exit ${r.status}).`);
}

function generate(pkg, lock) {
    const work = mkdtempSync(join(tmpdir(), 'aimeat-shrinkwrap-'));
    try {
        // The manifest without its scripts: nothing in it may run, and frozen-lockfile reads only the
        // dependency fields and the pnpm block, which stay as they are.
        const { scripts: _scripts, ...manifest } = pkg;
        writeFileSync(join(work, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        copyFileSync(join(AIMEAT, 'pnpm-lock.yaml'), join(work, 'pnpm-lock.yaml'));
        console.log('gen-shrinkwrap: pnpm installs the production dependencies from pnpm-lock.yaml (hoisted, no scripts)…');
        pnpmInstall(work);
        console.log('gen-shrinkwrap: npm writes its lock from that tree…');
        // Without the npm_config_* variables pnpm exports to a script it runs: npm reads them as its
        // own settings, and this step only reads the tree on disk.
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith('npm_config_')));
        npm(['shrinkwrap', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: work, stdio: ['ignore', 'inherit', 'inherit'], env });
        const shrinkwrap = JSON.parse(readFileSync(join(work, 'npm-shrinkwrap.json'), 'utf8'));

        const production = pnpmProduction(lock);
        for (const [path, e] of Object.entries(shrinkwrap.packages ?? {})) {
            if (!path) continue;
            const name = entryName(path, e);
            const pinned = production.get(`${name}@${e.version}`);
            if (!pinned) continue; // shrinkwrapProblems names it
            // An optional peer pnpm installed on its own and nothing else needs: npm leaves it out of
            // an install anyway (debug's supports-color), so the shrinkwrap does too.
            if (e.extraneous && pinned.optionalPeerOnly) { delete shrinkwrap.packages[path]; continue; }
            e.resolved = pinned.tarball ?? tarballUrl(name, e.version);
            e.integrity = pinned.integrity;
            // npm takes a shrinkwrapped package's manifest from its lock entry, which has no
            // `gypfile`, and runs `node-gyp rebuild` for any package with a binding.gyp unless
            // gypfile is false. better-sqlite3 ships prebuilt binaries and says gypfile: false, so the
            // entry carries that field from the package's own package.json; without it every
            // install would need Python and a C++ compiler.
            const manifest = JSON.parse(readFileSync(join(work, path, 'package.json'), 'utf8'));
            if (manifest.gypfile === false) e.gypfile = false;
            else if (existsSync(join(work, path, 'binding.gyp')) && !manifest.scripts?.install && !manifest.scripts?.preinstall) e.hasInstallScript = true;
        }
        // A removal override ("-") has no npm form: the parent's entry stops declaring the package,
        // so npm has no edge to fill from the registry.
        for (const rule of parseOverrides(pkg.pnpm?.overrides ?? {})) {
            if (rule.value !== '-' || !rule.parent) continue;
            for (const [path, e] of Object.entries(shrinkwrap.packages ?? {})) {
                if (!path || entryName(path, e) !== rule.parent.name) continue;
                for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
                    if (!e[field]) continue;
                    delete e[field][rule.target.name];
                    if (Object.keys(e[field]).length === 0) delete e[field];
                }
            }
        }
        return shrinkwrap;
    } finally {
        try { rmSync(work, { recursive: true, force: true }); } catch { console.warn(`gen-shrinkwrap: could not remove ${work}`); }
    }
}

function main() {
    const pkg = JSON.parse(readFileSync(join(AIMEAT, 'package.json'), 'utf8'));
    const lock = parseYaml(readFileSync(join(AIMEAT, 'pnpm-lock.yaml'), 'utf8'));
    if (CHECK && !existsSync(OUT)) fail('aimeat/npm-shrinkwrap.json does not exist. Run `pnpm gen:shrinkwrap`.');
    const shrinkwrap = CHECK ? JSON.parse(readFileSync(OUT, 'utf8')) : generate(pkg, lock);
    const problems = shrinkwrapProblems(shrinkwrap, pkg, lock);
    if (problems.length > 0) fail(`${CHECK ? 'aimeat/npm-shrinkwrap.json' : 'the generated shrinkwrap'} is not publishable:\n  ${problems.join('\n  ')}`);
    const entries = Object.entries(shrinkwrap.packages).filter(([p]) => p);
    const scripted = entries.filter(([, e]) => e.hasInstallScript).map(([p, e]) => `${entryName(p, e)}@${e.version}`);
    if (!CHECK) writeFileSync(OUT, `${JSON.stringify(shrinkwrap, null, 2)}\n`);
    console.log(`gen-shrinkwrap: ${CHECK ? 'checked' : 'wrote'} aimeat/npm-shrinkwrap.json: ${entries.length} packages, each the version pnpm-lock.yaml pins, with its integrity; every pnpm.overrides rule holds.`);
    console.log(`  packages with an install script npm runs: ${scripted.length ? scripted.join(', ') : 'none'}`);
    const prebuilt = entries.filter(([, e]) => e.gypfile === false).map(([p, e]) => `${entryName(p, e)}@${e.version}`);
    console.log(`  packages marked gypfile: false (prebuilt, no node-gyp): ${prebuilt.length ? prebuilt.join(', ') : 'none'}`);
}

main();
