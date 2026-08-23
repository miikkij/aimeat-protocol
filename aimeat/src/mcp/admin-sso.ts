/**
 * @file src/mcp/admin-sso.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's SSO administration over MCP (BR-04): connect an organisation's
 *   identity provider, read and change connections, mint the SCIM token, and offboard by hand
 *   (deactivate/reactivate an account) — the chat path for the same work the admin dashboard's
 *   Organisation sign-in tab does. Every tool checks the operator role at call time and calls the
 *   ONE implementation in services/sso-connections.ts and services/owner-lifecycle.ts; none of
 *   them reads storage records directly, which is what check:shared-impl holds this directory to.
 * @structure registerAdminSsoTools(mcp, storage, config, getAgentGaii) — nine operator tools.
 * @usage registerAdminSsoTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 1's MCP batch).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import {
  listSsoConnectionViews, getSsoConnectionView, createSsoConnection, updateSsoConnectionAdmin,
  deleteSsoConnectionAdmin, mintScimToken, setIdpMetadata,
} from '../services/sso-connections.js';
import { resolveOperatorName, deactivateOwnerByOperator, reactivateOwnerByOperator } from '../services/owner-lifecycle.js';
import { emitChange } from '../services/event-bus.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminSsoTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();

  /** Operator check at call time, plus the caller's bare owner name for attribution. The read
   *  lives in the lifecycle service so this tool surface calls no storage (check:shared-impl). */
  const operatorName = () => resolveOperatorName(storage, agentGaii);

  mcp.tool('aimeat_admin_sso_list', descriptionFor('aimeat_admin_sso_list'),
    {}, annotationsFor('aimeat_admin_sso_list'),
    async () => {
      if (!(await operatorName())) return refuse('Operator role required');
      return text({ connections: await listSsoConnectionViews(config, storage) });
    });

  mcp.tool('aimeat_admin_sso_get', descriptionFor('aimeat_admin_sso_get'),
    { id: z.string().describe('The connection id (slug).') },
    annotationsFor('aimeat_admin_sso_get'),
    async ({ id }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const view = await getSsoConnectionView(config, storage, id);
      return view ? text({ connection: view }) : refuse('NOT_FOUND: Connection not found');
    });

  mcp.tool('aimeat_admin_sso_create', descriptionFor('aimeat_admin_sso_create'),
    {
      id: z.string().describe('Permanent slug id (lowercase letters, digits, dashes; 2-31 chars).'),
      name: z.string().describe('The organisation\'s name — the sign-in button label when listed.'),
      domains: z.array(z.string()).optional().describe('Email domains this organisation vouches for, e.g. ["contoso.com"].'),
      organism_id: z.string().optional().describe('Organism its people are added to on first sign-in or provisioning.'),
      login_visibility: z.enum(['listed', 'hidden']).optional().describe('"listed" shows a sign-in button; "hidden" keeps the organisation off the public modal (default listed).'),
      allow_idp_initiated: z.boolean().optional().describe('Accept sign-ins started from the IdP\'s own portal tile (default false).'),
    },
    annotationsFor('aimeat_admin_sso_create'),
    async (input) => {
      const by = await operatorName();
      if (!by) return refuse('Operator role required');
      const r = await createSsoConnection(config, storage, input, by);
      return r.ok ? text({ connection: r.connection }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.tool('aimeat_admin_sso_update', descriptionFor('aimeat_admin_sso_update'),
    {
      id: z.string().describe('The connection id.'),
      name: z.string().optional().describe('New organisation name.'),
      domains: z.array(z.string()).optional().describe('New email-domain list (replaces the old one).'),
      organism_id: z.string().optional().describe('New organism binding; an empty string clears it.'),
      login_visibility: z.enum(['listed', 'hidden']).optional().describe('"listed" or "hidden".'),
      allow_idp_initiated: z.boolean().optional().describe('Accept IdP-initiated sign-ins.'),
    },
    annotationsFor('aimeat_admin_sso_update'),
    async ({ id, ...input }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const r = await updateSsoConnectionAdmin(config, storage, id, input);
      return r.ok ? text({ connection: r.connection }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.tool('aimeat_admin_sso_delete', descriptionFor('aimeat_admin_sso_delete'),
    { id: z.string().describe('The connection id.') },
    annotationsFor('aimeat_admin_sso_delete'),
    async ({ id }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const r = await deleteSsoConnectionAdmin(config, storage, id);
      return r.ok ? text({ deleted: true }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.tool('aimeat_admin_sso_idp_metadata', descriptionFor('aimeat_admin_sso_idp_metadata'),
    {
      id: z.string().describe('The connection id.'),
      url: z.string().optional().describe('The IdP metadata URL (e.g. Entra\'s federation metadata address).'),
      xml: z.string().optional().describe('The IdP metadata document itself, when a URL is not reachable.'),
      name_id_format: z.string().optional().describe('Requested NameID format, when the IdP\'s default is not wanted.'),
    },
    annotationsFor('aimeat_admin_sso_idp_metadata'),
    async ({ id, ...input }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const r = await setIdpMetadata(config, storage, id, input);
      return r.ok ? text({ connection: r.connection }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.tool('aimeat_admin_sso_scim_token', descriptionFor('aimeat_admin_sso_scim_token'),
    { id: z.string().describe('The connection id.') },
    annotationsFor('aimeat_admin_sso_scim_token'),
    async ({ id }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const r = await mintScimToken(config, storage, id);
      return r.ok ? text({ scim_token: r.scim_token, note: r.note }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.tool('aimeat_admin_owner_disable', descriptionFor('aimeat_admin_owner_disable'),
    { name: z.string().describe('The owner name to deactivate.') },
    annotationsFor('aimeat_admin_owner_disable'),
    async ({ name }) => {
      const by = await operatorName();
      if (!by) return refuse('Operator role required');
      const r = await deactivateOwnerByOperator(storage, name, by);
      if (!r.ok) return refuse(`${r.code}: ${r.message}`);
      emitChange('ghii');
      const result = r.result!;
      return text({
        name, disabled: true,
        sessions_revoked: result.sessionsRevoked, pats_revoked: result.patsRevoked, grants_revoked: result.grantsRevoked,
        ...(result.incomplete.length ? { incomplete: result.incomplete } : {}),
      });
    });

  mcp.tool('aimeat_admin_owner_enable', descriptionFor('aimeat_admin_owner_enable'),
    { name: z.string().describe('The owner name to reactivate.') },
    annotationsFor('aimeat_admin_owner_enable'),
    async ({ name }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const r = await reactivateOwnerByOperator(storage, name);
      if (!r.ok) return refuse(`${r.code}: ${r.message}`);
      emitChange('ghii');
      return text({ name, disabled: false });
    });
}
