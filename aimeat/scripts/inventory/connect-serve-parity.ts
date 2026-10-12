/**
 * @file scripts/inventory/connect-serve-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rule that every tool this node offers over MCP is also offered by `aimeat connect
 *   serve`, on both of its interfaces, as a comparison of names: what the node MCP registers, what
 *   the connector MCP registers, and what has a handler behind POST /local/call/<tool>
 *   (CONNECT_CLI_TOOLS), against the catalog's three visibility flags and the written exemptions in
 *   security/connect-serve-parity-exemptions.json.
 *
 *   WHY IT EXISTS. On 2026-10-12, 34 catalog tools had no /local/call handler, 30 of them agent
 *   tools (contacts, companies, beneficiary splits, exchange work and proposals, organism owners and
 *   email invitations, notify, the usage report, app-tool invoke), and `check:mcp-tools` passed. It
 *   passed because the audit asked for a handler only where the catalog declared
 *   `visibility.cliFallback: true`: a tool that declared false was outside the check, nothing asked
 *   why it said false, and nothing counted how many did. A flag that the tool's own author sets
 *   cannot be the thing that decides whether the tool is checked. And 21 of those 30 declared
 *   `connectorMcp: false` while the connector registered them, because nothing compared a flag with
 *   a registration either.
 *
 *   So this compares registrations, never declarations, and then holds the declarations to them:
 *     - a node MCP tool that is not on the connector MCP, or has no /local/call handler, fails
 *       unless the exemptions file names it with a reason;
 *     - an exemption whose tool is offered on both interfaces (or is not a node MCP tool) fails
 *       until the entry is deleted, and an entry without a written reason fails;
 *     - the number of exemptions is EXEMPTION_CEILING, so the list only shrinks;
 *     - each of a catalog tool's three flags says what is registered, in both directions.
 *
 *   The comparison is a pure function of its input, so test/unit/connect-serve-parity.test.ts can
 *   show it refusing each of those cases without a node, a connector or a file.
 * @structure
 *   - EXEMPTION_CEILING, EXEMPTIONS_PATH
 *   - readExemptions(): the exemptions file's entries
 *   - connectServeParity(input): the four lists that must stay empty
 * @usage
 *   import { connectServeParity, readExemptions, EXEMPTION_CEILING } from './inventory/connect-serve-parity.js';
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish: every MCP tool is offered by aimeat connect serve, and a gate holds it).
 */
import { readFileSync } from 'node:fs';

export const EXEMPTIONS_PATH = new URL('../../security/connect-serve-parity-exemptions.json', import.meta.url);

/**
 * How many exemptions there are. The gate fails when the file holds more (a new exemption is the
 * developer's decision, and raising this number is how that decision is made visible in a diff) and
 * when it holds fewer (lower the number in the change that deleted the entry, so the next one
 * cannot quietly take its place).
 */
export const EXEMPTION_CEILING = 4;

/** An entry's reason is a sentence somebody wrote after reading the code, not a marker. */
const MIN_REASON_LENGTH = 40;
const PLACEHOLDER = /\b(not yet reviewed|unreviewed|todo|tbd|debt)\b/i;

export interface CatalogFlags {
    name: string;
    visibility: { publicMcp: boolean; connectorMcp: boolean; cliFallback: boolean };
}

export interface ParityInput {
    /** Tool names the node MCP registers. */
    nodeMcp: ReadonlySet<string>;
    /** Tool names the connector MCP registers. */
    connectorMcp: ReadonlySet<string>;
    /** Tool names with a handler behind POST /local/call/<tool>. */
    localCall: ReadonlySet<string>;
    catalog: readonly CatalogFlags[];
    /** Tool name → the written reason it is not offered on both connect-serve interfaces. */
    exemptions: Readonly<Record<string, string>>;
    ceiling: number;
}

export interface ParityReport {
    /** Node MCP tools missing from a connect-serve interface, with no exemption. */
    notOnConnectServe: string[];
    /** Exemptions that no longer describe the code, or carry no reason. */
    exemptionProblems: string[];
    /** The exemption count against the ceiling. */
    ceilingProblems: string[];
    /** Catalog flags that do not say what is registered. */
    flagMismatches: string[];
}

export function readExemptions(): Record<string, string> {
    return (JSON.parse(readFileSync(EXEMPTIONS_PATH, 'utf8')) as { exempt?: Record<string, string> }).exempt ?? {};
}

/** Which connect-serve interfaces a node MCP tool is missing from; empty when it is on both. */
function missingFrom(name: string, input: ParityInput): string[] {
    const missing: string[] = [];
    if (!input.connectorMcp.has(name)) missing.push('not registered on the connector MCP');
    if (!input.localCall.has(name)) missing.push('no /local/call handler');
    return missing;
}

export function connectServeParity(input: ParityInput): ParityReport {
    const exempt = new Set(Object.keys(input.exemptions));

    const notOnConnectServe = [...input.nodeMcp].sort()
        .filter(name => !exempt.has(name))
        .map(name => ({ name, missing: missingFrom(name, input) }))
        .filter(row => row.missing.length > 0)
        .map(row => `${row.name}: ${row.missing.join(', ')}`);

    const exemptionProblems: string[] = [];
    for (const [name, reason] of Object.entries(input.exemptions).sort(([a], [b]) => a.localeCompare(b))) {
        if (!input.nodeMcp.has(name)) {
            exemptionProblems.push(`${name}: not a node MCP tool, so there is nothing to exempt; delete the entry`);
        } else if (missingFrom(name, input).length === 0) {
            exemptionProblems.push(`${name}: offered on both connect-serve interfaces now; delete the entry and lower EXEMPTION_CEILING`);
        }
        if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH || PLACEHOLDER.test(reason)) {
            exemptionProblems.push(`${name}: no written reason; an entry says what the code shows that keeps the tool off connect serve`);
        }
    }

    const ceilingProblems: string[] = [];
    if (exempt.size > input.ceiling) {
        ceilingProblems.push(`${exempt.size} exemptions, the ceiling is ${input.ceiling}: a new exemption is the developer's decision`);
    } else if (exempt.size < input.ceiling) {
        ceilingProblems.push(`${exempt.size} exemptions, the ceiling is ${input.ceiling}: lower EXEMPTION_CEILING to ${exempt.size}, the list only shrinks`);
    }

    const flagMismatches: string[] = [];
    for (const tool of [...input.catalog].sort((a, b) => a.name.localeCompare(b.name))) {
        const wrong: string[] = [];
        const check = (flag: string, declared: boolean, registered: boolean, what: string): void => {
            if (declared !== registered) wrong.push(`${flag} is ${declared}, and the tool is ${registered ? '' : 'not '}${what}`);
        };
        check('publicMcp', tool.visibility.publicMcp, input.nodeMcp.has(tool.name), 'registered on the node MCP');
        check('connectorMcp', tool.visibility.connectorMcp, input.connectorMcp.has(tool.name), 'registered on the connector MCP');
        check('cliFallback', tool.visibility.cliFallback, input.localCall.has(tool.name), 'on the /local/call dispatch');
        if (wrong.length) flagMismatches.push(`${tool.name}: ${wrong.join('; ')}`);
    }

    return { notOnConnectServe, exemptionProblems, ceilingProblems, flagMismatches };
}
