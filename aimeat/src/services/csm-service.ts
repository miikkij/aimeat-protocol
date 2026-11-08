/**
 * @file src/services/csm-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Everything a CSM (Community Service Manifest) route and the MCP tool aimeat_csm share:
 *   who may read a CSM, the owner prefix of a new name, the versions a PUT keeps, the draft from a
 *   sample, and the users that keep a CSM from being deleted. REST (routes/csm.ts) and the node MCP
 *   (mcp/csm.ts) call the same functions with the same caller, so the rules live here once.
 *
 *   Ruled by the developer on 2026-11-07:
 *     1. A new CSM's name starts with its owner's account name and a dot (`jussil.ruuvi-nakyma`); the
 *        node adds the prefix when the definition does not carry it. CSM names are node-global, and
 *        the prefix is what keeps two accounts from colliding. Existing names stay.
 *     2. Visibility: public (anyone, no sign-in: a writer reads the shape it must send), members (any
 *        account of this node), organism:<id> (that organism's members), private (the registering
 *        account and its own agents and apps). A CSM the caller may not read answers 404, as a missing
 *        one does. The node's default for a new CSM is csm.default_visibility.
 *     3. Versions: 1 at create; PUT replaces the definition with the expected version named, keeps the
 *        replaced version in the history and moves the schema lock (csm.<name>) to the new schema. A
 *        stale version answers 409 VERSION_CONFLICT.
 *     4. Writes: the owner in person, or a principal holding csm:write (inside the wildcard family), on
 *        the CSMs of its own account. The operator may still delete another account's CSM, and that
 *        writes the operator trail.
 *     6. A CSM some module says it uses (registerCsmUseCheck) is not deleted: 409 IN_USE names the users.
 *   Ruled by the developer on 2026-11-08 (ruling 2): the registering account may delete its own CSM.
 *     Other accounts' receivers keep validating against their stored copy, and their owners get a
 *     notice that the CSM was removed. Only the registering account's own uses block the delete, and
 *     the refusal names no other account's receiver.
 * @structure CSM_WRITE_SCOPE · CsmUse · registerCsmUseCheck · csmUsers · getCsmCompiled · ownerPrefixed ·
 *   csmMayRead · csmLockShownTo · listCsmsFor · getCsmFor · listCsmVersionsFor · getCsmVersionFor · csmTemplates ·
 *   draftCsmFromSample · createCsmAs · updateCsmAs · setCsmVisibilityAs · deleteCsmAs
 * @usage
 *   registerCsmUseCheck(async (name) => receiversNaming(name));   // a module that uses CSMs
 *   const compiled = await getCsmCompiled(storage, 'alice.sensor');  // { name, version, jsonSchema, hash }
 *   const out = await createCsmAs({ storage, config }, caller, { yaml });  // { ok, status, data } | refusal
 * @version-history
 *   v1.1.0 — 2026-11-08 — Ruling 2 of 2026-11-08 in deleteCsmAs: a use check may name the account of a
 *     use (CsmUse); only the registering account's own uses block, others' owners get a csm_removed
 *     notice. The registering account is the name's holder since the CSM was registered
 *     (isRegisteringAccount), so the next account of an erased name neither reads a private CSM nor
 *     changes or deletes one. csmLockShownTo: the schema-lock row a CSM owns follows its visibility
 *     (secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-07 — Initial (CSM owner prefix, visibility, versions, csm:write, draft, in-use; Jouni, 2026-11-07).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage, CsmRecord, CsmVersionRecord } from '../storage/interface.js';
import type { CallerContext } from './caller-context.js';
import { parseCsm, validateCsm, csmToJsonSchema, type CsmDefinition } from './csm-parser.js';
import { inferCsmFromSample } from './csm/infer.js';
import { parseAudience, formatAudience, audienceAllows, isOrganismMember, type AudienceAuth } from './audience.js';
import { csmVisibilityDefault } from './content-defaults.js';
import { operatorOverride } from './operator-override.js';
import { emitChange } from './event-bus.js';
import { notify } from './notify.js';
import { stableStringify } from '../utils/stable-json.js';
import { localAccountOf } from '../utils/gaii.js';
import { isAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { logger } from '../utils/logger.js';

/** The permission word that lets an agent or an app make and change its account's CSMs. */
export const CSM_WRITE_SCOPE = 'csm:write';

/** The longest name a new CSM may have, prefix included. */
const MAX_NAME = 200;

export interface CsmDeps { storage: Storage; config: AimeatConfig }

/** What a CSM function answers: the data and its HTTP status, or a refusal with the REST code. */
export type CsmAnswer<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

/** The refusal half of CsmAnswer. */
export type CsmRefusal = Extract<CsmAnswer<never>, { ok: false }>;

const refuse = (status: number, code: string, message: string, details?: Record<string, unknown>): CsmRefusal =>
  ({ ok: false, status, code, message, ...(details ? { details } : {}) });

// ── Who uses a CSM ─────────────────────────────────────────────────────────

/**
 * One use a check names: `label` for the registering account and the operator ("receiver alice/home"),
 * the account it belongs to (a bare account name of this node), and optionally the use's own name as
 * that account knows it (the receiver's name) and the page where that account sees it. A use given as
 * a plain string belongs to no known account and blocks a delete as before.
 */
export interface CsmUse { label: string; account: string; name?: string; link?: string }

/** A use as the delete reads it: `account` is null for a plain string. */
type Use = { label: string; account: string | null; name?: string; link?: string };

type CsmUseCheck = (name: string) => Promise<Array<string | CsmUse>>;
// Every process registers the same checks when its modules load, and each check reads storage, so a
// second process answers the same users; nothing here is state one process holds for another.
const useChecks: CsmUseCheck[] = [];

/**
 * A module that relies on a CSM says so here: its check answers who uses the named CSM (an empty
 * list when nobody). DELETE answers 409 IN_USE while any check names a use of the registering account,
 * or a use given as a plain string. Returns a function that takes the check back (a test, a module
 * that stops).
 */
export function registerCsmUseCheck(check: CsmUseCheck): () => void {
  useChecks.push(check);
  return () => {
    const at = useChecks.indexOf(check);
    if (at >= 0) useChecks.splice(at, 1);
  };
}

/** Every use the registered checks name, once each; `account` is null for a plain string. A check that throws names nobody, and is logged. */
async function csmUses(name: string): Promise<Use[]> {
  const uses: Use[] = [];
  for (const check of [...useChecks]) {
    try {
      for (const u of await check(name)) {
        const use: Use | null = typeof u === 'string' ? { label: u, account: null }
          : u && typeof u.label === 'string' && typeof u.account === 'string'
            ? { label: u.label, account: u.account, ...(typeof u.name === 'string' ? { name: u.name } : {}), ...(typeof u.link === 'string' ? { link: u.link } : {}) }
            : null;
        if (use?.label && !uses.some(x => x.label === use.label)) uses.push(use);
      }
    } catch (err) {
      logger.warn('csmUsers: a use check failed; it names no user', { name, error: String(err) });
    }
  }
  return uses;
}

/** Every user the registered checks name for this CSM, as labels. */
export async function csmUsers(name: string): Promise<string[]> {
  return (await csmUses(name)).map(u => u.label);
}

/**
 * Tell each other account whose use of a removed CSM did not block the delete (ruling 2 of
 * 2026-11-08): its receivers keep checking messages against the copy they hold. Never throws.
 */
async function tellOtherUsers(storage: Storage, config: AimeatConfig, name: string, uses: Use[]): Promise<number> {
  const byAccount = new Map<string, Use[]>();
  for (const u of uses) if (u.account && !u.account.includes('@')) byAccount.set(u.account, [...(byAccount.get(u.account) ?? []), u]);
  for (const [account, mine] of byAccount) {
    const names = mine.map(u => u.name ?? u.label).join(', ');
    const link = mine.find(u => u.link)?.link;
    try {
      await notify(storage, `${account}@${config.nodeId}`, {
        type: 'csm_removed',
        title: `The data description ${name} was removed`,
        body: `Its owner or the node's operator removed the data description (CSM) ${name}. Your receivers that use it: ${names}. `
          + 'They keep checking messages against the copy of its shape they hold, so they go on working. To use another shape, make a new receiver.',
        ...(link ? { link } : {}),
        i18n: { key: 'csm_removed', vars: { csm: name, uses: names } },
      });
    } catch (err) {
      logger.warn('deleteCsmAs: the notice to another user of the CSM failed', { name, account, error: String(err) });
    }
  }
  return byAccount.size;
}

// ── The compiled schema ────────────────────────────────────────────────────

/** sha256 of the stable JSON of a compiled schema: the same schema gives the same hash on any node. */
function schemaHash(jsonSchema: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(jsonSchema)).digest('hex');
}

/** The JSON Schema a stored definition compiles to, or null for a record no parser shape fits. */
function compileStored(definition: Record<string, unknown>): Record<string, unknown> | null {
  const def = definition as Partial<CsmDefinition>;
  if (!def?.dataSchema || typeof def.dataSchema !== 'object') return null;
  try { return csmToJsonSchema(def as CsmDefinition); } catch (err) {
    logger.warn('compileStored: a stored CSM definition did not compile', { error: String(err) });
    return null;
  }
}

/**
 * The current version's schema: the lock the CSM registered (what memory writes are checked against),
 * else what its definition compiles to.
 */
async function currentSchema(storage: Storage, record: CsmRecord): Promise<Record<string, unknown> | null> {
  const lock = await storage.getSchema(record.jsonSchemaKey, 'prefix');
  return lock?.schemaJson ?? compileStored(record.definition);
}

/**
 * One version of a CSM as JSON Schema with its hash, for a module that checks data against it (the
 * receivers). The current version without `version`; null when the CSM or the version does not exist
 * or holds no schema. No visibility check: this is a node-internal read.
 */
export async function getCsmCompiled(
  storage: Storage, name: string, version?: number,
): Promise<{ name: string; version: number; jsonSchema: Record<string, unknown>; hash: string } | null> {
  const record = await storage.getCsm(name);
  if (!record) return null;
  const current = record.version ?? 1;
  if (version === undefined || version === current) {
    const jsonSchema = await currentSchema(storage, record);
    return jsonSchema ? { name, version: current, jsonSchema, hash: schemaHash(jsonSchema) } : null;
  }
  const kept = await storage.getCsmVersion(name, version);
  return kept ? { name, version: kept.version, jsonSchema: kept.jsonSchema, hash: schemaHash(kept.jsonSchema) } : null;
}

// ── Who may read ───────────────────────────────────────────────────────────

/** The account a writing caller acts in on this node, or null (a visitor, the anonymous identity). */
function writerAccount(caller: CallerContext): string | null {
  if (caller.visitor || isAnonymousPrincipal(caller.auth)) return null;
  return localAccountOf(caller.owner);
}

/**
 * Whether `account` is the account that registered the CSM: the same name, and that name's account was
 * registered no later than the CSM. A deleted account's name is released for reuse (decision
 * 2026-08-10), so an account registered after the CSM is a later holder of the name, not its author
 * (secaudit2026nov08 round 14). No account record, or no readable time, answers by the name alone: a
 * signed-in caller always has an account, and the check never takes a right away on a guess.
 */
async function isRegisteringAccount(storage: Storage, record: CsmRecord, account: string | null): Promise<boolean> {
  if (!account || record.registeredBy !== account) return false;
  const holder = await storage.getOwner(account);
  const registered = Date.parse(holder?.createdAt ?? '');
  const named = Date.parse(record.registeredAt ?? '');
  return !Number.isFinite(registered) || !Number.isFinite(named) || registered <= named;
}

/** May this caller (null: nobody signed in) read the CSM? The registering account always may. */
export async function csmMayRead(storage: Storage, record: CsmRecord, viewer: CallerContext | null): Promise<boolean> {
  const audience = parseAudience(record.visibility ?? 'public') ?? { level: 'private' as const };
  if (audience.level === 'public') return true;
  if (!viewer) return false;
  const auth: AudienceAuth = viewer.auth;
  // Private names the registering account; a later holder of the name is not it.
  const ownerName = audience.level === 'private' && auth.owner === record.registeredBy
    && !(await isRegisteringAccount(storage, record, auth.owner)) ? undefined : record.registeredBy;
  return audienceAllows(storage, audience, auth, { ...(ownerName ? { ownerName } : {}) });
}

/**
 * Whether a schema-lock row may be shown to this viewer (null: nobody signed in). The row a CSM owns,
 * its jsonSchemaKey, carries the CSM's compiled schema, so it follows the CSM's visibility (ruling 2
 * of 2026-11-07); every other row stays public metadata, as before (secaudit2026nov08 round 14).
 */
export async function csmLockShownTo(storage: Storage, keyPattern: string, viewer: CallerContext | null): Promise<boolean> {
  if (!keyPattern.startsWith('csm.')) return true;
  const record = await storage.getCsm(keyPattern.slice('csm.'.length));
  if (!record || record.jsonSchemaKey !== keyPattern) return true;
  return csmMayRead(storage, record, viewer);
}

/** The visibility as this viewer may read it: the owner sees the organism's id, others its level. */
function visibilityFor(record: CsmRecord, viewer: CallerContext | null): string {
  const v = record.visibility ?? 'public';
  if (!v.startsWith('organism:')) return v;
  return viewer && writerAccount(viewer) === record.registeredBy ? v : 'organism';
}

function summary(record: CsmRecord, viewer: CallerContext | null) {
  return {
    name: record.name,
    service_type: record.serviceType,
    json_schema_key: record.jsonSchemaKey,
    registered_by: record.registeredBy,
    registered_at: record.registeredAt,
    updated_at: record.updatedAt,
    version: record.version ?? 1,
    visibility: visibilityFor(record, viewer),
    has_semantic: !!record.semantic,
  };
}

/** GET /v1/csm: the CSMs this caller may read. */
export async function listCsmsFor(deps: CsmDeps, viewer: CallerContext | null, opts: { serviceType?: string } = {}) {
  const all = await deps.storage.listCsms(opts.serviceType ? { serviceType: opts.serviceType } : undefined);
  const services = [];
  for (const record of all) if (await csmMayRead(deps.storage, record, viewer)) services.push(summary(record, viewer));
  return { ok: true as const, status: 200, data: { services, total: services.length } };
}

/** A CSM the caller may read, or the 404 a missing one answers. */
async function readable(deps: CsmDeps, viewer: CallerContext | null, name: string): Promise<CsmRecord | null> {
  const record = await deps.storage.getCsm(name);
  return record && await csmMayRead(deps.storage, record, viewer) ? record : null;
}

const notFound = (name: string) => refuse(404, 'NOT_FOUND', `CSM service "${name}" not found`);

/** GET /v1/csm/{name}: the definition, the schema it compiles to now, and its hash. */
export async function getCsmFor(deps: CsmDeps, viewer: CallerContext | null, name: string) {
  const record = await readable(deps, viewer, name);
  if (!record) return notFound(name);
  const jsonSchema = await currentSchema(deps.storage, record);
  return {
    ok: true as const, status: 200,
    data: {
      csm: {
        ...summary(record, viewer),
        definition: record.definition,
        semantic: record.semantic ?? null,
        federate: record.federate ?? false,
        json_schema: jsonSchema,
        schema_hash: jsonSchema ? schemaHash(jsonSchema) : null,
      },
    },
  };
}

function versionRow(v: CsmVersionRecord, current: boolean) {
  return { version: v.version, current, created_at: v.createdAt, registered_by: v.registeredBy, schema_hash: schemaHash(v.jsonSchema) };
}

/** GET /v1/csm/{name}/versions: every version, oldest first, the current one last. */
export async function listCsmVersionsFor(deps: CsmDeps, viewer: CallerContext | null, name: string) {
  const record = await readable(deps, viewer, name);
  if (!record) return notFound(name);
  const kept = await deps.storage.listCsmVersions(name);
  const jsonSchema = await currentSchema(deps.storage, record) ?? {};
  const now: CsmVersionRecord = {
    name, version: record.version ?? 1, definition: record.definition, jsonSchema,
    registeredBy: record.registeredBy, createdAt: record.updatedAt,
  };
  const versions = [...kept.map(v => versionRow(v, false)), versionRow(now, true)];
  return { ok: true as const, status: 200, data: { name, current_version: now.version, versions, total: versions.length } };
}

/** GET /v1/csm/{name}/versions/{n}: one version's definition and compiled schema. */
export async function getCsmVersionFor(deps: CsmDeps, viewer: CallerContext | null, name: string, version: number) {
  const record = await readable(deps, viewer, name);
  if (!record) return notFound(name);
  if (!Number.isInteger(version) || version < 1) return refuse(400, 'INVALID_INPUT', 'version must be a whole number from 1');
  const current = record.version ?? 1;
  let v: CsmVersionRecord | null;
  if (version === current) {
    v = { name, version: current, definition: record.definition, jsonSchema: await currentSchema(deps.storage, record) ?? {}, registeredBy: record.registeredBy, createdAt: record.updatedAt };
  } else {
    v = await deps.storage.getCsmVersion(name, version);
  }
  if (!v) return refuse(404, 'NOT_FOUND', `CSM service "${name}" has no version ${version}`);
  return {
    ok: true as const, status: 200,
    data: { name, version: v.version, current: v.version === current, created_at: v.createdAt, registered_by: v.registeredBy, definition: v.definition, json_schema: v.jsonSchema, schema_hash: schemaHash(v.jsonSchema) },
  };
}

// ── Templates ──────────────────────────────────────────────────────────────

export interface CsmTemplateMeta { type: string; name: string; description: string; schemaMode: string; yaml: string }

/** The built-in templates in docs/csm-examples. A file that does not parse is skipped. */
function loadTemplates(): CsmTemplateMeta[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'csm-examples');
  const out: CsmTemplateMeta[] = [];
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter(f => f.endsWith('.csm.yaml'))) {
      try {
        const yaml = readFileSync(join(dir, file), 'utf-8');
        const parsed = parseCsm(yaml);
        out.push({ type: file.replace('.csm.yaml', ''), name: parsed.service.name, description: parsed.service.description ?? '', schemaMode: parsed.schemaMode, yaml });
      } catch (err) {
        logger.warn('csmTemplates: continuing after a suppressed failure', { error: String(err) });
      }
    }
  }
  return out;
}

/** Read once when the module loads, as routes/csm.ts did before: the files ship with the build. */
const TEMPLATES = loadTemplates();

/** The built-in templates. */
export function csmTemplates(): CsmTemplateMeta[] {
  return TEMPLATES;
}

// ── Writing ────────────────────────────────────────────────────────────────

/** What a create or an update carries: YAML text, or a definition object, and the settings beside it. */
export interface CsmWriteInput {
  yaml?: unknown;
  definition?: unknown;
  visibility?: unknown;
  federate?: unknown;
}

/** The account the caller may write CSMs in, or the refusal. */
function mayWrite(caller: CallerContext): { account: string } | CsmRefusal {
  const account = writerAccount(caller);
  if (!account) return refuse(401, 'AUTH_REQUIRED', 'Sign in with an account of this node to make or change a CSM.');
  if (!caller.has(CSM_WRITE_SCOPE)) {
    return refuse(403, 'SCOPE_DENIED', `Making or changing a CSM needs the permission "${CSM_WRITE_SCOPE}", which the owner grants on the agent's page.`);
  }
  return { account };
}

/** The defaults parseCsm fills in, for a definition object that leaves a block out. */
const DEFAULTS = parseCsm('{}');

/**
 * The definition a write carries. `yaml` is parsed. An object in the YAML's own snake_case shape (it
 * has `data_schema` or `csm`) is parsed the same way, since JSON is YAML. Any other object is taken as
 * the parsed shape (`dataSchema`), with the blocks it leaves out filled in as the parser would.
 */
function definitionOf(input: CsmWriteInput | Record<string, unknown>): CsmDefinition | CsmRefusal {
  const i = input as Record<string, unknown>;
  const raw = typeof i.yaml === 'string' ? i.yaml
    : i.definition && typeof i.definition === 'object' ? i.definition
      : null;
  if (raw === null) return refuse(400, 'INVALID_INPUT', 'Send the CSM as `yaml` (text) or as `definition` (an object).');
  if (typeof raw === 'string') {
    try { return parseCsm(raw); } catch (err) {
      return refuse(400, 'PARSE_ERROR', `Failed to parse YAML: ${(err as Error).message}`);
    }
  }
  const obj = raw as Record<string, unknown>;
  if ('data_schema' in obj || 'csm' in obj || 'schema_mode' in obj) return parseCsm(JSON.stringify(obj));
  const d = obj as Partial<CsmDefinition>;
  if (!d.service || typeof d.service !== 'object') return refuse(400, 'VALIDATION_ERROR', 'CSM validation failed: service.name is required');
  return {
    ...DEFAULTS, ...d,
    service: { ...DEFAULTS.service, ...d.service },
    dataSchema: { required: d.dataSchema?.required ?? {}, optional: d.dataSchema?.optional ?? {} },
    consentRequirements: { ...DEFAULTS.consentRequirements, ...(d.consentRequirements ?? {}) },
    moderation: { ...DEFAULTS.moderation, ...(d.moderation ?? {}) },
    uiHints: { ...DEFAULTS.uiHints, ...(d.uiHints ?? {}) },
  } as CsmDefinition;
}

const isRefusal = (v: unknown): v is CsmRefusal => !!v && typeof v === 'object' && (v as { ok?: unknown }).ok === false;

function validated(def: CsmDefinition): CsmRefusal | null {
  const errors = validateCsm(def);
  return errors.length ? refuse(400, 'VALIDATION_ERROR', `CSM validation failed: ${errors.join('; ')}`) : null;
}

/** A new CSM's name: the account's name and a dot in front, unless the name already starts so. */
export function ownerPrefixed(name: string, account: string): string {
  return name.startsWith(`${account}.`) ? name : `${account}.${name}`;
}

/** The visibility a write asks for, checked; the organism must exist and hold the caller. */
async function visibilityOf(storage: Storage, caller: CallerContext, value: unknown): Promise<string | CsmRefusal> {
  const audience = parseAudience(value);
  if (!audience) return refuse(400, 'INVALID_INPUT', "visibility must be 'public', 'members', 'private' or 'organism:<organism id>'");
  if (audience.level === 'organism' && !(await isOrganismMember(storage, audience.organismId!, caller.auth))) {
    return refuse(400, 'INVALID_INPUT', `visibility names organism ${audience.organismId}, which does not exist or which you are not an active member of`);
  }
  return formatAudience(audience);
}

function semanticOf(def: CsmDefinition): Record<string, unknown> | undefined {
  return def.service.semantic && typeof def.service.semantic === 'object' ? def.service.semantic as Record<string, unknown> : undefined;
}

async function lockSchema(storage: Storage, def: CsmDefinition, schemaKey: string, jsonSchema: Record<string, unknown>, lockedBy: string, now: string): Promise<void> {
  const semantic = semanticOf(def);
  const existing = await storage.getSchema(schemaKey, 'prefix');
  await storage.setSchema({
    keyPattern: schemaKey,
    applyTo: 'prefix',
    schemaJson: jsonSchema,
    schemaMode: def.schemaMode,
    lockedBy: existing?.lockedBy ?? lockedBy,
    setAt: existing?.setAt ?? now,
    updatedAt: now,
    ...(semantic ? { semanticContext: { '@context': semantic['@context'] as Record<string, string> | undefined, '@type': semantic['@type'] as string | undefined } } : {}),
  });
}

/** The next steps a write answers with. */
export function csmLinks(name: string) {
  return [
    { description: 'View this CSM service', method: 'GET', url: `/v1/csm/${encodeURIComponent(name)}` },
    { description: 'Its versions', method: 'GET', url: `/v1/csm/${encodeURIComponent(name)}/versions` },
  ];
}

/** POST /v1/csm: register a new CSM in the caller's account. */
export async function createCsmAs(deps: CsmDeps, caller: CallerContext, input: CsmWriteInput) {
  const who = mayWrite(caller);
  if (isRefusal(who)) return who;
  const def = definitionOf(input);
  if (isRefusal(def)) return def;
  const invalid = validated(def);
  if (invalid) return invalid;
  const name = ownerPrefixed(def.service.name.trim(), who.account);
  if (name.length > MAX_NAME) return refuse(400, 'VALIDATION_ERROR', `CSM validation failed: the name is at most ${MAX_NAME} characters with the "${who.account}." in front`);
  const visibility = input.visibility === undefined || input.visibility === null
    ? csmVisibilityDefault(deps.config)
    : await visibilityOf(deps.storage, caller, input.visibility);
  if (isRefusal(visibility)) return visibility;
  if (await deps.storage.getCsm(name)) return refuse(409, 'CSM_NAME_TAKEN', `CSM service "${name}" is already registered`);

  def.service.name = name;
  const jsonSchema = csmToJsonSchema(def);
  const schemaKey = `csm.${name}`;
  const semantic = semanticOf(def);
  const now = new Date().toISOString();
  const federate = !!(input.federate ?? (def as { federate?: boolean }).federate);
  let record: CsmRecord;
  try {
    record = await deps.storage.createCsm({
      name, definition: def as unknown as Record<string, unknown>, jsonSchemaKey: schemaKey,
      serviceType: def.service.type, registeredBy: who.account, registeredAt: now, updatedAt: now,
      visibility, version: 1,
      ...(semantic ? { semantic } : {}),
      ...(federate ? { federate: true } : {}),
    });
  } catch (err) {
    if ((err as Error).message === 'CSM_NAME_TAKEN') return refuse(409, 'CSM_NAME_TAKEN', `CSM service "${name}" is already registered`);
    throw err;
  }
  // After the record: a name another writer took a moment earlier is refused above without a lock.
  await lockSchema(deps.storage, def, schemaKey, jsonSchema, who.account, now);
  emitChange('csm');
  return {
    ok: true as const, status: 201,
    data: {
      csm: {
        ...summary(record, caller),
        definition: record.definition,
        semantic: record.semantic ?? null,
        federate: record.federate ?? false,
        json_schema: jsonSchema,
        schema_hash: schemaHash(jsonSchema),
      },
    },
  };
}

/** The CSM a writer acts on: readable, and registered by the writer's own account. */
async function ownCsm(deps: CsmDeps, caller: CallerContext, account: string, name: string, verb: string): Promise<CsmRecord | CsmRefusal> {
  const record = await readable(deps, caller, name);
  if (!record) return notFound(name);
  if (!(await isRegisteringAccount(deps.storage, record, account))) return refuse(403, 'FORBIDDEN', `You can only ${verb} CSM services you registered`);
  return record;
}

/** PUT /v1/csm/{name}: the next version of the definition, written on the version the caller read. */
export async function updateCsmAs(deps: CsmDeps, caller: CallerContext, name: string, input: CsmWriteInput & { expected_version?: unknown }) {
  const who = mayWrite(caller);
  if (isRefusal(who)) return who;
  const record = await ownCsm(deps, caller, who.account, name, 'change');
  if (isRefusal(record)) return record;
  const expected = typeof input.expected_version === 'string' ? Number(input.expected_version) : input.expected_version;
  if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1) {
    return refuse(400, 'INVALID_INPUT', 'Name the version you read: expected_version in the body, or an If-Match header. GET /v1/csm/{name} answers it as `version`.');
  }
  const current = record.version ?? 1;
  if (expected !== current) {
    return refuse(409, 'VERSION_CONFLICT', `CSM service "${name}" is at version ${current}, not ${expected}. Read it again and send your change on version ${current}.`, { current_version: current });
  }
  const def = definitionOf(input);
  if (isRefusal(def)) return def;
  const invalid = validated(def);
  if (invalid) return invalid;
  const given = def.service.name.trim();
  if (given !== name && `${record.registeredBy}.${given}` !== name) {
    return refuse(400, 'INVALID_INPUT', `service.name must stay "${name}"; a different name is a new CSM (POST /v1/csm).`);
  }
  def.service.name = name;
  const jsonSchema = csmToJsonSchema(def);
  const previousSchema = await currentSchema(deps.storage, record) ?? {};
  const now = new Date().toISOString();
  const semantic = semanticOf(def);
  const updated = await deps.storage.replaceCsmVersion(name, expected, {
    definition: def as unknown as Record<string, unknown>, serviceType: def.service.type, updatedAt: now,
    ...(semantic ? { semantic } : {}),
  }, {
    name, version: current, definition: record.definition, jsonSchema: previousSchema,
    registeredBy: record.registeredBy, createdAt: record.updatedAt,
  });
  if (!updated) {
    const fresh = await deps.storage.getCsm(name);
    return refuse(409, 'VERSION_CONFLICT', `CSM service "${name}" changed while this one was written. Read it again and send your change on its new version.`, { current_version: fresh?.version ?? null });
  }
  await lockSchema(deps.storage, def, record.jsonSchemaKey, jsonSchema, who.account, now);
  emitChange('csm');
  return {
    ok: true as const, status: 200,
    data: {
      csm: { ...summary(updated, caller), definition: updated.definition, semantic: updated.semantic ?? null, json_schema: jsonSchema, schema_hash: schemaHash(jsonSchema) },
      previous_version: current,
    },
  };
}

/** PATCH /v1/csm/{name} { visibility }: who may read the CSM. */
export async function setCsmVisibilityAs(deps: CsmDeps, caller: CallerContext, name: string, value: unknown) {
  const who = mayWrite(caller);
  if (isRefusal(who)) return who;
  const record = await ownCsm(deps, caller, who.account, name, 'change');
  if (isRefusal(record)) return record;
  const visibility = await visibilityOf(deps.storage, caller, value);
  if (isRefusal(visibility)) return visibility;
  const now = new Date().toISOString();
  await deps.storage.setCsmVisibility(name, visibility, now);
  emitChange('csm');
  return { ok: true as const, status: 200, data: { name, visibility, previous_visibility: record.visibility ?? 'public', updated_at: now } };
}

/**
 * DELETE /v1/csm/{name}. The registering account deletes its own; the operator deletes another
 * account's and the operator trail records it. `asOperator` skips the ownership question for the
 * admin route, whose own gate already asked it.
 *
 * Ruling 2 of 2026-11-08: only the registering account's own uses (and a use a module names as a
 * plain string) answer 409 IN_USE, and the refusal names only those. Another account's receiver
 * holds its own copy of the compiled schema and keeps checking messages against it, so it does not
 * block the delete; its owner gets a notice that the CSM was removed, and the answer counts them.
 */
export async function deleteCsmAs(deps: CsmDeps, caller: CallerContext, name: string, opts: { asOperator?: boolean } = {}) {
  const record = await deps.storage.getCsm(name);
  let trail = false;
  if (!opts.asOperator) {
    const who = mayWrite(caller);
    if (isRefusal(who)) return who;
    const own = !!record && await isRegisteringAccount(deps.storage, record, who.account);
    // Asked without writing anything; the trail line is written below, once nothing refuses.
    const operator = !!record && !own && await caller.operator();
    if (!record || (!own && !operator && !(await csmMayRead(deps.storage, record, caller)))) return notFound(name);
    if (!own && !operator) return refuse(403, 'FORBIDDEN', 'You can only delete CSM services you registered');
    trail = operator;
  }
  if (!record) return notFound(name);
  const uses = await csmUses(name);
  const blocking = uses.filter(u => u.account === null || u.account === record.registeredBy).map(u => u.label);
  if (blocking.length) {
    return refuse(409, 'IN_USE', `CSM service "${name}" is in use by ${blocking.join(', ')}. Stop those first, then delete it.`, { users: blocking });
  }
  // The operator deleting another person's CSM writes the operator trail (secaudit 2026-10, C2).
  if (trail && !(await operatorOverride(deps.storage, deps.config, caller.auth, { ownerOf: record.registeredBy, area: 'csm', action: 'delete', subject: name }))) {
    return refuse(403, 'FORBIDDEN', 'You can only delete CSM services you registered');
  }
  await deps.storage.deleteSchema(record.jsonSchemaKey);
  await deps.storage.deleteCsm(name);
  emitChange('csm');
  const told = await tellOtherUsers(deps.storage, deps.config, name, uses);
  return {
    ok: true as const, status: 200,
    data: { deleted: true, name, schema_deleted: record.jsonSchemaKey, ...(told ? { other_accounts_told: told } : {}) },
  };
}

// ── Draft from a sample ────────────────────────────────────────────────────

/**
 * POST /v1/csm/draft: a CSM definition inferred from one sample object, as YAML and as the parsed
 * definition, and the JSON Schema it compiles to. Stores nothing. The name gets the caller's prefix,
 * so creating from the draft registers the same name.
 */
export async function draftCsmFromSample(_deps: CsmDeps, caller: CallerContext, input: { name?: unknown; sample?: unknown; service_type?: unknown; description?: unknown }) {
  const who = mayWrite(caller);
  if (isRefusal(who)) return who;
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  if (!rawName) return refuse(400, 'INVALID_INPUT', 'name is required: what the data is, e.g. "ruuvi-nakyma"');
  const name = ownerPrefixed(rawName, who.account);
  if (name.length > MAX_NAME) return refuse(400, 'INVALID_INPUT', `name is at most ${MAX_NAME} characters with the "${who.account}." in front`);
  const inferred = inferCsmFromSample(name, input.sample, {
    ...(typeof input.service_type === 'string' ? { serviceType: input.service_type } : {}),
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
  });
  if (!inferred.ok) return refuse(400, 'INVALID_INPUT', inferred.error);
  const definition = parseCsm(inferred.yaml);
  const invalid = validated(definition);
  if (invalid) return invalid;
  const jsonSchema = csmToJsonSchema(definition);
  return {
    ok: true as const, status: 200,
    data: { name, yaml: inferred.yaml, definition, json_schema: jsonSchema, schema_hash: schemaHash(jsonSchema), stored: false },
  };
}
