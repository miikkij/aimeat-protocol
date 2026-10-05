/**
 * @file onboarding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for Hello Integration onboarding status
 *   and API-confirmed onboarding steps.
 * @structure Registers status plus convenience confirmation tools for platform,
 *   skill bundle installation, directives, and optional service declarations.
 * @usage Called by the `aimeat connect serve` MCP server.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-05-28 -- Add onboarding tools for connected agents
 *   v1.0.1 -- 2026-05-28 -- Describe Hello Integration as required first-run onboarding
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, envelopeResult, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerOnboardingTools(mcp: McpServer, registry: AgentRegistry): void {

    mcp.tool('aimeat_onboarding_status', descriptionFor('aimeat_onboarding_status'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_onboarding_status') }, annotationsFor('aimeat_onboarding_status'), async ({ agent_name }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const resp = await client.get(`/v1/agents/${enc}/onboarding`);
        return envelopeResult(resp);
    });

    mcp.tool('aimeat_onboarding_identify_platform', descriptionFor('aimeat_onboarding_identify_platform'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_onboarding_identify_platform') }, annotationsFor('aimeat_onboarding_identify_platform'), async ({ agent_name, platform, platform_version, model }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const body: Record<string, unknown> = { platform };
        if (platform_version) body.platform_version = platform_version;
        if (model) body.model = model;
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/identify_platform`, body);
        return envelopeResult(resp);
    });

    mcp.tool('aimeat_onboarding_confirm_skill_installed', descriptionFor('aimeat_onboarding_confirm_skill_installed'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_onboarding_confirm_skill_installed') }, annotationsFor('aimeat_onboarding_confirm_skill_installed'), async ({ agent_name, platform, version }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/install_skill`, { platform, version });
        return envelopeResult(resp);
    });

    mcp.tool('aimeat_onboarding_confirm_directives_read', descriptionFor('aimeat_onboarding_confirm_directives_read'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_onboarding_confirm_directives_read') }, annotationsFor('aimeat_onboarding_confirm_directives_read'), async ({ agent_name, confirmed }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/read_directives`, { confirmed: confirmed ?? true });
        return envelopeResult(resp);
    });

    mcp.tool('aimeat_onboarding_declare_services', descriptionFor('aimeat_onboarding_declare_services'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_onboarding_declare_services') }, annotationsFor('aimeat_onboarding_declare_services'), async ({ agent_name, services }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/declare_services`, { services: services ?? [] });
        return envelopeResult(resp);
    });
}
