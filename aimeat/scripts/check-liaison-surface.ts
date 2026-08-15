/**
 * @file scripts/check-liaison-surface.ts
 * @description The two surfaces outside this node that name its tools, and the signal that they
 *   have to be republished.
 *
 *   WHY. `check:mcp-tools` already keeps the node's own MCP surface, the connector bridge and the
 *   CLI fallback in step with the catalog. Two things it does not see:
 *
 *     - THE LIAISON, `python/aimeat-crewai`, published to PyPI and maintained here. It names AIMEAT
 *       tools in Python source, and nothing checked that those names exist. A tool renamed or
 *       withdrawn on the node leaves the liaison calling something that is not there, and the
 *       failure surfaces in somebody's crew rather than in this build.
 *     - THE PUBLISHED VERSION. `aimeat connect serve` proxies the tool surface through the tunnel,
 *       and it ships inside the npm package. When the surface changes, the package on npm is stale
 *       until somebody publishes — and nothing said so. Same for the liaison on PyPI.
 *
 *   HOW THE SIGNAL WORKS. `security/published-surfaces.json` records, for each surface, the version
 *   that was published and a fingerprint of the tool names it carried. This check recomputes the
 *   fingerprint. If it moved and the version did not, the build fails and says which package needs
 *   publishing. Bumping the version and re-recording is the whole remedy, and re-recording is
 *   deliberate work: it is the moment somebody decides the change is worth a release.
 * @structure
 *   connectorTools() · liaisonTools() · fingerprint() · main(): report, and gate with --strict
 * @usage
 *   cd aimeat && pnpm check:liaison-surface            # report
 *   cd aimeat && pnpm check:liaison-surface --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:liaison-surface --record   # after publishing, write the new baseline
 * @version-history
 *   v1.1.0 — 2026-08-15 — Say when a release is STAGED but not out. A bumped version with a moved
 *     fingerprint satisfied neither failure condition, so the reminder vanished the moment somebody
 *     edited package.json and nothing mentioned it again. Reported every run, never fatal.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit: the surfaces the drift map could not see).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const REPO = join(ROOT, '..');
const BASELINE = join(ROOT, 'security', 'published-surfaces.json');
const LIAISON_DIR = join(REPO, 'python', 'aimeat-crewai');

interface Baseline {
    npm: { package: string; version: string; fingerprint: string; toolCount: number };
    pypi: { package: string; version: string; fingerprint: string; toolCount: number };
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        if (entry === '__pycache__' || entry === 'node_modules') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, ext, out);
        else if (entry.endsWith(ext)) out.push(full);
    }
    return out;
}

/** Every tool name the connector bridge and the CLI fallback know. This is what `connect serve`
 *  proxies through the tunnel, so a change here changes what a tunnelled client can call. */
function connectorTools(): string[] {
    const names = new Set<string>();
    for (const file of walk(join(ROOT, 'src', 'cli', 'connect'), '.ts')) {
        const src = readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        for (const m of src.matchAll(/['"`](aimeat_[a-z0-9_]+)['"`]/g)) names.add(m[1]);
    }
    return [...names].sort();
}

/**
 * Node tool names the liaison NAMES — in the prompts it writes for a crew, in its own docstrings,
 * anywhere the string ends up in front of a model.
 *
 * Two kinds are excluded because they are not this node's tools and never were:
 *   - names the liaison DEFINES with `@tool("...")`, which are local CrewAI tools running inside the
 *     crew's own process (`aimeat_offers_check`, `aimeat_offers_publish`)
 *   - ContextVar and similar internal identifiers, which only look like tool names
 *
 * What is left is the set that matters. The liaison does not call this node's tools by name — it
 * runs the CLI — so the risk is not a broken call but a lying prompt: a backstory telling an agent
 * to use a tool this node no longer registers, discovered in somebody else's terminal.
 */
function liaisonTools(): { named: string[]; ownTools: string[] } {
    const named = new Set<string>();
    const ownTools = new Set<string>();
    const internal = new Set<string>();
    for (const file of walk(join(LIAISON_DIR, 'src'), '.py')) {
        const src = readFileSync(file, 'utf-8');
        for (const m of src.matchAll(/@tool\(\s*['"](aimeat_[a-z0-9_]+)['"]/g)) ownTools.add(m[1]);
        for (const m of src.matchAll(/ContextVar\(\s*['"](aimeat_[a-z0-9_]+)['"]/g)) internal.add(m[1]);
        // A real tool name is aimeat_<domain>_<verb>, and it appears inside a string. Requiring two
        // segments and no trailing underscore keeps out Python identifiers (aimeat_home,
        // aimeat_runtime) and the truncated prefixes an f-string leaves behind ("aimeat_memory_").
        for (const m of src.matchAll(/['"](aimeat_[a-z0-9]+_[a-z0-9_]*[a-z0-9])['"]/g)) named.add(m[1]);
    }
    for (const n of ownTools) named.delete(n);
    for (const n of internal) named.delete(n);
    return { named: [...named].sort(), ownTools: [...ownTools].sort() };
}

/** Every tool the node itself registers, from the canonical annotation table. */
function nodeTools(): Set<string> {
    const src = readFileSync(join(ROOT, 'src', 'mcp', 'annotations.ts'), 'utf-8');
    const names = new Set<string>();
    for (const m of src.matchAll(/\b(aimeat_[a-z0-9_]+)\s*:/g)) names.add(m[1]);
    return names;
}

const fingerprint = (names: string[]): string =>
    createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 16);

function readVersion(file: string, re: RegExp): string {
    const m = readFileSync(file, 'utf-8').match(re);
    return m?.[1] ?? 'unknown';
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const record = process.argv.includes('--record');

    const connector = connectorTools();
    const { named: liaison, ownTools } = liaisonTools();
    const node = nodeTools();

    const npmVersion = readVersion(join(ROOT, 'package.json'), /"version"\s*:\s*"([^"]+)"/);
    const pypiVersion = existsSync(join(LIAISON_DIR, 'pyproject.toml'))
        ? readVersion(join(LIAISON_DIR, 'pyproject.toml'), /^version\s*=\s*"([^"]+)"/m)
        : 'missing';

    const now: Baseline = {
        npm: { package: 'aimeat', version: npmVersion, fingerprint: fingerprint(connector), toolCount: connector.length },
        pypi: { package: 'aimeat-crewai', version: pypiVersion, fingerprint: fingerprint(liaison), toolCount: liaison.length },
    };

    if (record) {
        writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
        console.log('recorded:', JSON.stringify(now, null, 2));
        return;
    }

    // A liaison naming a tool this node does not have is broken for every crew that uses it, and the
    // failure lands in somebody else's terminal. `aimeat_` on its own is a prefix in a f-string.
    const phantom = liaison.filter(n => n !== 'aimeat_' && !node.has(n)).sort();

    const base: Baseline | null = existsSync(BASELINE)
        ? JSON.parse(readFileSync(BASELINE, 'utf-8')) as Baseline
        : null;

    const problems: string[] = [];
    if (phantom.length) {
        problems.push(
            `The CrewAI liaison names ${phantom.length} tool(s) this node does not register: ${phantom.join(', ')}. `
            + 'Either the node withdrew them or the liaison misspelled them; both break a crew at run time.');
    }
    if (base) {
        if (base.npm.fingerprint !== now.npm.fingerprint && base.npm.version === now.npm.version) {
            problems.push(
                `The connector tool surface changed (${base.npm.toolCount} → ${now.npm.toolCount} tools) but `
                + `the npm package is still ${now.npm.version}. \`aimeat connect serve\` proxies this surface `
                + 'through the tunnel, so the published package is stale: bump the version, publish, then '
                + 'run `pnpm check:liaison-surface --record`.');
        }
        if (base.pypi.fingerprint !== now.pypi.fingerprint && base.pypi.version === now.pypi.version) {
            problems.push(
                `The liaison tool surface changed (${base.pypi.toolCount} → ${now.pypi.toolCount} tools) but `
                + `aimeat-crewai is still ${now.pypi.version}. Bump the version in pyproject.toml, publish to `
                + 'PyPI, then run `pnpm check:liaison-surface --record`.');
        }
    }

    console.log('');
    console.log('  Published surfaces that name this node\'s tools');
    console.log('  ' + '─'.repeat(62));
    console.log(`  connector (npm aimeat@${now.npm.version})        ${String(connector.length).padStart(4)} tools  ${now.npm.fingerprint}`);
    console.log(`  liaison   (pypi aimeat-crewai@${now.pypi.version})  ${String(liaison.length).padStart(4)} tools  ${now.pypi.fingerprint}`);
    console.log(`  this node registers                    ${String(node.size).padStart(4)} tools`);
    console.log(`  the liaison's own CrewAI tools         ${String(ownTools.length).padStart(4)}  ${ownTools.join(', ')}`);
    if (base) {
        console.log(`  baseline  npm@${base.npm.version} ${base.npm.fingerprint} · pypi@${base.pypi.version} ${base.pypi.fingerprint}`);
    } else {
        console.log('  baseline  none yet — run --record once to establish it');
    }
    // A version bumped but not yet published is invisible to the checks above: the fingerprint moved
    // AND the version moved, so neither condition fires, and the reminder disappears the moment
    // somebody edits package.json. That is the state this repo is in between deciding to release and
    // actually releasing, and it can last indefinitely with nothing saying so. It is NOT a failure —
    // blocking every commit until a publish happens would be worse than the drift — but it is said
    // out loud, every run, until the baseline catches up.
    const pending: string[] = [];
    if (base) {
        if (base.npm.fingerprint !== now.npm.fingerprint && base.npm.version !== now.npm.version) {
            pending.push(`npm aimeat@${now.npm.version} is staged (baseline records ${base.npm.version}, `
                + `${base.npm.toolCount} → ${now.npm.toolCount} tools)`);
        }
        if (base.pypi.fingerprint !== now.pypi.fingerprint && base.pypi.version !== now.pypi.version) {
            pending.push(`pypi aimeat-crewai@${now.pypi.version} is staged (baseline records ${base.pypi.version}, `
                + `${base.pypi.toolCount} → ${now.pypi.toolCount} tools)`);
        }
    }
    for (const p of pending) console.log(`  ⏳ ${p} — publish it, then \`pnpm check:liaison-surface --record\``);
    if (pending.length) console.log('');

    if (!problems.length) {
        console.log(pending.length
            ? '  ✓ no surface is out of step with an unbumped version — one release is still waiting to go out'
            : '  ✓ both published surfaces match what this node registers, and neither needs a release');
        return;
    }
    for (const p of problems) console.log('  ✖ ' + p + '\n');
    if (strict) {
        console.error(`✖ ${problems.length} problem(s) with a published surface.`);
        process.exit(1);
    }
    console.log('  (report only — pass --strict to gate)');
}

main();
