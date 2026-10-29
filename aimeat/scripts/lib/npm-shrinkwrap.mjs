/**
 * @file scripts/lib/npm-shrinkwrap.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules the published npm package's dependency tree is held to, shared by
 *   scripts/gen-shrinkwrap.mjs (which writes aimeat/npm-shrinkwrap.json before a publish),
 *   scripts/pack-smoke.mjs (which installs the packed tarball and checks what npm installed) and
 *   test/unit/npm-shrinkwrap.test.ts.
 *
 *   WHY. npm reads neither pnpm-lock.yaml nor the package.json `pnpm` block, so `npx aimeat` and
 *   `npm install -g aimeat` resolved every dependency range fresh from the registry and applied none
 *   of the advisory overrides. A published npm-shrinkwrap.json is the one lock npm honours inside an
 *   installed package. These functions check that a lockfile-v3 `packages` map (the shrinkwrap, or
 *   the package-lock npm writes after installing the tarball) holds:
 *     overrideViolations()  every rule in pnpm.overrides, the removal `cbor-x>cbor-extract: "-"` included
 *     pnpmMismatches()      exactly the production set pnpm-lock.yaml pins, each with pnpm's integrity,
 *                           and each dependency resolving (Node's lookup upwards) to pnpm's version
 *   and npmOverridesFromPnpm() gives the npm `overrides` field that mirrors pnpm.overrides. npm()
 *   runs npm without a shell on every platform (moved here from pack-smoke.mjs).
 *
 *   The version ranges are a small semver subset (comparators, caret, tilde, x-ranges, `||`). A range
 *   outside it throws, so a new override written in another syntax fails loudly instead of passing.
 * @version-history
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, operator-01).
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const NPM_REGISTRY = 'https://registry.npmjs.org/';

// ── running npm ───────────────────────────────────────────────────────────────────────────────

/**
 * npm's own entry script on Windows, where `npm` is npm.cmd and Node starts a .cmd only through a
 * shell. The candidates are the two npm.cmd itself picks from: a global npm in the default prefix
 * (%APPDATA%\npm) first, then the npm installed beside node.exe.
 */
function npmCliOnWindows() {
    const candidates = [
        ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js')] : []),
        join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    const found = candidates.find(p => existsSync(p));
    if (!found) throw new Error(`npm-cli.js not found (looked in ${candidates.join(', ')}).`);
    return found;
}

/**
 * Run npm with an argument array and no shell, so a file name (the packed tarball, a temp path with
 * a space) is one argument and never part of a command line. On Windows that means node.exe running
 * npm-cli.js directly instead of npm.cmd.
 */
export function npm(args, opts) {
    if (process.platform !== 'win32') return execFileSync('npm', args, opts);
    return execFileSync(process.execPath, [npmCliOnWindows(), ...args], opts);
}

// ── versions and ranges ───────────────────────────────────────────────────────────────────────

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** @returns {{ major: number, minor: number, patch: number, pre: Array<string|number> } | null} */
export function parseVersion(text) {
    const m = VERSION.exec(String(text).trim());
    if (!m) return null;
    const pre = m[4] ? m[4].split('.').map(id => (/^\d+$/.test(id) ? Number(id) : id)) : [];
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

function comparePre(a, b) {
    if (a.length === 0 && b.length === 0) return 0;
    if (a.length === 0) return 1;
    if (b.length === 0) return -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === undefined) return -1;
        if (b[i] === undefined) return 1;
        if (a[i] === b[i]) continue;
        if (typeof a[i] === 'number' && typeof b[i] === 'number') return a[i] < b[i] ? -1 : 1;
        if (typeof a[i] === 'number') return -1;
        if (typeof b[i] === 'number') return 1;
        return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

export function compareVersions(a, b) {
    for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
    return comparePre(a.pre, b.pre);
}

const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/;
const isWild = p => p === undefined || p === 'x' || p === 'X' || p === '*';

/** One comparator: { op, v } with op one of >=, >, <=, <, =. */
function comparatorsFor(token) {
    const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token);
    const op = m[1] ?? '';
    const p = PARTIAL.exec(m[2]);
    if (!p) throw new Error(`npm-shrinkwrap: unsupported version range part "${token}"`);
    const [major, minor, patch, preText] = [p[1], p[2], p[3], p[4]];
    if (isWild(major)) {
        if (op === '' || op === '>=' || op === '=') return [];
        throw new Error(`npm-shrinkwrap: unsupported version range part "${token}"`);
    }
    const M = Number(major);
    const pre = preText ? parseVersion(`0.0.0-${preText}`).pre : [];
    const v = (a, b, c, pr = []) => ({ major: a, minor: b, patch: c, pre: pr });
    const floor = v(M, isWild(minor) ? 0 : Number(minor), isWild(patch) ? 0 : Number(patch), pre);
    const partial = isWild(minor) || isWild(patch);
    // The lowest version above a partial: 3 -> 4.0.0-0, 3.1 -> 3.2.0-0.
    const nextUp = () => (isWild(minor) ? v(M + 1, 0, 0, [0]) : v(M, Number(minor) + 1, 0, [0]));
    switch (op) {
        case '':
        case '=':
            return partial ? [{ op: '>=', v: floor }, { op: '<', v: nextUp() }] : [{ op: '=', v: floor }];
        case '>=': return [{ op: '>=', v: floor }];
        case '<': return [{ op: '<', v: partial ? v(floor.major, floor.minor, 0, [0]) : floor }];
        case '>': return partial ? [{ op: '>=', v: nextUp() }] : [{ op: '>', v: floor }];
        case '<=': return partial ? [{ op: '<', v: nextUp() }] : [{ op: '<=', v: floor }];
        case '~': return [{ op: '>=', v: floor }, { op: '<', v: isWild(minor) ? v(M + 1, 0, 0, [0]) : v(M, floor.minor + 1, 0, [0]) }];
        case '^': {
            let upper;
            if (M > 0 || isWild(minor)) upper = v(M + 1, 0, 0, [0]);
            else if (floor.minor > 0 || isWild(patch)) upper = v(0, floor.minor + 1, 0, [0]);
            else upper = v(0, 0, floor.patch + 1, [0]);
            return [{ op: '>=', v: floor }, { op: '<', v: upper }];
        }
        default: throw new Error(`npm-shrinkwrap: unsupported version range part "${token}"`);
    }
}

/** A range as OR-sets of AND-comparators. Throws on syntax outside the subset. */
export function parseRange(range) {
    return String(range).split('||').map(part => {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        if (tokens.some(t => t === '-')) throw new Error(`npm-shrinkwrap: hyphen ranges are not supported ("${range}")`);
        return tokens.flatMap(comparatorsFor);
    });
}

function test(cmp, ver) {
    const c = compareVersions(ver, cmp.v);
    switch (cmp.op) {
        case '>=': return c >= 0;
        case '>': return c > 0;
        case '<=': return c <= 0;
        case '<': return c < 0;
        default: return c === 0;
    }
}

/** semver.satisfies for the supported subset, prereleases included only on a comparator's own tuple. */
export function satisfies(version, range) {
    const ver = typeof version === 'string' ? parseVersion(version) : version;
    if (!ver) return false;
    return parseRange(range).some(set => {
        if (!set.every(c => test(c, ver))) return false;
        if (ver.pre.length === 0) return true;
        return set.some(c => c.v.pre.length > 0 && !(c.v.pre.length === 1 && c.v.pre[0] === 0)
            && c.v.major === ver.major && c.v.minor === ver.minor && c.v.patch === ver.patch);
    });
}

// ── override rules ────────────────────────────────────────────────────────────────────────────

/** "name@range" or "name" (scoped names keep their leading @). */
function parseSelector(text) {
    const at = text.indexOf('@', 1);
    if (at < 0) return { name: text, range: null };
    return { name: text.slice(0, at), range: text.slice(at + 1) };
}

/**
 * pnpm.overrides as rules. A key is "target" or "parent>target", each "name" or "name@range"; the `>`
 * of a range (">=1.0.0") is not a separator.
 */
export function parseOverrides(overrides) {
    return Object.entries(overrides ?? {}).map(([key, value]) => {
        const parts = key.split(/(?<=[^@\s<>=])>(?!=)/);
        if (parts.length > 2) throw new Error(`npm-shrinkwrap: override "${key}" names more than one parent`);
        if (typeof value !== 'string' || value.startsWith('$') || value.includes(':')) {
            throw new Error(`npm-shrinkwrap: override "${key}" has a value this check cannot read (${JSON.stringify(value)})`);
        }
        const target = parseSelector(parts.at(-1));
        const parent = parts.length === 2 ? parseSelector(parts[0]) : null;
        if (value !== '-') parseRange(value);
        if (target.range) parseRange(target.range);
        if (parent?.range) parseRange(parent.range);
        return { key, parent, target, value };
    });
}

/**
 * npm's `overrides` field for pnpm.overrides. A parent rule becomes npm's nested form; a removal ("-")
 * has no npm form and is returned in `skipped` with the reason, so the shrinkwrap carries it instead.
 */
export function npmOverridesFromPnpm(pnpmOverrides) {
    const out = {};
    const skipped = [];
    for (const rule of parseOverrides(pnpmOverrides)) {
        if (rule.value === '-') {
            skipped.push({ key: rule.key, reason: 'npm overrides cannot remove a dependency; the published npm-shrinkwrap.json leaves it out instead' });
            continue;
        }
        const targetKey = rule.target.range ? `${rule.target.name}@${rule.target.range}` : rule.target.name;
        if (!rule.parent) { out[targetKey] = rule.value; continue; }
        const parentKey = rule.parent.range ? `${rule.parent.name}@${rule.parent.range}` : rule.parent.name;
        if (typeof out[parentKey] === 'string') throw new Error(`npm-shrinkwrap: "${parentKey}" is both an override and a parent of one`);
        out[parentKey] = { ...(out[parentKey] ?? {}), [targetKey]: rule.value };
    }
    return { overrides: out, skipped };
}

// ── a lockfile-v3 packages map ────────────────────────────────────────────────────────────────

/** The package name an entry at this path installs (its `name` field wins, for an alias). */
export function entryName(path, entry) {
    if (entry?.name) return entry.name;
    const i = path.lastIndexOf('node_modules/');
    return path.slice(i + 'node_modules/'.length);
}

/** Node's lookup: the nearest node_modules/<name> from `fromPath` upwards, or null. */
export function resolveFrom(packages, fromPath, name) {
    let base = fromPath;
    for (;;) {
        const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
        if (packages[candidate]) return candidate;
        if (!base) return null;
        const i = base.lastIndexOf('/node_modules/');
        base = i < 0 ? '' : base.slice(0, i);
    }
}

function installed(packages) {
    return Object.entries(packages).filter(([path, e]) => path.includes('node_modules/') && !e.link);
}

function declares(entry, name) {
    return ['dependencies', 'optionalDependencies', 'peerDependencies'].some(f => entry?.[f] && Object.hasOwn(entry[f], name));
}

/** Every way the tree breaks a pnpm.overrides rule, as sentences. Empty when it holds them all. */
export function overrideViolations(packages, pnpmOverrides) {
    const problems = [];
    const entries = installed(packages);
    const outside = (rule, version) => {
        if (rule.value === '-') return false;
        if (rule.target.range && !satisfies(version, rule.target.range)) return false;
        return !satisfies(version, rule.value);
    };
    for (const rule of parseOverrides(pnpmOverrides)) {
        if (!rule.parent) {
            for (const [path, e] of entries) {
                if (entryName(path, e) !== rule.target.name) continue;
                if (rule.value === '-') problems.push(`${path} ${e.version} is installed; override "${rule.key}" removes it`);
                else if (outside(rule, e.version)) problems.push(`${path} is ${e.version}; override "${rule.key}" requires ${rule.value}`);
            }
            continue;
        }
        for (const [path, e] of entries) {
            if (entryName(path, e) !== rule.parent.name) continue;
            if (rule.parent.range && !satisfies(e.version, rule.parent.range)) continue;
            const found = resolveFrom(packages, path, rule.target.name);
            if (rule.value === '-') {
                if (declares(e, rule.target.name)) problems.push(`${path} still declares ${rule.target.name}; override "${rule.key}" removes it`);
                if (found) problems.push(`${path} reaches ${found} ${packages[found].version}; override "${rule.key}" removes it`);
                continue;
            }
            if (found && outside(rule, packages[found].version)) {
                problems.push(`${path} reaches ${found} ${packages[found].version}; override "${rule.key}" requires ${rule.value}`);
            }
        }
    }
    return problems;
}

/** The registry tarball address npm itself records for a registry package. */
export function tarballUrl(name, version) {
    return `${NPM_REGISTRY}${name}/-/${name.split('/').pop()}-${version}.tgz`;
}

/**
 * pnpm-lock.yaml's production closure: every "name@version" the importer's dependencies and
 * optionalDependencies reach, with its integrity and the dependencies pnpm resolved for each of its
 * snapshots (one per peer set).
 * @param {any} lock pnpm-lock.yaml, parsed (lockfileVersion 9)
 */
export function pnpmProduction(lock) {
    if (String(lock?.lockfileVersion) !== '9.0') throw new Error(`npm-shrinkwrap: pnpm-lock.yaml lockfileVersion ${lock?.lockfileVersion} is not 9.0`);
    const importer = lock.importers?.['.'];
    const depKey = (name, ref) => {
        if (/^(link|file|workspace):/.test(ref)) throw new Error(`npm-shrinkwrap: ${name} resolves to ${ref}, which a published package cannot carry`);
        return /^\d/.test(ref) ? `${name}@${ref}` : ref; // an alias is written "real-name@version"
    };
    const queue = [];
    for (const f of ['dependencies', 'optionalDependencies']) {
        for (const [name, d] of Object.entries(importer?.[f] ?? {})) queue.push(depKey(name, d.version));
    }
    const roots = [...queue];
    const baseOf = key => key.replace(/\(.*$/, '');
    const snapshots = new Map();
    while (queue.length) {
        const key = queue.shift();
        if (snapshots.has(key)) continue;
        const snap = lock.snapshots?.[key];
        if (!snap) throw new Error(`npm-shrinkwrap: pnpm-lock.yaml has no snapshot ${key}`);
        const meta = lock.packages?.[baseOf(key)] ?? {};
        const deps = {};
        const optionalPeers = new Set();
        const next = [];
        for (const f of ['dependencies', 'optionalDependencies']) {
            for (const [name, ref] of Object.entries(snap[f] ?? {})) {
                const k = depKey(name, ref);
                deps[name] = baseOf(k);
                if (meta.peerDependencies?.[name] !== undefined && meta.peerDependenciesMeta?.[name]?.optional) optionalPeers.add(name);
                next.push([name, k]);
                queue.push(k);
            }
        }
        snapshots.set(key, { deps, optionalPeers, next });
    }
    // What the tree needs without the optional peers pnpm installs on its own (autoInstallPeers).
    // npm installs an optional peer only when something else needs it, so these may be absent.
    const required = new Set();
    const walk = [...roots];
    while (walk.length) {
        const key = walk.shift();
        if (required.has(key)) continue;
        required.add(key);
        const s = snapshots.get(key);
        for (const [name, k] of s.next) if (!s.optionalPeers.has(name)) walk.push(k);
    }
    const packages = new Map();
    for (const [key, s] of snapshots) {
        const id = baseOf(key);
        const meta = lock.packages?.[id];
        if (!meta?.resolution?.integrity) throw new Error(`npm-shrinkwrap: pnpm-lock.yaml has no integrity for ${id}`);
        const at = id.lastIndexOf('@');
        const p = packages.get(id) ?? { name: id.slice(0, at), version: id.slice(at + 1), integrity: meta.resolution.integrity, tarball: meta.resolution.tarball ?? null, depSets: [], optionalPeerOnly: true };
        p.depSets.push({ deps: s.deps, optionalPeers: s.optionalPeers });
        if (required.has(key)) p.optionalPeerOnly = false;
        packages.set(id, p);
    }
    return packages;
}

/**
 * Every way the tree differs from pnpm-lock.yaml's production closure, as sentences: a package pnpm
 * does not pin, one it pins that is missing, an integrity that differs, or a dependency that Node's
 * lookup resolves to another version than pnpm chose for every snapshot of that package.
 * @param {Record<string, any>} packages a `packages` map rooted at the package ('' is aimeat itself)
 * @param {Map<string, any>} production pnpmProduction(lock)
 */
export function pnpmMismatches(packages, production) {
    const problems = [];
    const seen = new Set();
    for (const [path, e] of installed(packages)) {
        const id = `${entryName(path, e)}@${e.version}`;
        const pinned = production.get(id);
        if (!pinned) { problems.push(`${path} ${e.version} is not in pnpm-lock.yaml's production set`); continue; }
        seen.add(id);
        if (e.integrity && e.integrity !== pinned.integrity) problems.push(`${path} has integrity ${e.integrity}; pnpm-lock.yaml pins ${pinned.integrity}`);
        // One dependency is right when Node's lookup finds pnpm's version, or, for an optional peer
        // pnpm added on its own, finds nothing.
        const off = ({ deps, optionalPeers }) => Object.entries(deps).map(([name, want]) => {
            const found = resolveFrom(packages, path, name);
            const got = found ? `${entryName(found, packages[found])}@${packages[found].version}` : null;
            if (got === want || (got === null && optionalPeers.has(name))) return null;
            return `${name} -> ${got ?? '(nothing)'}, pnpm: ${want}`;
        }).filter(Boolean);
        if (!pinned.depSets.some(set => off(set).length === 0)) {
            problems.push(`${path} resolves its dependencies differently from pnpm-lock.yaml: ${off(pinned.depSets[0]).join('; ') || 'peer set differs'}`);
        }
    }
    for (const [id, p] of production) {
        if (!seen.has(id) && !p.optionalPeerOnly) problems.push(`${id} is in pnpm-lock.yaml's production set and missing from the tree`);
    }
    return problems;
}

/**
 * Everything wrong with a shrinkwrap for this package, as sentences. Empty when it may be published.
 * @param {any} shrinkwrap npm-shrinkwrap.json, parsed
 * @param {any} pkg aimeat/package.json, parsed
 * @param {any} lock pnpm-lock.yaml, parsed
 */
export function shrinkwrapProblems(shrinkwrap, pkg, lock) {
    const problems = [];
    if (shrinkwrap?.lockfileVersion !== 3) problems.push(`lockfileVersion is ${shrinkwrap?.lockfileVersion}; npm 7 and later write 3`);
    const root = shrinkwrap?.packages?.[''];
    if (root?.name !== pkg.name || root?.version !== pkg.version) problems.push(`its root entry is ${root?.name}@${root?.version}; package.json is ${pkg.name}@${pkg.version}`);
    const packages = shrinkwrap?.packages ?? {};
    for (const [path, e] of installed(packages)) {
        if (!e.resolved || !e.integrity) problems.push(`${path} has no ${e.resolved ? 'integrity' : 'resolved address'}`);
        if (e.extraneous) problems.push(`${path} is extraneous: nothing in the production tree depends on it`);
        if (e.dev) problems.push(`${path} is a development dependency`);
    }
    problems.push(...pnpmMismatches(packages, pnpmProduction(lock)));
    problems.push(...overrideViolations(packages, pkg.pnpm?.overrides ?? {}));
    return problems;
}
