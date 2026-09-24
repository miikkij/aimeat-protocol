/**
 * @file check-supply-chain.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Code this repository did not write runs only from bytes the repository pinned, and never
 *   beside a secret or a token that can write. The gate reads the three places that fetch and run
 *   such code: every CI workflow (.github/workflows/*.yml), the local decision models
 *   (tools/systemone/: their images, compose files, Windows installer, README and measuring script),
 *   and the scripts the desktop app ships to run on the person's machine
 *   (aimeat-desktop/src-tauri/resources/, without the staged server/ and licenses/).
 *
 *   Everywhere, pipe-to-shell refuses a script fetched and piped straight into a shell
 *   (`irm … | iex`, `curl … | sh`), which no checksum can stand between.
 *
 *   A workflow is refused for
 *     checkout-credentials  an actions/checkout step without `persist-credentials: false`, which
 *                           leaves the job's token in .git/config for every later step;
 *     secret-in-run         `${{ secrets.X }}` inside a run script, where the value becomes part of the
 *                           script's text; a secret goes through the step's env and is read as "$X";
 *     write-and-deps        a job that holds a write permission (its own, else the workflow's, else
 *                           the repository default, which can write) and runs dependency code;
 *     secret-and-deps       a job that reads a secret and runs dependency code;
 *     unverified-download   an executable or archive fetched with curl, wget, Invoke-WebRequest or
 *                           gh release download in a step that does not check its sha256 against a
 *                           literal written in the same step (one literal per download);
 *     latest-release        a `releases/latest` address in a run script or an action input;
 *     pip-unpinned          in any step, whatever the job holds, the pip rules below and a
 *                           `python -m build` that fills its isolated environment from PyPI;
 *     git-unpinned          in any step, a git+ address without @<commit>.
 *   Dependency code is DEPENDENCY_CODE: the package managers, builds and test runners these
 *   workflows run, each of which executes code from the dependency tree.
 *
 *   A file under tools/systemone/ or the desktop resources is refused for
 *     weights-revision      a snapshot_download or hf_hub_download call without revision= naming a
 *                           commit (a 40-character literal, or a name the code sets);
 *     pip-unpinned          a pip install of a package without ==, of a requirements file without
 *                           --require-hashes, or of a variable this gate cannot read; a local
 *                           source (the checkout) without --no-deps --no-build-isolation;
 *     git-unpinned          a git clone in a file that checks out no fixed commit, or a git+ address
 *                           without @<commit>;
 *     unverified-download   an address of a release asset, archive, program or script in a file
 *                           that does not compute a sha256 and hold one literal per such address;
 *     latest-release        a `releases/latest` address.
 *   A file under tools/systemone/ is also refused for
 *     model-key             a fixed or empty key for a model whose server takes one (KEYED_MODELS),
 *                           in code, in a compose file and in the commands the README hands out.
 *
 *   A job that truly needs a write permission and dependency code together goes in
 *   WRITE_JOB_EXEMPTIONS with its reason, and a file that must break a file rule goes in
 *   FILE_EXEMPTIONS the same way. The first is empty and the second has one entry, the desktop's
 *   clone of the project's own fleet repository; adding to either is a decision.
 * @structure workflowFindings(file, text) · commandFindings(file, text) · modelFindings(file, text)
 *   · composeFindings(file, text) · main() reads the three trees and prints `file:line  rule  what to do`
 * @usage cd aimeat && pnpm check:supply-chain
 * @version-history
 *   v1.1.0 — 2026-09-24 — The pip rules hold in every workflow step, whatever the job holds, with a
 *     build's isolated environment and a local install's dependencies counted as pip installs.
 *   v1.0.0 — 2026-09-24 — Initial. The release, MCP publish, scanner, CodeQL, semantic audit and
 *     nightly-sweep workflows, the model installer and the desktop's uv install were brought into
 *     line in the same change.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = '.github/workflows';
const MODEL_DIR = 'tools/systemone';
const DESKTOP_DIR = 'aimeat-desktop/src-tauri/resources';
/**
 * Gitignored working folders, never read: under MODEL_DIR the weights, virtual environments and
 * measurements; under DESKTOP_DIR the server and licences `pnpm stage` copies in.
 */
const MODEL_SKIP = new Set(['.runtime', 'results', 'node_modules', '.git', '__pycache__']);
const DESKTOP_SKIP = new Set(['server', 'licenses', 'node_modules', '.git']);

export interface Finding { file: string; line: number; rule: string; fix: string }

/**
 * Jobs allowed to hold a write permission while they run dependency code, `<workflow file>#<job id>`
 * with the reason. Empty. The case expected here, `id-token: write` for PyPI trusted publishing in
 * publish-aimeat-crewai.yml, needs no entry: that workflow builds in one job and publishes in
 * another, and the publishing job only downloads the built files and runs the publishing action.
 */
export const WRITE_JOB_EXEMPTIONS: Readonly<Record<string, string>> = {};

/** File rules a file may break, `<file>#<rule>` with the reason. An entry nothing matches is refused. */
export const FILE_EXEMPTIONS: Readonly<Record<string, string>> = {
    'aimeat-desktop/src-tauri/resources/agent-runtime/provision.mjs#git-unpinned':
        'The clone is crewaimeat, this project\'s own fleet repository (miikkij/crewaimeat unless AIMEAT_CREWAIMEAT_REPO names another), '
        + 'which provision.mjs follows at main on purpose: every run fetches main again, so the fleet changes without a desktop release. '
        + 'Pinning it to a commit is a product decision, not taken here.',
};

/**
 * The key each model's server reads, from its own source at the version this repository pins:
 * jeff's JEFF_API_KEYS (src/jeff/server/config.py at the pinned commit), laya 0.3.11's LAYA_API_KEY
 * (laya/serve.py) and von-sdk 1.1.1's VON_API_KEY (von/server.py). Each refuses a decision call
 * without the bearer once its variable is set.
 */
export const KEYED_MODELS: Readonly<Record<string, string>> = {
    jeff: 'JEFF_API_KEYS',
    laya: 'LAYA_API_KEY',
    von: 'VON_API_KEY',
};

/** What runs code from the dependency tree, as these workflows spell it. */
const DEPENDENCY_CODE: readonly { re: RegExp; what: string }[] = [
    // install, build, stage, tauri, test, lint, check:*, audit: every pnpm script runs the tree.
    { re: /\bpnpm\s+(?!-v\b|--version\b)[\w:.-]+/, what: 'pnpm' },
    { re: /\bnpm\s+(?:ci|install|i|exec|run|run-script|test|rebuild)\b/, what: 'npm' },
    { re: /\b(?:npx|pnpx|yarn|bunx?)\s/, what: 'npx' },
    { re: /\b(?:pip3?|python3?\s+-m\s+pip)\s+install\b/, what: 'pip install' },
    { re: /\bpython3?\s+-m\s+(?:build|pytest)\b/, what: 'python -m build / pytest' },
    { re: /\b(?:uv\s+(?:sync|run|pip|tool)|uvx|pipx|poetry\s+install)\b/, what: 'uv' },
    { re: /\bcargo\s+(?:build|test|run|install|check|clippy|tauri)\b/, what: 'cargo' },
    { re: /\btauri\s+build\b/, what: 'tauri build' },
];

const DOWNLOADER = /\b(?:curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b|\bgh\s+release\s+download\b/i;
const ARCHIVE_OR_EXE = /\.(?:tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2?|tar\.zst|tzst|zip|7z|gz|xz|zst|bz2|exe|msi|msix|deb|rpm|apk|dmg|pkg|appimage|whl|jar|bin|sh|ps1)$/i;
const SHA256_CHECK = /\bsha256sum\b|\bshasum\s+-a\s*256\b|\bGet-FileHash\b|\bcreateHash\(\s*['"]sha256['"]|\bhashlib\.sha256\b/i;
const SHA256_LITERAL = /\b[0-9a-f]{64}\b/gi;
const SECRET_REF = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)/g;
/** A script fetched and handed straight to a shell or an interpreter, in either direction of writing it. */
const PIPE_TO_SHELL = /\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest|curl|wget)\b[^|\n]*\|\s*(?:iex|Invoke-Expression|sh|bash|zsh|pwsh|powershell|python3?)\b|\b(?:iex|Invoke-Expression)\b[^\n]*\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest|DownloadString)\b/i;

/** The addresses in a line that name a release asset, an archive, a program or a script. */
function artifactUrls(line: string): string[] {
    return (line.match(/https?:\/\/[^\s"'`)]+/g) ?? []).filter(u => {
        const bare = u.split(/[?#]/)[0];
        return /\/releases\/(?:download|latest)\//.test(bare) || ARCHIVE_OR_EXE.test(bare);
    });
}

// ── shared helpers ────────────────────────────────────────────────────────────────────────────

/** A mapping's value node by key (scalars kept as nodes, so they carry their range). */
function child(node: unknown, key: string): unknown {
    return isMap(node) ? node.get(key, true) : undefined;
}

/** A node's plain value: a scalar's value, a collection as JSON, undefined for nothing. */
function valueOf(node: unknown): unknown {
    if (node === undefined || node === null) return undefined;
    if (isScalar(node)) return node.value;
    if (isMap(node) || isSeq(node)) return node.toJSON();
    return node;
}

/** The 1-based line a node starts on. */
function lineOf(node: unknown, lc: LineCounter): number {
    const range = (node as { range?: [number, number, number] | null } | undefined)?.range;
    return range ? lc.linePos(range[0]).line : 1;
}

interface Line { n: number; text: string }
/** One command as the shell reads it, and where each of its physical lines starts in `text`. */
interface Command extends Line { segments: { at: number; n: number }[] }

/**
 * Commands as the shell reads them: a line that ends in a continuation (`\` in sh, a backtick in
 * PowerShell) is joined to the next. `continuation` says which of the two the file's shell uses.
 */
function commands(lines: Line[], continuation: RegExp): Command[] {
    const out: Command[] = [];
    let open: Command | null = null;
    for (const l of lines) {
        const trimmed = l.text.replace(/\s+$/, '');
        const continues = continuation.test(trimmed);
        const body = continues ? trimmed.slice(0, -1) : trimmed;
        if (open) {
            open.segments.push({ at: open.text.length + 1, n: l.n });
            open.text = `${open.text} ${body.trim()}`;
        } else {
            open = { n: l.n, text: body, segments: [{ at: 0, n: l.n }] };
        }
        if (!continues) { out.push(open); open = null; }
    }
    if (open) out.push(open);
    return out;
}

/** The physical line a position in a joined command falls on. */
function lineAt(c: Command, index: number): number {
    let n = c.n;
    for (const s of c.segments) if (s.at <= index) n = s.n;
    return n;
}

const SH_CONTINUATION = /\\$/;
const PS_CONTINUATION = /`$/;
const ANY_CONTINUATION = /[\\`]$/;

const isShellComment = (text: string): boolean => /^\s*#/.test(text);

// ── workflows ─────────────────────────────────────────────────────────────────────────────────

/** Which write grants a permissions value carries; null when the value is not declared at all. */
function writeGrants(perm: unknown): string[] | null {
    if (perm === undefined) return null;
    if (perm === 'write-all') return ['write-all'];
    if (perm && typeof perm === 'object') {
        return Object.entries(perm as Record<string, unknown>).filter(([, v]) => v === 'write').map(([k]) => `${k}: write`);
    }
    return [];
}

/** Is this command a download of something that will be run or unpacked? */
function isArtifactDownload(command: string): boolean {
    if (/\bgh\s+release\s+download\b/i.test(command)) return true;
    if (/\/releases\/(?:download|latest)\//.test(command)) return true;
    for (const url of command.match(/https?:\/\/[^\s"'`)]+/g) ?? []) {
        if (URL.canParse(url) && ARCHIVE_OR_EXE.test(new URL(url).pathname)) return true;
    }
    if (/\|\s*(?:sudo\s+)?(?:tar|sh|bash|zsh|unzip|python3?|pwsh|powershell|iex|Invoke-Expression)\b/i.test(command)) return true;
    const out = /(?:\s-o\s+|\s-O\s+|\s--output\s+|\s-OutFile\s+)(["']?)([^\s"']+)\1/.exec(command);
    return !!out && ARCHIVE_OR_EXE.test(out[2]);
}

interface RunBlock { lines: Line[] }

/** The file lines a `run:` scalar covers, first line included (it carries the `run:` key). */
function runBlock(node: unknown, lc: LineCounter, fileLines: string[]): RunBlock | null {
    if (!isScalar(node) || !node.range) return null;
    const first = lc.linePos(node.range[0]).line;
    const last = lc.linePos(Math.max(node.range[0], node.range[1] - 1)).line;
    const lines: Line[] = [];
    for (let n = first; n <= last; n++) lines.push({ n, text: fileLines[n - 1] ?? '' });
    return { lines };
}

/** Every string value inside an action's `with:` inputs, with the line it sits on. */
function withValues(node: unknown, lc: LineCounter): Line[] {
    if (!isMap(node)) return [];
    const out: Line[] = [];
    for (const pair of node.items) {
        if (isScalar(pair.value) && typeof pair.value.value === 'string') out.push({ n: lineOf(pair.value, lc), text: pair.value.value });
    }
    return out;
}

/** Everything wrong with one workflow file. */
export function workflowFindings(file: string, text: string): Finding[] {
    const out: Finding[] = [];
    const lc = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lc });
    if (doc.errors.length) {
        out.push({ file, line: 1, rule: 'unparsed', fix: `the workflow does not parse (${doc.errors[0].message.split('\n')[0]}); fix it so this gate can read it` });
        return out;
    }
    const fileLines = text.split(/\r?\n/);
    const root = doc.contents;
    const topPermissions = valueOf(child(root, 'permissions'));
    const topEnv = child(root, 'env');
    const topSecrets = topEnv && isMap(topEnv) && topEnv.range
        ? [...text.slice(topEnv.range[0], topEnv.range[2]).matchAll(SECRET_REF)].map(m => m[1]).filter(s => s !== 'GITHUB_TOKEN')
        : [];
    const jobs = child(root, 'jobs');
    if (!isMap(jobs)) return out;

    for (const pair of jobs.items) {
        const jobId = String(valueOf(pair.key));
        const job = pair.value;
        const steps = child(job, 'steps');
        if (!isSeq(steps)) continue; // a job that calls a reusable workflow has no steps of its own
        let deps: { what: string; line: number } | null = null;

        for (const step of steps.items) {
            const usesNode = child(step, 'uses');
            const uses = valueOf(usesNode);
            if (typeof uses === 'string' && /^actions\/checkout@/.test(uses)) {
                const persist = valueOf(child(child(step, 'with'), 'persist-credentials'));
                if (persist !== false && persist !== 'false') {
                    out.push({ file, line: lineOf(usesNode, lc), rule: 'checkout-credentials', fix: `job "${jobId}": add \`with: persist-credentials: false\` to this checkout` });
                }
            }
            for (const w of withValues(child(step, 'with'), lc)) {
                if (w.text.includes('releases/latest')) out.push({ file, line: w.n, rule: 'latest-release', fix: `job "${jobId}": name a fixed release instead of releases/latest` });
            }

            const block = runBlock(child(step, 'run'), lc, fileLines);
            if (!block) continue;
            for (const l of block.lines) {
                if (/\$\{\{\s*secrets\./.test(l.text)) {
                    out.push({ file, line: l.n, rule: 'secret-in-run', fix: `job "${jobId}": pass the secret through the step's env: and read it as "$NAME" in the script` });
                }
            }
            // A step's shell is bash or pwsh, so either continuation joins a command here.
            const code = commands(block.lines.filter(l => !isShellComment(l.text)), ANY_CONTINUATION);
            for (const l of code) {
                for (const d of DEPENDENCY_CODE) {
                    const m = d.re.exec(l.text);
                    if (m && !deps) deps = { what: d.what, line: lineAt(l, m.index) };
                }
            }
            const downloads = code.filter(l => DOWNLOADER.test(l.text) && isArtifactDownload(l.text));
            const stepText = code.map(l => l.text).join('\n');
            const literals = new Set((stepText.match(SHA256_LITERAL) ?? []).map(h => h.toLowerCase()));
            if (downloads.length && (!SHA256_CHECK.test(stepText) || literals.size < downloads.length)) {
                for (const d of downloads) {
                    out.push({ file, line: lineAt(d, Math.max(0, d.text.search(DOWNLOADER))), rule: 'unverified-download', fix: `job "${jobId}": check the file in this step, e.g. echo "<sha256>  <file>" | sha256sum -c - (Get-FileHash in PowerShell), with the sha256 from the project's own checksum file for that version` });
                }
            }
            for (const l of code) {
                const at = l.text.indexOf('releases/latest');
                if (at >= 0) out.push({ file, line: lineAt(l, at), rule: 'latest-release', fix: `job "${jobId}": download a fixed release and check its sha256; releases/latest is whatever was published last` });
                const pipe = PIPE_TO_SHELL.exec(l.text);
                if (pipe) out.push({ file, line: lineAt(l, pipe.index), rule: 'pipe-to-shell', fix: `job "${jobId}": download the script or program to a file, check its sha256, then run the file` });
                // Whatever the job holds: a read-only job's install still decides what its output is.
                out.push(...installFindings(file, l).map(f => ({ ...f, fix: `job "${jobId}": ${f.fix}` })));
            }
        }

        if (!deps) continue;
        const own = valueOf(child(job, 'permissions'));
        const grants = writeGrants(own) ?? writeGrants(topPermissions) ?? ['the repository default token (no permissions declared)'];
        const exempt = WRITE_JOB_EXEMPTIONS[`${path.posix.basename(file)}#${jobId}`];
        if (grants.length && !exempt) {
            out.push({ file, line: deps.line, rule: 'write-and-deps', fix: `job "${jobId}" holds ${grants.join(', ')} and runs ${deps.what}: move the writing part into a job of its own that runs no dependency code` });
        }
        const jobNode = job as { range?: [number, number, number] | null };
        const jobText = jobNode.range ? text.slice(jobNode.range[0], jobNode.range[2]) : '';
        const secrets = [...new Set([...topSecrets, ...[...jobText.matchAll(SECRET_REF)].map(m => m[1]).filter(s => s !== 'GITHUB_TOKEN')])];
        if (secrets.length) {
            out.push({ file, line: deps.line, rule: 'secret-and-deps', fix: `job "${jobId}" reads ${secrets.map(s => `secrets.${s}`).join(', ')} and runs ${deps.what}: use the secret in a job of its own that runs no dependency code` });
        }
    }
    return out;
}

// ── tools/systemone ──────────────────────────────────────────────────────────────────────────

/** pip install options that take a value as the next word. */
const PIP_VALUE_OPTIONS = new Set([
    '-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-i', '--index-url', '--extra-index-url',
    '-f', '--find-links', '-t', '--target', '--prefix', '--root', '--src', '--upgrade-strategy', '--python-version',
    '--platform', '--implementation', '--abi', '--progress-bar', '--cache-dir', '--log', '--proxy', '--retries',
    '--timeout', '--exists-action', '--trusted-host', '--cert', '--client-cert', '--no-binary', '--only-binary',
    '--config-settings', '-C', '--global-option', '--report', '--python',
]);
const COMMAND_END = new Set(['&&', '||', ';', '|', '}', ')', '{']);
const COMMIT = /^[0-9a-f]{40}$/;
const CHECKOUT_COMMIT = /\bcheckout\s+(?:-{1,2}[\w-]+\s+)*[0-9a-f]{40}\b/;
// A script starts git with an argument list, not a command line: run('git', ['clone', …]).
const SCRIPT_CLONE = /['"`]git['"`]\s*,\s*\[\s*['"`]clone['"`]/;
const SCRIPT_CHECKOUT_COMMIT = /['"`]checkout['"`][^\n]*['"`][0-9a-f]{40}['"`]/;
const GIT_URL = /\bgit\+(?:https?|ssh|file):\/\/[^\s'"]+/g;

/** What is wrong with the value after a key variable's `=` or `:`, if anything. */
function keyValueProblem(sep: string, rest: string): 'empty' | 'fixed' | null {
    const q = rest[0];
    if (q === '"' || q === "'") {
        const end = rest.indexOf(q, 1);
        const v = end < 0 ? rest.slice(1) : rest.slice(1, end);
        if (v === '') return 'empty';
        return /^[$<%{(]/.test(v) ? null : 'fixed';
    }
    const v = rest.split(/\s/)[0] ?? '';
    if (v === '') return sep === '=' ? 'empty' : null; // `NAME:` alone opens a YAML mapping
    return /^[$<%{(]/.test(v) ? null : 'fixed';
}

/** A path to local source (the checkout itself), not a package from an index. */
const LOCAL_SOURCE = /^(?:\.{1,2}(?:[\\/].*)?|[\\/].+|[A-Za-z]:[\\/].*)$/;
/** `python -m build` in its default isolated mode, which fills its environment from PyPI unpinned. */
const ISOLATED_BUILD = /\bpython3?\s+-m\s+build\b(?![^\n]*(?:--no-isolation|\s-n\b))/;

/** Everything the pip-unpinned rule finds in one pip install command. */
function pipFindings(file: string, n: number, args: string): Finding[] {
    const out: Finding[] = [];
    const tokens = args.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
    const unquote = (s: string): string => s.replace(/^['"]|['"]$/g, '').replace(/[;}]+$/, '');
    let hashes = false;
    let requirementsFile = false;
    let noDeps = false;
    let noIsolation = false;
    const packages: { spec: string; editable: boolean }[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (COMMAND_END.has(t) || /^\d?>/.test(t)) break;
        if (t === '--require-hashes') { hashes = true; continue; }
        if (t === '--no-deps') { noDeps = true; continue; }
        if (t === '--no-build-isolation') { noIsolation = true; continue; }
        if (t.startsWith('-')) {
            const [name] = t.split('=');
            if (name === '-r' || name === '--requirement') requirementsFile = true;
            if (name === '-e' || name === '--editable') packages.push({ spec: unquote(tokens[i + 1] ?? ''), editable: true });
            if (PIP_VALUE_OPTIONS.has(name) && !t.includes('=')) i++;
            continue;
        }
        packages.push({ spec: unquote(t), editable: false });
    }
    if (hashes) return out;
    if (requirementsFile) out.push({ file, line: n, rule: 'pip-unpinned', fix: 'install a requirements file with --require-hashes (a lock with a hash for every package)' });
    for (const { spec, editable } of packages) {
        if (/^git\+/.test(spec)) continue; // the git-unpinned rule reads these
        if (/^[$@]/.test(spec)) {
            out.push({ file, line: n, rule: 'pip-unpinned', fix: `"${spec}" is a variable this gate cannot read; write the package out, pinned with ==` });
        } else if (LOCAL_SOURCE.test(spec.replace(/\[[^\]]*\]$/, ''))) {
            // The checkout's own source is pinned by the commit. What it pulls in is not, unless the
            // dependencies and the build backend came from a hash-locked file first.
            if (!noDeps || !noIsolation) out.push({ file, line: n, rule: 'pip-unpinned', fix: `a local install of "${spec}" fetches its dependencies and its build backend unpinned: install them from a hash-locked file, then this with --no-deps --no-build-isolation` });
        } else if (editable) {
            out.push({ file, line: n, rule: 'pip-unpinned', fix: `an editable install of "${spec}" pins nothing; install a pinned version` });
        } else if (!spec.includes('==')) {
            out.push({ file, line: n, rule: 'pip-unpinned', fix: `pin "${spec}" with ==, or install it from a hash-locked file with --require-hashes` });
        }
    }
    return out;
}

/** What one command installs: pip packages, a build's backend, and git+ sources. */
function installFindings(file: string, c: Command): Finding[] {
    const out: Finding[] = [];
    for (const m of c.text.matchAll(/\bpip3?\s+install\b/g)) {
        out.push(...pipFindings(file, lineAt(c, m.index), c.text.slice(m.index + m[0].length)));
    }
    const build = ISOLATED_BUILD.exec(c.text);
    if (build) out.push({ file, line: lineAt(c, build.index), rule: 'pip-unpinned', fix: 'python -m build fills an isolated environment from PyPI unpinned: install the build backend from a hash-locked file and build with --no-isolation' });
    for (const m of c.text.matchAll(GIT_URL)) {
        const at = m[0].lastIndexOf('@');
        if (at < 0 || !COMMIT.test(m[0].slice(at + 1).replace(/[#)].*$/, ''))) {
            out.push({ file, line: lineAt(c, m.index), rule: 'git-unpinned', fix: `pin ${m[0]} to a commit: <address>@<40-character sha>` });
        }
    }
    return out;
}

/**
 * What a file under tools/systemone/ or the desktop resources fetches and installs: weights, pip
 * packages, git sources, downloads and piped scripts. Comments are read past (`#` lines, PowerShell
 * `<# … #>` blocks, and `//`, `/*` and ` *` lines in a script).
 */
export function commandFindings(file: string, text: string): Finding[] {
    const out: Finding[] = [];
    const raw = text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t }));
    const isScript = /\.(?:m?js|c?ts)$/.test(file);
    let inBlockComment = false;
    const code = raw.filter(l => {
        if (/^\s*<#/.test(l.text)) inBlockComment = true;
        const skip = inBlockComment || (isScript ? /^\s*(?:\/\/|\/\*|\*)/.test(l.text) : isShellComment(l.text));
        if (/#>\s*$/.test(l.text)) inBlockComment = false;
        return !skip;
    });
    const logical = commands(code, file.endsWith('.ps1') ? PS_CONTINUATION : SH_CONTINUATION);
    const codeText = code.map(l => l.text).join('\n');

    const downloads = code.flatMap(l => artifactUrls(l.text).map(url => ({ n: l.n, url })));
    const literals = new Set((codeText.match(SHA256_LITERAL) ?? []).map(h => h.toLowerCase()));
    if (downloads.length && (!SHA256_CHECK.test(codeText) || literals.size < downloads.length)) {
        for (const d of downloads) {
            out.push({ file, line: d.n, rule: 'unverified-download', fix: `${d.url}: check what it fetches against a sha256 written in this file (the project's own checksum for that version) before it runs` });
        }
    }
    for (const l of code) {
        if (l.text.includes('releases/latest')) out.push({ file, line: l.n, rule: 'latest-release', fix: 'name a fixed release instead of releases/latest' });
    }

    for (const l of logical) {
        const pipe = PIPE_TO_SHELL.exec(l.text);
        if (pipe) out.push({ file, line: lineAt(l, pipe.index), rule: 'pipe-to-shell', fix: 'download to a file, check its sha256 against one written here, then run the file' });
        for (const m of l.text.matchAll(/\b(?:snapshot_download|hf_hub_download)\(/g)) {
            const call = l.text.slice(m.index);
            if (!/\brevision\s*=\s*(?:(['"])[0-9a-f]{40}\1|(?!None\b)[A-Za-z_]\w*\b)/.test(call)) {
                out.push({ file, line: lineAt(l, m.index), rule: 'weights-revision', fix: 'download the weights at a fixed commit: revision=<the repository\'s commit sha>' });
            }
        }
        out.push(...installFindings(file, l));
        const clone = (isScript ? SCRIPT_CLONE : /\bgit\s+(?:-C\s+\S+\s+)?clone\b/).exec(l.text);
        if (clone && !(isScript ? SCRIPT_CHECKOUT_COMMIT : CHECKOUT_COMMIT).test(codeText)) {
            out.push({ file, line: lineAt(l, clone.index), rule: 'git-unpinned', fix: 'check the clone out at a fixed commit: git -C <dir> checkout <40-character sha>' });
        }
    }
    return out;
}

/** Everything wrong with one file under tools/systemone/: what it installs, and the models' keys. */
export function modelFindings(file: string, text: string): Finding[] {
    const out = commandFindings(file, text);
    for (const l of text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t }))) {
        for (const m of l.text.matchAll(/(?<!\$\{)\b(JEFF_API_KEYS|LAYA_API_KEY|VON_API_KEY|AIMEAT_DECIDE_[A-Z0-9_]*KEY)\b\s*([:=])\s*/g)) {
            const problem = keyValueProblem(m[2], l.text.slice(m.index + m[0].length));
            if (problem) out.push({ file, line: l.n, rule: 'model-key', fix: `${m[1]} is ${problem === 'empty' ? 'empty' : 'a fixed value'}: generate a random key at install and read it from there` });
        }
        const auth = /\b(jeff|laya|von)\b.*?\b[Aa]uth\s*[:=]\s*(null|''|""|'[^'$]*'|"[^"$]*")/.exec(l.text);
        if (auth) out.push({ file, line: l.n, rule: 'model-key', fix: `${auth[1]}'s key is ${/^(null|''|"")$/.test(auth[2]) ? 'empty' : 'a fixed value'}: read the key generated at install` });
        const bearer = /(?:Authorization:?\s*|['"`])Bearer\s+(?![$<{(%`'"])([A-Za-z0-9._~+/=-]{3,})/.exec(l.text);
        if (bearer) out.push({ file, line: l.n, rule: 'model-key', fix: `a fixed bearer key ("${bearer[1]}"): send the key the model was started with` });
    }
    return out;
}

/** A compose file: every model that takes a key starts only with one given from the environment. */
export function composeFindings(file: string, text: string): Finding[] {
    const out: Finding[] = [];
    const lc = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lc });
    const services = child(doc.contents, 'services');
    if (!isMap(services)) return out;
    for (const pair of services.items) {
        const name = String(valueOf(pair.key));
        const keyVar = KEYED_MODELS[name];
        // An override file (compose.gpu.yaml) publishes no ports and inherits the base's environment.
        if (!keyVar || child(pair.value, 'ports') === undefined) continue;
        const env = valueOf(child(pair.value, 'environment'));
        let value: unknown;
        if (Array.isArray(env)) value = (env as unknown[]).find((e): e is string => typeof e === 'string' && e.startsWith(`${keyVar}=`))?.slice(keyVar.length + 1);
        else if (env && typeof env === 'object') value = (env as Record<string, unknown>)[keyVar];
        if (typeof value !== 'string' || !value.startsWith(`\${${keyVar}:?`)) {
            out.push({ file, line: lineOf(pair.key, lc), rule: 'model-key', fix: `service "${name}" starts without a key: ${keyVar}: "\${${keyVar}:?…}", so compose refuses to start it without one` });
        }
    }
    return out;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────

function walk(root: string, rel: string, skip: ReadonlySet<string>, out: string[]): void {
    for (const name of readdirSync(path.join(root, rel)).sort()) {
        if (skip.has(name)) continue;
        const sub = `${rel}/${name}`;
        if (statSync(path.join(root, sub)).isDirectory()) walk(root, sub, skip, out);
        else out.push(sub);
    }
}

/** A file's text, or null for a binary one: a binary file runs nothing by being read. */
function textOf(root: string, file: string): string | null {
    const text = readFileSync(path.join(root, file), 'utf8');
    return text.slice(0, 8000).includes('\0') ? null : text;
}

export interface Scan { findings: Finding[]; workflows: number; modelFiles: number; desktopFiles: number }

/** Read the three trees under `root` (the repository, or a copy of one) and list what is wrong. */
export function scan(root: string): Scan {
    const findings: Finding[] = [];
    const workflows = readdirSync(path.join(root, WORKFLOW_DIR)).filter(f => /\.ya?ml$/.test(f)).sort();
    const jobIds = new Set<string>();
    for (const f of workflows) {
        const file = `${WORKFLOW_DIR}/${f}`;
        const text = readFileSync(path.join(root, file), 'utf8');
        findings.push(...workflowFindings(file, text));
        const jobs = child(parseDocument(text).contents, 'jobs');
        if (isMap(jobs)) for (const p of jobs.items) jobIds.add(`${f}#${String(valueOf(p.key))}`);
    }
    for (const [key, reason] of Object.entries(WRITE_JOB_EXEMPTIONS)) {
        if (!jobIds.has(key)) findings.push({ file: 'aimeat/scripts/check-supply-chain.ts', line: 1, rule: 'exemption', fix: `WRITE_JOB_EXEMPTIONS names ${key}, which is no job; remove the entry` });
        if (!reason.trim()) findings.push({ file: 'aimeat/scripts/check-supply-chain.ts', line: 1, rule: 'exemption', fix: `WRITE_JOB_EXEMPTIONS entry ${key} gives no reason` });
    }

    const modelFiles: string[] = [];
    walk(root, MODEL_DIR, MODEL_SKIP, modelFiles);
    for (const file of modelFiles) {
        const text = textOf(root, file);
        if (text === null) continue;
        findings.push(...modelFindings(file, text));
        if (/(?:^|\/)compose[^/]*\.ya?ml$/.test(file)) findings.push(...composeFindings(file, text));
    }

    const desktopFiles: string[] = [];
    walk(root, DESKTOP_DIR, DESKTOP_SKIP, desktopFiles);
    for (const file of desktopFiles) {
        const text = textOf(root, file);
        if (text !== null) findings.push(...commandFindings(file, text));
    }

    const used = new Set<string>();
    const kept = findings.filter(f => {
        const key = `${f.file}#${f.rule}`;
        if (!FILE_EXEMPTIONS[key]) return true;
        used.add(key);
        return false;
    });
    for (const [key, reason] of Object.entries(FILE_EXEMPTIONS)) {
        if (!used.has(key)) kept.push({ file: 'aimeat/scripts/check-supply-chain.ts', line: 1, rule: 'exemption', fix: `FILE_EXEMPTIONS names ${key}, which no longer finds anything; remove the entry` });
        if (!reason.trim()) kept.push({ file: 'aimeat/scripts/check-supply-chain.ts', line: 1, rule: 'exemption', fix: `FILE_EXEMPTIONS entry ${key} gives no reason` });
    }

    kept.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
    return { findings: kept, workflows: workflows.length, modelFiles: modelFiles.length, desktopFiles: desktopFiles.length };
}

function main(): void {
    const s = scan(REPO);
    for (const f of s.findings) console.log(`${f.file}:${f.line}  ${f.rule}  ${f.fix}`);
    console.log(`Supply chain: ${s.workflows} workflows, ${s.modelFiles} model files and ${s.desktopFiles} desktop runtime files read; ${s.findings.length} finding(s).`);
    if (s.findings.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
