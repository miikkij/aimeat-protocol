/**
 * @file src/routes/organisms/intake.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Public Intake — a GENERIC capability for anonymous → owner-space submissions. An owner
 *   defines an "intake form" (server-trusted config in the workspace's own meta namespace) that pins an
 *   exact destination (org/ws/namespace) + an allow-list of fields; anyone may then POST to that form
 *   with NO auth. The node honeypot-screens, per-IP rate-limits, resolves the owner SERVER-SIDE from the
 *   config (never the request), allow-lists fields, validates against the workspace's LOCKED schema, and
 *   writes exactly ONE record (published or draft) — never returning any other record. Reuses the shared
 *   OrganismHelpers machinery (publishDraftsBatch / readConfig / memberRole / findWsEntry). Consumers:
 *   lead forms, feedback, questionnaires, quizzes, RSVP, support intake — the record is a normal
 *   workspace record so apps aggregate stats and agents can triage it downstream. Design: dev-organism
 *   doc-rgmvf8l / roadmap rm-public-intake.
 * @structure
 *   POST   /v1/intake/forms              (auth, ws-creator/admin) — define/update a form; mints formId if omitted
 *   GET    /v1/intake/forms?ws=          (auth)                   — list the owner's forms in a workspace
 *   DELETE /v1/intake/forms?ws=&form_id= (auth)                   — remove a form (kills the public link)
 *   GET    /v1/intake/:org/:ws/:formId   (PUBLIC)                 — public descriptor (title+fields), for any renderer
 *   POST   /v1/intake/:org/:ws/:formId   (PUBLIC, no-auth, rate-limited) — submit → one validated record
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: generic Public Intake capability (forms CRUD + anon submit).
 *   v1.1.0 — 2026-07-16 — Server-computed default tokens ({{now}}/{{today}}/{{uuid}}) resolved per
 *     submission, so a form can stamp a schema-required created-at/id without the node knowing field names.
 *   v1.3.0 — 2026-09-13 — UNDECLARED_SPACE (the developer's decision): a form whose destination
 *     namespace the workspace manifest does not declare is refused when it is defined, 422, and a
 *     submission to such a form is refused before anything is written, draft or published, with the
 *     public wording that names neither the namespace nor the workspace's spaces. The published
 *     submit ignored what publishDraftsBatch answered; it now answers that refusal too.
 *   v1.2.0 — 2026-09-13 — POST /v1/intake/forms refuses a form its destination cannot hold: 422
 *     INTAKE_SCHEMA_MISMATCH naming every property ("id", an allowed field, a default) the space's
 *     closed schema does not list. The definition used to succeed and every anonymous submission then
 *     failed on the "id" the submit path adds, seen only by the anonymous submitter.
 */
import type { Router, Request, Response } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { readPublishSpace, undeclaredSpaceRefusal } from '../../services/workspace-write-items.js';
import { emitChange } from '../../services/event-bus.js';
import { logger } from '../../utils/logger.js';
import type { OrganismHelpers } from './shared.js';

/** Server-trusted intake-form config, stored at organism.{org}.w.{ws}.meta.intake.{formId}. */
interface IntakeFormConfig {
  formId: string; orgId: string; ws: string; namespace: string; ownerGhii: string;
  allowedFields: string[]; requiredFields: string[]; defaults: Record<string, unknown>;
  mode: 'publish' | 'draft'; honeypotField: string | null; enabled: boolean; discoverable: boolean;
  maxPerDay: number | null; title: string;
  fields: Array<{ key: string; label?: string; type?: string; required?: boolean }>;
  successMessage: string; redirectUrl: string | null; createdAt: string; updatedAt: string;
}

const FORM_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/; // human slug rules (a token uses the frm_ prefix, also matches)

/** Take the C0 control characters out of a submitted value, keeping tab, newline and return.
 *  A NUL in particular cannot be stored by Postgres at all, so without this it becomes a 500. */
function stripControls(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
const MAX_BODY_FIELDS = 60;
const MAX_VALUE_LEN = 8000;

/** Interpolate server-computed tokens in a form's `defaults` at submission time, so a form can stamp a
 *  created-at / id per submission without the node knowing any field names: `{{now}}` → ISO timestamp,
 *  `{{today}}` → YYYY-MM-DD, `{{uuid}}` → a fresh uuid. Generic — feedback / quiz / RSVP forms use it too. */
function resolveDefaultTokens(defaults: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(defaults)) {
    const v = defaults[k];
    if (v === '{{now}}') out[k] = now.toISOString();
    else if (v === '{{today}}') out[k] = now.toISOString().slice(0, 10);
    else if (v === '{{uuid}}') out[k] = randomUUID();
    else out[k] = v;
  }
  return out;
}

export function registerOrganismIntakeRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const { memberRole, findWsEntry, bareOwner, readConfig, publishDraftsBatch } = H;

  const cfgKey = (org: string, ws: string, formId: string) => `organism.${org}.w.${ws}.meta.intake.${formId}`;
  const cfgPrefix = (org: string, ws: string) => `organism.${org}.w.${ws}.meta.intake.`;

  async function readForm(org: string, ws: string, formId: string): Promise<IntakeFormConfig | null> {
    const key = cfgKey(org, ws, formId);
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    return (items.find(r => r.key === key)?.value as IntakeFormConfig | undefined) ?? null;
  }

  /** Only the workspace creator (or an org admin) may manage that workspace's intake forms. Returns the
   *  caller's owner GHII on success, or null after already sending the error response. */
  async function requireWsOwner(req: Request, res: Response, org: string, ws: string): Promise<string | null> {
    const organism = await storage.getOrganism(org);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return null; }
    const role = await memberRole(req, organism, org);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return null; }
    const entry = await findWsEntry(org, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return null; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== (req.auth!.owner as string) && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can manage intake forms')); return null;
    }
    return resolveIdentity(req.auth!, config.nodeId);
  }

  const strList = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  /**
   * The names a form puts into every record that its destination's locked schema refuses, or [] when
   * the schema can hold them all (or there is no lock).
   *
   * The submit path adds `id`, copies the allowed fields and the defaults, then validates against the
   * space's lock, and a workspace always locks strict, which closes an object schema to every
   * property it does not list. A form naming one such property was accepted here and every anonymous
   * submission to it was then refused with 422, which only the anonymous submitter ever saw. The
   * test is the validator's own rule: listed under `properties`, or matching a `patternProperties` key.
   */
  async function namesTheSchemaRefuses(org: string, ws: string, namespace: string, names: string[]): Promise<string[]> {
    const lock = await storage.findApplicableSchema(`organism.${org}.w.${ws}.${namespace}.${randomUUID()}.latest`);
    if (!lock) return [];
    const schema = lock.schemaJson ?? {};
    const closed = schema.additionalProperties === false || (lock.schemaMode === 'strict' && schema.type === 'object');
    if (!closed) return [];
    const listed = new Set(Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {}));
    const patterns: RegExp[] = [];
    for (const p of Object.keys((schema.patternProperties as Record<string, unknown> | undefined) ?? {})) {
      // A pattern this engine cannot compile cannot admit a name at submit time either, so it admits none here.
      try { patterns.push(new RegExp(p, 'u')); } catch (err) { logger.warn('intake form: uncompilable patternProperties key admits nothing', { namespace, pattern: p, error: String(err) }); }
    }
    return [...new Set(names)].filter(n => !listed.has(n) && !patterns.some(re => re.test(n)));
  }

  /* ── POST /v1/intake/forms — define/update a public intake form (ws creator / org admin). ── */
  router.post('/v1/intake/forms', requireAuth(), requireScope('organism:write'), async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const org = typeof b.organism_id === 'string' ? b.organism_id : (typeof b.org === 'string' ? b.org : '');
    const ws = typeof b.ws === 'string' ? b.ws : '';
    const namespace = typeof b.namespace === 'string' ? b.namespace : '';
    if (!org || !ws || !namespace) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'organism_id, ws and namespace are required')); return; }
    if (namespace.startsWith('meta.')) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace cannot be a meta.* namespace')); return; }
    const ownerGhii = await requireWsOwner(req, res, org, ws);
    if (!ownerGhii) return;
    // A destination the workspace manifest does not declare would refuse every submission (the
    // developer's decision, 2026-09-13), so the form is refused here, where its owner is the one told.
    const { refusal } = await readPublishSpace(storage, org, ws, namespace);
    if (refusal) { res.status(refusal.status).json(error(config.nodeId, refusal.code, refusal.message, refusal.status, refusal.details)); return; }

    let formId = typeof b.form_id === 'string' ? b.form_id.trim().toLowerCase() : '';
    if (formId) {
      if (!FORM_ID_RE.test(formId)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'form_id must be a slug of [a-z0-9-], 2-64 chars')); return; }
    } else {
      formId = 'frm_' + randomBytes(12).toString('base64url').toLowerCase();
    }
    const allowedFields = strList(b.allowed_fields);
    if (!allowedFields.length) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'allowed_fields (non-empty array) is required')); return; }
    const defaults = (b.defaults && typeof b.defaults === 'object') ? b.defaults as Record<string, unknown> : {};

    // Refused before anything is stored: a form whose records the destination cannot hold would take
    // no submission at all, and the only one told would be an anonymous visitor.
    const refused = await namesTheSchemaRefuses(org, ws, namespace, ['id', ...allowedFields, ...Object.keys(defaults)]);
    if (refused.length) {
      const list = refused.map(n => `"${n}"`).join(', ');
      res.status(422).json(error(config.nodeId, 'INTAKE_SCHEMA_MISMATCH',
        `Every submission to this form would be refused: the locked schema for "${namespace}" does not allow additional properties and does not list ${list}. `
        + 'The node adds "id" to each record and writes the allowed fields and defaults into it. Add these to the schema\'s properties, or take them out of the form.',
        422, {
          missing_properties: refused,
          schema_url: `/v1/memory/${encodeURIComponent(`organism.${org}.w.${ws}.${namespace}`)}/schema`,
          how_to_fix: `Re-lock the schema in place with the missing properties added: PUT /v1/organisms/${org}/workspace?ws=${ws} with { schemas: { "${namespace}": <schema> } }, or aimeat_workspace_update { organism_id, ws, schemas }. The workspace does not need to be recreated.`,
        }));
      return;
    }

    const now = new Date().toISOString();
    const existing = await readForm(org, ws, formId);
    if (existing && existing.ownerGhii !== ownerGhii) { res.status(409).json(error(config.nodeId, 'CONFLICT', 'A form with this id already exists')); return; }
    const cfg: IntakeFormConfig = {
      formId, orgId: org, ws, namespace, ownerGhii, allowedFields,
      requiredFields: strList(b.required_fields),
      defaults,
      mode: b.mode === 'draft' ? 'draft' : 'publish',
      honeypotField: typeof b.honeypot_field === 'string' ? b.honeypot_field : null,
      enabled: b.enabled !== false,
      discoverable: !formId.startsWith('frm_'),
      maxPerDay: typeof b.max_per_day === 'number' && b.max_per_day > 0 ? Math.floor(b.max_per_day) : null,
      title: typeof b.title === 'string' ? b.title : '',
      fields: Array.isArray(b.fields) ? (b.fields as IntakeFormConfig['fields']) : allowedFields.map(k => ({ key: k })),
      successMessage: typeof b.success_message === 'string' ? b.success_message : '',
      redirectUrl: typeof b.redirect_url === 'string' ? b.redirect_url : null,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    await storage.setMemory({
      key: cfgKey(org, ws, formId), ownerGaii: ownerGhii, value: cfg as unknown as Record<string, unknown>,
      visibility: 'owner', tags: ['intake-form'], ttlHours: null,
      version: 1, createdAt: cfg.createdAt, updatedAt: now,
    } as MemoryRecord);
    emitChange('organisms');
    res.json(success(config.nodeId, {
      form_id: formId, submit_url: `/v1/intake/${org}/${ws}/${formId}`,
      discoverable: cfg.discoverable, enabled: cfg.enabled, mode: cfg.mode,
    }, cfg.discoverable ? [{ description: 'This form id is a guessable slug — for a public form, keep the per-IP rate limit and consider a per-form daily cap / captcha.', method: 'POST', url: `/v1/intake/${org}/${ws}/${formId}` }] : undefined));
  });

  /* ── GET /v1/intake/forms?ws= — list the owner's forms in a workspace. ── */
  router.get('/v1/intake/forms', requireAuth(), async (req, res) => {
    const org = typeof req.query.organism_id === 'string' ? req.query.organism_id : (typeof req.query.org === 'string' ? req.query.org : '');
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    if (!org || !ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'organism_id and ws are required')); return; }
    const ownerGhii = await requireWsOwner(req, res, org, ws);
    if (!ownerGhii) return;
    const prefix = cfgPrefix(org, ws);
    const { items } = await storage.listAllMemory({ prefix, limit: 500 });
    const forms = items
      .filter(r => r.key.startsWith(prefix) && !r.key.slice(prefix.length).includes('.'))
      .map(r => r.value as IntakeFormConfig).filter(Boolean)
      .map(f => ({ form_id: f.formId, namespace: f.namespace, mode: f.mode, enabled: f.enabled, discoverable: f.discoverable, title: f.title, allowed_fields: f.allowedFields, submit_url: `/v1/intake/${org}/${ws}/${f.formId}` }));
    res.json(success(config.nodeId, { forms }));
  });

  /* ── DELETE /v1/intake/forms?ws=&form_id= — remove a form (the public link stops working). ── */
  router.delete('/v1/intake/forms', requireAuth(), requireScope('organism:write'), async (req, res) => {
    const org = typeof req.query.organism_id === 'string' ? req.query.organism_id : (typeof req.query.org === 'string' ? req.query.org : '');
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const formId = typeof req.query.form_id === 'string' ? req.query.form_id : '';
    if (!org || !ws || !formId) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'organism_id, ws and form_id are required')); return; }
    const ownerGhii = await requireWsOwner(req, res, org, ws);
    if (!ownerGhii) return;
    const key = cfgKey(org, ws, formId);
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    const rec = items.find(r => r.key === key);
    if (rec) await storage.deleteMemory(rec.ownerGaii, key);
    emitChange('organisms');
    res.json(success(config.nodeId, { deleted: !!rec }));
  });

  /* ── GET /v1/intake/:org/:ws/:formId — PUBLIC descriptor: what a renderer needs to draw the form.
   *    Never discloses the destination namespace, owner, or any submitted data. ── */
  router.get('/v1/intake/:org/:ws/:formId', async (req, res) => {
    const org = req.params.org as string, ws = req.params.ws as string, formId = req.params.formId as string;
    const cfg = await readForm(org, ws, formId);
    if (!cfg || !cfg.enabled) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Form not found')); return; }
    res.json(success(config.nodeId, {
      form_id: cfg.formId, title: cfg.title,
      fields: (cfg.fields || []).map(f => ({ key: f.key, label: f.label ?? f.key, type: f.type ?? 'text', required: !!f.required })),
      honeypot_field: cfg.honeypotField, success_message: cfg.successMessage, redirect_url: cfg.redirectUrl,
    }));
  });

  /* ── POST /v1/intake/:org/:ws/:formId — PUBLIC submit. No auth. Per-IP rate-limited. All guards below. ── */
  router.post('/v1/intake/:org/:ws/:formId',
    rateLimit({ windowMs: 15 * 60_000, max: 20, keyBy: 'ip' }),
    async (req, res) => {
      const org = req.params.org as string, ws = req.params.ws as string, formId = req.params.formId as string;
      const cfg = await readForm(org, ws, formId);
      if (!cfg || !cfg.enabled) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Form not found')); return; }
      const body = (req.body ?? {}) as Record<string, unknown>;

      // Honeypot: a filled hidden field is a bot → accept silently but write nothing.
      if (cfg.honeypotField && String(body[cfg.honeypotField] ?? '').trim() !== '') {
        res.json(success(config.nodeId, { ok: true, id: null })); return;
      }
      if (Object.keys(body).length > MAX_BODY_FIELDS) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Too many fields')); return; }

      // A form defined before its destination stopped being declared (or before the 2026-09-13
      // decision) is refused before anything is written. The submitter is anonymous, so the refusal
      // names neither the namespace nor the workspace's spaces.
      const undeclared = (await readPublishSpace(storage, org, ws, cfg.namespace, { audience: 'public' })).refusal;
      if (undeclared) { res.status(undeclared.status).json(error(config.nodeId, undeclared.code, undeclared.message, undeclared.status, undeclared.details)); return; }

      // Build the record from the ALLOW-LIST only (defaults first — with server tokens resolved — then
      // the permitted submitter values).
      const record: Record<string, unknown> = { ...resolveDefaultTokens(cfg.defaults) };
      for (const f of cfg.allowedFields) {
        if (Object.prototype.hasOwnProperty.call(body, f) && body[f] != null) {
          const val = body[f];
          if (typeof val === 'string' && val.length > MAX_VALUE_LEN) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Field '${f}' is too long`)); return; }
          // A NUL byte cannot be stored in a Postgres text/jsonb value, so it reached the write and
          // came back as a 500 to an anonymous caller — measured against the live form. Nothing was
          // ever written, but a public endpoint answering "unexpected error" to crafted input is a
          // gap in its own right: the caller cannot tell a bug from a rejection, and the log fills
          // with noise anyone can generate. The other C0 controls go with it: none of them belong
          // in a form field, and stripping is friendlier than refusing a paste that carried one.
          record[f] = typeof val === 'string' ? stripControls(val) : val;
        }
      }
      for (const rf of cfg.requiredFields) {
        if (record[rf] == null || record[rf] === '') { res.status(400).json(error(config.nodeId, 'MISSING_FIELD', `Missing required field: ${rf}`)); return; }
      }
      const id = randomUUID();
      record.id = id;

      // Validate against the workspace's LOCKED schema (strict → additionalProperties:false). This
      // enforces the field allow-list a second time and rejects any type/enum violation → 400.
      const destLatest = `organism.${org}.w.${ws}.${cfg.namespace}.${id}.latest`;
      const vres = await validateMemoryWrite(destLatest, record, storage);
      if (!vres.valid) { res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED', 'Submission does not match the form schema', 422, vres.errors)); return; }

      // Respect the workspace publish-review gate: if it's on, a submission can only become a draft.
      const orgCfg = await readConfig(org);
      const gateOn = ((orgCfg?.gates as Record<string, { enabled?: boolean }> | undefined)?.publish?.enabled) === true;
      const mode: 'publish' | 'draft' = gateOn ? 'draft' : cfg.mode;
      const now = new Date().toISOString();

      // The record is owned by the FORM OWNER (server-trusted from config), NEVER the anonymous caller.
      if (mode === 'draft') {
        await storage.setMemory({
          key: `organism.${org}.w.${ws}.${cfg.namespace}.${id}.draft`, ownerGaii: cfg.ownerGhii,
          value: record, visibility: 'owner', tags: ['public-intake'], ttlHours: null,
          version: 1, createdAt: now, updatedAt: now,
        } as MemoryRecord);
      } else {
        // The batch reads the manifest again and refuses by itself if the space went undeclared
        // since the check above. Answering success then would tell the submitter something false,
        // and its own refusal is worded for a member, so the anonymous caller gets the public one.
        const out = await publishDraftsBatch(org, ws, cfg.namespace, [id], cfg.ownerGhii, undefined, { [id]: { value: record, visibility: 'owner' } });
        if (out.refusal) {
          const pub = undeclaredSpaceRefusal(cfg.namespace, [], { organismId: org, ws, audience: 'public' }) ?? out.refusal;
          res.status(pub.status).json(error(config.nodeId, pub.code, pub.message, pub.status, pub.details)); return;
        }
      }
      emitChange('organisms');
      // Write-only: return only the new id. NEVER any other record.
      res.json(success(config.nodeId, { ok: true, id, mode }));
    });
}
