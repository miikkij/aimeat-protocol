/**
 * @file contacts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Generic per-owner CONTACTS (address book) REST API — a thin HTTP layer over the
 *   shared core in services/contacts.ts (also used by the MCP tools, so both surfaces behave
 *   identically). The address book is a PROJECTION over three sources: contact-consent rows (the
 *   DM first-contact gate, whose `origin` marks how a row arrived), the owner's DM conversation
 *   peers, and contact records — a person who may have no identity on this node at all.
 *   Reusable by any grant surface (organism invites, workspace grants, app grants, pickers).
 *   Email lookup is EXACT-match only (privacy-preserving hash), rate-limited.
 * @structure contactsRouter(config, storage): GET /v1/contacts (merged address book);
 *   POST /v1/contacts (save an identity OR a person); PATCH /v1/contacts/:contactId (what the
 *   owner knows about a person); DELETE /v1/contacts/:contactId (remove — never resets the DM
 *   gate); POST /v1/contacts/resolve (email → GHII exact match, or invite fallback signal).
 * @usage app.use(contactsRouter(config, storage))
 * @version-history
 *   v1.1.0 — 2026-08-17 — TARGET-063: POST accepts { name, email, … } for a person the node does
 *     not have, PATCH edits that card, and the list reports `truncated` rather than stopping
 *     silently. No new authorization word: this is the owner's own address book, as before.
 *   v1.0.0 — 2026-07-16 — Initial: merged list, proactive save, gate-safe delete, email resolve.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, ContactConsentRecord } from '../storage/interface.js';
import type { OutboundContactLink } from '../models/outbound-schemas.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  ContactsError, listContactsMerged, addContact, updatePersonContact, removeContact, resolveContactEmail,
  sendToContact, type AddContactInput,
} from '../services/contacts.js';
import { mintContactHandle, resolveContactHandle } from '../services/contact-handles.js';
import { resolveAppOriginTarget } from '../services/app-origin-target.js';

/** Links as the caller sent them. Shape only — what is ACCEPTABLE (http(s), caps, count) is the
 *  service's decision, made once in normalizeLinks rather than again per surface. */
function readLinks(raw: unknown): OutboundContactLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((l): l is { label?: unknown; url: unknown } => !!l && typeof l === 'object' && 'url' in l)
    .map((l) => ({ label: typeof l.label === 'string' ? l.label : '', url: String(l.url) }));
}

/** The request body for a save, in whichever of the two shapes the caller used. Anything that is
 *  not a well-formed shape is refused here rather than half-interpreted downstream. */
function parseAddInput(body: Record<string, unknown>): AddContactInput | null {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return null;
    return {
      name, email,
      note: typeof body.note === 'string' ? body.note : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : undefined,
      links: readLinks(body.links),
      relation: typeof body.relation === 'string' ? body.relation : null,
    };
  }
  const raw = body.contact_id;
  if (typeof raw === 'string' && raw.trim()) return { contact_id: raw };
  return null;
}

export function contactsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);
  const sendErr = (res: Parameters<Parameters<Router['get']>[1]>[1], e: unknown): boolean => {
    if (e instanceof ContactsError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return true; }
    return false;
  };

  /* ── GET /v1/contacts — the merged address book (consent rows ∪ DM conversation peers ∪ saved
   * people), enriched with kind + display name. ?state= narrows to one consent state (default
   * hides blocked, and excludes people, who have no consent state); ?q= filters on id, display
   * name, saved name or email. ── */
  router.get('/v1/contacts', requireAuth(), requireRole('owner'), async (req, res) => {
    const { contacts, truncated } = await listContactsMerged(storage, resolve(req), {
      state: typeof req.query.state === 'string' ? req.query.state as ContactConsentRecord['state'] : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
    });
    res.json(success(config.nodeId, { contacts, total: contacts.length, truncated }));
  });

  /* ── POST /v1/contacts — save a contact, in either shape:
   *   { contact_id }              a bare local owner name, GHII, GAII or GEAI
   *   { name, email, … }          a person, who may have no identity on this node
   * A blocked contact stays blocked (409) — lift the block via Messages first. ── */
  router.post('/v1/contacts', requireAuth(), requireRole('owner'), async (req, res) => {
    const input = parseAddInput((req.body ?? {}) as Record<string, unknown>);
    if (!input) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'Send either "contact_id" (an identity) or "name" + "email" (a person)'));
      return;
    }
    try {
      const saved = await addContact(storage, config, resolve(req), input);
      res.status(201).json(success(config.nodeId, {
        contact_id: saved.contact_id, kind: saved.kind,
        // `contact` stays the consent row it always was, so existing callers read back unchanged.
        contact: saved.consent ?? null, person: saved.person ?? null,
      }));
    } catch (e) { if (!sendErr(res, e)) throw e; }
  });

  /* ── PATCH /v1/contacts/:contactId — what the OWNER knows about a saved person (name, note,
   * tags, links, relation). Never touches opt-out, bounce or suppression: that is the recipient's
   * state, not the owner's note about them. ── */
  router.patch('/v1/contacts/:contactId', requireAuth(), requireRole('owner'), async (req, res) => {
    const contactId = decodeURIComponent(req.params.contactId as string);
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const person = await updatePersonContact(storage, resolve(req), contactId, {
        name: typeof b.name === 'string' ? b.name : undefined,
        note: b.note === undefined ? undefined : (typeof b.note === 'string' ? b.note : null),
        tags: Array.isArray(b.tags) ? b.tags.filter((t): t is string => typeof t === 'string') : undefined,
        links: readLinks(b.links),
        relation: b.relation === undefined ? undefined : (typeof b.relation === 'string' ? b.relation : null),
      });
      res.json(success(config.nodeId, { person }));
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

  /* ── POST /v1/contacts/handles — the picker's half of "an app may reach ONE person".
   *
   * Called by the apex picker page (public/contact-picker.html) after the OWNER chose somebody,
   * with the app's origin as the popup's opener reported it. The origin is resolved to a published
   * app by the one function that knows that binding, so an app cannot name another app; the chosen
   * contact is re-read from this owner's own address book, so a handle cannot be minted for a
   * contact they do not have. What comes back is a handle plus the little the app is allowed to
   * know — never the address. ── */
  router.post('/v1/contacts/handles', requireAuth(), requireRole('owner'), rateLimit({ max: 60, windowMs: 10 * 60 * 1000 }), async (req, res) => {
    const ownerGhii = resolve(req);
    const contactId = String((req.body ?? {}).contact_id ?? '');
    const appOrigin = String((req.body ?? {}).app_origin ?? '');
    if (!contactId || !appOrigin) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body fields "contact_id" and "app_origin" are required'));
      return;
    }
    const target = await resolveAppOriginTarget(config, storage, appOrigin);
    if (!target.ok) {
      res.status(400).json(error(config.nodeId, 'INVALID_ORIGIN', `That origin does not serve an app on this node (${target.error})`));
      return;
    }
    // The contact has to be one this owner actually has. Reading it back from the projection is
    // also what decides `reachable`, so the answer the app gets is the address book's, not a claim.
    const { contacts } = await listContactsMerged(storage, ownerGhii);
    const chosen = contacts.find(c => c.contact_id === contactId);
    if (!chosen) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such contact'));
      return;
    }
    // A contact with no saved address cannot be written to through this handle, so no handle is
    // minted for one. Advertising a choice the spend would refuse is the "control that can never
    // work" failure TARGET-057 names, and the picker offers the same set for the same reason.
    if (!chosen.email) {
      res.status(422).json(error(config.nodeId, 'NOT_REACHABLE',
        'That contact has no saved address — an app can be handed a person saved with an email'));
      return;
    }
    const handle = mintContactHandle({ ownerGhii, app: target.target, contactId });
    // Decision K1's shape, as GET /v1/connections uses it: the projection is the gate. An app
    // learns what it can act on and nothing it could use to identify the person elsewhere — the
    // address, the node id and the owner's own notes all stay on this side.
    res.status(201).json(success(config.nodeId, {
      handle,
      app: target.target,
      contact: {
        label: chosen.display_name ?? chosen.saved_name ?? chosen.contact_id,
        kind: chosen.kind,
        // What the node will actually do with it, not what the record happens to carry: an
        // identity here is written to in their AIMEAT inbox, anyone else by email.
        reachable: [chosen.kind === 'mail' ? 'email' : 'inbox'],
      },
    }));
  });

  /* ── POST /v1/contacts/handle/send — the app's half. The app spends a handle; the NODE sends.
   *
   * The address never reaches the app and the message never leaves through it: everything the
   * outbound door already enforces (opt-out, suppression, the daily ceiling, the append-only log)
   * applies unchanged, because this is that door with a handle in front of it rather than a second
   * way out. `outbound:send` is the word, because that is exactly the favour being asked. ── */
  router.post('/v1/contacts/handle/send', requireAuth(), requireScope('outbound:send'), async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    // Both bindings are proven inside resolveContactHandle: this owner, and this app. A handle that
    // does not answer to both does not exist, and says so with the same 403 either way.
    const chosen = resolveContactHandle(String(b.handle ?? ''), ownerGhii, req.auth!.app);
    if (!chosen) {
      res.status(403).json(error(config.nodeId, 'INVALID_HANDLE', 'That contact handle is unknown, expired, or was not chosen for this app'));
      return;
    }
    try {
      const result = await sendToContact(config, storage, ownerGhii, chosen.contactId, {
        subject: typeof b.subject === 'string' ? b.subject : '',
        body: typeof b.body === 'string' ? b.body : '',
        kind: b.kind === 'marketing' ? 'marketing' : 'transactional',
      });
      res.json(success(config.nodeId, result));
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
