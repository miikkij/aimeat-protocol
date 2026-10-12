/**
 * @file test/unit/connect-serve-parity.test.ts
 * @description The rule that every node MCP tool is offered on both `aimeat connect serve`
 *   interfaces (the connector MCP and POST /local/call/<tool>), as scripts/inventory/
 *   connect-serve-parity.ts decides it.
 *
 *   THE CASE THAT WAS OPEN. Until 2026-10-12 the gate asked for a /local/call handler only where
 *   the catalog declared `cliFallback: true`. Thirty agent tools declared false, had no handler, and
 *   `check:mcp-tools` passed. The first case below is that tool: on the node MCP, declaring
 *   `cliFallback: false`, with no handler and no exemption. The comparison names it.
 *
 *   The last block reads the real tree: the real registrations, the real catalog and the real
 *   exemptions file must leave all four lists empty, and the exemptions must be exactly the node
 *   MCP tools that connect serve does not offer.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-serve-parity.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish: every MCP tool is offered by aimeat connect serve, and a gate holds it).
 */
import { describe, it, expect } from 'vitest';
import {
    connectServeParity, readExemptions, EXEMPTION_CEILING, type ParityInput,
} from '../../scripts/inventory/connect-serve-parity.js';
import { captureServer, captureConnector } from '../../scripts/inventory/mcp-capture.js';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/tool-catalog/definitions.js';

const everywhere = { publicMcp: true, connectorMcp: true, cliFallback: true };
const REASON = 'The tool reads the tool list of its own MCP session, and /local/call has no session list.';

/** One tool on all three interfaces, declared so. Each case changes one thing from here. */
function base(over: Partial<ParityInput> = {}): ParityInput {
    return {
        nodeMcp: new Set(['aimeat_memory_read']),
        connectorMcp: new Set(['aimeat_memory_read']),
        localCall: new Set(['aimeat_memory_read']),
        catalog: [{ name: 'aimeat_memory_read', visibility: everywhere }],
        exemptions: {},
        ceiling: 0,
        ...over,
    };
}
const clean = { notOnConnectServe: [], exemptionProblems: [], ceilingProblems: [], flagMismatches: [] };

describe('a node MCP tool is offered on both aimeat connect serve interfaces', () => {
    it('passes a tool that is on all three interfaces and says so', () => {
        expect(connectServeParity(base())).toEqual(clean);
    });

    it('refuses a node MCP tool that declares cliFallback: false and has no handler and no exemption', () => {
        const report = connectServeParity(base({
            nodeMcp: new Set(['aimeat_memory_read', 'aimeat_notify']),
            connectorMcp: new Set(['aimeat_memory_read', 'aimeat_notify']),
            catalog: [
                { name: 'aimeat_memory_read', visibility: everywhere },
                // What the catalog said on 2026-10-12, and it was true: the flags matched the code.
                { name: 'aimeat_notify', visibility: { publicMcp: true, connectorMcp: true, cliFallback: false } },
            ],
        }));
        expect(report.notOnConnectServe).toEqual(['aimeat_notify: no /local/call handler']);
        // The flags describe the code correctly, so the flag check alone would have passed it.
        expect(report.flagMismatches).toEqual([]);
    });

    it('refuses a node MCP tool that is on neither connect-serve interface, and names both', () => {
        const report = connectServeParity(base({ nodeMcp: new Set(['aimeat_memory_read', 'aimeat_admin_mint']) }));
        expect(report.notOnConnectServe).toEqual(['aimeat_admin_mint: not registered on the connector MCP, no /local/call handler']);
    });

    it('passes the same tool once the exemptions file names it with a reason', () => {
        const report = connectServeParity(base({
            nodeMcp: new Set(['aimeat_memory_read', 'aimeat_tools_find']),
            catalog: [
                { name: 'aimeat_memory_read', visibility: everywhere },
                { name: 'aimeat_tools_find', visibility: { publicMcp: true, connectorMcp: false, cliFallback: false } },
            ],
            exemptions: { aimeat_tools_find: REASON },
            ceiling: 1,
        }));
        expect(report).toEqual(clean);
    });

    it('refuses an exemption with no written reason, or with a placeholder for one', () => {
        for (const reason of ['', 'operator tool', 'Not yet reviewed: somebody should read the route before this is believed.']) {
            const report = connectServeParity(base({
                nodeMcp: new Set(['aimeat_memory_read', 'aimeat_tools_find']),
                catalog: [
                    { name: 'aimeat_memory_read', visibility: everywhere },
                    { name: 'aimeat_tools_find', visibility: { publicMcp: true, connectorMcp: false, cliFallback: false } },
                ],
                exemptions: { aimeat_tools_find: reason },
                ceiling: 1,
            }));
            expect(report.exemptionProblems, JSON.stringify(reason)).toHaveLength(1);
            expect(report.exemptionProblems[0]).toContain('aimeat_tools_find: no written reason');
        }
    });

    it('refuses an exemption whose tool is offered on both interfaces now, so the list shrinks', () => {
        const report = connectServeParity(base({ exemptions: { aimeat_memory_read: REASON }, ceiling: 1 }));
        expect(report.exemptionProblems).toEqual([
            'aimeat_memory_read: offered on both connect-serve interfaces now; delete the entry and lower EXEMPTION_CEILING',
        ]);
    });

    it('refuses an exemption for a name the node MCP does not register', () => {
        const report = connectServeParity(base({ exemptions: { aimeat_gone: REASON }, ceiling: 1 }));
        expect(report.exemptionProblems).toEqual(['aimeat_gone: not a node MCP tool, so there is nothing to exempt; delete the entry']);
    });

    it('refuses more exemptions than the ceiling, and fewer', () => {
        const input = base({
            nodeMcp: new Set(['aimeat_memory_read', 'aimeat_tools_find']),
            catalog: [
                { name: 'aimeat_memory_read', visibility: everywhere },
                { name: 'aimeat_tools_find', visibility: { publicMcp: true, connectorMcp: false, cliFallback: false } },
            ],
            exemptions: { aimeat_tools_find: REASON },
        });
        expect(connectServeParity({ ...input, ceiling: 0 }).ceilingProblems[0]).toContain("a new exemption is the developer's decision");
        expect(connectServeParity({ ...input, ceiling: 2 }).ceilingProblems[0]).toContain('lower EXEMPTION_CEILING to 1');
        expect(connectServeParity({ ...input, ceiling: 1 }).ceilingProblems).toEqual([]);
    });

    it('refuses a flag that does not say what is registered, in both directions, on each of the three', () => {
        const report = connectServeParity(base({
            nodeMcp: new Set(['aimeat_memory_read', 'aimeat_a', 'aimeat_c', 'aimeat_e']),
            connectorMcp: new Set(['aimeat_memory_read', 'aimeat_a', 'aimeat_b', 'aimeat_c', 'aimeat_d', 'aimeat_e']),
            localCall: new Set(['aimeat_memory_read', 'aimeat_a', 'aimeat_b', 'aimeat_c', 'aimeat_d', 'aimeat_f']),
            catalog: [
                { name: 'aimeat_memory_read', visibility: everywhere },
                // Registered on the connector, declared off it: the state of 21 tools on 2026-10-12.
                { name: 'aimeat_a', visibility: { publicMcp: true, connectorMcp: false, cliFallback: true } },
                // Declared on the node MCP, not registered there.
                { name: 'aimeat_b', visibility: everywhere },
                // Has a handler, declared without one.
                { name: 'aimeat_c', visibility: { publicMcp: true, connectorMcp: true, cliFallback: false } },
                // Declared off the node MCP and truly off it: no mismatch.
                { name: 'aimeat_d', visibility: { publicMcp: false, connectorMcp: true, cliFallback: true } },
                // Declared with a handler, has none.
                { name: 'aimeat_e', visibility: everywhere },
                // Declared on the connector MCP, not registered there.
                { name: 'aimeat_f', visibility: { publicMcp: false, connectorMcp: true, cliFallback: true } },
            ],
        }));
        expect(report.flagMismatches).toEqual([
            'aimeat_a: connectorMcp is false, and the tool is registered on the connector MCP',
            'aimeat_b: publicMcp is true, and the tool is not registered on the node MCP',
            'aimeat_c: cliFallback is false, and the tool is on the /local/call dispatch',
            'aimeat_e: cliFallback is true, and the tool is not on the /local/call dispatch',
            'aimeat_f: connectorMcp is true, and the tool is not registered on the connector MCP',
        ]);
    });
});

describe('the tree as it is', () => {
    const nodeMcp = new Set(captureServer().keys());
    const connectorMcp = new Set(captureConnector().keys());
    const localCall = new Set(CONNECT_CLI_TOOLS.map(t => t.name));
    const exemptions = readExemptions();
    const report = connectServeParity({
        nodeMcp, connectorMcp, localCall, exemptions,
        catalog: CLI_FALLBACK_TOOL_DEFINITIONS, ceiling: EXEMPTION_CEILING,
    });

    it('offers every node MCP tool on both connect-serve interfaces, or names it in the exemptions file', () => {
        expect(report.notOnConnectServe, report.notOnConnectServe.join('\n')).toEqual([]);
    });

    it('holds only exemptions that are true, reasoned, and as many as the ceiling', () => {
        expect(report.exemptionProblems, report.exemptionProblems.join('\n')).toEqual([]);
        expect(report.ceilingProblems, report.ceilingProblems.join('\n')).toEqual([]);
        // The exemptions are exactly the node MCP tools connect serve does not offer: no more, no fewer.
        const notOffered = [...nodeMcp].filter(n => !connectorMcp.has(n) || !localCall.has(n)).sort();
        expect(Object.keys(exemptions).sort()).toEqual(notOffered);
    });

    it('declares on every catalog tool the three interfaces it is registered on', () => {
        expect(report.flagMismatches, report.flagMismatches.join('\n')).toEqual([]);
    });
});
