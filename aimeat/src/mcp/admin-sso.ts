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
 * @structure registerAdminSsoTools(mcp, storage, config, getAgentGaii, scopes) — ten operator tools.
 * @usage registerAdminSsoTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-16 — Disabling and enabling an account writes the operator trail (QA audit E2-04).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 — 2026-09-24 — SECURITY (audit A8-1): the operator test asks the operator:admin word as
 *     well as the account (services/owner-lifecycle.ts resolveOperatorAgentName). The account alone
 *     let any agent of the operator reset a person's second factor or deactivate their account.
 *   v1.1.0 — 2026-09-12 — aimeat_admin_sso_list calls buildSsoOverview, the same build the HTTP
 *     list calls, so both carry the node-wide switches and neither assembles the shape alone.
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 1's MCP batch).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import {
  createSsoConnection, updateSsoConnectionAdmin,
  deleteSsoConnectionAdmin, mintScimToken, setIdpMetadata,
} from '../services/sso-connections.js';
import { buildSsoOverview, buildSsoConnectionRow } from '../services/sso-overview.js';
import {
  resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL, deactivateOwnerByOperator, reactivateOwnerByOperator,
} from '../services/owner-lifecycle.js';
import { resetTotpByOperator } from '../services/totp-recovery.js';
import { emitChange } from '../services/event-bus.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminSsoTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  /** This session's granted scopes: operator:admin is asked of them at call time. */
  scopes: readonly string[] = [],
): void {
  const agentGaii = getAgentGaii();

  /** Operator check at call time, plus the caller's bare owner name for attribution: the account
   *  runs this node AND the agent holds operator:admin. The read lives in the lifecycle service so
   *  this tool surface calls no storage (check:shared-impl). */
  const operatorName = () => resolveOperatorAgentName(storage, agentGaii, scopes);

  mcp.registerTool('aimeat_admin_sso_list', { description: descriptionFor('aimeat_admin_sso_list'),
    inputSchema: zodShapeFor('aimeat_admin_sso_list'), annotations: annotationsFor('aimeat_admin_sso_list') },
    async () => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      // The same build the HTTP list calls. It used to assemble `{ connections }` here, which was
      // one object with two authors and is how the two answers drift.
      return text(await buildSsoOverview(config, storage));
    });

  mcp.registerTool('aimeat_admin_sso_get', { description: descriptionFor('aimeat_admin_sso_get'),
    inputSchema: zodShapeFor('aimeat_admin_sso_get'),
    annotations: annotationsFor('aimeat_admin_sso_get') },
    async ({ id }) => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      const view = await buildSsoConnectionRow(config, storage, id);
      return view ? text({ connection: view }) : refuse('NOT_FOUND: Connection not found');
    });

  mcp.registerTool('aimeat_admin_sso_create', { description: descriptionFor('aimeat_admin_sso_create'),
    inputSchema: zodShapeFor('aimeat_admin_sso_create'),
    annotations: annotationsFor('aimeat_admin_sso_create') },
    async (input) => {
      const by = await operatorName();
      if (!by) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await createSsoConnection(config, storage, input, by);
      return r.ok ? text({ connection: r.connection }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.registerTool('aimeat_admin_sso_update', { description: descriptionFor('aimeat_admin_sso_update'),
    inputSchema: zodShapeFor('aimeat_admin_sso_update'),
    annotations: annotationsFor('aimeat_admin_sso_update') },
    async ({ id, ...input }) => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await updateSsoConnectionAdmin(config, storage, id, input);
      return r.ok ? text({ connection: r.connection }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.registerTool('aimeat_admin_sso_delete', { description: descriptionFor('aimeat_admin_sso_delete'),
    inputSchema: zodShapeFor('aimeat_admin_sso_delete'),
    annotations: annotationsFor('aimeat_admin_sso_delete') },
    async ({ id }) => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await deleteSsoConnectionAdmin(config, storage, id);
      return r.ok ? text({ deleted: true }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.registerTool('aimeat_admin_sso_idp_metadata', { description: descriptionFor('aimeat_admin_sso_idp_metadata'),
    inputSchema: zodShapeFor('aimeat_admin_sso_idp_metadata'),
    annotations: annotationsFor('aimeat_admin_sso_idp_metadata') },
    async ({ id, ...input }) => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await setIdpMetadata(config, storage, id, input);
      return r.ok ? text({ connection: r.connection }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.registerTool('aimeat_admin_sso_scim_token', { description: descriptionFor('aimeat_admin_sso_scim_token'),
    inputSchema: zodShapeFor('aimeat_admin_sso_scim_token'),
    annotations: annotationsFor('aimeat_admin_sso_scim_token') },
    async ({ id }) => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await mintScimToken(config, storage, id);
      return r.ok ? text({ scim_token: r.scim_token, note: r.note }) : refuse(`${r.code}: ${r.message}`);
    });

  mcp.registerTool('aimeat_admin_owner_disable', { description: descriptionFor('aimeat_admin_owner_disable'),
    inputSchema: zodShapeFor('aimeat_admin_owner_disable'),
    annotations: annotationsFor('aimeat_admin_owner_disable') },
    async ({ name }) => {
      const by = await operatorName();
      if (!by) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await deactivateOwnerByOperator(storage, name, by, { config, actorGaii: agentGaii });
      if (!r.ok) return refuse(`${r.code}: ${r.message}`);
      emitChange('ghii');
      const result = r.result!;
      return text({
        name, disabled: true,
        sessions_revoked: result.sessionsRevoked, pats_revoked: result.patsRevoked, grants_revoked: result.grantsRevoked,
        ...(result.incomplete.length ? { incomplete: result.incomplete } : {}),
      });
    });

  mcp.registerTool('aimeat_admin_owner_enable', { description: descriptionFor('aimeat_admin_owner_enable'),
    inputSchema: zodShapeFor('aimeat_admin_owner_enable'),
    annotations: annotationsFor('aimeat_admin_owner_enable') },
    async ({ name }) => {
      const by = await operatorName();
      if (!by) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await reactivateOwnerByOperator(storage, name, by, { config, actorGaii: agentGaii });
      if (!r.ok) return refuse(`${r.code}: ${r.message}`);
      emitChange('ghii');
      return text({ name, disabled: false });
    });

  mcp.registerTool('aimeat_admin_totp_reset', { description: descriptionFor('aimeat_admin_totp_reset'),
    inputSchema: zodShapeFor('aimeat_admin_totp_reset'),
    annotations: annotationsFor('aimeat_admin_totp_reset') },
    async ({ name }) => {
      const by = await operatorName();
      if (!by) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await resetTotpByOperator(storage, name, by, agentGaii, config);
      if (!r.ok) return refuse(`${r.code}: ${r.message}`);
      emitChange('totp');
      return text({ name, ghii: r.ghii, two_factor: false });
    });
}
