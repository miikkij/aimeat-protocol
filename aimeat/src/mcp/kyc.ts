/**
 * @file src/mcp/kyc.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP surface for customer due diligence (EU AMLR 2024/1624): aimeat_kyc_customer,
 *   aimeat_kyc_suspicion_mark and aimeat_kyc_settings. Each action calls the same service function its
 *   REST route calls (routes/kyc/routes.ts), with the session's CallerContext, so who may do what
 *   (services/kyc/access.ts), the validation and the versioning exist once. Nothing is decided here
 *   except the permission word, which the route asks through requireScope and this surface asks
 *   through the action table (tool-catalog/action-scopes.ts) at call time.
 * @structure registerKycTools(mcp, storage, config, caller)
 * @usage registerKycTools(mcp, storage, config, caller);   // mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { requiredScopeForAction } from '../tool-catalog/action-scopes.js';
import { KYC_CUSTOMER_ACTION_NAMES } from '../tool-catalog/definitions/kyc.js';
import { COMPLIANCE_WRITE_SCOPE } from '../utils/scope-coverage.js';
import { toolError } from './tool-error.js';
import { withCaughtError } from './tool-fault.js';
import { scopeDeniedText } from './scope-denied-answer.js';
import { KycError } from '../services/kyc/access.js';
import {
  customerAsOf, endCustomer, listCustomers, openCustomer, readCustomer, readSettingsFor, recordIdentity,
  reviewCustomer, screenCustomer, updateCustomer, updateSettings,
} from '../services/kyc/cards.js';
import { createLink } from '../services/kyc/identify.js';
import { markSuspicion } from '../services/kyc/reports.js';

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

export function registerKycTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  const deps = { storage, config };

  /** The session's permission word for one action: null when held, else the SCOPE_DENIED answer. */
  const denied = (tool: string, c: CallerContext, word: string | null) => (word && !c.has(word)
    ? { content: [{ type: 'text' as const, text: scopeDeniedText(tool, [word], { baseUrl: config.baseUrl, agentGaii: c.principal }) }], isError: true as const }
    : null);

  /** A service refusal is the REST door's code; anything else is a fault the wrapper judges. */
  const failed = (err: unknown) => {
    if (err instanceof KycError) return toolError(err.code, err.message);
    return withCaughtError(toolError('KYC_ERROR', err instanceof Error ? err.message : String(err)), err);
  };

  mcp.registerTool('aimeat_kyc_customer', {
    description: descriptionFor('aimeat_kyc_customer'),
    inputSchema: zodShapeFor('aimeat_kyc_customer'),
    annotations: annotationsFor('aimeat_kyc_customer'),
  }, async (args) => {
    const a = args as Record<string, unknown>;
    const action = str(a.action);
    if (!(KYC_CUSTOMER_ACTION_NAMES as readonly string[]).includes(action)) {
      return toolError('INVALID_INPUT', `action is one of ${KYC_CUSTOMER_ACTION_NAMES.join(', ')}.`);
    }
    const c = caller();
    const refusal = denied('aimeat_kyc_customer', c, requiredScopeForAction('aimeat_kyc_customer', action));
    if (refusal) return refusal;
    const org = str(a.organism);
    const id = str(a.customer_id);
    const note = str(a.note) || undefined;
    try {
      if (action === 'list') return ok(await listCustomers(deps, c, org, { due: a.due === true, status: str(a.status) || undefined }));
      if (action === 'open') return ok(await openCustomer(deps, c, org, obj(a.fields)));
      if (!id) return toolError('INVALID_INPUT', `action "${action}" names the card with customer_id.`);
      switch (action) {
        case 'read': return ok(await readCustomer(deps, c, org, id));
        case 'as_of': {
          if (!str(a.as_of)) return toolError('INVALID_INPUT', 'action "as_of" takes as_of: a date (YYYY-MM-DD) or an ISO 8601 time.');
          return ok(await customerAsOf(deps, c, org, id, str(a.as_of)));
        }
        case 'update': return ok(await updateCustomer(deps, c, org, id, obj(a.fields), note));
        case 'identify': return ok(await recordIdentity(deps, c, org, id, obj(a.identity), note));
        case 'screen': return ok(await screenCustomer(deps, c, org, id));
        case 'review': return ok(await reviewCustomer(deps, c, org, id, str(a.note)));
        case 'end': return ok(await endCustomer(deps, c, org, id, note, str(a.ended_at) || undefined));
        default: return ok(await createLink(deps, c, org, id));
      }
    } catch (err) {
      return failed(err);
    }
  });

  mcp.registerTool('aimeat_kyc_suspicion_mark', {
    description: descriptionFor('aimeat_kyc_suspicion_mark'),
    inputSchema: zodShapeFor('aimeat_kyc_suspicion_mark'),
    annotations: annotationsFor('aimeat_kyc_suspicion_mark'),
  }, async (args) => {
    const a = args as Record<string, unknown>;
    const c = caller();
    // The catalog scope is the write word, and the tool is offered on it; asked again here because a
    // node in warn-only scope mode (config.mcpEnforceScopes=false) registers every tool regardless.
    const refusal = denied('aimeat_kyc_suspicion_mark', c, COMPLIANCE_WRITE_SCOPE);
    if (refusal) return refusal;
    try {
      return ok(await markSuspicion(deps, c, str(a.organism), { customerId: str(a.customer_id) || undefined, observation: str(a.observation) }));
    } catch (err) {
      return failed(err);
    }
  });

  mcp.registerTool('aimeat_kyc_settings', {
    description: descriptionFor('aimeat_kyc_settings'),
    inputSchema: zodShapeFor('aimeat_kyc_settings'),
    annotations: annotationsFor('aimeat_kyc_settings'),
  }, async (args) => {
    const a = args as Record<string, unknown>;
    const action = str(a.action);
    if (action !== 'read' && action !== 'update') return toolError('INVALID_INPUT', 'action is one of read, update.');
    const c = caller();
    const refusal = denied('aimeat_kyc_settings', c, requiredScopeForAction('aimeat_kyc_settings', action));
    if (refusal) return refusal;
    const org = str(a.organism);
    try {
      if (action === 'read') return ok(await readSettingsFor(deps, c, org));
      // The same body PUT /v1/kyc/:org/settings takes: only the fields given; the service keeps the rest.
      const patch: Record<string, unknown> = {};
      for (const key of ['staff', 'officers', 'highRiskCountries', 'reviewMonths'] as const) if (a[key] !== undefined) patch[key] = a[key];
      return ok(await updateSettings(deps, c, org, patch));
    } catch (err) {
      return failed(err);
    }
  });
}
