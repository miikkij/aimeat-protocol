/**
 * @file src/routes/outbound.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.1.0 — 2026-08-07 — The send accepts company_id: the message then leaves through that
 *     company's own SMTP server when it has one.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { parseDisclosure } from '../services/outbound/ai-disclosure.js';
import {
  BUILT_IN_THEMES, BUILT_IN_THEME_IDS, DEFAULT_THEME_ID, FONT_NAMES, isThemeId, validateTheme,
} from '../services/outbound/email-theme.js';
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
  /**
   * What the message looks like: a built-in id or one of the owner's own themes. Validated at
   * SHAPE only here; whether it exists is answered by GET /v1/outbound/themes, because a theme
   * that is missing is the default look rather than a refused send.
   */
  theme: z.string().max(40).optional(),
  from_name: z.string().max(140).optional(),
  /** Send as this company: its own SMTP identity is used when it has one. */
  company_id: z.string().max(80).optional(),
  /**
   * Send THROUGH the caller's own connected mailbox, so the message really leaves their Gmail or
   * Outlook and lands in their Sent Items. Must be their OWN connection and must carry the sending
   * permission; both are checked against the connection store, never taken from the request.
   */
  connection_id: z.string().max(80).optional(),
  /** A verified alias of that mailbox to send as. Checked against the provider, never trusted. */
  from_alias: z.string().email().max(200).optional(),
  /**
   * Optionally mark the message as machine-written, in a header. A level on its own, or a level
   * with the provenance record this node minted for the completion. Declaring it and then asking
   * for it to be left out is not possible: there is no parameter for that.
   */
  ai_disclosure: z.union([
    z.enum(['none', 'ai-assisted', 'ai-generated', 'autonomous']),
    z.object({
      level: z.enum(['none', 'ai-assisted', 'ai-generated', 'autonomous']),
      provenance_id: z.string().max(80).optional(),
    }).strict(),
  ]).optional(),
  /** Buttons, as data. The server builds the anchors; see SendInput.links for why. */
  links: z.array(z.object({
    label: z.string().max(120),
    url: z.string().url().max(600),
  })).max(10).optional(),
  /** Count opens of this message into a signal stream the sender owns. */
  signal_stream_id: z.string().max(64).optional(),
  /** The sender's own opaque token for this recipient. Never an address, never a name. */
  signal_subject: z.string().max(64).optional(),
}).strict();

/**
 * What may leave this route. Two fields never do, for two different reasons:
 *   optOutToken is the RECIPIENT's capability (the unsubscribe link) — anyone holding it can
 *     unsubscribe that person, so it is theirs and not the owner's to see.
 *   emailHash is the server-internal join key promotion uses. It says nothing the caller does not
 *     already have (they sent the address), and publishing it would hand out a precomputed
 *     rainbow-table entry for an address on every read.
 * Written as a deny-list on a spread, which is the pattern that let emailHash out the moment the
 * column existed; the fields are named here so the next one added is a deliberate choice.
 */
function publicContact(c: import('../models/outbound-schemas.js').OutboundContactRecord): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...c };
  delete safe.optOutToken;
  delete safe.emailHash;
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

  /**
   * Does this session hold `connections:use`?
   *
   * It reuses `scopeIsCovered` rather than comparing strings, because scope coverage understands
   * families and a hand-rolled `includes()` would quietly refuse a caller holding a broader word.
   * An owner session that is not acting as an agent or an app bypasses scopes, which is the same
   * rule every requireScope door keeps — written out here because this check is inside a handler
   * rather than in the middleware chain, and an exception the middleware makes has to be made here
   * too or the two doors disagree.
   */
  function holdsConnectionsUse(req: Request): boolean {
    const auth = req.auth;
    if (!auth) return false;
    if (auth.roles.includes('owner') && !auth.roles.includes('agent') && !auth.roles.includes('ecosystem')) {
      return true;
    }
    return scopeIsCovered(auth.scopes, 'connections:use');
  }

  router.post('/v1/outbound/send', requireAuth(), requireScope('outbound:send'), sendLimit, async (req, res) => {
    try {
      const parsed = SendSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_SEND', parsed.error.message));
        return;
      }
      const b = parsed.data;
      const parsedDisclosure = parseDisclosure(b.ai_disclosure);
      if (parsedDisclosure && 'error' in parsedDisclosure) {
        res.status(400).json(error(config.nodeId, 'INVALID_DISCLOSURE', parsedDisclosure.error));
        return;
      }
      const disclosure = parsedDisclosure;
      // TWO WORDS FOR TWO ACTS. `outbound:send` says this caller may send in their owner's name;
      // using somebody's connected MAILBOX is the separate thing `connections:use` governs, and a
      // caller granted only the first must not reach the second by naming a connection here. Owner
      // sessions bypass scopes, as everywhere.
      if (b.connection_id && !holdsConnectionsUse(req)) {
        res.status(403).json(error(config.nodeId, 'SCOPE_REQUIRED',
          'Sending through a connected mailbox needs the connections:use permission as well as outbound:send.'));
        return;
      }
      const result = await sendOutbound(config, storage, resolve(req), {
        contactId: b.contact_id, kind: b.kind,
        subject: b.subject, body: b.body,
        templateId: b.template_id, variables: b.variables,
        invoiceId: b.invoice_id, replyTo: b.reply_to, fromName: b.from_name,
        theme: b.theme,
        companyId: b.company_id,
        connectionId: b.connection_id, fromAlias: b.from_alias,
        ...(disclosure ? { aiDisclosure: disclosure } : {}),
        links: b.links, signalStreamId: b.signal_stream_id, signalSubject: b.signal_subject,
      });
      res.json(success(config.nodeId, {
        message: result.log, channel: result.channel, status: result.status,
      }));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── Themes ────────────────────────────────────────────────────────────────
  //
  // What a picker reads. The built-ins plus whatever the caller has stored under
  // `outbound.theme.*`, each already validated, so a surface can show "this one has a bad value"
  // BEFORE somebody sends with it. That is the whole reason this route exists rather than leaving
  // themes to a plain memory list: the send path deliberately never refuses over decoration, so
  // without a place that says what is wrong, a broken theme would be discovered by a customer.

  router.get('/v1/outbound/themes', requireAuth(), requireScope('outbound:send'), async (req, res) => {
    const owner = resolve(req);
    const own = await storage.listMemory(owner, { prefix: 'outbound.theme.' });
    const mine = own.map((rec) => {
      const id = rec.key.slice('outbound.theme.'.length);
      const { tokens, problems } = validateTheme(rec.value);
      return { id, source: 'own' as const, tokens, ok: problems.length === 0, problems };
    }).filter((t) => isThemeId(t.id));
    // An owner's own name WINS over a built-in of the same id, exactly as the send path resolves it.
    // Listing both would show a person two rows and no way to know which one they would get.
    const overridden = new Set(mine.map((t) => t.id));
    const builtIn = BUILT_IN_THEME_IDS
      .filter((id) => !overridden.has(id))
      .map((id) => ({ id, source: 'built-in' as const, tokens: BUILT_IN_THEMES[id], ok: true, problems: [] }));
    res.json(success(config.nodeId, {
      default: DEFAULT_THEME_ID,
      fonts: FONT_NAMES,
      themes: [...builtIn, ...mine],
    }, [{
      description: 'Store your own theme',
      method: 'PUT',
      url: '/v1/memory/outbound.theme.{id}',
    }]));
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
      // `sent_by=me` is the question a colleague actually asks, and it is resolved here rather
      // than by the caller: a client that had to compose its own principal string would get it
      // wrong for an agent, whose sends are recorded under the agent's own GAII and not its
      // owner's. Any other value filters as given, which is how an owner reads one colleague.
      sentBy: req.query.sent_by === 'me'
        ? owner
        : (typeof req.query.sent_by === 'string' ? req.query.sent_by : undefined),
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
