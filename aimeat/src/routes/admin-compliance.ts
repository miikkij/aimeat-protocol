/**
 * @file src/routes/admin-compliance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's compliance surface: the node-wide report, the use-case register
 *   behind it, and the risk-classification question set that turns one into the other.
 *
 *   THE GATE IS THE ACCOUNT, NOT THE TOKEN'S ROLE LIST. `requireRole('operator')` reads the roles on
 *   the token, which admits an operator PAT and refuses a scope-limited agent JWT — while the
 *   `aimeat_admin_*` tools resolve the operator one level up, at the account. Three answers on one
 *   node. Since these routes have MCP siblings, the two doors would have inherited that
 *   disagreement, which is invariant 15 exactly. So both ask requireOperatorPrincipal(): the
 *   operator in person passes, the operator's agent passes when the operator ticked the word, and
 *   nobody else passes on either surface.
 *
 *   READING IS AUDITED. The report assembles every account's AI activity into one document. An
 *   operator is entitled to that and it is still a disclosure, so the read writes its own usage row
 *   BEFORE the response goes out — the same order and the same reason as
 *   GET /v1/admin/usage/calls. An auditing tool that is itself unaudited is the one blind spot a
 *   compliance surface cannot afford.
 *
 *   THE ROUTES HOLD NO LOGIC. Validation, classification and the roll-up live in
 *   services/compliance-register.ts and services/compliance-report.ts, which the MCP tools call too.
 *   A second implementation behind the tool surface is how the same defect came to be fixed three
 *   times inside one MCP tool.
 * @structure
 *   - adminComplianceRouter(config, storage)
 *   - GET  /v1/admin/compliance/report          — the roll-up  (compliance:read)
 *   - GET  /v1/admin/compliance/reports         — what is kept, or one in full (compliance:read)
 *   - POST /v1/admin/compliance/snapshot        — keep this moment (compliance:write)
 *   - GET  /v1/admin/compliance/draft           — the node's own first draft (compliance:read)
 *   - GET  /v1/admin/compliance/usecases        — the register (compliance:read)
 *   - PUT  /v1/admin/compliance/usecases        — replace it   (compliance:write)
 *   - GET  /v1/admin/compliance/questionnaire   — the question set (compliance:read)
 *   - PUT  /v1/admin/compliance/questionnaire   — replace it   (compliance:write)
 * @usage
 *   import { adminComplianceRouter } from './routes/admin-compliance.js';
 *   app.use(adminComplianceRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-08-23 — A report can be kept on demand, and the index says which of the kept ones
 *     came from the schedule. The schedule used to be the only thing that could keep one.
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperatorPrincipal } from '../auth/middleware.js';
import { COMPLIANCE_READ_SCOPE, COMPLIANCE_WRITE_SCOPE } from '../utils/scope-coverage.js';
import { success, error } from '../middleware/envelope.js';
import { validateBody } from '../models/schemas.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import { recordUsageCall } from '../services/usage/usage-buffer.js';
import { logger } from '../utils/logger.js';
import {
  buildComplianceReport, complianceUnlabelledDetail, MONTH_RE,
} from '../services/compliance-report.js';
import { draftRegisterFromActivity } from '../services/compliance-draft.js';
import {
  QuestionnaireSchema, UseCasesSchema, effectiveQuestionnaire, readUseCases,
  writeQuestionnaire, writeUseCases, listStoredReports, readStoredReport, storedReportKind,
  type ComplianceQuestionnaire,
} from '../services/compliance-register.js';
import { saveComplianceSnapshot } from '../services/compliance-monthly-job.js';

export function adminComplianceRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const canRead = [requireAuth(), requireOperatorPrincipal(storage, COMPLIANCE_READ_SCOPE)] as const;
  const canWrite = [requireAuth(), requireOperatorPrincipal(storage, COMPLIANCE_WRITE_SCOPE)] as const;
  const operatorOf = (req: Request) => ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));

  // ── GET /v1/admin/compliance/report ───────────────────────────────────────────────────────
  router.get('/v1/admin/compliance/report', ...canRead, async (req: Request, res: Response) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    if (month && !MONTH_RE.test(month)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        'The month has to look like 2026-08. Leave it out to get a rolling window instead.'));
      return;
    }
    const sinceDays = Number.parseInt(String(req.query.since_days ?? ''), 10);
    const report = await buildComplianceReport(storage, config, {
      month,
      sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
    });

    // The audit row, written before the response. See the file header.
    const operator = operatorOf(req);
    recordUsageCall({
      ownerGhii: operator, actorGaii: operator, actorKind: 'operator', surface: 'operator',
      coordinate: 'compliance.report', counterpartyGhii: '', outcome: 'ok',
      meta: {
        period: `${report.scope.period.from}..${report.scope.period.to}`,
        usecases: report.register.usecases.length, gaps: report.gaps.length,
      },
    });
    logger.info('admin-compliance: operator read the node-wide report', {
      operator, gaps: report.gaps.length, usecases: report.register.usecases.length,
    });

    const detail = await complianceUnlabelledDetail(storage, 30, 50);
    res.json(success(config.nodeId, { ...report, unlabelled_detail: detail }, [
      { description: 'The register this report compares against', method: 'GET', url: '/v1/admin/compliance/usecases' },
      { description: 'The node\'s public transparency statement', method: 'GET', url: '/v1/ai-transparency' },
    ]));
  });

  // ── GET /v1/admin/compliance/reports — what is kept, and one of them in full ──────────────
  // `month` is still accepted alongside `id`: the notification the monthly job sends links with it,
  // and those links live in people's inboxes for as long as the notification does.
  router.get('/v1/admin/compliance/reports', ...canRead, async (req: Request, res: Response) => {
    const raw = typeof req.query.id === 'string' ? req.query.id
      : typeof req.query.month === 'string' ? req.query.month : undefined;
    if (raw) {
      if (!storedReportKind(raw)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
          'A stored report is named either 2026-08 for a month or 2026-08-23-1930 for a saved moment.'));
        return;
      }
      const stored = await readStoredReport(storage, config.nodeId, raw);
      if (!stored) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Nothing is stored under ${raw}. The monthly job runs on the first of the following month, `
          + 'and you can keep the report as it stands now with POST /v1/admin/compliance/snapshot.'));
        return;
      }
      res.json(success(config.nodeId, { id: raw, kind: storedReportKind(raw), report: stored }));
      return;
    }
    const reports = await listStoredReports(storage, config.nodeId);
    res.json(success(config.nodeId, { reports, total: reports.length }, [
      { description: 'Keep the report as it stands now', method: 'POST', url: '/v1/admin/compliance/snapshot' },
      { description: 'Run the monthly job now', method: 'POST', url: '/v1/admin/scheduler/jobs/core:compliance-report-monthly/trigger' },
    ]));
  });

  // ── POST /v1/admin/compliance/snapshot — keep this moment ─────────────────────────────────
  // Behind the WRITE word: it puts a node-wide document into the store, and a credential that may
  // only read the report has no business adding to what the node keeps.
  router.post('/v1/admin/compliance/snapshot', ...canWrite, async (req: Request, res: Response) => {
    const sinceDays = Number.parseInt(String(req.body?.since_days ?? req.query.since_days ?? ''), 10);
    const saved = await saveComplianceSnapshot(config, storage, {
      sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
    });

    // Same reason the report read is audited: a snapshot copies every account's activity into a
    // record that outlives the page it was taken from.
    const operator = operatorOf(req);
    recordUsageCall({
      ownerGhii: operator, actorGaii: operator, actorKind: 'operator', surface: 'operator',
      coordinate: 'compliance.snapshot', counterpartyGhii: '', outcome: 'ok',
      meta: { id: saved.id, gaps: saved.gaps, usecases: saved.usecases },
    });
    logger.info('admin-compliance: operator kept a snapshot', { operator, id: saved.id });

    res.status(201).json(success(config.nodeId, saved, [
      { description: 'Read it back', method: 'GET', url: `/v1/admin/compliance/reports?id=${saved.id}` },
    ]));
  });

  // ── GET /v1/admin/compliance/draft — the node's own first draft of the register ───────────
  // Composed from what actually ran and stored nowhere. The point is that an operator opening this
  // for the first time is handed a filled-in register to review rather than an empty form and a
  // list of models to retype.
  router.get('/v1/admin/compliance/draft', ...canRead, async (req: Request, res: Response) => {
    const sinceDays = Number.parseInt(String(req.query.since_days ?? ''), 10);
    const draft = await draftRegisterFromActivity(storage, config, {
      sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
    });
    res.json(success(config.nodeId, draft, [
      { description: 'Save it, once you have looked at it', method: 'PUT', url: '/v1/admin/compliance/usecases' },
    ]));
  });

  // ── The use-case register ─────────────────────────────────────────────────────────────────
  router.get('/v1/admin/compliance/usecases', ...canRead, async (_req: Request, res: Response) => {
    const usecases = await readUseCases(storage, config.nodeId);
    res.json(success(config.nodeId, { usecases, total: usecases.length }));
  });

  router.put('/v1/admin/compliance/usecases', ...canWrite,
    validateBody(UseCasesSchema, config.nodeId),
    async (req: Request, res: Response) => {
      const operator = operatorOf(req);
      // The preview answers AFTER validateBody, so what it shows is what would actually land. A
      // preview that skipped the checks would show a document the real write then refuses.
      if (req.query.dry_run === 'true') {
        const unmarked = (req.body.usecases as Array<{ id: string; answers?: Record<string, unknown>; answerSources?: Record<string, string> }>)
          .flatMap(uc => Object.keys(uc.answers ?? {}).filter(q => !(uc.answerSources ?? {})[q]).map(q => `${uc.id}:${q}`));
        res.json(success(config.nodeId, {
          would_store: req.body.usecases, total: req.body.usecases.length, stored: false,
          ...(unmarked.length ? { answers_with_no_recorded_source: unmarked } : {}),
        }));
        return;
      }
      const saved = await writeUseCases(storage, config.nodeId, req.body.usecases, operator);
      logger.info('admin-compliance: register replaced', { operator, count: saved.length });
      res.json(success(config.nodeId, { usecases: saved, total: saved.length }, [
        { description: 'See what the report makes of it', method: 'GET', url: '/v1/admin/compliance/report' },
      ]));
    });

  // ── The question set ──────────────────────────────────────────────────────────────────────
  router.get('/v1/admin/compliance/questionnaire', ...canRead, async (_req: Request, res: Response) => {
    const questionnaire = await effectiveQuestionnaire(storage, config.nodeId);
    res.json(success(config.nodeId, { questionnaire }));
  });

  router.put('/v1/admin/compliance/questionnaire', ...canWrite,
    validateBody(QuestionnaireSchema, config.nodeId),
    async (req: Request, res: Response) => {
      const saved = await writeQuestionnaire(storage, config.nodeId, req.body as ComplianceQuestionnaire);
      logger.info('admin-compliance: question set replaced', {
        operator: operatorOf(req), version: saved.version, questions: saved.questions.length,
      });
      // Changing the set re-classifies every use case, which is the point and is also a surprise if
      // nobody says so. The hint sends the reader straight at the consequence.
      res.json(success(config.nodeId, { questionnaire: saved }, [
        { description: 'Every use case is re-classified against this — see the result', method: 'GET', url: '/v1/admin/compliance/report' },
      ]));
    });

  return router;
}
