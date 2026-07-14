/**
 * @file src/mcp/enterprise-tools.ts
 * @description Bridge between the EnterpriseProvider MCP seam and the MCP server: holds the
 *   boot-time registry of declarative EnterpriseMcpTool specs (set once from routes-loader via
 *   setEnterpriseMcpTools), converts their dependency-free field metadata to zod shapes, wraps
 *   their handlers in the standard tool-result envelope (JSON content; thrown {code,message} →
 *   isError), and registers them on every MCP session next to the core tools. Also feeds the
 *   dynamic halves of the catalog: tool→scope entries (catalog/scopes.ts dynamic map) and the
 *   /v2/mcp/enterprise surface extras (catalog/surfaces.ts). Community/stub: the registry stays
 *   empty and everything here is a no-op.
 * @structure setEnterpriseMcpTools · enterpriseMcpToolNames · registerEnterpriseMcpTools
 * @usage
 *   setEnterpriseMcpTools(await enterprise.getMcpTools?.() ?? []);   // boot (routes-loader)
 *   registerEnterpriseMcpTools(mcp, storage, config, () => agentGaii); // per session (mcp/index)
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial EE MCP tool bridge (provider getMcpTools seam)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { EnterpriseMcpTool, EnterpriseMcpToolField } from '../enterprise/provider.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { setDynamicToolScopes } from './catalog/scopes.js';
import { setEnterpriseSurfaceExtras } from './catalog/surfaces.js';
import { logger } from '../utils/logger.js';

let registry: EnterpriseMcpTool[] = [];

/**
 * Install the edition's tool specs (boot time, once per server). Rejects names that do not start
 * with `aimeat_` or that could shadow a core tool namespace ambiguously — the EE module extends
 * the surface, it never redefines core tools. Also publishes the dynamic scope map + the
 * enterprise-surface extras so the per-session gate and /v2/mcp/enterprise see the tools.
 */
export function setEnterpriseMcpTools(tools: EnterpriseMcpTool[]): void {
    const valid: EnterpriseMcpTool[] = [];
    for (const t of tools) {
        if (!/^aimeat_[a-z0-9_]+$/.test(t.name)) {
            logger.error(`[ee-mcp] rejected tool with invalid name "${t.name}" (must match aimeat_[a-z0-9_]+)`);
            continue;
        }
        valid.push(t);
    }
    registry = valid;
    const scopes: Record<string, string> = {};
    for (const t of valid) if (t.scope) scopes[t.name] = t.scope;
    setDynamicToolScopes(scopes);
    setEnterpriseSurfaceExtras(valid.map((t) => t.name));
    if (valid.length) logger.info(`[ee-mcp] ${valid.length} enterprise MCP tool(s) installed: ${valid.map(t => t.name).join(', ')}`);
}

/** Names currently contributed by the edition (empty on Community). */
export function enterpriseMcpToolNames(): string[] {
    return registry.map((t) => t.name);
}

/** Convert the declarative field metadata to the zod shape mcp.tool() expects. */
function zodShape(input: Record<string, EnterpriseMcpToolField> | undefined): Record<string, ZodTypeAny> {
    const shape: Record<string, ZodTypeAny> = {};
    for (const [name, field] of Object.entries(input ?? {})) {
        let t: ZodTypeAny;
        if (field.enum && field.enum.length > 0) t = z.enum(field.enum as [string, ...string[]]);
        else if (field.type === 'string') t = z.string();
        else if (field.type === 'number') t = z.number();
        else if (field.type === 'boolean') t = z.boolean();
        else if (field.type === 'array') t = z.array(z.unknown());
        else t = z.record(z.string(), z.unknown());
        if (field.description) t = t.describe(field.description);
        shape[name] = field.required ? t : t.optional();
    }
    return shape;
}

/** Register every edition tool on one MCP session (no-op on Community). */
export function registerEnterpriseMcpTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    if (registry.length === 0) return;
    const agentGaii = getAgentGaii();
    const owner = parseGaiiLoose(agentGaii).owner;
    const session = {
        agentGaii,
        owner,
        ownerGhii: `${owner}@${config.nodeId}`,
        // Same runtime self-gate the core admin tools use (core-admin.ts isOperator).
        async isOperator(): Promise<boolean> {
            const rec = await storage.getOwner(owner);
            return !!rec && rec.roles.includes('operator');
        },
    };
    for (const spec of registry) {
        mcp.tool(
            spec.name,
            spec.description,
            zodShape(spec.input),
            spec.annotations,
            async (args: Record<string, unknown>) => {
                try {
                    const result = await spec.handler(args ?? {}, session);
                    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null, null, 2) }] };
                } catch (err) {
                    const e = err as { code?: string; message?: string };
                    return { content: [{ type: 'text' as const, text: `${e.code ?? 'ENTERPRISE_ERROR'}: ${e.message ?? 'Tool failed'}` }], isError: true as const };
                }
            },
        );
    }
}
