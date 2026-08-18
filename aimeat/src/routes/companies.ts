/**
 * @file src/routes/companies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The company registry's REST surface: create a company (claiming
 *   {slug}.co.<apex>), list/read/update your own, set what the address serves, and check
 *   whether a name is free. Business rules live in services/company/company-service.ts.
 *
 *   Identity: the owner bucket behind the session (owner, their agent, or a granted app),
 *   the same resolution the finance routes use — a founder's agent manages the same
 *   companies the founder does. Absent and not-yours answer identically (404).
 *
 * @structure zod schemas · sendErr mapper · companiesRouter
 * @usage app.use(companiesRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.2.0 — 2026-08-08 — GET/PUT/DELETE /v1/companies/:id/portfolio: the company's own page.
 *   v1.1.0 — 2026-08-07 — GET/PUT/DELETE /v1/companies/:id/smtp: a company's own sending identity.
 *   v1.0.0 — 2026-08-07 — Company registry + co origin.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { emitChange } from '../services/event-bus.js';
import {
  CompanyError, createCompany, updateCompany, setFrontPage, deleteCompany,
  requireOwnCompany, checkSlugAvailable, companyAddress, slugify,
} from '../services/company/company-service.js';
import type { CompanyRecord } from '../models/company-schemas.js';
import {
  setCompanySmtp, getCompanySmtpPublic, deleteCompanySmtp,
} from '../services/company/company-smtp.js';
import {
  publishCompanyPortfolio, getCompanyPortfolio, deleteCompanyPortfolio,
} from '../services/company/company-portfolio.js';

const IdentitySchema = {
  description: z.string().max(500).nullish(),
  organism_id: z.string().max(80).nullish(),
  business_id: z.string().max(35).nullish(),
  vat_id: z.string().max(35).nullish(),
  street_address: z.string().max(70).nullish(),
  postal_code: z.string().max(20).nullish(),
  city: z.string().max(70).nullish(),
  country: z.string().length(2).nullish(),
  email: z.string().email().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  iban: z.string().max(34).nullish(),
  bic: z.string().max(11).nullish(),
  einvoice_address: z.string().max(35).nullish(),
  einvoice_operator: z.string().max(35).nullish(),
};

const CreateSchema = z.object({
  name: z.string().min(2).max(140),
  slug: z.string().min(2).max(63).optional(),
  ...IdentitySchema,
}).strict();

const UpdateSchema = z.object({
  name: z.string().min(2).max(140).optional(),
  ...IdentitySchema,
}).strict();

const SmtpSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().max(200).nullish(),
  /** Plaintext on the way in only — stored encrypted, never returned by any read. */
  password: z.string().max(400).nullish(),
  from_address: z.string().email().max(200),
  from_name: z.string().max(140).nullish(),
  reply_to: z.string().email().max(200).nullish(),
}).strict();

const PortfolioSchema = z.object({
  /** The whole document. A page is small enough to send inline; the cap is portfolioMaxSizeKb. */
  html: z.string().min(1),
}).strict();

const FrontPageSchema = z.object({
  kind: z.enum(['app', 'portfolio', 'redirect', 'none']),
  target: z.string().max(500).optional(),
}).strict();

/** Wire shape: the record plus the address it answers on (derived, never stored). */
function withAddress(config: AimeatConfig, company: CompanyRecord): Record<string, unknown> {
  return { ...company, address: companyAddress(config, company), co_origin_enabled: config.coOriginEnabled };
}

function sendErr(res: Response, config: AimeatConfig, e: unknown): boolean {
  if (e instanceof CompanyError) {
    res.status(e.statusCode).json(error(config.nodeId, e.code, e.message));
    return true;
  }
  return false;
}

function toInput(b: z.infer<typeof CreateSchema> | z.infer<typeof UpdateSchema>): Record<string, unknown> {
  const any = b as Record<string, unknown>;
  return {
    name: any.name as string,
    slug: any.slug as string | undefined,
    description: any.description ?? null,
    organismId: any.organism_id ?? null,
    businessId: any.business_id ?? null,
    vatId: any.vat_id ?? null,
    streetAddress: any.street_address ?? null,
    postalCode: any.postal_code ?? null,
    city: any.city ?? null,
    country: any.country ?? null,
    email: any.email ?? null,
    phone: any.phone ?? null,
    iban: any.iban ?? null,
    bic: any.bic ?? null,
    einvoiceAddress: any.einvoice_address ?? null,
    einvoiceOperator: any.einvoice_operator ?? null,
  };
}

export function companiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request): string => `${req.auth!.owner}@${config.nodeId}`;
  // Claiming names is the amplification surface here (a squatter would want volume).
  const createLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

  // Is this address free? Advisory — the create call is what actually arbitrates.
  router.get('/v1/companies/available', requireAuth(), requireScope('company:read'), async (req, res) => {
    const raw = typeof req.query.slug === 'string' ? req.query.slug : (typeof req.query.name === 'string' ? slugify(req.query.name) : '');
    if (!raw) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'slug or name is required'));
      return;
    }
    const result = await checkSlugAvailable(storage, raw);
    res.json(success(config.nodeId, {
      ...result,
      address: config.coHost ? `${result.slug}.${config.coHost}` : null,
    }));
  });

  router.get('/v1/companies', requireAuth(), requireScope('company:read'), async (req, res) => {
    const owner = resolve(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt((req.query.per_page as string) ?? '50', 10) || 50));
    const [rows, total] = await Promise.all([
      storage.listCompanies({ ownerGhii: owner, limit: perPage, offset: (page - 1) * perPage }),
      storage.countCompanies({ ownerGhii: owner }),
    ]);
    res.json(success(config.nodeId, {
      companies: rows.map((c) => withAddress(config, c)), total,
    }, undefined, { page, per_page: perPage, total }));
  });

  router.post('/v1/companies', requireAuth(), requireScope('company:write'), createLimit, async (req, res) => {
    try {
      const parsed = CreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_COMPANY', parsed.error.message));
        return;
      }
      const company = await createCompany(storage, resolve(req), toInput(parsed.data) as never);
      emitChange('companies', resolve(req));
      res.status(201).json(success(config.nodeId, { company: withAddress(config, company) }, [
        { description: 'Set what the address serves', method: 'PUT', url: `/v1/companies/${company.id}/front-page` },
      ]));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.get('/v1/companies/:id', requireAuth(), requireScope('company:read'), async (req, res) => {
    try {
      const company = await requireOwnCompany(storage, resolve(req), req.params.id as string);
      res.json(success(config.nodeId, { company: withAddress(config, company) }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.put('/v1/companies/:id', requireAuth(), requireScope('company:write'), async (req, res) => {
    try {
      const parsed = UpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_COMPANY', parsed.error.message));
        return;
      }
      const company = await updateCompany(storage, resolve(req), req.params.id as string, toInput(parsed.data) as never);
      emitChange('companies', resolve(req));
      res.json(success(config.nodeId, { company: withAddress(config, company) }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.put('/v1/companies/:id/front-page', requireAuth(), requireScope('company:write'), async (req, res) => {
    try {
      const parsed = FrontPageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_FRONT_PAGE', parsed.error.message));
        return;
      }
      const company = await setFrontPage(storage, resolve(req), req.params.id as string, {
        kind: parsed.data.kind, target: parsed.data.target ?? '',
      });
      emitChange('companies', resolve(req));
      res.json(success(config.nodeId, { company: withAddress(config, company) }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.delete('/v1/companies/:id', requireAuth(), requireScope('company:write'), async (req, res) => {
    try {
      await deleteCompany(storage, resolve(req), req.params.id as string);
      emitChange('companies', resolve(req));
      res.json(success(config.nodeId, { removed: req.params.id }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── A company's own sending identity (outbound door) ──────────────────────

  router.get('/v1/companies/:id/smtp', requireAuth(), requireScope('company:read'), async (req, res) => {
    try {
      const smtp = await getCompanySmtpPublic(storage, resolve(req), req.params.id as string);
      res.json(success(config.nodeId, { smtp }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.put('/v1/companies/:id/smtp', requireAuth(), requireScope('company:write'), async (req, res) => {
    try {
      const parsed = SmtpSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_SMTP', parsed.error.message));
        return;
      }
      const b = parsed.data;
      const smtp = await setCompanySmtp(config, storage, resolve(req), req.params.id as string, {
        host: b.host, port: b.port, secure: b.secure,
        username: b.username ?? null, password: b.password ?? undefined,
        fromAddress: b.from_address, fromName: b.from_name ?? null, replyTo: b.reply_to ?? null,
      });
      emitChange('companies', resolve(req));
      res.json(success(config.nodeId, { smtp }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.delete('/v1/companies/:id/smtp', requireAuth(), requireScope('company:write'), async (req, res) => {
    try {
      await deleteCompanySmtp(storage, resolve(req), req.params.id as string);
      emitChange('companies', resolve(req));
      res.json(success(config.nodeId, { removed: req.params.id }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── The company's own page (front page kind 'portfolio') ──────────────────

  router.get('/v1/companies/:id/portfolio', requireAuth(), requireScope('company:read'), async (req, res) => {
    try {
      const status = await getCompanyPortfolio(storage, resolve(req), req.params.id as string);
      res.json(success(config.nodeId, { portfolio: status }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.put('/v1/companies/:id/portfolio', requireAuth(), requireScope('company:write'), async (req, res) => {
    try {
      const parsed = PortfolioSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_PORTFOLIO', parsed.error.message));
        return;
      }
      const { company, status } = await publishCompanyPortfolio(
        config, storage, resolve(req), req.params.id as string, parsed.data.html,
      );
      emitChange('companies', resolve(req));
      res.json(success(config.nodeId, { company: withAddress(config, company), portfolio: status }, [
        { description: 'Open the published page', method: 'GET', url: companyAddress(config, company) ?? '/' },
      ]));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.delete('/v1/companies/:id/portfolio', requireAuth(), requireScope('company:write'), async (req, res) => {
    try {
      const company = await deleteCompanyPortfolio(storage, resolve(req), req.params.id as string);
      emitChange('companies', resolve(req));
      res.json(success(config.nodeId, { company: withAddress(config, company) }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  return router;
}
