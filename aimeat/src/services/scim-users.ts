/**
 * @file src/services/scim-users.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SCIM User resource handlers (BR-04): how a directory's push becomes owner
 *   lifecycle on this node. SCIMMY carries the protocol (schemas, filter grammar, PATCH
 *   semantics, response and error shapes); everything DECIDED here goes through the same services
 *   every other door uses — provisionOwner for creation, deactivateOwner/reactivateOwner for
 *   `active`, ensureSsoMembership for the organism binding. No handler touches a raw request.
 *
 *   THE RULES, all owner-level:
 *   - The fence: a connection reads and writes ONLY accounts whose managedBy is its own id.
 *     Anything else answers 404 — not 403, which would confirm the account exists.
 *   - Identity keys: the original userName lands under `scimuser:<conn>` and the externalId under
 *     `scim:<conn>` in externalIdentities, verbatim — Entra asks "does this user exist" with the
 *     UPN it sent, not with the owner name this node derived (R11).
 *   - Adoption (R5): a create whose verified email already belongs to a LOCALLY VERIFIED account
 *     in the connection's own domains adopts that account; any other collision is a 409.
 *   - R13: `active: false` (and DELETE) against an operator-role owner is refused — a directory
 *     sync must not decapitate the node.
 *   - Deletion is deactivation (R3): the person's knowledge is theirs; IdP "deleted" means
 *     "cannot act", and it is reversible.
 * @structure ScimContext; declareScimResources() (idempotent SCIMMY singleton setup);
 *   normalizeEntraPatchBody() (the string-boolean shim, unit-tested in scim-entra-compat).
 * @usage declareScimResources(); // once, from routes/scim.ts
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 3), after the SCIMMY spike: Express 5 works,
 *     context flows per request, capitalised op verbs parse, string booleans need the shim.
 */
import SCIMMY from 'scimmy';
import type { AimeatConfig } from '../config.js';
import type { Storage, OwnerRecord, GHIIRecord } from '../storage/interface.js';
import type { SsoConnectionRecord } from '../storage/interface.js';
import { provisionOwner, RegistrationClosedError, ProvisionEmailTakenError } from './owner-provisioning.js';
import { deactivateOwner, reactivateOwner } from './owner-lifecycle.js';
import { deriveUniqueUsername, emailHashOf } from './external-login.js';
import { ensureSsoMembership } from './sso-membership.js';
import { logger } from '../utils/logger.js';

/** What every handler receives — resolved by the route's auth middleware, never from the URL. */
export interface ScimContext {
  storage: Storage;
  config: AimeatConfig;
  conn: SsoConnectionRecord;
}

const userNameKey = (conn: SsoConnectionRecord): string => `scimuser:${conn.id}`;
const externalIdKey = (conn: SsoConnectionRecord): string => `scim:${conn.id}`;

/** The SCIM view of one managed account. `id` is the owner name — stable, URL-safe, ours. */
function toScimUser(conn: SsoConnectionRecord, owner: OwnerRecord, ghii: GHIIRecord | null): Record<string, unknown> {
  const ids = ghii?.externalIdentities ?? {};
  const email = ghii?.notificationEmail;
  return {
    id: owner.name,
    userName: ids[userNameKey(conn)] ?? email ?? owner.name,
    ...(ids[externalIdKey(conn)] ? { externalId: ids[externalIdKey(conn)] } : {}),
    active: !owner.disabledAt,
    displayName: ghii?.displayName ?? owner.displayName ?? owner.name,
    ...(email ? { emails: [{ value: email, primary: true }] } : {}),
  };
}

/** Every account this connection manages, in SCIM shape. SCIMMY applies filters and paging on top. */
async function listManagedUsers(ctx: ScimContext): Promise<Record<string, unknown>[]> {
  const owners = (await ctx.storage.listOwners()).filter(o => o.managedBy === ctx.conn.id);
  const out: Record<string, unknown>[] = [];
  for (const owner of owners) {
    out.push(toScimUser(ctx.conn, owner, await ctx.storage.getGHIIByOwner(owner.name)));
  }
  return out;
}

/** The fence, as one read: this connection's managed owner by id, or null. */
async function managedOwner(ctx: ScimContext, id: string): Promise<OwnerRecord | null> {
  const owner = await ctx.storage.getOwner(id);
  return owner && owner.managedBy === ctx.conn.id ? owner : null;
}

const scimError = (status: number, scimType: string | null, message: string) =>
  new SCIMMY.Types.Error(status, scimType as never, message);

/**
 * Translate a domain error into the SCIM error SCIMMY can carry. SCIMMY maps every unknown
 * exception from a handler to `404 Resource not found`, which would report a closed node or a
 * broken storage call as "no such user" — so anything leaving a handler is one of ITS errors.
 */
function asScimError(err: unknown): never {
  if (err instanceof SCIMMY.Types.Error) throw err;
  if (err instanceof RegistrationClosedError) throw scimError(403, null, err.message);
  if (err instanceof ProvisionEmailTakenError) throw scimError(409, 'uniqueness', err.message);
  logger.error('SCIM handler failed', { error: String(err) });
  throw scimError(500, null, 'Provisioning failed on this node');
}

/** Primary email out of a SCIM payload, falling back to an address-shaped userName. */
function emailOf(data: Record<string, unknown>): string | null {
  const emails = data.emails;
  if (Array.isArray(emails)) {
    const primary = emails.find(e => e && typeof e === 'object' && (e as { primary?: boolean }).primary) ?? emails[0];
    const value = primary && typeof primary === 'object' ? (primary as { value?: unknown }).value : undefined;
    if (typeof value === 'string' && value.includes('@')) return value.toLowerCase().trim();
  }
  const userName = data.userName;
  if (typeof userName === 'string' && userName.includes('@')) return userName.toLowerCase().trim();
  return null;
}

async function writeIdentityKeys(ctx: ScimContext, ghii: GHIIRecord, userName: string, externalId: string | null): Promise<void> {
  await ctx.storage.updateGHII(ghii.ghii, {
    externalIdentities: {
      ...(ghii.externalIdentities ?? {}),
      [userNameKey(ctx.conn)]: userName,
      [externalIdKey(ctx.conn)]: externalId ?? userName,
    },
  });
}

/** `active` transitions through the SAME lifecycle service the admin door uses; R13 on the way. */
async function applyActive(ctx: ScimContext, owner: OwnerRecord, active: boolean): Promise<void> {
  if (active && owner.disabledAt) {
    await reactivateOwner(ctx.storage, owner.name);
  } else if (!active && !owner.disabledAt) {
    if (owner.roles.includes('operator')) {
      throw scimError(403, null, 'This account operates the node and cannot be deactivated through provisioning');
    }
    await deactivateOwner(ctx.storage, owner.name, `sso:${ctx.conn.id}`);
  }
}

/** CREATE: adoption first (R5), then a fresh account through the one provisioning core. */
async function createUser(ctx: ScimContext, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const userName = typeof data.userName === 'string' ? data.userName.trim() : '';
  if (!userName) throw scimError(400, 'invalidValue', 'userName is required');
  const externalId = typeof data.externalId === 'string' && data.externalId ? data.externalId : null;
  const displayName = typeof data.displayName === 'string' && data.displayName.trim()
    ? data.displayName.trim() : userName.split('@')[0];
  const email = emailOf(data);

  // Already ours? Entra normally asks GET ?filter=userName eq … first, but a repeated POST must
  // still answer 409 uniqueness rather than mint a twin.
  const existing = await ctx.storage.getGHIIByExternalId(userNameKey(ctx.conn), userName)
    ?? (externalId ? await ctx.storage.getGHIIByExternalId(externalIdKey(ctx.conn), externalId) : null);
  if (existing) throw scimError(409, 'uniqueness', `User "${userName}" already exists`);

  if (email) {
    const byEmail = await ctx.storage.getGHIIByEmailHash(emailHashOf(email));
    if (byEmail) {
      const owner = await ctx.storage.getOwner(byEmail.ownerName);
      const domain = email.split('@')[1] ?? '';
      const adoptable = owner && !owner.managedBy && byEmail.emailVerifiedAt && ctx.conn.domains.includes(domain);
      if (!adoptable) throw scimError(409, 'uniqueness', `An account already uses ${email}`);
      // Adoption (R5): the organisation vouches for its own domain; the account verified the
      // address locally. Lifecycle authority moves to the connection, nothing else changes.
      await ctx.storage.updateOwner(owner.name, { managedBy: ctx.conn.id });
      await writeIdentityKeys(ctx, byEmail, userName, externalId);
      if (typeof data.active === 'boolean') await applyActive(ctx, { ...owner, managedBy: ctx.conn.id }, data.active);
      await ensureSsoMembership(ctx.storage, ctx.conn, owner.name);
      const adoptedOwner = await ctx.storage.getOwner(owner.name);
      return toScimUser(ctx.conn, adoptedOwner!, await ctx.storage.getGHIIByOwner(owner.name));
    }
  }

  const username = await deriveUniqueUsername(ctx.storage, email ?? userName.split('@')[0], displayName);
  const { ghii } = await provisionOwner(ctx.storage, ctx.config, {
    via: 'provisioning',
    username,
    displayName,
    verifiedEmail: email,   // the organisation's directory asserts the address
    externalIdentities: {
      [userNameKey(ctx.conn)]: userName,
      [externalIdKey(ctx.conn)]: externalId ?? userName,
    },
  });
  await ctx.storage.updateOwner(username, { managedBy: ctx.conn.id });
  if (data.active === false) await applyActive(ctx, (await ctx.storage.getOwner(username))!, false);
  await ensureSsoMembership(ctx.storage, ctx.conn, username);
  return toScimUser(ctx.conn, (await ctx.storage.getOwner(username))!, ghii);
}

/** UPDATE (PUT and applied-PATCH alike): displayName, userName/externalId keys, and `active`. */
async function updateUser(ctx: ScimContext, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const owner = await managedOwner(ctx, id);
  if (!owner) throw scimError(404, null, `User ${id} not found`);
  const ghii = await ctx.storage.getGHIIByOwner(owner.name);

  if (typeof data.displayName === 'string' && data.displayName.trim() && ghii) {
    await ctx.storage.updateGHII(ghii.ghii, { displayName: data.displayName.trim() });
  }
  if (ghii && typeof data.userName === 'string' && data.userName.trim()) {
    const externalId = typeof data.externalId === 'string' && data.externalId ? data.externalId : null;
    const current = ghii.externalIdentities?.[externalIdKey(ctx.conn)];
    await writeIdentityKeys(ctx, ghii, data.userName.trim(), externalId ?? (typeof current === 'string' ? current : null));
  }
  if (typeof data.active === 'boolean') await applyActive(ctx, owner, data.active);

  const fresh = await ctx.storage.getOwner(owner.name);
  return toScimUser(ctx.conn, fresh!, await ctx.storage.getGHIIByOwner(owner.name));
}

let declared = false;

/**
 * Declare the SCIM User resource on SCIMMY's process-wide singleton. Idempotent — SCIMMY is
 * global, so this runs once however many routers mount. Groups are deliberately NOT declared
 * (R8): /ResourceTypes advertises Users only, and Entra and Okta provision users without a
 * group mapping.
 */
export function declareScimResources(): void {
  if (declared) return;
  declared = true;
  // The handlers return plain SCIM-shaped objects; SCIMMY validates them against its own User
  // schema at the boundary, which is exactly the check we want — the `never` casts only bridge
  // its nominal class types, not the validation.
  SCIMMY.Resources.declare(SCIMMY.Resources.User)
    .ingress((async (resource: { id?: string }, data: unknown, ctx: unknown) => {
      const context = ctx as ScimContext;
      const payload = data as Record<string, unknown>;
      try {
        return await (resource.id ? updateUser(context, resource.id, payload) : createUser(context, payload));
      } catch (err) {
        asScimError(err);
      }
    }) as never)
    .egress((async (resource: { id?: string }, ctx: unknown) => {
      const context = ctx as ScimContext;
      const all = await listManagedUsers(context);
      if (resource.id) {
        const one = all.find(u => u.id === resource.id);
        if (!one) throw scimError(404, null, `User ${resource.id} not found`);
        return [one];
      }
      return all;
    }) as never)
    .degress(async (resource: { id?: string }, ctx: unknown) => {
      const context = ctx as ScimContext;
      try {
        const owner = resource.id ? await managedOwner(context, resource.id) : null;
        if (!owner) throw scimError(404, null, `User ${resource.id} not found`);
        // DELETE is deactivation (R3): the directory said "gone", the knowledge stays.
        if (owner.roles.includes('operator')) {
          throw scimError(403, null, 'This account operates the node and cannot be deactivated through provisioning');
        }
        if (!owner.disabledAt) {
          await deactivateOwner(context.storage, owner.name, `sso:${context.conn.id}`);
        }
        logger.info('SCIM deprovisioned an account (deactivated, not erased)', { connection: context.conn.id, owner: owner.name });
      } catch (err) {
        asScimError(err);
      }
    });
}

/**
 * Entra's default SCIM client is not RFC 7644 clean: PATCH op verbs arrive capitalised (SCIMMY
 * tolerates those) and booleans arrive as the STRINGS "True"/"False" unless the tenant opted into
 * `aadOptscim062020`. SCIMMY's schema is strictly typed, so the strings are normalised here,
 * BEFORE the message reaches it — on the `active` path, and inside complex values.
 */
export function normalizeEntraPatchBody(body: unknown): void {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { Operations?: unknown }).Operations)) return;
  const toBool = (v: unknown): unknown =>
    typeof v === 'string' && /^(true|false)$/i.test(v) ? v.toLowerCase() === 'true' : v;
  for (const op of (body as { Operations: Array<Record<string, unknown>> }).Operations) {
    if (!op || typeof op !== 'object') continue;
    const path = typeof op.path === 'string' ? op.path : '';
    if (/(^|\.)active$/i.test(path)) op.value = toBool(op.value);
    if (op.value && typeof op.value === 'object' && !Array.isArray(op.value)) {
      const obj = op.value as Record<string, unknown>;
      if ('active' in obj) obj.active = toBool(obj.active);
    }
  }
}
