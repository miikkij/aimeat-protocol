/**
 * @file test/unit/crew-default-tools.test.ts
 * @description The tools a default crew daemon liaison loads (python/aimeat-crewai,
 *   DAEMON_DEFAULT_TOOL_FILTER in daemon.py) against what `aimeat connect serve` registers.
 *
 *   The liaison refuses to start when its filter names a tool the MCP server did not expose. The
 *   Python package and the connector are released separately (PyPI and npm), and nothing compared
 *   the two lists: a name misspelled in daemon.py, or a tool renamed on the node, would stop every
 *   default crew at start. This reads the Python tuple from its source and holds each name to the
 *   connector's registration.
 *
 *   The names in DAEMON_TOOLS_IF_OFFERED are loaded when offered and left out otherwise, so they
 *   may be missing from a narrower surface. The other names are required, and the connector's
 *   `agent` surface, the narrowest one a crew is served from, carries every one of them.
 * @usage cd aimeat && pnpm exec vitest run test/unit/crew-default-tools.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial, with aimeat-crewai 0.35.0 (the default list gains aimeat_discover,
 *     aimeat_invoke, aimeat_mcp_list, aimeat_mcp_tools and aimeat_mcp_call).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { captureConnector } from '../../scripts/inventory/mcp-capture.js';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import { toolsForSurface } from '../../src/tool-catalog/surfaces.js';

const daemonSource = readFileSync(new URL('../../../python/aimeat-crewai/src/aimeat_crewai/daemon.py', import.meta.url), 'utf8');

/** The string members of one Python tuple assignment, comments left out. */
function pythonTuple(name: string): string[] {
    const start = daemonSource.indexOf(`${name}: tuple[str, ...] = (`);
    if (start < 0) throw new Error(`${name} is not a tuple in daemon.py`);
    const body = daemonSource.slice(start, daemonSource.indexOf('\n)\n', start));
    return body.split('\n')
        .map(line => line.replace(/#.*$/, '').trim())
        .flatMap(line => [...line.matchAll(/"(aimeat_[a-z0-9_]+)"/g)].map(m => m[1]!));
}

const defaults = pythonTuple('DAEMON_DEFAULT_TOOL_FILTER');
const ifOffered = pythonTuple('DAEMON_TOOLS_IF_OFFERED');
const required = defaults.filter(name => !ifOffered.includes(name));

describe("the crew daemon's default tools exist on aimeat connect serve", () => {
    it('reads both lists from daemon.py', () => {
        // 32 since aimeat-crewai 0.38.0: aimeat_goal_get and aimeat_goal_work, loaded when offered.
        expect(defaults).toHaveLength(32);
        expect(new Set(defaults).size).toBe(32);
        expect([...ifOffered].sort()).toEqual(['aimeat_discover', 'aimeat_goal_get', 'aimeat_goal_work', 'aimeat_invoke', 'aimeat_mcp_call', 'aimeat_mcp_list', 'aimeat_mcp_tools']);
        expect(ifOffered.filter(name => !defaults.includes(name))).toEqual([]);
    });

    it('registers every default tool on the connector MCP and on the /local/call dispatch', () => {
        const connector = new Set(captureConnector().keys());
        const localCall = new Set(CONNECT_CLI_TOOLS.map(tool => tool.name));
        expect(defaults.filter(name => !connector.has(name)), 'not on the connector MCP').toEqual([]);
        expect(defaults.filter(name => !localCall.has(name)), 'no /local/call handler').toEqual([]);
    });

    it('carries every REQUIRED tool on the agent surface, so `--surface agent` cannot stop a start', () => {
        const agent = toolsForSurface('agent');
        expect(required.filter(name => !agent.has(name))).toEqual([]);
    });

    it('marks as loaded-if-offered every default tool the agent surface does not carry', () => {
        const agent = toolsForSurface('agent');
        const missing = defaults.filter(name => !agent.has(name));
        // Today: aimeat_invoke and the three aimeat_mcp_* tools. Each must be in the lenient list.
        expect(missing.filter(name => !ifOffered.includes(name))).toEqual([]);
    });
});
