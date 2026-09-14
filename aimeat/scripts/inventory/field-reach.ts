/**
 * @file scripts/inventory/field-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Question C of wish-invarianttiauditointi, in the shape the finding actually had: a
 *   REST door takes a record field, and the agent tools that do the same job do not.
 *
 *   THE FINDINGS THIS IS SHAPED BY. `run_mode` had a door in HTTP and not one an agent could reach.
 *   On 2026-09-14 `organism_id` did the same: PUT /v1/companies/:id takes it and
 *   aimeat_company_update does not declare it, so the MCP SDK strips it and the call answers ok.
 *   Name parity (check:mcp-tools) proves the TOOLS match. Parameter parity (check:mcp-schemas)
 *   proves the tools' own inputs match each other. Neither compares a field to the REST route that
 *   also takes it.
 *
 *   WHAT IT MEASURES (v2, 2026-09-14). One DOOR at a time: a REST route, and its TWINS, the agent
 *   tools that do the same job.
 *   - What the door takes: the record fields its handler reads from req.body or req.query, as CodeQL
 *     follows the value (codeql/field-reach-facts.ql, loaded by field-reach-facts.ts).
 *   - Its twins: a node MCP tool is a twin when it calls a function in another file that the route
 *     handler also calls, which is what the one-implementation rule says a tool must do. A connector
 *     or CLI tool is a twin when it makes a REST call that matches the route's method and path.
 *   - What a twin takes: its declared input (mcp-capture.ts). The MCP SDK strips an undeclared key.
 *   A field the door takes and no twin declares is REST-only. A door that takes record fields and has
 *   no twin at all is reported as a door, once, rather than as each of its fields.
 *
 *   WHAT v1 MEASURED, AND WHY IT COULD NOT HAVE CAUGHT organism_id. v1 counted MENTIONS: a surface
 *   "reached" a field when any file of it named the field. A name-level join was tried in between on
 *   2026-09-14 and failed the same way: organism_id is a parameter of dozens of workspace tools, so
 *   by name every agent surface "takes" it. Both errors are in the permissive direction, and the
 *   reason the unit is now the door and not the name.
 *
 *   WHAT IT STILL DOES NOT CLAIM. Measured 2026-09-14:
 *   - Reads, recall: all 1364 syntactically direct reads (`req.body.x`, `const { x } = req.body`)
 *     and all 197 same-file aliased reads are in the CodeQL answer; 30 further-away reads sampled at
 *     random were all real. A read whose key CodeQL cannot name (`unnamed`) and a read reached
 *     through a request no route registration names (`unrouted`) are counted per file by the gate.
 *   - Reads, overreport: a spread copy's own added keys are counted as read.
 *   - Tools: CodeQL recognises every tool the runtime registers (335 node, 337 connector, 307 CLI).
 *     25 connector and 20 CLI tools make no REST call it can see; they twin with nothing, which
 *     reports more, not less.
 *   - Twins, permissive: a declared key counts even when the tool then drops it (for the CLI door,
 *     test/unit/cli-tool-param-forwarding.test.ts proves the value leaves). A shared function is
 *     trusted to mean a shared job unless it is plumbing (a lookup, a utility, see isPlumbing) or
 *     more than GENERIC_CALLERS node tools call it. A route's call counts only when it carries
 *     request data.
 *   - Twins, strict: a node tool that reaches the route's service one call deeper than the route
 *     does is not a twin, so the door is reported. That is the safe direction.
 * @structure recordFields(files) · canonical(name) · isPlumbing(callee) · pathMatches(toolPath, routePath) ·
 *   doorReach(fields, facts, declared)
 * @usage const m = doorReach(recordFields(files), loadFacts({ build: true }).facts, declaredInputs);
 * @version-history
 *   v2.1.0 — 2026-09-14 — A service lookup (`require*`, `get*`, `resolve*` …) no longer pairs a route
 *     with a tool: requireOwnCompany had made aimeat_company_update the "twin" of the invoice routes,
 *     so its new organism_id parameter silently cleared two invoice findings. The callee id carries
 *     the function's name for this.
 *   v2.0.0 — 2026-09-14 — Mentions replaced by doors: what a route reads (CodeQL) against what its
 *     twin tools declare. The name-level join tried the same day is gone with them.
 *   v1.1.0 — 2026-09-14 — The vocabulary is every *Record type in src/ outside src/cli/, not only
 *     src/storage/types/. 505 fields became 672, and CompanyRecord is in it.
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, question C).
 */
import ts from 'typescript';
import type { Facts } from './field-reach-facts.js';

export type AgentSurface = 'mcp.node' | 'mcp.connector' | 'cli.dispatch';

/**
 * A function called by more node tools than this is plumbing (an event bus, an envelope, an identity
 * helper), and sharing it says nothing about sharing a job. Chosen from the distribution on
 * 2026-09-14; field-reach's report prints the functions it set aside, so the choice can be read.
 */
export const GENERIC_CALLERS = 12;

/**
 * A call that says nothing about which job a unit does, however few tools make it: a lookup
 * (`storage.getAgent` linked 21 doors to 10 unrelated tools on 2026-09-14; the service lookup
 * `requireOwnCompany` made aimeat_company_update a twin of the invoice routes), or a utility,
 * middleware or auth helper (`utils/gaii.ts` linked 10). A shared job is a shared service or a
 * shared write. A function callee reads `file#line#name`.
 */
const LOOKUP = '(get|list|has|count|find|search|read|resolve|require|is|load|fetch)(?![a-z])';
export function isPlumbing(callee: string): boolean {
    return /^src\/(utils|middleware|auth)\//.test(callee)
        || new RegExp(`^storage\\.${LOOKUP}`).test(callee)
        || new RegExp(`#${LOOKUP}[A-Za-z0-9_]*$`).test(callee);
}

/**
 * Every field name declared by a record type anywhere the node declares one.
 *
 * A record is an interface, or a type alias of an object literal, whose name ends in `Record`.
 * Until 2026-09-14 only src/storage/types/ was read, and CompanyRecord lives in src/models/: the
 * report held no company field at all, which is why it could not see organism_id. Record types sit
 * in storage/types, models, commerce, services and routes, so the vocabulary is all of src/ except
 * src/cli/, whose records are the connector's own local state and not something a node surface
 * sets.
 *
 * Short and very common names are dropped: `id`, `name`, `key` and their like are taken by nearly
 * every door and answer nothing. The list is about fields specific enough that "only REST takes
 * this" means something.
 */
export function recordFields(files: readonly ts.SourceFile[]): Map<string, string[]> {
    const COMMON = new Set(['id', 'name', 'key', 'type', 'value', 'data', 'url', 'owner', 'status',
        'title', 'description', 'content', 'version', 'createdAt', 'updatedAt', 'gaii', 'scopes', 'tags']);
    const out = new Map<string, string[]>();
    const add = (record: string, members: ts.NodeArray<ts.TypeElement>): void => {
        for (const member of members) {
            if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
                const field = member.name.text;
                if (field.length < 5 || COMMON.has(field)) continue;
                const records = out.get(field) ?? [];
                if (!records.includes(record)) out.set(field, [...records, record]);
            }
        }
    };

    for (const source of files) {
        const path = source.fileName.split('\\').join('/');
        if (!path.includes('/src/') || path.includes('/src/cli/')) continue;
        const visit = (node: ts.Node): void => {
            if (ts.isInterfaceDeclaration(node) && /Record$/.test(node.name.text)) {
                add(node.name.text, node.members);
            } else if (ts.isTypeAliasDeclaration(node) && /Record$/.test(node.name.text) && ts.isTypeLiteralNode(node.type)) {
                add(node.name.text, node.type.members);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return out;
}

/**
 * One spelling for a field across the record and the wire: `organismId`, `organism_id` and
 * `organismid` are the same key. Matching only one spelling would report every snake_case tool
 * parameter as missing.
 */
export function canonical(name: string): string {
    return name.replace(/_/g, '').toLowerCase();
}

/**
 * Whether a tool's REST call (`/v1/companies/*`, where `*` is anything computed) can be the route
 * (`/v1/companies/:id`), segment by segment.
 *
 * A computed segment matches only a route PARAMETER, never a literal: `/v1/organisms/${id}/${action}`
 * is not POST /v1/organisms/:id/approvals just because `action` could spell it (measured 2026-09-14,
 * that is how aimeat_organism_archive became a twin of the approvals door). A literal segment matches
 * the same literal or a parameter. A `*` at the very end after literal text is a query string
 * (`/v1/agents/${name}/activity${query}`). A call whose first segment after /v1 is computed matches
 * nothing: it would twin with every route and lend its declared keys to all of them.
 */
export function pathMatches(toolPath: string, routePath: string): boolean {
    const path = toolPath.split('?')[0].replace(/([^/*])\*+$/, '$1');
    const tool = path.split('/');
    const route = routePath.split('/');
    if (tool.length !== route.length) return false;
    const head = tool[1] === 'v1' ? tool[2] : tool[1];
    if (!head || head.includes('*')) return false;
    return tool.every((seg, i) => {
        const r = route[i];
        const param = /^:[A-Za-z0-9_]+\??$/.test(r) || r === '*';
        if (seg.includes('*')) return param;
        return seg === r || param;
    });
}

export interface Door {
    /** `PUT /v1/companies/:id` */
    route: string;
    handler: string;
    /** `surface:tool` */
    twins: string[];
    /** Canonical record fields the handler reads, with one place each is read. */
    reads: Map<string, { field: string; at: string }>;
}

export interface Finding {
    /** The exemption key: `rest-only:<field> <route>` or `no-twin:<route>`. */
    key: string;
    kind: 'rest-only' | 'no-twin';
    route: string;
    /** For rest-only: the field as read, the record types declaring it, and where it is read. */
    field?: string;
    records?: string[];
    at?: string;
    twins?: string[];
    /** For no-twin: the record fields the door takes. */
    fields?: string[];
}

export interface Measurement {
    doors: Door[];
    findings: Finding[];
    /** Reads the measurement cannot place, per file: key not nameable, or request not on a route. */
    blind: { unnamed: Map<string, string[]>; unrouted: Map<string, string[]> };
    /** Functions set aside as plumbing, with how many node tools call each. */
    generic: [string, number][];
}

/**
 * The door-by-door measurement.
 *
 * @param fields   the vocabulary, from recordFields()
 * @param facts    the CodeQL facts
 * @param declared per surface, each tool's declared input keys (from mcp-capture.ts)
 */
export function doorReach(
    fields: ReadonlyMap<string, string[]>,
    facts: Facts,
    declared: Readonly<Record<AgentSurface, ReadonlyMap<string, readonly string[]>>>,
): Measurement {
    const vocabulary = new Map<string, { field: string; records: string[] }>();
    for (const [field, records] of fields) vocabulary.set(canonical(field), { field, records });

    // ── Blind spots ──
    const group = (rows: { file: string; where: string }[]): Map<string, string[]> => {
        const out = new Map<string, Set<string>>();
        for (const r of rows) out.set(r.file, (out.get(r.file) ?? new Set()).add(r.where));
        return new Map([...out].sort(([a], [b]) => a.localeCompare(b)).map(([f, s]) => [f, [...s].sort()]));
    };
    const blind = {
        unnamed: group(facts.reads.filter(r => r.naming === 'unnamed').map(r => ({ file: r.file, where: `${r.file}:${r.line}` }))),
        unrouted: group(facts.reads.filter(r => r.handler.startsWith('unrouted:') && r.naming !== 'unnamed')
            .map(r => ({ file: r.file, where: `${r.file}:${r.line} ${r.kind}.${r.field}` }))),
    };

    // ── Node tools twin through a shared function; plumbing is set aside ──
    const toolUnits = new Map<string, string[]>();
    for (const t of facts.tools) toolUnits.set(t.handler, [...(toolUnits.get(t.handler) ?? []), `${t.surface}:${t.name}`]);
    const callsOf = new Map<string, Set<string>>();
    for (const c of facts.calls) callsOf.set(c.unit, (callsOf.get(c.unit) ?? new Set()).add(c.callee));
    const nodeCallers = new Map<string, Set<string>>();
    for (const t of facts.tools) {
        if (t.surface !== 'mcp.node') continue;
        for (const callee of callsOf.get(t.handler) ?? []) nodeCallers.set(callee, (nodeCallers.get(callee) ?? new Set()).add(t.name));
    }
    const generic = [...nodeCallers].filter(([, s]) => s.size > GENERIC_CALLERS)
        .map(([callee, s]): [string, number] => [callee, s.size]).sort((a, b) => b[1] - a[1]);
    const genericSet = new Set(generic.map(([c]) => c));

    // ── Doors ──
    const readsOf = new Map<string, Map<string, { field: string; at: string }>>();
    for (const r of facts.reads) {
        if (r.naming === 'unnamed' || r.handler.startsWith('unrouted:')) continue;
        const k = canonical(r.field);
        if (!vocabulary.has(k)) continue;
        const m = readsOf.get(r.handler) ?? new Map();
        if (!m.has(k)) m.set(k, { field: r.field, at: `${r.file}:${r.line}` });
        readsOf.set(r.handler, m);
    }
    const doors: Door[] = [];
    const seenRoute = new Set<string>();
    for (const route of [...facts.routes].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`))) {
        const reads = readsOf.get(route.handler);
        if (!reads || reads.size === 0) continue;
        const name = `${route.method} ${route.path}`;
        if (seenRoute.has(`${name} ${route.handler}`)) continue;
        seenRoute.add(`${name} ${route.handler}`);
        const twins = new Set<string>();
        const shared = [...(callsOf.get(route.handler) ?? [])].filter(c => !genericSet.has(c) && !isPlumbing(c));
        for (const t of facts.tools) {
            if (t.surface === 'mcp.node') {
                const own = callsOf.get(t.handler);
                if (own && shared.some(c => own.has(c))) twins.add(`${t.surface}:${t.name}`);
            }
        }
        for (const h of facts.http) {
            const methodOk = route.method === 'ALL' || route.method === 'USE' || route.method === h.method;
            if (!methodOk || !pathMatches(h.path, route.path)) continue;
            for (const tool of toolUnits.get(h.unit) ?? []) if (!tool.startsWith('mcp.node:')) twins.add(tool);
        }
        doors.push({ route: name, handler: route.handler, twins: [...twins].sort(), reads });
    }

    // ── Findings ──
    const declaredOf = (twin: string): Set<string> => {
        const [surface, tool] = twin.split(/:(.*)/s) as [AgentSurface, string];
        return new Set((declared[surface]?.get(tool) ?? []).map(canonical));
    };
    const findings: Finding[] = [];
    for (const door of doors) {
        if (door.twins.length === 0) {
            findings.push({
                key: `no-twin:${door.route}`, kind: 'no-twin', route: door.route,
                fields: [...door.reads.values()].map(r => r.field).sort(),
            });
            continue;
        }
        const taken = new Set<string>();
        for (const twin of door.twins) for (const k of declaredOf(twin)) taken.add(k);
        for (const [k, read] of door.reads) {
            if (taken.has(k)) continue;
            findings.push({
                key: `rest-only:${vocabulary.get(k)!.field} ${door.route}`, kind: 'rest-only', route: door.route,
                field: read.field, records: vocabulary.get(k)!.records, at: read.at, twins: door.twins,
            });
        }
    }
    const byKey = new Map(findings.map(f => [f.key, f]));
    return {
        doors, blind, generic,
        findings: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
    };
}
