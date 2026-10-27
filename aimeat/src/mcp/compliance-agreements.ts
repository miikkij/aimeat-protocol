/**
 * @file src/mcp/compliance-agreements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP surface for data processing agreements (plan doc-mvmr4i2wdk0p, D1.5): one
 *   tool, aimeat_compliance_agreement, whose actions call the same service functions the REST routes
 *   (routes/compliance-agreements.ts) call, so who may do what, the validation and the notices exist
 *   once. Nothing is decided in this file.
 * @structure registerComplianceAgreementTools(mcp, storage, config, caller)
 * @usage registerComplianceAgreementTools(mcp, storage, config, caller);   // mcp/register-all.ts
 * @version-history
 *   2026-10-27 — confirm passes uploaded_at, the copy reviewed (secaudit2026oct26).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1.5).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { withCaughtError } from './tool-fault.js';
import { AgreementError, operatorAccess } from '../services/compliance-agreements-access.js';
import {
  breachNoticeOp, createOp, deletionDoneOp, documentOp, endOp, getOp, listOp, mineOp, newVersionOp, noticeOp, objectOp, patchOp, sendOp,
} from '../services/compliance-agreements-ops.js';
import { confirmOp, signedCopyOp } from '../services/compliance-agreements-sign.js';
import { agreementGaps } from '../services/compliance-agreements-gaps.js';

export function registerComplianceAgreementTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  const deps = { storage, config };
  const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });

  mcp.registerTool('aimeat_compliance_agreement', {
    description: descriptionFor('aimeat_compliance_agreement'),
    inputSchema: zodShapeFor('aimeat_compliance_agreement'),
    annotations: annotationsFor('aimeat_compliance_agreement'),
  }, async (args) => {
    const a = args as Record<string, unknown>;
    const action = String(a.action ?? '');
    const id = typeof a.id === 'string' ? a.id : '';
    const input = a.input && typeof a.input === 'object' ? a.input as Record<string, unknown> : {};
    const needId = () => { if (!id) throw new AgreementError(400, 'INVALID_INPUT', `action "${action}" names the agreement with id.`); return id; };
    try {
      const c = caller();
      switch (action) {
        case 'list': return ok(await listOp(deps, c));
        case 'mine': return ok(await mineOp(deps, c));
        case 'get': return ok(await getOp(deps, c, needId()));
        case 'gaps': {
          await operatorAccess(deps, c.auth, 'read');
          const gaps = await agreementGaps(deps);
          return ok({ gaps, total: gaps.length });
        }
        case 'document': {
          const doc = await documentOp(deps, c, needId(), { version: a.version, format: 'text' });
          return ok({ name: doc.name, text: doc.data.toString() });
        }
        case 'create': return ok(await createOp(deps, c, input, { dryRun: a.dry_run === true }));
        case 'update': return ok(await patchOp(deps, c, needId(), input));
        case 'new_version': return ok(await newVersionOp(deps, c, needId()));
        case 'send': return ok(await sendOp(deps, c, needId(), { message: typeof a.message === 'string' ? a.message : undefined }));
        case 'notice': return ok(await noticeOp(deps, c, needId()));
        case 'object': return ok(await objectOp(deps, c, needId(), { reason: a.reason }));
        case 'signed_copy': return ok(await signedCopyOp(deps, c, needId(), { storage_key: a.storage_key, kind: a.kind, party: a.party }));
        case 'confirm': return ok(await confirmOp(deps, c, needId(), { accept: a.accept, reason: a.reason, uploaded_at: a.uploaded_at }));
        case 'end': return ok(await endOp(deps, c, needId(), { choice: a.choice, reason: a.reason }));
        case 'deletion_done': return ok(await deletionDoneOp(deps, c, needId(), { note: a.note }));
        case 'breach_notice': return ok(await breachNoticeOp(deps, c, input));
        default: return toolError('INVALID_INPUT', `action is one of list, mine, get, gaps, document, create, update, new_version, send, notice, object, signed_copy, confirm, end, deletion_done, breach_notice.`);
      }
    } catch (err) {
      if (err instanceof AgreementError) return toolError(err.code, err.message);
      return withCaughtError(toolError('AGREEMENT_ERROR', err instanceof Error ? err.message : String(err)), err);
    }
  });
}
