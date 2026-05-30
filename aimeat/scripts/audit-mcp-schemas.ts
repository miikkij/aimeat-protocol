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
 *   - main() — diff report; --strict exits 1 on server↔connector input drift
 * @usage
 *   pnpm audit:mcp-schemas
 *   pnpm audit:mcp-schemas -- --strict   # CI gate
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 6 (F10): runtime schema-parity audit
 */
import type { AimeatConfig } from '../src/config.js';
import type { Storage } from '../src/storage/interface.js';
import type { AgentRegistry } from '../src/cli/connect/agent-registry.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../src/mcp/catalog/definitions.js';

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
    'aimeat_action_execute', 'aimeat_admin_agents', 'aimeat_agent_activity', 'aimeat_app_delete',
    'aimeat_app_get', 'aimeat_app_list', 'aimeat_app_publish', 'aimeat_app_versions',
    'aimeat_board_create', 'aimeat_board_members', 'aimeat_board_post', 'aimeat_board_read',
    'aimeat_board_subscribe', 'aimeat_capabilities_create', 'aimeat_capabilities_invoke',
    'aimeat_capabilities_list', 'aimeat_capabilities_update', 'aimeat_capabilities_vouch',
    'aimeat_catalogue_agents', 'aimeat_catalogue_directory', 'aimeat_catalogue_search',
    'aimeat_consent_grant', 'aimeat_consent_revoke', 'aimeat_cortex_install', 'aimeat_extension_install',
    'aimeat_extension_invoke', 'aimeat_flag_report', 'aimeat_group_add_member', 'aimeat_group_create',
    'aimeat_group_get', 'aimeat_group_remove_member', 'aimeat_handbook_get', 'aimeat_instance_create',
    'aimeat_instance_status', 'aimeat_knowledge_contribute', 'aimeat_knowledge_get',
    'aimeat_knowledge_links', 'aimeat_memory_search', 'aimeat_memory_write', 'aimeat_message_send',
    'aimeat_organism_get', 'aimeat_organism_join', 'aimeat_organism_leave', 'aimeat_organism_members',
    'aimeat_storage_upload', 'aimeat_task_complete', 'aimeat_task_event', 'aimeat_task_fail',
    'aimeat_task_list', 'aimeat_work_deliver',
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

    if (strict && newDrift.length > 0) {
        console.error(`\n✖ STRICT: ${newDrift.length} NEW server↔connector input-schema drift(s) beyond the baseline. Reconcile the two surfaces or (if intentional) update KNOWN_INPUT_DRIFT.`);
        process.exit(1);
    }
    console.log(`\n✓ Schema audit complete (${knownDrift.length} known drifts tracked, ${newDrift.length} new).`);
}

main();
