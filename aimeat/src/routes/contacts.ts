/**
 * @file contacts.ts
 * @description Generic per-owner CONTACTS (address book) REST API — a thin HTTP layer over the
 *   shared core in services/contacts.ts (also used by the MCP tools, so both surfaces behave
 *   identically). A contact is a ContactConsentRecord whose `origin` marks how it arrived
 *   ('message' = the DM first-contact gate created it reactively; 'saved' = the owner explicitly
 *   added it here). Reusable by any grant surface (organism invites, workspace grants, app
 *   grants, pickers). Email lookup is EXACT-match only (privacy-preserving hash), rate-limited.
 * @structure contactsRouter(config, storage): GET /v1/contacts (merged address book);
 *   POST /v1/contacts (save); DELETE /v1/contacts/:contactId (remove — never resets the DM gate);
 *   POST /v1/contacts/resolve (email → GHII exact match, or invite fallback signal).
 * @usage app.use(contactsRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: merged list, proactive save, gate-safe delete, email resolve.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, ContactConsentRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { resolveIdentity } from '../utils/gaii.js';
import { ContactsError, listContactsMerged, saveContact, removeContact, resolveContactEmail } from '../services/contacts.js';

export function contactsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);
  const sendErr = (res: Parameters<Parameters<Router['get']>[1]>[1], e: unknown): boolean => {
    if (e instanceof ContactsError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return true; }
    return false;
  };

  /* ── GET /v1/contacts — the merged address book (saved/gate rows ∪ DM conversation peers),
   * enriched with kind + display name. ?state= narrows to one consent state (default hides
   * blocked); ?q= filters on id/display name. ── */
  router.get('/v1/contacts', requireAuth(), requireRole('owner'), async (req, res) => {
    const contacts = await listContactsMerged(storage, resolve(req), {
      state: typeof req.query.state === 'string' ? req.query.state as ContactConsentRecord['state'] : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
    });
    res.json(success(config.nodeId, { contacts, total: contacts.length }));
  });

  /* ── POST /v1/contacts — save a contact. Body: { contact_id } (bare local owner name, GHII,
   * GAII, or GEAI). A blocked contact stays blocked (409) — lift the block via Messages first. ── */
  router.post('/v1/contacts', requireAuth(), requireRole('owner'), async (req, res) => {
    const raw = (req.body ?? {}).contact_id;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "contact_id" is required'));
      return;
    }
    try {
      const contact = await saveContact(storage, config, resolve(req), raw);
      res.status(201).json(success(config.nodeId, { contact }));
    } catch (e) { if (!sendErr(res, e)) throw e; }
  });

  /* ── DELETE /v1/contacts/:contactId — remove from the address book WITHOUT resetting the DM
   * first-contact gate (a row with message history keeps its gate state as origin 'message'). ── */
  router.delete('/v1/contacts/:contactId', requireAuth(), requireRole('owner'), async (req, res) => {
    const contactId = decodeURIComponent(req.params.contactId as string);
    try {
      await removeContact(storage, resolve(req), contactId);
      res.json(success(config.nodeId, { removed: contactId }));
    } catch (e) { if (!sendErr(res, e)) throw e; }
  });

  /* ── POST /v1/contacts/resolve — EXACT-match email → local owner. Authenticated + rate-limited
   * hash equality (no enumeration; the invite flow already discloses the same fact). ── */
  router.post('/v1/contacts/resolve', requireAuth(), requireRole('owner'), rateLimit({ max: 20, windowMs: 10 * 60 * 1000 }), async (req, res) => {
    try {
      const result = await resolveContactEmail(storage, ((req.body ?? {}).email ?? '').toString());
      res.json(success(config.nodeId, result));
    } catch (e) { if (!sendErr(res, e)) throw e; }
  });

  return router;
}
