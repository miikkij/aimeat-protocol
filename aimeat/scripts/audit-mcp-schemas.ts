/**
 * @file audit-mcp-schemas.ts
 * @description F10 schema-level drift audit. The name-level audit (audit-mcp-tools.ts) proves the two
 *   MCP surfaces expose the same tool NAMES; this proves they expose the same INPUT SHAPE, and that
 *   the shared catalog's input metadata matches. It works by feeding a fake MCP server to the real
 *   registerXxxTools()/registerAllTools() functions and recording each tool's input-schema keys at
 *   registration time (handlers never run), then diffing:
 *     - server /v1/mcp  vs  connector stdio   (the two live surfaces — must match; this is the gate)
 *     - each surface     vs  catalog `input`   (informational — catalog drives CLI-fallback schema)
 * @structure
 *   - captureServer() / captureConnector() — register against a Proxy fake-MCP, collect schema keys
 *   - main() — diff report; --check gates input drift only, --strict adds v2 surface coverage
 * @usage
 *   pnpm audit:mcp-schemas
 *   pnpm check:mcp-schemas               # pre-commit + CI gate (input drift only)
 *   pnpm audit:mcp-schemas -- --strict   # full report, both axes
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 6 (F10): runtime schema-parity audit
 *   v1.1.0 -- 2026-08-16 -- --check mode, and wired into the pre-commit hook at last. This script
 *     had named the aimeat_task_complete/deliverable_key drift on its own line since the day the
 *     parameter was added, and nothing ran it: a crew found the defect instead, by building an agent
 *     that lost its own output. An audit nobody runs is a document, not a gate. The nine remaining
 *     drifts are recorded in KNOWN_INPUT_DRIFT with what each one costs a caller.
 */
import type { AimeatConfig } from '../src/config.js';
import type { Storage } from '../src/storage/interface.js';
import type { AgentRegistry } from '../src/cli/connect/agent-registry.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../src/mcp/catalog/definitions.js';
import { MCP_SURFACES, V2_ROLES, validateSurfaces } from '../src/mcp/catalog/surfaces.js';

// ── Server register functions (mirror src/mcp/index.ts) ──
import { registerCoreTools } from '../src/mcp/core.js';
import { registerBoardsTools } from '../src/mcp/boards.js';
import { registerOrganismsTools } from '../src/mcp/organisms.js';
import { registerKnowledgeTools } from '../src/mcp/knowledge.js';
import { registerExtensionsTools } from '../src/mcp/extensions.js';
import { registerCatalogueTools } from '../src/mcp/catalogue.js';
import { registerMemoryExtendedTools } from '../src/mcp/memory-extended.js';
import { registerWalletExtendedTools } from '../src/mcp/wallet-extended.js';
import { registerConsentTools } from '../src/mcp/consent.js';
import { registerChatInstancesTools } from '../src/mcp/chat-instances.js';
import { registerFlagsTools } from '../src/mcp/flags.js';
import { registerPromptsTools } from '../src/mcp/prompts.js';
import { registerCapabilitiesTools } from '../src/mcp/capabilities.js';
import { registerCortexTools } from '../src/mcp/cortex.js';
import { registerAppsTools } from '../src/mcp/apps.js';
import { registerSharingGroupTools } from '../src/mcp/sharing-groups.js';
import { registerAgentTaskTools } from '../src/mcp/agent-tasks.js';
import { registerAgentCapabilityTools } from '../src/mcp/agent-capabilities.js';
import { registerAgentMessageTools } from '../src/mcp/agent-messages.js';
import { registerAgentOnboardingTools } from '../src/mcp/agent-onboarding.js';
import { registerAgentTelemetryTools } from '../src/mcp/agent-telemetry.js';
import { registerAgentManagementTools } from '../src/mcp/agent-management.js';

// ── Connector register entrypoint ──
import { registerAllTools } from '../src/cli/connect/mcp/tools/index.js';

interface CapturedTool {
    inputKeys: string[];
    hasOutputSchema: boolean;
}

/** Extract the top-level input-schema keys from an mcp.tool(...) call's arguments. */
function keysFromToolArgs(args: unknown[]): string[] {
    // Codebase forms: tool(name, descString, schemaObj, annObj?, handler) or tool(name, schemaObj, handler)
    const candidate = typeof args[1] === 'string' ? args[2] : args[1];
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? Object.keys(candidate) : [];
}

/** A Proxy that satisfies whatever the register functions call; records tool registrations. */
function makeFakeMcp(sink: Map<string, CapturedTool>) {
    const server = {};
    return new Proxy({} as Record<string, unknown>, {
        get(_t, prop: string) {
            if (prop === 'server') return server;
            if (prop === 'tool') {
                return (...args: unknown[]) => {
                    sink.set(args[0] as string, { inputKeys: keysFromToolArgs(args), hasOutputSchema: false });
                    return undefined;
                };
            }
            if (prop === 'registerTool') {
                return (...args: unknown[]) => {
                    const cfg = (args[1] ?? {}) as { inputSchema?: object; outputSchema?: unknown };
                    sink.set(args[0] as string, {
                        inputKeys: cfg.inputSchema ? Object.keys(cfg.inputSchema) : [],
                        hasOutputSchema: cfg.outputSchema !== undefined,
                    });
                    return undefined;
                };
            }
            return () => undefined; // resource / registerResource / prompt / etc. — no-op
        },
        set() { return true; },
    });
}

function captureServer(): Map<string, CapturedTool> {
    const sink = new Map<string, CapturedTool>();
    const mcp = makeFakeMcp(sink) as never;
    const storage = {} as Storage;
    const config = { nodeId: 'audit-node', baseUrl: 'http://localhost', mcpEnforceScopes: true } as unknown as AimeatConfig;
    const gaii = () => 'auditor#owner@audit-node';
    const noop = () => { };
    const reg = [
        registerCoreTools, registerBoardsTools, registerOrganismsTools, registerKnowledgeTools,
        registerExtensionsTools, registerCatalogueTools, registerMemoryExtendedTools, registerWalletExtendedTools,
        registerConsentTools, registerChatInstancesTools, registerFlagsTools, registerPromptsTools,
        registerCapabilitiesTools, registerCortexTools, registerAppsTools, registerSharingGroupTools,
        registerAgentTaskTools, registerAgentCapabilityTools, registerAgentMessageTools,
        registerAgentTelemetryTools, registerAgentOnboardingTools, registerAgentManagementTools,
    ];
    for (const fn of reg) fn(mcp, storage, config, gaii, noop, noop);
    return sink;
}

function captureConnector(): Map<string, CapturedTool> {
    const sink = new Map<string, CapturedTool>();
    // Some connector modules call registry.resolve()/list() at registration time, so stub them.
    const fakeAgent = { client: new Proxy({}, { get: () => () => undefined }), agent: 'auditor', owner: 'owner' };
    const fakeRegistry = new Proxy({}, {
        get(_t, prop: string) {
            if (prop === 'list') return () => [fakeAgent];
            if (prop === 'size') return () => 1;
            return () => fakeAgent; // resolve() and anything else
        },
    }) as unknown as AgentRegistry;
    registerAllTools(makeFakeMcp(sink) as never, fakeRegistry);
    return sink;
}

/** Connector tools carry an extra agent-routing param; it is an intentional difference, not drift. */
const CONNECTOR_EXTRA = new Set(['agent_name']);

/**
 * Baseline of PRE-EXISTING server↔connector input-schema drift (captured 2026-05-30). The two
 * surfaces evolved separately (server uses storage directly with REST-style params; connector wraps
 * REST with its own param names), so ~50 shared tools disagree on input keys. Reconciling them is a
 * dedicated effort (pairs with Phase 5 signature normalization). Until then this baseline lets
 * `--strict` act as a RATCHET: it fails on NEW drift (a tool not listed here), but tolerates the
 * known debt. Prune names from this set as each tool's two surfaces are reconciled.
 */
const KNOWN_INPUT_DRIFT = new Set<string>([
    // intentional: server MCP app_* tools manage HTML apps via /v1/apps (owner/filename, content_base64),
    // connector app_* tools manage component packages via /v1/packages (group_id, content). These are two
    // different backends sharing the app_* name; unifying them is tool-consolidation (audit Phase 5), not
    // input-schema reconciliation — switching the connector's target route would change behavior.
    'aimeat_app_delete', 'aimeat_app_get', 'aimeat_app_list', 'aimeat_app_publish', 'aimeat_app_versions',
    // intentional: server MCP handbook_get returns managed system prompts by `tier` (/v1/prompts/:tier),
    // connector handbook_get returns the agent operating handbook by `module` (/v1/agents/me/handbook/:module).
    // Two different resources sharing the tool name; unifying them is a semantic decision for consolidation.
    'aimeat_handbook_get',
    // intentional: server MCP instance_create targets chat-instances (model -> derived platform),
    // connector instance_create targets package instances (template); two different concepts.
    'aimeat_instance_create',

    // ── NOT intentional. Recorded 2026-08-16, when this audit was wired into the pre-commit gate. ──
    //
    // These nine are the same defect crewaimeat-dev hit on aimeat_task_complete: a capability was
    // added to the server MCP tool and the connector's copy was left behind, so zod strips the
    // parameter from the call before it leaves the client and the operation succeeds having quietly
    // done less than it was asked. They are listed rather than fixed in the same pass because each
    // needs its own verification against the REST door it forwards to, and one of them
    // (memory_write.expected_version) needs a REST change first: POST /v1/memory has no optimistic
    // lock, the server MCP calls the write service directly, and the PUT route spells it `version`.
    //
    // This list is a DEBT REGISTER, not an approval. Each entry names what a connector caller
    // cannot currently reach.
    // memory_read is RECONCILED and off this list. The other two keep one parameter each, and both
    // need a REST change first rather than a connector line:
    'aimeat_memory_write',       // expected_version — POST /v1/memory has no optimistic lock at all; the server MCP calls the write service directly and the PUT route spells it `version`
    'aimeat_memory_search',      // include_versions — GET /v1/memory/search does not read it; the server MCP applies the filter itself
    'aimeat_extension_install',  // activate, update
    'aimeat_knowledge_contribute', // model
    'aimeat_capabilities_create',  // status
    'aimeat_capabilities_update',  // status
    'aimeat_app_draft_publish',  // spec_ack, spec_token — belongs to the app_* two-backends debt above
    'aimeat_app_draft_save',     // content_base64 vs content — same app_* debt
]);

function diffKeys(serverKeys: string[], connectorKeys: string[]): { onlyServer: string[]; onlyConnector: string[] } {
    const s = new Set(serverKeys);
    const c = new Set(connectorKeys.filter(k => !CONNECTOR_EXTRA.has(k)));
    return {
        onlyServer: [...s].filter(k => !c.has(k)).sort(),
        onlyConnector: [...c].filter(k => !s.has(k)).sort(),
    };
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const check = process.argv.includes('--check');
    const server = captureServer();
    const connector = captureConnector();
    const catalog = new Map(CLI_FALLBACK_TOOL_DEFINITIONS.map(d => [d.name, Object.keys(d.input ?? {})]));

    const shared = [...server.keys()].filter(n => connector.has(n)).sort();

    const driftDetail = new Map<string, string>();
    const catalogDrift: string[] = [];
    const outputSchemaTools: string[] = [];

    for (const name of shared) {
        const sv = server.get(name)!;
        const cn = connector.get(name)!;
        const d = diffKeys(sv.inputKeys, cn.inputKeys);
        if (d.onlyServer.length || d.onlyConnector.length) {
            driftDetail.set(name, `  ${name}: server-only [${d.onlyServer.join(', ')}] | connector-only [${d.onlyConnector.join(', ')}]`);
        }
        if (sv.hasOutputSchema) outputSchemaTools.push(name);
    }

    const newDrift = [...driftDetail.keys()].filter(n => !KNOWN_INPUT_DRIFT.has(n)).sort();
    const knownDrift = [...driftDetail.keys()].filter(n => KNOWN_INPUT_DRIFT.has(n)).sort();
    const staleBaseline = [...KNOWN_INPUT_DRIFT].filter(n => shared.includes(n) && !driftDetail.has(n)).sort();

    // Catalog vs server input keys (informational — catalog drives CLI-fallback schema display)
    for (const name of [...server.keys()].sort()) {
        const cat = catalog.get(name);
        if (!cat) { catalogDrift.push(`  ${name}: MISSING from catalog`); continue; }
        const sv = server.get(name)!.inputKeys.filter(k => k !== 'response_format');
        const onlyCat = cat.filter(k => !sv.includes(k));
        const onlySurface = sv.filter(k => !cat.includes(k));
        if (onlyCat.length || onlySurface.length) {
            catalogDrift.push(`  ${name}: catalog-only [${onlyCat.join(', ')}] | server-only [${onlySurface.join(', ')}]`);
        }
    }

    console.log('# MCP Schema-Parity Audit (F10)\n');
    console.log(`Server tools:        ${server.size}`);
    console.log(`Connector tools:     ${connector.size}`);
    console.log(`Shared tools:        ${shared.length}`);
    console.log(`Tools w/ outputSchema (server): ${outputSchemaTools.length} [${outputSchemaTools.join(', ')}]`);

    console.log(`\n## NEW server↔connector drift (GATE — must be 0) — ${newDrift.length}`);
    console.log(newDrift.length ? newDrift.map(n => driftDetail.get(n)).join('\n') : '  None. No new drift beyond the known baseline.');

    console.log(`\n## Known/baselined drift (pre-existing debt to reconcile) — ${knownDrift.length}`);
    console.log(knownDrift.length ? knownDrift.map(n => driftDetail.get(n)).join('\n') : '  None.');

    if (staleBaseline.length) {
        console.log(`\n## Baseline entries that no longer drift (prune from KNOWN_INPUT_DRIFT) — ${staleBaseline.length}`);
        console.log(staleBaseline.map(n => `  ${n}`).join('\n'));
    }

    console.log(`\n## Catalog input metadata drift (informational) — ${catalogDrift.length}`);
    console.log(catalogDrift.length ? catalogDrift.join('\n') : '  None.');

    // ── v2 surface coverage (every surface tool must be REGISTERED on the server) ──
    const serverNames = new Set(server.keys());
    const { unknownTools, uncovered } = validateSurfaces();
    const surfaceUnregistered: string[] = [];
    console.log(`\n## v2 surface coverage`);
    for (const role of V2_ROLES) {
        const tools = MCP_SURFACES[role];
        const missing = tools.filter(t => !serverNames.has(t));
        for (const m of missing) surfaceUnregistered.push(`${role}:${m}`);
        console.log(`  ${role.padEnd(8)} ${tools.length} tools${missing.length ? `  ✖ not server-registered: ${missing.join(', ')}` : '  ✓'}`);
    }
    if (unknownTools.length) console.log(`  ✖ unknown (not in catalog): ${unknownTools.join(', ')}`);
    if (uncovered.length) console.log(`  ⚠ catalog tools in no surface & not excluded: ${uncovered.join(', ')}`);

    const surfaceFail = surfaceUnregistered.length > 0 || unknownTools.length > 0 || uncovered.length > 0;

    // --check is the PRE-COMMIT gate and it watches ONE axis: a parameter that exists on one MCP
    // surface and not the other. That axis is a silent-wrong-answer bug — zod strips the unknown key,
    // the call returns ok, and the caller is told nothing — which is why it earns a blocking check.
    //
    // It deliberately does NOT gate v2 surface coverage. That list is long, it is about tools served
    // by a different registration path (appdev, workspaces, exchange), and reconciling it is its own
    // piece of work; folding it in here would mean the gate could never go green and would therefore
    // be turned off, which is how this audit came to sit unwired for two and a half months in the
    // first place. --strict keeps both axes for the full report.
    if (check && newDrift.length > 0) {
        console.error(`\n✖ ${newDrift.length} NEW server↔connector input-schema drift(s) beyond the baseline:`);
        for (const n of newDrift) console.error(`  ${driftDetail.get(n)?.trim()}`);
        console.error('\nA parameter on one surface and not the other is stripped in silence: the call'
            + '\nsucceeds and does less than it was asked. Declare it on BOTH surfaces and forward it,'
            + '\nor add it to KNOWN_INPUT_DRIFT with a line saying what a caller cannot reach.');
        process.exit(1);
    }
    if (strict && (newDrift.length > 0 || surfaceFail)) {
        if (newDrift.length) console.error(`\n✖ STRICT: ${newDrift.length} NEW server↔connector input-schema drift(s) beyond the baseline.`);
        if (surfaceUnregistered.length) console.error(`✖ STRICT: surface tools not registered on the server: ${surfaceUnregistered.join(', ')}`);
        if (unknownTools.length) console.error(`✖ STRICT: surface tools not in catalog: ${unknownTools.join(', ')}`);
        if (uncovered.length) console.error(`✖ STRICT: catalog tools placed in no surface (and not excluded): ${uncovered.join(', ')}`);
        process.exit(1);
    }
    console.log(`\n✓ Schema audit complete (${knownDrift.length} known drifts tracked, ${newDrift.length} new; v2 surfaces ${surfaceFail ? 'HAVE ISSUES' : 'OK'}).`);
}

main();
