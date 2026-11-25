/**
 * @file scripts/lib/ready-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which E2E suites a CODE change can reach, so pnpm ready runs those and not the whole
 *   sweep. The whole sweep runs every night (.github/workflows/e2e-full.yml) and for a release; pnpm
 *   ready runs what the change could have broken (Jouni, 2026-11-24).
 *
 *   THE COVERAGE MAP FIRST. The nightly sweep records which src/ function every suite executed
 *   (scripts/lib/e2e-coverage-map.ts, fetched into coverage-e2e/ by gate-coverage.ts). A changed line
 *   picks the suites that ran its function, which is the exact answer. The rules below are the
 *   fallback for what the map does not know: a new file, a machine without the map.
 *
 *   HOW A SUITE IS REACHED WITHOUT THE MAP. An E2E suite talks to a running node over HTTP, so what it reaches is the
 *   routes it calls. From each changed file under aimeat/src/ this follows the files that import it,
 *   type imports included (a service handed to a router by the bootstrap is named by its type there),
 *   up to the route modules (src/routes/, src/mcp/). The paths those routes register are then looked
 *   for in each suite and in the test helpers it imports: a suite that calls one is picked. A suite
 *   that imports a reached source file itself is picked too. A path that only a helper most suites
 *   use calls (the harness's readiness read of /.well-known/aimeat) is proven by any suite, so
 *   COMMON_SAMPLE of them run, not all.
 *
 *   THE BOOTSTRAP IS NOT FOLLOWED. src/server-bootstrap/ imports every service to wire it, so going
 *   through it would reach every route for every change. A change INSIDE the bootstrap is proven by
 *   any suite, since each starts a node, so COMMON_SAMPLE suites run for it. A change in what every
 *   request passes through (middleware, auth, storage, config, the generated types, the
 *   dependencies) cannot be narrowed this way and runs the whole sweep.
 *
 *   THE CONTRACT. openapi.yaml changes with every route change, and the body guard checks a request
 *   only against its own route's schema, so a change there reaches the paths it changed (directly or
 *   through a component they refer to) and the suites that read the contract; only a change of its
 *   security, or a side that does not parse, runs the whole sweep.
 *
 *   OUTSIDE src/. A served browser library (src/static/sdk-libs/, public/lib/) or a page under
 *   public/ is reached by a suite that names its file. The Python package (python/) has its own tests
 *   and reaches no node suite.
 * @structure FULL_SWEEP · openapiChangedRoutes(repo, base) · registeredSuites(aimeat) · codeReach(repo, files)
 * @usage const reach = codeReach(repo, codeFiles);   // scripts/lib/ready-scope.ts readyScope()
 * @version-history
 *   v1.3.0 — 2026-11-25 — openapi.yaml runs the suites that call the paths it changed, not the whole
 *     sweep (openapiChangedRoutes).
 *   v1.2.0 — 2026-11-25 — The suites are the runner's ALL_SUITES list, not the files named e2e-*.ts,
 *     so federation-mesh, api-full and the other suites without the prefix are reachable.
 *   v1.1.0 — 2026-11-25 — The nightly's coverage map decides first; a route is matched by every fixed
 *     part of its path to its end; a route or file more than COMMON_SHARE of the suites run picks
 *     COMMON_SAMPLE of them; a configuration change starts from the code that reads the setting.
 *   v1.0.0 — 2026-11-24 — Initial (Jouni, 2026-11-24: pnpm ready runs only what the change can reach,
 *     the nightly runs the whole sweep).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { coverageSelection } from './gate-coverage.js';

/** Changed paths that every request passes through, or that decide what runs at all: the whole sweep. */
export const FULL_SWEEP = /^(?:aimeat\/src\/(?:middleware|auth|storage|generated)\/|aimeat\/src\/server\.ts$|aimeat\/package\.json$|pnpm-lock\.yaml$|aimeat\/pnpm-lock\.yaml$|aimeat\/test\/helpers\/|aimeat\/test\/run-e2e[^/]*\.ts$)/;

/**
 * What a suite that reads the contract itself contains: the served /openapi.json, or openapi.yaml read
 * from the disk (e2e-contract). Not /v1/spec, which a hundred suites poll only to see their node start
 * (test/helpers/wait-for-server.ts).
 */
const CONTRACT_READERS = [/\/openapi\.json/, /'openapi\.yaml'\)/];

/**
 * The API paths whose contract changed in openapi.yaml since `base`, in Express form (`/v1/x/:id`),
 * or null when the change cannot be placed on paths (a security scheme, the top-level security, a
 * side that does not parse): then the whole sweep runs. The body guard (middleware/openapi-body-guard.ts)
 * checks a request against its own route's schema only, so a changed schema reaches the routes that
 * use it: a path changed itself, or refers to a component that changed, directly or through others.
 */
export function openapiChangedRoutes(repo: string, base: string): string[] | null {
  type Contract = { security?: unknown; components?: Record<string, Record<string, unknown>>; paths?: Record<string, unknown> };
  let before: Contract, after: Contract;
  try {
    before = parseYaml(execFileSync('git', ['show', `${base}:openapi.yaml`], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })) as Contract;
    after = parseYaml(readFileSync(path.join(repo, 'openapi.yaml'), 'utf8')) as Contract;
  } catch {
    return null; // a side that cannot be read or parsed cannot be narrowed: the whole sweep says so
  }
  const json = (v: unknown) => JSON.stringify(v ?? null);
  if (json(before.security) !== json(after.security) || json(before.components?.securitySchemes) !== json(after.components?.securitySchemes)) return null;
  const changed = new Set<string>();
  const comps: Array<[string, unknown]> = [];
  for (const section of new Set([...Object.keys(before.components ?? {}), ...Object.keys(after.components ?? {})])) {
    if (section === 'securitySchemes') continue;
    const a = before.components?.[section] ?? {}, b = after.components?.[section] ?? {};
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ref = `"#/components/${section}/${name}"`;
      comps.push([ref, b[name]]);
      if (json(a[name]) !== json(b[name])) changed.add(ref);
    }
  }
  // A component that refers to a changed one has changed in effect, through any depth.
  for (let grew = true; grew;) {
    grew = false;
    for (const [ref, value] of comps) {
      if (changed.has(ref)) continue;
      const text = json(value);
      if ([...changed].some(c => text.includes(c))) { changed.add(ref); grew = true; }
    }
  }
  const routes: string[] = [];
  for (const p of new Set([...Object.keys(before.paths ?? {}), ...Object.keys(after.paths ?? {})])) {
    const a = json(before.paths?.[p]), b = json(after.paths?.[p]);
    if (a !== b || [...changed].some(c => b.includes(c))) routes.push(p.replace(/\{([A-Za-z_]\w*)\}/g, ':$1'));
  }
  return routes;
}

/**
 * The configuration. Every module names its type, so its importers are every route; what a changed
 * setting reaches is the code that READS that setting. The settings a change adds or edits are the
 * names on its changed lines (`appsOwedOnPublish:`), and the files that read `.appsOwedOnPublish` are
 * where the walk starts. A list that names no setting (known-env-names.ts) reaches nothing.
 */
const CONFIG = /^aimeat\/src\/(?:config\/|config\.ts$|config-types\.ts$|services\/config\/)/;

/**
 * The bootstrap and the entry point wire every service and run the boot steps. A change there is
 * proven by any suite, because every suite starts a node: COMMON_SAMPLE suites run for it, beside the
 * suites the services it calls reach.
 */
const BOOT = /^aimeat\/src\/(?:server-bootstrap\/|index\.ts$)/;

/** A route more than this share of the suites call is on every suite's way; COMMON_SAMPLE of them run for it. */
const COMMON_SHARE = 0.3;
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

/**
 * The source files that read a setting the configuration file changed: the property names on the
 * lines the diff adds or removes, looked for as `.<name>` outside the configuration itself.
 */
function settingReaders(repo: string, file: string, base: string, srcDir: string): string[] {
  let diff = '';
  try { diff = execFileSync('git', ['diff', base, '--', file], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return []; }
  const names = new Set<string>();
  for (const line of diff.split('\n')) {
    if (!/^[+-][^+-]/.test(line)) continue;
    for (const m of line.matchAll(/\b([a-z][A-Za-z0-9]{5,})\s*[:?]/g)) names.add(m[1]!);
    for (const m of line.matchAll(/\bkey:\s*'([a-z][A-Za-z0-9]{5,})'/g)) names.add(m[1]!);
  }
  if (!names.size) return [];
  const readers: string[] = [];
  for (const f of walk(srcDir)) {
    const rel = path.relative(repo, f).split(path.sep).join('/');
    if (CONFIG.test(rel)) continue;
    const src = readFileSync(f, 'utf8');
    if ([...names].some(n => src.includes(`.${n}`))) readers.push(path.normalize(f));
  }
  return readers;
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

/**
 * The suites the runner knows: the entries of ALL_SUITES in test/run-e2e-ci.ts, as absolute paths.
 * A file-name filter missed the suites without the `e2e-` prefix (federation-mesh, api-full, ai),
 * and a change that broke them reached main unseen (2026-11-25).
 */
export function registeredSuites(aimeat: string): string[] {
  const runner = readFileSync(path.join(aimeat, 'test', 'run-e2e-ci.ts'), 'utf8');
  const start = runner.indexOf('const ALL_SUITES = [');
  if (start < 0) throw new Error('test/run-e2e-ci.ts has no ALL_SUITES list');
  const list = runner.slice(start, runner.indexOf('\n];', start));
  return [...list.matchAll(/^\s*'(test\/[^']+\.ts)'/gm)].map(m => path.join(aimeat, m[1]!));
}

/** The E2E suites the changed code files can reach (see the header). `files` are repo-relative. */
export function codeReach(repo: string, files: string[], base = 'origin/main'): CodeReach {
  const full = files.find(f => FULL_SWEEP.test(f));
  if (full) return { full: `${full} is on every request's path`, suites: [] };
  const contract = files.includes('openapi.yaml') ? openapiChangedRoutes(repo, base) : [];
  if (contract === null) return { full: 'openapi.yaml changed its security or cannot be read on both sides', suites: [] };

  const aimeat = path.join(repo, 'aimeat');
  const srcDir = path.join(aimeat, 'src');
  const testDir = path.join(aimeat, 'test');
  const suiteFiles = registeredSuites(aimeat);
  const rev = graphOf(repo, () => {
    const srcFiles = walk(srcDir).filter(f => !f.includes(`${path.sep}static${path.sep}sdk-libs${path.sep}`));
    const helperFiles = existsSync(path.join(testDir, 'helpers')) ? walk(path.join(testDir, 'helpers')) : [];
    return reverseImports([...srcFiles, ...helperFiles, ...suiteFiles]);
  });

  // FIRST THE COVERAGE MAP. The nightly records which src/ function each suite executed
  // (scripts/lib/e2e-coverage-map.ts); a changed line picks the suites that ran its function. A file
  // the map does not know (new, or run by no suite) goes the import way below, unless every file that
  // imports it is a changed file the map knows: their suites are the ones that call it.
  const aimeatDir = path.join(repo, 'aimeat');
  const covered = new Map<string, string[]>();
  const srcTs = files.filter(f => /^aimeat\/src\/.+\.ts$/.test(f) && !f.startsWith('aimeat/src/static/') && !f.startsWith('aimeat/src/data/library-packs/'));
  for (const f of srcTs) {
    const c = coverageSelection(repo, aimeatDir, [f], base, { refresh: true });
    if (c.suites === null) break;            // no map on this machine: every file goes the import way
    if (!c.unknown.includes(f)) covered.set(f, c.suites);
  }
  const newOnlyCalledByCovered = (f: string): boolean => {
    const importers = [...(rev.get(path.normalize(path.join(repo, f))) ?? [])].map(i => path.relative(repo, i).split(path.sep).join('/'));
    return importers.length > 0 && importers.every(i => covered.has(i));
  };

  const reached = new Set<string>();
  const names = new Set<string>();     // served files a suite may name (a browser library, a page)
  for (const f of files) {
    if (NO_NODE.test(f)) continue;
    if (covered.has(f) || (covered.size && newOnlyCalledByCovered(f))) continue;
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
    // A configuration file: start from the code that reads the settings it changed.
    const starts = CONFIG.test(f) ? settingReaders(repo, f, base, srcDir) : [abs];
    // Follow the importers, not through the bootstrap and not through the configuration's type.
    const queue = [...starts];
    while (queue.length) {
      const cur = queue.pop()!;
      if (reached.has(cur)) continue;
      reached.add(cur);
      if (cur.includes(`${path.sep}server-bootstrap${path.sep}`)) continue;
      if (CONFIG.test(path.relative(repo, cur).split(path.sep).join('/'))) continue;
      for (const imp of rev.get(cur) ?? []) if (!reached.has(imp)) queue.push(imp);
    }
  }

  // What a suite must contain to call each reached route: its fixed parts, the last one ending where
  // the path ends, so `/v1/ghii` is not found inside `/v1/ghii/login`.
  const matchers: RegExp[][] = [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const addRoute = (route: string) => {
    const parts = routeParts(route);
    // The root (`/`, the discovery document or an app's subdomain page) is a prefix of every path.
    if (parts.join('').length < 4) return;
    const open = /[:*)]\??$/.test(route);   // ends in a parameter: the last part is followed by one
    matchers.push(parts.map((p, i) => new RegExp(esc(p) + (i === parts.length - 1 && !open ? '(?![A-Za-z0-9_/-])' : ''))));
  };
  for (const f of reached) {
    const rel = path.relative(srcDir, f).split(path.sep).join('/');
    if (rel.startsWith('mcp/')) { for (const p of ['/mcp', '/v1/mcp', '/v2/mcp']) addRoute(p); continue; }
    if (!rel.startsWith('routes/') || !existsSync(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(ROUTE_RE)) addRoute(m[1]!);
  }
  for (const n of names) matchers.push([new RegExp(esc(n))]);
  // A contract change: the routes it changed, and the suites that read the contract itself.
  if (files.includes('openapi.yaml')) {
    for (const r of contract) addRoute(r);
    for (const re of CONTRACT_READERS) matchers.push([re]);
  }

  // Each suite's text with every test helper it imports, directly or through another helper.
  const helpersDir = path.join(testDir, 'helpers');
  const helpersOf = (file: string, seen = new Set<string>()): Set<string> => {
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const t = resolveSpec(file, m[1] ?? m[2] ?? m[3]!);
      if (t && t.startsWith(helpersDir) && !seen.has(t)) { seen.add(t); helpersOf(t, seen); }
    }
    return seen;
  };
  const texts = suiteFiles.map(s => ({
    name: path.basename(s, '.ts'),
    text: [s, ...helpersOf(s)].map(f => readFileSync(f, 'utf8')).join('\n'),
  }));

  // A route (or a source file) that more than COMMON_SHARE of the suites call is what every suite
  // goes through (signing up, signing in, the readiness read): any suite proves it still works, so
  // COMMON_SAMPLE of them run for it. Every other route runs every suite that calls it.
  const picked = new Set<string>();
  const take = (group: string[]) => {
    const list = group.length > suiteFiles.length * COMMON_SHARE ? group.sort().slice(0, COMMON_SAMPLE) : group;
    for (const n of list) picked.add(n);
  };
  for (const suites of covered.values()) take([...suites]);
  for (const parts of matchers) take(texts.filter(t => parts.every(re => re.test(t.text))).map(t => t.name));
  // A suite that imports a reached source file, itself or through a helper.
  const importers = new Set([...reached].filter(f => f.startsWith(testDir)));
  take(suiteFiles.filter(s => importers.has(path.normalize(s)) || [...helpersOf(s)].some(h => importers.has(path.normalize(h)))).map(s => path.basename(s, '.ts')));
  // A boot change: a few suites prove the node still starts and serves.
  if (files.some(f => BOOT.test(f))) for (const s of suiteFiles.map(f => path.basename(f, '.ts')).sort().slice(0, COMMON_SAMPLE)) picked.add(s);
  return { full: null, suites: [...picked].sort() };
}
