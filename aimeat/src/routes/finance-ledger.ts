/**
 * @file src/routes/finance-ledger.ts
 * @description Ledger endpoints of the finance domain: vouchers (append-only booking,
 *   reversal, evidence), the VAT-code registry, fiscal years with locking, the VAT
 *   period report, and the accountant exports (CSV + Finvoice ZIP). Invoice endpoints
 *   live in finance.ts; both share the owner-bucket identity discipline.
 * @structure zod schemas · financeLedgerRouter (vouchers · vat-codes · fiscal-years ·
 *   vat-report · exports)
 * @usage app.use(financeLedgerRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { FinanceError } from '../services/finance/errors.js';
import { bookVoucher, reverseVoucher, attachEvidence } from '../services/finance/vouchers.js';
import { vatCodesValidOn, ensureVatCodesSeeded } from '../services/finance/vat-codes.js';
import { vatPeriodReport } from '../services/finance/vat-report.js';
import { pnlReport } from '../services/finance/pnl.js';
import { vouchersCsv, invoicesCsv, buildZip } from '../services/finance/export.js';
import { buildFinvoiceXml } from '../services/finance/finvoice.js';
import {
  resolveFinanceOwner, grantAccountant, revokeAccountant, listAccountants, listClients,
} from '../services/finance/accountant-access.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

const VatEntrySchema = z.object({
  vatCodeId: z.string().min(1).max(60),
  vatRateBp: z.number().int().min(0).max(10000),
  netMinor: z.number().int(),
  vatMinor: z.number().int(),
}).strict();

const VoucherSchema = z.object({
  organism_id: z.string().max(80).nullish(),
  date: z.string().regex(DATE_RE),
  description: z.string().min(1).max(500),
  direction: z.enum(['income', 'expense']),
  source: z.enum(['receipt', 'manual']),
  amount_minor: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  vat_breakdown: z.array(VatEntrySchema).max(10).optional(),
  counterparty: z.string().max(200).nullish(),
  invoice_id: z.string().max(80).nullish(),
  attachments: z.array(z.string().min(1).max(300)).max(20).optional(),
}).strict();

const FiscalYearSchema = z.object({
  label: z.string().min(1).max(40),
  start_date: z.string().regex(DATE_RE),
  end_date: z.string().regex(DATE_RE),
  organism_id: z.string().max(80).nullish(),
}).strict();

function sendErr(res: Response, config: AimeatConfig, e: unknown): boolean {
  if (e instanceof FinanceError) {
    res.status(e.statusCode).json(error(config.nodeId, e.code, e.message));
    return true;
  }
  return false;
}

export function financeLedgerRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request): string => `${req.auth!.owner}@${config.nodeId}`;

  // ── Vouchers ──────────────────────────────────────────────────────────────

  // Manual/receipt booking. Stripe/checkout/invoice vouchers come from their own hooks.
  router.post('/v1/finance/vouchers', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const parsed = VoucherSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_VOUCHER', parsed.error.message));
        return;
      }
      const b = parsed.data;
      const voucher = await bookVoucher(storage, resolve(req), {
        organismId: b.organism_id ?? null,
        date: b.date, description: b.description, direction: b.direction, source: b.source,
        amountMinor: b.amount_minor, currency: b.currency,
        vatBreakdown: b.vat_breakdown, counterparty: b.counterparty ?? null,
        invoiceId: b.invoice_id ?? null, attachments: b.attachments,
      });
      emitChange('finance', resolve(req));
      res.status(201).json(success(config.nodeId, { voucher }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.get('/v1/finance/vouchers', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const owner = await resolveFinanceOwner(config, storage, req);
      const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
      const perPage = Math.min(200, Math.max(1, parseInt((req.query.per_page as string) ?? '50', 10) || 50));
      const q = {
        ownerGhii: owner,
        fiscalYearId: typeof req.query.fiscal_year_id === 'string' ? req.query.fiscal_year_id : undefined,
        source: ['stripe', 'checkout', 'invoice', 'receipt', 'manual', 'morsel'].includes(req.query.source as string)
          ? req.query.source as 'stripe' | 'checkout' | 'invoice' | 'receipt' | 'manual' | 'morsel' : undefined,
        direction: (['income', 'expense', 'transfer'] as const).find((d) => d === req.query.direction),
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
      };
      const [vouchers, total] = await Promise.all([
        storage.listVouchers({ ...q, limit: perPage, offset: (page - 1) * perPage }),
        storage.countVouchers(q),
      ]);
      res.json(success(config.nodeId, { vouchers, total }, undefined, { page, per_page: perPage, total }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.get('/v1/finance/vouchers/:id', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const owner = await resolveFinanceOwner(config, storage, req);
      const voucher = await storage.getVoucher(req.params.id as string);
      if (!voucher || voucher.ownerGhii !== owner) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Voucher not found'));
        return;
      }
      res.json(success(config.nodeId, { voucher }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Correction: books the opposite-direction counter-voucher; the original is never touched.
  router.post('/v1/finance/vouchers/:id/reverse', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!reason || reason.length > 300) {
        res.status(400).json(error(config.nodeId, 'INVALID_REASON', 'reason is required (max 300 chars)'));
        return;
      }
      const voucher = await reverseVoucher(storage, resolve(req), req.params.id as string, reason);
      emitChange('finance', resolve(req));
      res.status(201).json(success(config.nodeId, { voucher }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Adds evidence (storage keys, e.g. receipt images) to a booked voucher.
  router.post('/v1/finance/vouchers/:id/attachments', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const keys = req.body?.keys;
      if (!Array.isArray(keys) || keys.length === 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_ATTACHMENTS', 'keys must be a non-empty array of storage keys'));
        return;
      }
      const voucher = await attachEvidence(storage, resolve(req), req.params.id as string, keys as string[]);
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { voucher }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── VAT codes ─────────────────────────────────────────────────────────────

  router.get('/v1/finance/vat-codes', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const date = typeof req.query.date === 'string' && DATE_RE.test(req.query.date)
        ? req.query.date : new Date().toISOString().slice(0, 10);
      const all = req.query.all === 'true';
      let codes;
      if (all) {
        await ensureVatCodesSeeded(storage);
        codes = await storage.listVatCodes();
      } else {
        codes = await vatCodesValidOn(storage, date);
      }
      res.json(success(config.nodeId, { vat_codes: codes, date: all ? null : date }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── Fiscal years ──────────────────────────────────────────────────────────

  router.get('/v1/finance/fiscal-years', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const years = await storage.listFiscalYears(await resolveFinanceOwner(config, storage, req));
      res.json(success(config.nodeId, { fiscal_years: years }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.post('/v1/finance/fiscal-years', requireAuth(), requireScope('finance:write'), async (req, res) => {
    try {
      const parsed = FiscalYearSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_FISCAL_YEAR', parsed.error.message));
        return;
      }
      const b = parsed.data;
      if (b.start_date >= b.end_date) {
        res.status(400).json(error(config.nodeId, 'INVALID_FISCAL_YEAR', 'start_date must be before end_date'));
        return;
      }
      const owner = resolve(req);
      const existing = await storage.listFiscalYears(owner);
      const overlap = existing.find((y) => y.startDate <= b.end_date && b.start_date <= y.endDate);
      if (overlap) {
        res.status(409).json(error(config.nodeId, 'FISCAL_YEAR_OVERLAP', `Overlaps fiscal year ${overlap.label} (${overlap.startDate}..${overlap.endDate})`));
        return;
      }
      const now = new Date().toISOString();
      const record = {
        id: randomUUID(), ownerGhii: owner, organismId: b.organism_id ?? null,
        label: b.label, startDate: b.start_date, endDate: b.end_date,
        locked: false, lockedAt: null, createdAt: now, updatedAt: now,
      };
      await storage.createFiscalYear(record);
      emitChange('finance', owner);
      res.status(201).json(success(config.nodeId, { fiscal_year: record }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Lock/unlock the period — the human's close. Same gate note as the accountant block:
  // the scope is what fences an agent whose token inherited the owner role.
  router.post('/v1/finance/fiscal-years/:id/lock', requireAuth(), requireRole('owner'), requireScope('finance:write'), async (req, res) => {
    try {
      const locked = req.body?.locked;
      if (typeof locked !== 'boolean') {
        res.status(400).json(error(config.nodeId, 'INVALID_LOCK', 'locked must be a boolean'));
        return;
      }
      const year = await storage.getFiscalYear(req.params.id as string);
      if (!year || year.ownerGhii !== resolve(req)) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Fiscal year not found'));
        return;
      }
      await storage.setFiscalYearLocked(year.id, locked, locked ? new Date().toISOString() : null);
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { fiscal_year: { ...year, locked, lockedAt: locked ? new Date().toISOString() : null } }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── VAT period report ─────────────────────────────────────────────────────

  router.get('/v1/finance/vat-report', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : from;
      if (!MONTH_RE.test(from)) {
        res.status(400).json(error(config.nodeId, 'INVALID_PERIOD', 'from (yyyy-mm) is required'));
        return;
      }
      const report = await vatPeriodReport(storage, await resolveFinanceOwner(config, storage, req), from, to);
      res.json(success(config.nodeId, { report }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── P&L period summary (tuloslaskelma-kooste) ─────────────────────────────

  router.get('/v1/finance/pnl', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : from;
      if (!MONTH_RE.test(from)) {
        res.status(400).json(error(config.nodeId, 'INVALID_PERIOD', 'from (yyyy-mm) is required'));
        return;
      }
      const report = await pnlReport(storage, await resolveFinanceOwner(config, storage, req), from, to);
      res.json(success(config.nodeId, { report }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── Exports ───────────────────────────────────────────────────────────────

  router.get('/v1/finance/export/vouchers.csv', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const owner = await resolveFinanceOwner(config, storage, req);
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const vouchers = await storage.listVouchers({ ownerGhii: owner, from, to, limit: 10000 });
      vouchers.sort((a, b) => a.voucherNumber - b.voucherNumber);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="tositteet.csv"');
      res.send(vouchersCsv(vouchers));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.get('/v1/finance/export/invoices.csv', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const owner = await resolveFinanceOwner(config, storage, req);
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const invoices = await storage.listInvoices({ ownerGhii: owner, from, to, limit: 10000 });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="laskut.csv"');
      res.send(invoicesCsv(invoices));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Every sent/paid/credited invoice in the range as Finvoice XML, bundled in one ZIP.
  router.get('/v1/finance/export/finvoice.zip', requireAuth(), requireScope('finance:read'), async (req, res) => {
    try {
      const owner = await resolveFinanceOwner(config, storage, req);
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const invoices = await storage.listInvoices({
        ownerGhii: owner, from, to, status: ['sent', 'paid', 'overdue', 'credited'], limit: 10000,
      });
      const entries = [];
      for (const inv of invoices) {
        let originalNumber: string | null = null;
        if (inv.type === 'credit_note' && inv.creditsInvoiceId) {
          originalNumber = (await storage.getInvoice(inv.creditsInvoiceId))?.invoiceNumber ?? null;
        }
        entries.push({
          name: `finvoice-${inv.invoiceNumber}.xml`,
          data: Buffer.from(buildFinvoiceXml(inv, { originalInvoiceNumber: originalNumber }), 'utf-8'),
        });
      }
      const zip = buildZip(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="finvoice-laskut.zip"');
      res.send(zip);
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── Accountant role (read-only grant to another local owner) ──────────────
  // Gate note: agent tokens inherit the owner role on this node (intra-owner scope
  // collapse, routes/auth.ts), so requireRole('owner') alone does not fence agents —
  // the scope is the fence: an owner session bypasses it, an agent needs finance:write.

  router.get('/v1/finance/accountants', requireAuth(), requireRole('owner'), requireScope('finance:read'), async (req, res) => {
    res.json(success(config.nodeId, { accountants: await listAccountants(storage, resolve(req)) }));
  });

  router.post('/v1/finance/accountants', requireAuth(), requireRole('owner'), requireScope('finance:write'), async (req, res) => {
    try {
      const name = typeof req.body?.accountant === 'string' ? req.body.accountant.trim() : '';
      const accountants = await grantAccountant(config, storage, resolve(req), name);
      emitChange('finance', resolve(req));
      res.status(201).json(success(config.nodeId, { accountants }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.delete('/v1/finance/accountants/:name', requireAuth(), requireRole('owner'), requireScope('finance:write'), async (req, res) => {
    try {
      const accountants = await revokeAccountant(config, storage, resolve(req), req.params.name as string);
      emitChange('finance', resolve(req));
      res.json(success(config.nodeId, { accountants }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // The accountant's verified client list (the multi-client view's backbone).
  router.get('/v1/finance/clients', requireAuth(), requireScope('finance:read'), async (req, res) => {
    res.json(success(config.nodeId, { clients: await listClients(storage, resolve(req)) }));
  });

  return router;
}
