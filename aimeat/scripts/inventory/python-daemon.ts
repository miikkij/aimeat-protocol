/**
 * @file scripts/inventory/python-daemon.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent work loop written twice, as a contract: what the Python daemon
 *   (python/aimeat-crewai/src/aimeat_crewai/, daemon.py and its helpers) calls, against what
 *   `aimeat connect` (aimeat/src/cli/connect/) serves and calls itself.
 *
 *   WHY IT EXISTS. A CrewAI crew reaches the node only through `aimeat connect serve`: the daemon
 *   long-polls the serve daemon's loopback routes (`/local/tasks/next`, `/local/records/next`, ...),
 *   sends every node REST call through its `/v1/*` proxy, and loads its tools from the connector MCP
 *   by name. Each of those is a string on the Python side and a registration on the Node side, and
 *   until 2026-10-18 nothing compared them (architecture review 2026-08-11; wish
 *   wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille). So a loopback route renamed
 *   in local-server.ts left the daemon polling a 404, and the Python package learned of it from a crew.
 *
 *   WHAT IS COMPARED, each as a finding id the allowlist names with a reason:
 *   - `local.python-only:<M> <path>`: the daemon calls a loopback route the serve daemon does not
 *     register (or not for that method). `local.connector-only:<M> <path>`: the serve daemon
 *     registers a loopback route the daemon never calls.
 *   - `rest.python-only:` / `rest.connector-only:<M> <path>`: the node REST routes the Python package
 *     calls against the ones the connector calls for its own work loop, in both directions.
 *   - `rest.not-in-openapi:<M> <path>`: a node route the Python package calls that openapi.yaml,
 *     the canonical contract, does not have.
 *   - `tool.not-on-connector:<name>`: an MCP tool name the Python package uses (its default tool
 *     filter, its own CrewAI tools) that the connector MCP does not register.
 *   A path is compared with its parameters as `{}` and without its query string. A method the
 *   source does not show (a bare path literal, a fetch without `method:`) is `*` and matches any.
 *
 *   READING THE SOURCE. Python: every `.get(` / `.post(` / `.patch(` / `.put(` / `.delete(` whose first
 *   argument is a string or f-string containing `/v1/` or `/local/`, every standalone `"/local/..."`
 *   literal, and every standalone `"aimeat_..."` literal (not a ContextVar name), across every .py file
 *   of the package. Node: every `app.<method>('/local/...')` under src/cli/connect/mcp/ and every
 *   `<client>.<method>('/v1/...')`, `postToNode(_, '/v1/...')`, `forward('M', ... '/v1/...')` and
 *   `fetch(`...\/v1/...`)` under src/cli/connect/. Its documented limit: a path held in a variable and
 *   passed to the call later is not seen (skill-bundle.ts builds its url first, tui/index.ts a base).
 *
 *   NOT SEEN, by design: what a field MEANS. The record event's `space` carries the space's
 *   namespace while daemon.py keys its manifest map by the object type's name; both are strings
 *   named `space`, so no name comparison can tell. That is incident
 *   incident-aimeat-crewai-the-contract-engagement-gate-never-finds-a-spa-mv5fhg3s, and the
 *   allowlist file carries it under `known` so every run prints it.
 * @structure
 *   - pythonCalls(src), connectorRoutes(dir), connectorCalls(dir), pythonToolNames(src)
 *   - openapiRoutes(yamlText)
 *   - daemonFindings(input): the finding ids
 *   - DAEMON_CEILING, DAEMON_ALLOWLIST
 * @usage import { daemonFindings } from './inventory/python-daemon.js';
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** The number of allowlisted differences. Deleting an entry lowers it; raising it is the developer's decision. */
export const DAEMON_CEILING = 40;
export const DAEMON_ALLOWLIST = 'security/python-daemon-parity.json';

/** One call or route: `METHOD path`, the method `*` when the source does not show it. */
export interface Endpoint { method: string; path: string; where: string }

const key = (e: Endpoint): string => `${e.method} ${e.path}`;

/** Every file under `dir` with one of `exts`, recursively, sorted. */
function walk(dir: string, exts: string[], skip: string[] = []): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (skip.includes(name)) continue;
        if (statSync(full).isDirectory()) out.push(...walk(full, exts, skip));
        else if (exts.some(x => name.endsWith(x)) && !name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

/** `/v1/agents/{name}/tasks?x=1` and `/v1/agents/${enc}/tasks` and `/local/invoke/:id/result` -> `{}` params, no query. */
export function normalizePath(raw: string): string {
    const at = Math.max(raw.indexOf('/v1/'), raw.indexOf('/local/'));
    let p = at >= 0 ? raw.slice(at) : raw;
    p = p.replace(/\$\{[^}]*\}/g, '{}').replace(/\{[^}]*\}/g, '{}').replace(/:[A-Za-z_]+/g, '{}');
    p = p.split('?')[0];
    return p.replace(/\/+$/, '') || '/';
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** TypeScript with its comments blanked and its line numbers kept: a usage example in a header is not a call. */
const tsCode = (text: string): string => text
    .replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '');

/** Python with its `#` comment lines blanked. */
const pyCode = (text: string): string => text.replace(/^[ \t]*#.*$/gm, '');

// ── Python ───────────────────────────────────────────────────────────────────

/** The HTTP calls and loopback paths in the Python package. */
export function pythonCalls(src: string): Endpoint[] {
    const out: Endpoint[] = [];
    for (const file of walk(src, ['.py'], ['__pycache__'])) {
        const text = pyCode(readFileSync(file, 'utf8'));
        const rel = relative(src, file).replace(/\\/g, '/');
        const call =/\.(get|post|put|patch|delete)\(\s*f?(["'])((?:(?!\2).)*?\/(?:v1|local)\/(?:(?!\2).)*)\2/g;
        for (const m of text.matchAll(call)) {
            out.push({ method: m[1].toUpperCase(), path: normalizePath(m[3]), where: `${rel}:${lineOf(text, m.index)}` });
        }
        // A loopback path held in a variable first (wake_path = "/local/records/next"): the method is not shown.
        for (const m of text.matchAll(/(["'])(\/local\/[A-Za-z0-9_/{}-]+)\1/g)) {
            const path = normalizePath(m[2]);
            if (!out.some(e => e.path === path)) out.push({ method: '*', path, where: `${rel}:${lineOf(text, m.index)}` });
        }
    }
    return out;
}

/** The MCP tool names the Python package names, with where each is first named. */
export function pythonToolNames(src: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const file of walk(src, ['.py'], ['__pycache__'])) {
        const text = pyCode(readFileSync(file, 'utf8'));
        const rel = relative(src, file).replace(/\\/g, '/');
        for (const m of text.matchAll(/(ContextVar\(\s*)?(["'])(aimeat_[a-z0-9_]+)\2/g)) {
            if (m[1]) continue;   // a ContextVar's name, not a tool
            if (!out.has(m[3])) out.set(m[3], `${rel}:${lineOf(text, m.index)}`);
        }
    }
    return out;
}

// ── Node connector ───────────────────────────────────────────────────────────

/** The loopback routes the serve daemon registers (`app.<method>('/local/...')`) under `dir`. */
export function connectorRoutes(dir: string, root: string): Endpoint[] {
    const out: Endpoint[] = [];
    for (const file of walk(dir, ['.ts'])) {
        const text = tsCode(readFileSync(file, 'utf8'));
        for (const m of text.matchAll(/\bapp\.(get|post|put|patch|delete|all)\(\s*'(\/local\/[^']+)'/g)) {
            out.push({ method: m[1] === 'all' ? '*' : m[1].toUpperCase(), path: normalizePath(m[2]), where: `${relative(root, file).replace(/\\/g, '/')}:${lineOf(text, m.index)}` });
        }
    }
    return out;
}

/** The node REST calls the connector makes itself, under `dir`. */
export function connectorCalls(dir: string, root: string): Endpoint[] {
    const out: Endpoint[] = [];
    const shapes: { re: RegExp; method: (m: RegExpMatchArray) => string; path: (m: RegExpMatchArray) => string; receiver?: number }[] = [
        // client.get('/v1/...'), deps.client.post(`/v1/...`): any receiver but an Express app or router.
        { re: /\b(\w+)\.(get|post|put|patch|delete)\(\s*([`'"])((?:(?!\3).)*?\/v1\/(?:(?!\3).)*)\3/g, method: m => m[2].toUpperCase(), path: m => m[4], receiver: 1 },
        { re: /\bpostToNode\(\s*[^,]+,\s*([`'"])((?:(?!\1).)*?\/v1\/(?:(?!\1).)*)\1/g, method: () => 'POST', path: m => m[2] },
        { re: /\bforward\(\s*'([A-Z]+)'\s*,[^,]*?(['"`])(\/v1\/[^'"`]*)\2/g, method: m => m[1], path: m => m[3] },
        { re: /\bfetch\(\s*`([^`]*?\/v1\/[^`]*)`/g, method: () => '*', path: m => m[1] },
    ];
    for (const file of walk(dir, ['.ts'])) {
        const text = tsCode(readFileSync(file, 'utf8'));
        const rel = relative(root, file).replace(/\\/g, '/');
        for (const s of shapes) {
            for (const m of text.matchAll(s.re)) {
                if (s.receiver !== undefined && (m[s.receiver] === 'app' || m[s.receiver] === 'router')) continue;
                out.push({ method: s.method(m), path: normalizePath(s.path(m)), where: `${rel}:${lineOf(text, m.index!)}` });
            }
        }
    }
    return out;
}

/** openapi.yaml's routes as `METHOD path`, parameters as `{}`. */
export function openapiRoutes(yamlText: string): Endpoint[] {
    const spec = parseYaml(yamlText) as { paths?: Record<string, Record<string, unknown>> };
    const out: Endpoint[] = [];
    for (const [path, ops] of Object.entries(spec.paths ?? {})) {
        for (const m of Object.keys(ops ?? {})) {
            if (['get', 'post', 'put', 'patch', 'delete'].includes(m)) out.push({ method: m.toUpperCase(), path: normalizePath(path), where: 'openapi.yaml' });
        }
    }
    return out;
}

// ── Comparison ───────────────────────────────────────────────────────────────

const matches = (a: Endpoint, b: Endpoint): boolean => a.path === b.path && (a.method === '*' || b.method === '*' || a.method === b.method);

export interface DaemonInput {
    python: Endpoint[];
    pythonTools: Map<string, string>;
    localRoutes: Endpoint[];
    connectorRest: Endpoint[];
    contract: Endpoint[];
    connectorTools: Set<string>;
}

/** Every difference, as stable ids, each with the source line it was read from. */
export function daemonFindings(input: DaemonInput): Map<string, string> {
    const out = new Map<string, string>();
    const add = (id: string, where: string): void => { if (!out.has(id)) out.set(id, where); };
    const pyLocal = input.python.filter(e => e.path.startsWith('/local/'));
    const pyRest = input.python.filter(e => e.path.startsWith('/v1/'));

    for (const e of pyLocal) if (!input.localRoutes.some(r => matches(e, r))) add(`local.python-only:${key(e)}`, e.where);
    for (const r of input.localRoutes) if (!pyLocal.some(e => matches(e, r))) add(`local.connector-only:${key(r)}`, r.where);

    for (const e of pyRest) if (!input.connectorRest.some(r => matches(e, r))) add(`rest.python-only:${key(e)}`, e.where);
    for (const r of input.connectorRest) if (!pyRest.some(e => matches(e, r))) add(`rest.connector-only:${key(r)}`, r.where);
    for (const e of pyRest) if (!input.contract.some(r => matches(e, r))) add(`rest.not-in-openapi:${key(e)}`, e.where);

    for (const [name, where] of input.pythonTools) if (!input.connectorTools.has(name)) add(`tool.not-on-connector:${name}`, where);
    return out;
}
