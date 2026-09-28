/**
 * @file ai-providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tools for the owner's AI providers and routing (System 2 plan, V3):
 *   aimeat_ai_providers, aimeat_ai_provider_test and aimeat_ai_routing_set.
 *
 *   They do no work of their own: aiProvidersView(), testProvider() and setRouting() are the functions
 *   GET /v1/ai/providers, POST /v1/ai/providers/:id/test and PUT /v1/ai/routing call
 *   (services/ai/provider-store.ts, provider-test.ts, routing.ts). There is deliberately no tool that
 *   sets a key or adds a provider: a key typed into a chat stays in that chat's history on a service
 *   the node does not control, so the owner sets it on the web page. A routing change over MCP is a
 *   proposal first, whoever is connected.
 *
 *   The AI roles live here too: aimeat_ai_roles and aimeat_ai_role_set call aiRolesView() and
 *   setRoles() (services/ai/roles-view.ts, roles.ts), the functions GET and PUT /v1/ai/roles call. A
 *   change to the roles or a binding of an app's role is a proposal the owner confirms, as the routing is.
 * @structure registerAiProviderTools(mcp, storage, config, getAgentGaii)
 * @version-history
 *   v1.1.0 — 2026-09-28 — aimeat_ai_roles and aimeat_ai_role_set (AI roles).
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V3).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { aiProvidersView, knownProviderIds } from '../services/ai/provider-store.js';
import { testProvider } from '../services/ai/provider-test.js';
import { setRouting } from '../services/ai/routing.js';
import { setRoles } from '../services/ai/roles.js';
import { aiRolesView, knownRoleProviders } from '../services/ai/roles-view.js';
import type { AiCapability } from '../services/ai/types.js';

export function registerAiProviderTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const refusal = (e: unknown) => {
    if (e instanceof AiCompletionError) return toolError(e.code, e.message);
    throw e;
  };

  mcp.tool('aimeat_ai_providers', descriptionFor('aimeat_ai_providers'), {}, annotationsFor('aimeat_ai_providers'), async () => {
    const { payer, agent } = aiPayerOf(getAgentGaii());
    try { return text(await aiProvidersView(storage, config, payer, agent)); } catch (e) { return refusal(e); }
  });

  mcp.tool(
    'aimeat_ai_provider_test',
    descriptionFor('aimeat_ai_provider_test'),
    {
      provider: z.string().describe('The provider id, from aimeat_ai_providers.'),
      capability: z.string().optional().describe('text | vision | files | transcription | speech | embed | image. Default text.'),
      accept_cost: z.boolean().optional().describe('Required true for an image test, which the provider charges for.'),
    },
    annotationsFor('aimeat_ai_provider_test'),
    async ({ provider, capability, accept_cost }) => {
      const { payer, agent } = aiPayerOf(getAgentGaii());
      try {
        return text(await testProvider(storage, config, payer, {
          provider, ...(capability ? { capability: capability as AiCapability } : {}), acceptCost: accept_cost === true,
          ...(agent ? { agent, caller: 'agent' as const } : {}),
        }));
      } catch (e) { return refusal(e); }
    },
  );

  mcp.tool(
    'aimeat_ai_routing_set',
    descriptionFor('aimeat_ai_routing_set'),
    {
      routing: z.record(z.string(), z.unknown()).optional().describe('{ defaults?: {capability: [provider ids]}, rules?: {...}, agent?: name }. Omit to read.'),
      confirm_token: z.string().optional().describe('Token from the propose step; omit to propose.'),
    },
    annotationsFor('aimeat_ai_routing_set'),
    async ({ routing, confirm_token }) => {
      const principal = getAgentGaii();
      const { payer, agent } = aiPayerOf(principal);
      try {
        if (!routing) {
          const v = await aiProvidersView(storage, config, payer, agent);
          return text({ mode: 'current', routing: v.routing, providers: v.providers.map(p => ({ id: p.id, type: p.type, capabilities: p.capabilities })) });
        }
        return text(await setRouting(storage, payer, routing, await knownProviderIds(storage, config, payer), {
          kind: 'agent', principal, ...(confirm_token ? { confirmToken: confirm_token } : {}),
        }));
      } catch (e) { return refusal(e); }
    },
  );

  // ── AI roles (services/ai/roles.ts): the functions GET and PUT /v1/ai/roles call ──
  mcp.tool('aimeat_ai_roles', descriptionFor('aimeat_ai_roles'), {}, annotationsFor('aimeat_ai_roles'), async () => {
    const { payer } = aiPayerOf(getAgentGaii());
    try { return text(await aiRolesView(storage, config, payer)); } catch (e) { return refusal(e); }
  });

  mcp.tool(
    'aimeat_ai_role_set',
    descriptionFor('aimeat_ai_role_set'),
    {
      roles: z.record(z.string(), z.unknown()).optional().describe('{ "<role id>": { title, purpose?, capabilities: {capability: [{provider, model?}]}, local?, maxCostPerCallUsd? } or null }.'),
      bindings: z.record(z.string(), z.unknown()).optional().describe('{ "<owner>/<file>.html#<role name>": "<your role id>" or null }.'),
      confirm_token: z.string().optional().describe('Token from the propose step; omit to propose.'),
    },
    annotationsFor('aimeat_ai_role_set'),
    async ({ roles, bindings, confirm_token }) => {
      // Over MCP a change is a proposal first, whoever is connected, as for the routing above.
      const principal = getAgentGaii();
      const { payer } = aiPayerOf(principal);
      // One shape, the one PUT /v1/ai/roles reads: { roles?, bindings? }.
      const input = { ...(roles !== undefined ? { roles } : {}), ...(bindings !== undefined ? { bindings } : {}) };
      try {
        return text(await setRoles(storage, payer, input, await knownRoleProviders(storage, config, payer), {
          kind: 'agent', principal, ...(confirm_token ? { confirmToken: confirm_token } : {}),
        }));
      } catch (e) { return refusal(e); }
    },
  );
}
