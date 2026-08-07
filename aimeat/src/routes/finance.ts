/**
 * @file src/routes/finance.ts
 * @description Invoice endpoints of the generic finance domain: draft CRUD, the
 *   draft→sent transition, payment marking, credit notes and Finvoice 3.0 XML download.
 *   All business rules live in src/services/finance/*; handlers stay thin.
 *
 *   Identity: records are keyed to the OWNER behind the session (owner, the owner's
 *   agent, or an app-grant token all resolve to the same bucket) — the same discipline
 *   as the ledger routes, because the TILIT app and the owner's agents must see the
 *   owner's books, not per-principal shards. Absent and not-yours answer identically
 *   (404) so invoice ids cannot be enumerated.
 *
 * @structure zod schemas · sendErr mapper · financeRouter (invoice endpoints)
 * @usage app.use(financeRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { FinanceError } from '../services/finance/errors.js';
import {
  createDraft, updateDraft, deleteDraft, send, markPaid, createCreditNote,
  applyOverdue, requireOwnInvoice,
} from '../services/finance/invoice-service.js';
import { buildFinvoiceXml } from '../services/finance/finvoice.js';
import { renderInvoicePdf } from '../services/finance/invoice-pdf.js';
import { submitInvoice, refreshDeliveryStatus } from '../services/finance/finvoice-operator.js';
import { resolveFinanceOwner } from '../services/finance/accountant-access.js';
import { requireOwnCompany, CompanyError } from '../services/company/company-service.js';

const PartySchema = z.object({
  name: z.string().min(2).max(140),
  businessId: z.string().max(35).optional(),
  vatId: z.string().max(35).optional(),
  contactId: z.string().max(80).optional(),
  email: z.string().email().max(200).optional(),
  streetAddress: z.string().max(70).optional(),
  postalCode: z.string().max(20).optional(),
  city: z.string().max(70).optional(),
  country: z.string().length(2).optional(),
  einvoiceAddress: z.string().max(35).optional(),
  einvoiceOperator: z.string().max(35).optional(),
  iban: z.string().max(34).optional(),
  bic: z.string().max(11).optional(),
}).strict();

const LineSchema = z.object({
  description: z.string().min(1).max(500),
  quantityMilli: z.number().int().positive(),
  unit: z.string().min(1).max(10),
  unitPriceMinor: z.number().int().min(0),
  vatCodeId: z.string().min(1).max(60),
}).strict();

const DraftSchema = z.object({
  organism_id: z.string().max(80).nullish(),
  /**
   * Bill AS this registered company: the seller party is filled from its record, so a
   * founder types the legal identity once at company registration instead of onto every
   * invoice. An explicit `seller` still wins — the company is a default, not a cage.
   */
  company_id: z.string().max(80).optional(),
  seller: PartySchema.optional(),
  buyer: PartySchema,
  lines: z.array(LineSchema).min(1).max(200),
  currency: z.string().length(3).optional(),
  payment_terms_days: z.number().int().min(0).max(120).optional(),
  notes: z.string().max(2000).nullish(),
}).strict();

const SendSchema = z.object({
  delivery_method: z.enum(['finvoice', 'email', 'manual']),
  reference_style: z.enum(['fi', 'rf']).optional(),
}).strict();

const MarkPaidSchema = z.object({
  paid_at: z.string().datetime().optional(),
  tracking_code: z.string().max(120).optional(),
  external_ref: z.string().max(120).optional(),
}).strict();

function sendErr(res: Response, config: AimeatConfig, e: unknown): boolean {
  if (e instanceof FinanceError) {
    res.status(e.statusCode).json(error(config.nodeId, e.code, e.message));
    return true;
  }
  // A company-id that is not yours must answer like the finance domain's own 404, not leak
  // a different error shape from a neighbouring domain.
  if (e instanceof CompanyError) {
    res.status(e.statusCode).json(error(config.nodeId, e.code, e.message));
    return true;
  }
  return false;
}

/**
 * The invoice's seller party: from the named company's registered legal identity, or from an
 * explicit seller block. An explicit seller wins, so the company is a default rather than a cage.
 */
async function resolveSeller(
  storage: Storage, ownerGhii: string,
  companyId: string | undefined,
  explicit: z.infer<typeof PartySchema> | undefined,
): Promise<z.infer<typeof PartySchema>> {
  if (explicit) return explicit;
  if (!companyId) {
    throw new FinanceError('INVALID_PARTY', 400, 'Either seller or company_id is required');
  }
  const company = await requireOwnCompany(storage, ownerGhii, companyId);
  return {
    name: company.name,
    ...(company.businessId ? { businessId: company.businessId } : {}),
    ...(company.vatId ? { vatId: company.vatId } : {}),
    ...(company.email ? { email: company.email } : {}),
    ...(company.streetAddress ? { streetAddress: company.streetAddress } : {}),
    ...(company.postalCode ? { postalCode: company.postalCode } : {}),
    ...(company.city ? { city: company.city } : {}),
    ...(company.country ? { country: company.country } : {}),
    ...(company.iban ? { iban: company.iban } : {}),
    ...(company.bic ? { bic: company.bic } : {}),
    ...(company.einvoiceAddress ? { einvoiceAddress: company.einvoiceAddress } : {}),
    ...(company.einvoiceOperator ? { einvoiceOperator: company.einvoiceOperator } : {}),
  };
}

const STATUSES = ['draft', 'sent', 'paid', 'overdue', 'credited', 'cancelled'] as const;

export function financeRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request): string => `${req.auth!.owner}@${config.nodeId}`;

  // Create an invoice draft.
  router.post('/v1/finance/invoices', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const parsed = DraftSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_INVOICE', parsed.error.message));
        return;
      }
      const b = parsed.data;
      const seller = await resolveSeller(storage, resolve(req), b.company_id, b.seller);
      const invoice = await createDraft(storage, resolve(req), {
        organismId: b.organism_id ?? (b.company_id ? (await requireOwnCompany(storage, resolve(req), b.company_id)).organismId : null),
        seller, buyer: b.buyer, lines: b.lines,
        currency: b.currency, paymentTermsDays: b.payment_terms_days, notes: b.notes ?? null,
      });
      emitChange('finance', resolve(req));
      res.status(201).json(success(config.nodeId, { invoice }, [
        { description: 'Send the invoice', method: 'POST', url: `/v1/finance/invoices/${invoice.id}/send` },
      ]));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // List invoices (lazy overdue applied per returned row).
  router.get('/v1/finance/invoices', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const owner = await resolveFinanceOwner(config, storage, req);
      const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
      const perPage = Math.min(200, Math.max(1, parseInt((req.query.per_page as string) ?? '50', 10) || 50));
      const status = typeof req.query.status === 'string' && (STATUSES as readonly string[]).includes(req.query.status)
        ? req.query.status as (typeof STATUSES)[number] : undefined;
      const type = (['invoice', 'credit_note'] as const).find((t) => t === req.query.type);
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const query = { ownerGhii: owner, status, type, from, to };
      const [rows, total] = await Promise.all([
        storage.listInvoices({ ...query, limit: perPage, offset: (page - 1) * perPage }),
        storage.countInvoices(query),
      ]);
      const invoices = [];
      for (const inv of rows) invoices.push(await applyOverdue(storage, inv));
      res.json(success(config.nodeId, { invoices, total }, undefined, { page, per_page: perPage, total }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.get('/v1/finance/invoices/:id', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const inv = await requireOwnInvoice(storage, await resolveFinanceOwner(config, storage, req), req.params.id as string);
      res.json(success(config.nodeId, { invoice: await applyOverdue(storage, inv) }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Edit a draft (a sent invoice is immutable → 409 from the service).
  router.put('/v1/finance/invoices/:id', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const parsed = DraftSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_INVOICE', parsed.error.message));
        return;
      }
      const b = parsed.data;
      const seller = await resolveSeller(storage, resolve(req), b.company_id, b.seller);
      const invoice = await updateDraft(storage, resolve(req), req.params.id as string, {
        organismId: b.organism_id ?? null,
        seller, buyer: b.buyer, lines: b.lines,
        currency: b.currency, paymentTermsDays: b.payment_terms_days, notes: b.notes ?? null,
      });
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { invoice }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.delete('/v1/finance/invoices/:id', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      await deleteDraft(storage, resolve(req), req.params.id as string);
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { removed: req.params.id }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Draft → sent: claims the gapless number, derives reference + dates, resolves the fiscal year.
  router.post('/v1/finance/invoices/:id/send', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const parsed = SendSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_SEND', parsed.error.message));
        return;
      }
      let invoice = await send(storage, resolve(req), req.params.id as string, parsed.data.delivery_method, parsed.data.reference_style ?? 'fi');
      // Finvoice delivery submits to the operator right away. The state transition above
      // stands even when the submission fails (the number is claimed, the document exists);
      // a failed submission is retryable via POST .../deliver-finvoice.
      if (parsed.data.delivery_method === 'finvoice') {
        invoice = await submitInvoice(config, storage, invoice);
      }
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { invoice }, [
        { description: 'Download the Finvoice 3.0 XML', method: 'GET', url: `/v1/finance/invoices/${invoice.id}/finvoice.xml` },
        { description: 'Mark the invoice paid', method: 'POST', url: `/v1/finance/invoices/${invoice.id}/mark-paid` },
      ]));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Mark paid; books the income voucher (idempotent — a second call returns the paid invoice).
  router.post('/v1/finance/invoices/:id/mark-paid', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const parsed = MarkPaidSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_PAYMENT', parsed.error.message));
        return;
      }
      const invoice = await markPaid(storage, resolve(req), req.params.id as string, {
        paidAt: parsed.data.paid_at,
        trackingCode: parsed.data.tracking_code,
        externalRef: parsed.data.external_ref,
      });
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { invoice }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Create a credit-note draft mirroring the original.
  router.post('/v1/finance/invoices/:id/credit-note', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const invoice = await createCreditNote(storage, resolve(req), req.params.id as string);
      emitChange('finance', resolve(req));
      res.status(201).json(success(config.nodeId, { invoice }, [
        { description: 'Send the credit note', method: 'POST', url: `/v1/finance/invoices/${invoice.id}/send` },
      ]));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Finvoice 3.0 XML, generated deterministically from the immutable sent invoice.
  router.get('/v1/finance/invoices/:id/finvoice.xml', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const inv = await requireOwnInvoice(storage, await resolveFinanceOwner(config, storage, req), req.params.id as string);
      let originalNumber: string | null = null;
      if (inv.type === 'credit_note' && inv.creditsInvoiceId) {
        const original = await storage.getInvoice(inv.creditsInvoiceId);
        originalNumber = original?.invoiceNumber ?? null;
      }
      const xml = buildFinvoiceXml(inv, { originalInvoiceNumber: originalNumber });
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="finvoice-${inv.invoiceNumber}.xml"`);
      res.send(xml);
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // (Re)submit a sent invoice to the e-invoice operator — the retry door for a failed submission.
  router.post('/v1/finance/invoices/:id/deliver-finvoice', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const inv = await requireOwnInvoice(storage, resolve(req), req.params.id as string);
      const invoice = await submitInvoice(config, storage, inv);
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { invoice }, [
        { description: 'Poll the delivery status', method: 'POST', url: `/v1/finance/invoices/${invoice.id}/refresh-delivery` },
      ]));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Poll the operator for the delivery outcome (the status feedback loop).
  router.post('/v1/finance/invoices/:id/refresh-delivery', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const inv = await requireOwnInvoice(storage, resolve(req), req.params.id as string);
      const invoice = await refreshDeliveryStatus(config, storage, inv);
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { invoice }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Human-readable A4 PDF, rendered deterministically from the immutable sent invoice.
  router.get('/v1/finance/invoices/:id/pdf', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const inv = await requireOwnInvoice(storage, await resolveFinanceOwner(config, storage, req), req.params.id as string);
      const pdf = await renderInvoicePdf(inv);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="lasku-${inv.invoiceNumber}.pdf"`);
      res.send(pdf);
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  return router;
}
