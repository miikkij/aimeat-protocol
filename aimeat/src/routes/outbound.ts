/**
 * @file src/routes/outbound.ts
 * @description The outbound door's REST surface: recipient registry CRUD, the policied
 *   send, the append-only send log, bounce marking, and the PUBLIC token-based
 *   unsubscribe (the one endpoint here that must work without any authentication —
 *   an opt-out that requires a login is not an opt-out).
 *
 *   Identity: owner-bucket resolution (same as finance) — the owner, their agents and
 *   granted apps all operate the same registry. Sends require scope outbound:send.
 *
 * @structure zod schemas · sendErr mapper · outboundRouter
 * @usage app.use(outboundRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
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
  OutboundError, ensureContact, requireOwnContact, recordBounce, setOptOut, sendOutbound,
} from '../services/outbound/outbound-service.js';

const ContactSchema = z.object({
  name: z.string().min(1).max(140),
  email: z.string().email().max(200),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  notes: z.string().max(1000).nullish(),
}).strict();

const SendSchema = z.object({
  contact_id: z.string().min(1).max(80),
  kind: z.enum(['transactional', 'marketing', 'invoice']),
  subject: z.string().max(300).optional(),
  body: z.string().max(20000).optional(),
  template_id: z.string().max(80).optional(),
  variables: z.record(z.string(), z.string().max(2000)).optional(),
  invoice_id: z.string().max(80).optional(),
  reply_to: z.string().email().max(200).optional(),
  from_name: z.string().max(140).optional(),
}).strict();

/** optOutToken is the RECIPIENT's capability (the unsubscribe link) — never shown to the owner. */
function publicContact(c: import('../models/outbound-schemas.js').OutboundContactRecord): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...c };
  delete safe.optOutToken;
  return safe;
}

function sendErr(res: Response, config: AimeatConfig, e: unknown): boolean {
  if (e instanceof OutboundError) {
    res.status(e.statusCode).json(error(config.nodeId, e.code, e.message));
    return true;
  }
  return false;
}

export function outboundRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request): string => `${req.auth!.owner}@${config.nodeId}`;
  // The send is an amplification surface: per-principal limiter on top of the daily limit.
  const sendLimit = rateLimit({ windowMs: 60_000, max: 30 });

  // ── Contacts ──────────────────────────────────────────────────────────────

  router.post('/v1/outbound/contacts', requireAuth(), requireScope('outbound:send'), async (req, res) => {
    try {
      const parsed = ContactSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_CONTACT', parsed.error.message));
        return;
      }
      const contact = await ensureContact(storage, resolve(req), parsed.data);
      emitChange('outbound', resolve(req));
      res.status(201).json(success(config.nodeId, { contact: publicContact(contact) }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.get('/v1/outbound/contacts', requireAuth(), requireScope('outbound:send'), async (req, res) => {
    const owner = resolve(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt((req.query.per_page as string) ?? '50', 10) || 50));
    const query = {
      ownerGhii: owner,
      optedOut: req.query.opted_out === 'true' ? true : req.query.opted_out === 'false' ? false : undefined,
      suppressed: req.query.suppressed === 'true' ? true : req.query.suppressed === 'false' ? false : undefined,
      tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
    };
    const [rows, total] = await Promise.all([
      storage.listOutboundContacts({ ...query, limit: perPage, offset: (page - 1) * perPage }),
      storage.countOutboundContacts(query),
    ]);
    const contacts = rows.map(publicContact);
    res.json(success(config.nodeId, { contacts, total }, undefined, { page, per_page: perPage, total }));
  });

  router.delete('/v1/outbound/contacts/:id', requireAuth(), requireScope('outbound:send'), async (req, res) => {
    try {
      const contact = await requireOwnContact(storage, resolve(req), req.params.id as string);
      await storage.deleteOutboundContact(contact.id);
      emitChange('outbound', resolve(req));
      res.json(success(config.nodeId, { removed: contact.id }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Owner-side opt-out toggle (the recipient's own path is the public unsubscribe link).
  router.post('/v1/outbound/contacts/:id/opt-out', requireAuth(), requireScope('outbound:send'), async (req, res) => {
    try {
      const optedOut = req.body?.opted_out;
      if (typeof optedOut !== 'boolean') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'opted_out must be a boolean'));
        return;
      }
      const contact = await requireOwnContact(storage, resolve(req), req.params.id as string);
      const updated = await setOptOut(storage, contact, optedOut);
      emitChange('outbound', resolve(req));
      res.json(success(config.nodeId, { contact: publicContact(updated) }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // Bounce marking (a provider callback or the owner reading their bounce mailbox).
  // The third bounce suppresses the address; clearing is explicit with clear=true.
  router.post('/v1/outbound/contacts/:id/bounce', requireAuth(), requireScope('outbound:send'), async (req, res) => {
    try {
      const contact = await requireOwnContact(storage, resolve(req), req.params.id as string);
      if (req.body?.clear === true) {
        const cleared = { ...contact, bounceCount: 0, suppressedAt: null, updatedAt: new Date().toISOString() };
        await storage.updateOutboundContact(cleared);
        emitChange('outbound', resolve(req));
        res.json(success(config.nodeId, { contact: publicContact(cleared) }));
        return;
      }
      const updated = await recordBounce(storage, contact);
      emitChange('outbound', resolve(req));
      res.json(success(config.nodeId, { contact: publicContact(updated) }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── Send ──────────────────────────────────────────────────────────────────

  router.post('/v1/outbound/send', requireAuth(), requireScope('outbound:send'), sendLimit, async (req, res) => {
    try {
      const parsed = SendSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_SEND', parsed.error.message));
        return;
      }
      const b = parsed.data;
      const result = await sendOutbound(config, storage, resolve(req), {
        contactId: b.contact_id, kind: b.kind,
        subject: b.subject, body: b.body,
        templateId: b.template_id, variables: b.variables,
        invoiceId: b.invoice_id, replyTo: b.reply_to, fromName: b.from_name,
      });
      res.json(success(config.nodeId, {
        message: result.log, channel: result.channel, status: result.status,
      }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── Send log ──────────────────────────────────────────────────────────────

  router.get('/v1/outbound/log', requireAuth(), requireScope('outbound:send'), async (req, res) => {
    const owner = resolve(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt((req.query.per_page as string) ?? '50', 10) || 50));
    const query = {
      ownerGhii: owner,
      contactId: typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined,
      kind: (['transactional', 'marketing', 'invoice'] as const).find((k) => k === req.query.kind),
      status: (['sent', 'failed', 'suppressed', 'skipped'] as const).find((s) => s === req.query.status),
    };
    const [messages, total] = await Promise.all([
      storage.listOutboundMessages({ ...query, limit: perPage, offset: (page - 1) * perPage }),
      storage.countOutboundMessages(query),
    ]);
    res.json(success(config.nodeId, { messages, total }, undefined, { page, per_page: perPage, total }));
  });

  // ── Public unsubscribe (token-based, NO auth — an opt-out behind a login is not one) ──

  router.get('/v1/outbound/unsubscribe', rateLimit({ windowMs: 60_000, max: 30, keyBy: 'ip' }), async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token || token.length > 100) {
      res.status(400).send('Invalid unsubscribe link');
      return;
    }
    const contact = await storage.findOutboundContactByToken(token);
    // Unknown token answers the same as success — the link must not confirm address existence.
    if (contact && !contact.optedOut) {
      await setOptOut(storage, contact, true);
      emitChange('outbound', contact.ownerGhii);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send('<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>Tilaus peruttu</title></head>'
      + '<body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">'
      + '<h1>Tilaus peruttu / Unsubscribed</h1>'
      + '<p>Et saa enää markkinointiviestejä tältä lähettäjältä. Laskut ja tilausvahvistukset toimitetaan edelleen.</p>'
      + '<p>You will no longer receive marketing messages from this sender. Invoices and order confirmations are still delivered.</p>'
      + '</body></html>');
  });

  return router;
}
