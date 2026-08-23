/**
 * @file src/mcp/compliance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP surface for the operator's compliance report and the register behind it.
 *
 *   IT ASKS THE SAME QUESTION THE HTTP DOOR ASKS, of the same function. The decision lives in
 *   services/compliance-access.ts and both doors call it: the route through
 *   requireOperatorPrincipal(), this through complianceRefusal(). A tool surface and an HTTP door
 *   that gate differently is invariant 15, and it has already happened once here with
 *   organism:write.
 *
 *   IT CALLS THE SERVICES, NOT STORAGE. buildComplianceReport, the zod schemas and the register
 *   read/write are the same functions the route calls, so validation, classification and the shape
 *   of a stored record exist once. A tool that reached storage directly would be a second
 *   implementation, which is how the same defect came to be fixed three separate times inside one
 *   MCP tool.
 *
 *   A WRITE REPLACES. Said in the tool description, and worth saying twice: `part` names a whole
 *   document, and what the caller sends is what remains. An agent that read, appended and wrote back
 *   is doing the right thing; an agent that writes one entry has deleted the rest.
 * @structure
 *   - registerComplianceTools(mcp, storage, config, getAgentGaii)
 * @usage
 *   import { registerComplianceTools } from './compliance.js';
 *   registerComplianceTools(mcp, storage, config, getAgentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { COMPLIANCE_READ_SCOPE, COMPLIANCE_WRITE_SCOPE } from '../utils/scope-coverage.js';
import { complianceRefusal } from '../services/compliance-access.js';
import { buildComplianceReport, MONTH_RE } from '../services/compliance-report.js';
import {
  QuestionnaireSchema, UseCasesSchema, effectiveQuestionnaire, readUseCases,
  writeQuestionnaire, writeUseCases,
} from '../services/compliance-register.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerComplianceTools(
  mcp: McpServer, storage: Storage, config: AimeatConfig, getAgentGaii: () => string,
  // The two emitters every register function in this directory takes. Unused here — nothing on this
  // surface changes a resource an MCP client subscribes to — but the position is kept so the shape
  // matches its siblings, which is what lets scripts/audit-mcp-schemas.ts call them all in one loop.
  _emitResourceUpdated?: (agentGaii: string, uri: string) => void,
  _emitResourceListChanged?: (agentGaii: string) => void,
  /** This session's granted scopes. Checked at CALL time as well as at registration — see gate(). */
  sessionScopes: string[] = [],
): void {
  const agentGaii = getAgentGaii();

  /**
   * The access decision, asked of the service both doors ask. Nothing is decided in this file.
   *
   * WHY IT IS ASKED AT CALL TIME AND NOT ONLY AT REGISTRATION. mcp/index.ts filters the tool surface
   * by scope, which would normally be enough — except that filter has a warn-only mode
   * (config.mcpEnforceScopes=false) which registers every tool anyway and only logs what it would
   * have hidden. On a node in that mode, registration is not a gate at all. The read word hands over
   * every account's AI activity in one document, so it is checked where it is used rather than only
   * where the tool is offered.
   */
  const gate = (scope: string) => complianceRefusal(storage, { gaii: agentGaii, scopes: sessionScopes }, scope);

  mcp.tool(
    'aimeat_compliance_report',
    descriptionFor('aimeat_compliance_report'),
    {
      scope: z.enum(['mine', 'node']).optional()
        .describe('Whose report. "mine" (the default) is your owner\'s own slice; "node" is the whole installation and is operator-only.'),
      since_days: z.number().int().min(1).max(3650).optional()
        .describe('Rolling window in days (default 30). Ignored when month is given.'),
      month: z.string().optional()
        .describe('A whole calendar month, YYYY-MM. Wins over since_days.'),
    },
    annotationsFor('aimeat_compliance_report'),
    async ({ scope, since_days, month }) => {
      if (month && !MONTH_RE.test(month)) {
        return refuse('The month has to look like 2026-08. Leave it out to get a rolling window instead.');
      }
      // "mine" is the default on purpose: least privilege, and it is the answer almost every caller
      // wants. The whole installation is the deliberate ask, and it is the one that is gated.
      if (scope === 'node') {
        const denied = await gate(COMPLIANCE_READ_SCOPE);
        if (denied) return refuse(denied);
        return text(await buildComplianceReport(storage, config, { sinceDays: since_days, month }));
      }
      const ownerGhii = ownerGhiiOf(agentGaii);
      return text(await buildComplianceReport(storage, config, { ownerGhii, sinceDays: since_days, month }));
    },
  );

  mcp.tool(
    'aimeat_compliance_register_read',
    descriptionFor('aimeat_compliance_register_read'),
    { part: z.enum(['usecases', 'questionnaire']).describe('Which document to read.') },
    annotationsFor('aimeat_compliance_register_read'),
    async ({ part }) => {
      const denied = await gate(COMPLIANCE_READ_SCOPE);
      if (denied) return refuse(denied);
      if (part === 'questionnaire') {
        return text({ questionnaire: await effectiveQuestionnaire(storage, config.nodeId) });
      }
      const usecases = await readUseCases(storage, config.nodeId);
      return text({ usecases, total: usecases.length });
    },
  );

  mcp.tool(
    'aimeat_compliance_register_write',
    descriptionFor('aimeat_compliance_register_write'),
    {
      part: z.enum(['usecases', 'questionnaire']).describe('Which document to replace.'),
      value: z.record(z.string(), z.unknown()).describe('The whole document — this replaces, it does not merge.'),
    },
    annotationsFor('aimeat_compliance_register_write'),
    async ({ part, value }) => {
      const denied = await gate(COMPLIANCE_WRITE_SCOPE);
      if (denied) return refuse(denied);

      if (part === 'questionnaire') {
        const parsed = QuestionnaireSchema.safeParse(value);
        if (!parsed.success) {
          return refuse('That question set was not stored: '
            + parsed.error.issues.map(i => `${i.path.join('.')} — ${i.message}`).join('; '));
        }
        const saved = await writeQuestionnaire(storage, config.nodeId, parsed.data);
        return text({
          questionnaire: saved,
          note: 'Every use case is re-classified against this now. One whose answers no longer cover '
            + 'every question is unclassified and will appear in the report gap list.',
        });
      }

      const parsed = UseCasesSchema.safeParse(value);
      if (!parsed.success) {
        return refuse('That register was not stored: '
          + parsed.error.issues.map(i => `${i.path.join('.')} — ${i.message}`).join('; '));
      }
      const saved = await writeUseCases(storage, config.nodeId, parsed.data.usecases, agentGaii);
      return text({ usecases: saved, total: saved.length });
    },
  );
}
