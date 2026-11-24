/**
 * @file scripts/lib/ready-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which E2E suites a CODE change can reach, so pnpm ready runs those and not the whole
 *   sweep. The whole sweep runs every night (.github/workflows/e2e-full.yml) and for a release; pnpm
 *   ready runs what the change could have broken (Jouni, 2026-11-24).
 *
 *   HOW A SUITE IS REACHED. An E2E suite talks to a running node over HTTP, so what it reaches is the
 *   routes it calls. From each changed file under aimeat/src/ this follows the files that import it,
 *   type imports included (a service handed to a router by the bootstrap is named by its type there),
 *   up to the route modules (src/routes/, src/mcp/). The paths those routes register are then looked
 *   for in each suite and in the test helpers it imports: a suite that calls one is picked. A suite
 *   that imports a reached source file itself is picked too. A path that only a helper most suites
 *   use calls (the harness's readiness read of /.well-known/aimeat) is proven by any suite, so
 *   COMMON_SAMPLE of them run, not all.
 *
 *   THE BOOTSTRAP IS NOT FOLLOWED. src/server-bootstrap/ imports every service to wire it, so going
 *   through it would reach every route for every change. A change INSIDE the bootstrap, or in what
 *   every request passes through (middleware, auth, storage, config, the entry point, the generated
 *   types, the dependencies), cannot be narrowed this way and runs the whole sweep.
 *
 *   OUTSIDE src/. A served browser library (src/static/sdk-libs/, public/lib/) or a page under
 *   public/ is reached by a suite that names its file. The Python package (python/) has its own tests
 *   and reaches no node suite.
 * @structure FULL_SWEEP · codeReach(repo, files)
 * @usage const reach = codeReach(repo, codeFiles);   // scripts/lib/ready-scope.ts readyScope()
 * @version-history
 *   v1.0.0 — 2026-11-24 — Initial (Jouni, 2026-11-24: pnpm ready runs only what the change can reach,
 *     the nightly runs the whole sweep).
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** Changed paths that every request passes through, or that decide what runs at all: the whole sweep. */
export const FULL_SWEEP = /^(?:aimeat\/src\/(?:server-bootstrap|middleware|auth|storage|generated|config)\/|aimeat\/src\/(?:index|config|config-types|server)\.ts$|aimeat\/package\.json$|pnpm-lock\.yaml$|aimeat\/pnpm-lock\.yaml$|openapi\.yaml$|aimeat\/test\/helpers\/|aimeat\/test\/run-e2e[^/]*\.ts$)/;

/** How many suites prove a path that only the helpers every suite uses call (see codeReach). */
const COMMON_SAMPLE = 3;

/** Files under these never run in the node a suite talks to. */
const NO_NODE = /^(?:python\/|\.github\/|aimeat-apps\/)/;

const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\s+['"](\.{1,2}\/[^'"]+)['"]/g;
// The routes a module answers. `.use(path, …)` is left out: it mounts middleware or a static folder
// under a prefix that other modules' routes share (`/.well-known`), and a router here registers its
// paths in full itself.
const ROUTE_RE = /\.(?:get|post|put|patch|delete|all)\(\s*['"`](\/[^'"`]*)['"`]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'dist' && n !== 'node_modules') walk(p, out); }
    else if (/\.(ts|js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.mjs$/, '.mts'), `${base}.ts`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.js')];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return path.normalize(c);
  return null;
}

/** importer map: file -> the files that import it. */
function reverseImports(files: string[]): Map<string, Set<string>> {
  const rev = new Map<string, Set<string>>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = resolveSpec(f, m[1] ?? m[2] ?? m[3]!);
      if (!target) continue;
      if (!rev.has(target)) rev.set(target, new Set());
      rev.get(target)!.add(path.normalize(f));
    }
  }
  return rev;
}

/**
 * The fixed parts of a route path, in order: `/v1/ghii/:ghii/credential` is `/v1/ghii/` and
 * `/credential`. A suite calls the route when its text holds every part; the start alone
 * (`/v1/ghii`) is in every suite that signs in.
 */
function routeParts(route: string): string[] {
  return route.split(/:[A-Za-z_]\w*\??|\*|\([^)]*\)/).filter(p => p.length > 1);
}

/** One importer map per tree in a process: reading every source file takes seconds. */
const graphs = new Map<string, Map<string, Set<string>>>();
function graphOf(repo: string, build: () => Map<string, Set<string>>): Map<string, Set<string>> {
  if (!graphs.has(repo)) graphs.set(repo, build());
  return graphs.get(repo)!;
}

export interface CodeReach {
  /** Why the whole sweep runs, or null when the suites below are enough. */
  full: string | null;
  suites: string[];
}

/** The E2E suites the changed code files can reach (see the header). `files` are repo-relative. */
export function codeReach(repo: string, files: string[]): CodeReach {
  const full = files.find(f => FULL_SWEEP.test(f));
  if (full) return { full: `${full} is on every request's path`, suites: [] };

  const aimeat = path.join(repo, 'aimeat');
  const srcDir = path.join(aimeat, 'src');
  const testDir = path.join(aimeat, 'test');
  const suiteFiles = readdirSync(testDir).filter(n => /^e2e-.*\.ts$/.test(n)).map(n => path.join(testDir, n));
  const rev = graphOf(repo, () => {
    const srcFiles = walk(srcDir).filter(f => !f.includes(`${path.sep}static${path.sep}sdk-libs${path.sep}`));
    const helperFiles = existsSync(path.join(testDir, 'helpers')) ? walk(path.join(testDir, 'helpers')) : [];
    return reverseImports([...srcFiles, ...helperFiles, ...suiteFiles]);
  });

  const reached = new Set<string>();
  const names = new Set<string>();     // served files a suite may name (a browser library, a page)
  for (const f of files) {
    if (NO_NODE.test(f)) continue;
    const abs = path.normalize(path.join(repo, f));
    if (f.startsWith('aimeat/src/static/sdk-libs/') || f.startsWith('aimeat/public/')) {
      const parts = f.split('/');
      // A served library by its served name (aimeat-atelier), a page or a sheet by its file name with
      // the extension (materials.css), which a suite that fetches it must write.
      const lib = f.startsWith('aimeat/src/static/sdk-libs/') && parts[4] !== 'dist' ? `aimeat-${parts[4]}` : path.basename(f);
      names.add(lib);
      continue;
    }
    // The served libraries' registry: its entries are read by the library routes (/v1/libs) and by
    // the suites that name a library. Many modules import the registry for one field, so its
    // importers would pick every package suite for a changelog line.
    if (f.startsWith('aimeat/src/data/library-packs/')) { names.add('/v1/libs'); continue; }
    if (!f.startsWith('aimeat/src/')) continue;
    // Follow the importers, not through the bootstrap.
    const queue = [abs];
    while (queue.length) {
      const cur = queue.pop()!;
      if (reached.has(cur)) continue;
      reached.add(cur);
      if (cur.includes(`${path.sep}server-bootstrap${path.sep}`)) continue;
      for (const imp of rev.get(cur) ?? []) if (!reached.has(imp)) queue.push(imp);
    }
  }

  // The paths the reached routes register, each as its fixed parts.
  const routes = new Map<string, string[]>();
  for (const f of reached) {
    const rel = path.relative(srcDir, f).split(path.sep).join('/');
    if (rel.startsWith('mcp/')) { for (const p of ['/mcp', '/v1/mcp', '/v2/mcp']) routes.set(p, [p]); continue; }
    if (!rel.startsWith('routes/') || !existsSync(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(ROUTE_RE)) {
      // The root (`/`, the discovery document or an app's subdomain page) is a prefix of every path,
      // so it would pick every suite; the same module's longer paths name what it serves.
      const parts = routeParts(m[1]!);
      if (parts.join('').length >= 4) routes.set(m[1]!, parts);
    }
  }

  // The helpers each suite imports, directly or through another helper.
  const helpersDir = path.join(testDir, 'helpers');
  const helpersOf = (file: string, seen = new Set<string>()): Set<string> => {
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const t = resolveSpec(file, m[1] ?? m[2] ?? m[3]!);
      if (t && t.startsWith(helpersDir) && !seen.has(t)) { seen.add(t); helpersOf(t, seen); }
    }
    return seen;
  };
  const suiteHelpers = new Map(suiteFiles.map(s => [s, helpersOf(s)]));
  // A helper most suites use (the harness, the server boot) calls its paths in every suite, so a path
  // found only there is exercised by any suite: a few of them prove it, all of them prove nothing more.
  const uses = new Map<string, number>();
  for (const hs of suiteHelpers.values()) for (const h of hs) uses.set(h, (uses.get(h) ?? 0) + 1);
  const common = new Set([...uses].filter(([, n]) => n > suiteFiles.length * 0.3).map(([h]) => h));
  const hits = (text: string): boolean => [...routes.values()].some(parts => parts.every(p => text.includes(p))) || [...names].some(n => text.includes(n));
  const helperHit = new Map([...uses.keys()].map(h => [h, hits(readFileSync(h, 'utf8'))]));

  const picked = new Set<string>();
  const viaCommon: string[] = [];
  for (const s of suiteFiles) {
    const name = path.basename(s, '.ts');
    if (reached.has(path.normalize(s))) { picked.add(name); continue; }
    const own = [...suiteHelpers.get(s)!].filter(h => !common.has(h));
    if (hits(readFileSync(s, 'utf8')) || own.some(h => helperHit.get(h))) { picked.add(name); continue; }
    if ([...suiteHelpers.get(s)!].some(h => common.has(h) && helperHit.get(h))) viaCommon.push(name);
  }
  for (const name of viaCommon.sort().slice(0, COMMON_SAMPLE)) picked.add(name);
  // A suite that imports a reached source file directly is in `reached` through the importer map.
  for (const f of reached) if (f.startsWith(testDir) && /e2e-.*\.ts$/.test(f)) picked.add(path.basename(f, '.ts'));
  return { full: null, suites: [...picked].sort() };
}
